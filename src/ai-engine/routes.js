import express from 'express';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { notifyGameFailed, notifyGameReady } from '../notifications.js';
import { deleteCoverAsset, enqueueCoverGeneration } from '../cover-art.js';
import { runRealOpenGameBuild } from './real-opengame-runner.js';
import { verifyGame } from './sandbox.js';
import { maskNvidiaKey, nextNvidiaTextApiKey } from './nvidia-key-pool.js';

const router = express.Router();

const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const OPENGAME_JOB_ROOT = process.env.OPENGAME_JOB_ROOT || path.join(STORAGE_ROOT, 'opengame-jobs');
const GENERATION_WORKER_ID = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;
const GENERATION_JOB_CONCURRENCY = Math.max(1, Number(process.env.GENERATION_JOB_CONCURRENCY || 1));
const GENERATION_JOB_POLL_MS = Math.max(1000, Number(process.env.GENERATION_JOB_POLL_MS || 3000));
const GENERATION_JOB_MAX_ATTEMPTS = Math.max(1, Number(process.env.GENERATION_JOB_MAX_ATTEMPTS || 1));
const GENERATION_JOB_STALE_MINUTES = Math.max(2, Number(process.env.GENERATION_JOB_STALE_MINUTES || 2));
const GENERATION_JOB_HEARTBEAT_MS = Math.max(15000, Number(process.env.GENERATION_JOB_HEARTBEAT_MS || 30000));
const GENERATION_JOB_RETRY_DELAY_MS = Math.max(5000, Number(process.env.GENERATION_JOB_RETRY_DELAY_MS || 30000));
const SPEC_MODEL = process.env.OPENGAME_SPEC_MODEL || process.env.DREAMSTREAM_NARRATIVE_MODEL || 'meta/llama-3.3-70b-instruct';

export function resolveMakerRuntime(env = process.env) {
    const value = String(env.MAKER_RUNTIME || env.GAMETOK_MAKER_RUNTIME || 'gametok').trim().toLowerCase();
    if (value === 'opengame' || value === 'open-game') return 'opengame';
    return 'gametok';
}

let gametokDreamJobLoader = null;
async function loadGametokDreamJob() {
    if (!gametokDreamJobLoader) {
        gametokDreamJobLoader = import('./gametok-maker-pipeline.js').then((mod) => mod.executeGametokDreamJob);
    }
    return gametokDreamJobLoader;
}

const pendingJobBoots = new Map();
const cancelledJobs = new Map();
const generationJobRunners = new Map();
let generationWorkerTimer = null;
let generationWorkerStopping = false;
let generationWorkerActiveCount = 0;

class GenerationCancelledError extends Error {
    constructor(jobId) {
        super('Generation cancelled by user');
        this.name = 'GenerationCancelledError';
        this.code = 'GENERATION_CANCELLED';
        this.jobId = jobId;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createNvidiaTextClient(apiKey = nextNvidiaTextApiKey()) {
    return new OpenAI({
        baseURL: process.env.OPENGAME_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        apiKey: apiKey || 'missing-key',
        timeout: Number(process.env.NVIDIA_API_TIMEOUT_MS || 120000),
    });
}

function extractText(response) {
    return response?.choices?.[0]?.message?.content || '';
}

function extractJson(text = '') {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end >= start) return text.slice(start, end + 1);
    return text;
}

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (!value) return fallback;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function sanitizeMediaAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments
        .filter((item) => item && typeof item === 'object')
        .slice(0, 8)
        .map((item) => ({
            type: String(item.type || 'image').slice(0, 32),
            role: String(item.role || 'reference').slice(0, 64),
            url: typeof item.url === 'string' ? item.url.slice(0, 4000) : null,
            name: typeof item.name === 'string' ? item.name.slice(0, 255) : null,
        }));
}

function rememberPendingBoot(jobId, update) {
    pendingJobBoots.set(jobId, {
        ...(pendingJobBoots.get(jobId) || {}),
        ...update,
        updatedAt: Date.now(),
    });
}

function forgetPendingBoot(jobId) {
    pendingJobBoots.delete(jobId);
}

function rememberCancelledJob(jobId) {
    cancelledJobs.set(jobId, Date.now());
    rememberPendingBoot(jobId, { status: 'canceled' });
}

function forgetCancelledJob(jobId) {
    cancelledJobs.delete(jobId);
}

function isJobCancelled(jobId) {
    return cancelledJobs.has(jobId) || pendingJobBoots.get(jobId)?.status === 'canceled';
}

function isCancellationError(error) {
    return error?.code === 'GENERATION_CANCELLED' || error?.name === 'GenerationCancelledError';
}

function assertJobNotCancelled(jobId) {
    if (isJobCancelled(jobId)) throw new GenerationCancelledError(jobId);
}

async function assertJobNotCancelledShared(jobId) {
    if (isJobCancelled(jobId)) throw new GenerationCancelledError(jobId);
    const result = await pool.query(
        `SELECT title FROM ai_games WHERE id = $1 AND title LIKE 'CANCELLED:%'`,
        [jobId]
    );
    if (result.rows.length > 0) {
        rememberCancelledJob(jobId);
        throw new GenerationCancelledError(jobId);
    }
}

async function getUserIdFromToken(token, invalidMessage = 'Expired session') {
    if (!token) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }
    const startedAt = Date.now();
    const userResult = await withTimeout(pool.query('SELECT id FROM users WHERE token = $1', [token]), 12000, 'Auth lookup');
    console.log(`⏱️ [AI AUTH] Token lookup completed in ${Date.now() - startedAt}ms`);
    if (userResult.rows.length === 0) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }
    return userResult.rows[0].id;
}

function extractHtmlTitle(html = '') {
    const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = match?.[1]?.replace(/\s+/g, ' ').trim();
    return title || null;
}

function inferClassification({ title = '', prompt = '' } = {}) {
    const text = `${title} ${prompt}`.toLowerCase();
    let category = 'arcade';
    let primaryTab = 'Games';
    let interactionType = 'tap';
    const tags = [];

    if (/story|choice|dialogue|narrative|visual novel/.test(text)) {
        category = 'story';
        primaryTab = 'Stories';
        interactionType = 'choice';
        tags.push('story');
    } else if (/race|drift|car|bike/.test(text)) {
        category = 'racing';
        interactionType = 'swipe';
        tags.push('racing');
    } else if (/puzzle|match|tile|logic/.test(text)) {
        category = 'puzzle';
        interactionType = 'tap';
        tags.push('puzzle');
    } else if (/shoot|battle|combat|enemy|survive|boss|slice|cut/.test(text)) {
        category = 'action';
        interactionType = /slice|cut|swipe/.test(text) ? 'swipe' : 'tap';
        tags.push('action');
    }

    return {
        category,
        subcategory: category,
        primaryTab,
        interactionType,
        confidence: 0.72,
        tags: [...new Set(tags.length ? tags : [category])],
        discoveryChips: [...new Set([category, interactionType])],
    };
}

function getStoredDraftClassification(draft = {}) {
    if (!draft.category && !draft.primary_tab) return null;
    return {
        category: draft.category || 'arcade',
        subcategory: draft.subcategory || draft.category || 'arcade',
        primaryTab: draft.primary_tab || 'Games',
        interactionType: draft.interaction_type || 'tap',
        confidence: Number(draft.classification_confidence || 0.7),
        tags: parseJsonArray(draft.classification_tags, [draft.category || 'arcade']),
        discoveryChips: parseJsonArray(draft.discovery_chips, [draft.category || 'arcade']),
    };
}

async function classifyAndStoreDraft({ draftId, title, prompt, htmlPayload }) {
    const classification = inferClassification({ title, prompt, htmlPayload });
    await pool.query(
        `UPDATE ai_games
         SET category = $1,
             subcategory = $2,
             primary_tab = $3,
             interaction_type = $4,
             classification_confidence = $5,
             classification_tags = $6,
             discovery_chips = $7
         WHERE id = $8`,
        [
            classification.category,
            classification.subcategory,
            classification.primaryTab,
            classification.interactionType,
            classification.confidence,
            JSON.stringify(classification.tags),
            JSON.stringify(classification.discoveryChips),
            draftId,
        ]
    );
    return classification;
}

async function upsertPublishedAIGame({ draftId, userId, draft, forceRefreshClassification = false }) {
    const globalId = `gm-ai-${String(draftId).substring(0, 8)}`;
    const classification = !forceRefreshClassification && getStoredDraftClassification(draft)
        ? getStoredDraftClassification(draft)
        : await classifyAndStoreDraft({
            draftId,
            title: draft.title,
            prompt: draft.prompt,
            htmlPayload: draft.html_payload,
        });

    await pool.query(
        `INSERT INTO games
         (id, name, description, icon, color, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips, developer, embed_url, thumbnail, preview_video_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory,
            primary_tab = EXCLUDED.primary_tab,
            interaction_type = EXCLUDED.interaction_type,
            classification_confidence = EXCLUDED.classification_confidence,
            classification_tags = EXCLUDED.classification_tags,
            discovery_chips = EXCLUDED.discovery_chips,
            developer = EXCLUDED.developer,
            thumbnail = EXCLUDED.thumbnail,
            preview_video_url = EXCLUDED.preview_video_url`,
        [
            globalId,
            draft.title || 'Untitled Game',
            `OpenGame AI Creation: ${draft.prompt || ''}`.slice(0, 1000),
            '✨',
            '#050505',
            classification.category,
            classification.subcategory,
            classification.primaryTab,
            classification.interactionType,
            classification.confidence,
            JSON.stringify(classification.tags),
            JSON.stringify(classification.discoveryChips),
            userId,
            `/api/ai/play/${draftId}`,
            draft.thumbnail || null,
            draft.preview_video_url || null,
        ]
    );

    enqueueCoverGeneration(pool, {
        draftId,
        gameId: globalId,
        title: draft.title,
        prompt: draft.prompt,
        classification,
    });

    return { globalId, classification };
}

async function ensureGenerationQueueSchema() {
    await pool.query(`
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
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS phase VARCHAR(64) DEFAULT 'queued';
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS status_message TEXT;
        ALTER TABLE generation_jobs ALTER COLUMN max_attempts SET DEFAULT 1;
    `);
}

async function createPendingJob(userId, prompt, title, jobId = randomUUID()) {
    await pool.query(
        `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
         VALUES ($1, $2, $3, $4, '', '', true)
         ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            prompt = EXCLUDED.prompt,
            title = EXCLUDED.title,
            html_payload = '',
            raw_code = '',
            is_draft = true`,
        [jobId, userId, prompt, title]
    );
    rememberPendingBoot(jobId, { status: 'pending', userId });
    return jobId;
}

async function enqueueGenerationJob({ jobId, userId, prompt, title, kind = 'dream', payload = {}, maxAttempts = GENERATION_JOB_MAX_ATTEMPTS }) {
    await ensureGenerationQueueSchema();
    await createPendingJob(userId, prompt, title, jobId);
    await pool.query(
        `INSERT INTO generation_jobs (id, user_id, kind, status, prompt, payload, attempts, max_attempts, progress, phase, status_message, run_after)
         VALUES ($1, $2, $3, 'queued', $4, $5::jsonb, 0, $6, 0, 'queued', 'Queued for OpenGame...', NOW())
         ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            kind = EXCLUDED.kind,
            status = 'queued',
            prompt = EXCLUDED.prompt,
            payload = EXCLUDED.payload,
            attempts = 0,
            max_attempts = EXCLUDED.max_attempts,
            progress = 0,
            phase = 'queued',
            status_message = 'Queued for OpenGame...',
            error = NULL,
            run_after = NOW(),
            updated_at = NOW(),
            completed_at = NULL,
            canceled_at = NULL`,
        [jobId, userId, kind, prompt, JSON.stringify(payload || {}), maxAttempts]
    );
    scheduleGenerationWorker(0);
}

async function updateGenerationJobProgress(jobId, progress, phase, statusMessage) {
    await ensureGenerationQueueSchema();
    await pool.query(
        `UPDATE generation_jobs
         SET progress = $2,
             phase = $3,
             status_message = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, Math.max(0, Math.min(100, Math.round(progress))), phase, statusMessage]
    );
}

async function claimGenerationJob() {
    const result = await pool.query(
        `UPDATE generation_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_by = $1,
             locked_at = NOW(),
             updated_at = NOW(),
             progress = GREATEST(progress, 2),
             phase = 'running',
             status_message = 'OpenGame worker is starting...'
         WHERE id = (
             SELECT id FROM generation_jobs
             WHERE status = 'queued'
               AND kind = 'dream'
               AND run_after <= NOW()
               AND attempts < max_attempts
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         RETURNING *`,
        [GENERATION_WORKER_ID]
    );
    return result.rows[0] || null;
}

async function recoverStaleGenerationJobs() {
    await ensureGenerationQueueSchema();
    await pool.query(
        `UPDATE generation_jobs
         SET status = 'queued',
             locked_by = NULL,
             locked_at = NULL,
             run_after = NOW() + ($2 || ' milliseconds')::interval,
             error = COALESCE(error, 'Recovered stale OpenGame worker lock'),
             updated_at = NOW()
         WHERE status = 'running'
           AND locked_at < NOW() - ($1 || ' minutes')::interval
           AND attempts < max_attempts`,
        [GENERATION_JOB_STALE_MINUTES, GENERATION_JOB_RETRY_DELAY_MS]
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
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [jobId]
    );
}

async function markGenerationJobFailed(job, errorMessage) {
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.max_attempts || 1);
    if (attempts < maxAttempts) {
        await pool.query(
            `UPDATE generation_jobs
             SET status = 'queued',
                 locked_by = NULL,
                 locked_at = NULL,
                 error = $2,
                 run_after = NOW() + ($3 || ' milliseconds')::interval,
                 updated_at = NOW()
             WHERE id = $1`,
            [job.id, errorMessage, GENERATION_JOB_RETRY_DELAY_MS]
        );
        return;
    }
    await pool.query(
        `UPDATE generation_jobs
         SET status = 'failed',
             error = $2,
             phase = 'error',
             status_message = $2,
             locked_by = NULL,
             locked_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [job.id, errorMessage]
    );
}

async function markGenerationJobCanceled(jobId) {
    await pool.query(
        `UPDATE generation_jobs
         SET status = 'canceled',
             phase = 'canceled',
             status_message = 'Generation cancelled.',
             locked_by = NULL,
             locked_at = NULL,
             canceled_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [jobId]
    );
}

async function markJobError(jobId, fallbackMessage, err) {
    const message = err?.message || String(err || fallbackMessage);
    await pool.query(
        `UPDATE ai_games SET title = $1, html_payload = '', raw_code = '' WHERE id = $2`,
        [`ERROR: ${message}`.slice(0, 255), jobId]
    );
    forgetPendingBoot(jobId);
    pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
        .then((ownerRes) => notifyGameFailed(ownerRes.rows[0]?.user_id, jobId, message))
        .catch((error) => console.log('[Notifications] Game failed notify error:', error));
}

async function markJobCanceled(jobId) {
    rememberCancelledJob(jobId);
    await pool.query(
        `UPDATE ai_games SET title = $1, html_payload = '', raw_code = '' WHERE id = $2`,
        ['CANCELLED: Generation cancelled by user', jobId]
    );
}

function getQueueProgressPayload(queueJob) {
    if (!queueJob) return {};
    return {
        progress: Math.max(0, Math.min(100, Number(queueJob.progress) || 0)),
        phase: queueJob.phase || queueJob.status || 'pending',
        statusMessage: queueJob.status_message || null,
    };
}

async function executeOpenGameDreamJob(jobId, prompt, mediaAttachments = [], jobPayload = {}) {
    const persistToDb = jobPayload?.persistToDb !== false;
    const progressSink = typeof jobPayload?.onProgress === 'function' ? jobPayload.onProgress : null;
    const reportProgress = async (progress, phase, statusMessage) => {
        await assertJobNotCancelledShared(jobId);
        if (progressSink) {
            await progressSink({ jobId, progress, phase, statusMessage }).catch((error) => {
                console.warn(`[OpenGame Job] Progress sink failed for ${jobId}:`, error?.message || error);
            });
        }
        if (persistToDb) await updateGenerationJobProgress(jobId, progress, phase, statusMessage);
    };

    const workspace = path.join(OPENGAME_JOB_ROOT, jobId);
    try {
        assertJobNotCancelled(jobId);
        await fs.promises.rm(workspace, { recursive: true, force: true });
        await fs.promises.mkdir(path.join(workspace, 'artifact'), { recursive: true });
        await fs.promises.writeFile(
            path.join(workspace, 'request.json'),
            JSON.stringify({ jobId, prompt, mediaAttachments, startedAt: new Date().toISOString() }, null, 2),
            'utf8'
        );

        console.log(`🎮 [OpenGame Job] Started ${jobId}`);
        console.log(`📁 [OpenGame Workspace] ${workspace}`);
        await reportProgress(8, 'opengame_start', 'Starting OpenGame...');

        const build = await runRealOpenGameBuild({
            jobId,
            prompt,
            workspace,
            shouldCancel: async () => {
                await assertJobNotCancelledShared(jobId);
                return false;
            },
        });

        await reportProgress(78, 'verify', 'Checking the game boots...');
        const sandboxRes = await verifyGame(build.html);
        if (!sandboxRes.success && Array.isArray(sandboxRes.crashes) && sandboxRes.crashes.length > 0) {
            throw new Error(`OpenGame output failed sandbox: ${sandboxRes.crashes[0]}`);
        }
        console.log('✅ [OpenGame Sandbox] Zero crashes detected.');

        const finalTitle = (extractHtmlTitle(build.html) || 'OpenGame Creation').substring(0, 255);
        const classification = inferClassification({ title: finalTitle, prompt });

        await fs.promises.writeFile(path.join(workspace, 'artifact/index.html'), build.html, 'utf8');
        await fs.promises.writeFile(
            path.join(workspace, 'opengame-build-report.json'),
            JSON.stringify({
                version: 1,
                engine: 'real-opengame-cli',
                status: 'complete',
                jobId,
                title: finalTitle,
                workspace,
                projectRoot: build.projectRoot,
                distIndex: build.distIndex,
                model: build.model,
                sandbox: { success: sandboxRes.success, crashes: sandboxRes.crashes || [] },
                completedAt: new Date().toISOString(),
            }, null, 2),
            'utf8'
        );

        if (!persistToDb) {
            forgetCancelledJob(jobId);
            return {
                jobId,
                title: finalTitle,
                html: build.html,
                rawHtml: build.rawHtml,
                screenshot: sandboxRes.screenshot || null,
                workspace,
                artifactPath: path.join(workspace, 'artifact/index.html'),
                reportPath: path.join(workspace, 'opengame-build-report.json'),
                buildMode: build.buildMode,
                sandbox: sandboxRes,
            };
        }

        await reportProgress(94, 'save', 'Saving your game...');
        await pool.query(
            `UPDATE ai_games
             SET title = $1,
                 html_payload = $2,
                 raw_code = $3,
                 artist_code = $4,
                 thumbnail = $5,
                 preview_video_url = $6,
                 category = $7,
                 subcategory = $8,
                 primary_tab = $9,
                 interaction_type = $10,
                 classification_confidence = $11,
                 classification_tags = $12,
                 discovery_chips = $13
             WHERE id = $14`,
            [
                finalTitle,
                build.html,
                build.rawHtml,
                null,
                sandboxRes.screenshot || null,
                null,
                classification.category,
                classification.subcategory,
                classification.primaryTab,
                classification.interactionType,
                classification.confidence,
                JSON.stringify(classification.tags),
                JSON.stringify(classification.discoveryChips),
                jobId,
            ]
        );

        forgetCancelledJob(jobId);
        console.log(`✅ [OpenGame Job] Complete! "${finalTitle}" saved for job ${jobId} [${classification.primaryTab}/${classification.category}]`);
        pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
            .then((ownerRes) => notifyGameReady(ownerRes.rows[0]?.user_id, jobId, finalTitle))
            .catch((error) => console.log('[Notifications] Game ready notify error:', error));
        return { jobId, title: finalTitle, html: build.html, rawHtml: build.rawHtml, screenshot: sandboxRes.screenshot || null, workspace };
    } catch (error) {
        if (isCancellationError(error)) {
            console.log(`🛑 [OpenGame Job] Canceled ${jobId}.`);
            if (persistToDb) await markJobCanceled(jobId);
            else throw error;
            return;
        }
        console.error('❌ [OpenGame Job] Error:', error);
        if (persistToDb) await markJobError(jobId, 'OpenGame generation failed', error);
        else throw error;
    }
}

async function executeDreamJob(jobId, prompt, mediaAttachments = [], jobPayload = {}) {
    const runtime = resolveMakerRuntime();
    if (runtime === 'opengame') {
        return executeOpenGameDreamJob(jobId, prompt, mediaAttachments, jobPayload);
    }
    console.log(`🛠️ [Maker Runtime] Using GameTok maker pipeline for ${jobId}`);
    const executeGametokDreamJob = await loadGametokDreamJob();
    return executeGametokDreamJob(jobId, prompt, mediaAttachments, jobPayload);
}

async function runGenerationJob(job) {
    const runner = generationJobRunners.get(job.kind);
    if (!runner) throw new Error(`No generation runner registered for job kind "${job.kind}"`);
    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
    rememberPendingBoot(job.id, { status: 'running', userId: job.user_id });
    console.log(`🏗️ [GEN QUEUE] Running ${job.kind} job ${job.id} attempt ${job.attempts}/${job.max_attempts}`);
    await assertJobNotCancelledShared(job.id);

    const heartbeat = setInterval(() => {
        pool.query(
            `UPDATE generation_jobs SET locked_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'running' AND locked_by = $2`,
            [job.id, GENERATION_WORKER_ID]
        ).catch((error) => console.warn(`[GEN QUEUE] Heartbeat failed for ${job.id}:`, error?.message || error));
    }, GENERATION_JOB_HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
        await runner(job.id, job.prompt, payload);
        await assertJobNotCancelledShared(job.id);
        const result = await pool.query('SELECT title, html_payload FROM ai_games WHERE id = $1', [job.id]);
        const row = result.rows[0];
        if (!row) throw new Error('Generation finished without a draft row.');
        if (row.title?.startsWith('CANCELLED:')) {
            await markGenerationJobCanceled(job.id);
            return;
        }
        if (row.title?.startsWith('ERROR:')) throw new Error(row.title.replace('ERROR: ', '') || 'Generation failed');
        if (!row.html_payload) throw new Error('Generation finished without html_payload.');
        await markGenerationJobComplete(job.id);
        forgetPendingBoot(job.id);
    } finally {
        clearInterval(heartbeat);
    }
}

async function drainGenerationQueue() {
    if (generationWorkerStopping) return;
    try {
        await recoverStaleGenerationJobs();
        while (!generationWorkerStopping && generationWorkerActiveCount < GENERATION_JOB_CONCURRENCY) {
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
                        await markGenerationJobFailed(job, message).catch((markError) => {
                            console.error(`❌ [GEN QUEUE] Failed to record job failure for ${job.id}:`, markError);
                        });
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
        if (!generationWorkerStopping) scheduleGenerationWorker();
    }
}

function scheduleGenerationWorker(delayMs = GENERATION_JOB_POLL_MS) {
    if (generationWorkerStopping || generationWorkerTimer) return;
    generationWorkerTimer = setTimeout(() => {
        generationWorkerTimer = null;
        void drainGenerationQueue();
    }, delayMs);
    generationWorkerTimer.unref?.();
}

function startGenerationQueueWorker() {
    void ensureGenerationQueueSchema()
        .then(() => {
            console.log(`🏗️ [GEN QUEUE] Worker ${GENERATION_WORKER_ID} ready with concurrency ${GENERATION_JOB_CONCURRENCY}`);
            scheduleGenerationWorker(0);
        })
        .catch((error) => {
            console.error('[GEN QUEUE] Failed to initialize:', error);
        });
}

function stopGenerationQueueWorker(signal) {
    generationWorkerStopping = true;
    if (generationWorkerTimer) {
        clearTimeout(generationWorkerTimer);
        generationWorkerTimer = null;
    }
    console.log(`🛑 [GEN QUEUE] ${signal} received; stopped claiming new generation jobs. Active: ${generationWorkerActiveCount}`);
}

router.post('/generate-spec', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const fallbackSpec = buildFallbackGameSpec(prompt);
        const client = createNvidiaTextClient();
        try {
            const response = await withTimeout(client.chat.completions.create({
                model: SPEC_MODEL,
                messages: [
                    { role: 'system', content: 'Return only JSON with title, description, and features for a mobile game concept. Keep it concise and concrete.' },
                    { role: 'user', content: String(prompt).slice(0, 4000) },
                ],
                temperature: 0.7,
                max_tokens: 350,
            }), 25000, 'Spec generation');
            const parsed = JSON.parse(extractJson(extractText(response)));
            return res.json({ success: true, spec: { ...fallbackSpec, ...parsed } });
        } catch (error) {
            console.warn('[OpenGame Spec] Falling back:', error?.message || error);
            return res.json({ success: true, spec: fallbackSpec, fallback: true });
        }
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Spec generation failed' });
    }
});

router.post('/refine-spec', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');
        const userMessage = req.body?.userMessage || '';
        const conversationHistory = Array.isArray(req.body?.conversationHistory) ? req.body.conversationHistory : [];
        const mergedPrompt = [...conversationHistory.map((msg) => msg.content || msg.text || ''), userMessage].filter(Boolean).join('\n');
        const spec = buildFallbackGameSpec(mergedPrompt || userMessage);
        res.json({
            success: true,
            ready: Boolean(userMessage && String(userMessage).length > 8),
            spec,
            question: '',
            aiMessage: `I can build ${spec.title}.`,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Spec refinement failed' });
    }
});

router.post('/narrative/chat', async (req, res) => {
    res.status(410).json({ error: 'Legacy narrative chat is removed from the maker path.', code: 'legacy_removed' });
});

router.post('/generate-asset', async (req, res) => {
    res.status(410).json({ error: 'Legacy standalone asset generation is removed. OpenGame owns maker assets.', code: 'legacy_removed' });
});

router.post('/dream', async (req, res) => {
    try {
        const { prompt, attachments } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
        const mediaAttachments = sanitizeMediaAttachments(attachments);
        const jobId = randomUUID();
        console.log(`🎮 [OpenGame Route] Creating job for User[${userId}] -> Concept: "${prompt}"`);
        await enqueueGenerationJob({
            jobId,
            userId,
            prompt,
            title: 'OpenGame Pending...',
            kind: 'opengame',
            payload: { mediaAttachments },
        });
        res.json({ success: true, jobId });
    } catch (error) {
        console.error('[OpenGame Route] Error:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'System Error' });
    }
});

router.post('/edit', async (req, res) => {
    res.status(410).json({ error: 'Legacy edit jobs are removed until OpenGame edit mode is wired.', code: 'legacy_removed' });
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
        if (!ownerId && !pendingBoot) return res.status(404).json({ error: 'Job not found' });
        if (ownerId && String(ownerId) !== String(userId)) return res.status(403).json({ error: 'Not allowed to cancel this job' });
        await markJobCanceled(jobId);
        await markGenerationJobCanceled(jobId);
        res.json({ success: true, status: 'canceled', jobId });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Cancel failed' });
    }
});

router.get('/dream/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        await recoverStaleGenerationJobs();
        const ephemeralJob = pendingJobBoots.get(jobId);
        if (ephemeralJob?.status === 'canceled' || isJobCancelled(jobId)) {
            return res.json({ success: false, status: 'canceled', error: 'Generation cancelled by user' });
        }

        const result = await pool.query('SELECT title, html_payload, raw_code, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [jobId]);
        if (result.rows.length === 0) {
            const queueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
            const queueJob = queueRes.rows[0];
            if (queueJob?.status === 'failed') return res.json({ status: 'error', error: queueJob.error || 'Generation failed', ...getQueueProgressPayload(queueJob) });
            if (queueJob?.status === 'canceled') return res.json({ success: false, status: 'canceled', error: queueJob.error || 'Generation cancelled', ...getQueueProgressPayload(queueJob) });
            if (queueJob || ephemeralJob) return res.json({ status: 'pending', ...getQueueProgressPayload(queueJob) });
            return res.status(404).json({ error: 'Job not found' });
        }

        const row = result.rows[0];
        if (!row.html_payload) {
            if (row.title?.startsWith('CANCELLED:')) return res.json({ success: false, status: 'canceled', error: row.title.replace('CANCELLED: ', '') });
            if (row.title?.startsWith('ERROR:')) return res.json({ status: 'error', error: row.title.replace('ERROR: ', '') });
            const queueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
            const queueJob = queueRes.rows[0];
            if (queueJob?.status === 'failed') return res.json({ status: 'error', error: queueJob.error || 'Generation failed', ...getQueueProgressPayload(queueJob) });
            if (queueJob?.status === 'canceled') return res.json({ success: false, status: 'canceled', error: queueJob.error || 'Generation cancelled', ...getQueueProgressPayload(queueJob) });
            return res.json({ status: 'pending', ...getQueueProgressPayload(queueJob) });
        }

        const completeQueueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
        return res.json({
            success: true,
            status: 'complete',
            draftId: jobId,
            title: row.title,
            htmlPreview: row.html_payload,
            classification: getStoredDraftClassification(row),
            ...getQueueProgressPayload(completeQueueRes.rows[0] || { progress: 100, phase: 'complete', status_message: 'Your game is ready.' }),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/dream/retry/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const jobResult = await pool.query('SELECT prompt, user_id FROM ai_games WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        const job = jobResult.rows[0];
        if (String(job.user_id) !== String(userId)) return res.status(403).json({ error: 'Not your job' });
        const newJobId = randomUUID();
        await enqueueGenerationJob({
            jobId: newJobId,
            userId,
            prompt: job.prompt,
            title: 'OpenGame Pending...',
            kind: 'opengame',
            payload: { mediaAttachments: [] },
        });
        res.json({ success: true, jobId: newJobId });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Retry failed' });
    }
});

router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const drafts = await pool.query(
            "SELECT id, title, prompt, thumbnail, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE user_id = $1 AND is_draft = true AND html_payload != '' ORDER BY created_at DESC",
            [userId]
        );
        res.json({ drafts: drafts.rows });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const draft = await pool.query("SELECT id, title, prompt, html_payload, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userId]);
        if (draft.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json({ draft: draft.rows[0] });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.delete('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const deleted = await pool.query("DELETE FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true RETURNING id, thumbnail", [req.params.id, userId]);
        if (deleted.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        await deleteCoverAsset(deleted.rows[0].thumbnail);
        res.json({ success: true, deletedId: deleted.rows[0].id });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.post('/publish/:draftId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');
        const { title, privacy, html } = req.body || {};
        const checkRes = await pool.query('SELECT * FROM ai_games WHERE id = $1 AND user_id = $2', [req.params.draftId, userId]);
        let draft;
        if (checkRes.rows.length === 0) {
            if (!html) return res.status(400).json({ error: 'HTML payload required for new games' });
            const insertRes = await pool.query(
                `INSERT INTO ai_games (user_id, title, html_payload, prompt, raw_code, is_draft, privacy, created_at)
                 VALUES ($1, $2, $3, $4, $5, false, $6, NOW())
                 RETURNING *`,
                [userId, title?.trim() || 'Untitled Game', html, `Published from template: ${title?.trim() || 'Untitled Game'}`, html, privacy || 'public']
            );
            draft = insertRes.rows[0];
        } else {
            if (title && title.trim()) {
                await pool.query('UPDATE ai_games SET title = $1 WHERE id = $2 AND user_id = $3', [title.trim().substring(0, 255), req.params.draftId, userId]);
            }
            const publishRes = await pool.query('UPDATE ai_games SET is_draft = false, privacy = $3 WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.draftId, userId, privacy || 'public']);
            draft = publishRes.rows[0];
        }
        const { globalId, classification } = await upsertPublishedAIGame({ draftId: draft.id, userId, draft });
        res.json({ success: true, gameId: globalId, classification });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.post('/reclassify-published', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');
        const limit = Math.min(50, Math.max(1, Number(req.body?.limit || 20)));
        const params = [userId, limit];
        const draftsRes = await pool.query(
            `SELECT id, user_id, title, prompt, html_payload, thumbnail, preview_video_url
             FROM ai_games
             WHERE user_id = $1 AND is_draft = false AND html_payload != ''
             ORDER BY created_at DESC
             LIMIT $2`,
            params
        );
        const updated = [];
        for (const draft of draftsRes.rows) {
            const { globalId, classification } = await upsertPublishedAIGame({ draftId: draft.id, userId, draft, forceRefreshClassification: true });
            updated.push({ draftId: draft.id, gameId: globalId, title: draft.title, classification });
        }
        res.json({ success: true, count: updated.length, updated });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get('/play/:targetId', async (req, res) => {
    try {
        const game = await pool.query('SELECT html_payload FROM ai_games WHERE id::text LIKE $1 LIMIT 1', [`${req.params.targetId}%`]);
        if (game.rows.length === 0) return res.status(404).send('AI Game Block Missing / Erased');
        res.setHeader('Content-Type', 'text/html');
        res.send(game.rows[0].html_payload);
    } catch {
        res.status(500).send('Database extraction failed');
    }
});

router.get('/admin/backfill-thumbnails', async (_req, res) => {
    res.status(410).json({ error: 'Legacy AI-game thumbnail backfill is removed from the maker runtime.' });
});

router.get('/admin/assets/diagnostics', async (_req, res) => {
    res.json({ engine: 'real-opengame-cli', legacyAssets: 'removed' });
});

router.post('/admin/rebuild-assets', async (_req, res) => {
    res.status(410).json({ error: 'Legacy asset rebuild is removed. OpenGame owns maker assets.' });
});

router.get('/admin/backfill-classifications', async (_req, res) => {
    res.status(410).json({ error: 'Legacy classification backfill is removed from this router.' });
});

router.post('/dream-labs', async (_req, res) => {
    res.status(410).json({ error: 'Legacy Labs generation is removed. OpenGame is the only maker implementation.', code: 'legacy_removed' });
});

function buildFallbackGameSpec(prompt) {
    const cleanPrompt = String(prompt || '').trim();
    const words = cleanPrompt
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 3);
    const title = words.length
        ? words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ')
        : 'Your Game';
    return {
        title,
        description: cleanPrompt ? `${cleanPrompt.slice(0, 180)}${cleanPrompt.length > 180 ? '...' : ''}` : 'A playable mobile game built from your idea.',
        features: [
            'Immediate mobile-first play.',
            'A visible core loop from the first frame.',
            'Clear feedback for player actions.',
        ],
    };
}

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
