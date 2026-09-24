import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { inspect } from 'node:util';
import pool from '../db.js';
import { classifyGame, normalizeCategories, setGameCategories } from '../categories.js';
import { HermesHeadlessOrchestrator } from './hermes-headless-orchestrator.js';
import { runGameTokGenerationLoop } from './gametok-generation-loop.js';
import { uploadGameFolderToR2 } from './r2-uploader.js';
import { normalizeOrientation, DEFAULT_ORIENTATION } from './orientation.js';
import { notifyGameReady, notifyGameFailed } from '../notifications.js';
import { deleteCoverAsset, enqueueCoverGeneration } from '../cover-art.js';
import { generateFluxImage, generateAndUploadFluxImage } from './nvidia-flux-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const GAMETOK_JOBS_ROOT = process.env.GAMETOK_MAKER_ROOT || path.join(STORAGE_ROOT, 'gametok-jobs');

const router = express.Router();

const orchestrator = new HermesHeadlessOrchestrator();

export async function verifyGame(html, opts = {}) {
    const code = typeof html === 'string' && html.startsWith('<') ? html : (opts.sourceHtml || '');
    const res = await orchestrator.runNativeSandboxTest(code, opts);
    return {
        success: res.passed,
        bypassed: Boolean(res.bypassed),
        crashes: res.errors || [],
        durationMs: res.durationMs,
        screenshot: null,
        critiqueFrames: []
    };
}

const JOB_TITLES = {
    dreamPending: 'Pending Dream...',
    remixPending: 'Updating Game...',
    labsPending: '🧪 Labs: Cooking...',
};

const pendingJobBoots = new Map();
const cancelledJobs = new Map();
const GENERATION_WORKER_ID = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;
const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_REPLICA_ID);
const GENERATION_WORKER_ENABLED = process.env.GENERATION_WORKER_ENABLED !== 'false';
const GENERATION_BURST_CONCURRENCY = process.env.GENERATION_BURST_CONCURRENCY !== 'false';
const GENERATION_JOB_MAX_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.GENERATION_JOB_MAX_CONCURRENCY || (IS_RAILWAY ? 24 : 8))));
const GENERATION_JOB_CONCURRENCY = Math.min(
    GENERATION_JOB_MAX_CONCURRENCY,
    Math.max(1, Number(process.env.GENERATION_JOB_CONCURRENCY || (IS_RAILWAY ? 8 : 1)))
);
const GENERATION_JOB_POLL_MS = Math.max(1000, Number(process.env.GENERATION_JOB_POLL_MS || 3000));
const GENERATION_JOB_MAX_ATTEMPTS = Math.max(1, Number(process.env.GENERATION_JOB_MAX_ATTEMPTS || 1));
const GENERATION_JOB_STALE_MINUTES = Math.max(2, Number(process.env.GENERATION_JOB_STALE_MINUTES || 2));
const GENERATION_JOB_RETRY_DELAY_MS = Math.max(5000, Number(process.env.GENERATION_JOB_RETRY_DELAY_MS || 30000));
const GENERATION_JOB_HEARTBEAT_MS = Math.max(15000, Number(process.env.GENERATION_JOB_HEARTBEAT_MS || 30000));

const generationJobRunners = new Map();
const generationJobCancelChecks = new Map();
let generationQueueReadyPromise = null;
let generationWorkerTimer = null;
let generationWorkerStopping = false;
let generationWorkerActiveCount = 0;

class DreamJobCancelledError extends Error {
    constructor(jobId) {
        super('Generation cancelled by user');
        this.name = 'DreamJobCancelledError';
        this.code = 'DREAM_JOB_CANCELLED';
        this.jobId = jobId;
    }
}

function rememberCancelledJob(jobId) {
    cancelledJobs.set(jobId, Date.now());
    generationJobCancelChecks.set(jobId, { checkedAt: Date.now(), cancelled: true });
}

function forgetCancelledJob(jobId) {
    cancelledJobs.delete(jobId);
    generationJobCancelChecks.delete(jobId);
}

function isJobCancelled(jobId) {
    return cancelledJobs.has(jobId) || pendingJobBoots.get(jobId)?.status === 'canceled';
}

function assertJobNotCancelled(jobId) {
    if (isJobCancelled(jobId)) {
        throw new DreamJobCancelledError(jobId);
    }
}

async function isJobCancelledShared(jobId, { force = false } = {}) {
    if (!jobId) return false;
    if (isJobCancelled(jobId)) return true;

    const cached = generationJobCancelChecks.get(jobId);
    const now = Date.now();
    if (!force && cached && now - cached.checkedAt < 1200) {
        return Boolean(cached.cancelled);
    }

    try {
        const result = await pool.query('SELECT status FROM generation_jobs WHERE id = $1', [jobId]);
        const cancelled = result.rows[0]?.status === 'canceled';
        generationJobCancelChecks.set(jobId, { checkedAt: now, cancelled });
        if (cancelled) {
            rememberCancelledJob(jobId);
            rememberPendingBoot(jobId, { status: 'canceled', error: 'Generation cancelled by user' });
        }
        return cancelled;
    } catch (error) {
        console.warn(`[DREAM JOB] Could not check shared cancel state for ${jobId}:`, error?.message || error);
        generationJobCancelChecks.set(jobId, { checkedAt: now, cancelled: false });
        return false;
    }
}

async function assertJobNotCancelledShared(jobId, options = {}) {
    if (await isJobCancelledShared(jobId, options)) {
        throw new DreamJobCancelledError(jobId);
    }
}

function isCancellationError(error) {
    return error?.code === 'DREAM_JOB_CANCELLED' || error?.name === 'DreamJobCancelledError';
}

function rememberPendingBoot(jobId, update) {
    pendingJobBoots.set(jobId, {
        createdAt: Date.now(),
        ...pendingJobBoots.get(jobId),
        ...update,
    });
}

function forgetPendingBoot(jobId) {
    pendingJobBoots.delete(jobId);
}

setInterval(() => {
    const cutoff = Date.now() - (15 * 60 * 1000);
    for (const [jobId, state] of pendingJobBoots.entries()) {
        if ((state?.createdAt || 0) < cutoff) {
            pendingJobBoots.delete(jobId);
        }
    }
    const cancelledCutoff = Date.now() - (60 * 60 * 1000);
    for (const [jobId, cancelledAt] of cancelledJobs.entries()) {
        if ((cancelledAt || 0) < cancelledCutoff) {
            cancelledJobs.delete(jobId);
        }
    }
}, 60 * 1000).unref?.();

const DISCOVERY_TABS = ['Explore', 'Games', 'Horror', 'Quiz', 'Roleplay'];
const DISCOVERY_CATEGORIES = ['arcade', 'action', 'simulation', 'horror', 'quiz', 'puzzle', 'roleplay', 'story', 'creative', 'tool'];
const DISCOVERY_SUBCATEGORIES = [
    'brainrot', 'casual', 'satisfying', 'creative_tool', 'experimental', 'meme',
    'arcade', 'runner', 'racing', 'simulator', 'shooter', 'platformer',
    'psychological', 'paranormal', 'escape', 'found_footage', 'cursed_feed', 'night_shift',
    'trivia', 'geography', 'anime', 'word', 'memory', 'impossible',
    'romance', 'fantasy', 'school_drama', 'boyfriend', 'girlfriend', 'immersive_world',
];
const INTERACTION_TYPES = ['arcade_loop', 'choice_story', 'drawing_tool', 'music_toy', 'quiz_challenge', 'simulator', 'horror_vignette', 'roleplay_story', 'sandbox', 'experimental'];
const DISCOVERY_CHIP_LOOKUP = {
    Explore: {
        creative_tool: ['For You', 'Satisfying'],
        experimental: ['For You'],
        casual: ['For You', 'Casual'],
        satisfying: ['Satisfying', 'For You'],
        meme: ['Meme', 'Brainrot'],
        brainrot: ['Brainrot', '67 Energy'],
        immersive_world: ['NPC Core', 'For You'],
        romance: ['NPC Core', 'For You'],
        boyfriend: ['NPC Core', 'For You'],
        girlfriend: ['NPC Core', 'For You'],
    },
    Games: {
        arcade: ['Arcade', 'For You'],
        runner: ['Speedrun', 'Arcade'],
        racing: ['Simulator', 'Speedrun'],
        simulator: ['Simulator', 'Cozy'],
        platformer: ['Arcade', 'Speedrun'],
        shooter: ['Boss Rush', 'Chaotic'],
        casual: ['Cozy', 'For You'],
        brainrot: ['Chaotic', 'For You'],
    },
    Horror: {
        psychological: ['Psychological', 'For You'],
        paranormal: ['Paranormal', 'For You'],
        escape: ['Escape', 'For You'],
        found_footage: ['Found Footage', 'For You'],
        cursed_feed: ['Cursed Feed', 'For You'],
        night_shift: ['Night Shift', 'For You'],
    },
    Quiz: {
        trivia: ['Trivia', 'For You'],
        geography: ['Geography', 'For You'],
        anime: ['Anime', 'School Break'],
        word: ['Brain Tease', 'School Break'],
        memory: ['Brain Tease', 'For You'],
        impossible: ['Impossible', 'Brain Tease'],
    },
    Roleplay: {
        romance: ['Romance', 'Recommend'],
        fantasy: ['Fantasy', 'Immersive Worlds'],
        school_drama: ['Drama', 'Recommend'],
        boyfriend: ['Boyfriend', 'Recommend'],
        girlfriend: ['Girlfriend', 'Recommend'],
        immersive_world: ['Immersive Worlds', 'Recommend'],
    },
};

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function clampClassifierConfidence(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0.5;
    return Math.min(1, Math.max(0, numeric));
}

function normalizeClassifierTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);
}

function deriveDiscoveryChips({ primaryTab = 'Explore', subcategory = '', tags = [] }) {
    const normalizedTab = String(primaryTab || 'Explore');
    const normalizedSubcategory = String(subcategory || '').trim();
    const tagSet = new Set(normalizeClassifierTags(tags));
    const derived = new Set();

    const tabLookup = DISCOVERY_CHIP_LOOKUP[normalizedTab];
    if (tabLookup?.[normalizedSubcategory]) {
        tabLookup[normalizedSubcategory].forEach((chip) => derived.add(chip));
    }

    if (normalizedTab === 'Explore') {
        if (tagSet.has('meme')) derived.add('Meme');
        if (tagSet.has('chaotic')) derived.add('67 Energy');
        if (tagSet.has('creative')) derived.add('For You');
    }

    if (normalizedTab === 'Games') {
        if (tagSet.has('cozy')) derived.add('Cozy');
        if (tagSet.has('adrenaline')) derived.add('Chaotic');
    }

    if (normalizedTab === 'Roleplay' && tagSet.has('story')) {
        derived.add('Recommend');
    }

    return Array.from(derived).slice(0, 4);
}

function getStoredDraftClassification(draft = {}) {
    const primaryTab = DISCOVERY_TABS.includes(draft?.primary_tab) ? draft.primary_tab : null;
    const category = DISCOVERY_CATEGORIES.includes(draft?.category) ? draft.category : null;
    const subcategory = DISCOVERY_SUBCATEGORIES.includes(draft?.subcategory) ? draft.subcategory : null;
    const interactionType = INTERACTION_TYPES.includes(draft?.interaction_type) ? draft.interaction_type : null;
    if (!primaryTab || !category || !interactionType) return null;

    const tags = normalizeClassifierTags(draft?.classification_tags);
    const discoveryChips = Array.isArray(draft?.discovery_chips)
        ? draft.discovery_chips.map((chip) => String(chip || '').trim()).filter(Boolean).slice(0, 6)
        : deriveDiscoveryChips({ primaryTab, subcategory, tags });
    return {
        primaryTab,
        category,
        subcategory,
        interactionType,
        tags,
        discoveryChips,
        confidence: clampClassifierConfidence(draft?.classification_confidence),
    };
}

export function cleanGameDescription(raw, title = '') {
    const text = String(raw || '');
    const SECTIONS = 'Features|Controls|Mechanics|Goal|Objective|How to play|Win condition|Scoring';

    const descMatch = text.match(
        new RegExp(String.raw`^\s*Description:\s*([\s\S]*?)(?=\n\s*(?:${SECTIONS})\s*:|$)`, 'mi')
    );
    if (!descMatch) return '';

    let out = descMatch[1].replace(/\s+/g, ' ').trim();
    const t = String(title || '').trim();
    if (t && out.toLowerCase().startsWith(t.toLowerCase())) {
        out = out.slice(t.length).replace(/^[\s:.\u2013\u2014-]+/, '');
    }
    return out.slice(0, 300).trim();
}

async function upsertPublishedAIGame({ draftId, userId, draft }) {
    const globalId = `gm-ai-${String(draftId).substring(0, 8)}`;
    const description = cleanGameDescription(draft.prompt, draft.title);
    const classification = getStoredDraftClassification(draft);
    await pool.query(
        `INSERT INTO games (id, name, description, icon, color, developer, embed_url, thumbnail, preview_video_url, remixed_from, remixed_from_username, orientation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            developer = EXCLUDED.developer,
            thumbnail = EXCLUDED.thumbnail,
            preview_video_url = EXCLUDED.preview_video_url,
            remixed_from = EXCLUDED.remixed_from,
            remixed_from_username = EXCLUDED.remixed_from_username,
            orientation = EXCLUDED.orientation`,
        [
            globalId,
            draft.title,
            description,
            "✨",
            "#050505",
            userId,
            `/api/ai/play/${draftId}`,
            draft.thumbnail,
            null,
            draft.remixed_from || null,
            draft.remixed_from_username || null,
            normalizeOrientation(draft.orientation),
        ]
    );

    enqueueCoverGeneration(pool, {
        draftId,
        gameId: globalId,
        title: draft.title,
        prompt: draft.prompt,
        classification,
    });

    try {
        const creatorPicked = normalizeCategories(draft.categories);
        if (creatorPicked.length) {
            await setGameCategories(pool, globalId, creatorPicked, 'creator');
        } else {
            const { categories, source } = await classifyGame({
                title: draft.title,
                prompt: draft.prompt,
                description,
            });
            if (categories.length) await setGameCategories(pool, globalId, categories, source);
        }
    } catch (e) {
        console.warn('[categories] could not categorise', globalId, '-', e.message);
    }

    return { globalId, classification };
}

function withTimeout(promise, ms, label) {
    let timeoutId;
    return Promise.race([
        promise.finally(() => clearTimeout(timeoutId)),
        new Promise((_, reject) => {
            const error = new Error(`${label} timed out.`);
            error.statusCode = 503;
            timeoutId = setTimeout(() => reject(error), ms);
        })
    ]);
}

async function markJobError(jobId, fallbackMessage, err) {
    const errorMessage = err?.message || fallbackMessage;
    const errorTitle = ('ERROR: ' + errorMessage).substring(0, 255);
    await pool.query(
        `UPDATE ai_games SET title = $1 WHERE id = $2`,
        [errorTitle, jobId]
    );
    try {
        const jobRes = await pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId]);
        if (jobRes.rows.length > 0) {
            const userId = jobRes.rows[0].user_id;
            await notifyGameFailed(userId, jobId, errorMessage);
        }
    } catch (notifError) {
        console.error('[markJobError] Failed to send notification:', notifError);
    }
}

async function recordGenerationTelemetry(jobId, fields = {}) {
    try {
        await ensureGenerationQueueSchema();
        await pool.query(
            `UPDATE generation_jobs
                SET dimension = COALESCE($2, dimension),
                    lane = COALESCE($3, lane),
                    engine = COALESCE($4, engine),
                    result_title = COALESCE($5, result_title),
                    duration_ms = COALESCE($6, duration_ms)
              WHERE id = $1`,
            [
                jobId,
                fields.dimension || null,
                fields.lane || null,
                fields.engine || null,
                fields.resultTitle || null,
                Number.isFinite(fields.durationMs) ? Math.round(fields.durationMs) : null,
            ],
        );
    } catch (error) {
        console.warn(`[Generation Telemetry] Failed to record for ${jobId}:`, error?.message || error);
    }
}

async function markJobCanceled(jobId) {
    rememberCancelledJob(jobId);
    rememberPendingBoot(jobId, { status: 'canceled', error: 'Generation cancelled by user' });
    try {
        await markGenerationJobCanceled(jobId);
    } catch (error) {
        console.warn(`[DREAM JOB] Could not mark ${jobId} canceled in queue yet:`, error?.message || error);
    }
    try {
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3 WHERE id = $4`,
            ['CANCELLED: Generation stopped', '', '', jobId]
        );
    } catch (error) {
        console.warn(`[DREAM JOB] Could not mark ${jobId} canceled in DB yet:`, error?.message || error);
    }
}

function markEphemeralJob(jobId, update) {
    rememberPendingBoot(jobId, update);
}

async function createPendingJob(userId, prompt, title, jobId = randomUUID()) {
    const startedAt = Date.now();
    const safeTitle = (title || 'Untitled').substring(0, 255);
    const dbRes = await withTimeout(pool.query(
        `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [jobId, userId, prompt, safeTitle, '', '', true]
    ), 12000, 'Dream job creation');
    console.log(`⏱️ [AI DB] Pending job row created in ${Date.now() - startedAt}ms`);
    return dbRes.rows[0].id;
}

async function ensureGenerationQueueSchema() {
    if (!generationQueueReadyPromise) {
        generationQueueReadyPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS generation_jobs (
                id UUID PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                kind VARCHAR(32) NOT NULL DEFAULT 'dream',
                status VARCHAR(32) NOT NULL DEFAULT 'queued',
                prompt TEXT NOT NULL,
                payload JSONB DEFAULT '{}'::jsonb,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 1,
                progress INTEGER NOT NULL DEFAULT 0,
                phase VARCHAR(64) DEFAULT 'queued',
                status_message TEXT,
                locked_by TEXT,
                locked_at TIMESTAMP,
                run_after TIMESTAMP DEFAULT NOW(),
                error TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP,
                canceled_at TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_generation_jobs_claim ON generation_jobs(status, run_after, created_at);
            CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_created ON generation_jobs(user_id, created_at DESC);
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS phase VARCHAR(64) DEFAULT 'queued';
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS status_message TEXT;
            ALTER TABLE generation_jobs ALTER COLUMN max_attempts SET DEFAULT 1;
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS dimension VARCHAR(8);
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS lane VARCHAR(64);
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS engine VARCHAR(32);
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS result_title TEXT;
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
            ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS log TEXT;
        `);
    }
    return generationQueueReadyPromise;
}

async function findActiveDuplicateGenerationJob(userId, kind, prompt, orientation = null) {
    await ensureGenerationQueueSchema();
    const params = [userId, kind, prompt];
    let orientationFilter = '';
    if (orientation) {
        params.push(normalizeOrientation(orientation));
        orientationFilter = `AND COALESCE(NULLIF(payload->>'orientation', ''), '${DEFAULT_ORIENTATION}') = $${params.length}`;
    }
    const result = await pool.query(
        `SELECT id, status, created_at
         FROM generation_jobs
         WHERE user_id = $1
           AND kind = $2
           AND status IN ('queued', 'running')
           AND lower(trim(prompt)) = lower(trim($3))
           ${orientationFilter}
         ORDER BY created_at DESC
         LIMIT 1`,
        params
    );
    return result.rows[0] || null;
}

async function enqueueGenerationJob({
    jobId,
    userId,
    prompt,
    title,
    kind = 'dream',
    payload = {},
    maxAttempts = GENERATION_JOB_MAX_ATTEMPTS,
    allowDuplicate = false,
}) {
    await ensureGenerationQueueSchema();
    const orientation = normalizeOrientation(payload?.orientation);
    if (!allowDuplicate) {
        const duplicate = await findActiveDuplicateGenerationJob(userId, kind, prompt, orientation);
        if (duplicate) {
            console.log(`🏗️ [GEN QUEUE] Deduped ${kind} job for user ${userId} -> existing ${duplicate.id} (${duplicate.status})`);
            scheduleGenerationWorker(0);
            return duplicate.id;
        }
    }
    const client = await pool.connect();
    const safeTitle = (title || 'Untitled').substring(0, 255);
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft, orientation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE
             SET title = EXCLUDED.title,
                 html_payload = '',
                 raw_code = '',
                 prompt = EXCLUDED.prompt,
                 orientation = EXCLUDED.orientation`,
            [jobId, userId, prompt, safeTitle, '', '', true, orientation]
        );
        await client.query(
            `INSERT INTO generation_jobs (id, user_id, kind, status, prompt, payload, max_attempts, progress, phase, status_message)
             VALUES ($1, $2, $3, 'queued', $4, $5::jsonb, $6, 0, 'queued', 'Waiting for a forge worker...')
             ON CONFLICT (id) DO UPDATE
             SET status = 'queued',
                 prompt = EXCLUDED.prompt,
                 payload = EXCLUDED.payload,
                 max_attempts = EXCLUDED.max_attempts,
                 progress = 0,
                 phase = 'queued',
                 status_message = 'Waiting for a forge worker...',
                 run_after = NOW(),
                 error = NULL,
                 updated_at = NOW(),
                 completed_at = NULL,
                 canceled_at = NULL`,
            [jobId, userId, kind, prompt, JSON.stringify(payload || {}), maxAttempts]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
    const queueMetrics = await getGenerationQueueMetrics(jobId);
    console.log(
        `🏗️ [GEN QUEUE] Enqueued ${kind} job ${jobId}; queued=${queueMetrics.queued} running=${queueMetrics.running}`
    );
    scheduleGenerationWorker(0);
    return jobId;
}

async function claimGenerationJob() {
    await ensureGenerationQueueSchema();
    const result = await pool.query(
        `WITH candidate AS (
            SELECT id
            FROM generation_jobs
            WHERE status = 'queued'
              AND kind = 'dream'
              AND run_after <= NOW()
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE generation_jobs job
         SET status = 'running',
             attempts = attempts + 1,
             progress = GREATEST(progress, 2),
             phase = 'starting',
             status_message = 'Forge worker started...',
             locked_by = $1,
             locked_at = NOW(),
             updated_at = NOW()
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.*`,
        [GENERATION_WORKER_ID]
    );
    return result.rows[0] || null;
}

async function recoverStaleGenerationJobs() {
    await ensureGenerationQueueSchema();
    await pool.query(
        `UPDATE generation_jobs
         SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
             phase = CASE WHEN attempts < max_attempts THEN 'recovering' ELSE 'failed' END,
             status_message = CASE
               WHEN attempts < max_attempts THEN 'Forge worker restarted. Recovering your build...'
               ELSE 'Generation worker stopped before finishing.'
             END,
             locked_by = NULL,
             locked_at = NULL,
             run_after = CASE WHEN attempts < max_attempts THEN NOW() ELSE run_after END,
             error = COALESCE(error, 'Generation worker stopped before finishing.'),
             updated_at = NOW()
         WHERE status = 'running'
           AND locked_at < NOW() - ($1::text)::interval`,
        [`${GENERATION_JOB_STALE_MINUTES} minutes`]
    );
}

async function markGenerationJobComplete(jobId) {
    await pool.query(
        `UPDATE generation_jobs
         SET status = 'complete',
             progress = 100,
             phase = 'complete',
             status_message = 'Your game is ready.',
             locked_by = NULL,
             locked_at = NULL,
             error = NULL,
             updated_at = NOW(),
             completed_at = NOW()
         WHERE id = $1`,
        [jobId]
    );
}

async function markGenerationJobFailed(job, errorMessage) {
    const effectiveMaxAttempts = Math.min(Number(job.max_attempts || 1), GENERATION_JOB_MAX_ATTEMPTS);
    const shouldRetry = Number(job.attempts || 0) < effectiveMaxAttempts;
    const nextStatus = shouldRetry ? 'queued' : 'failed';
    await pool.query(
        `UPDATE generation_jobs
         SET status = $2::varchar,
             phase = CASE WHEN $2::varchar = 'queued' THEN 'retrying' ELSE 'failed' END,
             status_message = $4,
             locked_by = NULL,
             locked_at = NULL,
             run_after = CASE WHEN $2::varchar = 'queued' THEN NOW() + ($3::text)::interval ELSE run_after END,
             error = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [
            job.id,
            nextStatus,
            `${GENERATION_JOB_RETRY_DELAY_MS} milliseconds`,
            errorMessage || 'Generation failed',
        ]
    );
}

async function markGenerationJobCanceled(jobId) {
    await ensureGenerationQueueSchema();
    await pool.query(
        `UPDATE generation_jobs
         SET status = 'canceled',
             phase = 'canceled',
             status_message = 'Generation cancelled by user',
             locked_by = NULL,
             locked_at = NULL,
             error = 'Generation cancelled by user',
             updated_at = NOW(),
             canceled_at = NOW()
         WHERE id = $1`,
        [jobId]
    );
}

async function updateGenerationJobProgress(jobId, progress, phase, statusMessage) {
    await pool.query(
        `UPDATE generation_jobs
         SET progress = GREATEST(progress, $2),
             phase = COALESCE($3, phase),
             status_message = COALESCE($4, status_message),
             updated_at = NOW()
         WHERE id = $1
           AND status IN ('queued', 'running')`,
        [jobId, clampNumber(Number(progress) || 0, 0, 100), phase || null, statusMessage || null]
    );
}

function getQueueProgressPayload(queueJob, queueMetrics = null) {
    if (!queueJob) return {};
    const payload = {
        progress: clampNumber(Number(queueJob.progress) || 0, 0, 100),
        phase: queueJob.phase || queueJob.status || 'pending',
        statusMessage: queueJob.status_message || null,
    };
    if (queueMetrics) {
        payload.queuePosition = queueMetrics.queuePosition;
        payload.queuedAhead = queueMetrics.queuedAhead;
        payload.queuedTotal = queueMetrics.queued;
        payload.runningTotal = queueMetrics.running;
        payload.workerConcurrency = queueMetrics.workerConcurrency;
    }
    return payload;
}

async function getGenerationQueueMetrics(jobId = null) {
    await ensureGenerationQueueSchema();
    const counts = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'running' AND kind = 'dream')::int AS running,
            COUNT(*) FILTER (WHERE status = 'queued' AND kind = 'dream')::int AS queued
         FROM generation_jobs`
    );
    const running = Number(counts.rows[0]?.running || 0);
    const queued = Number(counts.rows[0]?.queued || 0);
    let queuePosition = null;
    let queuedAhead = null;

    if (jobId) {
        const positionRes = await pool.query(
            `WITH target AS (
                SELECT created_at
                FROM generation_jobs
                WHERE id = $1
                  AND status = 'queued'
                  AND kind = 'dream'
             )
             SELECT COUNT(*)::int AS ahead
             FROM generation_jobs gj, target
             WHERE gj.status = 'queued'
               AND gj.kind = 'dream'
               AND target.created_at IS NOT NULL
               AND gj.created_at < target.created_at`,
            [jobId]
        );
        queuedAhead = Number.isFinite(Number(positionRes.rows[0]?.ahead))
            ? Number(positionRes.rows[0]?.ahead)
            : null;
        if (queuedAhead !== null) {
            queuePosition = queuedAhead + 1;
        }
    }

    return {
        running,
        queued,
        queuedAhead,
        queuePosition,
        workerConcurrency: GENERATION_JOB_CONCURRENCY,
        workerEnabled: GENERATION_WORKER_ENABLED,
    };
}

async function buildQueueProgressPayload(queueJob, jobId = null) {
    if (!queueJob) return {};
    const needsQueueMetrics = queueJob.status === 'queued'
        || queueJob.phase === 'queued'
        || Number(queueJob.progress || 0) <= 2;
    const queueMetrics = needsQueueMetrics ? await getGenerationQueueMetrics(jobId || queueJob.id) : null;
    return getQueueProgressPayload(queueJob, queueMetrics);
}

function scheduleGenerationWorker(delayMs = GENERATION_JOB_POLL_MS) {
    if (generationWorkerStopping) return;
    if (delayMs === 0) {
        if (generationWorkerTimer) {
            clearTimeout(generationWorkerTimer);
            generationWorkerTimer = null;
        }
        void drainGenerationQueue();
        return;
    }
    if (generationWorkerTimer) return;
    generationWorkerTimer = setTimeout(() => {
        generationWorkerTimer = null;
        void drainGenerationQueue();
    }, delayMs);
    generationWorkerTimer.unref?.();
}

async function getEffectiveGenerationConcurrency() {
    if (!GENERATION_BURST_CONCURRENCY) {
        return GENERATION_JOB_CONCURRENCY;
    }
    const metrics = await getGenerationQueueMetrics();
    const demand = metrics.running + metrics.queued;
    return Math.min(
        GENERATION_JOB_MAX_CONCURRENCY,
        Math.max(GENERATION_JOB_CONCURRENCY, demand)
    );
}

const genLogStore = new AsyncLocalStorage();
const GEN_LOG_MAX_LINES = 6000;
const GEN_LOG_MAX_BYTES = 1_200_000;
let genLogCaptureInstalled = false;

function installGenLogCapture() {
    if (genLogCaptureInstalled) return;
    genLogCaptureInstalled = true;
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            const store = genLogStore.getStore();
            if (!store || store.truncated || store.lines.length >= GEN_LOG_MAX_LINES) {
                if (store && store.lines.length >= GEN_LOG_MAX_LINES) store.truncated = true;
                return;
            }
            try {
                const body = args
                    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : inspect(a, { depth: 3, breakLength: 120 })))
                    .join(' ');
                const line = `${new Date().toISOString()} ${body}`;
                store.lines.push(line);
                store.bytes += line.length;
                if (store.bytes >= GEN_LOG_MAX_BYTES) {
                    store.lines.push('… [log truncated: size cap reached] …');
                    store.truncated = true;
                }
            } catch { /* never let logging break the job */ }
        };
    }
}
installGenLogCapture();

async function persistGenerationLog(jobId, logCtx) {
    try {
        if (!logCtx || !Array.isArray(logCtx.lines) || logCtx.lines.length === 0) return;
        await ensureGenerationQueueSchema();
        await pool.query('UPDATE generation_jobs SET log = $2 WHERE id = $1', [jobId, logCtx.lines.join('\n')]);
    } catch (error) {
        console.error(`[Generation Log] persist failed for ${jobId}:`, error?.message || error);
    }
}

async function runGenerationJob(job) {
    const runner = generationJobRunners.get(job.kind);
    if (!runner) {
        throw new Error(`No generation runner registered for job kind "${job.kind}"`);
    }

    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
    rememberPendingBoot(job.id, { status: 'running', userId: job.user_id });
    const __logCtx = { jobId: job.id, lines: [], bytes: 0, truncated: false };
    return genLogStore.run(__logCtx, async () => {
        console.log(`🏗️ [GEN QUEUE] Running ${job.kind} job ${job.id} attempt ${job.attempts}/${job.max_attempts}`);
        await assertJobNotCancelledShared(job.id, { force: true });

        const heartbeat = setInterval(() => {
            pool.query(
                `UPDATE generation_jobs
                 SET locked_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'running' AND locked_by = $2`,
                [job.id, GENERATION_WORKER_ID]
            ).catch((error) => console.warn(`[GEN QUEUE] Heartbeat failed for ${job.id}:`, error?.message || error));
        }, GENERATION_JOB_HEARTBEAT_MS);
        heartbeat.unref?.();

        try {
            await runner(job.id, job.prompt, payload);
            await assertJobNotCancelledShared(job.id, { force: true });

            const result = await pool.query('SELECT title, html_payload, game_url FROM ai_games WHERE id = $1', [job.id]);
            const row = result.rows[0];
            if (!row) {
                throw new Error('Generation finished without a draft row.');
            }
            if (row.title?.startsWith('CANCELLED:')) {
                await markGenerationJobCanceled(job.id);
                return;
            }
            if (row.title?.startsWith('ERROR:')) {
                throw new Error(row.title.replace('ERROR: ', '') || 'Generation failed');
            }
            if (!row.html_payload && !row.game_url) {
                throw new Error('Generation finished without html_payload or game_url.');
            }

            await markGenerationJobComplete(job.id);
            forgetPendingBoot(job.id);
        } finally {
            clearInterval(heartbeat);
            await persistGenerationLog(job.id, __logCtx);
        }
    });
}

async function drainGenerationQueue() {
    if (generationWorkerStopping || !GENERATION_WORKER_ENABLED) return;
    try {
        await recoverStaleGenerationJobs();
        const effectiveConcurrency = await getEffectiveGenerationConcurrency();
        while (!generationWorkerStopping && generationWorkerActiveCount < effectiveConcurrency) {
            const job = await claimGenerationJob();
            if (!job) break;
            generationWorkerActiveCount++;
            void (async () => {
                try {
                    await runGenerationJob(job);
                } catch (error) {
                    if (isCancellationError(error)) {
                        await markJobCanceled(job.id);
                        await markGenerationJobCanceled(job.id);
                    } else {
                        const message = error?.message || 'Generation failed';
                        console.error(`❌ [GEN QUEUE] Job ${job.id} failed:`, error);
                        try {
                            await markGenerationJobFailed(job, message);
                            if (Number(job.attempts || 0) >= Number(job.max_attempts || 1)) {
                                await markJobError(job.id, 'Generation failed', error);
                            }
                        } catch (markError) {
                            console.error(`❌ [GEN QUEUE] Failed to record job failure for ${job.id}:`, markError);
                            try {
                                await markJobError(job.id, 'Generation failed', markError);
                            } catch (fallbackError) {
                                console.error(`❌ [GEN QUEUE] Failed fallback error marker for ${job.id}:`, fallbackError);
                            }
                        }
                    }
                } finally {
                    forgetPendingBoot(job.id);
                    generationWorkerActiveCount--;
                    scheduleGenerationWorker(0);
                }
            })();
        }
    } catch (error) {
        console.error('[GEN QUEUE] Worker drain error:', error);
    } finally {
        if (!generationWorkerStopping) {
            scheduleGenerationWorker();
        }
    }
}

function startGenerationQueueWorker() {
    if (!GENERATION_WORKER_ENABLED) {
        console.log('[GEN QUEUE] Worker disabled on this replica (set GENERATION_WORKER_ENABLED=true on forge workers)');
        return;
    }
    void ensureGenerationQueueSchema()
        .then(() => {
            console.log(`🏗️ [GEN QUEUE] Hermes Worker ${GENERATION_WORKER_ID} ready with concurrency=${GENERATION_JOB_CONCURRENCY}`);
            scheduleGenerationWorker(0);
        })
        .catch((error) => {
            generationQueueReadyPromise = null;
            console.error('[GEN QUEUE] Failed to initialize:', error);
        });
}

function stopGenerationQueueWorker(signal) {
    generationWorkerStopping = true;
    if (generationWorkerTimer) {
        clearTimeout(generationWorkerTimer);
        generationWorkerTimer = null;
    }
    console.log(`🛑 [GEN QUEUE] Worker stopped (${signal || 'manual'})`);
}

function sanitizeMediaAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments
        .map((attachment) => {
            if (!attachment || typeof attachment !== 'object') return null;
            const url = String(attachment.url || '').trim();
            if (!url) return null;
            return {
                url,
                type: String(attachment.type || 'image/png'),
                role: String(attachment.role || 'reference'),
            };
        })
        .filter(Boolean);
}

async function getUserIdFromToken(token, invalidMessage = 'Expired session') {
    if (!token) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }
    const userRes = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userRes.rows.length === 0) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }
    return userRes.rows[0].id;
}

function extractHtmlTitle(html) {
    if (typeof html !== 'string') return 'GameTok Game';
    const match = html.match(/<title>([^<]+)<\/title>/i);
    return match ? match[1].trim() : 'GameTok Game';
}

/**
 * Executes a Dream job via the Hermes multi-model generation loop.
 */
async function executeDreamJob(jobId, prompt, mediaAttachments = [], jobPayload = {}) {
    const persistToDb = jobPayload?.persistToDb !== false;
    const orientation = normalizeOrientation(jobPayload?.orientation);
    const progressSink = typeof jobPayload?.onProgress === 'function' ? jobPayload.onProgress : null;

    const reportProgress = async (progress, phase, statusMessage) => {
        await assertJobNotCancelledShared(jobId);
        if (progressSink) {
            await progressSink({ jobId, progress, phase, statusMessage }).catch(() => {});
        }
        if (persistToDb) {
            await updateGenerationJobProgress(jobId, progress, phase, statusMessage).catch(() => {});
        }
    };

    const jobDir = path.join(GAMETOK_JOBS_ROOT, jobId);
    await fs.promises.mkdir(jobDir, { recursive: true });

    try {
        assertJobNotCancelled(jobId);
        console.log(`🧠 [HERMES DREAM JOB] Starting generation for: "${prompt}" (orientation: ${orientation})`);
        await reportProgress(10, 'starting', 'Hermes is initializing...');

        // 1. Run the Multi-Model Hermes Generation Loop
        await reportProgress(25, 'generating', 'DeepSeek & Qwen are designing your 3D game...');
        const finalGameState = await runGameTokGenerationLoop({
            prompt,
            orientation,
            attachments: mediaAttachments,
            maxAttempts: 5,
        }, orchestrator);

        let finalHtml = finalGameState.currentCode || '';
        if (!finalHtml || finalGameState.status === 'failed_needs_review') {
            throw new Error(`Generation failed to produce valid HTML (Status: ${finalGameState.status})`);
        }

        await reportProgress(75, 'verifying', 'Testing game in Hermes sandbox...');
        const verifyRes = await verifyGame(finalHtml, { orientation, timeoutMs: 12000 });
        if (!verifyRes.success && !verifyRes.bypassed) {
            console.warn(`⚠️ [HERMES DREAM JOB] Game sandbox had warnings/errors:`, verifyRes.crashes);
        }

        // 2. Save project files
        await fs.promises.writeFile(path.join(jobDir, 'index.html'), finalHtml, 'utf-8');

        // 3. Upload to Cloudflare R2
        await reportProgress(88, 'uploading', 'Deploying game to Cloudflare R2 CDN...');
        let publicGameUrl = null;
        try {
            publicGameUrl = await uploadGameFolderToR2(jobId, jobDir);
        } catch (uploadErr) {
            console.warn(`⚠️ [HERMES DREAM JOB] R2 upload failed, serving inline HTML:`, uploadErr.message);
        }

        const finalTitle = extractHtmlTitle(finalHtml) || (prompt ? prompt.slice(0, 40) : 'GameTok Game');

        if (!persistToDb) {
            await reportProgress(100, 'complete', 'Game ready!');
            forgetCancelledJob(jobId);
            return { jobId, title: finalTitle, html: finalHtml, gameUrl: publicGameUrl };
        }

        // 4. Save to Database
        assertJobNotCancelled(jobId);
        await pool.query(
            `UPDATE ai_games
             SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4, game_url = $5
             WHERE id = $6`,
            [finalTitle, finalHtml, finalHtml, null, publicGameUrl, jobId]
        );

        await recordGenerationTelemetry(jobId, {
            engine: 'hermes-r2',
            dimension: '3D',
            resultTitle: finalTitle,
            durationMs: Date.now() - (jobPayload?.startedAt || Date.now()),
        });

        await reportProgress(100, 'complete', 'Game ready!');
        forgetCancelledJob(jobId);

        pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
            .then((ownerRes) => notifyGameReady(ownerRes.rows[0]?.user_id, jobId, finalTitle))
            .catch((error) => console.log('[Notifications] Game ready notify error:', error));

        return { jobId, title: finalTitle, html: finalHtml, gameUrl: publicGameUrl };
    } catch (err) {
        if (isCancellationError(err)) {
            console.log(`🛑 [HERMES DREAM JOB] Canceled job ${jobId}.`);
            if (persistToDb) { await markJobCanceled(jobId); return; }
            throw err;
        }
        console.error("❌ [HERMES DREAM JOB] Error:", err);
        if (persistToDb) {
            await markJobError(jobId, 'Game generation failed', err);
            return;
        }
        throw err;
    }
}

// ── API Routes ──────────────────────────────────────────────────────────────

// ── NVIDIA Flux Image & Visual Direction Routes ─────────────────────────────

router.post('/generate-image', async (req, res) => {
    try {
        const { prompt, width = 1024, height = 1024, steps = 25, cfg_scale = 3.5 } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        console.log(`🎨 [NVIDIA Flux] Generating image for: "${prompt.slice(0, 80)}"`);
        const result = await generateAndUploadFluxImage({
            prompt,
            width,
            height,
            steps,
            cfg_scale,
            prefix: 'generated-images',
        });

        res.json({
            success: true,
            imageUrl: result.imageUrl,
            base64: result.base64,
            seed: result.seed,
            prompt,
        });
    } catch (err) {
        console.error('❌ [NVIDIA Flux] Image generation failed:', err.message);
        res.status(500).json({ error: err.message || 'Image generation failed' });
    }
});

router.post('/generate-asset', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const assetPrompt = `Isolated 2D game asset sprite, ${prompt}, colorful vibrant clean edges, video game item prop, high quality, dark neutral background, centered`;
        console.log(`🎮 [NVIDIA Flux] Generating game asset for: "${prompt}"`);
        const result = await generateAndUploadFluxImage({
            prompt: assetPrompt,
            steps: 25,
            prefix: 'forge/assets',
        });

        res.json({
            success: true,
            imageUrl: result.imageUrl,
            base64: result.base64,
            prompt,
        });
    } catch (err) {
        console.error('❌ [NVIDIA Flux] Asset generation failed:', err.message);
        res.status(500).json({ error: err.message || 'Asset generation failed' });
    }
});

router.post('/generate-visual-directions', async (req, res) => {
    try {
        const { prompt, gameTitle = 'Game' } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        console.log(`🌟 [Visual Directions] Generating concept art directions for "${prompt}"...`);

        // 4 distinct stylistic archetypes customized for the concept
        const archetypes = [
            {
                name: 'Neon Cyber',
                tagline: 'Fast & Electric',
                themeType: 'cyber',
                icon: 'flash',
                colors: ['#0A0017', '#7928CA', '#FF0080', '#00DFD8'],
                modifier: 'cyberpunk neon aesthetic, glowing ultraviolet and cyan lighting, sleek futuristic high-tech surfaces, octane render',
                instruction: 'Use an electric cyberpunk visual direction with glowing neon accents, high-contrast dark tones, and sleek futuristic UI elements.',
            },
            {
                name: 'Vibrant Arcade',
                tagline: 'Bold & Punchy',
                themeType: 'arcade',
                icon: 'game-controller',
                colors: ['#1A0B2E', '#9333EA', '#EC4899', '#FACC15'],
                modifier: 'vibrant 3D arcade video game concept art, candy-gloss materials, colorful lighting, clean readable forms, studio lighting',
                instruction: 'Use a bold retro-modern arcade art direction with saturated punchy colors, glossy materials, and clean readable shapes.',
            },
            {
                name: 'Epic Mythic',
                tagline: 'Mysterious & Grand',
                themeType: 'fantasy',
                icon: 'sparkles',
                colors: ['#0F172A', '#1E1B4B', '#0369A1', '#F59E0B'],
                modifier: 'epic mythical fantasy concept art, atmospheric golden volumetric lighting, cinematic scale, ancient mystical details, masterpiece',
                instruction: 'Use an epic fantasy visual direction with rich atmospheric depth, dramatic lighting, and intricate mythical details.',
            },
            {
                name: 'Minimal Clay',
                tagline: 'Clean & Stylized',
                themeType: 'nature',
                icon: 'shapes-outline',
                colors: ['#022C22', '#065F46', '#10B981', '#A7F3D0'],
                modifier: 'clean stylized low-poly 3D clay toy aesthetic, soft rim lighting, minimalist composition, smooth tactile textures, blender render',
                instruction: 'Use a clean stylized clay visual direction with smooth surfaces, charming proportions, and soft natural lighting.',
            },
        ];

        // Concurrently generate concept art for each archetype using NVIDIA Flux
        const directionPromises = archetypes.map(async (arch, index) => {
            const imagePrompt = `Video game concept art of ${prompt}, ${arch.modifier}, 1:1 square ratio, centered composition, high visual fidelity, concept artwork`;
            try {
                const fluxResult = await generateAndUploadFluxImage({
                    prompt: imagePrompt,
                    width: 1024,
                    height: 1024,
                    steps: 25,
                    cfg_scale: 3.5,
                    prefix: 'visual-directions',
                });
                return {
                    id: `direction-${Date.now()}-${index + 1}`,
                    name: arch.name,
                    tagline: arch.tagline,
                    description: `A stylized interpretation of ${prompt} featuring ${arch.tagline.toLowerCase()} visual energy.`,
                    icon: arch.icon,
                    colors: arch.colors,
                    instruction: arch.instruction,
                    themeType: arch.themeType,
                    imageUrl: fluxResult.imageUrl,
                };
            } catch (imgErr) {
                console.warn(`[Visual Directions] Flux generation failed for ${arch.name}:`, imgErr.message);
                return {
                    id: `direction-${Date.now()}-${index + 1}`,
                    name: arch.name,
                    tagline: arch.tagline,
                    description: `A stylized interpretation of ${prompt} featuring ${arch.tagline.toLowerCase()} visual energy.`,
                    icon: arch.icon,
                    colors: arch.colors,
                    instruction: arch.instruction,
                    themeType: arch.themeType,
                };
            }
        });

        const directions = await Promise.all(directionPromises);
        res.json({
            success: true,
            prompt,
            directions,
        });
    } catch (err) {
        console.error('❌ [Visual Directions] Generation error:', err.message);
        res.status(500).json({ error: err.message || 'Visual direction generation failed' });
    }
});

router.post('/dream', async (req, res) => {
    try {
        const { prompt, attachments, orientation: requestedOrientation } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const mediaAttachments = sanitizeMediaAttachments(attachments);
        const orientation = normalizeOrientation(requestedOrientation);

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });

        const existingJob = await findActiveDuplicateGenerationJob(userId, 'dream', prompt, orientation);
        if (existingJob) {
            console.log(`🧠 [DREAM ROUTE] Deduped to active job ${existingJob.id} (${existingJob.status}) for User[${userId}]`);
            return res.json({ success: true, jobId: existingJob.id, deduped: true });
        }

        console.log(`🧠 [DREAM ROUTE] Creating Hermes job for User[${userId}] -> Concept: "${prompt}" (${orientation})`);

        const jobId = randomUUID();
        await enqueueGenerationJob({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.dreamPending,
            kind: 'dream',
            payload: { mediaAttachments, orientation },
            allowDuplicate: true,
        });

        res.json({ success: true, jobId });
    } catch (outerError) {
        console.error("OUTER GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "System Error" });
    }
});

router.post('/edit', async (req, res) => {
    try {
        const { draftId, instructions } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        if (!draftId || !instructions) return res.status(400).json({ error: "draftId and instructions are required" });

        // Hermes interactive editing is currently scheduled for next iteration
        res.json({
            success: false,
            message: "Interactive game editing is being upgraded to Hermes multi-model architecture.",
            draftId
        });
    } catch (outerError) {
        console.error("OUTER EDIT ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "System Error" });
    }
});

router.post('/dream/cancel/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');

        const pendingBoot = pendingJobBoots.get(jobId);
        const existing = await pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId]);
        const ownerId = existing.rows[0]?.user_id || pendingBoot?.userId || null;

        if (!ownerId && !pendingBoot) {
            return res.status(404).json({ error: 'Job not found' });
        }
        if (ownerId && String(ownerId) !== String(userId)) {
            return res.status(403).json({ error: 'Not allowed to cancel this job' });
        }

        await markJobCanceled(jobId);
        res.json({ success: true, status: 'canceled', jobId });
    } catch (error) {
        console.error('[DREAM CANCEL] Error:', error);
        res.status(error.statusCode || error.status || 500).json({ error: error.message || 'Cancel failed' });
    }
});

router.get('/dream/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        await recoverStaleGenerationJobs();
        const ephemeralJob = pendingJobBoots.get(jobId);
        if (ephemeralJob?.status === 'canceled' || isJobCancelled(jobId)) {
            return res.json({ success: false, status: 'canceled', error: ephemeralJob?.error || 'Generation cancelled by user' });
        }

        const result = await pool.query('SELECT title, html_payload, raw_code, game_url, thumbnail, orientation, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [jobId]);
        if (result.rows.length === 0) {
            const pendingBoot = pendingJobBoots.get(jobId);
            if (pendingBoot?.status === 'error') {
                return res.json({ status: 'error', error: pendingBoot.error || 'Job startup failed' });
            }
            if (pendingBoot) {
                return res.json({ status: 'pending' });
            }
            const queueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
            const queueJob = queueRes.rows[0];
            if (queueJob?.status === 'failed') {
                return res.json({ status: 'error', error: queueJob.error || 'Generation failed', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            if (queueJob?.status === 'canceled') {
                return res.json({ success: false, status: 'canceled', error: queueJob.error || 'Generation cancelled', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            if (queueJob) {
                return res.json({ status: 'pending', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            return res.status(404).json({ error: 'Job not found' });
        }
        
        const row = result.rows[0];
        
        if ((!row.html_payload || row.html_payload === '') && !row.game_url) {
            if (row.title && row.title.startsWith('CANCELLED:')) {
                return res.json({ success: false, status: 'canceled', error: row.title.replace('CANCELLED: ', '') });
            }
            if (row.title && row.title.startsWith('ERROR:')) {
                return res.json({ status: 'error', error: row.title.replace('ERROR: ', '') });
            }
            const queueRes = await pool.query('SELECT status, error, progress, phase, status_message, updated_at FROM generation_jobs WHERE id = $1', [jobId]);
            const queueJob = queueRes.rows[0];
            if (queueJob?.status === 'failed') {
                return res.json({ status: 'error', error: queueJob.error || 'Generation failed', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            if (queueJob?.status === 'canceled') {
                return res.json({ success: false, status: 'canceled', error: queueJob.error || 'Generation cancelled', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            if (queueJob) {
                return res.json({ status: 'pending', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            return res.json({ status: 'pending' });
        }

        const completeQueueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
        const completeQueueJob = completeQueueRes.rows[0];
        
        return res.json({
            success: true,
            status: 'complete',
            draftId: jobId,
            title: row.title,
            htmlPreview: row.html_payload,
            gameUrl: row.game_url || null,
            thumbnail: row.thumbnail,
            orientation: normalizeOrientation(row.orientation),
            classification: getStoredDraftClassification(row),
            ...(await buildQueueProgressPayload(completeQueueJob || { progress: 100, phase: 'complete', status_message: 'Your game is ready.' }, jobId)),
        });

    } catch(e) { 
        res.status(500).json({ error: e.message }); 
    }
});

router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const drafts = await pool.query("SELECT id, title, prompt, thumbnail, orientation, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE user_id = $1 AND is_draft = true AND (html_payload != '' OR game_url IS NOT NULL) ORDER BY created_at DESC", [userId]);
        res.json({ drafts: drafts.rows });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const draft = await pool.query("SELECT id, title, prompt, html_payload, game_url, thumbnail, orientation, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userId]);
        if (draft.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json({ draft: draft.rows[0] });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.delete('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const deleted = await pool.query(
            "DELETE FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true RETURNING id, thumbnail",
            [req.params.id, userId]
        );
        if (deleted.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        await deleteCoverAsset(deleted.rows[0].thumbnail);
        res.json({ success: true, deletedId: deleted.rows[0].id });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.post('/publish/:draftId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');
        const { title, privacy, html, orientation, gameUrl, categories } = req.body || {};

        const checkRes = await pool.query("SELECT * FROM ai_games WHERE id = $1 AND user_id = $2", [req.params.draftId, userId]);
        
        let draft;
        if (checkRes.rows.length === 0) {
            if (!html) {
                return res.status(400).json({ error: 'HTML payload required for new games' });
            }
            
            console.log('[Publish] Creating new game:', title);
            const insertRes = await pool.query(
                `INSERT INTO ai_games (user_id, title, html_payload, prompt, raw_code, is_draft, privacy, orientation, game_url, created_at)
                 VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, NOW())
                 RETURNING *`,
                [
                    userId,
                    title?.trim() || 'Untitled Game',
                    html,
                    `Published: ${title?.trim() || 'Untitled Game'}`,
                    html,
                    privacy || 'public',
                    normalizeOrientation(orientation),
                    typeof gameUrl === 'string' && /^https:\/\//i.test(gameUrl) ? gameUrl : null,
                ]
            );
            draft = insertRes.rows[0];
        } else {
            const existing = checkRes.rows[0];
            if (existing.remixed_from) {
                const srcRes = await pool.query(
                    'SELECT html_payload, raw_code FROM ai_games WHERE id = $1',
                    [existing.remixed_from],
                );
                const src = srcRes.rows[0];
                if (src) {
                    const unchanged = (a, b) => String(a || '').trim() === String(b || '').trim();
                    if (unchanged(existing.html_payload, src.html_payload)
                        && unchanged(existing.raw_code, src.raw_code)) {
                        return res.status(400).json({
                            error: 'Make at least one change before publishing this remix.',
                            code: 'REMIX_UNCHANGED',
                        });
                    }
                }
            }

            console.log('[Publish] Updating existing draft:', req.params.draftId);
            if (title && title.trim()) {
                await pool.query("UPDATE ai_games SET title = $1 WHERE id = $2 AND user_id = $3", [title.trim().substring(0, 255), req.params.draftId, userId]);
            }

            const publishRes = await pool.query(
                "UPDATE ai_games SET is_draft = false, privacy = $3 WHERE id = $1 AND user_id = $2 RETURNING *", 
                [req.params.draftId, userId, privacy || 'public']
            );
            draft = publishRes.rows[0];
        }

        draft.categories = normalizeCategories(categories);
        const { globalId, classification } = await upsertPublishedAIGame({
            draftId: draft.id,
            userId,
            draft,
        });
        console.log('[Publish] Success! Game ID:', globalId);
        res.json({ success: true, gameId: globalId, classification });
    } catch (e) {
        console.error('[Publish] Error:', e);
        res.status(e.statusCode || 500).json({ error: e.message });
    }
});

router.post('/remix/:sourceId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');

        let src = null;
        let creatorName = null;

        const srcRes = await pool.query(
            "SELECT * FROM ai_games WHERE id::text LIKE $1 LIMIT 1",
            [String(req.params.sourceId) + '%'],
        );

        if (srcRes.rows.length > 0) {
            src = srcRes.rows[0];
            if (src.is_draft) return res.status(400).json({ error: 'You can only remix a published game' });
            if (src.privacy && src.privacy !== 'public') {
                return res.status(403).json({ error: 'The creator turned off remixing for this game' });
            }
            if (!src.html_payload) return res.status(400).json({ error: 'This game has no playable content to remix' });

            const creatorRes = await pool.query('SELECT username, display_name FROM users WHERE id = $1', [src.user_id]);
            creatorName = creatorRes.rows[0]?.username || creatorRes.rows[0]?.display_name || null;
        } else {
            // Check catalog games table
            const catRes = await pool.query(
                "SELECT * FROM games WHERE id = $1 LIMIT 1",
                [String(req.params.sourceId)]
            );
            if (catRes.rows.length === 0) return res.status(404).json({ error: 'Game not found' });

            const cat = catRes.rows[0];
            creatorName = cat.developer || 'GameTok';

            let htmlPayload = cat.html_payload || '';
            const baseUrl = cat.embed_url?.startsWith('http')
                ? cat.embed_url.substring(0, cat.embed_url.lastIndexOf('/') + 1)
                : `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/${cat.id}/`;

            if (!htmlPayload && cat.embed_url) {
                let fetchUrl = cat.embed_url;
                if (fetchUrl.startsWith('/')) {
                    fetchUrl = `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/${cat.id}/index.html`;
                }
                try {
                    const resp = await fetch(fetchUrl);
                    if (resp.ok) {
                        htmlPayload = await resp.text();
                    }
                } catch (fetchErr) {
                    console.warn(`[Remix] Failed to fetch HTML from ${fetchUrl}:`, fetchErr.message);
                }
            }

            // If still no HTML, check local filesystem in gametok-games
            if (!htmlPayload) {
                const localGamePath = path.resolve(__dirname, '../../../gametok-games', cat.id, 'index.html');
                if (fs.existsSync(localGamePath)) {
                    htmlPayload = fs.readFileSync(localGamePath, 'utf8');
                }
            }

            if (!htmlPayload) {
                return res.status(400).json({ error: 'This catalog game has no playable content to remix' });
            }

            // Inject base href so relative assets load from R2 CDN
            if (!htmlPayload.includes('<base ') && htmlPayload.includes('<head>')) {
                htmlPayload = htmlPayload.replace('<head>', `<head>\n<base href="${baseUrl}">`);
            }

            // Inline relative script (e.g. game.js, bundle.js) if found so the code is fully contained for AI editing
            const scriptMatch = htmlPayload.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/i);
            if (scriptMatch && !scriptMatch[1].startsWith('http') && !scriptMatch[1].startsWith('//')) {
                const scriptFile = scriptMatch[1];
                let scriptCode = '';
                const localScriptPath = path.resolve(__dirname, '../../../gametok-games', cat.id, scriptFile);
                if (fs.existsSync(localScriptPath)) {
                    scriptCode = fs.readFileSync(localScriptPath, 'utf8');
                } else {
                    try {
                        const sResp = await fetch(baseUrl + scriptFile);
                        if (sResp.ok) scriptCode = await sResp.text();
                    } catch (_) {}
                }
                if (scriptCode) {
                    htmlPayload = htmlPayload.replace(scriptMatch[0], `<script>\n${scriptCode}\n</script>`);
                }
            }

            src = {
                id: null,
                title: cat.name || cat.title || 'Game',
                prompt: `Remix of ${cat.name || 'Game'}`,
                html_payload: htmlPayload,
                raw_code: htmlPayload,
                thumbnail: cat.thumbnail || null,
                preview_video_url: cat.preview_video_url || null,
                category: cat.category || null,
                subcategory: cat.subcategory || null,
                primary_tab: cat.primary_tab || null,
                interaction_type: cat.interaction_type || null,
                classification_confidence: cat.classification_confidence || null,
                classification_tags: cat.classification_tags || [],
                discovery_chips: cat.discovery_chips || [],
                orientation: cat.orientation || 'portrait',
            };
        }

        const baseTitle = String(src.title || 'Game').replace(/^Remix of /i, '');
        const newTitle = `Remix of ${baseTitle}`.substring(0, 255);

        const insertRes = await pool.query(
            `INSERT INTO ai_games (
                user_id, prompt, title, html_payload, raw_code,
                thumbnail, preview_video_url, category, subcategory, primary_tab,
                interaction_type, classification_confidence, classification_tags,
                discovery_chips, privacy, is_draft, remixed_from, remixed_from_username, orientation, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17,$18,NOW())
             RETURNING id, title`,
            [
                userId,
                src.prompt || `Remix of ${baseTitle}`,
                newTitle,
                src.html_payload,
                src.raw_code || src.html_payload,
                src.thumbnail || null,
                src.preview_video_url || null,
                src.category || null,
                src.subcategory || null,
                src.primary_tab || null,
                src.interaction_type || null,
                src.classification_confidence || null,
                JSON.stringify(src.classification_tags || []),
                JSON.stringify(src.discovery_chips || []),
                'public',
                src.id || null,
                creatorName,
                normalizeOrientation(src.orientation),
            ],
        );
        const draft = insertRes.rows[0];
        console.log(`[Remix] ${userId} remixed ${req.params.sourceId} -> draft ${draft.id}`);
        res.json({ success: true, draftId: draft.id, title: draft.title, remixedFrom: creatorName });
    } catch (e) {
        console.error('[Remix] Error:', e);
        res.status(e.statusCode || 500).json({ error: e.message });
    }
});

const GT_PAUSE_SNIPPET = `<script>(function(){var paused=false;var queue=[];var originalRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=function(cb){if(paused){queue.push(cb);return -1;}return originalRAF(cb);};function setAudioMuted(m){document.querySelectorAll('audio,video').forEach(function(el){el.muted=m;if(m&&!el.paused)el.pause();});}window.addEventListener('message',function(e){if(!e.data||typeof e.data!=='object')return;if(e.data.type==='gt-pause'){paused=true;setAudioMuted(true);}if(e.data.type==='gt-resume'){if(!paused)return;paused=false;setAudioMuted(false);var q=queue.slice();queue.length=0;q.forEach(function(cb){try{originalRAF(cb);}catch(_){}});}});})();</script>`;

router.get('/play/:targetId', async (req, res) => {
    try {
        const game = await pool.query("SELECT html_payload, game_url FROM ai_games WHERE id::text LIKE $1 LIMIT 1", [req.params.targetId + '%']);
        if (game.rows.length === 0) return res.status(404).send("AI Game Block Missing / Erased");
        
        const row = game.rows[0];
        if (row.game_url) {
            return res.redirect(302, row.game_url);
        }

        res.setHeader('Content-Type', 'text/html');
        let html = row.html_payload;
        if (html.includes('<head>')) html = html.replace('<head>', '<head>' + GT_PAUSE_SNIPPET);
        else if (html.includes('<body>')) html = html.replace('<body>', '<body>' + GT_PAUSE_SNIPPET);
        else html = GT_PAUSE_SNIPPET + html;
        res.send(html);
    } catch(e) { res.status(500).send("Database extraction failed"); }
});

router.get('/admin/games', async (req, res) => {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    try {
        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const perPage = 48;
        const q = (req.query.q || '').toString().trim().slice(0, 100);
        const filter = ['draft', 'posted'].includes(req.query.filter) ? req.query.filter : 'all';
        const whereParams = [];
        const where = ["(html_payload != '' OR game_url IS NOT NULL)"];
        if (q) { whereParams.push('%' + q + '%'); where.push(`(prompt ILIKE $${whereParams.length} OR title ILIKE $${whereParams.length})`); }
        if (filter === 'draft') where.push('is_draft = true');
        if (filter === 'posted') where.push('is_draft = false');
        const whereSql = where.join(' AND ');
        const rows = (await pool.query(
            `SELECT id, title, prompt, game_url, thumbnail, orientation, created_at, is_draft, category FROM ai_games WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
            [...whereParams, perPage, page * perPage],
        )).rows;
        const total = (await pool.query(`SELECT count(*)::int AS c FROM ai_games WHERE ${whereSql}`, whereParams)).rows[0].c;
        const pages = Math.ceil(total / perPage);
        const qp = (over) => { const o = { q, filter: filter === 'all' ? '' : filter, page, ...over }; const s = Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return '?' + s; };
        const cards = rows.map((g) => {
            const id = esc(g.id);
            const thumb = g.thumbnail ? `<img loading="lazy" src="${esc(g.thumbnail)}" alt="">` : `<div class="noimg">🎮</div>`;
            const badge = g.is_draft ? `<span class="b draft">draft</span>` : `<span class="b posted">posted</span>`;
            const orient = g.orientation === 'landscape' ? `<span class="b land">landscape</span>` : '';
            const when = g.created_at ? new Date(g.created_at).toISOString().slice(0, 16).replace('T', ' ') : '';
            return `<div class="card" onclick="play('${id}')"><div class="thumb">${thumb}${badge}${orient}</div><div class="meta"><div class="title">${esc(g.title || 'Untitled')}</div><div class="prompt">${esc((g.prompt || '').slice(0, 120))}</div><div class="when">${esc(when)}${g.category ? ' · ' + esc(g.category) : ''}</div></div></div>`;
        }).join('');
        res.setHeader('Content-Type', 'text/html');
        res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameTok — all games</title><style>
:root{color-scheme:dark}body{margin:0;background:#0e0e14;color:#e6e6ee;font:14px/1.4 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;background:#15151f;border-bottom:1px solid #262636;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:5}
header h1{font-size:16px;margin:0;font-weight:700}.count{color:#8b8ba7;font-size:13px;font-weight:400}
form{display:flex;gap:8px;flex:1;min-width:200px}input[type=search]{flex:1;background:#0e0e14;border:1px solid #2c2c40;color:#e6e6ee;border-radius:8px;padding:8px 10px}
.tabs a{color:#9a9ab8;text-decoration:none;padding:6px 10px;border-radius:8px}.tabs a.on{background:#2a2a44;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:16px}
.card{background:#181824;border:1px solid #262636;border-radius:12px;overflow:hidden;cursor:pointer;transition:.12s}
.card:hover{border-color:#5b5bff;transform:translateY(-2px)}
.thumb{position:relative;aspect-ratio:9/16;background:#0a0a12;display:flex;align-items:center;justify-content:center}
.thumb img{width:100%;height:100%;object-fit:cover}.noimg{font-size:32px;opacity:.4}
.b{position:absolute;top:6px;left:6px;font-size:10px;padding:2px 6px;border-radius:6px;font-weight:700}
.b.draft{background:#7c3f00;color:#ffd8a8}.b.posted{background:#0d5f3a;color:#a8ffcf}
.b.land{left:auto;right:6px;background:#2a2a6b;color:#c7c7ff}
.meta{padding:8px}.title{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prompt{color:#9a9ab8;font-size:11px;margin-top:3px;height:28px;overflow:hidden}.when{color:#61617a;font-size:10px;margin-top:4px}
.pager{display:flex;gap:8px;justify-content:center;align-items:center;padding:20px}.pager a{color:#e6e6ee;background:#20203099;border:1px solid #2c2c40;padding:8px 14px;border-radius:8px;text-decoration:none}
.modal{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center;z-index:10}.modal.on{display:flex}
.frame{position:relative;width:min(420px,96vw);height:min(90vh,860px);background:#000;border-radius:16px;overflow:hidden}
.frame iframe{width:100%;height:100%;border:0}.close{position:absolute;top:8px;right:8px;z-index:2;background:#000a;color:#fff;border:0;width:34px;height:34px;border-radius:50%;font-size:20px;cursor:pointer}
</style></head><body>
<header><h1>🎮 All games <span class="count">${total.toLocaleString()} total</span></h1>
<form method="get"><input type="search" name="q" placeholder="search prompt / title…" value="${esc(q)}">${filter !== 'all' ? `<input type="hidden" name="filter" value="${esc(filter)}">` : ''}</form>
<div class="tabs"><a href="${qp({ filter: '', page: 0 })}" class="${filter === 'all' ? 'on' : ''}">All</a><a href="${qp({ filter: 'posted', page: 0 })}" class="${filter === 'posted' ? 'on' : ''}">Posted</a><a href="${qp({ filter: 'draft', page: 0 })}" class="${filter === 'draft' ? 'on' : ''}">Drafts</a></div></header>
<div class="grid">${cards || '<p style="padding:24px;color:#8b8ba7">No games found.</p>'}</div>
<div class="pager">${page > 0 ? `<a href="${qp({ page: page - 1 })}">← Prev</a>` : ''}<span style="color:#61617a">Page ${page + 1} / ${Math.max(1, pages)}</span>${page + 1 < pages ? `<a href="${qp({ page: page + 1 })}">Next →</a>` : ''}</div>
<div class="modal" id="m" onclick="if(event.target.id==='m')closeM()"><div class="frame"><button class="close" onclick="closeM()">×</button><iframe id="f"></iframe></div></div>
<script>function play(id){document.getElementById('f').src='/api/ai/play/'+id;document.getElementById('m').classList.add('on')}function closeM(){document.getElementById('m').classList.remove('on');document.getElementById('f').src='about:blank'}document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()})</script>
</body></html>`);
    } catch (e) { res.status(500).send('gallery error: ' + esc(e && e.message || e)); }
});

router.post('/admin/rebuild-assets', async (req, res) => {
    res.json({ status: "ok", msg: "Asset rebuild route active" });
});

router.get('/admin/assets/diagnostics', async (req, res) => {
    res.json({ status: "active", orchestrator: "hermes", version: "2.0" });
});

router.get('/admin/backfill-thumbnails', async (req, res) => {
    try {
        res.json({ status: "bg-process-started", msg: "Taking screenshots of AI games in the background." });
        const { exec } = await import('child_process');
        exec('node scripts/backfill-thumbnails.js', (err, stdout, stderr) => {
            if (err) console.error("Backfill failed:", err);
            if (stdout) console.log("Backfill Log:", stdout);
            if (stderr) console.error("Backfill Error:", stderr);
        });
    } catch(e) {
        console.error("Backfill Trigger Error:", e);
    }
});

router.get('/admin/backfill-preview-videos', async (req, res) => {
    res.status(410).json({ error: 'Preview video backfill is disabled.' });
});

router.get('/admin/backfill-classifications', async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
        const draftId = req.query.draftId ? String(req.query.draftId) : null;

        const params = [];
        let whereClause = "WHERE is_draft = false AND (html_payload != '' OR game_url IS NOT NULL)";
        if (draftId) {
            params.push(draftId);
            whereClause += ` AND id = $${params.length}`;
        }
        params.push(limit);

        const draftsRes = await pool.query(
            `SELECT id, user_id, title, prompt, html_payload, game_url, thumbnail, preview_video_url
             FROM ai_games
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length}`,
            params
        );

        if (!draftsRes.rows.length) {
            return res.json({ success: true, count: 0, updated: [] });
        }

        const updated = [];
        for (const draft of draftsRes.rows) {
            const { globalId, classification } = await upsertPublishedAIGame({
                draftId: draft.id,
                userId: draft.user_id,
                draft,
            });
            updated.push({
                draftId: draft.id,
                gameId: globalId,
                title: draft.title,
                classification,
            });
        }

        res.json({ success: true, count: updated.length, updated });
    } catch (e) {
        res.status(e.statusCode || 500).json({ error: e.message });
    }
});

generationJobRunners.set('dream', (jobId, prompt, payload = {}) => (
    executeDreamJob(jobId, prompt, payload.mediaAttachments || [], payload)
));

export {
    executeDreamJob,
    upsertPublishedAIGame,
    createPendingJob,
    startGenerationQueueWorker,
    stopGenerationQueueWorker,
};

export default router;
