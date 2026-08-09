import express from 'express';
import http from 'http';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { inspect } from 'node:util';
import pool from '../db.js';
import { classifyGame, normalizeCategories, setGameCategories } from '../categories.js';
import { buildPhase2_EditGame, postProcessRawHtml } from './promptRegistry.js';
import { HermesHeadlessOrchestrator } from './hermes-headless-orchestrator.js';

const _fallbackOrchestrator = new HermesHeadlessOrchestrator();

export async function verifyGame(html, opts = {}) {
    const code = typeof html === 'string' && html.startsWith('<') ? html : (opts.sourceHtml || '');
    const res = await _fallbackOrchestrator.runNativeSandboxTest(code, opts);
    return {
        success: res.passed,
        bypassed: Boolean(res.bypassed),
        crashes: res.errors || [],
        durationMs: res.durationMs,
        screenshot: null,
        critiqueFrames: []
    };
}

import { setAssetBaseUrl, getAssetRuntimeDiagnostics } from './asset-dictionary.js';
import { notifyGameReady, notifyGameFailed } from '../notifications.js';
import { deleteCoverAsset, enqueueCoverGeneration } from '../cover-art.js';
import { formatUnitySpecPromptBlock } from './gametok-unity.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from './maker-scaffolds.js';
import { applyDeterministicPreflightRepairs, applyDeterministicStateObjectDedupeRepairs, runMakerPreflightChecks } from './maker-preflight-validator.js';
import {
    isFreeBuildMode,
    isMakerFactoryMinimalMode,
    resolveMakerAgentImplementTurns,
    resolveMakerAgentInspectionTurns,
    shouldBlockOnPreflight,
} from './maker-factory-mode.js';
import { appendMakerAgentTurn, buildMakerAgentImplementPrompt, buildMakerAgentInspectionPrompt, buildThreeDRulesBlock, parseMakerAgentInspectionResponse, summarizeMakerAgentTurns, summarizeMakerProjectFiles } from './maker-agent-loop.js';
import {
    applyMainTsAssetWiringRepairs,
    buildAssetSlotRuntimeHints,
    collectAllowedAssetPackKeys,
    normalizeMainTsAssetKeys,
    readProjectAssetPackKeys,
    stripGtWiringDtUpdateHooks,
    writeMakerAssetKeysTs,
} from './maker-agent-asset-keys.js';
import {
    getMakerAgentToolDefinitions,
    MAKER_AGENT_TURN_MODE_IMPLEMENT,
    MAKER_AGENT_TURN_MODE_REPAIR,
    resolveMakerAgentTurnMode,
    runMakerAgentToolTurn,
    useMakerAgentImplementMode,
    useMakerAgentTools,
} from './maker-agent-tools.js';
import { getStreamStallConfig, streamChatCompletionToMessage, useMakerAgentStreaming } from './maker-agent-stream.js';
import {
    classifyProviderError,
    decideProviderRetryAction,
    formatProviderRetryDecision,
    ProviderFailureKind,
    shouldMoonshotFailover,
} from './provider-retry-policy.js';
import {
    buildMoonshotChatOptions,
    createMoonshotTextClient,
    callKimiJson,
    getMoonshotTextConfig,
    isMoonshotDirectProvider,
    isMoonshotFailoverEnabled,
    isMoonshotPrimaryEnabled,
    maskMoonshotKey,
    MOONSHOT_DIRECT_PROVIDER,
    resolveMoonshotModel,
} from './moonshot-text-client.js';
import {
    buildDeepSeekChatOptions,
    createDeepSeekTextClient,
    DEEPSEEK_DIRECT_PROVIDER,
    getDeepSeekTextConfig,
    getDeepSeekMaxOutputTokens,
    isDeepSeekDirectProvider,
    isDeepSeekPrimaryEnabled,
    isDeepSeekV4ModelName,
    maskDeepSeekKey,
    resolveDeepSeekModel,
} from './deepseek-text-client.js';
import { buildMakerCompileFailureEvidence, buildMakerDecodeFailureEvidence, buildMakerPatchFailureEvidence, restoreMakerFileBackups, runMakerProjectTscCheck } from './maker-project-compile-gate.js';
import { buildForgeAutoscaleReport, runForgeAutoscaleTick, isForgeAutoscaleEnabled } from './forge-autoscale.js';
import { buildGamePrompt } from './maker-game-prompt.js';
import { normalizeOrientation, DEFAULT_ORIENTATION } from './orientation.js';
import { stripCookingStateLeaksFromSource } from './maker-foundation-safety.js';
import { formatMakerSystemManual, getMakerSystemManualSummary } from './maker-system-manual.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const GAMETOK_MAKER_ROOT = process.env.GAMETOK_MAKER_ROOT || path.join(STORAGE_ROOT, 'gametok-maker-jobs');

const router = express.Router();

// "moonshotai/" was the NVIDIA-catalog slug prefix; direct Moonshot ids are unprefixed, and
// k2.7 exists only as the -code variant (see getMoonshotTextConfig).
const DEFAULT_KIMI_BUILDER_MODEL = "kimi-k2.7-code";
function resolveDreamModel(envName, fallback) {
    const requested = String(process.env[envName] || '').trim();
    return requested || fallback;
}

const BUILDER_FALLBACK_MODELS = (
    process.env.GAMETOK_BUILDER_MODELS
        || 'deepseek-ai/deepseek-v4-pro'
)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

// Phase 1 is intent extraction only — a fast/cheap model handles it fine.
// Default: same as builder so existing deployments are unaffected.
// Set GAMETOK_PHASE1_MODEL=deepseek-v4-flash on Railway to use the faster tier.
const PHASE1_MODEL = String(process.env.GAMETOK_PHASE1_MODEL || '').trim() || null;
// Optional: route Phase 1.5 (foundation architect) to a different model. This is the design brain,
// so it defaults to the builder/Pro model — set GAMETOK_FOUNDATION_MODEL=deepseek-v4-flash only if
// flash holds the game-design quality (A/B it). Speed lever for the ~90s Phase-1.5 queue.
const FOUNDATION_MODEL = String(process.env.GAMETOK_FOUNDATION_MODEL || '').trim() || null;

const DREAM_MODELS = {
    spec: resolveDreamModel('DREAMSTREAM_SPEC_MODEL', DEFAULT_KIMI_BUILDER_MODEL), // Use Kimi for Phase 1 too
    premiumBuilder: BUILDER_FALLBACK_MODELS[0],
};

const DEEPSEEK_MAX_OUTPUT_TOKENS = Math.max(
    4096,
    Math.min(384000, Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || 384000)),
);
const BUILDER_MAX_TOKENS = Math.max(
    8192,
    Math.min(DEEPSEEK_MAX_OUTPUT_TOKENS, Number(process.env.DREAMSTREAM_BUILDER_MAX_TOKENS || DEEPSEEK_MAX_OUTPUT_TOKENS)),
);
const MAKER_TOOL_MAX_TOKENS = Math.max(
    1024,
    Math.min(DEEPSEEK_MAX_OUTPUT_TOKENS, Number(process.env.GAMETOK_MAKER_TOOL_MAX_TOKENS || 65536)),
);
const MAKER_IMPLEMENT_MAX_TOKENS = Math.max(
    8192,
    Math.min(DEEPSEEK_MAX_OUTPUT_TOKENS, Number(process.env.GAMETOK_MAKER_IMPLEMENT_MAX_TOKENS || 128000)),
);
// Implement-turn reasoning effort. Was 'low' — which throttled a frontier-class
// reasoning model (DeepSeek V4 Pro, ~91% SWE-Bench) down to barely thinking, the
// likely real cause of contract drift we'd been blaming on the model. Default to
// 'high' now; override with GAMETOK_MAKER_IMPLEMENT_REASONING_EFFORT=low to revert
// instantly (no redeploy) if cost/latency is a problem.
const MAKER_IMPLEMENT_REASONING_EFFORT = String(process.env.GAMETOK_MAKER_IMPLEMENT_REASONING_EFFORT || 'high').trim() || 'high';
const MAKER_IMPLEMENT_FALLBACK_MODELS = (
    process.env.GAMETOK_MAKER_IMPLEMENT_MODELS
        || 'deepseek-ai/deepseek-v4-pro'
)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
const GLM_MAX_OUTPUT_TOKENS = Math.max(4096, Math.min(200000, Number(process.env.GAMETOK_GLM_MAX_OUTPUT_TOKENS || 128000)));
const BUILDER_MAX_CONTINUATIONS = Number(process.env.DREAMSTREAM_BUILDER_MAX_CONTINUATIONS || 2);
const BUILDER_JSON_REWRITE_ATTEMPTS = Math.max(0, Math.min(2, Number(process.env.DREAMSTREAM_BUILDER_JSON_REWRITE_ATTEMPTS || 1)));
const PHASE1_MAX_OUTPUT_TOKENS = Math.max(
    8192,
    Math.min(DEEPSEEK_MAX_OUTPUT_TOKENS, Number(process.env.DREAMSTREAM_PHASE1_MAX_TOKENS || 128000)),
);
const PHASE1_5_MAX_OUTPUT_TOKENS = Math.max(
    8192,
    Math.min(DEEPSEEK_MAX_OUTPUT_TOKENS, Number(process.env.DREAMSTREAM_PHASE1_5_MAX_TOKENS || 128000)),
);
const BUILDER_REQUEST_TIMEOUT_MS = Math.max(60000, Number(process.env.DREAMSTREAM_BUILDER_TIMEOUT_MS || 600000));
const MAKER_IMPLEMENT_TIMEOUT_MS = Math.max(
    BUILDER_REQUEST_TIMEOUT_MS,
    Number(process.env.GAMETOK_MAKER_IMPLEMENT_TIMEOUT_MS || 900000),
);
const BUILDER_CONTINUATION_TIMEOUT_MS = Math.max(30000, Number(process.env.DREAMSTREAM_BUILDER_CONTINUATION_TIMEOUT_MS || 180000));
const PHASE1_TIMEOUT_MS = Math.max(60000, Number(process.env.DREAMSTREAM_PHASE1_TIMEOUT_MS || 600000));
const PHASE1_ATTEMPTS_PER_MODEL = Math.max(1, Math.min(6, Number(process.env.DREAMSTREAM_PHASE1_ATTEMPTS_PER_MODEL || 4)));
const ALLOW_PHASE1_HEURISTIC_FALLBACK = String(process.env.GAMETOK_ALLOW_PHASE1_HEURISTIC_FALLBACK || '').toLowerCase() === 'true';
const SKIP_TURN1_PRERUN_EVIDENCE = String(process.env.GAMETOK_MAKER_SKIP_TURN1_PRERUN_EVIDENCE || 'true').toLowerCase() !== 'false';
const SKIP_PHASE3_REPAIR_WHEN_PHASE2_PASSES = String(process.env.GAMETOK_SKIP_PHASE3_WHEN_PHASE2_PASSES || 'true').toLowerCase() !== 'false';
const MAKER_SANDBOX_REPAIR_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.GAMETOK_MAKER_SANDBOX_REPAIR_ATTEMPTS || 2)));

const JOB_TITLES = {
    dreamPending: 'Pending Dream...',
    remixPending: 'Updating Game...',
    labsPending: '🧪 Labs: Cooking...',
};

// OpenRouter is only used by the experimental Labs route.
const openRouterClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || 'missing-key',
    defaultHeaders: {
        'HTTP-Referer': 'https://gametok.app',
        'X-Title': 'DreamStream Game Engine',
    },
});

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
const ALLOW_LEGACY_HTML_FALLBACK = process.env.ALLOW_LEGACY_HTML_FALLBACK === 'true';
const GAMETOK_MAKER_RESUME_WORKSPACE = process.env.GAMETOK_MAKER_RESUME_WORKSPACE !== 'false';
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
    'brainrot',
    'casual',
    'satisfying',
    'creative_tool',
    'experimental',
    'meme',
    'arcade',
    'runner',
    'racing',
    'simulator',
    'shooter',
    'platformer',
    'psychological',
    'paranormal',
    'escape',
    'found_footage',
    'cursed_feed',
    'night_shift',
    'trivia',
    'geography',
    'anime',
    'word',
    'memory',
    'impossible',
    'romance',
    'fantasy',
    'school_drama',
    'boyfriend',
    'girlfriend',
    'immersive_world',
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

/**
 * Pull the player-facing blurb out of a generation prompt.
 *
 * Prompts arrive as a structured blob:
 *   Multi-Engine AI Creation: <user prompt>
 *
 *   Title: <title>
 *   Description: <the blurb we actually want>
 *       Features: <list>
 *
 * Only that Description: block is fit to show. Prompts without one are
 * raw specs, generator instructions, or template scaffolding
 * ("Published from template: X"), so they return '' and the feed simply
 * omits the line rather than leaking pipeline internals.
 */
export function cleanGameDescription(raw, title = '') {
    const text = String(raw || '');
    const SECTIONS = 'Features|Controls|Mechanics|Goal|Objective|How to play|Win condition|Scoring';

    const descMatch = text.match(
        new RegExp(String.raw`^\s*Description:\s*([\s\S]*?)(?=\n\s*(?:${SECTIONS})\s*:|$)`, 'mi')
    );
    if (!descMatch) return '';

    let out = descMatch[1].replace(/\s+/g, ' ').trim();

    // Don't echo the title straight back at the reader.
    const t = String(title || '').trim();
    if (t && out.toLowerCase().startsWith(t.toLowerCase())) {
        out = out.slice(t.length).replace(/^[\s:.\u2013\u2014-]+/, '');
    }

    return out.slice(0, 300).trim();
}

async function upsertPublishedAIGame({ draftId, userId, draft, forceRefreshClassification = false }) {
    const globalId = `gm-ai-${String(draftId).substring(0, 8)}`;
    const description = cleanGameDescription(draft.prompt, draft.title);
    // No AI classification anymore (the feed dropped category tabs). Surface any
    // legacy stored tags a draft already carries; null for anything newer.
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
            // Denormalized off the draft so the feed's `SELECT g.*` queries carry it without edits.
            // Must be in the ON CONFLICT set too, or a republish keeps a stale value.
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

    // Discovery categories. Deliberately awaited-but-guarded rather than fire-and-forget: a game
    // that lands in the feed uncategorised is invisible to category browsing, but a classifier
    // outage must never block a publish. If the creator picked categories themselves, their choice
    // is authoritative and the model is not consulted at all.
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatJobLogLabel(label, jobId = null) {
    return jobId ? `${label} job=${jobId}` : label;
}

async function withAbortableTimeout(task, timeoutMs, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
        return await task(controller.signal);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

// NVIDIA removed from the text/game-gen path entirely (2026-07-08, re-swept 2026-08-01 after it
// crept back in through the Kimi CLI's fallback provider): it was never anything but an
// emergency failover here, and separately 4 other endpoints called it directly with no DeepSeek
// option at all (see callDeepSeekFlashJson call sites) — that's what produced the hardcoded
// "Clear tap-friendly controls" filler spec whenever NVIDIA/Llama was slow. DeepSeek direct is now
// the only text provider (Moonshot remains as an explicit opt-in primary/failover, independent of
// this decision — it's off by default and was never NVIDIA). If DeepSeek's API has an outage,
// generation now fails outright rather than silently degrading through NVIDIA — a deliberate
// tradeoff, not an oversight.
async function withTextProviderRetries(task, {
    label,
    jobId = null,
    maxAttempts = 2,
    baseDelayMs = 1500,
    fallbackModels = [],
    enableMoonshotFailover = null,
} = {}) {
    let lastError;
    const logLabel = formatJobLogLabel(label, jobId);
    const deepseekPrimary = isDeepSeekPrimaryEnabled();
    const moonshotPrimary = !deepseekPrimary && isMoonshotPrimaryEnabled();

    if (deepseekPrimary) {
        const deepseekConfig = getDeepSeekTextConfig();
        const deepseekClient = createDeepSeekTextClient();
        if (!deepseekConfig || !deepseekClient) {
            throw new Error(`[${logLabel}] DeepSeek primary requested but DEEPSEEK_API_KEY is missing`);
        }

        const modelsToTry = [...new Set(
            (fallbackModels.length > 0 ? fallbackModels : [deepseekConfig.model])
                .map((model) => resolveDeepSeekModel(model)),
        )];

        for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex += 1) {
            const currentModel = modelsToTry[modelIndex];

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                try {
                    if (modelIndex > 0 || attempt > 1) {
                        console.log(`🔁 [${logLabel}] DeepSeek attempt ${attempt}/${maxAttempts} on ${currentModel} (model ${modelIndex + 1}/${modelsToTry.length})...`);
                    } else {
                        console.log(`🐋 [${logLabel}] DeepSeek direct (${currentModel}, key ${maskDeepSeekKey(deepseekConfig.apiKey)})`);
                    }
                    return await task(currentModel, deepseekClient, DEEPSEEK_DIRECT_PROVIDER);
                } catch (error) {
                    lastError = error;
                    const classification = classifyProviderError(error);
                    const retryAction = attempt < maxAttempts ? 'retry' : 'switch_model';
                    console.warn(`🧭 [${logLabel}] ${formatProviderRetryDecision(classification, retryAction)} on DeepSeek ${currentModel} (attempt ${attempt}/${maxAttempts})`);

                    if (attempt >= maxAttempts) {
                        break;
                    }
                    await sleep(baseDelayMs * attempt);
                }
            }
        }

        throw lastError;
    }

    if (moonshotPrimary) {
        const moonshotConfig = getMoonshotTextConfig();
        const moonshotClient = createMoonshotTextClient();
        if (!moonshotConfig || !moonshotClient) {
            throw new Error(`[${logLabel}] Moonshot primary requested but MOONSHOT_API_KEY is missing`);
        }
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                if (attempt > 1) {
                    console.log(`🌙 [${logLabel}] Moonshot primary retry ${attempt}/${maxAttempts} (${moonshotConfig.model})...`);
                } else {
                    console.log(`🌙 [${logLabel}] Moonshot primary (${moonshotConfig.model}, key ${maskMoonshotKey(moonshotConfig.apiKey)})`);
                }
                return await task(moonshotConfig.model, moonshotClient, MOONSHOT_DIRECT_PROVIDER);
            } catch (error) {
                lastError = error;
                const classification = classifyProviderError(error);
                console.warn(`🌙 [${logLabel}] ${formatProviderRetryDecision(classification, attempt < maxAttempts ? 'rotate_key' : 'throw')} on Moonshot direct (attempt ${attempt}/${maxAttempts})`);
                if (attempt >= maxAttempts) {
                    break;
                }
                await sleep(baseDelayMs * attempt);
            }
        }
        throw lastError;
    }

    throw new Error(`[${logLabel}] No text provider configured — set GAMETOK_DEEPSEEK_PRIMARY=true with DEEPSEEK_API_KEY (or configure Moonshot primary).`);
}

function isDeepSeekV4Model(model) {
    return isDeepSeekV4ModelName(model);
}

function isGlmModel(model) {
    return typeof model === 'string' && /^z-ai\/glm/i.test(model);
}

function getMaxTokensForModel(model, requestedMaxTokens) {
    const requested = Number(requestedMaxTokens || 8192);
    if (isDeepSeekV4Model(model)) {
        return getDeepSeekMaxOutputTokens(requested);
    }
    if (isGlmModel(model)) {
        return Math.min(requested, GLM_MAX_OUTPUT_TOKENS);
    }
    return requested;
}

function getDefaultChatOptions(model, requestedMaxTokens, { reasoningEffort = null } = {}) {
    const options = {
        model,
        max_tokens: getMaxTokensForModel(model, requestedMaxTokens),
        temperature: 0.25,
        stream: true,
    };

    if (isDeepSeekV4Model(model)) {
        options.reasoning_effort = reasoningEffort || process.env.DEEPSEEK_V4_REASONING_EFFORT || 'high';
    }

    return options;
}

function getTextChatOptions(model, requestedMaxTokens, {
    reasoningEffort = null,
    providerTag = null,
    hasTools = false,
    toolThinkingEnabled = false,
    stream = true,
    temperature = undefined,
} = {}) {
    if (isDeepSeekDirectProvider(providerTag)) {
        return buildDeepSeekChatOptions(resolveDeepSeekModel(model), requestedMaxTokens, {
            hasTools,
            toolThinkingEnabled,
            stream,
            reasoningEffort,
            temperature,
        });
    }
    if (isMoonshotDirectProvider(providerTag)) {
        return buildMoonshotChatOptions(resolveMoonshotModel(model), requestedMaxTokens, { hasTools, stream });
    }

    const options = getDefaultChatOptions(model, requestedMaxTokens, { reasoningEffort });
    options.stream = stream;
    if (temperature !== undefined) {
        options.temperature = temperature;
    }
    return options;
}

function resolveTextModelForProvider(model, providerTag) {
    if (isDeepSeekDirectProvider(providerTag)) {
        return resolveDeepSeekModel(model);
    }
    if (isMoonshotDirectProvider(providerTag)) {
        return resolveMoonshotModel(model);
    }
    return model;
}

function hasClosedHtmlDocument(html) {
    return html.toLowerCase().includes('</html>');
}

function cleanBuilderContinuation(text) {
    let output = stripMarkdownFences(text, 'html');
    output = output.replace(/^\s*<!doctype html[^>]*>\s*/i, '');
    output = output.replace(/^\s*<html[^>]*>\s*/i, '');
    return output.trimStart();
}

function buildBuilderContinuationPrompt(partialHtml) {
    const suffix = partialHtml.slice(-4000);
    return [
        'You were generating a single complete HTML game document and your previous response was cut off.',
        'Continue from EXACTLY where the HTML stopped.',
        'Output ONLY the missing continuation text.',
        'Do NOT restart the document.',
        'Do NOT repeat earlier code.',
        'Do NOT explain anything.',
        '',
        'The current partial HTML ends with this exact suffix:',
        '```html',
        suffix,
        '```',
        '',
        'Continue with only the remaining characters needed to finish the same HTML document.'
    ].join('\n');
}

async function requestBuilderMessage(userPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, currentModel = null } = {}) {
    assertJobNotCancelled(jobId);
    await assertJobNotCancelledShared(jobId, { force: true });
    
    let finishReason = null;
    const logLabel = formatJobLogLabel(label, jobId);
    let lastPartialText = '';
    let lastPartialStopReason = null;
    const text = await withTextProviderRetries(async (modelParam, client, providerTag) => withAbortableTimeout(async (signal) => {
        const modelToUse = resolveTextModelForProvider(currentModel || modelParam || DREAM_MODELS.premiumBuilder, providerTag);
        assertJobNotCancelled(jobId);
        await assertJobNotCancelledShared(jobId);
        console.log(`⏳ [${logLabel}] Requesting builder output (timeout ${Math.round(timeoutMs / 1000)}s, model: ${modelToUse})...`);
        let output = "";
        try {
            const stream = await client.chat.completions.create({
                ...getTextChatOptions(modelToUse, BUILDER_MAX_TOKENS, { providerTag }),
                messages: [{ role: 'user', content: userPrompt }],
            }, { signal });

            for await (const chunk of stream) {
                assertJobNotCancelled(jobId);
                await assertJobNotCancelledShared(jobId);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                    output += delta;
                    lastPartialText = output;
                }
                const chunkFinishReason = chunk.choices?.[0]?.finish_reason;
                if (chunkFinishReason) {
                    finishReason = chunkFinishReason;
                    lastPartialStopReason = chunkFinishReason;
                }
            }
            return output;
        } catch (error) {
            if (output.trim()) {
                error.partialText = output;
                error.partialStopReason = finishReason || 'provider_error_partial';
                lastPartialText = output;
                lastPartialStopReason = error.partialStopReason;
            }
            throw error;
        }
    }, timeoutMs, logLabel), { label, jobId, maxAttempts, baseDelayMs: 1500, fallbackModels: currentModel ? [currentModel] : BUILDER_FALLBACK_MODELS }).catch((error) => {
        if (String(lastPartialText || '').trim()) {
            finishReason = error.partialStopReason || lastPartialStopReason || 'provider_error_partial';
            console.warn(`⚠️ [${logLabel}] Provider failed after ${lastPartialText.length} chars. Keeping partial output for continuation.`);
            return lastPartialText;
        }
        throw error;
    });

    return {
        text,
        stopReason: finishReason,
    };
}

function buildMakerToolModelsToTry({ preferredModel = null, fallbackModels = null, defaultFallbacks = BUILDER_FALLBACK_MODELS } = {}) {
    const chain = Array.isArray(fallbackModels) && fallbackModels.length > 0
        ? [...fallbackModels]
        : [...defaultFallbacks];
    if (!preferredModel) {
        return chain;
    }
    return [preferredModel, ...chain.filter((model) => model !== preferredModel)];
}

async function requestMakerToolCompletion(messages, {
    label,
    jobId = null,
    timeoutMs = BUILDER_REQUEST_TIMEOUT_MS,
    maxAttempts = 2,
    preferredModel = null,
    maxTokens = MAKER_TOOL_MAX_TOKENS,
    fallbackModels = null,
    reasoningEffort = null,
    mode = null,
    onResolvedModel = null,
} = {}) {
    assertJobNotCancelled(jobId);
    await assertJobNotCancelledShared(jobId, { force: true });
    const logLabel = formatJobLogLabel(label, jobId);
    const modelsToTry = buildMakerToolModelsToTry({
        preferredModel,
        fallbackModels,
    });

    if (preferredModel && modelsToTry.length > 1) {
        console.log(`📌 [${logLabel}] Preferred model ${preferredModel} with fallback chain ${modelsToTry.join('>')}`);
    }

    return withTextProviderRetries(async (modelParam, client, providerTag) => withAbortableTimeout(async (signal) => {
        const modelToUse = resolveTextModelForProvider(modelParam || preferredModel || DREAM_MODELS.premiumBuilder, providerTag);
        assertJobNotCancelled(jobId);
        await assertJobNotCancelledShared(jobId);
        const promptChars = messages.reduce((sum, message) => sum + String(message?.content || '').length, 0);
        const streaming = useMakerAgentStreaming();
        const toolMaxTokens = isMoonshotDirectProvider(providerTag)
            ? Math.max(1024, Math.min(32768, Number(maxTokens || MAKER_TOOL_MAX_TOKENS)))
            : isDeepSeekDirectProvider(providerTag)
                ? getDeepSeekMaxOutputTokens(maxTokens || MAKER_TOOL_MAX_TOKENS)
                : getMaxTokensForModel(modelToUse, maxTokens);
        // Free build repair fixes cross-file issues (e.g. a missing imported module),
        // which needs reasoning — enable thinking for repair too when free build is on.
        const deepseekToolThinking = isDeepSeekDirectProvider(providerTag)
            && (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT || isFreeBuildMode());
        const usesDeepSeekReasoning = (isDeepSeekDirectProvider(providerTag) || isDeepSeekV4Model(modelToUse))
            && !isMoonshotDirectProvider(providerTag);
        let loggedReasoning = 'n/a';
        if (isDeepSeekDirectProvider(providerTag)) {
            loggedReasoning = deepseekToolThinking
                ? (reasoningEffort || process.env.DEEPSEEK_V4_IMPLEMENT_REASONING_EFFORT || process.env.DEEPSEEK_V4_TOOL_REASONING_EFFORT || process.env.DEEPSEEK_V4_REASONING_EFFORT || 'low')
                : 'off';
        } else if (usesDeepSeekReasoning) {
            loggedReasoning = reasoningEffort || process.env.DEEPSEEK_V4_REASONING_EFFORT || 'high';
        }
        console.log(`🛠️ [${logLabel}] Requesting tool completion (timeout ${Math.round(timeoutMs / 1000)}s, model: ${modelToUse}, mode: ${mode || 'default'}, streaming: ${streaming ? 'on' : 'off'}, prompt_chars=${promptChars})...`);
        console.log(`🛠️ [${logLabel}] max_tokens=${toolMaxTokens} reasoning=${loggedReasoning} thinking=${isDeepSeekDirectProvider(providerTag) ? (deepseekToolThinking ? 'on' : 'off') : 'n/a'}`);

        const chatOptions = {
            ...getTextChatOptions(modelToUse, toolMaxTokens, {
                reasoningEffort,
                providerTag,
                hasTools: true,
                toolThinkingEnabled: deepseekToolThinking,
                stream: streaming,
            }),
            messages,
            tools: getMakerAgentToolDefinitions(),
            tool_choice: 'auto',
        };

        let message;
        if (streaming) {
            message = await streamChatCompletionToMessage(client, chatOptions, {
                signal,
                logLabel,
                progressIntervalMs: mode === MAKER_AGENT_TURN_MODE_IMPLEMENT ? 10000 : 15000,
            });
        } else {
            const response = await client.chat.completions.create({
                ...chatOptions,
                stream: false,
            }, { signal });
            message = response?.choices?.[0]?.message;
        }

        if (!message) {
            throw new Error('Tool completion returned no assistant message.');
        }
        const toolCallCount = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
        if (toolCallCount === 0 && !String(message.content || '').trim()) {
            const emptyError = new Error('Tool completion returned empty assistant message (no content, no tool_calls).');
            emptyError.code = 'STREAM_EMPTY';
            throw emptyError;
        }
        console.log(`🛠️ [${logLabel}] tool_calls=${toolCallCount} content_chars=${String(message.content || '').length}`);
        if (typeof onResolvedModel === 'function') {
            onResolvedModel(modelToUse);
        }
        return message;
    }, timeoutMs, logLabel), {
        label,
        jobId,
        maxAttempts,
        baseDelayMs: 1500,
        fallbackModels: modelsToTry,
    });
}

async function generateCompleteHtmlWithBuilder(initialPrompt, { label, jobId = null, currentModel = null } = {}) {
    assertJobNotCancelled(jobId);
    const logLabel = formatJobLogLabel(label, jobId);
    let { text, stopReason } = await requestBuilderMessage(initialPrompt, { label, jobId, currentModel });
    assertJobNotCancelled(jobId);
    let html = normalizeHtmlDocument(text);
    console.log(`🧾 [${logLabel}] stop_reason=${stopReason || 'unknown'} chars=${html.length}`);

    let continuationCount = 0;
    while (!hasClosedHtmlDocument(html) && continuationCount < BUILDER_MAX_CONTINUATIONS) {
        assertJobNotCancelled(jobId);
        continuationCount += 1;
        console.warn(`⚠️ [${logLabel}] Output truncated or incomplete. Requesting continuation ${continuationCount}/${BUILDER_MAX_CONTINUATIONS}...`);
        if (jobId) {
            await updateGenerationJobProgress(
                jobId,
                58 + continuationCount,
                'build_continuing',
                `Builder hit the token limit. Continuing output ${continuationCount}/${BUILDER_MAX_CONTINUATIONS}...`
            );
        }
        const continuationPrompt = buildBuilderContinuationPrompt(html);
        const continuation = await requestBuilderMessage(continuationPrompt, {
            label: `${label} Continue`,
            jobId,
            timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
            maxAttempts: 2,
            currentModel,
        });
        assertJobNotCancelled(jobId);
        const continuationText = cleanBuilderContinuation(continuation.text);
        console.log(`🧾 [${formatJobLogLabel(`${label} Continue`, jobId)}] stop_reason=${continuation.stopReason || 'unknown'} chars=${continuationText.length}`);
        if (!continuationText) {
            break;
        }
        html += continuationText;
    }

    if (!hasClosedHtmlDocument(html) && jobId) {
        await updateGenerationJobProgress(
            jobId,
            62,
            'build_truncated',
            'Builder output stayed incomplete after continuation attempts.'
        );
    }

    return html;
}


function stripMarkdownFences(text, languageHint = '') {
    const openingFence = languageHint
        ? new RegExp(`^\\s*\\\`\\\`\\\`${languageHint}\\n?`, 'i')
        : /^\s*```[a-z]*\n?/i;
    return text.replace(openingFence, '').replace(/\n?```\s*$/i, '').trim();
}

function normalizeHtmlDocument(rawHtml) {
    let html = stripMarkdownFences(rawHtml, 'html');
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
        const htmlStart = html.indexOf('<!');
        if (htmlStart > 0) {
            html = html.substring(htmlStart);
        } else {
            const fallbackHtmlStart = html.toLowerCase().indexOf('<html');
            if (fallbackHtmlStart > 0) {
                html = html.substring(fallbackHtmlStart);
            }
        }
    }
    return html;
}

function extractHtmlTitle(html) {
    const match = html.match(/<title>(.*?)<\/title>/i);
    return match?.[1]?.trim() || null;
}

const SCAFFOLD_HTML_TITLES = new Set(['gamecursor', 'untitled', 'untitled game', 'game']);

function resolveDreamGameTitle({ specTitle, html, fallback = 'DreamStream Game' } = {}) {
    const phase1Title = String(specTitle || '').trim();
    if (phase1Title) return phase1Title.substring(0, 255);
    const htmlTitle = extractHtmlTitle(html);
    if (htmlTitle && !SCAFFOLD_HTML_TITLES.has(htmlTitle.toLowerCase())) {
        return htmlTitle.substring(0, 255);
    }
    return String(fallback || 'DreamStream Game').substring(0, 255);
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
    
    // Get userId and send notification
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

// Persist per-generation review telemetry onto the generation_jobs row (status,
// prompt, error and timing already live there). COALESCE so a later call never
// clears a field an earlier one set, and it must never throw into the job flow.
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
            -- Review telemetry: persisted per generation so the admin dashboard can
            -- show how generations perform over time without scraping Railway logs.
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

// `orientation` participates in the dedupe key: the same prompt forged once in portrait and once in
// landscape is two genuinely different games, and without this the second request would collapse
// onto the first job and come back in the wrong shape.
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
    // Orientation rides in the job payload but is written onto the draft row up front, so every
    // downstream reader (generation, sandbox, edit, remix, publish) can just read the row.
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
        `🏗️ [GEN QUEUE] Enqueued ${kind} job ${jobId}; queued=${queueMetrics.queued} running=${queueMetrics.running} baseConcurrency=${GENERATION_JOB_CONCURRENCY} maxConcurrency=${GENERATION_JOB_MAX_CONCURRENCY}`
    );
    if (isForgeAutoscaleEnabled() && queueMetrics.queued > 0) {
        void runForgeAutoscaleTick().catch((error) => {
            console.warn('[Forge Autoscale] enqueue trigger failed:', error?.message || error);
        });
    }
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
    const effective = Math.min(
        GENERATION_JOB_MAX_CONCURRENCY,
        Math.max(GENERATION_JOB_CONCURRENCY, demand)
    );
    if (metrics.queued > 0 && effective >= GENERATION_JOB_MAX_CONCURRENCY) {
        console.warn(
            `[GEN QUEUE] Forge at local capacity: queued=${metrics.queued} running=${metrics.running} max=${GENERATION_JOB_MAX_CONCURRENCY}. Add forge replicas (GENERATION_WORKER_ENABLED=true).`
        );
    }
    return effective;
}

// ── Full per-job log capture ──────────────────────────────────────────────────
// The user needs the complete line-by-line generation stream (Phase 1, artist,
// Phase 2 turns, sandbox probes) persisted — Railway logs wipe on redeploy. Up to
// GENERATION_JOB_MAX_CONCURRENCY jobs run at once, so a global console patch can't
// just dump to one buffer; AsyncLocalStorage attributes every console line to the
// job whose async context emitted it, even across awaits and interleaved jobs.
const genLogStore = new AsyncLocalStorage();
const GEN_LOG_MAX_LINES = 6000;
const GEN_LOG_MAX_BYTES = 1_200_000; // ~1.2MB cap per job, then it stops appending
let genLogCaptureInstalled = false;
function installGenLogCapture() {
    if (genLogCaptureInstalled) return;
    genLogCaptureInstalled = true;
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args); // always still write to stdout/Railway
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

        const result = await pool.query('SELECT title, html_payload FROM ai_games WHERE id = $1', [job.id]);
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
        if (!row.html_payload) {
            throw new Error('Generation finished without html_payload.');
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
            console.log(`🏗️ [GEN QUEUE] Worker ${GENERATION_WORKER_ID} ready with baseConcurrency=${GENERATION_JOB_CONCURRENCY} maxConcurrency=${GENERATION_JOB_MAX_CONCURRENCY} burst=${GENERATION_BURST_CONCURRENCY}`);
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
    console.log(`🛑 [GEN QUEUE] ${signal} received; stopped claiming new generation jobs. Active: ${generationWorkerActiveCount}`);
}

function normalizeMediaAttachmentType(type = '') {
    const normalized = String(type || '').trim().toLowerCase();
    switch (normalized) {
        case 'photo':
        case 'gif':
        case 'sticker':
            return 'image';
        case 'music':
            return 'bgm';
        case 'audio':
            return 'sfx';
        default:
            return normalized || 'image';
    }
}

function normalizeMediaAttachmentRole(role = '', type = '') {
    const normalized = String(role || '').trim().toLowerCase();
    const normalizedType = normalizeMediaAttachmentType(type);

    if (!normalized) {
        switch (normalizedType) {
            case 'video':
                return 'background';
            case 'bgm':
                return 'bgm';
            case 'sfx':
                return 'sfx';
            default:
                return 'hero';
        }
    }

    switch (normalized) {
        case 'main':
        case 'hero':
        case 'focal':
            return 'hero';
        case 'background':
        case 'backdrop':
            return 'background';
        case 'overlay':
        case 'sticker':
        case 'meme':
            return 'overlay';
        case 'panel':
        case 'screen':
            return 'panel';
        case 'prop':
        case 'collectible':
            return 'prop';
        case 'bgm':
        case 'music':
            return 'bgm';
        case 'sfx':
        case 'audio':
            return 'sfx';
        case 'reference':
        case 'inspiration':
            return 'reference';
        default:
            return normalized;
    }
}

function isAnimatedAttachment(rawType = '', url = '') {
    const t = String(rawType || '').trim().toLowerCase();
    if (t === 'gif' || t === 'sticker') return true;
    const u = String(url || '').toLowerCase();
    return u.startsWith('data:image/gif') || /\.gif(\?|#|$)/.test(u);
}

function sanitizeMediaAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) {
        return [];
    }

    return rawAttachments
        .map((asset) => ({
            type: normalizeMediaAttachmentType(asset?.type),
            // gif/sticker collapse to 'image' above; keep the animation hint so the
            // builder renders them as a live <img> instead of a frozen canvas frame.
            animated: isAnimatedAttachment(asset?.type, asset?.url),
            role: normalizeMediaAttachmentRole(asset?.role, asset?.type),
            url: typeof asset?.url === 'string' ? asset.url.trim() : '',
            title: typeof asset?.title === 'string' ? asset.title.trim() : '',
            label: typeof asset?.label === 'string' ? asset.label.trim() : '',
            instruction: typeof asset?.instruction === 'string' ? asset.instruction.trim() : '',
            thumb: typeof asset?.thumb === 'string' ? asset.thumb.trim() : '',
            duration: typeof asset?.duration === 'string' ? asset.duration.trim() : '',
        }))
        .filter((asset) => asset.url && asset.instruction);
}

function buildMediaAttachmentSummary(mediaAttachments = []) {
    if (!Array.isArray(mediaAttachments) || mediaAttachments.length === 0) {
        return '';
    }

    return mediaAttachments.map((asset, index) => {
        const label = asset.title || asset.label || `Attachment ${index + 1}`;
        return `${index + 1}. [${asset.type}] ${label} -> ${asset.url}\n   role: ${asset.role || 'hero'}\n   user intent: ${asset.instruction}`;
    }).join('\n');
}

function makerSafeFileName(value, fallback = 'job') {
    return String(value || fallback)
        .trim()
        .replace(/[^a-zA-Z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || fallback;
}

async function writeMakerJson(workspace, fileName, value) {
    await fs.promises.writeFile(
        path.join(workspace, fileName),
        JSON.stringify(value, null, 2),
        'utf8'
    );
}

async function writeMakerText(workspace, fileName, value) {
    await fs.promises.writeFile(path.join(workspace, fileName), String(value || ''), 'utf8');
}

async function createGameTokMakerWorkspace(jobId, prompt, mediaAttachments = []) {
    const workspace = path.join(GAMETOK_MAKER_ROOT, makerSafeFileName(jobId));
    const resumable = GAMETOK_MAKER_RESUME_WORKSPACE && fs.existsSync(path.join(workspace, 'GAMETOK_MAKER_CONTRACT.json'));
    if (!resumable) {
        await fs.promises.rm(workspace, { recursive: true, force: true });
    }
    await fs.promises.mkdir(path.join(workspace, 'artifact'), { recursive: true });
    await fs.promises.mkdir(path.join(workspace, 'logs'), { recursive: true });

    const contract = {
        version: 1,
        engine: 'gametok-native-maker',
        jobId,
        createdAt: new Date().toISOString(),
        objective: 'Build a complete playable mobile HTML5 game through the native GameTok pipeline.',
        workflow: [
            'intent_plan',
            'asset_plan',
            'asset_generation',
            'game_build',
            'post_process',
            'sandbox_verify',
            'repair_if_needed',
            'publish',
        ],
        requiredArtifacts: [
            'gametok-plan.json',
            'asset-manifest.json',
            'raw-build.html',
            'artifact/index.html',
            'gametok-build-report.json',
        ],
        nonNegotiables: [
            'The game must be playable, not just visually present.',
            'The first 10 seconds must prove the primary mechanic works.',
            'HUD, readable labels, meters, buttons, and controls must be code-rendered.',
            'AI images are for sprites, backgrounds, props, items, and scenery, not baked UI text.',
            'Gameplay terrain, tactical paths, landing pads, collision zones, and controls must be code-defined.',
            'The final artifact must fit a 390x844 mobile webview with GameTok chrome-safe spacing.',
        ],
        userPrompt: prompt,
        attachments: mediaAttachments.map((asset) => ({
            type: asset.type,
            role: asset.role,
            title: asset.title || asset.label || null,
            url: asset.url,
            instruction: asset.instruction,
        })),
    };

    await writeMakerJson(workspace, 'GAMETOK_MAKER_CONTRACT.json', contract);
    if (resumable) {
        await writeMakerJson(workspace, 'logs/resume-workspace.json', {
            jobId,
            resumedAt: new Date().toISOString(),
            projectFilesManifestExists: fs.existsSync(path.join(workspace, 'project-files.json')),
            note: 'Existing maker workspace preserved for same-job retry/resume.',
        });
    }
    await writeMakerText(workspace, 'README.md', [
        '# GameTok Native Maker Workspace',
        '',
        'This directory is generated by the native GameTok maker pipeline.',
        'It is intentionally independent of OpenGame.',
        '',
        `Job: ${jobId}`,
        '',
    ].join('\n'));

    return { workspace, contract };
}

function safeMakerProjectPath(projectRoot, relativePath) {
    const cleanPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!cleanPath || cleanPath.startsWith('/') || cleanPath.includes('\0') || cleanPath.split('/').includes('..')) {
        throw new Error(`Unsafe project file path: ${relativePath}`);
    }
    // Allow root configuration files, markdown, gitignore, and anything in src/
    // We already check for directory traversal/escape below, so this just prevents
    // weird hidden files or system files if they somehow got requested.
    const isValidRootFile = /^[a-zA-Z0-9_.-]+$/.test(cleanPath);
    const isSrcFile = cleanPath.startsWith('src/') || cleanPath.startsWith('public/') || cleanPath.startsWith('assets/');
    
    if (!isValidRootFile && !isSrcFile) {
        throw new Error(`Project file edits are limited to root files and src/ directory: ${relativePath}`);
    }
    const absolutePath = path.resolve(projectRoot, cleanPath);
    const projectRootResolved = path.resolve(projectRoot);
    if (!absolutePath.startsWith(projectRootResolved + path.sep)) {
        throw new Error(`Project file path escapes workspace: ${relativePath}`);
    }
    return { cleanPath, absolutePath };
}

function stripDuplicateDreamRuntimeDeclarations(content = '', cleanPath = '') {
    const source = String(content || '');
    const normalizedPath = String(cleanPath || '').replace(/\\/g, '/');
    if (!/\.(ts|tsx)$/i.test(normalizedPath) || /(^|\/)types\/global\.d\.ts$/i.test(normalizedPath)) {
        return source;
    }
    if (!/\b(DREAM_ASSETS|DREAM_ASSET_PACK|DREAM_ANIMATIONS|DREAM_TILESETS|DREAM_AUDIO_MANIFEST|DreamAssets)\b/.test(source)) {
        return source;
    }

    const removeBalancedBlocks = (input, markerRegex) => {
        let cursor = 0;
        let output = '';
        const regex = new RegExp(markerRegex.source, `${markerRegex.flags.includes('i') ? 'i' : ''}g`);
        let match;
        while ((match = regex.exec(input)) !== null) {
            const start = match.index;
            const open = input.indexOf('{', regex.lastIndex);
            if (open === -1) break;
            let depth = 0;
            let end = -1;
            for (let i = open; i < input.length; i += 1) {
                if (input[i] === '{') depth += 1;
                if (input[i] === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        end = i + 1;
                        break;
                    }
                }
            }
            if (end === -1) break;
            let blockEnd = end;
            const suffix = input.slice(blockEnd).match(/^\s*export\s*\{\s*\}\s*;?/);
            if (suffix) blockEnd += suffix[0].length;
            const block = input.slice(start, blockEnd);
            output += input.slice(cursor, start);
            output += /\b(DREAM_ASSETS|DREAM_ASSET_PACK|DREAM_ANIMATIONS|DREAM_TILESETS|DREAM_AUDIO_MANIFEST|DreamAssets)\b/.test(block)
                ? '\n'
                : block;
            cursor = blockEnd;
            regex.lastIndex = blockEnd;
        }
        return output + input.slice(cursor);
    };

    let output = removeBalancedBlocks(source, /declare\s+global\s*/i);
    output = output.replace(/^\s*declare\s+(?:const|let|var)\s+(?:DREAM_ASSETS|DREAM_ASSET_PACK|DREAM_ANIMATIONS|DREAM_TILESETS|DREAM_AUDIO_MANIFEST|DreamAssets)\b[^\n;]*(?:;|\n)/gm, '');
    output = removeBalancedBlocks(output, /(?:declare\s+)?interface\s+Window\s*/i);
    return output.replace(/\n{4,}/g, '\n\n\n');
}

function stripDuplicateTopLevelFunctions(content = '', cleanPath = '') {
    const source = String(content || '');
    const normalizedPath = String(cleanPath || '').replace(/\\/g, '/');
    if (!/(^|\/)src\/main\.ts$/i.test(normalizedPath)) {
        return source;
    }

    const declRegex = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    const blocks = [];
    let match;
    while ((match = declRegex.exec(source)) !== null) {
        const name = match[2];
        const start = match.index;
        const braceStart = source.indexOf('{', declRegex.lastIndex);
        if (braceStart === -1) continue;
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < source.length; i += 1) {
            if (source[i] === '{') depth += 1;
            if (source[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i + 1;
                    break;
                }
            }
        }
        if (end === -1) continue;
        blocks.push({ name, start, end });
    }

    // Keep the LAST definition of each name, not the first. Asset-wiring injections PREPEND helper
    // functions (drawBackground, getAssetImage, ...) to the top of the file; the builder's real
    // implementations come further down. Keeping the first copy discards the builder's actual scene
    // rendering and leaves an injected stub → blank canvas on boot. Prefer the builder's code.
    const lastIndexByName = new Map();
    blocks.forEach((block, index) => lastIndexByName.set(block.name, index));
    const duplicates = blocks.filter((block, index) => lastIndexByName.get(block.name) !== index);
    if (duplicates.length === 0) return source;

    let output = source;
    for (const block of duplicates.sort((a, b) => b.start - a.start)) {
        output = output.slice(0, block.start) + output.slice(block.end);
    }
    return output.replace(/\n{4,}/g, '\n\n\n');
}

function sanitizeMakerMainTsContent(content = '', cleanPath = '') {
    let output = stripDuplicateDreamRuntimeDeclarations(content, cleanPath);
    output = stripDuplicateTopLevelFunctions(output, cleanPath);
    return output;
}

async function normalizeMakerProjectRuntimeDeclarations(projectRoot) {
    const srcRoot = path.join(projectRoot, 'src');
    const visit = async (directory) => {
        let entries = [];
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            const relative = path.relative(projectRoot, absolute).replace(/\\/g, '/');
            if (!/\.(ts|tsx)$/i.test(relative)) continue;
            const before = await fs.promises.readFile(absolute, 'utf8').catch(() => null);
            if (before == null) continue;
            const after = sanitizeMakerMainTsContent(before, relative);
            if (after !== before) {
                await fs.promises.writeFile(absolute, after, 'utf8');
            }
        }
    };
    await visit(srcRoot);
}

function isProtectedMakerRuntimeFile(cleanPath = '') {
    return [
        /^src\/(?:bootstrap|assetLoader|assetKeys|dreamModels)\.ts$/,
        /^src\/types\/global\.d\.ts$/,
        /^src\/scenes\/Preloader\.ts$/,
        /^src\/(?:characters|scenes|systems|behaviors)\/Base[A-Za-z0-9_]*\.ts$/,
        /^(?:package|tsconfig|vite\.config)\.json$/,
        /^vite\.config\.ts$/,
    ].some((pattern) => pattern.test(cleanPath));
}

function lineStartIndexes(content = '') {
    const starts = [0];
    for (let i = 0; i < content.length; i += 1) {
        if (content[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

function functionImplementationAtLine(content = '', lineNumber = 1) {
    const starts = lineStartIndexes(content);
    const start = starts[Math.max(0, lineNumber - 1)];
    if (start == null) return null;
    const lineEnd = content.indexOf('\n', start);
    const line = content.slice(start, lineEnd === -1 ? content.length : lineEnd);
    const declaration = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line)
        || /^\s*(?:(?:public|private|protected|static|override|async)\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^{]+)?\{/.exec(line);
    const name = declaration?.[1];
    if (!name || ['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) return null;

    const braceStart = content.indexOf('{', start);
    if (braceStart === -1 || (lineEnd !== -1 && braceStart > lineEnd)) return null;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = braceStart; i < content.length; i += 1) {
        const ch = content[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                let end = i + 1;
                if (content[end] === '\r') end += 1;
                if (content[end] === '\n') end += 1;
                return { name, start, end, lineNumber };
            }
        }
    }
    return null;
}

function removeDuplicateImplementationsAtLines(content = '', lines = []) {
    const implementations = lines
        .map((line) => functionImplementationAtLine(content, line))
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);
    const byName = new Map();
    for (const implementation of implementations) {
        const entries = byName.get(implementation.name) || [];
        entries.push(implementation);
        byName.set(implementation.name, entries);
    }
    const removals = [];
    for (const [name, entries] of byName.entries()) {
        if (entries.length <= 1) continue;
        // entries is sorted by position; keep the LAST (the builder's real implementation, which
        // sits below the prepended injected helpers) and remove the earlier injected stub(s).
        for (const entry of entries.slice(0, -1)) {
            removals.push({ ...entry, name });
        }
    }
    if (removals.length === 0) return { content, removed: [] };
    let output = content;
    for (const removal of removals.sort((a, b) => b.start - a.start)) {
        output = `${output.slice(0, removal.start)}${output.slice(removal.end)}`;
    }
    return {
        content: output,
        removed: removals.map((entry) => ({ name: entry.name, line: entry.lineNumber })),
    };
}

function removeDefiniteAssignmentInitializers(content = '', lines = []) {
    const starts = lineStartIndexes(content);
    const changedLines = [];
    let output = content;
    for (const lineNumber of Array.from(new Set(lines)).sort((a, b) => b - a)) {
        const start = starts[Math.max(0, lineNumber - 1)];
        if (start == null) continue;
        const end = output.indexOf('\n', start);
        const lineEnd = end === -1 ? output.length : end;
        const line = output.slice(start, lineEnd);
        if (!/!\s*:\s*[^;\n=]+=\s*/.test(line)) continue;
        const repairedLine = line.replace(/!\s*:/, ':');
        if (repairedLine === line) continue;
        output = `${output.slice(0, start)}${repairedLine}${output.slice(lineEnd)}`;
        changedLines.push(lineNumber);
    }
    return { content: output, changedLines };
}

function removeObjectLiteralPropertiesAtLines(content = '', entries = []) {
    const starts = lineStartIndexes(content);
    const removed = [];
    let output = content;
    for (const entry of Array.from(entries || []).sort((a, b) => Number(b.line) - Number(a.line))) {
        const lineNumber = Number(entry.line);
        const key = String(entry.key || '').trim();
        if (!lineNumber || !key) continue;
        const start = starts[Math.max(0, lineNumber - 1)];
        if (start == null) continue;
        const lineEndIndex = output.indexOf('\n', start);
        const lineEnd = lineEndIndex === -1 ? output.length : lineEndIndex + 1;
        const line = output.slice(start, lineEnd);
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^\\s*(?:['"\`]${escapedKey}['"\`]|${escapedKey})\\s*:`).test(line)) continue;
        output = `${output.slice(0, start)}${output.slice(lineEnd)}`;
        removed.push({ line: lineNumber, key });
    }
    return { content: output, removed };
}

function makerLocalNameForInheritedProperty(property = '') {
    const mapping = {
        player: 'makerPlayer',
        enemies: 'makerEnemies',
        enemyMeleeTriggers: 'makerEnemyMeleeTriggers',
        decorations: 'makerDecorations',
        obstacles: 'makerObstacles',
        playerBullets: 'makerPlayerBullets',
        enemyBullets: 'makerEnemyBullets',
        ySortGroup: 'makerYSortGroup',
        worldWidth: 'makerWorldWidth',
        worldHeight: 'makerWorldHeight',
    };
    return mapping[property] || `maker${property.charAt(0).toUpperCase()}${property.slice(1)}`;
}

function renameInheritedSceneProperties(content = '', entries = []) {
    const starts = lineStartIndexes(content);
    const renamed = [];
    let output = content;
    const replacements = [];
    for (const entry of entries || []) {
        const lineNumber = Number(entry.line);
        const property = String(entry.property || '').trim();
        if (!lineNumber || !property) continue;
        const start = starts[Math.max(0, lineNumber - 1)];
        if (start == null) continue;
        const lineEndIndex = output.indexOf('\n', start);
        const lineEnd = lineEndIndex === -1 ? output.length : lineEndIndex;
        const line = output.slice(start, lineEnd);
        const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const declaration = new RegExp(`^(\\s*(?:(?:public|private|protected|readonly|override)\\s+)*)${escaped}(\\s*(?:[!?:=]|:\\s*[^=;]+[=;]))`).exec(line);
        if (!declaration) continue;
        const replacement = makerLocalNameForInheritedProperty(property);
        replacements.push({ property, replacement });
        output = `${output.slice(0, start)}${line.replace(new RegExp(`^(\\s*(?:(?:public|private|protected|readonly|override)\\s+)*)${escaped}`), `$1${replacement}`)}${output.slice(lineEnd)}`;
        renamed.push({ line: lineNumber, from: property, to: replacement });
    }
    for (const { property, replacement } of replacements) {
        const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        output = output.replace(new RegExp(`\\bthis\\.${escaped}\\b`, 'g'), `this.${replacement}`);
    }
    return { content: output, renamed };
}

async function applyDeterministicMakerBuildRepairs(projectRoot, buildErrors = []) {
    const applied = [];
    const errors = Array.isArray(buildErrors) ? buildErrors : [String(buildErrors || '')];
    const duplicateFunctionErrorsByFile = new Map();
    const definiteAssignmentErrorsByFile = new Map();
    const invalidScaleConfigErrorsByFile = new Map();
    const inheritedPropertyErrorsByFile = new Map();
    const missingExportsByImporter = new Map();
    let duplicateStateObjectLiteral = false;

    for (const error of errors) {
        const ts1117 = /^(src\/main\.ts)\(\d+,\d+\):\s*error\s+TS1117:\s*An object literal cannot have multiple properties with the same name\./m.exec(String(error || ''));
        if (ts1117) {
            duplicateStateObjectLiteral = true;
            continue;
        }

        const ts2393 = /^(src\/[^(]+)\((\d+),\d+\):\s*error\s+TS2393:\s*Duplicate function implementation\./m.exec(String(error || ''));
        if (ts2393) {
            const [, relativePath, line] = ts2393;
            const lines = duplicateFunctionErrorsByFile.get(relativePath) || [];
            lines.push(Number(line));
            duplicateFunctionErrorsByFile.set(relativePath, lines);
            continue;
        }

        // Vite/Rollup MISSING_EXPORT, e.g.:
        //   "Hazard" is not exported by "src/entities/Pickups.ts", imported by "src/game/Game.ts"
        // Root cause: a TYPE/interface imported as a VALUE — types are erased at bundle time, so rollup
        // can't find a runtime export. tsc can PASS while vite FAILS, which strands the model. Collect
        // by importer so we can mark the offending names as type-only imports below.
        const missingExport = /["']([^"']+)["']\s+is not exported by\s+["']([^"']+)["'](?:,\s*imported by\s+["']([^"']+)["'])?/i.exec(String(error || ''));
        if (missingExport) {
            const [, missingName, exportingPathRaw, importerPathRaw] = missingExport;
            const importerKey = (importerPathRaw || '').replace(/^\.?\//, '');
            const info = missingExportsByImporter.get(importerKey) || { exportingPath: (exportingPathRaw || '').replace(/^\.?\//, ''), names: new Set() };
            info.names.add(missingName);
            missingExportsByImporter.set(importerKey, info);
            continue;
        }

        const ts1263 = /^(src\/[^(]+)\((\d+),\d+\):\s*error\s+TS1263:\s*Declarations with initializers cannot also have definite assignment assertions\./m.exec(String(error || ''));
        if (ts1263) {
            const [, relativePath, line] = ts1263;
            const lines = definiteAssignmentErrorsByFile.get(relativePath) || [];
            lines.push(Number(line));
            definiteAssignmentErrorsByFile.set(relativePath, lines);
            continue;
        }

        const ts2353ScaleConfig = /^(src\/[^(]+)\((\d+),\d+\):\s*error\s+TS2353:\s*Object literal may only specify known properties, and '([^']+)' does not exist in type 'ScaleConfig'\./m.exec(String(error || ''));
        if (ts2353ScaleConfig) {
            const [, relativePath, line, key] = ts2353ScaleConfig;
            if (!['maxWidth', 'maxHeight', 'minWidth', 'minHeight'].includes(key)) continue;
            const entries = invalidScaleConfigErrorsByFile.get(relativePath) || [];
            entries.push({ line: Number(line), key });
            invalidScaleConfigErrorsByFile.set(relativePath, entries);
            continue;
        }

        const ts2416InheritedProperty = /^(src\/[^(]+)\((\d+),\d+\):\s*error\s+TS2416:\s*Property '([^']+)' in type '[^']+' is not assignable to the same property in base type '(?:BaseGameScene|BaseArenaScene|BaseLevelScene)'/m.exec(String(error || ''));
        if (ts2416InheritedProperty) {
            const [, relativePath, line, property] = ts2416InheritedProperty;
            const reserved = new Set(['player', 'enemies', 'enemyMeleeTriggers', 'decorations', 'obstacles', 'playerBullets', 'enemyBullets', 'ySortGroup', 'worldWidth', 'worldHeight']);
            if (!reserved.has(property)) continue;
            const entries = inheritedPropertyErrorsByFile.get(relativePath) || [];
            entries.push({ line: Number(line), property });
            inheritedPropertyErrorsByFile.set(relativePath, entries);
            continue;
        }

        const ts2551 = /^(src\/[^(]+)\(\d+,\d+\):\s*error\s+TS2551:\s*Property '([^']+)' does not exist[\s\S]*?Did you mean '([^']+)'\?/m.exec(String(error || ''));
        if (ts2551) {
            const [, relativePath, wrong, right] = ts2551;
            const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, relativePath);
            if (isProtectedMakerRuntimeFile(cleanPath)) continue;
            const before = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
            if (before == null) continue;
            const after = before.replace(new RegExp(`\\.${wrong}\\b`, 'g'), `.${right}`);
            if (after !== before) {
                await fs.promises.writeFile(absolutePath, after, 'utf8');
                applied.push({
                    path: cleanPath,
                    type: 'ts2551_property_typo',
                    from: wrong,
                    to: right,
                });
            }
        }
    }

    // MISSING_EXPORT → mark the type-only names with inline `type` specifiers in the importer.
    for (const [importerKey, info] of missingExportsByImporter.entries()) {
        // vite v8 / rolldown dropped the ", imported by X" clause from MISSING_EXPORT errors, so the
        // importer is frequently unknown (importerKey === ''). The old code did `if (!importerPath) continue`
        // and silently threw the repair away — which is why a one-line interface-imported-as-value killed
        // whole 3D jobs. When the importer is unknown, scan every src/*.ts and fix whichever files import
        // the name: the rewrite below only rewrites the matching import line for genuinely type-only names,
        // so applying it project-wide is safe.
        let importerCandidates;
        if (importerKey) {
            importerCandidates = [importerKey];
        } else {
            try {
                const entries = await fs.promises.readdir(path.join(projectRoot, 'src'), { recursive: true });
                importerCandidates = entries
                    .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
                    .map((entry) => `src/${String(entry).replace(/\\/g, '/')}`);
            } catch {
                importerCandidates = [];
            }
        }
        // Only touch names that are genuinely type-only in the exporting module (interface/type), so we
        // never mistype a real value. If the exporting source is unreadable, trust vite (a missing
        // runtime export is, by definition, type-only).
        const exportSrc = info.exportingPath
            ? await fs.promises.readFile(path.join(projectRoot, info.exportingPath), 'utf8').catch(() => '')
            : '';
        const typeNames = [...info.names].filter((name) => {
            const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`export\\s+(?:interface|type)\\s+${esc}\\b`).test(exportSrc)) return true;
            return exportSrc === '';
        });
        if (!typeNames.length) continue;
        for (const importerPath of importerCandidates) {
            const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, importerPath);
            if (isProtectedMakerRuntimeFile(cleanPath)) continue;
            let content = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
            if (content == null) continue;
            const before = content;
            content = content.replace(/import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])/g, (match, inner, from) => {
                const rebuilt = inner.split(',').map((specRaw) => {
                    const spec = specRaw.trim();
                    if (!spec) return specRaw;
                    const bare = spec.replace(/^type\s+/, '');
                    if (typeNames.includes(bare) && !/^type\s+/.test(spec)) {
                        return specRaw.replace(bare, `type ${bare}`);
                    }
                    return specRaw;
                }).join(',');
                return `import {${rebuilt}} from ${from}`;
            });
            if (content !== before) {
                await fs.promises.writeFile(absolutePath, content, 'utf8');
                applied.push({ path: cleanPath, type: 'missing_export_type_import', names: typeNames, from: typeNames.join(', '), to: 'import type' });
            }
        }
    }

    if (duplicateStateObjectLiteral) {
        const mainPath = path.join(projectRoot, 'src', 'main.ts');
        const before = await fs.promises.readFile(mainPath, 'utf8').catch(() => null);
        if (before != null) {
            const repair = applyDeterministicStateObjectDedupeRepairs(before);
            if (repair.removed.length > 0) {
                await fs.promises.writeFile(mainPath, repair.content, 'utf8');
                applied.push({
                    path: 'src/main.ts',
                    type: 'ts1117_duplicate_state_property',
                    removed: repair.removed,
                    from: repair.removed.join(', '),
                    to: 'kept first declaration only',
                });
            }
        }
    }

    for (const [relativePath, entries] of inheritedPropertyErrorsByFile.entries()) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, relativePath);
        if (isProtectedMakerRuntimeFile(cleanPath)) continue;
        const before = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
        if (before == null) continue;
        const repair = renameInheritedSceneProperties(before, entries);
        if (repair.content !== before) {
            await fs.promises.writeFile(absolutePath, repair.content, 'utf8');
            applied.push({
                path: cleanPath,
                type: 'ts2416_inherited_scene_property_rename',
                renamed: repair.renamed,
                from: repair.renamed.map((entry) => entry.from).join(', '),
                to: repair.renamed.map((entry) => entry.to).join(', '),
            });
        }
    }

    for (const [relativePath, entries] of invalidScaleConfigErrorsByFile.entries()) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, relativePath);
        if (isProtectedMakerRuntimeFile(cleanPath)) continue;
        const before = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
        if (before == null) continue;
        const repair = removeObjectLiteralPropertiesAtLines(before, entries);
        if (repair.content !== before) {
            await fs.promises.writeFile(absolutePath, repair.content, 'utf8');
            applied.push({
                path: cleanPath,
                type: 'ts2353_scale_config_unsupported_property',
                removed: repair.removed,
                from: repair.removed.map((entry) => entry.key).join(', '),
                to: 'removed unsupported Phaser ScaleConfig key(s)',
            });
        }
    }

    for (const [relativePath, lines] of definiteAssignmentErrorsByFile.entries()) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, relativePath);
        if (isProtectedMakerRuntimeFile(cleanPath)) continue;
        const before = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
        if (before == null) continue;
        const repair = removeDefiniteAssignmentInitializers(before, lines);
        if (repair.content !== before) {
            await fs.promises.writeFile(absolutePath, repair.content, 'utf8');
            applied.push({
                path: cleanPath,
                type: 'ts1263_definite_assignment_initializer',
                lines: repair.changedLines,
                from: '!: with initializer',
                to: ': with initializer',
            });
        }
    }

    for (const [relativePath, lines] of duplicateFunctionErrorsByFile.entries()) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, relativePath);
        if (isProtectedMakerRuntimeFile(cleanPath)) continue;
        const before = await fs.promises.readFile(absolutePath, 'utf8').catch(() => null);
        if (before == null) continue;
        const repair = removeDuplicateImplementationsAtLines(before, lines);
        if (repair.content !== before) {
            await fs.promises.writeFile(absolutePath, repair.content, 'utf8');
            applied.push({
                path: cleanPath,
                type: 'ts2393_duplicate_function_implementation',
                removed: repair.removed,
                from: 'duplicate',
                to: 'single-implementation',
            });
        }
    }

    const cookingStateTs2339 = errors.some((error) =>
        /^src\/main\.ts\(\d+,\d+\):\s*error\s+TS2339:\s*Property '(?:cauldronSlots|pantry|cookingSlots|orderQueue|activeOrder|currentCustomer)' does not exist/.test(String(error || '')));
    if (cookingStateTs2339) {
        const mainPath = path.join(projectRoot, 'src', 'main.ts');
        const before = await fs.promises.readFile(mainPath, 'utf8').catch(() => null);
        if (before != null) {
            const repair = stripCookingStateLeaksFromSource(before, { requiredState: [] });
            if (repair.changed) {
                await fs.promises.writeFile(mainPath, repair.content, 'utf8');
                applied.push({
                    path: 'src/main.ts',
                    type: 'ts2339_cooking_state_leak_stripped',
                    keys: repair.removed,
                    from: repair.removed.join(', '),
                    to: 'removed cooking-only state references',
                });
            }
        }
    }

    const gtDtTs2448 = errors.some((error) =>
        /^src\/main\.ts\(\d+,\d+\):\s*error\s+TS2448:.*\b'dt'\b/.test(String(error || '')));
    if (gtDtTs2448) {
        const mainPath = path.join(projectRoot, 'src', 'main.ts');
        const before = await fs.promises.readFile(mainPath, 'utf8').catch(() => null);
        if (before != null && /__gtUpdate(?:Pickups|Hazards)\(state,\s*dt\)/.test(before)) {
            const after = stripGtWiringDtUpdateHooks(before);
            if (after !== before) {
                await fs.promises.writeFile(mainPath, after, 'utf8');
                applied.push({
                    path: 'src/main.ts',
                    type: 'ts2448_gt_dt_update_hook_stripped',
                    from: '__gtUpdatePickups/Hazards(state, dt) at function entry',
                    to: 'motion advanced inside __gtDrawPickups/Hazards only',
                });
            }
        }
    }

    return applied;
}

async function dedupeMakerMainTsState(projectRoot) {
    const mainPath = path.join(projectRoot || '', 'src', 'main.ts');
    const before = await fs.promises.readFile(mainPath, 'utf8').catch(() => null);
    if (before == null) return [];
    const repair = applyDeterministicStateObjectDedupeRepairs(before);
    if (repair.removed.length === 0) return [];
    await fs.promises.writeFile(mainPath, repair.content, 'utf8');
    return [{
        path: 'src/main.ts',
        type: 'ts1117_duplicate_state_property',
        removed: repair.removed,
        from: repair.removed.join(', '),
        to: 'kept first declaration only',
    }];
}

async function rebuildMakerProjectDistWithAutoRepair(projectRoot) {
    const preBuildDedupe = await dedupeMakerMainTsState(projectRoot);
    if (preBuildDedupe.length > 0) {
        console.warn(`[Maker AutoRepair] Deduped state before build: ${preBuildDedupe[0].removed.join(', ')}`);
    }
    try {
        await rebuildMakerProjectDist(projectRoot);
        return preBuildDedupe;
    } catch (error) {
        const applied = [...preBuildDedupe, ...await applyDeterministicMakerBuildRepairs(projectRoot, error.buildErrors || [])];
        if (applied.length === 0) throw error;
        console.warn(`[Maker AutoRepair] Applied deterministic build fixes: ${applied.map((entry) => `${entry.path}:${entry.from}->${entry.to}`).join(', ')}`);
        await rebuildMakerProjectDist(projectRoot);
        return applied;
    }
}

async function assembleMakerProjectHtmlWithAutoRepair(projectRoot) {
    try {
        await rebuildMakerProjectDistWithAutoRepair(projectRoot);
        return await assembleMakerProjectHtml(projectRoot);
    } catch (error) {
        const applied = await applyDeterministicMakerBuildRepairs(projectRoot, error.buildErrors || []);
        if (applied.length === 0) throw error;
        console.warn(`[Maker AutoRepair] Applied deterministic assemble fixes: ${applied.map((entry) => `${entry.path}:${entry.from}->${entry.to}`).join(', ')}`);
        return assembleMakerProjectHtml(projectRoot);
    }
}

// Module files the 3D multi-file scaffold ships with. Anything else under the gameplay dirs is
// model-authored. If NONE of the model's own modules are reachable from main.ts's import graph,
// the builder wrote its whole game into files that nothing imports (dead code) — so the generic
// STARTER scene (a character in an empty field) ships instead of the requested game. This is a
// static fact that holds even though the headless sandbox can't run WebGL to see the wrong scene.
const SEED_THREE_SCAFFOLD_MODULES = new Set([
    'src/game/Game.ts', 'src/core/Input.ts', 'src/world/World.ts',
    'src/entities/Player.ts', 'src/entities/Pickups.ts',
    'src/systems/Camera.ts', 'src/systems/Hud.ts',
]);

async function assembleMakerProjectHtml(projectRoot) {
    try {
        await normalizeMakerProjectRuntimeDeclarations(projectRoot);
        const backendRoot = path.resolve(__dirname, '..', '..');
        const backendNodeModules = path.join(backendRoot, 'node_modules');
        const projectNodeModules = path.join(projectRoot, 'node_modules');
        
        // Always ensure the symlink is present and correct
        try {
            const stat = await fs.promises.lstat(projectNodeModules).catch(() => null);
            if (!stat || !stat.isSymbolicLink()) {
                if (stat) await fs.promises.rm(projectNodeModules, { recursive: true, force: true });
                if (fs.existsSync(backendNodeModules)) {
                    await fs.promises.symlink(backendNodeModules, projectNodeModules, 'dir');
                }
            }
        } catch (e) {
            console.warn(`[Vite Build] Symlink error in assembleMakerProjectHtml:`, e?.message);
        }

        console.log(`[Vite Build] Building TypeScript project...`);
        const { execSync } = await import('child_process');
        execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
        
        const distIndexHtml = path.join(projectRoot, 'dist', 'index.html');
        let html = await fs.promises.readFile(distIndexHtml, 'utf8');
        return normalizeHtmlDocument(html);
    } catch (e) {
        console.error(`[Vite Build] Failed to assemble Maker project:`, e);
        throw e;
    }
}

async function rebuildMakerProjectDist(projectRoot) {
    const { execSync } = await import('child_process');
    await normalizeMakerProjectRuntimeDeclarations(projectRoot);
    const projectNodeModules = path.join(projectRoot, 'node_modules');
    const backendRoot = path.resolve(__dirname, '..', '..');
    const backendNodeModules = path.join(backendRoot, 'node_modules');

    // Always enforce symlink to backend node_modules so we never have to run npm install per-game.
    // This is instant and ensures all dependencies (vite, tsc, plugins) are globally available.
    try {
        const stat = await fs.promises.lstat(projectNodeModules).catch(() => null);
        if (!stat || !stat.isSymbolicLink()) {
            if (stat) await fs.promises.rm(projectNodeModules, { recursive: true, force: true });
            if (fs.existsSync(backendNodeModules)) {
                await fs.promises.symlink(backendNodeModules, projectNodeModules, 'dir');
            }
        }
    } catch (symlinkErr) {
        console.warn(`[Vite Build] Symlink failed in rebuildMakerProjectDist:`, symlinkErr?.message);
    }

    // Step 1: TypeScript type-check
    try {
        await runMakerProjectTscCheck(projectRoot);
    } catch (tscError) {
        console.error(`[Vite Build] tsc failed (${tscError.buildErrors?.length || 0} errors)`);
        throw tscError;
    }

    // Step 2: Vite build (tsc passed, so this should rarely fail)
    try {
        execSync('npx vite build', { cwd: projectRoot, stdio: 'pipe', timeout: 120_000 });
    } catch (viteError) {
        const stderr = viteError.stderr?.toString?.() || '';
        const stdout = viteError.stdout?.toString?.() || '';
        const rawOutput = (stdout + '\n' + stderr).trim();

        const buildError = new Error(
            `[Vite Build] Vite bundling failed:\n${rawOutput.slice(0, 2000)}`
        );
        buildError.code = 'VITE_BUILD_FAILED';
        // Keep the ACTUAL diagnostic lines, not just lines containing the word "error". Rolldown
        // binding failures (the common @ts-nocheck blind spot) read like
        //   "X" is not exported by "src/entities/Asteroids.ts", imported by "src/game/Game.ts"
        // — which has NO "error" in it, so the old /error/i filter dropped the one line that names
        // the broken import and kept only the useless stack frame (at aggregateBindingErrors...).
        // Drop JS stack frames + blank lines; keep the rest so the repair turn sees what's wrong.
        const diagnosticLines = rawOutput
            .split('\n')
            .map((l) => l.replace(/\s+$/, ''))
            .filter((l) => l.trim() && !/^\s*at\s/.test(l) && !/^\s*node:internal/.test(l));
        // Prefer the lines that pinpoint the fault (module/export/resolve), then fill with the rest.
        const pinpoint = diagnosticLines.filter((l) => /not exported|not defined|could not resolve|cannot find|unresolved|no such|is not defined|\(\d+:\d+\)|RollupError|ParseError/i.test(l));
        buildError.buildErrors = [...new Set([...pinpoint, ...diagnosticLines])].slice(0, 14);
        buildError.rawOutput = rawOutput.slice(0, 4000);
        console.error(`[Vite Build] Vite build failed`);
        throw buildError;
    }

    console.log(`[Vite Build] ✅ Build succeeded`);
}

async function getUserIdFromToken(token, invalidMessage = 'Expired session') {
    if (!token) {
        return null;
    }

    const startedAt = Date.now();
    const userResult = await withTimeout(
        pool.query('SELECT id FROM users WHERE token = $1', [token]),
        12000,
        'Auth lookup'
    );
    console.log(`⏱️ [AI AUTH] Token lookup completed in ${Date.now() - startedAt}ms`);
    if (userResult.rows.length === 0) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }

    return userResult.rows[0].id;
}

/**
 * Snapshot the final (post-agent) maker source into ai_games.maker_project so the game can later be
 * edited ("add this / change this") without a full regenerate. Reads from disk because the in-memory
 * makerProject.files is the pre-edit scaffold; the agent's real edits live on the project root.
 * Additive + best-effort — must never break generation.
 */
async function persistEditableMakerSource(jobId, makerProject, qualityIntent = {}, templateId = 'canvas-kernel') {
    try {
        if (!jobId || !makerProject?.projectRoot) return;
        const root = makerProject.projectRoot;
        // Save the FULL authored source — entry files PLUS the entire src/ tree. Multi-file 3D games
        // keep their game across src/game, src/systems, src/entities, src/world, src/core; saving only
        // main.ts would lose the real game and leave the editor reconstructing the placeholder scaffold.
        const files = await snapshotMakerSourceFiles(root, []);
        if (files.length === 0) return;
        // Also snapshot the materialized art. The materializer writes each asset as a LOCAL file
        // under public/assets/ and the game references those local paths — they vanish with the
        // workspace, so an edit-rebuild would have no art unless we keep them. Store the pack + the
        // image bytes (base64) so the project can be fully reconstructed. (Heavier rows; a future
        // pass can move these to R2 and store URLs instead.)
        const assetDir = path.join(root, 'public', 'assets');
        let assetPack = null;
        const assetFiles = [];
        let assetBytes = 0;
        try {
            const entries = await fs.promises.readdir(assetDir);
            for (const name of entries) {
                if (name === 'asset-pack.json') {
                    assetPack = JSON.parse(await fs.promises.readFile(path.join(assetDir, name), 'utf8'));
                    continue;
                }
                const buf = await fs.promises.readFile(path.join(assetDir, name));
                assetBytes += buf.length;
                assetFiles.push({ file: `assets/${name}`, b64: buf.toString('base64') });
            }
        } catch { /* no materialized assets dir; edit can still patch code-only */ }
        const projectSource = {
            version: 1,
            architecture: templateId || 'canvas-kernel',
            savedAt: new Date().toISOString(),
            title: qualityIntent?.title || null,
            files,
            assetPack,
            assetFiles,
        };
        await pool.query('UPDATE ai_games SET maker_project = $1 WHERE id = $2', [JSON.stringify(projectSource), jobId]);
        console.log(`💾 [EDIT-PREP job=${jobId}] Saved editable source: ${files.length} files + ${assetFiles.length} assets (${Math.round(assetBytes / 1024)}KB)`);
    } catch (error) {
        console.warn(`[EDIT-PREP job=${jobId}] Could not save editable source: ${error?.message || error}`);
    }
}

function startLocalServer(projectRoot) {
    return new Promise((resolve, reject) => {
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
        };

        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            let filePath = path.join(projectRoot, urlPath);
            
            fs.stat(filePath, (err, stats) => {
                if (!err && stats.isDirectory()) {
                    filePath = path.join(filePath, 'index.html');
                }
                
                fs.readFile(filePath, (readErr, data) => {
                    if (readErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('404 Not Found');
                        return;
                    }
                    const ext = path.extname(filePath).toLowerCase();
                    const contentType = mimeTypes[ext] || 'application/octet-stream';
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(data);
                });
            });
        });

        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = address.port;
            console.log(`📡 [Local Sandbox Server] Serving ${projectRoot} on http://127.0.0.1:${port}`);
            resolve({
                url: `http://127.0.0.1:${port}/index.html`,
                close: () => new Promise((closeRes) => server.close(closeRes)),
            });
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Full in-memory snapshot of a generated project, used to roll back a polish turn that made things
 * worse. snapshotMakerSourceFiles() is not usable for this: it only looks at index.html and src/**,
 * while the CLI writes main.js and style.css at the project root.
 *
 * This exists because a critique-driven repair turn is allowed to fail. It re-runs the builder on a
 * game that already boots, and a builder that misunderstands a defect can return a broken one. The
 * rule is that a passing build is never traded for a failing one.
 */
async function snapshotProjectDir(projectRoot, { maxBytes = 6_000_000 } = {}) {
    const files = [];
    let total = 0;
    const walk = async (relDir, depth = 0) => {
        if (depth > 4 || total > maxBytes) return;
        let entries = [];
        try { entries = await fs.promises.readdir(path.join(projectRoot, relDir || '.'), { withFileTypes: true }); }
        catch { return; }
        for (const ent of entries) {
            if (total > maxBytes) return;
            // .kimi-home holds the CLI's config/session state and threejs-skills is a symlink out of
            // the workspace — neither is part of the game, and restoring either would be wrong.
            if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'threejs-skills') continue;
            const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
            if (ent.isDirectory()) { await walk(rel, depth + 1); continue; }
            if (ent.isSymbolicLink()) continue;
            try {
                const content = await fs.promises.readFile(path.join(projectRoot, rel));
                total += content.length;
                files.push({ path: rel, content });
            } catch { /* unreadable — skip */ }
        }
    };
    await walk('', 0);
    return files;
}

async function restoreProjectDir(projectRoot, snapshot) {
    for (const file of snapshot) {
        const full = path.join(projectRoot, file.path);
        await fs.promises.mkdir(path.dirname(full), { recursive: true }).catch(() => {});
        await fs.promises.writeFile(full, file.content).catch(() => {});
    }
}

// Self-contained Claude-style job: prompt → Kimi CLI → files → local verification → R2 upload → Redirect HTML payload.
// Persists to the existing ai_games row and returns the same shape executeDreamJob's non-persist
// path returns. Throws on failure so executeDreamJob's catch marks the job errored.
async function runGameGenerationJob({ jobId, prompt, makerWorkspace, reportProgress, persistToDb, progStartedAt, orientation = DEFAULT_ORIENTATION }) {
    console.log(`🎮 [Game-Gen] Generating game for job ${jobId} (R2 CDN assets, ${orientation})`);
    await reportProgress(12, 'spec', 'Reading your idea...');

    // 1. DIRECTOR PRE-PASS — expand the player's one-liner into a full art-directed brief before the
    //    builder ever runs. Without this the builder receives three words and falls back to its
    //    defaults, and its defaults are untextured primitives. Soft-fails to the plain prompt.
    const { buildDirectorBrief } = await import('./maker-director-brief.js');
    await reportProgress(16, 'spec', 'Art-directing your game...');
    const director = await buildDirectorBrief(prompt, { orientation });
    if (director) {
        await writeMakerText(makerWorkspace, 'logs/director-brief.md', director.text);
        await writeMakerText(makerWorkspace, 'logs/director-brief.json', JSON.stringify(director.brief, null, 2));
    }

    // 2. Build the game prompt (the brief becomes the request when the director produced one).
    const { system, user } = await buildGamePrompt(prompt, orientation, director);
    await writeMakerText(makerWorkspace, 'logs/game-prompt.txt', `${system}\n\n---\n\n${user}`);

    // 2. Setup project folder
    const projectRoot = path.join(makerWorkspace, 'game-project');
    await fs.promises.mkdir(projectRoot, { recursive: true });

    // 3. Execute GameTok AI Generation Loop (DeepSeek-V4-Flash / Qwen3.8-Max + Hardened Sandbox)
    await reportProgress(30, 'build', 'Writing the game with GameTok AI Pipeline...');
    const { runGameTokGenerationLoop } = await import('./gametok-generation-loop.js');
    const finalGameState = await runGameTokGenerationLoop({ prompt, attachments: [] });

    let rawGameHtml = finalGameState.currentCode;
    if (rawGameHtml) {
        await fs.promises.writeFile(path.join(projectRoot, 'index.html'), rawGameHtml, 'utf-8');
    }


    // 5. Sandbox verify. If it crashes, run Kimi CLI self-repair.
    //    captureCritiqueFrames asks for the PNG pairs the visual critic grades in step 5b; it costs
    //    ~2.5s of extra hold time in a browser that is already open.
    await reportProgress(80, 'verify', 'Testing the game...');
    const verifyOptions = { sourceHtml: rawGameHtml, orientation, captureCritiqueFrames: true };
    let finalScreenshot = null;
    let sandboxRes = null;
    try {
        sandboxRes = await verifyGame(localServer.url, verifyOptions);
        finalScreenshot = sandboxRes?.screenshot || null;
    } catch (verifyErr) {
        console.warn(`[Game-Gen] verify skipped: ${verifyErr?.message || verifyErr}`);
    }
    const shouldSelfRepair = sandboxRes && sandboxRes.success === false && !sandboxRes.bypassed && Array.isArray(sandboxRes.crashes) && sandboxRes.crashes.length > 0;
    if (shouldSelfRepair) {
        const firstCrash = String(sandboxRes.crashes[0] || '').slice(0, 800);
        console.log(`🔧 [Game-Gen] Sandbox crashed — running Kimi CLI self-repair. First crash: ${firstCrash}`);
        await reportProgress(85, 'build', 'Fixing a crash with Kimi...');
        const repairPrompt = `
The previous build of this game compiled but crashed during boot in our sandbox with the following error:
${firstCrash}

Please inspect the code files in this directory, fix the bug causing this crash, run "npm run build" to test compilation, and ensure it builds correctly. Exit once you have fixed the error.
`;
        try {
            await runKimiCliAgent(projectRoot, system, repairPrompt);
            const repairedFiles = await snapshotMakerSourceFiles(projectRoot, [], { includeRootGameFiles: true });
            await persistEditableMakerSource(persistToDb ? jobId : null, { projectRoot, files: repairedFiles }, { title: prompt }, 'r2-cdn').catch(() => {});
            rawGameHtml = await fs.promises.readFile(path.join(projectRoot, 'index.html'), 'utf-8').catch(() => rawGameHtml);
            try {
                const rerun = await verifyGame(localServer.url, { ...verifyOptions, sourceHtml: rawGameHtml });
                sandboxRes = rerun || sandboxRes;
                finalScreenshot = rerun?.screenshot || null;
                if (rerun?.success) console.log('✅ [Game-Gen] Kimi self-repair passed sandbox.');
                else console.log(`⚠️ [Game-Gen] Kimi self-repair still fails sandbox: ${String(rerun?.crashes?.[0] || '').slice(0, 200)}`);
            } catch (rerunErr) {
                console.warn(`[Game-Gen] post-repair verify skipped: ${rerunErr?.message || rerunErr}`);
            }
        } catch (repairErr) {
            console.error('⚠️ [Game-Gen] Kimi self-repair failed, shipping original build.', repairErr);
        }
    }

    // 5b. VISUAL CRITIQUE LOOP — the part of the pipeline that actually looks at the game.
    //
    // Up to this point "no crashes" was the entire quality bar, which is how flat-shaded primitives
    // on an empty plane kept shipping. Here a vision model grades real frames from the running game
    // against the director's brief and the visual scorecard, and the builder gets one or two turns
    // to fix the defects it names.
    //
    // Three hard constraints on this loop, in order of importance:
    //   - It never trades a working build for a broken one. Every turn is snapshotted first and
    //     rolled back if the result crashes or loses its frames.
    //   - It is budgeted in wall-clock time, not just turns. Each turn is a full CLI re-run.
    //   - It is entirely optional: no MOONSHOT_API_KEY, no critic, no change to the old behaviour.
    let critiqueLog = [];
    const criticEnabled = String(process.env.GAMETOK_VISUAL_CRITIC || 'true').toLowerCase() !== 'false';
    if (criticEnabled && sandboxRes?.success && !sandboxRes?.bypassed) {
        const { probeProjectSource, critiqueBuild, formatCritiqueForRepair } = await import('./maker-visual-critic.js');
        // 3D games get an extra turn: they have more ways to look wrong and more of them are fixable.
        const is3D = director?.brief?.dimension === '3D';
        const maxTurns = Number(process.env.GAMETOK_CRITIC_MAX_TURNS ?? (is3D ? 2 : 1));
        const budgetMs = Number(process.env.GAMETOK_CRITIC_BUDGET_MS || 6 * 60 * 1000);
        const loopStartedAt = Date.now();

        for (let turn = 1; turn <= maxTurns; turn += 1) {
            const frames = Array.isArray(sandboxRes?.critiqueFrames) ? sandboxRes.critiqueFrames : [];
            if (frames.length === 0) {
                console.log('👁️  [Game-Gen] No frames captured (headless WebGL bypass?) — skipping the critique pass.');
                break;
            }

            await reportProgress(84, 'verify', turn === 1 ? 'Reviewing how it looks...' : 'Re-reviewing the art pass...');
            const sourceProbe = await probeProjectSource(projectRoot).catch(() => null);
            const critique = await critiqueBuild({ frames, brief: director, sourceProbe, orientation });
            if (!critique) break; // critic unavailable — no opinion, ship what we have

            critiqueLog.push({ turn, average: critique.average, verdict: critique.verdict, defects: critique.defects, scores: critique.scores });
            await writeMakerText(makerWorkspace, `logs/critique-${turn}.json`, JSON.stringify(critique, null, 2)).catch(() => {});

            if (critique.verdict === 'ship') {
                console.log(`✅ [Game-Gen] Critic passed the build on turn ${turn} (avg ${critique.average}/3).`);
                break;
            }

            const repairInstructions = formatCritiqueForRepair(critique);
            if (!repairInstructions) {
                console.log('👁️  [Game-Gen] Critic found only minor defects — shipping.');
                break;
            }
            if (Date.now() - loopStartedAt > budgetMs) {
                console.log(`⏱️  [Game-Gen] Critique budget spent (${Math.round((Date.now() - loopStartedAt) / 1000)}s) — shipping turn-${turn} build with ${critique.defects.length} defect(s) outstanding.`);
                break;
            }

            console.log(`🎨 [Game-Gen] Critic turn ${turn}: avg ${critique.average}/3, ${critique.criticalCount} critical — running an art pass.`);
            await reportProgress(86, 'build', 'Improving the visuals...');

            // Snapshot BEFORE handing a working game to another builder turn. A past polish pass in
            // this codebase threw away an already-passing build; that must not be possible here.
            const goodBuild = await snapshotProjectDir(projectRoot);
            const goodHtml = rawGameHtml;
            const goodScreenshot = finalScreenshot;
            const goodSandbox = sandboxRes;

            try {
                await runKimiCliAgent(projectRoot, system, repairInstructions);
                const polishedHtml = await fs.promises.readFile(path.join(projectRoot, 'index.html'), 'utf-8').catch(() => '');
                const rerun = await verifyGame(localServer.url, { ...verifyOptions, sourceHtml: polishedHtml });
                const keptFrames = Array.isArray(rerun?.critiqueFrames) ? rerun.critiqueFrames.length : 0;

                if (rerun?.success && !rerun?.bypassed && keptFrames > 0) {
                    sandboxRes = rerun;
                    rawGameHtml = polishedHtml || rawGameHtml;
                    finalScreenshot = rerun.screenshot || finalScreenshot;
                    const polishedFiles = await snapshotMakerSourceFiles(projectRoot, [], { includeRootGameFiles: true });
                    await persistEditableMakerSource(persistToDb ? jobId : null, { projectRoot, files: polishedFiles }, { title: prompt }, 'r2-cdn').catch(() => {});
                    console.log(`✅ [Game-Gen] Art pass ${turn} kept — build still verifies.`);
                } else {
                    console.warn(`↩️  [Game-Gen] Art pass ${turn} broke the build (${String(rerun?.crashes?.[0] || 'no frames captured').slice(0, 160)}) — rolling back to the last working version.`);
                    await restoreProjectDir(projectRoot, goodBuild);
                    rawGameHtml = goodHtml;
                    finalScreenshot = goodScreenshot;
                    sandboxRes = goodSandbox;
                    break;
                }
            } catch (polishErr) {
                console.warn(`↩️  [Game-Gen] Art pass ${turn} failed to run (${polishErr?.message || polishErr}) — rolling back.`);
                await restoreProjectDir(projectRoot, goodBuild).catch(() => {});
                rawGameHtml = goodHtml;
                finalScreenshot = goodScreenshot;
                sandboxRes = goodSandbox;
                break;
            }
        }
    }

    // Close local HTTP server after verification
    await localServer.close().catch(() => {});

    // 6. Upload static project files to Cloudflare R2
    await reportProgress(90, 'upload', 'Publishing game files to cloud storage...');
    const { uploadGameFolderToR2 } = await import('./r2-uploader.js');
    const publicGameUrl = await uploadGameFolderToR2(jobId, projectRoot);

    const finalHtml = rawGameHtml;
    const finalTitle = resolveDreamGameTitle({ specTitle: null, html: finalHtml, fallback: 'GameTok Game' });

    if (!persistToDb) {
        await reportProgress(100, 'complete', 'Game ready!');
        forgetCancelledJob(jobId);
        return { jobId, title: finalTitle, html: finalHtml, rawHtml: rawGameHtml, screenshot: finalScreenshot, workspace: makerWorkspace, buildMode: 'r2-cdn', gameUrl: publicGameUrl };
    }

    // 7. Persist to the existing ai_games row
    assertJobNotCancelled(jobId);
    await pool.query(
        `UPDATE ai_games
         SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4, game_url = $5
         WHERE id = $6`,
         [finalTitle, finalHtml, rawGameHtml, finalScreenshot, publicGameUrl, jobId]
    );
    const lastCritique = critiqueLog[critiqueLog.length - 1] || null;
    console.log(`✅ [Game-Gen] Complete! "${finalTitle}" saved for job ${jobId}${lastCritique ? ` · critic avg ${lastCritique.average}/3 after ${critiqueLog.length} pass(es), ${lastCritique.defects.length} defect(s) outstanding` : ''}`);
    await recordGenerationTelemetry(jobId, {
        engine: 'r2-cdn',
        dimension: director?.brief?.dimension || null,
        resultTitle: finalTitle,
        durationMs: Date.now() - progStartedAt,
    });
    await reportProgress(100, 'complete', 'Game ready!');
    forgetCancelledJob(jobId);
    pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
        .then((ownerRes) => notifyGameReady(ownerRes.rows[0]?.user_id, jobId, finalTitle))
        .catch((error) => console.log('[Notifications] Game ready notify error:', error));

    return { jobId, title: finalTitle, html: finalHtml, rawHtml: rawGameHtml, screenshot: finalScreenshot, workspace: makerWorkspace, buildMode: 'r2-cdn', gameUrl: publicGameUrl };
}


async function executeDreamJob(jobId, prompt, mediaAttachments = [], jobPayload = {}) {
    const persistToDb = jobPayload?.persistToDb !== false;
    const orientation = normalizeOrientation(jobPayload?.orientation);
    const progressSink = typeof jobPayload?.onProgress === 'function' ? jobPayload.onProgress : null;
    // Progress that never looks frozen. Real milestones snap the bar forward; between them (the long
    // cold-queue first-byte waits and the multi-minute builder stream, where nothing else updates) a
    // background ticker eases the bar toward a ceiling so there is always motion. Monotonic (never
    // ticks backwards), capped at 92 so it can never overwrite the real save/complete events, and
    // self-terminating (unref + 12-min guard) so it needs no cleanup hook in this huge function.
    const PROGRESS_CAP = 92;
    const PROGRESS_HEADROOM = 9;
    let progDisplayed = 0;
    let progCeiling = 0;
    let progLastPushed = -1;
    let progPhase = 'starting';
    let progMessage = '';
    let progTimer = null;
    const progStartedAt = Date.now();
    const stopProgressCreep = () => { if (progTimer) { clearInterval(progTimer); progTimer = null; } };
    const pushProgress = async () => {
        const value = Math.round(progDisplayed);
        if (value === progLastPushed) return;
        progLastPushed = value;
        if (progressSink) {
            await progressSink({ jobId, progress: value, phase: progPhase, statusMessage: progMessage }).catch((error) => {
                console.warn(`[DREAM JOB] Progress sink failed for ${jobId}:`, error?.message || error);
            });
        }
        if (persistToDb) {
            await updateGenerationJobProgress(jobId, value, progPhase, progMessage).catch(() => {});
        }
    };
    const startProgressCreep = () => {
        if (progTimer) return;
        progTimer = setInterval(() => {
            if (progDisplayed >= PROGRESS_CAP || Date.now() - progStartedAt > 12 * 60 * 1000) { stopProgressCreep(); return; }
            if (progDisplayed < progCeiling) {
                // ease ~12% of the remaining gap per tick (min 0.25) so it slows as it nears the ceiling
                progDisplayed = Math.min(progCeiling, progDisplayed + Math.max(0.25, (progCeiling - progDisplayed) * 0.12));
                pushProgress();
            }
        }, 2500);
        if (typeof progTimer.unref === 'function') progTimer.unref();
    };
    const reportProgress = async (progress, phase, statusMessage) => {
        await assertJobNotCancelledShared(jobId);
        if (phase) progPhase = phase;
        if (statusMessage) progMessage = statusMessage;
        if (typeof progress === 'number') {
            progDisplayed = Math.max(progDisplayed, progress);          // snap forward, never backward
            progCeiling = Math.min(PROGRESS_CAP, progress + PROGRESS_HEADROOM);
        }
        await pushProgress();
        if (progDisplayed < PROGRESS_CAP) startProgressCreep();
    };
    let makerWorkspace = null;
    try {
        assertJobNotCancelled(jobId);
        console.log(`🧠 [DREAM JOB] Started game generation for job: ${jobId}`);
        const maker = await createGameTokMakerWorkspace(jobId, prompt, mediaAttachments);
        makerWorkspace = maker.workspace;
        console.log(`📁 [MAKER WORKSPACE] ${makerWorkspace}`);
        await reportProgress(5, 'maker_workspace', 'Opening GameTok maker workspace...');
        // The Kimi CLI is the entire builder: it talks to the user's idea, plans,
        // fetches assets, writes the game, and self-verifies. No pre-planning phases.
        return await runGameGenerationJob({ jobId, prompt, makerWorkspace, reportProgress, persistToDb, progStartedAt, orientation });
    } catch (err) {
        stopProgressCreep();
        if (isCancellationError(err)) {
            console.log(`🛑 [DREAM JOB] Canceled job ${jobId}.`);
            if (persistToDb) { await markJobCanceled(jobId); return; }
            throw err;
        }
        console.error("❌ [DREAM JOB] Error:", err);
        if (makerWorkspace) {
            await writeMakerJson(makerWorkspace, 'gametok-build-report.json', {
                version: 1, jobId, engine: 'r2-cdn', status: 'failed',
                completedAt: new Date().toISOString(), workspace: makerWorkspace,
                error: err?.message || String(err), stack: err?.stack || null,
            }).catch(() => {});
        }
        if (persistToDb) { await markJobError(jobId, 'Game generation failed', err); return; }
        throw err;
    }
}


// Strip a single ```lang ... ``` markdown fence if the builder wrapped its file output.
function stripCodeFences(text) {
    let t = String(text || '').trim();
    const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
    if (fence) return fence[1].trim();
    return t;
}

// Write a list of { path, content } project files under a root, creating parent dirs.
async function writeProjectFilesToRoot(root, files) {
    for (const file of files) {
        if (!file || !file.path) continue;
        const dest = path.join(root, file.path);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, file.content == null ? '' : file.content, 'utf8');
    }
}

// Snapshot a maker project's authored source from disk: the standard entry files PLUS the full src/
// tree. Multi-file 3D games keep their real game across src/game, src/systems, src/entities,
// Static diagnostics over the final generated source. The verifier is BLIND (headless WebGL can't
// boot), so this is how we see what the builder actually shipped without rendering: did it use the
// Kenney models, is it still boxes, and the white-out suspects (createSky elevation, fog color,
// toneMappingExposure from the kernel, bloom, emissive count). Printed into the per-generation log
// and returned by GET /drafts/:id/source so both reads share one source of truth.
function computeMakerSourceDiagnostics(files = []) {
    const list = Array.isArray(files) ? files : [];
    const allCode = list.map((f) => f.content || '').join('\n');
    const first = (re) => { const m = allCode.match(re); return m ? m[1] : null; };
    const KENNEY_KEY_RE = /kenney3d\/[a-z0-9_]+\/[a-z0-9_.-]+\.glb/gi;
    const norm = (s) => String(s).toLowerCase();
    // "Referenced" = the key string appears ANYWHERE in source (arrays, comments, fallback maps, etc.).
    // "Wired" = the key is a literal INSIDE a loadModel(...) call — the real "this model is actually
    // loaded" signal. A key can be referenced but never loaded (sits in a pool the game never pulls
    // from). 3D has NO runtime render gate (sandbox skips it for three.js), so this static wired-count
    // is the best model-usage signal available — caveat: it can't see keys passed via a variable.
    const modelKeysReferenced = [...new Set((allCode.match(KENNEY_KEY_RE) || []).map(norm))];
    const loadModelArgs = (allCode.match(/loadModel\s*\([^)]*\)/gi) || []).join('\n');
    const modelKeysInLoadModel = [...new Set((loadModelArgs.match(KENNEY_KEY_RE) || []).map(norm))];
    const modelKeysReferencedNotLoaded = modelKeysReferenced.filter((k) => !modelKeysInLoadModel.includes(k));
    return {
        fileCount: list.length,
        usesLoadModel: /\bloadModel\s*\(/.test(allCode),
        modelKeysReferenced,
        modelKeysReferencedCount: modelKeysReferenced.length,
        modelKeysInLoadModel,
        modelKeysWiredCount: modelKeysInLoadModel.length,
        modelKeysReferencedNotLoaded,
        usesBoxGeometry: /\bBoxGeometry\b/.test(allCode),
        usesCreateSky: /\bcreateSky\s*\(/.test(allCode),
        skyElevation: first(/createSky\([^)]*elevation\s*:\s*([0-9.]+)/i),
        usesFog: /scene\.fog|new THREE\.Fog|FogExp2/.test(allCode),
        fogColor: first(/Fog(?:Exp2)?\(\s*(0x[0-9a-fA-F]+|['"]#?[0-9a-fA-F]+['"])/),
        usesBloom: /bloom|UnrealBloom/i.test(allCode),
        toneMappingExposure: first(/toneMappingExposure\s*=\s*([0-9.]+)/),
        emissiveCount: (allCode.match(/emissive/gi) || []).length,
    };
}

// src/world and src/core — saving only main.ts would lose the game and leave the editor reconstructing
// the bare placeholder scaffold. priorFiles re-reads any path that existed before, even outside src/.
// Files the Kimi CLI lane writes at the project ROOT that are scaffolding, not game source. The
// package.json is the dummy `"build": "echo 'Build successful'"` stub the runner writes so the agent
// has something to verify against, and instructions.txt is the prompt itself — persisting either as
// "the game's source" would be actively misleading in the editor and the source inspector.
const ROOT_SNAPSHOT_EXCLUDES = new Set(['package.json', 'package-lock.json', 'instructions.txt']);

/**
 * @param {string} projectRoot
 * @param {Array}  priorFiles              Paths to re-read even if they live outside src/.
 * @param {object} [options]
 * @param {boolean} [options.includeRootGameFiles]
 *        Also capture game source sitting at the project root (main.js, style.css, js/*.js …).
 *        Off by default: the kernel lanes keep their game under src/ and reconstruct the rest of the
 *        project from a scaffold, so sweeping in root files there would persist build config that
 *        the editor would later write back over the scaffold's own copy.
 *        The Kimi CLI lane is the opposite — it is TOLD to write index.html + main.js + style.css at
 *        the root, so without this flag the "editable source" it saved was the HTML shell alone,
 *        with the entire game logic missing.
 */
async function snapshotMakerSourceFiles(projectRoot, priorFiles = [], options = {}) {
    const files = [];
    const seen = new Set();
    const pushFile = async (rel) => {
        if (!rel || seen.has(rel)) return;
        try {
            const content = await fs.promises.readFile(path.join(projectRoot, rel), 'utf8');
            files.push({ path: rel, content });
            seen.add(rel);
        } catch { /* file may not exist for this game; skip */ }
    };
    for (const rel of ['index.html', 'src/main.ts', 'src/main.js', 'src/styles.css', 'src/style.css', 'src/assetKeys.ts']) await pushFile(rel);
    for (const f of (Array.isArray(priorFiles) ? priorFiles : [])) await pushFile(f?.path);
    const walkSrc = async (relDir) => {
        let entries = [];
        try { entries = await fs.promises.readdir(path.join(projectRoot, relDir), { withFileTypes: true }); }
        catch { return; }
        for (const ent of entries) {
            const rel = `${relDir}/${ent.name}`;
            if (ent.isDirectory()) { await walkSrc(rel); continue; }
            if (/\.(js|jsx|ts|tsx|css|json|glsl|vert|frag)$/i.test(ent.name)) await pushFile(rel);
        }
    };
    await walkSrc('src');

    if (options.includeRootGameFiles) {
        const walkRoot = async (relDir, depth) => {
            if (depth > 2) return;
            let entries = [];
            try { entries = await fs.promises.readdir(path.join(projectRoot, relDir || '.'), { withFileTypes: true }); }
            catch { return; }
            for (const ent of entries) {
                // src/ is already covered above; .kimi-home is CLI session state; threejs-skills is a
                // symlink to the shared skills pack, not part of the game.
                if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'src' || ent.name === 'threejs-skills') continue;
                const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
                if (ent.isDirectory()) { await walkRoot(rel, depth + 1); continue; }
                if (ent.isSymbolicLink()) continue;
                if (!relDir && ROOT_SNAPSHOT_EXCLUDES.has(ent.name)) continue;
                if (/\.(js|mjs|jsx|ts|tsx|css|json|glsl|vert|frag|html)$/i.test(ent.name)) await pushFile(rel);
            }
        };
        await walkRoot('', 0);
    }

    return files;
}

/**
 * Edit an existing canvas-kernel game from its saved source (ai_games.maker_project).
 *
 * Reconstructs the project on disk (kernel scaffold + saved source + saved art), asks the builder to
 * apply ONLY the user's change to src/main.ts, rebuilds, and sandbox-verifies. Saves to the row ONLY
 * on a clean build — a failed edit throws and never touches the original game. On success the new
 * main.ts is re-snapshotted into maker_project so edits chain.
 */
async function executeMakerEditJob(newJobId, parentDraftId, parentDraft, makerProject, instructions, orientation = DEFAULT_ORIENTATION) {
    const savedTemplateId = makerProject.architecture || 'canvas-kernel';
    console.log(`🛠️ [MAKER EDIT] job ${newJobId} editing ${savedTemplateId} game ${parentDraftId}: "${instructions}"`);
    const savedFiles = Array.isArray(makerProject.files) ? makerProject.files : [];
    const currentMain = (savedFiles.find((f) => f.path === 'src/main.ts') || {}).content;
    if (!currentMain) throw new Error('Saved project has no src/main.ts to edit.');

    // Guard: a multi-file 3D game saved before full-source snapshotting kept only main.ts — its real
    // modules (game/, systems/, entities/, world/, core/) were never saved. main.ts still imports them,
    // so reconstructing would fall back to the placeholder scaffold and an edit would OVERWRITE the game
    // with a stub. Refuse rather than destroy it. (True single-file 3D games import no local modules and
    // pass this guard fine.)
    if (savedTemplateId === 'threejs-kernel'
        && /from\s+['"]\.{1,2}\/(game|systems|entities|world|core)\//.test(currentMain)
        && !savedFiles.some((f) => /^src\/(game|systems|entities|world|core)\//.test(f.path || ''))) {
        throw new Error('This 3D game was created before multi-file edit support and its full source was not saved. Please regenerate it to enable editing.');
    }

    // Progress for the edit (surfaced by the status endpoint's pending response; merges into the
    // ephemeral job so status/draftId set by executeEditJob are preserved).
    const setEditProgress = (p, msg) => markEphemeralJob(newJobId, {
        status: 'pending', draftId: parentDraftId, progress: p, statusMessage: msg,
    });
    setEditProgress(10, 'Loading your saved game…');

    // 1. Reconstruct the project: kernel scaffold, overlaid with saved source, plus saved art bytes.
    const maker = await createGameTokMakerWorkspace(newJobId, instructions);
    const workspace = maker.workspace;
    const projectRoot = path.join(workspace, 'project');
    const kernel = await loadMakerTemplateScaffold(savedTemplateId);
    const byPath = new Map((kernel && kernel.files ? kernel.files : []).map((f) => [f.path, f.content]));
    for (const f of savedFiles) byPath.set(f.path, f.content); // saved source wins over the bare scaffold
    await writeProjectFilesToRoot(projectRoot, [...byPath.entries()].map(([p, c]) => ({ path: p, content: c })));

    const assetDir = path.join(projectRoot, 'public', 'assets');
    await fs.promises.mkdir(assetDir, { recursive: true });
    if (makerProject.assetPack) {
        await fs.promises.writeFile(path.join(assetDir, 'asset-pack.json'), JSON.stringify(makerProject.assetPack), 'utf8');
    }
    for (const a of (Array.isArray(makerProject.assetFiles) ? makerProject.assetFiles : [])) {
        if (!a || !a.file || !a.b64) continue;
        const dest = path.join(projectRoot, 'public', a.file);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, Buffer.from(a.b64, 'base64'));
    }
    console.log(`🛠️ [MAKER EDIT] reconstructed project: ${byPath.size} files + ${(makerProject.assetFiles || []).length} assets at ${projectRoot}`);
    setEditProgress(28, 'Rebuilding the project…');

    // 2. Apply the edit. 3D games are MULTI-FILE — the real game lives across src/game, src/systems,
    //    src/entities, src/world and src/core — so edit them with the multi-file tool agent (it carries
    //    the 3D gameplay laws). 2D canvas games keep the single-shot main.ts rewrite.
    const assetKeys = (savedFiles.find((f) => f.path === 'src/assetKeys.ts') || {}).content || '';
    const is3D = savedTemplateId === 'threejs-kernel';

    // Mini-creeper around the long builder wait so the progress bar never freezes. unref()'d + cleared.
    setEditProgress(34, 'Applying your change…');
    let editCreep = 34;
    const editCreepTimer = setInterval(() => {
        if (editCreep < 62) {
            editCreep = Math.min(62, editCreep + 2);
            markEphemeralJob(newJobId, { status: 'pending', draftId: parentDraftId, progress: Math.round(editCreep), statusMessage: 'Applying your change…' });
        }
    }, 1500);
    if (typeof editCreepTimer.unref === 'function') editCreepTimer.unref();
    try {
        if (is3D) {
            const editPrompt = [
                formatMakerSystemManual('fileAgent'),
                '',
                'You are editing an existing, working mobile 3D game built on the GameTok threejs-kernel.',
                'Apply ONLY the change requested. Preserve everything else: gameplay, world, entities, camera, layout, look and asset usage.',
                `EDIT REQUEST: "${instructions}"`,
                '',
                buildThreeDRulesBlock(null),
                '',
                'Hard rules:',
                '- This game is MULTI-FILE: the real game lives across src/game/Game.ts, src/systems/*, src/entities/*, src/world/* and src/core/* — NOT just src/main.ts. Read the relevant files and edit wherever the change belongs. main.ts is a thin entry; never cram gameplay into it.',
                '- Use the tools (read_file, write_file, apply_patch) to make the change across whatever files are needed. Keep tsc clean after each edit.',
                '- Keep createThreeStage() and the kernel structure intact, and keep the probe API (window.__GAMETOK_TEMPLATE_PROBE__) working. Do NOT edit the read-only kernel files (src/threeAssets.ts, src/bootstrap.ts, src/assetLoader.ts).',
                '- Only reference asset keys that already exist in src/assetKeys.ts. Do not invent new art.',
                '- When the change is complete and tsc is clean, call finish_inspection.',
                '',
                '--- src/assetKeys.ts (available asset keys) ---',
                assetKeys.slice(0, 4000),
            ].join('\n');
            const assetKeyCount = (assetKeys.match(/['"][A-Za-z0-9_]+['"]\s*:/g) || []).length;
            const toolTurn = await runMakerAgentToolTurn({
                userPrompt: editPrompt,
                projectRoot,
                mode: MAKER_AGENT_TURN_MODE_IMPLEMENT,
                assetKeyCount,
                requestCompletion: (messages) => requestMakerToolCompletion(messages, {
                    label: 'Maker Edit 3D (multi-file)',
                    jobId: newJobId,
                    timeoutMs: MAKER_IMPLEMENT_TIMEOUT_MS,
                    maxAttempts: 2,
                    maxTokens: MAKER_IMPLEMENT_MAX_TOKENS,
                    fallbackModels: MAKER_IMPLEMENT_FALLBACK_MODELS,
                    reasoningEffort: MAKER_IMPLEMENT_REASONING_EFFORT,
                    mode: MAKER_AGENT_TURN_MODE_IMPLEMENT,
                }),
                helpers: {
                    safeMakerProjectPath,
                    isProtectedMakerRuntimeFile,
                    sanitizeMakerMainTsContent,
                    runTscCheck: (root) => runMakerProjectTscCheck(root, { timeoutMs: 45_000 }),
                },
                onEditApplied: (edit) => console.log(`✏️ [MAKER EDIT 3D] ${edit.tool} ${edit.path}`),
            });
            console.log(`🛠️ [MAKER EDIT] 3D multi-file turn applied ${toolTurn.editsApplied?.length || 0} edit(s)`);
            if (!toolTurn.editsApplied || toolTurn.editsApplied.length === 0) {
                throw new Error('3D edit made no changes — the model did not edit any file.');
            }
        } else {
            const editPrompt = [
                formatMakerSystemManual('fileAgent'),
                '',
                `You are editing an existing, working mobile HTML5 game built on the GameTok ${savedTemplateId}.`,
                'Apply ONLY the change below. Preserve everything else: gameplay, layout, the existing UI kit/look, and asset usage.',
                `EDIT REQUEST: "${instructions}"`,
                '',
                'Hard rules:',
                '- Keep the kernel structure and the probe API (window.__GAMETOK_TEMPLATE_PROBE__) intact.',
                '- Only reference asset keys that already exist in src/assetKeys.ts (below). Do not invent new art.',
                '- Keep the premium UI helpers (solid cards via drawPanel, drawValue for numbers, drawToken for pieces).',
                '- Return ONLY the complete, updated contents of src/main.ts. No markdown fences, no commentary.',
                '',
                '--- src/assetKeys.ts (available asset keys) ---',
                assetKeys.slice(0, 4000),
                '',
                '--- CURRENT src/main.ts (edit this) ---',
                currentMain,
            ].join('\n');
            const { text } = await requestBuilderMessage(editPrompt, { label: 'Maker Edit main.ts', jobId: newJobId });
            const newMain2D = stripCodeFences(text);
            if (!newMain2D || newMain2D.length < 200 || !/__GAMETOK_TEMPLATE_PROBE__/.test(newMain2D)) {
                throw new Error('Edit builder returned an invalid main.ts (missing probe API or too short).');
            }
            await fs.promises.writeFile(path.join(projectRoot, 'src', 'main.ts'), newMain2D, 'utf8');
        }
    } finally {
        clearInterval(editCreepTimer);
    }
    setEditProgress(66, 'Applying your change…');
    // After either path, src/main.ts must still exist and expose the probe API.
    const newMain = await fs.promises.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8').catch(() => '');
    if (!newMain || newMain.length < 120 || !/__GAMETOK_TEMPLATE_PROBE__/.test(newMain)) {
        throw new Error('Edited project is missing a valid src/main.ts probe API.');
    }

    // 2b. Re-run the asset-wiring pass so an edit can't silently drop the background or other
    //     required art. When the builder rewrites main.ts to apply a change it sometimes forgets to
    //     re-draw the generated background (a code grid appears instead). This re-injects the safe
    //     contract/background wiring if it's missing — edits stay non-destructive to art. Keys are
    //     read from the reconstructed asset-pack.json, so no contract/generatedAssets needed.
    if (!is3D) {
        try {
            const wiring = await applyMainTsAssetWiringRepairs(projectRoot, {});
            const repairs = wiring && wiring[0] && wiring[0].repairs ? wiring[0].repairs : [];
            if (repairs.length) {
                console.log(`🛠️ [MAKER EDIT] re-applied asset wiring after edit: ${repairs.join(', ')}`);
            }
        } catch (e) {
            console.warn(`🛠️ [MAKER EDIT] asset-wiring re-pass skipped: ${e?.message || e}`);
        }
    }

    // 3. Rebuild + sandbox-verify. Save ONLY on a clean build.
    setEditProgress(80, 'Rebuilding…');
    const rawHtml = await assembleMakerProjectHtmlWithAutoRepair(projectRoot);
    let finalHtml = rawHtml;
    try { finalHtml = postProcessRawHtml(rawHtml); } catch (e) {
        console.warn(`🛠️ [MAKER EDIT] postProcess skipped (${e?.message || e}); using raw assembled HTML.`);
    }
    setEditProgress(90, 'Testing it still plays…');
    let sandboxRes;
    try {
        sandboxRes = await verifyGame(finalHtml, { orientation });
    } catch (e) {
        sandboxRes = { success: false, crashes: [e?.message || String(e)], screenshot: null };
    }
    if (!sandboxRes.success && sandboxRes.crashes && sandboxRes.crashes.length) {
        throw new Error(`Edited game failed sandbox verification: ${sandboxRes.crashes[0]}`);
    }

    // 4. Persist (success only): new HTML + re-snapshot source (new main.ts) + edit history. Original
    //    row is left untouched if anything above threw, so a bad edit can never corrupt the game.
    const updatedFiles = is3D
        ? await snapshotMakerSourceFiles(projectRoot, savedFiles)
        : savedFiles.map((f) => (f.path === 'src/main.ts' ? { ...f, content: newMain } : f));
    const updatedProject = { ...makerProject, files: updatedFiles, savedAt: new Date().toISOString() };
    let editHistory = parentDraft.edit_history;
    if (typeof editHistory === 'string') { try { editHistory = JSON.parse(editHistory); } catch { editHistory = []; } }
    if (!Array.isArray(editHistory)) editHistory = [];
    const newHistory = [...editHistory, instructions];
    setEditProgress(96, 'Saving…');
    await pool.query(
        `UPDATE ai_games
         SET html_payload = $1, thumbnail = $2, edit_history = $3, maker_project = $4
         WHERE id = $5`,
        [finalHtml, sandboxRes.screenshot || null, JSON.stringify(newHistory), JSON.stringify(updatedProject), parentDraftId]
    );
    markEphemeralJob(newJobId, { status: 'complete', draftId: parentDraftId });
    console.log(`✅ [MAKER EDIT] job ${newJobId} applied edit to ${parentDraftId} (main.ts ${currentMain.length}->${newMain.length} chars, history=${newHistory.length})`);
}

async function executeEditJob(newJobId, parentDraftId, instructions, mediaAttachments = []) {
    try {
        console.log(`🚀 [EDIT JOB] Starting edit job ${newJobId} based on parent ${parentDraftId}`);
        markEphemeralJob(newJobId, { status: 'pending', draftId: parentDraftId });
        
        // 1. Fetch parent draft with all context
        const parentRes = await pool.query('SELECT prompt, raw_code, html_payload, artist_code, title, edit_history, maker_project, orientation FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");

        const parentDraft = parentRes.rows[0];
        // Orientation is read off the row, never taken from the client. An edit must not be able to
        // reshape a landscape game into a portrait one — the verifier would then check it in the
        // wrong box and the feed would still rotate it.
        const orientation = normalizeOrientation(parentDraft.orientation);

        // New-architecture (canvas-kernel) games: edit the saved source, not the compiled HTML.
        let savedProject = parentDraft.maker_project;
        if (typeof savedProject === 'string') {
            try { savedProject = JSON.parse(savedProject); } catch { savedProject = null; }
        }
        if (savedProject && Array.isArray(savedProject.files) && savedProject.files.some((f) => f.path === 'src/main.ts')) {
            return await executeMakerEditJob(newJobId, parentDraftId, parentDraft, savedProject, instructions, orientation);
        }

        // Games from the Kimi CLI lane are SERVED from their uploaded R2 folder via game_url — the
        // player never loads html_payload. The HTML-string editor below rewrites html_payload and
        // raw_code and stops there: it re-uploads nothing, so the edit is invisible in the feed, and
        // for a multi-file game it would be editing the shell while the logic sits untouched in
        // main.js. Both failure modes are silent, which is worse than refusing. Editing these needs
        // its own path: rebuild the project from savedProject.files, run a CLI edit turn, re-verify,
        // and re-upload to R2 with a fresh game_url.
        if (savedProject?.architecture === 'r2-cdn') {
            throw new Error('Editing is not supported yet for games built by the CLI lane — the game is served from its uploaded folder, so an edit here would not change what players see. Please generate a new game instead.');
        }
        const existingHtml = parentDraft.artist_code
            ? (parentDraft.html_payload || '')
            : (parentDraft.raw_code || parentDraft.html_payload || '');
        const editHistory = Array.isArray(parentDraft.edit_history) ? parentDraft.edit_history : [];
        const priorInstructions = editHistory.slice(-6);

        if (!existingHtml || existingHtml.length < 100) {
            throw new Error(`Parent draft has no usable code!`);
        }
        
        if (existingHtml.includes('__GAMETOK_TEMPLATE_PROBE__') || existingHtml.includes('GAMETOK_MAKER') || existingHtml.includes('vite-plugin-singlefile')) {
            throw new Error("Direct editing is not yet supported for OpenGame Maker architecture games. Please generate a new game instead.");
        }

        console.log(`📊 [EDIT JOB] Parent "${parentDraft.title}" — html: ${existingHtml.length} chars, history: ${editHistory.length} past edits`);

        // 2. Search for NEW assets based on edit instructions
        console.log(`🔍 [EDIT JOB] Searching for assets matching edit request: "${instructions}"`);
        const editAssetBundle = {
            visuals: mergeAssetGroups(
                rankKenneyAssets(instructions, { desiredRoles: ['player', 'enemy', 'environment', 'prop'], desiredKinds: ['sprite', 'character', 'environment'], limit: 30 }),
                rankPhaserAssets(instructions, { desiredRoles: ['player', 'enemy', 'environment', 'prop'], desiredKinds: ['sprite', 'character', 'environment'], limit: 30 })
            ),
            controls: mergeAssetGroups(
                rankKenneyAssets(instructions, { desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 15 }),
                rankPhaserAssets(instructions, { desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 15 })
            ),
            audio: mergeAssetGroups(
                rankKenneyAssets(instructions, { desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 20 }),
                rankPhaserAssets(instructions, { desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 20 })
            ),
            models: rankPhaserAssets(instructions, { desiredKinds: ['model'], runtime: 'threejs', limit: 15 }),
            notes: [`Assets searched based on edit request: "${instructions}"`],
            lane: 'edit_request'
        };
        
        const assetCount = editAssetBundle.visuals.length + editAssetBundle.controls.length + editAssetBundle.audio.length + editAssetBundle.models.length;
        console.log(`📦 [EDIT JOB] Found ${assetCount} relevant assets for edit request`);

        const attachmentSummary = buildMediaAttachmentSummary(mediaAttachments);
        const assetKitBlock = buildAssetKitBlock(editAssetBundle);
        const enrichedInstructions = [
            `Apply this user edit request to the current game: "${instructions}"`,
            '',
            'Requirements:',
            '- Keep the game playable on mobile.',
            orientation === 'landscape'
                ? '- This game is LANDSCAPE: it runs in a WIDE, SHORT viewport (roughly 844x390). Keep the layout horizontal and the HUD in the corners. Do NOT reflow it into a tall portrait layout, and do NOT add rotation or "please rotate your device" handling.'
                : '- This game is PORTRAIT: it runs in a TALL, NARROW viewport (roughly 390x844). Keep the layout vertical. Do NOT reflow it into a wide landscape layout.',
            '- Preserve the existing game identity unless the instruction explicitly changes it.',
            '- Return the COMPLETE updated HTML document.',
            '- Do not rename the game unless the instruction explicitly asks for it.',
            '- Do not remove working controls, HUD, or core gameplay unless requested.',
            '',
            assetKitBlock,
            '',
            attachmentSummary
                ? `User-provided media to use if practical:\n${attachmentSummary}`
                : 'No user-provided media attachments were included for this edit.',
            priorInstructions.length
                ? `Recent accepted edits to keep consistent with:\n${priorInstructions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
                : 'There are no prior edits to preserve beyond the current HTML itself.'
        ].join('\n');

        console.log(`🤖 [EDIT JOB] Sending single-file edit request to ${DREAM_MODELS.premiumBuilder}...`);
        let editedHtml = await generateCompleteHtmlWithBuilder(
            buildPhase2_EditGame(existingHtml, enrichedInstructions, undefined, mediaAttachments),
            { label: 'Edit Builder Pass' }
        );

        if (!editedHtml) {
            throw new Error('Edit builder returned empty HTML.');
        }
        if (!hasClosedHtmlDocument(editedHtml)) {
            throw new Error('Edit builder output is missing </html>.');
        }

        let finalHtml = postProcessRawHtml(editedHtml);
        let finalScreenshot = null;
        let maxRetries = 2;
        let stable = false;

        while (maxRetries >= 0 && !stable) {
            console.log(`📸 [EDIT JOB] Verifying edited game...`);
            let sandboxRes;
            try {
                sandboxRes = await verifyGame(finalHtml, {
                    runtimeLane: wantsFirstPerson3D(existingHtml, {}) ? 'first_person_threejs' : null,
                    orientation,
                });
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }

            finalScreenshot = sandboxRes.screenshot || null;
            if (sandboxRes.success || !sandboxRes.crashes?.length) {
                stable = true;
                break;
            }

            if (maxRetries === 0) {
                throw new Error(`Edited game failed sandbox verification: ${sandboxRes.crashes[0]}`);
            }

            console.log(`⚠️ [EDIT JOB] Edited build crashed. Repairing with main builder... (${sandboxRes.crashes[0]})`);
            const repairPrompt = `The mobile HTML5 game below failed verification after an edit.
FATAL ERROR: ${sandboxRes.crashes[0]}

You must rewrite the FULL HTML document so it boots and remains playable.
Preserve the user's requested edit:
"${instructions}"
${attachmentSummary ? `\nUser-provided media to preserve or apply if practical:\n${attachmentSummary}\n` : ''}

BROKEN HTML:
\`\`\`html
${editedHtml}
\`\`\`

Output ONLY the complete fixed HTML document.`;

            editedHtml = await generateCompleteHtmlWithBuilder(repairPrompt, { label: 'Edit Builder Repair' });
            if (!hasClosedHtmlDocument(editedHtml)) {
                throw new Error('Edit repair output is missing </html>.');
            }
            finalHtml = postProcessRawHtml(editedHtml);
            maxRetries--;
        }

        const finalTitle = (extractHtmlTitle(editedHtml) || parentDraft.title.replace(/^Remix of /i, '') || 'DreamStream Game').substring(0, 255);

        // 5. Save with updated edit history (memory for next edit)
        const newHistory = [...editHistory, instructions];
        await pool.query(
            `UPDATE ai_games
             SET title = $1,
                 html_payload = $2,
                 raw_code = $3,
                 artist_code = $4,
                 thumbnail = $5,
                 preview_video_url = $6,
                 edit_history = $7
             WHERE id = $8`,
            [
                finalTitle,
                finalHtml,
                editedHtml,
                null,
                finalScreenshot,
                null,
                JSON.stringify(newHistory),
                parentDraftId,
            ]
        );
        markEphemeralJob(newJobId, { status: 'complete', draftId: parentDraftId });
        console.log(`✅ [EDIT JOB] Edit complete for job ${newJobId} -> updated draft ${parentDraftId} (history now has ${newHistory.length} edits)`);

    } catch (err) {
        console.error("❌ [EDIT JOB] Error:", err);
        markEphemeralJob(newJobId, {
            status: 'error',
            draftId: parentDraftId,
            error: err?.message || 'DreamStream edit failed',
        });
    }
}

router.post('/generate-asset', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({error: "prompt required"});
        
        console.log(`🎨 Manual Asset Request: "${prompt}"`);
        const finalPrompt = `${prompt}, 2d casual mobile game asset graphic, vibrant, flat vector style, simple clean background`;
        const safePrompt = encodeURIComponent(finalPrompt);
        const seed = Math.floor(Math.random() * 1000000);
        const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=512&height=512&nologo=true&seed=${seed}`;
        
        console.log(`🖼️ Tracking blazing fast AI image from Pollinations: ${prompt}`);
        
        // Let's verify it works
        const imgRes = await fetch(url);
        if (!imgRes.ok) {
            return res.status(500).json({ error: "Failed to generate AI image. Try again." });
        }
        
        // Push directly to the global community pool dynamically so it shares everywhere
        const ASSETS_JSON_PATH = path.join(process.cwd(), 'public/uploads/community-assets.json');
        let communityAssets = [];
        if (fs.existsSync(ASSETS_JSON_PATH)) {
            try { communityAssets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, 'utf-8')); } catch (e) {}
        }
        
        communityAssets.unshift({
            id: `ai-${Date.now()}-${seed}`,
            type: 'image',
            url: url,
            thumb: url,
            title: `AI Generated: ${prompt}`,
            label: prompt,
            instruction: `Use this AI generated asset image: ${url}`
        });
        
        fs.writeFileSync(ASSETS_JSON_PATH, JSON.stringify(communityAssets, null, 2));

        // Return the pure remote URL instead of base64
        return res.json({ success: true, imageUrl: url });
    } catch(e) {
        console.error("Asset Gen Error:", e);
        res.status(500).json({ error: "System Error" });
    }
});

function buildFallbackGameSpec(prompt) {
    const cleanPrompt = String(prompt || '').trim();
    const lowerPrompt = cleanPrompt.toLowerCase();
    let title = '';
    if (lowerPrompt.includes('artillery') || lowerPrompt.includes('tank')) {
        title = 'Tank Tactics';
    } else if (lowerPrompt.includes('lunar') || lowerPrompt.includes('lander')) {
        title = 'Lunar Lander';
    }
    const words = cleanPrompt
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 3);
    if (!title) {
        title = words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ') : 'Your Game';
    }
    const description = cleanPrompt
        ? `${cleanPrompt.slice(0, 180)}${cleanPrompt.length > 180 ? '...' : ''}`
        : 'A fast, playable mobile game built from your idea.';

    return {
        title,
        description,
        features: [
            'Clear tap-friendly controls.',
            'A satisfying core gameplay loop.',
            'Mobile-first pacing and feedback.',
        ],
    };
}

// === GAME SPEC GENERATION ===
router.post('/generate-spec', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });

        const fallbackSpec = buildFallbackGameSpec(prompt);

        let spec = fallbackSpec;
        let usedFallback = false;
        let warning;
        try {
            // Kimi writes the pitch — the same model that builds the game, so the
            // plan the user approves is the plan the builder already understands.
            const parsed = await callKimiJson({
                systemPrompt: `You are a senior mobile game designer writing the pre-create concept card for a game generation app.
Your copy must feel specific, confident, and product-quality.

${formatUnitySpecPromptBlock()}

Return ONLY valid JSON in this exact format:
{
  "title": "Catchy Title (2-3 words max)",
  "structural": "3-5 word structural phrase naming dimension + perspective + genre (e.g. '3D chase-cam racer', 'top-down arena shooter', 'side-view endless runner')",
  "description": "1-2 polished sentences describing the specific core loop and player fantasy. The FIRST sentence must contain the structural phrase verbatim.",
  "features": ["Feature 1 (one short sentence)", "Feature 2 (one short sentence)"]
}

Rules:
- Title must be 2-3 words maximum
- The structural phrase is the most load-bearing choice (2D vs 3D, camera, genre) — commit to the obvious default for the concept and state it as a decision, never hedge
- Description must be under 240 characters and its first sentence must include the structural phrase word-for-word
- Features must be 2-3 items, each one short sentence
- Do not use generic filler like "strategy is key", "satisfying gameplay", or "clear controls"
- Do not invent multiplayer, online play, customization, shops, campaigns, upgrades, or extra modes unless the user explicitly requested them
- Every feature must be a real implied mechanic from the prompt
- Prefer concrete verbs and systems: aim, charge, fire, land, dodge, draw, split, ricochet, survive
- Make it sound like a polished store-quality game pitch without overpromising`,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 250,
                temperature: 0.8,
            });
            spec = { ...fallbackSpec, ...parsed };
        } catch (error) {
            console.warn('[GENERATE SPEC] Falling back after model failure:', error?.message || error);
            usedFallback = true;
            warning = error?.message || 'Spec model unavailable';
        }

        res.json({
            success: true,
            spec,
            ...(usedFallback ? { fallback: true, warning } : {}),
        });

    } catch (error) {
        console.error('[GENERATE SPEC] Error:', error);
        res.status(500).json({ error: error.message || 'Spec generation failed' });
    }
});

function buildFallbackEditIntent(instructions) {
    const clean = String(instructions || '').trim();
    const lower = clean.toLowerCase();
    const needsBackgroundClarification = lower.includes('background') &&
        !/(original|same|neon|city|space|forest|sky|night|day|dark|light|animated|pixel|cartoon|ocean|street)/i.test(clean);
    return {
        summary: clean || 'Update the game',
        finalInstruction: clean || 'Apply the requested edit to the existing game.',
        reply: needsBackgroundClarification
            ? 'Sure — what kind of background do you want? Pick one or describe it.'
            : (clean ? "Got it — I'll fold that into the edit. Add any details, or hit Apply." : "Tell me what you'd like to change about the game."),
        needsClarification: needsBackgroundClarification,
        question: needsBackgroundClarification
            ? 'What kind of background should I add back?'
            : null,
        suggestions: needsBackgroundClarification
            ? ['Original', 'Match the game', 'Neon', 'Space', 'Surprise me']
            : [],
        confidence: needsBackgroundClarification ? 'medium' : 'high',
    };
}

// === EDIT INTENT INTERPRETATION ===
router.post('/interpret-edit', async (req, res) => {
    try {
        const { instructions, gameTitle, currentSummary, conversationHistory } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        if (!instructions) return res.status(400).json({ error: 'instructions is required' });

        const fallback = buildFallbackEditIntent(instructions);

        // Prior turns of this refine chat, so the AI actually holds a conversation instead of
        // re-interpreting each message in isolation. Newest-last, capped.
        const historyMessages = (Array.isArray(conversationHistory) ? conversationHistory : [])
            .slice(-10)
            .map((m) => ({
                role: m && m.role === 'assistant' ? 'assistant' : 'user',
                content: String((m && (m.content ?? m.text)) || '').slice(0, 800),
            }))
            .filter((m) => m.content);
        let intent = fallback;
        let usedFallback = false;
        try {
            const parsed = await callKimiJson({
                systemPrompt: `You are the in-chat edit assistant inside GameTok's Dream Forge. You are having a short, friendly CONVERSATION with a user who wants to change their EXISTING game. Talk like a sharp, encouraging game-dev buddy: actually react to what they say — answer their questions, riff with them, confirm, or ask ONE clarifying question. Never invent a brand-new game.

Return ONLY valid JSON in this exact format:
{
  "reply": "Your natural, conversational message to the user (1-2 sentences). THIS is what they read in the chat. Actually respond to their latest message — never a canned line.",
  "summary": "Plain-language summary of the edit so far, under 80 characters",
  "finalInstruction": "Precise instruction for an AI game editor, preserving the existing game unless explicitly changed",
  "needsClarification": true/false,
  "question": "One natural follow-up question, or null",
  "suggestions": ["Short chip", "Short chip"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- "reply" MUST genuinely answer/acknowledge their latest message in context. If they ask a question, ANSWER it. If they're vague, ask. NEVER output a generic "Perfect, I'll fold that in" when it doesn't fit what they said.
- Use the conversation so far for context and build the edit up across turns.
- If the request is clear, needsClarification=false and question=null.
- For vague background requests, ask what style they want and offer chips like Original, Match the game, Neon, Space, Surprise me.
- No generic feature bullets. finalInstruction must be direct and specific for the edit model.

GAME CONTEXT — title: "${gameTitle || 'Untitled'}", current state: "${currentSummary || 'a generated mobile game'}". Keep every edit faithful to THIS game.`,
                messages: [
                    ...historyMessages,
                    { role: 'user', content: String(instructions) },
                ],
                maxTokens: 450,
                temperature: 0.5,
            });
            intent = {
                ...fallback,
                ...parsed,
                reply: parsed.reply ? String(parsed.reply).slice(0, 400) : fallback.reply,
                summary: String(parsed.summary || fallback.summary).slice(0, 100),
                finalInstruction: String(parsed.finalInstruction || fallback.finalInstruction).slice(0, 2000),
                needsClarification: Boolean(parsed.needsClarification),
                question: parsed.question ? String(parsed.question).slice(0, 180) : null,
                suggestions: Array.isArray(parsed.suggestions)
                    ? parsed.suggestions.map((item) => String(item).slice(0, 32)).filter(Boolean).slice(0, 6)
                    : fallback.suggestions,
                confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : fallback.confidence,
            };
        } catch (error) {
            console.warn('[INTERPRET EDIT] Falling back after model failure:', error?.message || error);
            usedFallback = true;
        }

        res.json({ success: true, intent, ...(usedFallback ? { fallback: true } : {}) });
    } catch (error) {
        console.error('[INTERPRET EDIT] Error:', error);
        res.status(500).json({ error: error.message || 'Edit interpretation failed' });
    }
});

// === CONVERSATIONAL SPEC REFINEMENT ===
router.post('/refine-spec', async (req, res) => {
    try {
        const { conversationHistory, userMessage } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        if (!conversationHistory || !Array.isArray(conversationHistory)) {
            return res.status(400).json({ error: "conversationHistory is required" });
        }
        if (!userMessage) {
            return res.status(400).json({ error: "userMessage is required" });
        }

        const historyMessages = conversationHistory.map(msg => ({
            role: msg.role === 'ai' ? 'assistant' : 'user',
            content: msg.content,
        }));

        // Same Kimi brain as the first pitch and as the builder.
        const result = await callKimiJson({
            systemPrompt: `You are a creative director revising a game pitch mid-conversation. The user just reacted to your pitch — fold their words in and hand back the updated pitch. Maximum conviction in the pitch, zero ego in the revision.

Return ONLY valid JSON in this exact format:
{
  "ready": true/false,
  "spec": {
    "title": "Catchy Title (2-3 words max)",
    "structural": "3-5 word structural phrase naming dimension + perspective + genre (e.g. '3D chase-cam racer', 'top-down arena shooter')",
    "description": "1-2 polished sentences. The FIRST sentence must contain the structural phrase verbatim.",
    "features": ["Feature 1 (one short sentence)", "Feature 2 (one short sentence)"]
  },
  "question": "One fused question (ONLY in the rare case described below, else null)",
  "aiMessage": "Your reply to the user — short, warm, decisive. Half a sentence acknowledging the change, no groveling, no re-litigating."
}

Rules:
- ready=true almost always: the pitch is buildable the moment it exists. ready=false ONLY if the user's message contains a genuine contradiction you cannot resolve.
- NEVER ask about flavor (colors, characters, music, style), genre conventions, or difficulty — infer them with taste. A wrong guess there is a one-wish fix after the game exists.
- Only ask a question when a choice is BOTH load-bearing (2D vs 3D, camera, core loop — wrong guess forces a rebuild) AND genuinely bimodal with no obvious default. Then ask ONE fused question that leads with your own recommendation.
- Treat everything the user has said as locked. Revise only what they touched; keep the rest of the spec stable.
- Never apologize for your taste, never hedge ("maybe", "we could"). State choices as decisions.
- The structural phrase is the most load-bearing fact — always present, always committed.`,
            messages: [...historyMessages, { role: 'user', content: userMessage }],
            maxTokens: 400,
            temperature: 0.7,
        });

        // Ensure the response has the required structure
        if (typeof result.ready !== 'boolean') {
            result.ready = false;
        }
        if (!result.spec) {
            result.spec = {
                title: 'Your Game',
                description: 'A game concept',
                features: []
            };
        }
        if (!result.aiMessage) {
            result.aiMessage = result.question || 'Let me know if you want to make any changes.';
        }

        res.json({ 
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[REFINE SPEC] Error:', error);
        res.status(500).json({ error: error.message || 'Spec refinement failed' });
    }
});

function authorizeForgeAutoscaleRequest(req) {
    const configuredToken = process.env.FORGE_AUTOSCALE_TOKEN || '';
    if (!configuredToken) return true;
    const provided = req.headers['x-forge-autoscale-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    return provided === configuredToken;
}

router.get('/forge/autoscale', async (req, res) => {
    try {
        if (!authorizeForgeAutoscaleRequest(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const report = await buildForgeAutoscaleReport();
        res.json({ success: true, ...report });
    } catch (error) {
        console.error('[Forge Autoscale] report failed:', error);
        res.status(500).json({ error: error.message || 'Forge autoscale report failed' });
    }
});

router.post('/forge/autoscale/tick', async (req, res) => {
    try {
        if (!authorizeForgeAutoscaleRequest(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true';
        const result = await runForgeAutoscaleTick({ apply: !dryRun });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[Forge Autoscale] tick failed:', error);
        res.status(500).json({ error: error.message || 'Forge autoscale tick failed' });
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
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets

        const existingJob = await findActiveDuplicateGenerationJob(userId, 'dream', prompt, orientation);
        if (existingJob) {
            console.log(`🧠 [DREAM ROUTE] Deduped to active job ${existingJob.id} (${existingJob.status}) for User[${userId}]`);
            return res.json({ success: true, jobId: existingJob.id, deduped: true });
        }

        console.log(`🧠 [DREAM ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}" (${orientation})`);

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

        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("OUTER GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "System Error" });
    }
});

router.post('/edit', async (req, res) => {
    try {
        const { draftId, instructions, newAsset, attachments } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const mediaAttachments = sanitizeMediaAttachments(attachments);

        if (!draftId || !instructions) return res.status(400).json({ error: "draftId and instructions are required" });
        console.log(`🧠 [EDIT ROUTE] Creating edit job for User[${userId}] -> Draft: ${draftId}, Inst: "${instructions}"`);

        const newJobId = randomUUID();
        markEphemeralJob(newJobId, { status: 'pending', draftId });
        setImmediate(() => {
            void executeEditJob(newJobId, draftId, instructions, mediaAttachments);
        });

        res.json({ success: true, jobId: newJobId });

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
        if (ephemeralJob?.draftId) {
            if (ephemeralJob.status === 'error') {
                return res.json({ status: 'error', error: ephemeralJob.error || 'Job failed' });
            }
            if (ephemeralJob.status !== 'complete') {
                return res.json({
                    status: 'pending',
                    progress: typeof ephemeralJob.progress === 'number' ? ephemeralJob.progress : undefined,
                    statusMessage: ephemeralJob.statusMessage || undefined,
                });
            }

            const targetDraftId = ephemeralJob.draftId;
            const editResult = await pool.query('SELECT title, html_payload, raw_code, game_url, thumbnail, orientation, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [targetDraftId]);
            if (editResult.rows.length === 0) {
                return res.status(404).json({ error: 'Draft not found' });
            }

            const row = editResult.rows[0];
            if ((!row.html_payload || row.html_payload === '') && !row.game_url) {
                return res.json({ status: 'pending' });
            }

            return res.json({
                success: true,
                status: 'complete',
                draftId: targetDraftId,
                title: row.title,
                htmlPreview: row.html_payload,
                gameUrl: row.game_url || null,
                thumbnail: row.thumbnail,
                orientation: normalizeOrientation(row.orientation),
                classification: getStoredDraftClassification(row),
            });
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
        
        // If html_payload/game_url is still empty, check if it's a hard error or just pending
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
            // Zombie detection: generation_jobs says 'complete' but html_payload/game_url is empty.
            // The worker crashed after marking complete but before writing the game HTML.
            if (queueJob?.status === 'complete') {
                console.warn(`⚠️ Zombie job detected: ${jobId} — generation_jobs='complete' but ai_games.html_payload is empty`);
                return res.json({ status: 'error', error: 'Build completed but the game was lost during save. Please retry.', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            // Stale job detection: if progress >= 90 and no update in 5+ minutes, it's dead
            if (queueJob && queueJob.progress >= 90 && queueJob.updated_at) {
                const staleMins = (Date.now() - new Date(queueJob.updated_at).getTime()) / 60000;
                if (staleMins > 5) {
                    console.warn(`⚠️ Stale job detected: ${jobId} — progress ${queueJob.progress}% but no update in ${Math.round(staleMins)}min`);
                    return res.json({ status: 'error', error: 'Build stalled — the forge worker may have crashed. Please retry.', ...(await buildQueueProgressPayload(queueJob, jobId)) });
                }
            }
            if (queueJob) {
                return res.json({ status: 'pending', ...(await buildQueueProgressPayload(queueJob, jobId)) });
            }
            return res.json({ status: 'pending' });
        }

        const completeQueueRes = await pool.query('SELECT status, error, progress, phase, status_message FROM generation_jobs WHERE id = $1', [jobId]);
        const completeQueueJob = completeQueueRes.rows[0];
        
        // Done! Return the payload (even if it's an errorHtml payload, let the webview render it)
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

// Inspect the EXACT generated source for one game (already saved in maker_project), plus instant
// diagnostics so we can tell what the builder actually shipped without reading every line:
//   GET /drafts/:id/source            -> JSON { diagnostics, files: [{path, content}] }
//   GET /drafts/:id/source?format=text -> plain-text dump of every file (easy to read/paste)
router.get('/drafts/:id/source', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const row = await pool.query('SELECT id, title, prompt, maker_project FROM ai_games WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        if (row.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        let project = row.rows[0].maker_project;
        if (typeof project === 'string') { try { project = JSON.parse(project); } catch { project = null; } }
        const files = Array.isArray(project?.files) ? project.files : [];
        if (!files.length) return res.status(404).json({ error: 'No saved source for this game (older or non-maker build).' });
        const diagnostics = {
            architecture: project.architecture || null,
            files: files.map((f) => f.path),
            ...computeMakerSourceDiagnostics(files),
        };
        if (String(req.query.format || 'json') === 'text') {
            res.set('Content-Type', 'text/plain; charset=utf-8');
            const dump = files.map((f) => `\n\n===== ${f.path} =====\n${f.content || ''}`).join('');
            return res.send(`/* ${row.rows[0].title}\n   prompt: ${row.rows[0].prompt}\n   diagnostics: ${JSON.stringify(diagnostics)} */${dump}`);
        }
        res.json({ id: row.rows[0].id, title: row.rows[0].title, prompt: row.rows[0].prompt, diagnostics, files });
    } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
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
        // `orientation` and `gameUrl` are only consulted on the create-new branch below. For an
        // existing draft the row is already the authority on both, and letting a publish call
        // override them would be a way to reshape a game after it was built and verified.
        // `categories` is the creator's own pick. When present it overrides the classifier
        // outright — see upsertPublishedAIGame.
        const { title, privacy, html, orientation, gameUrl, categories } = req.body || {};

        // Check if draft exists
        const checkRes = await pool.query("SELECT * FROM ai_games WHERE id = $1 AND user_id = $2", [req.params.draftId, userId]);
        
        let draft;
        if (checkRes.rows.length === 0) {
            // Draft doesn't exist (e.g., publishing from a template with generated UUID)
            // Create a new game entry
            if (!html) {
                return res.status(400).json({ error: 'HTML payload required for new games' });
            }
            
            console.log('[Publish] Creating new game from template:', title);
            const insertRes = await pool.query(
                `INSERT INTO ai_games (user_id, title, html_payload, prompt, raw_code, is_draft, privacy, orientation, game_url, created_at)
                 VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, NOW())
                 RETURNING *`,
                [
                    userId,
                    title?.trim() || 'Untitled Game',
                    html,
                    `Published from template: ${title?.trim() || 'Untitled Game'}`,
                    html,
                    privacy || 'public',
                    // Without this a landscape game published through this branch was silently
                    // stored as portrait, and the feed would then refuse to rotate it.
                    normalizeOrientation(orientation),
                    typeof gameUrl === 'string' && /^https:\/\//i.test(gameUrl) ? gameUrl : null,
                ]
            );
            draft = insertRes.rows[0];
            console.log('[Publish] Game created:', draft.id);
        } else {
            // A remix must actually change something before it can be published. Otherwise the
            // feed fills with byte-identical copies of other people's games, credited to whoever
            // tapped Remix. Checked here rather than only in the app because this is the endpoint
            // that creates the public row.
            //
            // Content comparison, not an edit counter: it catches both "never edited" and "edited
            // and ended up with exactly the same game". The source is looked up by remixed_from,
            // which the remix INSERT sets.
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

            // Draft exists, update it
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

        console.log('[Publish] Upserting to games table...');
        // Carried on the in-memory draft only — there is no categories column on ai_games.
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

// Remix: clone another user's PUBLIC published game into a fresh draft owned by
// the current user. They then edit + publish it through the normal flow.
router.post('/remix/:sourceId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');

        // Accept either a full id or the short prefix used in /play urls.
        const srcRes = await pool.query(
            "SELECT * FROM ai_games WHERE id::text LIKE $1 LIMIT 1",
            [String(req.params.sourceId) + '%'],
        );
        if (srcRes.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const src = srcRes.rows[0];

        if (src.is_draft) return res.status(400).json({ error: 'You can only remix a published game' });
        // privacy 'public' = play & remix; anything else (e.g. 'play_only') blocks remixing.
        if (src.privacy && src.privacy !== 'public') {
            return res.status(403).json({ error: 'The creator turned off remixing for this game' });
        }
        if (!src.html_payload) return res.status(400).json({ error: 'This game has no playable content to remix' });

        // Credit the direct source's creator (denormalized name for easy display).
        const creatorRes = await pool.query('SELECT username, display_name FROM users WHERE id = $1', [src.user_id]);
        const creatorName = creatorRes.rows[0]?.username || creatorRes.rows[0]?.display_name || null;
        const baseTitle = String(src.title || 'Game').replace(/^Remix of /i, '');
        const newTitle = `Remix of ${baseTitle}`.substring(0, 255);

        const insertRes = await pool.query(
            `INSERT INTO ai_games (
                user_id, prompt, title, html_payload, raw_code, artist_code,
                thumbnail, preview_video_url, category, subcategory, primary_tab,
                interaction_type, classification_confidence, classification_tags,
                discovery_chips, privacy, is_draft, remixed_from, remixed_from_username, orientation, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,$18,$19,NOW())
             RETURNING id, title`,
            [
                userId,
                src.prompt || `Remix of ${baseTitle}`,
                newTitle,
                src.html_payload,
                src.raw_code || src.html_payload,
                src.artist_code || null,
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
                src.id,
                creatorName,
                // A remix inherits the source's orientation — the copied HTML is already built for
                // that shape, so anything else would point a portrait row at a landscape game.
                normalizeOrientation(src.orientation),
            ],
        );
        const draft = insertRes.rows[0];
        console.log(`[Remix] ${userId} remixed ${src.id} -> draft ${draft.id}`);
        res.json({ success: true, draftId: draft.id, title: draft.title, remixedFrom: creatorName });
    } catch (e) {
        console.error('[Remix] Error:', e);
        res.status(e.statusCode || 500).json({ error: e.message });
    }
});

// Injected into every served game so the host page can pause the game loop
// via postMessage before the user hits Play. Wraps rAF and mutes audio.
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
        // Inject the pause snippet as early as possible so it wraps rAF before game code loads.
        if (html.includes('<head>')) html = html.replace('<head>', '<head>' + GT_PAUSE_SNIPPET);
        else if (html.includes('<body>')) html = html.replace('<body>', '<body>' + GT_PAUSE_SNIPPET);
        else html = GT_PAUSE_SNIPPET + html;
        res.send(html);
    } catch(e) { res.status(500).send("Database extraction failed"); }
});

// Admin gallery: browse + PLAY every game the system has made (posted or draft), across all users.
// Data already lives in ai_games (html_payload); this just renders a grid + a play modal that embeds
// the existing /play/:id route. Query: ?q=search &filter=all|posted|draft &page=N
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
    res.json({ status: "bg-process-started", msg: "Scraping Omni-Engine assets into Postgres Vector DB..." });
    // ...
});

router.get('/admin/assets/diagnostics', async (req, res) => {
    try {
        setAssetBaseUrl(req);
        res.json(getAssetRuntimeDiagnostics());
    } catch (e) {
        res.status(500).json({ error: e.message || 'Asset diagnostics failed' });
    }
});

router.get('/admin/backfill-thumbnails', async (req, res) => {
    try {
        res.json({ status: "bg-process-started", msg: "Taking screenshots of all AI games in the background. Check your Railway logs for progress." });
        
        // Spawn the backfill script dynamically in the background so it doesn't block the request
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

// Internal exports for in-process callers (e.g., the bot engine running
// the same Dream pipeline real users go through). Keep these as the only
// non-default exports so the public surface stays intentional.
export {
    executeDreamJob,
    upsertPublishedAIGame,
    createPendingJob,
    startGenerationQueueWorker,
    stopGenerationQueueWorker,
};

export default router;
