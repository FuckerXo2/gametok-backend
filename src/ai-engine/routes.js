import express from 'express';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { buildLabsSoloPrototype, buildPhase1_Quantize, buildPhase2_EditGame, postProcessRawHtml } from './promptRegistry.js';
import { normalizeDreamSpec, wantsFirstPerson3D, inferRuntimeLaneFromPrompt } from './spec-normalizer.js';
import { verifyGame } from './sandbox.js';
import { setAssetBaseUrl, buildDreamAssetBundle, buildDreamAssetBundleWithAI, getAssetRuntimeDiagnostics } from './asset-dictionary.js';
import { notifyGameReady, notifyGameFailed } from '../notifications.js';
import { deleteCoverAsset, enqueueCoverGeneration } from '../cover-art.js';
import { artistAgent, batchArtistAgent, generateGameSprites } from './sprite-generator.js';
import { buildAssetPlanFromMakerContract, buildDreamAssetPlan, buildStructuredAssetToolRequest, compileDreamAssetBundle, findUserBgmAttachment, resolveDreamAudioForJob } from './asset-pipeline.js';
import { formatUnitySpecPromptBlock } from './gametok-unity.js';
import { selectMakerTemplateContract, summarizeMakerTemplateContract } from './maker-templates.js';
import { buildMakerDebugProtocol, formatMakerDebugProtocolPromptBlock } from './maker-debug-protocol.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from './maker-scaffolds.js';
import { buildMakerAssetContract, mergeMakerAssetContractIntoPlan, summarizeMakerAssetContract } from './maker-asset-contracts.js';
import { buildMakerDesignBrief, formatMakerDesignBriefPromptBlock, summarizeMakerDesignBrief } from './maker-design-brief.js';
import { buildMakerRepairPlaybook } from './maker-repair-playbook.js';
import { applyDeterministicPreflightRepairs, applyDeterministicStateObjectDedupeRepairs, runMakerPreflightChecks } from './maker-preflight-validator.js';
import {
    isMakerFactoryMinimalMode,
    resolveMakerAgentImplementTurns,
    resolveMakerAgentInspectionTurns,
    shouldBlockOnPreflight,
} from './maker-factory-mode.js';
import { buildMakerRepairEvolutionGuidance, formatMakerRepairEvolutionPromptBlock, formatMakerRepairProtocolPromptBlock, loadMakerRepairProtocol, matchMakerRepairProtocol, recordMakerRepairOutcome, shouldSkipRepair } from './maker-repair-protocol.js';
import { buildMakerBenchmarkResult } from './maker-benchmark-results.js';
import { buildMakerAssetManifest, summarizeMakerAssetManifest } from './maker-asset-manifest.js';
import { materializeMakerAssetsForProject } from './maker-asset-materializer.js';
import { verifyMakerGddCompliance } from './maker-gdd-verification.js';
import { appendMakerAgentTurn, buildMakerAgentImplementPrompt, buildMakerAgentInspectionPrompt, parseMakerAgentInspectionResponse, summarizeMakerAgentTurns, summarizeMakerProjectFiles } from './maker-agent-loop.js';
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
    isNvidiaFailoverFromDeepSeekEnabled,
    maskDeepSeekKey,
    resolveDeepSeekModel,
} from './deepseek-text-client.js';
import { getMakerFileJsonEncodingRuleLines, getMakerFileJsonSchemaExample, normalizeMakerProtocolResponse, validateMakerProtocolJsonPayload } from './maker-agent-response.js';
import { applyPatchReplacements } from './maker-agent-patches.js';
import { buildMakerCompileFailureEvidence, buildMakerDecodeFailureEvidence, buildMakerPatchFailureEvidence, restoreMakerFileBackups, runMakerProjectTscCheck } from './maker-project-compile-gate.js';
import { buildMakerAcceptanceResult, mergeAcceptanceIntoSandboxDiagnostics } from './maker-acceptance.js';
import { buildForgeAutoscaleReport, runForgeAutoscaleTick, isForgeAutoscaleEnabled } from './forge-autoscale.js';
import { analyzeMakerAssetQuality, collectRequiredContractArtIssues, summarizeMakerAssetQuality } from './maker-asset-quality.js';
import { getRequiredContractSlotIds, healRequiredContractArt } from './maker-artist-heal.js';
import {
    assertMakerAssetsReadyForPhase2,
    finalizeMakerArtistPhase,
    PHASE2_ASSET_PACK_INCOMPLETE,
    preparePhase2ProjectAssets,
} from './maker-asset-phase-gate.js';
import { buildHeuristicQualityIntent } from './maker-intent-fallback.js';
import { getNvidiaTextKeys, maskNvidiaKey, nextNvidiaTextApiKey } from './nvidia-key-pool.js';
import {
    assertFoundationSupported,
    buildFallbackFoundationSeed,
    buildFoundationAgentPrompt,
    buildFoundationDebugChecks,
    buildMakerAssetContractFromFoundation,
    buildMakerTemplateContractFromFoundation,
    normalizeFoundationContract,
    useDynamicFoundation,
} from './maker-foundation-agent.js';
import { buildKernelScaffold } from './maker-kernel-scaffold.js';
import { runFoundationStubPreflight } from './maker-foundation-stub-validator.js';
import { stripCookingStateLeaksFromSource } from './maker-foundation-safety.js';
import { formatMakerSystemManual, getMakerSystemManualSummary } from './maker-system-manual.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const GAMETOK_MAKER_ROOT = process.env.GAMETOK_MAKER_ROOT || path.join(STORAGE_ROOT, 'gametok-maker-jobs');

function getRequestOrigin(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}`;
}

function extractJson(text) {
    let jsonStart = text.indexOf('{');
    if (text.includes('</thinking>')) {
        const postThinkingStart = text.indexOf('{', text.indexOf('</thinking>'));
        if (postThinkingStart !== -1) {
            jsonStart = postThinkingStart;
        }
    }
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd >= jsonStart) {
        return text.substring(jsonStart, jsonEnd + 1);
    }
    return text;
}

/**
 * Escape raw control characters inside JSON double-quoted string literals.
 * LLM builders often paste multiline find/replace or file content with literal
 * newlines — JSON.parse rejects those as "Bad control character in string literal".
 */
function escapeControlCharsInJsonStrings(text) {
    if (!text || typeof text !== 'string') return text;

    let result = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const code = ch.charCodeAt(0);

        if (!inString) {
            result += ch;
            if (ch === '"') {
                inString = true;
            }
            continue;
        }

        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }

        if (ch === '\\') {
            result += ch;
            escaped = true;
            continue;
        }

        if (ch === '"') {
            result += ch;
            inString = false;
            continue;
        }

        if (code >= 0x00 && code <= 0x1f) {
            if (ch === '\n') {
                result += '\\n';
            } else if (ch === '\r') {
                result += '\\r';
            } else if (ch === '\t') {
                result += '\\t';
            }
            continue;
        }

        result += ch;
    }

    return result;
}

/**
 * Attempt to repair common LLM JSON mistakes:
 *  - Strip JS-style single-line (//) and multi-line comments
 *  - Replace single-quoted strings with double-quoted strings
 *  - Remove trailing commas before } or ]
 *  - Fix unquoted property names
 *  - Escape control characters inside string values
 */
function repairJson(text) {
    if (!text || typeof text !== 'string') return text;

    // First try as-is — maybe it's already valid
    try { JSON.parse(text); return text; } catch (_) { /* needs repair */ }

    let repaired = text;

    // 1. Strip single-line comments (// ...) but NOT inside strings
    repaired = repaired.replace(/\/\/[^\n]*/g, '');

    // 2. Strip multi-line comments (/* ... */)
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

    // 3. Replace single-quoted strings with double-quoted strings
    //    Walk through character by character to handle nested quotes properly
    try {
        let result = '';
        let inDouble = false;
        let inSingle = false;
        let escaped = false;
        for (let i = 0; i < repaired.length; i++) {
            const ch = repaired[i];
            if (escaped) {
                result += ch;
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                result += ch;
                escaped = true;
                continue;
            }
            if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
                result += ch;
            } else if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
                result += '"'; // Replace single quote with double quote
            } else {
                // If inside a single-quoted string, escape any internal double quotes
                if (inSingle && ch === '"') {
                    result += '\\"';
                } else {
                    result += ch;
                }
            }
        }
        repaired = result;
    } catch (_) { /* keep repaired as-is if quote replacement fails */ }

    // 4. Remove trailing commas before ] or }
    repaired = repaired.replace(/,\s*([\]}])/g, '$1');

    // 5. Fix unquoted property names: key: -> "key":
    //    Only outside of string values. This is a best-effort regex.
    repaired = repaired.replace(/(?<=[\{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '"$1":');

    // 6. Escape raw control characters inside JSON string literals
    repaired = escapeControlCharsInJsonStrings(repaired);

    // Validate the repair worked
    try { JSON.parse(repaired); return repaired; } catch (_) { /* return repaired anyway, caller will handle */ }
    return repaired;
}

const router = express.Router();

const DEFAULT_KIMI_BUILDER_MODEL = "moonshotai/kimi-k2.6";
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
    labsBuilder: resolveDreamModel('DREAMSTREAM_LABS_MODEL', DEFAULT_KIMI_BUILDER_MODEL),
    narrativeChat: process.env.DREAMSTREAM_NARRATIVE_MODEL || "meta/llama-3.3-70b-instruct",
};

function getDreamTextModelLabel() {
    if (isDeepSeekPrimaryEnabled()) {
        return getDeepSeekTextConfig()?.model || 'deepseek-v4-pro';
    }
    if (isMoonshotPrimaryEnabled()) {
        return getMoonshotTextConfig()?.model || DEFAULT_KIMI_BUILDER_MODEL;
    }
    return DREAM_MODELS.premiumBuilder || DREAM_MODELS.spec;
}

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
const MAKER_IMPLEMENT_REASONING_EFFORT = String(process.env.GAMETOK_MAKER_IMPLEMENT_REASONING_EFFORT || 'low').trim() || 'low';
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
function getMakerAgentInspectionTurns(assetSlotCount = 0) {
    return resolveMakerAgentInspectionTurns(assetSlotCount);
}
const SKIP_TURN1_PRERUN_EVIDENCE = String(process.env.GAMETOK_MAKER_SKIP_TURN1_PRERUN_EVIDENCE || 'true').toLowerCase() !== 'false';
const SKIP_PHASE3_REPAIR_WHEN_PHASE2_PASSES = String(process.env.GAMETOK_SKIP_PHASE3_WHEN_PHASE2_PASSES || 'true').toLowerCase() !== 'false';
const MAKER_SANDBOX_REPAIR_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.GAMETOK_MAKER_SANDBOX_REPAIR_ATTEMPTS || 2)));

const JOB_TITLES = {
    dreamPending: 'Pending Dream...',
    remixPending: 'Updating Game...',
    labsPending: '🧪 Labs: Cooking...',
};

function createNvidiaTextClient(apiKey = nextNvidiaTextApiKey()) {
    return new OpenAI({
        baseURL: 'https://integrate.api.nvidia.com/v1',
        apiKey: apiKey || 'missing-key',
        timeout: Number(process.env.NVIDIA_API_TIMEOUT_MS || 900000),
    });
}

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
const ENABLE_LEGACY_LABS_ROUTE = process.env.ENABLE_LEGACY_LABS_ROUTE === 'true';
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

async function callAI(systemPrompt, userPrompt, maxTokens = 2000, temperature = 0.3, { overrideModel = null } = {}) {
    let raw = '';
    let extracted = '';
    let parseError = null;
    const maxJsonRewriteAttempts = Math.max(1, BUILDER_JSON_REWRITE_ATTEMPTS);
    // When a lighter/faster model is requested (e.g. flash for Phase 1), pass it as the sole
    // fallbackModels entry so it wins for both DeepSeek-primary and NVIDIA paths.
    const callFallbackModels = overrideModel
        ? [overrideModel]
        : BUILDER_FALLBACK_MODELS;

    for (let attempt = 0; attempt <= maxJsonRewriteAttempts; attempt += 1) {
        const messages = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: attempt === 0
                    ? userPrompt
                    : buildPhase1JsonRewritePrompt(userPrompt, extracted || raw, parseError),
            }
        ];
        const res = await withNvidiaRetries((currentModel, client, providerTag) => withAbortableTimeout(async (signal) => {
            const modelToUse = resolveTextModelForProvider(currentModel || DREAM_MODELS.spec, providerTag);
            const chatOptions = {
                ...getTextChatOptions(modelToUse, maxTokens, {
                    providerTag,
                    stream: useMakerAgentStreaming(),
                }),
                messages,
            };
            if (!isMoonshotDirectProvider(providerTag) && !isDeepSeekDirectProvider(providerTag)) {
                chatOptions.temperature = attempt === 0 ? temperature : Math.min(temperature, 0.15);
            }
            if (useMakerAgentStreaming()) {
                const message = await streamChatCompletionToMessage(client, chatOptions, {
                    signal,
                    logLabel: `Phase 1 Builder rewrite=${attempt}`,
                });
                return { choices: [{ message }] };
            }
            return client.chat.completions.create(chatOptions, { signal });
        }, PHASE1_TIMEOUT_MS, 'Phase 1 Builder'), { label: 'Phase 1 Builder', maxAttempts: PHASE1_ATTEMPTS_PER_MODEL, baseDelayMs: 2000, fallbackModels: callFallbackModels });
        if (!res || !res.choices || !res.choices[0]) {
            throw new Error("API Provider Error (Phase 1): " + (res?.error?.message || JSON.stringify(res)));
        }
        raw = res.choices[0].message.content || '';
        extracted = extractJson(raw);

        // Try 1: Direct parse
        try {
            return JSON.parse(extracted);
        } catch (directError) {
            // Try 2: Repair common LLM quirks (single quotes, trailing commas, comments, unquoted keys)
            try {
                const repaired = repairJson(extracted);
                const parsed = JSON.parse(repaired);
                console.log(`[callAI] JSON repair succeeded (original error: ${directError.message})`);
                return parsed;
            } catch (repairError) {
                parseError = directError;
                console.error('[callAI] JSON parse failed. Raw response length:', raw.length);
                console.error('[callAI] Extracted JSON length:', extracted.length);
                console.error('[callAI] Last 200 chars of extracted:', extracted.slice(-200));
                console.error('[callAI] Repair also failed:', repairError.message);
                if (attempt >= maxJsonRewriteAttempts) break;
                console.warn(`[callAI] Requesting full JSON rewrite ${attempt + 1}/${maxJsonRewriteAttempts} after parse failure: ${directError.message}`);
            }
        }
    }

    throw new Error(`JSON parse failed after rewrite attempts: ${parseError?.message || 'unknown parse error'}. Response stayed invalid (${extracted.length} chars).`);
}

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

function heuristicClassifyGame({ title = '', prompt = '', description = '', htmlPayload = '' }) {
    const text = `${title} ${prompt} ${description} ${htmlPayload}`.toLowerCase();
    const matches = (keywords = []) => keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);

    const horrorScore = matches(['horror', 'scary', 'creepy', 'ghost', 'haunted', 'dark', 'monster', 'fear', 'void', 'survey']);
    const quizScore = matches(['quiz', 'trivia', 'puzzle', 'question', 'guess', 'memory', 'atlas', 'answer']);
    const roleplayScore = matches(['romance', 'dating', 'love', 'episode', 'dress', 'fashion', 'anime', 'boyfriend', 'girlfriend', 'story']);
    const toolScore = matches(['draw', 'mirror draw', 'paint', 'generator', 'tool', 'create pattern', 'lissajous', 'music toy']);
    const gameScore = matches(['drive', 'driving', 'car', 'runner', 'jump', 'platform', 'enemy', 'score', 'arcade', 'shooter', 'steering']);

    let primaryTab = 'Explore';
    let category = 'creative';
    let subcategory = 'experimental';
    let interactionType = 'experimental';
    let tags = ['interactive'];

    const ranked = [
        { tab: 'Horror', score: horrorScore, category: 'horror', interactionType: 'horror_vignette', tags: ['dark', 'story', 'choice'] },
        { tab: 'Quiz', score: quizScore, category: 'quiz', interactionType: 'quiz_challenge', tags: ['brain', 'trivia', 'puzzle'] },
        { tab: 'Roleplay', score: roleplayScore, category: 'roleplay', interactionType: 'roleplay_story', tags: ['story', 'social', 'character'] },
        { tab: 'Games', score: Math.max(gameScore, toolScore > 0 ? 0 : gameScore), category: gameScore > 2 ? 'action' : 'simulation', interactionType: gameScore > 2 ? 'arcade_loop' : 'simulator', tags: ['playable', 'loop', 'interactive'] },
        { tab: 'Explore', score: toolScore, category: toolScore > 0 ? 'tool' : 'creative', interactionType: toolScore > 0 ? 'drawing_tool' : 'experimental', tags: toolScore > 0 ? ['creative', 'tool', 'playful'] : ['interactive'] },
    ].sort((a, b) => b.score - a.score);

    if (ranked[0] && ranked[0].score > 0) {
        primaryTab = ranked[0].tab;
        category = ranked[0].category;
        interactionType = ranked[0].interactionType;
        tags = ranked[0].tags;
    } else if (text.includes('story') || text.includes('choice') || text.includes('note')) {
        primaryTab = 'Explore';
        category = 'story';
        interactionType = 'choice_story';
        tags = ['story', 'choice', 'interactive'];
    }

    if (primaryTab === 'Horror') {
        if (matches(['camera', 'recording', 'footage', 'vhs', 'tape']) > 0) subcategory = 'found_footage';
        else if (matches(['feed', 'post', 'message', 'phone', 'survey']) > 0) subcategory = 'cursed_feed';
        else if (matches(['escape', 'maze', 'door', 'locked', 'room']) > 0) subcategory = 'escape';
        else if (matches(['ghost', 'spirit', 'haunted', 'ritual', 'paranormal']) > 0) subcategory = 'paranormal';
        else if (matches(['night', 'shift', 'clerk', 'late', 'work']) > 0) subcategory = 'night_shift';
        else subcategory = 'psychological';
    } else if (primaryTab === 'Quiz') {
        if (matches(['geo', 'map', 'country', 'flag', 'atlas']) > 0) subcategory = 'geography';
        else if (matches(['anime', 'manga', 'vocaloid', 'character']) > 0) subcategory = 'anime';
        else if (matches(['word', 'letters', 'spelling', 'anagram']) > 0) subcategory = 'word';
        else if (matches(['memory', 'remember', 'match']) > 0) subcategory = 'memory';
        else if (matches(['impossible', 'trick', 'bait', 'backwards']) > 0) subcategory = 'impossible';
        else subcategory = 'trivia';
    } else if (primaryTab === 'Roleplay') {
        if (matches(['boyfriend', 'male lead', 'him']) > 0) subcategory = 'boyfriend';
        else if (matches(['girlfriend', 'female lead', 'her']) > 0) subcategory = 'girlfriend';
        else if (matches(['fantasy', 'magic', 'spirit', 'myth']) > 0) subcategory = 'fantasy';
        else if (matches(['school', 'academy', 'student', 'class']) > 0) subcategory = 'school_drama';
        else if (matches(['world', 'kingdom', 'universe', 'guild']) > 0) subcategory = 'immersive_world';
        else subcategory = 'romance';
    } else if (primaryTab === 'Games') {
        if (matches(['drive', 'driving', 'car', 'steering', 'drift']) > 0) subcategory = 'racing';
        else if (matches(['run', 'runner', 'dash', 'speed']) > 0) subcategory = 'runner';
        else if (matches(['shoot', 'gun', 'enemy', 'fps', 'bullet']) > 0) subcategory = 'shooter';
        else if (matches(['jump', 'platform', 'obby']) > 0) subcategory = 'platformer';
        else if (matches(['sim', 'simulator', 'tycoon', 'manage']) > 0) subcategory = 'simulator';
        else if (matches(['cozy', 'farm', 'merge', 'idle']) > 0) subcategory = 'casual';
        else subcategory = 'arcade';
    } else {
        if (matches(['meme', 'shitpost', 'funny', 'cat tv']) > 0) subcategory = 'meme';
        else if (matches(['draw', 'mirror draw', 'paint', 'tool']) > 0) subcategory = 'creative_tool';
        else if (matches(['lissajous', 'pattern', 'harmonic', 'mirror']) > 0) subcategory = 'satisfying';
        else if (matches(['brainrot', 'absurd', 'chaos']) > 0) subcategory = 'brainrot';
        else if (matches(['casual', 'light', 'quick']) > 0) subcategory = 'casual';
        else subcategory = 'experimental';
    }

    return {
        primaryTab,
        category,
        subcategory,
        interactionType,
        tags,
        confidence: 0.45,
    };
}

async function classifyPublishedGame({ title = '', prompt = '', description = '', htmlPayload = '' }) {
    const heuristic = heuristicClassifyGame({ title, prompt, description, htmlPayload });
    const model = process.env.DREAMSTREAM_CLASSIFIER_MODEL || DREAM_MODELS.spec;
    const htmlSignal = String(htmlPayload || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 1800);

    try {
        // Add 30 second timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Classification timeout after 30s')), 30000);
        });

        const classificationPromise = createNvidiaTextClient().chat.completions.create({
            model,
            messages: [
                {
                    role: 'system',
                    content: `You classify short-form interactive games for a discovery feed.
Return raw JSON only with this exact schema:
{
  "primaryTab": "Explore|Games|Horror|Quiz|Roleplay",
  "category": "arcade|action|simulation|horror|quiz|puzzle|roleplay|story|creative|tool",
  "subcategory": "brainrot|casual|satisfying|creative_tool|experimental|meme|arcade|runner|racing|simulator|shooter|platformer|psychological|paranormal|escape|found_footage|cursed_feed|night_shift|trivia|geography|anime|word|memory|impossible|romance|fantasy|school_drama|boyfriend|girlfriend|immersive_world",
  "interactionType": "arcade_loop|choice_story|drawing_tool|music_toy|quiz_challenge|simulator|horror_vignette|roleplay_story|sandbox|experimental",
  "tags": ["lowercase-tag"],
  "confidence": 0.0
}
Choose the tab based on the actual experience, not marketing words. Horror is only for genuinely unsettling or fear-driven experiences. Quiz is for question/puzzle/trivia-driven experiences. Roleplay is for character/social/story fantasies. Games is for action/arcade/driving/platformer/simulation play. Explore is for creative tools, experimental pieces, toys, generators, and things that do not fit the other lanes cleanly.`
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        title,
                        prompt,
                        description,
                        htmlSignal,
                        allowedTabs: DISCOVERY_TABS,
                        allowedCategories: DISCOVERY_CATEGORIES,
                        allowedSubcategories: DISCOVERY_SUBCATEGORIES,
                        allowedInteractionTypes: INTERACTION_TYPES,
                    }),
                },
            ],
            temperature: 0.1,
            max_tokens: 220,
        });

        const res = await Promise.race([classificationPromise, timeoutPromise]);

        const raw = res?.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(extractJson(raw));
        const primaryTab = DISCOVERY_TABS.includes(parsed?.primaryTab) ? parsed.primaryTab : heuristic.primaryTab;
        const category = DISCOVERY_CATEGORIES.includes(parsed?.category) ? parsed.category : heuristic.category;
        const subcategory = DISCOVERY_SUBCATEGORIES.includes(parsed?.subcategory) ? parsed.subcategory : heuristic.subcategory;
        const interactionType = INTERACTION_TYPES.includes(parsed?.interactionType) ? parsed.interactionType : heuristic.interactionType;
        const tags = normalizeClassifierTags(parsed?.tags);

        return {
            primaryTab,
            category,
            subcategory,
            interactionType,
            tags: tags.length ? tags : heuristic.tags,
            discoveryChips: deriveDiscoveryChips({
                primaryTab,
                subcategory,
                tags: tags.length ? tags : heuristic.tags,
            }),
            confidence: clampClassifierConfidence(parsed?.confidence),
        };
    } catch (error) {
        console.warn('[classifier] Falling back to heuristic classification:', error?.message || error);
        return heuristic;
    }
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

async function classifyAndStoreDraft({ draftId, title = '', prompt = '', htmlPayload = '' }) {
    const description = "Multi-Engine AI Creation: " + prompt;
    const classification = await classifyPublishedGame({
        title,
        prompt,
        description,
        htmlPayload,
    });

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
            JSON.stringify(classification.discoveryChips || []),
            draftId,
        ]
    );

    return classification;
}

async function upsertPublishedAIGame({ draftId, userId, draft, forceRefreshClassification = false }) {
    const globalId = `gm-ai-${String(draftId).substring(0, 8)}`;
    const description = "Multi-Engine AI Creation: " + draft.prompt;
    const storedClassification = !forceRefreshClassification ? getStoredDraftClassification(draft) : null;
    const classification = storedClassification || await classifyAndStoreDraft({
        draftId,
        title: draft.title,
        prompt: draft.prompt,
        htmlPayload: draft.html_payload,
    });

    await pool.query(
        `INSERT INTO games (id, name, description, icon, color, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips, developer, embed_url, thumbnail, preview_video_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
            draft.title,
            description,
            "✨",
            "#050505",
            classification.category,
            classification.subcategory,
            classification.primaryTab,
            classification.interactionType,
            classification.confidence,
            JSON.stringify(classification.tags),
            JSON.stringify(classification.discoveryChips || []),
            userId,
            `/api/ai/play/${draftId}`,
            draft.thumbnail,
            null,
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableProviderError(error, hasFallbacks = false) {
    if (hasFallbacks && error?.status === 404) return true;
    const message = [
        error?.message,
        error?.code,
        error?.cause?.message,
        error?.cause?.code,
        String(error || ''),
    ].filter(Boolean).join(' ').toLowerCase();
    return Boolean(
        error?.status >= 500 ||
        message.includes('timed out') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('terminated') ||
        message.includes('und_err_socket') ||
        message.includes('socket') ||
        message.includes('other side closed') ||
        message.includes('fetch failed') ||
        message.includes('connection error') ||
        message.includes('overloaded') ||
        message.includes('rate limit')
    );
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

async function withNvidiaRetries(task, {
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
    const moonshotFailover = !deepseekPrimary && !moonshotPrimary && (enableMoonshotFailover ?? isMoonshotFailoverEnabled());

    if (deepseekPrimary) {
        const deepseekConfig = getDeepSeekTextConfig();
        const deepseekClient = createDeepSeekTextClient();
        let deepseekFailed = false;
        if (deepseekConfig && deepseekClient) {
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
                        const retryAction = attempt < maxAttempts ? 'retry' : 'failover';
                        console.warn(`🧭 [${logLabel}] ${formatProviderRetryDecision(classification, retryAction)} on DeepSeek ${currentModel} (attempt ${attempt}/${maxAttempts})`);

                        const isLastModel = modelIndex === modelsToTry.length - 1;
                        if (attempt >= maxAttempts && isLastModel) {
                            break;
                        }
                        if (attempt >= maxAttempts) {
                            break;
                        }

                        await sleep(baseDelayMs * attempt);
                    }
                }
            }

            deepseekFailed = true;
        } else {
            console.warn(`🐋 [${logLabel}] DeepSeek primary requested but DEEPSEEK_API_KEY missing — using NVIDIA text path`);
        }

        if (!deepseekFailed) {
            // Missing DeepSeek key — fall through to NVIDIA.
        } else if (isNvidiaFailoverFromDeepSeekEnabled() && getNvidiaTextKeys().length > 0) {
            console.warn(`🐋→🔑 [${logLabel}] DeepSeek direct exhausted — failing over to NVIDIA NIM (${(fallbackModels.length > 0 ? fallbackModels : BUILDER_FALLBACK_MODELS).join('>')})`);
        } else {
            throw lastError;
        }
    } else if (moonshotPrimary) {
        const moonshotConfig = getMoonshotTextConfig();
        const moonshotClient = createMoonshotTextClient();
        if (moonshotConfig && moonshotClient) {
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
        console.warn(`🌙 [${logLabel}] Moonshot primary requested but MOONSHOT_API_KEY missing — using NVIDIA text path`);
    }

    const modelsToTry = fallbackModels.length > 0 ? fallbackModels : [null];
    const retriesPerModel = maxAttempts;
    const modelFailures = [];

    for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex += 1) {
        const currentModel = modelsToTry[modelIndex];
        let stallsOnModel = 0;
        const failureKinds = [];

        for (let attempt = 1; attempt <= retriesPerModel; attempt += 1) {
            try {
                if (modelIndex > 0 || attempt > 1) {
                    console.log(`🔁 [${logLabel}] Attempt ${attempt}/${retriesPerModel} on ${currentModel || 'default model'} (model ${modelIndex + 1}/${modelsToTry.length})...`);
                }
                const apiKey = nextNvidiaTextApiKey();
                const client = createNvidiaTextClient(apiKey);
                console.log(`🔑 [${logLabel}] Text key ${maskNvidiaKey(apiKey)} for ${currentModel || 'default model'} attempt ${attempt}/${retriesPerModel}`);
                return await task(currentModel, client, apiKey);
            } catch (error) {
                lastError = error;
                const classification = classifyProviderError(error);
                if (classification.kind === ProviderFailureKind.STALL) {
                    stallsOnModel += 1;
                }
                failureKinds.push(classification.kind);

                const action = decideProviderRetryAction(classification, {
                    attempt,
                    maxAttempts: retriesPerModel,
                    stallsOnCurrentModel: stallsOnModel,
                });
                console.warn(`🧭 [${logLabel}] ${formatProviderRetryDecision(classification, action)} on ${currentModel || 'default model'} (attempt ${attempt}/${retriesPerModel})`);

                const isLastModel = modelIndex === modelsToTry.length - 1;

                if (action === 'switch_model') {
                    if (!isLastModel) {
                        console.warn(`⏭️ [${logLabel}] Escalating from ${currentModel || 'default model'} to ${modelsToTry[modelIndex + 1]} after ${classification.reason}`);
                    }
                    break;
                }

                if (attempt >= retriesPerModel) {
                    if (isLastModel) {
                        break;
                    }
                    break;
                }

                const waitMs = baseDelayMs * attempt;
                await sleep(waitMs);
            }
        }

        modelFailures.push({
            model: currentModel,
            stalls: stallsOnModel,
            kinds: failureKinds,
        });
    }

    if (moonshotFailover && shouldMoonshotFailover(modelFailures, lastError)) {
        const moonshotConfig = getMoonshotTextConfig();
        const moonshotClient = createMoonshotTextClient();
        if (moonshotConfig && moonshotClient) {
            console.warn(`🌙 [${logLabel}] NVIDIA text path blocked on ${modelFailures.length} model(s) — failing over to Moonshot direct (${moonshotConfig.model}, key ${maskMoonshotKey(moonshotConfig.apiKey)})`);
            try {
                return await task(moonshotConfig.model, moonshotClient, 'moonshot-direct');
            } catch (moonshotError) {
                lastError = moonshotError;
                const moonshotClassification = classifyProviderError(moonshotError);
                console.error(`🌙 [${logLabel}] Moonshot failover failed: ${formatProviderRetryDecision(moonshotClassification, 'throw')}`);
            }
        } else {
            console.warn(`🌙 [${logLabel}] Moonshot failover skipped — MOONSHOT_API_KEY not configured`);
        }
    }

    throw lastError;
}

function extractText(response) {
    return response?.choices?.[0]?.message?.content?.trim() || '';
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

function getNvidiaChatOptions(model, requestedMaxTokens, { reasoningEffort = null } = {}) {
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

    const options = getNvidiaChatOptions(model, requestedMaxTokens, { reasoningEffort });
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

function cleanJsonContinuation(text) {
    return stripMarkdownFences(String(text || ''), 'json').trimStart();
}

function parseBuilderJsonText(text) {
    const cleaned = stripMarkdownFences(String(text || ''), 'json');
    const extracted = extractJson(cleaned);
    const sanitized = escapeControlCharsInJsonStrings(extracted);
    try {
        return JSON.parse(sanitized);
    } catch (e) {
        return JSON.parse(repairJson(sanitized));
    }
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

function buildBuilderJsonContinuationPrompt(partialJson, parseError) {
    const suffix = String(partialJson || '').slice(-6000);
    return [
        'You were generating one valid JSON object for the GameTok maker and your previous response was cut off or incomplete.',
        'Continue from EXACTLY where the JSON stopped.',
        'Output ONLY the missing continuation characters.',
        'Do NOT restart the JSON object.',
        'Do NOT repeat earlier keys or file contents.',
        'Do NOT wrap the answer in markdown.',
        'Do NOT explain anything.',
        ...getMakerFileJsonEncodingRuleLines(),
        '',
        `The parser currently fails with: ${parseError?.message || String(parseError || 'unknown parse error')}`,
        '',
        'The current partial JSON ends with this exact suffix:',
        '```json',
        suffix,
        '```',
        '',
        'Continue with only the remaining characters needed to finish the same JSON object.'
    ].join('\n');
}

function buildBuilderJsonRewritePrompt(originalPrompt, invalidJson, parseError) {
    return [
        'Your previous GameTok maker JSON response could not be parsed.',
        'Return one complete valid JSON object now. No markdown. No commentary.',
        'Do not continue the broken response. Rewrite the full JSON object from scratch.',
        'Keep edits targeted and only include complete replacement file contents for files that need changes.',
        'Prefer protocolVersion 2 patch responses with patches[].replacements find/replace pairs copied from current project files.',
        'If the safest answer is no edit, return {"patches":[],"notes":["already compliant"],"noEditsNeeded":true}.',
        ...getMakerFileJsonEncodingRuleLines(),
        '',
        `Parser error: ${parseError?.message || String(parseError || 'unknown parse error')}`,
        '',
        'Invalid response excerpt:',
        '```json',
        String(invalidJson || '').slice(-12000),
        '```',
        '',
        'Original task:',
        originalPrompt,
    ].join('\n');
}

function buildPhase1JsonRewritePrompt(originalPrompt, invalidJson, parseError) {
    return [
        'Your previous response was not valid JSON.',
        'Return one complete valid JSON object now. No markdown. No commentary.',
        'Do not continue the broken response. Rewrite the full JSON object from scratch.',
        'Use strict JSON only: double-quoted strings, no comments, no trailing commas, and no unescaped newlines inside strings.',
        'Keep the same schema requested by the original prompt.',
        '',
        `Parser error: ${parseError?.message || String(parseError || 'unknown parse error')}`,
        '',
        'Invalid response excerpt:',
        '```json',
        String(invalidJson || '').slice(-8000),
        '```',
        '',
        'Original task:',
        originalPrompt,
    ].join('\n');
}

async function requestBuilderMessage(userPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, currentModel = null } = {}) {
    assertJobNotCancelled(jobId);
    await assertJobNotCancelledShared(jobId, { force: true });
    
    let finishReason = null;
    const logLabel = formatJobLogLabel(label, jobId);
    let lastPartialText = '';
    let lastPartialStopReason = null;
    const text = await withNvidiaRetries(async (modelParam, client, providerTag) => withAbortableTimeout(async (signal) => {
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

    return withNvidiaRetries(async (modelParam, client, providerTag) => withAbortableTimeout(async (signal) => {
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
        const deepseekToolThinking = isDeepSeekDirectProvider(providerTag) && mode === MAKER_AGENT_TURN_MODE_IMPLEMENT;
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

async function generateCompleteJsonWithBuilder(initialPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, progressBase = 56, currentModel = null } = {}) {
    assertJobNotCancelled(jobId);
    const logLabel = formatJobLogLabel(label, jobId);
    let lastParseError = null;
    let lastJsonText = '';
    for (let rewriteAttempt = 0; rewriteAttempt <= BUILDER_JSON_REWRITE_ATTEMPTS; rewriteAttempt += 1) {
        const prompt = rewriteAttempt === 0
            ? initialPrompt
            : buildBuilderJsonRewritePrompt(initialPrompt, lastJsonText, lastParseError);
        const currentLabel = rewriteAttempt === 0 ? label : `${label} JSON Rewrite ${rewriteAttempt}`;
        const currentLogLabel = formatJobLogLabel(currentLabel, jobId);
        let { text, stopReason } = await requestBuilderMessage(prompt, {
            label: currentLabel,
            jobId,
            timeoutMs,
            maxAttempts,
            currentModel,
        });
        assertJobNotCancelled(jobId);
        let jsonText = stripMarkdownFences(text, 'json');
        lastJsonText = jsonText;
        console.log(`🧾 [${currentLogLabel}] json stop_reason=${stopReason || 'unknown'} chars=${jsonText.length}`);

        let continuationCount = 0;
        while (continuationCount <= BUILDER_MAX_CONTINUATIONS) {
            try {
                const parsed = parseBuilderJsonText(jsonText);
                validateMakerProtocolJsonPayload(parsed);
                return JSON.stringify(parsed);
            } catch (parseError) {
                lastParseError = parseError;
                lastJsonText = jsonText;
                if (continuationCount >= BUILDER_MAX_CONTINUATIONS) {
                    break;
                }
                continuationCount += 1;
                console.warn(`⚠️ [${currentLogLabel}] JSON output incomplete or invalid (${parseError.message}). Requesting continuation ${continuationCount}/${BUILDER_MAX_CONTINUATIONS}...`);
                if (jobId) {
                    await updateGenerationJobProgress(
                        jobId,
                        Math.min(75, progressBase + continuationCount),
                        'build_json_continuing',
                        `Builder JSON was incomplete. Continuing structured output ${continuationCount}/${BUILDER_MAX_CONTINUATIONS}...`
                    );
                }
                const continuation = await requestBuilderMessage(buildBuilderJsonContinuationPrompt(jsonText, parseError), {
                    label: `${currentLabel} JSON Continue`,
                    jobId,
                    timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                    maxAttempts: 2,
                    currentModel,
                });
                assertJobNotCancelled(jobId);
                const continuationText = cleanJsonContinuation(continuation.text);
                console.log(`🧾 [${formatJobLogLabel(`${currentLabel} JSON Continue`, jobId)}] stop_reason=${continuation.stopReason || 'unknown'} chars=${continuationText.length}`);
                if (!continuationText) {
                    break;
                }
                jsonText += continuationText;
            }
        }

        if (rewriteAttempt < BUILDER_JSON_REWRITE_ATTEMPTS) {
            console.warn(`⚠️ [${logLabel}] JSON remained invalid (${lastParseError?.message || 'unknown parse error'}). Requesting full JSON rewrite ${rewriteAttempt + 1}/${BUILDER_JSON_REWRITE_ATTEMPTS}...`);
            if (jobId) {
                await updateGenerationJobProgress(
                    jobId,
                    Math.min(78, progressBase + BUILDER_MAX_CONTINUATIONS + rewriteAttempt + 1),
                    'build_json_rewriting',
                    `Builder JSON stayed invalid. Asking for a clean structured rewrite ${rewriteAttempt + 1}/${BUILDER_JSON_REWRITE_ATTEMPTS}...`
                );
            }
        }
    }

    const error = new Error(`Builder JSON remained invalid after continuation/rewrite recovery: ${lastParseError?.message || 'unknown parse error'}`);
    error.partialText = lastJsonText;
    error.parseError = lastParseError;
    throw error;
}

function extractInlineScripts(html) {
    const scripts = [];
    const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        if (/src\s*=/.test(match[1] || '')) {
            continue;
        }
        scripts.push(match[2] || '');
    }
    return scripts;
}

function validateJavaScriptSyntax(source, label) {
    try {
        new vm.Script(source, { filename: label });
    } catch (error) {
        throw new Error(`${label} syntax error: ${error.message}`);
    }
}

function validateGeneratedBuild(artistCode, engineHtml, compiledHtml) {
    if (engineHtml.includes('TODO_ENGINE')) {
        throw new Error('engine-html validation error: scaffold TODO markers were left in the final output');
    }
    validateJavaScriptSyntax(artistCode, 'artist-code.js');
    const engineScripts = extractInlineScripts(engineHtml);
    engineScripts.forEach((script, index) => validateJavaScriptSyntax(script, `engine-inline-${index + 1}.js`));
    const compiledScripts = extractInlineScripts(compiledHtml);
    compiledScripts.forEach((script, index) => validateJavaScriptSyntax(script, `compiled-inline-${index + 1}.js`));
}

function validateRuntimeLaneContract(runtimeLane, html) {
    if (runtimeLane !== 'first_person_threejs' && runtimeLane !== 'third_person_threejs') {
        return;
    }

    const source = String(html || '');
    if (!source) {
        throw new Error(`${runtimeLane} validation error: empty HTML output`);
    }

    if (!/three(\.min)?\.js/i.test(source) && !/\bTHREE\./.test(source)) {
        throw new Error(`${runtimeLane} validation error: missing Three.js runtime`);
    }
    if (!/PerspectiveCamera/i.test(source)) {
        throw new Error(`${runtimeLane} validation error: missing THREE.PerspectiveCamera`);
    }
    if (!/WebGLRenderer/i.test(source)) {
        throw new Error(`${runtimeLane} validation error: missing THREE.WebGLRenderer`);
    }
    if (/OrthographicCamera/i.test(source)) {
        throw new Error(`${runtimeLane} validation error: used OrthographicCamera instead of perspective 3D`);
    }
    if (runtimeLane === 'first_person_threejs' && !/camera\.rotation|camera\.lookAt|yaw|pitch|lookDelta|lookSensitivity/i.test(source)) {
        throw new Error('first-person 3D validation error: missing first-person look/camera control logic');
    }
    if (runtimeLane === 'third_person_threejs') {
        const hasVisiblePlayer = /player(Mesh|Group|Body|Vehicle)|vehicle(Mesh|Group|Body)|hero(Mesh|Group|Body)|car(Mesh|Group|Body)|scene\.add\s*\(\s*(player|vehicle|hero|car)/i.test(source);
        const hasFollowCamera = /followCamera|chaseCamera|cameraOffset|cameraTarget|camera\.lookAt|lerp\s*\(|over[-_ ]?the[-_ ]?shoulder|third[-_ ]?person/i.test(source);
        if (!hasVisiblePlayer) {
            throw new Error('third-person 3D validation error: missing visible player/vehicle mesh or group');
        }
        if (!hasFollowCamera) {
            throw new Error('third-person 3D validation error: missing chase/follow camera logic');
        }
    }
    if (!/pointerdown/i.test(source)) {
        throw new Error('first-person 3D validation error: missing pointerdown-based start/input flow');
    }
    if (/onclick\s*=|addEventListener\(\s*['"]click['"]/i.test(source) && !/pointerdown/i.test(source)) {
        throw new Error('first-person 3D validation error: relies on click without pointerdown fallback');
    }
    const hasRenderLoop = /requestAnimationFrame|renderer\.render\s*\(|function\s+animate\s*\(|const\s+animate\s*=\s*\(/i.test(source);
    const geometryCount = (source.match(/new\s+THREE\.(PlaneGeometry|BoxGeometry|CylinderGeometry|SphereGeometry|CapsuleGeometry|BufferGeometry|RingGeometry|TorusGeometry|ConeGeometry)/gi) || []).length;
    const sceneAddCount = (source.match(/scene\.add\s*\(/gi) || []).length;
    const hasSceneGeometry =
        /new\s+THREE\.(PlaneGeometry|BoxGeometry|CylinderGeometry|SphereGeometry|CapsuleGeometry|BufferGeometry)/i.test(source) &&
        /scene\.add\s*\(/i.test(source);
    const hasWorldBuilder =
        /buildWorld|buildTrack|createTrack|spawnTrack|spawnRoad|createRoad|spawnRoadSegment|createRoadSegment|spawnObstacles|spawnEnemies|spawnEnemy|createRoom|createCorridor|createArena|createLevel|world\s*=\s*\{[^}]*walls/i.test(source) ||
        (geometryCount >= 3 && sceneAddCount >= 5 && /road|track|lane|barrier|wall|floor|ground|checkpoint|obstacle/i.test(source));
    const hasLight = /AmbientLight|DirectionalLight|PointLight|HemisphereLight|SpotLight/i.test(source);
    const hasMovementState = /moveX|moveY|velocity|player\.position|camera\.position|yaw|pitch/i.test(source);

    if (!hasRenderLoop) {
        throw new Error(`${runtimeLane} validation error: missing active render loop`);
    }
    if (!hasSceneGeometry) {
        throw new Error(`${runtimeLane} validation error: missing real scene geometry added to the world`);
    }
    if (!hasWorldBuilder) {
        throw new Error(`${runtimeLane} validation error: missing world-construction logic`);
    }
    if (!hasLight) {
        throw new Error(`${runtimeLane} validation error: missing scene lighting`);
    }
    if (!hasMovementState) {
        throw new Error(`${runtimeLane} validation error: missing playable movement/camera state`);
    }
}

function validateControlRigContract(specSheet, html) {
    const controlRig = specSheet?.controlRig;
    if (!controlRig) {
        return;
    }

    const source = String(html || '');
    if (!source) {
        throw new Error(`${controlRig} validation error: empty HTML output`);
    }

    if (controlRig === 'cockpit_driver') {
        const hasSteeringUi = /steering wheel|steering-pad|steer-pad|id=["'][^"']*steer|class=["'][^"']*steer|STEER/i.test(source);
        const hasThrottleUi = /ACCEL|THROTTLE|GAS|PEDAL|id=["'][^"']*accel|id=["'][^"']*throttle|class=["'][^"']*accel/i.test(source);
        const hasBrakeUi = /BRAKE|id=["'][^"']*brake|class=["'][^"']*brake/i.test(source);
        const hasDrivingState = /speed|steering|throttle|brake|laneOffset|roadScroll|dashboard/i.test(source);
        const hasCockpitHud = /dashboard|speedometer|rpm|km\/h|cockpit/i.test(source);

        if (!hasSteeringUi) {
            throw new Error('cockpit-driver validation error: missing visible steering control');
        }
        if (!hasThrottleUi) {
            throw new Error('cockpit-driver validation error: missing visible accelerate/throttle control');
        }
        if (!hasBrakeUi) {
            throw new Error('cockpit-driver validation error: missing visible brake control');
        }
        if (!hasDrivingState) {
            throw new Error('cockpit-driver validation error: missing driving-state logic (speed/steering/throttle/brake)');
        }
        if (!hasCockpitHud) {
            throw new Error('cockpit-driver validation error: missing cockpit/dashboard HUD language');
        }
        return;
    }

    if (controlRig === 'chase_camera_driver') {
        const hasDriveControls = /STEER|ACCEL|THROTTLE|GAS|BRAKE|DRIFT|BOOST|steering|throttle|brake|drift/i.test(source);
        const hasVehicleState = /vehicle|car|speed|steering|throttle|brake|drift|wheel/i.test(source);
        const hasChaseCamera = /chaseCamera|followCamera|cameraOffset|cameraTarget|camera\.lookAt|lerp\s*\(|third[-_ ]?person/i.test(source);
        if (!hasDriveControls) {
            throw new Error('chase-camera-driver validation error: missing visible driving controls');
        }
        if (!hasVehicleState) {
            throw new Error('chase-camera-driver validation error: missing vehicle driving-state logic');
        }
        if (!hasChaseCamera) {
            throw new Error('chase-camera-driver validation error: missing chase/follow camera logic');
        }
        return;
    }

    if (controlRig === 'third_person_joystick') {
        const hasMovementUi = /joystick|thumbpad|move pad|move-zone|movement zone|move stick|left-pad|virtual joystick|MOVE/i.test(source);
        const hasActionUi = /ACTION|ATTACK|INTERACT|FIRE|SHOOT|id=["'][^"']*(action|attack|interact|fire)|class=["'][^"']*(action|attack|interact|fire)/i.test(source);
        const hasFollowCamera = /chaseCamera|followCamera|cameraOffset|cameraTarget|camera\.lookAt|lerp\s*\(|third[-_ ]?person/i.test(source);
        if (!hasMovementUi) {
            throw new Error('third-person-joystick validation error: missing visible movement control');
        }
        if (!hasActionUi) {
            throw new Error('third-person-joystick validation error: missing visible action/interact/attack control');
        }
        if (!hasFollowCamera) {
            throw new Error('third-person-joystick validation error: missing follow camera logic');
        }
        return;
    }

    if (controlRig === 'move_and_fire') {
        const hasMovementUi = /joystick|thumbpad|move pad|move-zone|movement zone|move stick|left-pad|virtual joystick|MOVE/i.test(source);
        const hasFireUi = /FIRE|SHOOT|ATTACK|BLAST|id=["'][^"']*fire|class=["'][^"']*fire|id=["'][^"']*attack|class=["'][^"']*attack/i.test(source);
        const hasCombatState = /projectile|bullet|shotCooldown|fireCooldown|enemyHit|damage|impact|attack/i.test(source);
        const hasCombatFeedback = /knockback|hit spark|muzzle flash|impact|enemy.*hp|damage pop|death burst|screen shake/i.test(source);

        if (!hasMovementUi) {
            throw new Error('move-and-fire validation error: missing visible movement control');
        }
        if (!hasFireUi) {
            throw new Error('move-and-fire validation error: missing visible fire/attack control');
        }
        if (!hasCombatState) {
            throw new Error('move-and-fire validation error: missing combat-state logic (projectiles/fire cooldown/damage)');
        }
        if (!hasCombatFeedback) {
            throw new Error('move-and-fire validation error: missing readable combat feedback');
        }
        return;
    }

    if (controlRig === 'lane_swipe_runner') {
        const hasLaneState = /laneIndex|targetLane|currentLane|laneWidth|lanes|runner\.lane/i.test(source);
        const hasRunnerMotion = /auto[- ]?run|forwardSpeed|scrollSpeed|distance|trackScroll|runnerSpeed/i.test(source);
        const hasSwipeOrRunnerControls = /swipe|JUMP|SLIDE|BOOST|lane change|jump button|slide button/i.test(source);
        const hasLaneObstacles = /obstacle.*lane|coin line|pickup line|spawnTrack|track chunk|lane obstacle/i.test(source);

        if (!hasLaneState) {
            throw new Error('lane-swipe-runner validation error: missing discrete lane-state logic');
        }
        if (!hasRunnerMotion) {
            throw new Error('lane-swipe-runner validation error: missing automatic forward runner motion');
        }
        if (!hasSwipeOrRunnerControls) {
            throw new Error('lane-swipe-runner validation error: missing swipe/jump/slide control language');
        }
        if (!hasLaneObstacles) {
            throw new Error('lane-swipe-runner validation error: missing lane-based obstacle or pickup structure');
        }
        return;
    }

    if (controlRig === 'binary_choice_story') {
        const hasPromptText = /question|prompt|note|message|letter|answer|continue|read|watching|stay|leave|yes|no/i.test(source);
        const hasChoiceUi = /<button|YES|NO|CONTINUE|OPEN|READ|ANSWER|STAY|LEAVE|choice/i.test(source);
        const hasSceneState = /phase|selectedChoice|revealProgress|tension|advancePhase|handleChoice|restartExperience/i.test(source);
        const hasAtmosphereLayer = /vignette|grain|noise|flicker|glow|ambient|texture|overlay|shadow|gradient/i.test(source);

        if (!hasPromptText) {
            throw new Error('binary-choice-story validation error: missing readable prompt or focal text');
        }
        if (!hasChoiceUi) {
            throw new Error('binary-choice-story validation error: missing visible choice or continue control');
        }
        if (!hasSceneState) {
            throw new Error('binary-choice-story validation error: missing scene-phase or reveal-state logic');
        }
        if (!hasAtmosphereLayer) {
            throw new Error('binary-choice-story validation error: missing atmospheric scene treatment');
        }
        return;
    }

    if (controlRig === 'drag_drop_toybox') {
        const hasToyboxZones = /ingredient|tool|shelf|pantry|tray|source zone|workbench|station|cauldron|machine|altar|lab/i.test(source);
        const hasSystemState = /selectedItems|phase|progress|result|canCombine|revealResult|runReaction|resetToybox|addIngredient/i.test(source);
        const hasTriggerUi = /MIX|COMBINE|FUSE|COOK|BREW|REVEAL|RESET|button/i.test(source);
        const hasReactionFeedback = /bubble|spark|glow|shake|progress|reaction|reveal|transform|result modal|result card/i.test(source);

        if (!hasToyboxZones) {
            throw new Error('drag-drop-toybox validation error: missing readable source/workbench/result zones');
        }
        if (!hasSystemState) {
            throw new Error('drag-drop-toybox validation error: missing toybox system-state logic');
        }
        if (!hasTriggerUi) {
            throw new Error('drag-drop-toybox validation error: missing combine/reveal trigger control');
        }
        if (!hasReactionFeedback) {
            throw new Error('drag-drop-toybox validation error: missing reaction or reveal feedback');
        }
    }
}

function validateCapabilityContracts(specSheet, html) {
    const capabilities = Array.isArray(specSheet?.capabilities)
        ? specSheet.capabilities.map((capability) => capability?.id).filter(Boolean)
        : [];
    if (capabilities.length === 0) return;

    const hasCapability = (id) => capabilities.includes(id);
    const source = String(html || '');
    const fail = (id, message) => {
        throw new Error(`${id} capability validation error: ${message}`);
    };

    if (hasCapability('chase_camera_driver')) {
        if (!/chaseCamera|followCamera|cameraOffset|cameraTarget|camera\.lookAt|third[-_ ]?person/i.test(source)) {
            fail('chase_camera_driver', 'missing chase/follow camera logic');
        }
        if (!/vehicle|car|player(Mesh|Group|Body)|speed|steering|throttle|brake|drift/i.test(source)) {
            fail('chase_camera_driver', 'missing visible vehicle/player driving state');
        }
    }

    if (hasCapability('touch_driving_controls')) {
        if (!/STEER|ACCEL|GAS|THROTTLE|BRAKE|DRIFT|BOOST|steer|throttle|brake/i.test(source)) {
            fail('touch_driving_controls', 'missing visible steering, accelerate/gas, brake, or drift controls');
        }
    }

    if (hasCapability('projectile_ballistics')) {
        if (!/angle|power|trajectory|gravity|projectile|velocity|vx|vy|arc/i.test(source)) {
            fail('projectile_ballistics', 'missing angle/power projectile physics');
        }
    }

    if (hasCapability('turn_based_duel')) {
        if (!/turn|YOUR TURN|ENEMY TURN|currentTurn|playerTurn|enemyTurn/i.test(source)) {
            fail('turn_based_duel', 'missing explicit turn state or turn label');
        }
    }

    if (hasCapability('weapon_cards')) {
        if (!/weapon|card|selectedWeapon|CHOOSE WEAPON|ammo|hail|pogo|wrecking/i.test(source)) {
            fail('weapon_cards', 'missing weapon cards or selected weapon state');
        }
    }

    if (hasCapability('rope_path_puzzle')) {
        if (!/rope|path|line|arm|drag|pointermove|goal|gem|target/i.test(source)) {
            fail('rope_path_puzzle', 'missing draggable rope/path and goal interaction');
        }
    }

    if (hasCapability('survival_stats')) {
        if (!/health|hunger|fire|thirst|stamina|sanity|day/i.test(source)) {
            fail('survival_stats', 'missing survival meters or day/status UI');
        }
    }

    if (hasCapability('inventory_hotbar')) {
        if (!/inventory|hotbar|slot|selectedItem|itemSlots|tool/i.test(source)) {
            fail('inventory_hotbar', 'missing inventory or hotbar state');
        }
    }

    if (hasCapability('brush_canvas')) {
        if (!/pointermove|draw|brush|stroke|lineTo|canvas|clear/i.test(source)) {
            fail('brush_canvas', 'missing real pointer drawing/brush canvas behavior');
        }
    }

    if (hasCapability('decorate_surface')) {
        if (!/decorate|surface|target|nail|painting|canvas|selectedColor|pattern|finish/i.test(source)) {
            fail('decorate_surface', 'missing editable decoration target or selected style state');
        }
    }

    if (hasCapability('palette_unlocks')) {
        if (!/locked|unlock|palette|color|pattern|finish|decor/i.test(source)) {
            fail('palette_unlocks', 'missing locked/unlocked palette or cosmetic options');
        }
    }

    if (hasCapability('shop_economy')) {
        if (!/coin|cash|money|sell|buy|shop|price|currency|unlock/i.test(source)) {
            fail('shop_economy', 'missing currency and buy/sell/unlock loop');
        }
    }

    if (hasCapability('bubble_grid')) {
        if (!/bubble|grid|match|pop|row|col|color/i.test(source)) {
            fail('bubble_grid', 'missing bubble grid or match/pop state');
        }
    }

    if (hasCapability('aim_trajectory')) {
        if (!/trajectory|aim|guide|dashed|arc|bounce|lineTo|reticle/i.test(source)) {
            fail('aim_trajectory', 'missing visible aim trajectory or guide logic');
        }
    }

    if (hasCapability('image_slice_puzzle')) {
        if (!/slice|piece|puzzle|image|panel|next puzzle|progress/i.test(source)) {
            fail('image_slice_puzzle', 'missing image slice/puzzle progress structure');
        }
    }
}

function validateFirstFrameContract(specSheet, html) {
    const runtimeLane = specSheet?.runtimeLane;
    const source = String(html || '');
    if (!runtimeLane || !source) {
        return;
    }

    if (runtimeLane === 'first_person_threejs') {
        const hasForegroundOrHud = /dashboard|cockpit|crosshair|speedometer|hud|weapon/i.test(source);
        const hasImmediateWorldRead = /floor|road|runway|wall|corridor|skyline|lane line|landmark|pickup|enemy/i.test(source);
        const hasWorldMeshes =
            /scene\.add\s*\([^)]*(floor|ground|wall|corridor|room|crate|barrel|enemy|pickup)/i.test(source) ||
            /new\s+THREE\.(PlaneGeometry|BoxGeometry|CylinderGeometry)/i.test(source);
        if (!hasForegroundOrHud || !hasImmediateWorldRead || !hasWorldMeshes) {
            throw new Error('first-frame validation error: first-person lane is missing immediate foreground/HUD, world-read cues, or real world meshes');
        }
        return;
    }

    if (runtimeLane === 'third_person_threejs') {
        const hasVisiblePlayer = /player|hero|vehicle|car/i.test(source);
        const hasWorldDepth = /floor|ground|road|arena|lane|wall|landmark|checkpoint|pickup|enemy|hazard/i.test(source);
        const hasFollowCue = /chase|follow|third[-_ ]?person|camera\.lookAt|cameraOffset|cameraTarget/i.test(source);
        if (!hasVisiblePlayer || !hasWorldDepth || !hasFollowCue) {
            throw new Error('first-frame validation error: third-person lane is missing visible player/vehicle, world depth, or follow-camera cue');
        }
        return;
    }

    if (runtimeLane === 'endless_runner_vertical') {
        const hasRunner = /runner|player/i.test(source);
        const hasLaneRead = /lane|laneWidth|lane marker|track stripe|three lanes/i.test(source);
        const hasEarlyTarget = /coin|obstacle|train|barrier/i.test(source);
        if (!hasRunner || !hasLaneRead || !hasEarlyTarget) {
            throw new Error('first-frame validation error: runner lane is missing runner, lanes, or early obstacle/pickup read');
        }
        return;
    }

    if (runtimeLane === 'single_room_shooter') {
        const hasHero = /hero|player|survivor|soldier/i.test(source);
        const hasRoom = /room|wall|floor|cover|bunker|crate|barrel|terminal/i.test(source);
        const hasControls = /joystick|thumbpad|move pad|FIRE|SHOOT|ATTACK/i.test(source);
        if (!hasHero || !hasRoom || !hasControls) {
            throw new Error('first-frame validation error: room shooter is missing immediate hero/room/control readability');
        }
        return;
    }

    if (runtimeLane === 'story_horror_vignette') {
        const hasPrompt = /question|prompt|note|message|letter|answer|continue|read|yes|no/i.test(source);
        const hasAtmosphere = /vignette|grain|noise|flicker|glow|ambient|texture|overlay|shadow|gradient/i.test(source);
        if (!hasPrompt || !hasAtmosphere) {
            throw new Error('first-frame validation error: story/horror vignette is missing immediate focal prompt or atmosphere');
        }
        return;
    }

    if (runtimeLane === 'simulation_toybox') {
        const hasCenterpiece = /cauldron|machine|altar|workbench|station|pot|vessel|core/i.test(source);
        const hasSourceZone = /ingredient|tool|shelf|pantry|tray|toolbar|card row/i.test(source);
        const hasActionCue = /MIX|COMBINE|FUSE|COOK|BREW|REVEAL|ready/i.test(source);
        if (!hasCenterpiece || !hasSourceZone || !hasActionCue) {
            throw new Error('first-frame validation error: simulation toybox is missing immediate centerpiece/source/action readability');
        }
        return;
    }
}

function buildControlRigRepairInstruction(controlRig) {
    if (controlRig === 'cockpit_driver') {
        return 'This game MUST preserve a cockpit-driving control rig with visible steering, accelerate, and brake controls plus dashboard-style HUD instrumentation.';
    }
    if (controlRig === 'chase_camera_driver') {
        return 'This game MUST preserve a chase-camera driving rig with a visible vehicle, follow camera, steering, accelerate, brake, and drift/boost feedback.';
    }
    if (controlRig === 'third_person_joystick') {
        return 'This game MUST preserve a third-person character rig with a visible hero, follow camera, left movement control, action/interact button, and readable world objectives.';
    }
    if (controlRig === 'move_and_fire') {
        return 'This game MUST preserve a move-and-fire control rig with a visible movement pad or joystick, a visible fire/attack control, real projectile or attack logic, and readable hit feedback.';
    }
    if (controlRig === 'lane_swipe_runner') {
        return 'This game MUST preserve a lane-swipe runner control rig with automatic forward motion, discrete lane logic, and visible swipe/jump/slide behavior or clearly labeled runner controls.';
    }
    if (controlRig === 'binary_choice_story') {
        return 'This game MUST preserve a minimal story/horror interaction with a readable prompt, visible choice or continue controls, atmospheric scene treatment, and real phase/reveal changes after interaction.';
    }
    if (controlRig === 'drag_drop_toybox') {
        return 'This game MUST preserve a simulation/toybox interaction with clear source and workbench zones, visible combine/reveal controls, central object reaction feedback, and a real result/reveal state.';
    }
    return 'Preserve the intended control fantasy.';
}

function buildFirstFrameRepairInstruction(specSheet) {
    const checklist = Array.isArray(specSheet?.firstFrameChecklist) && specSheet.firstFrameChecklist.length > 0
        ? specSheet.firstFrameChecklist.map((item) => `- ${item}`).join('\n')
        : '- show a readable focal object and lane-defining cue immediately';

    return [
        'The first rendered frame must look authored immediately.',
        'These first-frame items must already be visible when the game boots:',
        checklist,
        'Do not leave the player on a blank, muddy, or under-staged opening frame while waiting for later transitions.'
    ].join('\n');
}

async function streamNvidiaText({ model, systemPrompt, userPrompt, maxTokens, temperature, retryLabel, fallbackModels = [] }) {
    return withNvidiaRetries(async (currentModel, client, providerTag) => {
        const modelToUse = resolveTextModelForProvider(currentModel || model, providerTag);
        const stream = await client.chat.completions.create({
            ...getTextChatOptions(modelToUse, maxTokens, {
                providerTag,
                temperature: isMoonshotDirectProvider(providerTag) ? undefined : temperature,
            }),
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
        });

        let output = "";
        for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
                output += chunk.choices[0].delta.content;
            }
        }

        return output;
    }, {
        label: retryLabel || model,
        maxAttempts: 3,
        baseDelayMs: 1500,
        fallbackModels
    });
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
        `);
    }
    return generationQueueReadyPromise;
}

async function findActiveDuplicateGenerationJob(userId, kind, prompt) {
    await ensureGenerationQueueSchema();
    const result = await pool.query(
        `SELECT id, status, created_at
         FROM generation_jobs
         WHERE user_id = $1
           AND kind = $2
           AND status IN ('queued', 'running')
           AND lower(trim(prompt)) = lower(trim($3))
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, kind, prompt]
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
    if (!allowDuplicate) {
        const duplicate = await findActiveDuplicateGenerationJob(userId, kind, prompt);
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
            `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE
             SET title = EXCLUDED.title,
                 html_payload = '',
                 raw_code = '',
                 prompt = EXCLUDED.prompt`,
            [jobId, userId, prompt, safeTitle, '', '', true]
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

async function updateGenerationJobBenchmarkResult(jobId, benchmarkResult) {
    if (!benchmarkResult) return;
    await ensureGenerationQueueSchema();
    await pool.query(
        `UPDATE generation_jobs
         SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{benchmarkResult}', $2::jsonb, true),
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, JSON.stringify(benchmarkResult)]
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

async function runGenerationJob(job) {
    const runner = generationJobRunners.get(job.kind);
    if (!runner) {
        throw new Error(`No generation runner registered for job kind "${job.kind}"`);
    }

    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
    rememberPendingBoot(job.id, { status: 'running', userId: job.user_id });
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
    }
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

function sanitizeMediaAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) {
        return [];
    }

    return rawAttachments
        .map((asset) => ({
            type: normalizeMediaAttachmentType(asset?.type),
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

function summarizeMakerAssets(generatedAssets = null) {
    const productionManifest = generatedAssets?.makerAssetManifest || generatedAssets?.manifest?.makerAssetManifest || null;
    if (productionManifest) return summarizeMakerAssetManifest(productionManifest);

    if (!generatedAssets) return summarizeMakerAssetManifest(null);

    const summarizeAsset = (asset = {}) => ({
        id: asset.id || asset.key || null,
        key: asset.key || asset.id || null,
        role: asset.role || asset.category || null,
        category: asset.category || null,
        type: asset.type || asset.kind || null,
        kind: asset.kind || null,
        width: asset.width || null,
        height: asset.height || null,
        transparent: asset.transparent !== false,
        gameplayRole: asset.gameplayRole || asset.roleInGameplay || null,
        hasEmbeddedImage: Boolean(asset.url || (asset.key && generatedAssets.assets?.[asset.key])),
        bytesApprox: Math.round(String(asset.url || generatedAssets.assets?.[asset.key] || '').length * 0.75),
    });

    return {
        version: 2,
        assets: Array.isArray(generatedAssets.assetPack) ? generatedAssets.assetPack.map(summarizeAsset) : [],
        slots: [],
        missingRequiredSlots: [],
        animations: Array.isArray(generatedAssets.animations) ? generatedAssets.animations : [],
        audio: generatedAssets.audio || { sfx: [], music: [] },
        tilesets: Array.isArray(generatedAssets.tilesets) ? generatedAssets.tilesets : [],
        productionContract: generatedAssets.productionContract || generatedAssets.manifest?.productionContract || null,
        artDirection: generatedAssets.assetPlan?.artDirection || generatedAssets.manifest?.artDirection || null,
        quality: summarizeMakerAssetQuality(generatedAssets.assetQuality || null),
        errors: Array.isArray(generatedAssets.errors) ? generatedAssets.errors : [],
    };
}

function hasGeneratedVisualAssets(generatedAssets = null) {
    return Boolean(generatedAssets?.assets && Object.keys(generatedAssets.assets).length > 0);
}

function attachMakerAssetManifest(generatedAssets = null, context = {}) {
    const manifest = buildMakerAssetManifest({
        generatedAssets,
        assetContract: context.assetContract || null,
        templateContract: context.templateContract || null,
        qualityIntent: context.qualityIntent || {},
        errors: context.errors || [],
    });
    if (!generatedAssets) return { makerAssetManifest: manifest };
    generatedAssets.makerAssetManifest = manifest;
    generatedAssets.manifest = {
        ...(generatedAssets.manifest || {}),
        makerAssetManifest: manifest,
    };
    return generatedAssets;
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

async function writeMakerAssetRuntimeFiles(workspace, generatedAssets = null) {
    if (!workspace || !generatedAssets) return;
    if (generatedAssets.materializedAssetPack) {
        await writeMakerJson(workspace, 'asset-pack.json', generatedAssets.materializedAssetPack);
    }
    if (generatedAssets.materializedAssetWiringReport) {
        await writeMakerJson(workspace, 'asset-wiring-report.json', generatedAssets.materializedAssetWiringReport);
    }
    await writeMakerJson(workspace, 'animations.json', {
        version: 1,
        source: 'gametok-native-maker',
        animations: Array.isArray(generatedAssets.animations) ? generatedAssets.animations : [],
    });
    await writeMakerJson(workspace, 'tilesets.json', {
        version: 1,
        source: 'gametok-native-maker',
        tilesets: Array.isArray(generatedAssets.tilesets) ? generatedAssets.tilesets : [],
    });
}

async function analyzeAndWriteMakerAssetQuality(workspace, generatedAssets = null, assetContract = null) {
    const report = await analyzeMakerAssetQuality(generatedAssets, { assetContract });
    if (generatedAssets) {
        generatedAssets.assetQuality = report;
        generatedAssets.manifest = {
            ...(generatedAssets.manifest || {}),
            assetQuality: report,
        };
    }
    if (workspace) {
        await writeMakerJson(workspace, 'asset-quality-report.json', report);
        await writeMakerJson(workspace, 'asset-quality-summary.json', summarizeMakerAssetQuality(report));
    }
    return report;
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

function buildMakerPlan(qualityIntent = {}, prompt = '', templateContract = null) {
    const playable = qualityIntent.playableExperience || {};
    return {
        version: 1,
        title: qualityIntent.title || 'Untitled Game',
        prompt,
        templateContract: summarizeMakerTemplateContract(templateContract),
        classification: templateContract?.classification || null,
        userIntent: qualityIntent.userIntent || '',
        firstTenSeconds: playable.firstTenSeconds || [],
        coreLoop: playable.coreLoop || '',
        primaryMechanic: playable.primaryMechanic || '',
        winCondition: playable.winCondition || '',
        loseCondition: playable.loseCondition || '',
        technicalRequirements: qualityIntent.technicalRequirements || {},
        artDirection: qualityIntent.artDirection || {},
        controls: qualityIntent.mobileControls || [],
        playerActions: qualityIntent.playerActions || [],
        entities: qualityIntent.entityRules || [],
        mustExist: qualityIntent.mustExist || [],
        feelRules: qualityIntent.feelRules || [],
        failureModesToAvoid: qualityIntent.failureModesToAvoid || [],
        visualAssets: qualityIntent.visualAssets || {},
        audioNeeds: qualityIntent.audioNeeds || {},
        acceptanceChecks: [
            ...(Array.isArray(qualityIntent.mustExist) ? qualityIntent.mustExist : []),
            'Boots without runtime crashes in the sandbox.',
            'Fits inside a 390x844 mobile viewport.',
            'Uses code-rendered HUD and controls.',
        ],
    };
}

function splitHtmlIntoProjectFiles(html) {
    const files = [];
    let styleIndex = 0;
    let scriptIndex = 0;
    let projectHtml = String(html || '');

    projectHtml = projectHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
        styleIndex += 1;
        const filePath = `src/style-${styleIndex}.css`;
        files.push({ path: filePath, kind: 'css', content: String(css || '').trim() + '\n' });
        return `<link rel="stylesheet" href="./${filePath}">`;
    });

    projectHtml = projectHtml.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, js) => {
        if (/\bsrc\s*=/.test(attrs || '')) return match;
        const code = String(js || '').trim();
        if (!code) return '';
        scriptIndex += 1;
        const filePath = `src/script-${scriptIndex}.js`;
        files.push({ path: filePath, kind: 'js', content: code + '\n' });
        return `<script${attrs || ''} src="./${filePath}"></script>`;
    });

    return { html: projectHtml, files };
}

async function materializeMakerProject(workspace, rawHtml, { title = 'GameTok Game', generatedAssets = null } = {}) {
    const projectRoot = path.join(workspace, 'project');
    const srcRoot = path.join(projectRoot, 'src');
    const distRoot = path.join(projectRoot, 'dist');
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
    await fs.promises.mkdir(srcRoot, { recursive: true });
    await fs.promises.mkdir(distRoot, { recursive: true });

    const split = splitHtmlIntoProjectFiles(rawHtml);
    await fs.promises.writeFile(path.join(projectRoot, 'index.html'), split.html, 'utf8');
    for (const file of split.files) {
        const destination = path.join(projectRoot, file.path);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, sanitizeMakerMainTsContent(file.content, file.path), 'utf8');
    }

    await fs.promises.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
        name: makerSafeFileName(title, 'gametok-game').toLowerCase(),
        private: true,
        type: 'module',
        scripts: {
            build: 'node build.mjs',
        },
    }, null, 2), 'utf8');

    await fs.promises.writeFile(path.join(projectRoot, 'build.mjs'), [
        "import fs from 'node:fs/promises';",
        "import path from 'node:path';",
        "const root = process.cwd();",
        "const dist = path.join(root, 'dist');",
        "await fs.rm(dist, { recursive: true, force: true });",
        "await fs.mkdir(dist, { recursive: true });",
        "await fs.cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));",
        "await fs.cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });",
        "console.log('Built static GameTok artifact to dist/index.html');",
        '',
    ].join('\n'), 'utf8');

    const materializedAssets = await materializeMakerAssetsForProject(projectRoot, generatedAssets, { workspace });

    await writeMakerJson(workspace, 'project-files.json', {
        version: 1,
        projectRoot,
        sourceIndex: path.join(projectRoot, 'index.html'),
        buildCommand: 'npm run build',
        artifact: path.join(distRoot, 'index.html'),
        files: [
            { path: 'index.html', kind: 'html', bytes: Buffer.byteLength(split.html, 'utf8') },
            ...split.files.map((file) => ({
                path: file.path,
                kind: file.kind,
                bytes: Buffer.byteLength(file.content, 'utf8'),
            })),
            { path: 'package.json', kind: 'manifest' },
            { path: 'build.mjs', kind: 'build_script' },
        ],
        assetSummary: summarizeMakerAssets(generatedAssets),
        materializedAssets: materializedAssets?.wiringReport || null,
    });

    await fs.promises.copyFile(path.join(projectRoot, 'index.html'), path.join(distRoot, 'index.html'));
    await fs.promises.cp(srcRoot, path.join(distRoot, 'src'), { recursive: true });
    return {
        projectRoot,
        sourceIndex: path.join(projectRoot, 'index.html'),
        distIndex: path.join(distRoot, 'index.html'),
        files: split.files,
    };
}

async function writeMakerBuilderMaps(workspace, projectBuild, phase = 'initial_build', { generatedAssets = null } = {}) {
    if (!workspace || !projectBuild) return null;
    const warnings = [];
    if (hasGeneratedVisualAssets(generatedAssets) && (!Array.isArray(projectBuild.usedAssetMap) || projectBuild.usedAssetMap.length === 0)) {
        warnings.push({
            id: 'builder_asset_map_missing',
            message: 'Generated assets exist but builder returned an empty usedAssetMap.',
        });
    }
    if (!Array.isArray(projectBuild.gameSystemMap) || projectBuild.gameSystemMap.length === 0) {
        warnings.push({
            id: 'builder_system_map_missing',
            message: 'Builder returned an empty gameSystemMap.',
        });
    }
    const maps = {
        version: 1,
        source: 'gametok-maker-builder-tool-use-map',
        phase,
        at: new Date().toISOString(),
        usedAssetMap: Array.isArray(projectBuild.usedAssetMap) ? projectBuild.usedAssetMap : [],
        gameSystemMap: Array.isArray(projectBuild.gameSystemMap) ? projectBuild.gameSystemMap : [],
        warnings,
        notes: Array.isArray(projectBuild.notes) ? projectBuild.notes : [],
    };
    await writeMakerJson(workspace, `builder-maps-${phase}.json`, maps);
    await writeMakerJson(workspace, 'builder-maps.json', maps);
    return maps;
}

function buildMakerProjectFromScaffold(templateScaffold = null, { templateContract = null } = {}) {
    if (!templateScaffold || !Array.isArray(templateScaffold.files) || templateScaffold.files.length === 0) {
        return null;
    }
    // Accept all scaffold files — new TypeScript/Vite templates live at root level,
    // old templates used a project/ prefix. Support both.
    let projectFiles = templateScaffold.files
        .filter((file) => String(file?.sourcePath || file?.path || '').startsWith('project/'))
        .map((file) => ({
            path: file.path,
            content: file.content,
        }));
    if (projectFiles.length === 0) {
        // New-style templates: files are at root (index.html, src/main.ts, package.json, etc.)
        projectFiles = templateScaffold.files
            .filter((file) => {
                const p = String(file?.path || '');
                // Skip template-api.md and other non-project docs
                return p && !p.endsWith('template-api.md');
            })
            .map((file) => ({
                path: file.path,
                content: file.content,
            }));
    }
    if (projectFiles.length === 0) {
        return null;
    }
    return {
        source: 'gametok-native-scaffold-file-loop',
        assetRequests: [],
        files: projectFiles,
        usedAssetMap: [],
        gameSystemMap: [
            {
                system: 'template_scaffold',
                state: Array.isArray(templateContract?.requiredState) ? templateContract.requiredState : [],
                functions: Array.isArray(templateContract?.requiredFunctions) ? templateContract.requiredFunctions : [],
                files: projectFiles.map((file) => file.path).filter(Boolean),
            },
        ],
        notes: [
            `Started from ${templateContract?.templateId || 'selected'} scaffold.`,
            'Primary build path is multi-turn file-agent edits over materialized files.',
        ],
    };
}

function mergeDreamAssetBundles(baseBundle = null, extraBundle = null) {
    if (!extraBundle) return baseBundle;
    if (!baseBundle) return extraBundle;

    const byKey = (items = []) => Array.from(new Map(
        items.filter(Boolean).map((item) => [item.key || item.id || JSON.stringify(item), item])
    ).values());
    const baseManifest = Array.isArray(baseBundle.manifest?.assets) ? baseBundle.manifest.assets : [];
    const extraManifest = Array.isArray(extraBundle.manifest?.assets) ? extraBundle.manifest.assets : [];
    const animations = byKey([...(baseBundle.animations || []), ...(extraBundle.animations || [])]);
    const audio = baseBundle.audio || extraBundle.audio || { sfx: [], music: [] };
    const tilesets = byKey([...(baseBundle.tilesets || []), ...(extraBundle.tilesets || [])]);
    const assetPack = byKey([...(baseBundle.assetPack || []), ...(extraBundle.assetPack || [])]);
    const manifestAssets = byKey([...baseManifest, ...extraManifest]);

    return {
        ...baseBundle,
        assets: {
            ...(baseBundle.assets || {}),
            ...(extraBundle.assets || {}),
        },
        assetPlan: {
            ...(baseBundle.assetPlan || {}),
            requestedDuringBuild: [
                ...((baseBundle.assetPlan && baseBundle.assetPlan.requestedDuringBuild) || []),
                ...((extraBundle.assetPlan && extraBundle.assetPlan.imageRequests) || []),
            ],
        },
        manifest: {
            ...(baseBundle.manifest || {}),
            assets: manifestAssets,
            animations,
            audio,
            tilesets,
        },
        assetPack,
        animations,
        audio,
        tilesets,
        errors: [
            ...(Array.isArray(baseBundle.errors) ? baseBundle.errors : []),
            ...(Array.isArray(extraBundle.errors) ? extraBundle.errors : []),
        ].filter(Boolean),
    };
}

function buildMakerAssetIntegrationPrompt({ qualityIntent = {}, prompt = '', projectFiles = [], generatedAssets = null, requestedAssets = [], templateContract = null, debugProtocol = null, assetContract = null, designBrief = '' }) {
    const isPhaser = templateContract?.id?.includes('phaser');

    return [
        'You are updating a native GameTok maker project after the backend fulfilled extra asset requests.',
        '',
        'Return JSON only. No markdown. No commentary.',
        'Schema:',
        JSON.stringify(getMakerFileJsonSchemaExample({
            actions: undefined,
            diagnosis: undefined,
            noEditsNeeded: undefined,
        }), null, 2),
        '',
        ...getMakerFileJsonEncodingRuleLines(),
        '',
        'Task:',
        '- Treat the GameTok maker GDD as mandatory. This pass is only successful if the updated files still satisfy Section 0-5.',
        '- Edit only files needed to use the newly generated assets.',
        '- Valid paths are index.html and existing src/**/*.css, src/**/*.ts, src/**/*.js, src/**/*.json files.',
        '- Protected scaffold/runtime files are read-only: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, src/scenes/Preloader.ts, Base*.ts files, package.json, tsconfig.json, and vite.config.ts.',
        '- Use patches[].replacements find/replace pairs copied exactly from the current project files.',
        '- Do not append duplicate implementations of an existing function or class method. Modify the existing function in place; TypeScript TS2393 is a hard failure.',
        '- Do not redeclare scaffold-owned BaseGameScene/BaseArenaScene fields such as player, enemies, enemyMeleeTriggers, decorations, obstacles, playerBullets, enemyBullets, ySortGroup, worldWidth, or worldHeight. Use inherited groups as-is, or name custom arrays sliceTargets/customEnemies/etc.',
        ...(isPhaser ? [
            '- CRITICAL (OPENGAME PROTOCOL): You have been provided with production-ready assets generated by the FLUX Artist Agent.',
            '- You MUST map these assets to Phaser Sprites. Do NOT invent procedural placeholder graphics or use `graphics.fillCircle`. Your only job is to wire up the generated textures.',
            '- If any code uses `this.add.dom`, `scene.add.dom`, DOMElement, or createFromHTML, the Phaser GameConfig MUST keep `dom: { createContainer: true }`.',
            '- Do not add unsupported Phaser ScaleConfig fields such as `maxWidth`, `maxHeight`, `minWidth`, or `minHeight`; use width, height, mode, autoCenter, and CSS/container sizing instead.',
        ] : [
            '- CRITICAL: You have been provided with production-ready assets generated by the FLUX Artist Agent.',
            '- You MUST wire these generated textures into the template\'s renderer. Do NOT invent procedural placeholder graphics if an asset exists for it.'
        ]),
        '- Use the asset keys from DREAM_ASSET_PACK / DreamAssets. Do not paste data URLs into source files.',
        '- DreamAssets.getImage(key) returns a data URL string, not an HTMLImageElement. For canvas drawing, create `const img = new Image(); img.onload = ...; img.src = dataUrl;` or use DreamAssets.loadImageElement(key). Never assign `.onload` to the string returned by getImage(), and never pass asset-pack records/data URLs to ctx.drawImage.',
        '- Do not declare DREAM_ASSETS, DREAM_ASSET_PACK, DREAM_ANIMATIONS, DREAM_TILESETS, DREAM_AUDIO_MANIFEST, or DreamAssets in src/main.ts. The scaffold already provides runtime globals and TypeScript declarations.',
        '- If TypeScript needs access to runtime globals, use window.DREAM_ASSETS, window.DREAM_ASSET_PACK, window.DreamAssets, or `(window as any)` instead of adding `declare global` blocks.',
        '- Respect the asset quality summary. Do not wire assets with fatal quality issues into live gameplay.',
        '- Prefer player/enemy/item/prop/background assets for actual gameplay visuals.',
        '- If frame_sequence animations exist, connect them through DREAM_ANIMATIONS, DreamAssets.createAnimations(), DreamAssets.animationsFor(), DreamAssets.applyTween(), or manual frame cycling.',
        '- If tilesets exist, connect them through DREAM_TILESETS, DreamAssets.firstTileset(), DreamAssets.getTileset(), or tileset image keys.',
        '- Prefer the template asset contract slots over ad hoc asset choices.',
        '- Keep gameplay geometry and HUD code-rendered. Do not turn terrain, labels, buttons, meters, or hitboxes into baked images.',
        '- Preserve the existing gameplay and mobile layout.',
        '- Keep the project inside the selected native template contract. Do not remove required state, required functions, or first-frame behavior.',
        '',
        'Original user prompt:',
        prompt,
        '',
        formatMakerDesignBriefPromptBlock(designBrief),
        '',
        'Operational plan:',
        JSON.stringify(buildMakerPlan(qualityIntent, prompt, templateContract), null, 2),
        '',
        'Selected native template contract:',
        JSON.stringify(templateContract || null, null, 2),
        '',
        formatMakerDebugProtocolPromptBlock(debugProtocol),
        '',
        'Template asset contract:',
        JSON.stringify(assetContract || null, null, 2),
        '',
        'Assets requested by builder and now generated:',
        JSON.stringify(requestedAssets, null, 2),
        '',
        'Updated asset summary:',
        JSON.stringify(summarizeMakerAssets(generatedAssets), null, 2),
        '',
        'Asset quality summary:',
        JSON.stringify(summarizeMakerAssetQuality(generatedAssets?.assetQuality || null), null, 2),
        '',
        'Structured asset tool contract:',
        JSON.stringify(buildStructuredAssetToolRequest(generatedAssets?.assetPlan || {}, assetContract), null, 2),
        '',
        'Current project files:',
        JSON.stringify(projectFiles, null, 2),
    ].join('\n');
}

async function materializeMakerProjectFiles(workspace, projectBuild, { title = 'GameTok Game', generatedAssets = null } = {}) {
    const projectRoot = path.join(workspace, 'project');
    const srcRoot = path.join(projectRoot, 'src');
    const distRoot = path.join(projectRoot, 'dist');
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
    await fs.promises.mkdir(srcRoot, { recursive: true });
    await fs.promises.mkdir(distRoot, { recursive: true });

    const files = [];
    const seen = new Set();
    for (const file of projectBuild.files) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, file.path);
        if (seen.has(cleanPath)) {
            throw new Error(`Duplicate project file returned by builder: ${cleanPath}`);
        }
        seen.add(cleanPath);
        const content = sanitizeMakerMainTsContent(file.content, cleanPath);
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.promises.writeFile(absolutePath, content, 'utf8');
        files.push({
            path: cleanPath,
            kind: cleanPath.endsWith('.css') ? 'css' : cleanPath.endsWith('.js') ? 'js' : cleanPath.endsWith('.json') ? 'json' : 'html',
            bytes: Buffer.byteLength(content, 'utf8'),
        });
    }
    if (!seen.has('index.html')) {
        throw new Error('Project build response did not include index.html.');
    }

    if (!seen.has('package.json')) {
        await fs.promises.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
            name: makerSafeFileName(title, 'gametok-game').toLowerCase(),
            private: true,
            type: 'module',
            scripts: {
                build: 'node build.mjs',
            },
        }, null, 2), 'utf8');

        await fs.promises.writeFile(path.join(projectRoot, 'build.mjs'), [
            "import fs from 'node:fs/promises';",
            "import path from 'node:path';",
            "const root = process.cwd();",
            "const dist = path.join(root, 'dist');",
            "await fs.rm(dist, { recursive: true, force: true });",
            "await fs.mkdir(dist, { recursive: true });",
            "await fs.cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));",
            "await fs.cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });",
            "console.log('Built static GameTok artifact to dist/index.html');",
            '',
        ].join('\n'), 'utf8');
    }

    const materializedAssets = await materializeMakerAssetsForProject(projectRoot, generatedAssets, { workspace });

    const manifestFiles = [...files];
    manifestFiles.push(
        { path: 'public/assets/asset-pack.json', kind: 'asset_manifest' },
        { path: 'public/assets/animations.json', kind: 'asset_manifest' },
        { path: 'public/assets/audio-manifest.json', kind: 'asset_manifest' },
        { path: 'public/assets/asset-wiring-report.json', kind: 'asset_manifest' },
    );
    if (!seen.has('package.json')) {
        manifestFiles.push({ path: 'package.json', kind: 'manifest' });
        manifestFiles.push({ path: 'build.mjs', kind: 'build_script' });
    }

    await writeMakerJson(workspace, 'project-files.json', {
        version: 2,
        mode: 'file-native',
        projectRoot,
        sourceIndex: path.join(projectRoot, 'index.html'),
        buildCommand: 'npm run build',
        artifact: path.join(distRoot, 'index.html'),
        files: manifestFiles,
        notes: projectBuild.notes || [],
        usedAssetMap: projectBuild.usedAssetMap || [],
        gameSystemMap: projectBuild.gameSystemMap || [],
        assetSummary: summarizeMakerAssets(generatedAssets),
        materializedAssets: materializedAssets?.wiringReport || null,
    });

    await rebuildMakerProjectDistWithAutoRepair(projectRoot);
    return {
        projectRoot,
        sourceIndex: path.join(projectRoot, 'index.html'),
        distIndex: path.join(distRoot, 'index.html'),
        files,
        mode: 'file-native',
    };
}

async function loadMakerProjectFromWorkspace(workspace) {
    try {
        const manifestRaw = await fs.promises.readFile(path.join(workspace, 'project-files.json'), 'utf8');
        const manifest = JSON.parse(manifestRaw);
        const projectRoot = manifest?.projectRoot;
        if (!projectRoot || !fs.existsSync(path.join(projectRoot, 'index.html'))) {
            return null;
        }
        return {
            projectRoot,
            sourceIndex: manifest.sourceIndex || path.join(projectRoot, 'index.html'),
            distIndex: manifest.artifact || path.join(projectRoot, 'dist', 'index.html'),
            files: Array.isArray(manifest.files) ? manifest.files : [],
            mode: manifest.mode || 'file-native',
            manifest,
        };
    } catch {
        return null;
    }
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

async function readMakerProjectFiles(projectRoot) {
    let manifest = null;
    try {
        const manifestRaw = await fs.promises.readFile(path.join(path.dirname(projectRoot), 'project-files.json'), 'utf8');
        manifest = JSON.parse(manifestRaw);
    } catch {
        manifest = null;
    }

    const manifestPaths = Array.isArray(manifest?.files)
        ? manifest.files
            .map((file) => file?.path)
            .filter((filePath) => filePath === 'index.html' || /^src\/.+\.(css|js|json|ts|tsx)$/.test(filePath || '') || /^public\/assets\/(?:asset-pack|animations|audio-manifest|asset-wiring-report)\.json$/.test(filePath || ''))
        : [];
    const paths = new Set(['index.html', ...manifestPaths]);

    async function collectProjectFiles(directory, prefix) {
        let entries = [];
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            const relative = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) {
                await collectProjectFiles(absolute, relative);
            } else if (entry.isFile() && /\.(css|js|json|ts|tsx)$/i.test(entry.name)) {
                paths.add(relative);
            }
        }
    }
    await collectProjectFiles(path.join(projectRoot, 'src'), 'src');
    await collectProjectFiles(path.join(projectRoot, 'public', 'assets'), 'public/assets');

    const files = [];
    let totalChars = 0;
    for (const relativePath of Array.from(paths).sort()) {
        const { absolutePath, cleanPath } = safeMakerProjectPath(projectRoot, relativePath);
        try {
            let content = await fs.promises.readFile(absolutePath, 'utf8');
            const maxFileChars = cleanPath === 'index.html' ? 40000 : 70000;
            if (content.length > maxFileChars) {
                content = `${content.slice(0, maxFileChars)}\n/* [GameTok note: file truncated in repair prompt] */`;
            }
            totalChars += content.length;
            if (totalChars > 180000) {
                files.push({
                    path: cleanPath,
                    truncated: true,
                    content: content.slice(0, Math.max(8000, 180000 - (totalChars - content.length))),
                });
                break;
            }
            files.push({ path: cleanPath, content });
        } catch {
            // Ignore stale manifest entries.
        }
    }
    return files;
}

function isProtectedMakerRuntimeFile(cleanPath = '') {
    return [
        /^src\/(?:bootstrap|assetLoader|assetKeys)\.ts$/,
        /^src\/types\/global\.d\.ts$/,
        /^src\/scenes\/Preloader\.ts$/,
        /^src\/(?:characters|scenes|systems|behaviors)\/Base[A-Za-z0-9_]*\.ts$/,
        /^(?:package|tsconfig|vite\.config)\.json$/,
        /^vite\.config\.ts$/,
    ].some((pattern) => pattern.test(cleanPath));
}

function directRepairTaskForFailure(failure = '', templateId = null) {
    const text = String(failure || '');
    if (/Missing probe method:\s*(\w+)/i.test(text)) {
        const method = text.match(/Missing probe method:\s*(\w+)/i)?.[1] || 'probe method';
        return `Restore window.__GAMETOK_TEMPLATE_PROBE__.${method}() and connect it to live gameplay state.`;
    }
    if (/angle|power|trajectory signature|setAim/i.test(text)) {
        return 'setAim() does not change trajectory signature.';
    }
    if (/fire\(\).*active projectile|fire\(\).*projectile/i.test(text)) {
        return 'fire() does not create an active projectile.';
    }
    if (/updateProjectile\(\).*move|projectile.*did not move|during flight/i.test(text)) {
        return 'updateProjectile() does not move the projectile during flight.';
    }
    if (/shot resolution.*health.*terrain.*turn|resolution did not change|turn-state evidence/i.test(text)) {
        return 'shot resolution does not damage health, deform terrain, change turns, or finish the round.';
    }
    if (/probeDeformTerrain|sampled terrain|terrain height/i.test(text)) {
        return 'probeDeformTerrain() does not mutate terrain data.';
    }
    if (/move\(\).*player|move\(\).*position|player position/i.test(text)) {
        return 'move() does not change the player position.';
    }
    if (/spawnEnemyNearPlayer/i.test(text)) {
        return 'spawnEnemyNearPlayer() does not create a visible enemy.';
    }
    if (/spawnEnemy\(\)/i.test(text)) {
        return 'spawnEnemy() does not increase enemy count.';
    }
    if (/attack\(\).*projectile|attack object/i.test(text)) {
        return 'attack() does not create a projectile or attack object.';
    }
    if (/combat probe|score|health-state|enemy.*progression/i.test(text)) {
        return 'combat step does not change score, enemy state, projectile state, or health.';
    }
    if (/primaryAction\(\)/i.test(text)) {
        return 'primaryAction() does not mutate generic arcade gameplay state.';
    }
    if (/spawnThreat\(\)/i.test(text)) {
        return 'spawnThreat() does not increase live threat/entity count.';
    }
    if (/generic arcade|objective state/i.test(text)) {
        return 'generic arcade step() does not progress score, health, or objective state.';
    }
    if (/addBody\(\)/i.test(text)) {
        return 'addBody() does not increase simulation body count.';
    }
    if (/start\(\).*running simulation/i.test(text)) {
        return 'start() does not switch simulation into running mode.';
    }
    if (/step\(\).*goal object|physics/i.test(text)) {
        return 'step() does not advance simulated physics state.';
    }
    if (/goal.*target|win.*computed|result/i.test(text) && templateId === 'canvas-simulation') {
        return 'checkGoal() does not compute win/fail from live simulation state.';
    }
    if (/select\(\).*selected tile/i.test(text)) {
        return 'select() does not update selected tile state.';
    }
    if (/grid signature|move\(\).*grid/i.test(text)) {
        return 'move() does not change the grid signature.';
    }
    if (/resolve\(\).*score|goal progress/i.test(text)) {
        return 'resolve() does not change score or goal progress.';
    }
    if (/board|tile|grid/i.test(text) && templateId === 'canvas-grid-puzzle') {
        return 'grid puzzle state is decorative instead of driven by board data.';
    }
    if (/jump\(\).*upward velocity/i.test(text)) {
        return 'jump() does not give upward velocity.';
    }
    if (/collectNearest|collectible/i.test(text) && templateId === 'phaser-platformer') {
        return 'collectNearest() does not change score or collectible state.';
    }
    if (/platform|fall through|collision/i.test(text) && templateId === 'phaser-platformer') {
        return 'platform collision is not connected to player physics.';
    }
    if (/slide\(\).*sliding/i.test(text)) {
        return 'slide() does not enter sliding state.';
    }
    if (/spawnObstacle/i.test(text)) {
        return 'spawnObstacle() does not increase obstacle count.';
    }
    if (/distance|runner|collectible|obstacle/i.test(text) && templateId === 'canvas-runner') {
        return 'runner update loop does not advance distance, score, obstacles, or collectibles.';
    }
    if (/choice|choose\(\)|node|history|meters/i.test(text)) {
        return 'choose() does not change story node, history, or meters.';
    }
    if (/forceEnding/i.test(text)) {
        return 'forceEnding() does not reach an ending state.';
    }
    if (/reset\(\)/i.test(text)) {
        return 'reset() does not restore initial playable state.';
    }
    if (/asset pack ignored|never references DreamAssets|DREAM_ASSET_PACK/i.test(text)) {
        return 'Generated asset pack exists but the game source never loads it.';
    }
    if (/drawImage|HTMLImageElement|asset-pack records|manifest\/data objects|loaded image elements/i.test(text)) {
        return 'Canvas drawImage is receiving an asset-pack record or data URL instead of a preloaded HTMLImageElement.';
    }
    if (/state properties not declared|Did you mean|TS2551/i.test(text)) {
        return 'Source references a misspelled state property. Use the existing declared state key or add the missing key to the state initializer.';
    }
    if (/Duplicate function implementation|TS2393/i.test(text)) {
        return 'Source contains duplicate function or class method implementations. Keep one implementation per function name in the same scope.';
    }
    if (/trail|buns|ghosting|graphics\.clear/i.test(text)) {
        return 'The game is drawing active objects using raw graphics without clearing the buffer, causing snail trails. Rewrite the entity to use Sprites and Arcade Physics.';
    }
    if (/required asset slots|not referenced|not consumed|required roles/i.test(text)) {
        return 'Required generated asset slots are not connected to gameplay renderers.';
    }
    if (/Acceptance gate/i.test(text)) {
        return 'The game boots, but final acceptance did not prove the core playable loop strongly enough.';
    }
    if (templateId) {
        return `Repair the ${templateId} failed gameplay contract: ${text || 'unknown probe failure'}`;
    }
    return text || 'Repair the failed maker contract check.';
}

function buildTargetedRepairTasks(sandboxDiagnostics = null) {
    const diagnostics = sandboxDiagnostics || {};
    const tasks = [];
    const failedChecks = Array.isArray(diagnostics.failedContractChecks) ? diagnostics.failedContractChecks : [];

    for (const check of failedChecks) {
        if (!check) continue;
        if (check.id === 'template_runtime_probe') {
            const failures = Array.isArray(check.failures) ? check.failures : [];
            for (const failure of failures) {
                tasks.push({
                    priority: 'fatal',
                    source: 'template_runtime_probe',
                    templateId: check.templateId || diagnostics.templateRuntimeProbe?.templateId || null,
                    failure: String(failure || ''),
                    directRepairTask: directRepairTaskForFailure(failure, check.templateId || diagnostics.templateRuntimeProbe?.templateId || null),
                    repair: 'Fix the live gameplay implementation so the named probe method proves real state progression. Preserve the probe API and make the visible game state match the probe snapshot.',
                });
            }
        } else if (check.id === 'template_required_functions') {
            tasks.push({
                priority: 'fatal',
                source: 'template_contract',
                templateId: check.templateId || null,
                failure: `Missing required functions: ${(check.missingFunctions || []).join(', ')}`,
                directRepairTask: 'Required template functions are missing from the project.',
                repair: 'Restore the selected scaffold structure and required function names. Do not replace the native template with a generic implementation.',
            });
        } else if (check.id === 'asset_image_ui_violation') {
            tasks.push({
                priority: 'major',
                source: 'asset_contract',
                templateId: check.templateId || null,
                failure: check.message || 'Generated images used for UI/HUD controls.',
                directRepairTask: 'Generated image assets are being used for HUD/UI instead of gameplay art.',
                repair: 'Move HUD, labels, buttons, meters, sliders, and controls back to DOM/canvas code. Use generated images only for approved gameplay art slots.',
            });
        } else if (check.id === 'asset_pack_ignored') {
            tasks.push({
                priority: 'major',
                source: 'asset_contract',
                templateId: check.templateId || null,
                failure: check.message || 'Generated asset pack is ignored.',
                directRepairTask: 'Generated asset pack exists but the game source never loads it.',
                repair: 'Read DREAM_ASSET_PACK and use DreamAssets helpers for player, enemies, backgrounds, props, items, or effects. Keep code-rendered fallback art only behind missing-asset branches.',
            });
        } else if (check.id === 'asset_required_slots_unreferenced' || check.id === 'asset_required_roles_unused') {
            const missing = (check.missingSlots || check.missingRoles || []).join(', ');
            tasks.push({
                priority: 'major',
                source: 'asset_contract',
                templateId: check.templateId || null,
                failure: check.message || `Required asset slots unused: ${missing}`,
                directRepairTask: `Required generated asset slots are not connected to gameplay renderers${missing ? `: ${missing}` : ''}.`,
                repair: 'For each missing required slot, find the matching entry in DREAM_ASSET_PACK by role/key and render it through DreamAssets. Use the generated player/enemy/background assets before procedural placeholders.',
            });
        } else if (String(check.id || '').startsWith('preflight_')) {
            tasks.push({
                priority: check.severity === 'critical' ? 'fatal' : 'major',
                source: 'opengame_preflight',
                templateId: check.templateId || null,
                failure: check.message || 'Maker preflight check failed.',
                directRepairTask: check.message || directRepairTaskForFailure(check.repair || check.id, check.templateId || null),
                repair: check.repair || 'Fix this deterministic preflight issue before running build or sandbox checks again.',
            });
        } else if (check.id === 'asset_animations_unused') {
            const keys = (check.animationKeys || []).slice(0, 8).join(', ');
            tasks.push({
                priority: 'major',
                source: 'asset_contract',
                templateId: check.templateId || null,
                failure: check.message || `Generated animation frames unused: ${keys}`,
                directRepairTask: `Generated frame_sequence animations are not connected to sprites${keys ? `: ${keys}` : ''}.`,
                repair: 'Use DREAM_ANIMATIONS through DreamAssets.createAnimations()/animationsFor()/applyTween in Phaser, or manually cycle the listed frame keys in canvas renderers. Attach player/enemy animation frames to the matching gameplay entities.',
            });
        } else if (check.id === 'asset_tilesets_unused') {
            const keys = (check.tilesetKeys || []).slice(0, 8).join(', ');
            tasks.push({
                priority: 'major',
                source: 'asset_contract',
                templateId: check.templateId || null,
                failure: check.message || `Generated tileset unused: ${keys}`,
                directRepairTask: `Generated 7x7 tileset is not connected to tile/terrain rendering${keys ? `: ${keys}` : ''}.`,
                repair: 'Use DREAM_TILESETS or DreamAssets.firstTileset()/getTileset() to load the generated tileset image for visual tile terrain while keeping collision geometry code-defined.',
            });
        } else if (String(check.id || '').startsWith('asset_') || String(check.id || '').startsWith('tileset_') || String(check.id || '').startsWith('animation_')) {
            tasks.push({
                priority: 'major',
                source: 'asset_quality',
                templateId: check.templateId || null,
                failure: check.message || 'Generated asset quality/manifest check failed.',
                directRepairTask: `Generated asset ${check.assetKey || check.key || ''} failed quality or manifest checks.`.trim(),
                repair: 'Do not rely on the broken generated asset key. Use another valid generated asset for the role, or switch that role to intentional code-rendered fallback art while preserving gameplay.',
            });
        } else if (check.message) {
            tasks.push({
                priority: 'major',
                source: check.id || 'contract_check',
                templateId: check.templateId || null,
                failure: check.message,
                directRepairTask: directRepairTaskForFailure(check.message, check.templateId || null),
                repair: 'Repair the underlying gameplay contract violation without deleting diagnostics or probe hooks.',
            });
        }
    }

    const runtimeProbe = diagnostics.templateRuntimeProbe;
    if (runtimeProbe && runtimeProbe.success === false && tasks.length === 0) {
        for (const failure of runtimeProbe.failures || []) {
            tasks.push({
                priority: 'fatal',
                source: 'template_runtime_probe',
                templateId: runtimeProbe.templateId || null,
                failure: String(failure || ''),
                directRepairTask: directRepairTaskForFailure(failure, runtimeProbe.templateId || null),
                repair: 'Repair the required gameplay behavior until this probe passes.',
            });
        }
    }

    if (Array.isArray(diagnostics.canvasIssues) && diagnostics.canvasIssues.length > 0) {
        tasks.push({
            priority: 'fatal',
            source: 'viewport_probe',
            failure: `Canvas sizing issues: ${diagnostics.canvasIssues.map((issue) => `canvas#${issue.index}`).join(', ')}`,
            directRepairTask: 'Canvas dimensions or backing store exceed the mobile safe viewport.',
            repair: 'Clamp canvas dimensions and backing store to the GameTok safe viewport and recompute sizing on resize.',
        });
    }

    if (Array.isArray(diagnostics.visibleOutOfBoundsElements) && diagnostics.visibleOutOfBoundsElements.length > 0) {
        tasks.push({
            priority: 'fatal',
            source: 'viewport_probe',
            failure: 'Important HUD/control elements are outside the phone viewport.',
            directRepairTask: 'HUD or controls are outside the visible phone viewport.',
            repair: 'Move HUD and touch controls into the visible safe rectangle. Do not place controls under native chrome.',
        });
    }

    if (Number(diagnostics.horizontalOverflow || 0) > 4) {
        tasks.push({
            priority: 'fatal',
            source: 'viewport_probe',
            failure: `Horizontal overflow: ${diagnostics.horizontalOverflow}px.`,
            directRepairTask: 'Page has horizontal overflow on the phone viewport.',
            repair: 'Remove fixed oversized widths and fit all root/canvas/control elements within window.innerWidth.',
        });
    }

    return tasks.map((task, index) => ({
        ...task,
        id: task.id || `GT-REPAIR-${String(index + 1).padStart(3, '0')}`,
    }));
}

function buildMakerFileRepairPrompt({ qualityIntent = {}, prompt = '', crash = '', projectFiles = [], generatedAssets = null, sandboxDiagnostics = null, templateContract = null, debugProtocol = null, assetContract = null, designBrief = '', repairProtocolMatches = [], repairEvolutionGuidance = [] }) {
    const isPhaser = templateContract?.id?.includes('phaser');
    const targetedRepairTasks = buildTargetedRepairTasks(sandboxDiagnostics);
    const repairPlaybook = buildMakerRepairPlaybook(targetedRepairTasks);
    return [
        'You are repairing a GameTok native maker project after sandbox verification found a runtime crash.',
        '',
        'Return one strict JSON object only. No markdown formatting blocks (```). No commentary.',
        'Protocol schema:',
        JSON.stringify(getMakerFileJsonSchemaExample({
            diagnosis: {
                errorCode: 'string',
                messagePattern: 'string',
                rootCause: 'string',
                matchedProtocolRuleIds: ['string'],
            },
        }), null, 2),
        '',
        'Rules:',
        ...getMakerFileJsonEncodingRuleLines(),
        ...(isPhaser ? [
            '- CRITICAL ARCHITECTURE RULE (OPENGAME PROTOCOL): NEVER use `Phaser.GameObjects.Graphics` (or raw canvas `ctx.arc()`) to render active gameplay entities (players, enemies, projectiles).',
            '- You MUST use Sprites and Arcade Physics bodies (`this.physics.add.sprite`).',
            '- Use texture keys loaded from public/assets/asset-pack.json. Never pass asset-pack records, Image objects, or data URLs to Phaser sprite/image constructors.',
            '- If any UI helper uses `this.add.dom`, `scene.add.dom`, DOMElement, or createFromHTML, keep `dom: { createContainer: true }` in the Phaser GameConfig.',
            '- Never add unsupported Phaser ScaleConfig fields such as `maxWidth`, `maxHeight`, `minWidth`, or `minHeight`; use CSS/container constraints instead.',
            '- If you absolutely must use Graphics for UI, background, or drawing, you MUST call `graphics.clear()` at the beginning of every `update()` loop frame to prevent ghosting and trails.'
        ] : [
            '- CRITICAL ARCHITECTURE RULE: Use the provided DREAM_ASSET_PACK images for active gameplay entities instead of drawing raw shapes with ctx.arc().',
            '- If you must use raw graphics or canvas drawing for dynamic UI/entities, ensure you clear the background/buffer each frame to prevent ghosting and trails.',
            '- For ctx.drawImage, pass only preloaded HTMLImageElement/ImageBitmap/Canvas-like objects. Never pass DreamAssets.getImage(), DREAM_ASSET_PACK entries, asset-pack records, or raw data URL strings.'
        ]),
        '- Protected scaffold/runtime files are read-only: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, src/scenes/Preloader.ts, Base*.ts files, package.json, tsconfig.json, and vite.config.ts.',
        '- Do not append duplicate implementations of an existing function or class method. Modify the existing function in place; TypeScript TS2393 is a hard failure.',
        '- Do not redeclare scaffold-owned BaseGameScene/BaseArenaScene fields such as player, enemies, enemyMeleeTriggers, decorations, obstacles, playerBullets, enemyBullets, ySortGroup, worldWidth, or worldHeight. Use inherited groups as-is, or name custom arrays sliceTargets/customEnemies/etc.',
        '- Repair against the GameTok maker GDD, not just the crash string. Preserve all six GDD sections in the implementation.',
        '- If a repair conflicts with the GDD, satisfy the GDD and explain the constrained repair in notes.',
        '- Edit only the files that need changes.',
        '- Valid paths are index.html and existing src/*.css, src/*.ts, src/*.js, src/*.json files.',
        '- Use patches[].replacements find/replace pairs copied exactly from the current project files.',
        '- Preserve the user game idea and current mechanics.',
        '- Keep HUD, labels, buttons, meters, and controls code-rendered, not baked into AI images.',
        '- Keep the game mobile-first inside a 390x844 webview. Reserve top space for GameTok chrome.',
        '- Do not navigate to external websites, call window.location, submit forms, or open popups.',
        '- Do not add remote dependencies unless the existing project already uses that dependency.',
        '- For canvas games, use canvas.getContext("2d"). HTMLCanvasElement does not have getCanvasContext().',
        '- DreamAssets.getImage(key) returns a data URL string. Do not set `.onload`, `.onerror`, `.width`, or `.height` on that string. Convert it with `const img = new Image(); img.onload = ...; img.src = dataUrl;` or call DreamAssets.loadImageElement(key).',
        '- Do not add `declare global`, `declare const`, or `declare interface Window` declarations for DREAM_ASSETS, DREAM_ASSET_PACK, DREAM_ANIMATIONS, DREAM_TILESETS, DREAM_AUDIO_MANIFEST, or DreamAssets inside src/main.ts. The scaffold owns those declarations.',
        '- If TypeScript reports TS2687 for DreamAssets/DREAM_ASSETS/DREAM_ASSET_PACK, remove the duplicate declarations from gameplay files and use the existing window globals.',
        '- Fix the crash first. Then fix obvious viewport/control issues if they caused or hide the crash.',
        '- If the crash says the generated asset pack was ignored, update the game source to use DreamAssets, DREAM_ASSETS, or DREAM_ASSET_PACK for real gameplay visuals.',
        '- If generated assets exist, use them for the player, enemies, props, items, or backgrounds. Do not keep placeholder-only art unless no relevant asset exists.',
        '- If the asset quality report flags an asset as fatal, do not use that key. Use another valid asset or code-rendered fallback for that role.',
        '- If generated animation frames exist, wire DREAM_ANIMATIONS into player/enemy sprites or canvas frame cycling.',
        '- If generated tilesets exist, wire DREAM_TILESETS into terrain/tile drawing while keeping collision data code-defined.',
        '- If sandboxDiagnostics.templateRuntimeProbe failed, repair the exact required probe behavior. Do not remove the probe API to hide the failure.',
        '- Template probe failures are gameplay contract failures: fix live state, controls, collisions, scoring, or reset behavior until the probe passes.',
        '- Respect the template asset contract: never replace HUD, controls, terrain collision, or hitboxes with AI images.',
        '- Preserve the selected native template contract. Required state, required functions, first-frame behavior, and acceptance checks still apply after the fix.',
        '',
        'DreamAssets API contract available at runtime after post-processing:',
        '- window.DREAM_ASSETS: object of generated image data URLs by key.',
        '- window.DREAM_ASSET_PACK: structured asset manifest with role/category/key/type/transparent metadata.',
        '- DreamAssets.getImage(key): returns a generated image data URL.',
        '- DreamAssets.loadImageElement(key): returns a Promise<HTMLImageElement> for canvas drawImage usage.',
        '- DreamAssets.firstByRole(role): finds the first asset for roles like player, enemy, item, prop, background, environment, ui.',
        '- DreamAssets.preloadPhaser(scene): loads generated image assets into Phaser.',
        '- DreamAssets.addSprite(scene, roleOrKey, x, y, options): adds a Phaser sprite from a role or key.',
        '- DreamAssets.addBackgroundCover(scene, roleOrKey, width, height): adds a generated background image as a cover layer.',
        '- DreamAssets.firstTileset(): returns the first generated 7x7 tileset manifest.',
        '- DreamAssets.getTileset(key): returns a generated tileset manifest by key.',
        '- DreamAssets.safeRect(width, height): returns the GameTok chrome-safe playable rectangle.',
        '',
        `Crash: ${crash}`,
        '',
        'Targeted repair tasks:',
        JSON.stringify(targetedRepairTasks, null, 2),
        '',
        'Repair playbook:',
        JSON.stringify(repairPlaybook, null, 2),
        '',
        'Known maker repair protocol matches:',
        JSON.stringify(repairProtocolMatches || [], null, 2),
        '',
        formatMakerRepairProtocolPromptBlock(repairProtocolMatches),
        '',
        formatMakerRepairEvolutionPromptBlock(repairEvolutionGuidance),
        '',
        'Repair task policy:',
        '- Address every fatal targeted repair task before cosmetic changes.',
        '- A template_runtime_probe task is not optional. Make the named probe method prove real gameplay state progression.',
        '- Do not satisfy probes with fake hardcoded snapshots. The visible game and the probe snapshot must reflect the same live state.',
        '- Keep repairs small and file-local when possible.',
        '- Use matching playbook recipes as proven repair patterns, but adapt them to the current project files instead of rewriting from scratch.',
        '',
        'Sandbox diagnostics:',
        JSON.stringify(sandboxDiagnostics || null, null, 2),
        '',
        'Asset summary:',
        JSON.stringify(summarizeMakerAssets(generatedAssets), null, 2),
        '',
        'Asset quality summary:',
        JSON.stringify(summarizeMakerAssetQuality(generatedAssets?.assetQuality || null), null, 2),
        '',
        'Structured asset tool contract:',
        JSON.stringify(buildStructuredAssetToolRequest(generatedAssets?.assetPlan || {}, assetContract), null, 2),
        '',
        'Original user prompt:',
        prompt,
        '',
        formatMakerDesignBriefPromptBlock(designBrief),
        '',
        'Selected native template contract:',
        JSON.stringify(templateContract || null, null, 2),
        '',
        formatMakerDebugProtocolPromptBlock(debugProtocol),
        '',
        'Template asset contract:',
        JSON.stringify(assetContract || null, null, 2),
        '',
        'Operational spec:',
        JSON.stringify({
            title: qualityIntent.title || null,
            playableExperience: qualityIntent.playableExperience || null,
            mobileControls: qualityIntent.mobileControls || [],
            playerActions: qualityIntent.playerActions || [],
            entityRules: qualityIntent.entityRules || [],
            mustExist: qualityIntent.mustExist || [],
            feelRules: qualityIntent.feelRules || [],
            failureModesToAvoid: qualityIntent.failureModesToAvoid || [],
            technicalRequirements: qualityIntent.technicalRequirements || {},
        }, null, 2),
        '',
        'Current project files:',
        JSON.stringify(projectFiles, null, 2),
    ].join('\n');
}

function parseMakerFileRepairResponse(text) {
    const parsed = parseBuilderJsonText(text);
    return normalizeMakerProtocolResponse(parsed, { requireEdits: true });
}

async function resolveMakerProtocolEdits(projectRoot, inspection) {
    const edits = [];

    for (const file of inspection.files || []) {
        edits.push(file);
    }

    for (const patch of inspection.patches || []) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, patch.path);
        if (isProtectedMakerRuntimeFile(cleanPath)) {
            console.warn(`[Maker Agent] Skipping protected runtime file patch: ${cleanPath}`);
            continue;
        }
        const currentContent = await fs.promises.readFile(absolutePath, 'utf8');
        const patched = applyPatchReplacements(currentContent, patch.replacements, { path: cleanPath });
        edits.push({
            path: cleanPath,
            content: sanitizeMakerMainTsContent(patched.content, cleanPath),
            patchReplacements: patched.applied,
        });
    }

    return edits;
}

async function applyMakerFileEdits(projectRoot, edits, { compileGate = false } = {}) {
    const applied = [];
    const backups = new Map();
    const touchedPaths = [];

    for (const edit of edits) {
        const { cleanPath, absolutePath } = safeMakerProjectPath(projectRoot, edit.path);
        if (isProtectedMakerRuntimeFile(cleanPath)) {
            console.warn(`[Maker Agent] Skipping protected runtime file edit: ${cleanPath}`);
            continue;
        }
        if (!backups.has(absolutePath)) {
            try {
                backups.set(absolutePath, await fs.promises.readFile(absolutePath, 'utf8'));
            } catch {
                backups.set(absolutePath, null);
            }
        }
        const content = sanitizeMakerMainTsContent(edit.content, cleanPath);
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.promises.writeFile(absolutePath, content, 'utf8');
        touchedPaths.push(absolutePath);
        applied.push({
            path: cleanPath,
            bytes: Buffer.byteLength(content, 'utf8'),
            patchReplacements: Array.isArray(edit.patchReplacements) ? edit.patchReplacements.length : 0,
        });
    }

    if (compileGate && touchedPaths.length > 0) {
        try {
            await runMakerProjectTscCheck(projectRoot);
        } catch (error) {
            await restoreMakerFileBackups(backups);
            console.warn(`[Maker Agent] Rejected ${touchedPaths.length} file edit(s) after tsc failure; restored previous sources.`);
            throw error;
        }
    }

    return applied;
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

async function runMakerProjectEvidence({ workspace, projectRoot, generatedAssets, templateContract, assetContract, turnNumber, phase = 'agent', allowedKeys = null, foundationLane = null }) {
    try {
        const packKeys = allowedKeys || [...new Set([
            ...await readProjectAssetPackKeys(projectRoot),
            ...collectAllowedAssetPackKeys({ generatedAssets }),
        ])].sort();
        let preflight = await runMakerPreflightChecks({ projectRoot, generatedAssets, assetContract });
        await writeMakerJson(workspace, 'preflight-report.json', {
            phase,
            turnNumber,
            at: new Date().toISOString(),
            ...preflight,
        });
        const factoryMinimal = isMakerFactoryMinimalMode();
        if (!preflight.success) {
            const preflightRepairs = await applyDeterministicPreflightRepairs(projectRoot, preflight, {
                generatedAssets,
                assetContract,
                allowedKeys: packKeys,
                foundationLane: foundationLane || assetContract?.lane || templateContract?.lane || null,
                foundationRequiredState: templateContract?.foundation?.requiredState || [],
                factoryMinimal,
            });
            if (preflightRepairs.length > 0) {
                console.warn(`[Maker AutoRepair] Applied deterministic preflight fixes: ${preflightRepairs.map((entry) => `${entry.path}:${entry.type}${entry.keys ? `(${entry.keys.join(',')})` : ''}`).join(', ')}`);
                preflight = await runMakerPreflightChecks({ projectRoot, generatedAssets, assetContract });
                await writeMakerJson(workspace, 'preflight-report-after-repair.json', {
                    phase,
                    turnNumber,
                    at: new Date().toISOString(),
                    repairs: preflightRepairs,
                    factoryMinimal,
                    ...preflight,
                });
            }
        }
        if (shouldBlockOnPreflight(preflight, factoryMinimal)) {
            const diagnostics = {
                preflight,
                failedContractChecks: preflight.issues.map((issue) => ({
                    id: issue.id,
                    severity: issue.severity,
                    message: issue.message,
                    repair: issue.repair,
                    missingSlots: issue.missingSlots || [],
                })),
            };
            const evidence = {
                phase,
                success: false,
                crashes: preflight.issues
                    .filter((issue) => issue.severity === 'critical')
                    .map((issue) => `PREFLIGHT ERROR: ${issue.message}`)
                    .slice(0, 8),
                diagnostics,
                targetedRepairTasks: buildTargetedRepairTasks(diagnostics),
            };
            await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, evidence);
            await writeMakerJson(workspace, 'debug-loop-trace.json', {
                phase,
                turnNumber,
                at: new Date().toISOString(),
                lastEvidence: evidence,
            });
            return evidence;
        }
        if (!preflight.success && factoryMinimal) {
            const preview = preflight.issues
                .filter((issue) => issue.severity === 'critical')
                .filter((issue) => !shouldBlockOnPreflight({ issues: [issue] }, true))
                .slice(0, 3)
                .map((issue) => issue.id || issue.message)
                .join(', ');
            console.warn(`[Maker Factory] minimal mode: ${preflight.issues.length} preflight issue(s) non-blocking${preview ? ` (${preview})` : ''}; proceeding to build + sandbox`);
        }
        await rebuildMakerProjectDistWithAutoRepair(projectRoot);
        const assembledHtml = await assembleMakerProjectHtmlWithAutoRepair(projectRoot);
        const probeHtml = postProcessRawHtml(assembledHtml, generatedAssets);
        const sandboxOptions = {
            requireDreamAssets: hasGeneratedVisualAssets(generatedAssets),
            sourceHtml: assembledHtml,
            templateContract,
            assetContract,
        };
        let sandbox = await verifyGame(probeHtml, sandboxOptions);
        const sandboxMissingAssetRole = !sandbox.success && (sandbox.diagnostics?.failedContractChecks || []).some(
            (check) => check.id === 'asset_required_roles_unused'
                && (check.missingRoles || []).some((role) => role === 'item' || role === 'obstacle' || role === 'prop'),
        );
        if (sandboxMissingAssetRole) {
            const itemWiringRepairs = await applyMainTsAssetWiringRepairs(projectRoot, {
                allowedKeys: packKeys,
                assetContract,
                generatedAssets,
            });
            const assetRoleRepairs = (itemWiringRepairs[0]?.repairs || []);
            if (assetRoleRepairs.includes('injected_collectible_item_rendering')
                || assetRoleRepairs.includes('injected_prop_rendering')
                || assetRoleRepairs.includes('injected_obstacle_rendering')
                || assetRoleRepairs.includes('injected_obstacle_prop_rendering')) {
                console.warn('[Maker AutoRepair] Injected role rendering after sandbox miss; re-verifying...');
                await rebuildMakerProjectDistWithAutoRepair(projectRoot);
                const retryHtml = await assembleMakerProjectHtmlWithAutoRepair(projectRoot);
                const retryProbe = postProcessRawHtml(retryHtml, generatedAssets);
                sandbox = await verifyGame(retryProbe, {
                    ...sandboxOptions,
                    sourceHtml: retryHtml,
                });
            }
        }
        const evidence = {
            phase,
            success: Boolean(sandbox.success),
            crashes: Array.isArray(sandbox.crashes) ? sandbox.crashes.slice(0, 8) : [],
            diagnostics: {
                ...(sandbox.diagnostics || {}),
                failedContractChecks: Array.isArray(sandbox.diagnostics?.failedContractChecks)
                    ? sandbox.diagnostics.failedContractChecks.slice(0, 10)
                    : [],
                templateRuntimeProbe: sandbox.diagnostics?.templateRuntimeProbe || null,
                assetContractInspection: sandbox.diagnostics?.assetContractInspection || null,
                horizontalOverflow: sandbox.diagnostics?.horizontalOverflow || 0,
                canvasIssues: sandbox.diagnostics?.canvasIssues || [],
                visibleOutOfBoundsElements: sandbox.diagnostics?.visibleOutOfBoundsElements || [],
                preflight,
                factoryMinimal,
            },
            targetedRepairTasks: sandbox.success ? [] : buildTargetedRepairTasks(sandbox.diagnostics || null),
        };
        await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, evidence);
        await writeMakerJson(workspace, 'debug-loop-trace.json', {
            phase,
            turnNumber,
            at: new Date().toISOString(),
            lastEvidence: evidence,
        });
        return evidence;
    } catch (error) {
        const isBuildError = error.code === 'TSC_FAILED' || error.code === 'VITE_BUILD_FAILED';
        const crashes = isBuildError && Array.isArray(error.buildErrors) && error.buildErrors.length > 0
            ? error.buildErrors.map(e => `BUILD ERROR: ${e}`)
            : [error.message || String(error)];

        const evidence = {
            phase,
            success: false,
            crashes,
            diagnostics: isBuildError ? {
                buildFailure: {
                    type: error.code,
                    errors: error.buildErrors || [],
                    rawOutput: error.rawOutput || null,
                },
                failedContractChecks: [{
                    id: 'build_compilation_failed',
                    message: `The project does not compile. Fix all TypeScript/build errors before the sandbox can test it.`,
                }],
            } : null,
            targetedRepairTasks: isBuildError
                ? (error.buildErrors || []).slice(0, 8).map(e => ({
                    task: 'fix_build_error',
                    description: e,
                    severity: 'critical',
                }))
                : [],
        };
        await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, evidence);
        await writeMakerJson(workspace, 'debug-loop-trace.json', {
            phase,
            turnNumber,
            at: new Date().toISOString(),
            lastEvidence: evidence,
        });
        return evidence;
    }
}

// Detect a "hollow" game: it builds and renders (so it passes the render/asset gate) but the builder
// left the core loop unimplemented — the stub's "implement the loop here" TODO survived, or main.ts
// barely grew past the empty stub. Such a game is a screensaver, not a playable game. Returns a short
// reason string when hollow, else null.
async function detectHollowMakerGame(projectRoot, stubMainLen = 0) {
    try {
        const main = await fs.promises.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8');
        if (/TODO:?\s*Phase 2 agent implements/i.test(main)) return 'core_loop_todo_present';
        if (stubMainLen > 0 && main.length < Math.round(stubMainLen * 1.4)) {
            return `near_stub_size(${main.length}<${Math.round(stubMainLen * 1.4)})`;
        }
        return null;
    } catch {
        return null; // unreadable -> don't block
    }
}

async function runMakerAgentInspectionTurns({
    workspace,
    projectRoot,
    turns,
    jobId,
    prompt,
    qualityIntent,
    generatedAssets,
    templateContract,
    assetContract,
    debugProtocol,
    designBrief,
    builderMaps = null,
    assetQuality = null,
    maxTurns = getMakerAgentInspectionTurns((assetContract?.slots || []).length),
    reportProgress = null,
}) {
    const objectives = [
        'Implement turn 1: wire core loop (input, timers, cooking flow, asset rendering) incrementally in src/main.ts. Draw generated background full-bleed on frame 1.',
        'Implement turn 2: finish remaining gameplay systems, probe methods, visual polish, and cohesive UI styling. Keep resolveBackgroundImage() drawing artist background art.',
        'Repair pass only: fix targetedRepairTasks and failed checks from latest evidence with apply_patch/write_file. Stop reading after one src/main.ts pass.',
    ];
    const implementTurns = resolveMakerAgentImplementTurns(maxTurns);
    console.log(`🛠️ [Phase 2 job=${jobId}] Agent loop policy: turns 1-${implementTurns}=implement, turns ${implementTurns + 1}-${maxTurns}=repair if needed (maxTurns=${maxTurns}, factoryMinimal=${isMakerFactoryMinimalMode() ? 'on' : 'off'}, skipTurn1PreRun=${SKIP_TURN1_PRERUN_EVIDENCE})`);
    const {
        allowedKeys: phase2AllowedAssetKeys,
        slotHints: phase2AssetSlotHints,
    } = await preparePhase2ProjectAssets({
        projectRoot,
        generatedAssets,
        assetContract,
        jobId,
    });
    // Capture the empty stub size before any agent edits, so we can tell a real implementation from
    // a barely-touched stub at the acceptance gate below.
    let stubMainLen = 0;
    try {
        stubMainLen = (await fs.promises.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8')).length;
    } catch { /* stub unreadable; size-based hollow check disabled */ }
    let hollowForceRetries = 0;
    let lastRunEvidence = null;
    for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber += 1) {
        assertJobNotCancelled(jobId);
        let preRunEvidence = null;
        if (!(turnNumber === 1 && SKIP_TURN1_PRERUN_EVIDENCE)) {
            preRunEvidence = await runMakerProjectEvidence({
                workspace,
                projectRoot,
                generatedAssets,
                templateContract,
                assetContract,
                turnNumber: `${turnNumber}-pre`,
                phase: 'before_file_agent_turn',
                allowedKeys: phase2AllowedAssetKeys,
                foundationLane: assetContract?.lane || templateContract?.lane || null,
            });
            lastRunEvidence = preRunEvidence;
        } else {
            console.log(`🛠️ [Phase 2 job=${jobId}] Skipping turn ${turnNumber} pre-run sandbox (stub expected incomplete until agent edits)`);
        }
        const projectFiles = await readMakerProjectFiles(projectRoot);
        const objective = objectives[Math.min(turnNumber - 1, objectives.length - 1)] || objectives[objectives.length - 1];
        const makerAgentUsesTools = useMakerAgentTools();
        const turnMode = resolveMakerAgentTurnMode(turnNumber, { maxTurns });
        const allowedAssetKeys = [...new Set([
            ...await readProjectAssetPackKeys(projectRoot),
            ...collectAllowedAssetPackKeys({ generatedAssets }),
        ])].sort();
        const assetSlotHints = buildAssetSlotRuntimeHints({ assetContract, generatedAssets });
        const isImplementTurn = turnMode === MAKER_AGENT_TURN_MODE_IMPLEMENT;
        const promptText = isImplementTurn
            ? buildMakerAgentImplementPrompt({
                prompt,
                qualityIntent,
                projectFiles,
                templateContract,
                designBrief,
                objective,
                allowedAssetKeys,
                assetSlotHints,
            })
            : buildMakerAgentInspectionPrompt({
                prompt,
                qualityIntent,
                projectFiles,
                templateContract,
                assetContract,
                debugProtocol,
                designBrief,
                generatedAssetsSummary: summarizeMakerAssets(generatedAssets),
                assetQualitySummary: summarizeMakerAssetQuality(assetQuality || generatedAssets?.assetQuality || null),
                builderMaps,
                loopHistory: summarizeMakerAgentTurns(turns),
                lastRunEvidence,
                turnNumber,
                objective,
                transport: makerAgentUsesTools ? 'tools' : 'json',
                mode: turnMode,
                allowedAssetKeys,
                assetSlotHints,
            });
        await writeMakerText(workspace, `logs/agent-inspection-prompt-${turnNumber}.txt`, promptText);
        if (isImplementTurn) {
            console.log(`🛠️ [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] implement prompt_chars=${promptText.length} timeout=${Math.round(MAKER_IMPLEMENT_TIMEOUT_MS / 1000)}s max_tokens=${MAKER_IMPLEMENT_MAX_TOKENS} models=${MAKER_IMPLEMENT_FALLBACK_MODELS.join('>')}`);
        } else {
            console.log(`🛠️ [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] repair prompt_chars=${promptText.length} timeout=${Math.round(BUILDER_REQUEST_TIMEOUT_MS / 1000)}s max_tokens=${MAKER_TOOL_MAX_TOKENS}`);
        }
        try {
            let inspection;
            let applied = [];
            let runEvidence;

            if (makerAgentUsesTools) {
                const implementToolBudgetHint = isImplementTurn && allowedAssetKeys.length > 40
                    ? ` toolBudget=scaled(${allowedAssetKeys.length} keys)`
                    : '';
                console.log(`🛠️ [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] mode=${turnMode} assetKeys=${allowedAssetKeys.length}${implementToolBudgetHint}`);
                let stickyImplementModel = null;
                const toolTurn = await runMakerAgentToolTurn({
                    userPrompt: promptText,
                    projectRoot,
                    mode: turnMode,
                    assetKeyCount: allowedAssetKeys.length,
                    requestCompletion: (messages) => requestMakerToolCompletion(messages, {
                        label: `Phase 2 File Agent Turn ${turnNumber}`,
                        jobId,
                        timeoutMs: isImplementTurn ? MAKER_IMPLEMENT_TIMEOUT_MS : BUILDER_REQUEST_TIMEOUT_MS,
                        maxAttempts: 2,
                        maxTokens: isImplementTurn ? MAKER_IMPLEMENT_MAX_TOKENS : MAKER_TOOL_MAX_TOKENS,
                        preferredModel: stickyImplementModel,
                        fallbackModels: isImplementTurn ? MAKER_IMPLEMENT_FALLBACK_MODELS : null,
                        reasoningEffort: isImplementTurn ? MAKER_IMPLEMENT_REASONING_EFFORT : null,
                        mode: turnMode,
                        onResolvedModel: (model) => {
                            if (!stickyImplementModel) {
                                console.log(`📌 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Sticky implement model: ${model}`);
                            }
                            stickyImplementModel = model;
                        },
                    }),
                    onEditApplied: async (edit, meta) => {
                        const tscNote = edit.tool === 'apply_patch' || edit.tool === 'write_file' ? ' (tsc checked)' : '';
                        console.log(`✏️ [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] ${edit.tool} ${edit.path} bytes=${edit.bytes} round=${meta.round} call=${meta.toolCall}${tscNote}`);
                        if (jobId && typeof reportProgress === 'function') {
                            await reportProgress(
                                Math.min(72, 56 + meta.toolCall),
                                'build',
                                `Live edit: ${edit.tool} ${edit.path}${tscNote}`,
                            );
                        }
                    },
                    helpers: {
                        safeMakerProjectPath,
                        isProtectedMakerRuntimeFile,
                        sanitizeMakerMainTsContent,
                        runTscCheck: (root) => runMakerProjectTscCheck(root, { timeoutMs: 45_000 }),
                    },
                });
                await writeMakerJson(workspace, `logs/agent-tool-turn-${turnNumber}.json`, toolTurn.log);
                inspection = {
                    patches: [],
                    files: [],
                    noEditsNeeded: toolTurn.noEditsNeeded,
                    notes: toolTurn.notes,
                };
                applied = toolTurn.editsApplied;
                if (turnMode === MAKER_AGENT_TURN_MODE_REPAIR && applied.length === 0) {
                    const rescueDedupe = await dedupeMakerMainTsState(projectRoot);
                    if (rescueDedupe.length > 0) {
                        console.warn(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Repair rescue: deduped duplicate state keys (${rescueDedupe[0].removed.join(', ')})`);
                        applied.push({ path: 'src/main.ts', tool: 'auto_repair', bytes: 0 });
                    }
                    const mainBefore = await fs.promises.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8').catch(() => '');
                    const dtHookStripped = stripGtWiringDtUpdateHooks(mainBefore);
                    if (dtHookStripped !== mainBefore) {
                        await fs.promises.writeFile(path.join(projectRoot, 'src', 'main.ts'), dtHookStripped, 'utf8');
                        console.warn(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Repair rescue: stripped __gtUpdate* dt hooks (TS2448)`);
                        applied.push({ path: 'src/main.ts', tool: 'auto_repair', bytes: 0 });
                    }
                }
                if (applied.length > 0) {
                    const keyNormalize = await normalizeMainTsAssetKeys(projectRoot, allowedAssetKeys);
                    if (keyNormalize.changed) {
                        console.log(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Normalized asset key casing in src/main.ts`);
                    }
                    const wiringRepairs = await applyMainTsAssetWiringRepairs(projectRoot, {
                        allowedKeys: allowedAssetKeys,
                        assetContract,
                        generatedAssets,
                    });
                    if (wiringRepairs.length > 0) {
                        console.log(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Auto-repaired asset wiring in src/main.ts (${wiringRepairs[0]?.repairs?.join(', ') || 'ok'})`);
                    }
                    const dedupeRepair = applyDeterministicStateObjectDedupeRepairs(
                        await fs.promises.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8').catch(() => ''),
                    );
                    if (dedupeRepair.removed.length > 0) {
                        await fs.promises.writeFile(path.join(projectRoot, 'src', 'main.ts'), dedupeRepair.content, 'utf8');
                        console.log(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Deduped duplicate state keys: ${dedupeRepair.removed.join(', ')}`);
                    }
                    try {
                        await runMakerProjectTscCheck(projectRoot);
                    } catch (compileError) {
                        let compileErrorResolved = false;
                        const buildRepairs = await applyDeterministicMakerBuildRepairs(projectRoot, compileError.buildErrors || []);
                        if (buildRepairs.length > 0) {
                            console.warn(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Auto-fixed compile errors: ${buildRepairs.map((entry) => entry.type).join(', ')}`);
                            try {
                                await runMakerProjectTscCheck(projectRoot);
                                compileErrorResolved = true;
                            } catch (retryError) {
                                compileError = retryError;
                            }
                        }
                        if (!compileErrorResolved) {
                            runEvidence = buildMakerCompileFailureEvidence(compileError, {
                                phase: 'after_file_agent_turn',
                                turnNumber,
                            });
                            await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, runEvidence);
                            lastRunEvidence = runEvidence;
                            await appendMakerAgentTurn(workspace, turns, {
                                phase: 'file_inspection',
                                objective,
                                status: 'needs_followup',
                                model: DREAM_MODELS.premiumBuilder,
                                filesRead: summarizeMakerProjectFiles(projectFiles),
                                editsApplied: applied,
                                targetedRepairTasks: runEvidence.targetedRepairTasks || [],
                                sandbox: runEvidence,
                                notes: inspection.notes,
                                error: compileError.message,
                            });
                            continue;
                        }
                    }
                }
                if (jobId && typeof reportProgress === 'function') {
                    await reportProgress(
                        Math.min(73, 68 + turnNumber),
                        'verify',
                        `Running sandbox + build checks (agent turn ${turnNumber})...`,
                    );
                }
                runEvidence = await runMakerProjectEvidence({
                    workspace,
                    projectRoot,
                    generatedAssets,
                    templateContract,
                    assetContract,
                    turnNumber,
                    phase: 'after_file_agent_turn',
                    allowedKeys: allowedAssetKeys,
                    foundationLane: assetContract?.lane || templateContract?.lane || null,
                });
            } else {
                const responseText = await generateCompleteJsonWithBuilder(promptText, {
                    label: `Phase 2 File Agent Turn ${turnNumber}`,
                    jobId,
                    timeoutMs: BUILDER_REQUEST_TIMEOUT_MS,
                    maxAttempts: 2,
                });
                await writeMakerText(workspace, `logs/agent-inspection-response-${turnNumber}.txt`, responseText);
                try {
                    inspection = parseMakerAgentInspectionResponse(responseText);
                } catch (decodeError) {
                    console.warn(`[Maker Agent] Turn ${turnNumber} file payload decode failed: ${decodeError.message}`);
                    const decodeEvidence = buildMakerDecodeFailureEvidence(decodeError, {
                        phase: 'after_file_agent_turn',
                        turnNumber,
                    });
                    lastRunEvidence = decodeEvidence;
                    await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, decodeEvidence);
                    await appendMakerAgentTurn(workspace, turns, {
                        phase: 'file_inspection',
                        objective,
                        status: 'needs_followup',
                        model: DREAM_MODELS.premiumBuilder,
                        filesRead: summarizeMakerProjectFiles(projectFiles),
                        editsApplied: [],
                        targetedRepairTasks: decodeEvidence.targetedRepairTasks || [],
                        sandbox: decodeEvidence,
                        notes: [],
                        error: decodeError.message,
                    });
                    continue;
                }
                const hasProtocolEdits = (inspection.patches?.length > 0) || (inspection.files?.length > 0);
                if (hasProtocolEdits) {
                    try {
                        const pendingEdits = await resolveMakerProtocolEdits(projectRoot, inspection);
                        if (pendingEdits.length === 0) {
                            runEvidence = await runMakerProjectEvidence({
                                workspace,
                                projectRoot,
                                generatedAssets,
                                templateContract,
                                assetContract,
                                turnNumber,
                                phase: 'after_file_agent_turn',
                            });
                        } else {
                            applied = await applyMakerFileEdits(projectRoot, pendingEdits, { compileGate: true });
                            runEvidence = await runMakerProjectEvidence({
                                workspace,
                                projectRoot,
                                generatedAssets,
                                templateContract,
                                assetContract,
                                turnNumber,
                                phase: 'after_file_agent_turn',
                            });
                        }
                    } catch (applyError) {
                        if (applyError.code === 'TSC_FAILED') {
                            runEvidence = buildMakerCompileFailureEvidence(applyError, {
                                phase: 'after_file_agent_turn',
                                turnNumber,
                            });
                            await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, runEvidence);
                        } else if (/Patch for /.test(applyError.message || '')) {
                            console.warn(`[Maker Agent] Turn ${turnNumber} patch apply failed: ${applyError.message}`);
                            runEvidence = buildMakerPatchFailureEvidence(applyError, {
                                phase: 'after_file_agent_turn',
                                turnNumber,
                            });
                            await writeMakerJson(workspace, `agent-run-evidence-${turnNumber}.json`, runEvidence);
                        } else {
                            throw applyError;
                        }
                    }
                } else {
                    runEvidence = await runMakerProjectEvidence({
                        workspace,
                        projectRoot,
                        generatedAssets,
                        templateContract,
                        assetContract,
                        turnNumber,
                        phase: 'after_file_agent_turn',
                    });
                }
            }
            const stalledOnAssetRole = runEvidence?.success === false
                && applied.length === 0
                && (runEvidence?.diagnostics?.failedContractChecks || []).some(
                    (check) => check.id === 'asset_required_roles_unused'
                        && (check.missingRoles || []).some((role) => role === 'item' || role === 'obstacle' || role === 'prop'),
                );
            if (stalledOnAssetRole) {
                const rescueRepairs = await applyMainTsAssetWiringRepairs(projectRoot, {
                    allowedKeys: allowedAssetKeys,
                    assetContract,
                    generatedAssets,
                });
                const rescueRepairIds = rescueRepairs[0]?.repairs || [];
                if (rescueRepairIds.includes('injected_collectible_item_rendering')
                    || rescueRepairIds.includes('injected_prop_rendering')
                    || rescueRepairIds.includes('injected_obstacle_rendering')
                    || rescueRepairIds.includes('injected_obstacle_prop_rendering')) {
                    console.warn(`🔧 [Phase 2 File Agent Turn ${turnNumber} job=${jobId}] Agent stalled on asset role — applied deterministic wiring`);
                    runEvidence = await runMakerProjectEvidence({
                        workspace,
                        projectRoot,
                        generatedAssets,
                        templateContract,
                        assetContract,
                        turnNumber,
                        phase: 'after_item_role_rescue',
                        allowedKeys: allowedAssetKeys,
                        foundationLane: templateContract?.lane || assetContract?.lane || null,
                    });
                }
            }
            lastRunEvidence = runEvidence;
            await appendMakerAgentTurn(workspace, turns, {
                phase: 'file_inspection',
                objective,
                status: runEvidence?.success === false ? 'needs_followup' : 'complete',
                model: DREAM_MODELS.premiumBuilder,
                filesRead: summarizeMakerProjectFiles(projectFiles),
                editsApplied: applied,
                targetedRepairTasks: runEvidence?.targetedRepairTasks || [],
                sandbox: runEvidence,
                notes: inspection.notes,
            });
            if (runEvidence?.success) {
                const hollowReason = await detectHollowMakerGame(projectRoot, stubMainLen);
                if (hollowReason && turnNumber < maxTurns && hollowForceRetries < 1) {
                    // It renders, but there is no game. Don't accept — force another turn with explicit
                    // feedback so the builder implements the actual interactive loop.
                    hollowForceRetries += 1;
                    const hollowTask = {
                        id: 'gameplay_loop_unimplemented',
                        directRepairTask: `The game builds and renders but implements NO gameplay — it is still essentially the empty stub (${hollowReason}). Implement the FULL interactive loop the foundation describes in src/main.ts (stepGame + input handlers): the toolbar/tray the player drags FROM, the drag-and-drop placement, every tap/feed/select handler, and any meter the loop needs. Start the board/tank EMPTY (the player fills it). A background plus a few static sprites is NOT a game.`,
                    };
                    runEvidence.success = false;
                    runEvidence.targetedRepairTasks = [hollowTask, ...(runEvidence.targetedRepairTasks || [])];
                    lastRunEvidence = runEvidence;
                    console.warn(`🫥 [Phase 2 job=${jobId}] Turn ${turnNumber} renders but is HOLLOW (${hollowReason}) — forcing another turn to implement the loop`);
                } else {
                    if (hollowReason) {
                        console.warn(`⚠️ [Phase 2 job=${jobId}] Shipping a thin game (${hollowReason}) — no turns left to deepen it`);
                    }
                    console.log(`✅ [Phase 2 job=${jobId}] Sandbox/build passed after turn ${turnNumber} — skipping remaining agent turns`);
                    break;
                }
            }
            if (isImplementTurn && turnNumber < maxTurns && turnNumber <= implementTurns) {
                const failurePreview = (runEvidence?.targetedRepairTasks || [])
                    .slice(0, 3)
                    .map((task) => task.directRepairTask || task.description || task.id || task.task)
                    .filter(Boolean)
                    .join(' | ')
                    || (runEvidence?.crashes || []).slice(0, 2).join(' | ')
                    || 'sandbox/build checks still failing';
                console.log(`🔧 [Phase 2 job=${jobId}] Implement turn ${turnNumber} incomplete — continuing with turn ${turnNumber + 1}. Focus: ${failurePreview}`);
            } else if (turnNumber === implementTurns && maxTurns > implementTurns) {
                const failurePreview = (runEvidence?.targetedRepairTasks || [])
                    .slice(0, 3)
                    .map((task) => task.directRepairTask || task.description || task.id || task.task)
                    .filter(Boolean)
                    .join(' | ')
                    || (runEvidence?.crashes || []).slice(0, 2).join(' | ')
                    || 'sandbox/build checks still failing';
                console.log(`🔧 [Phase 2 job=${jobId}] Implement turns exhausted — running repair turn ${turnNumber + 1}/${maxTurns}. Focus: ${failurePreview}`);
            }
            if ((inspection.noEditsNeeded || applied.length === 0) && turnNumber >= maxTurns) {
                break;
            }
        } catch (error) {
            console.error(`[Maker Agent] Inspection turn ${turnNumber} failed: ${error.message}`);
            await appendMakerAgentTurn(workspace, turns, {
                phase: 'file_inspection',
                objective,
                status: 'failed',
                model: DREAM_MODELS.premiumBuilder,
                filesRead: summarizeMakerProjectFiles(projectFiles),
                error: error.message,
            });
            if (error.partialText) {
                await writeMakerText(workspace, `logs/agent-inspection-response-${turnNumber}-invalid.txt`, error.partialText);
            }
            throw new Error(`Phase 2 file agent turn ${turnNumber} failed: ${error.message}`);
        }
    }

    if (lastRunEvidence?.success !== true) {
        const preThrowErrors = [
            ...(lastRunEvidence?.diagnostics?.buildFailure?.errors || []),
            ...(lastRunEvidence?.crashes || []),
        ].map((entry) => String(entry || ''));
        const needsStateDedupe = preThrowErrors.some((entry) => /TS1117/.test(entry))
            || preThrowErrors.some((entry) => /duplicate state|multiple properties with the same name/i.test(entry));
        const needsGtDtStrip = preThrowErrors.some((entry) => /TS2448:.*\b'dt'\b/.test(entry));
        if (needsGtDtStrip) {
            const mainPath = path.join(projectRoot, 'src', 'main.ts');
            const before = await fs.promises.readFile(mainPath, 'utf8').catch(() => null);
            if (before != null) {
                const stripped = stripGtWiringDtUpdateHooks(before);
                if (stripped !== before) {
                    await fs.promises.writeFile(mainPath, stripped, 'utf8');
                    console.warn(`🔧 [Phase 2 job=${jobId}] Final rescue: stripped __gtUpdate* dt hooks (TS2448)`);
                    try {
                        lastRunEvidence = await runMakerProjectEvidence({
                            workspace,
                            projectRoot,
                            generatedAssets,
                            templateContract,
                            assetContract,
                            turnNumber: `${maxTurns}-final-dt-rescue`,
                            phase: 'after_final_dt_hook_strip',
                            allowedKeys: phase2AllowedAssetKeys,
                            foundationLane: templateContract?.lane || assetContract?.lane || null,
                        });
                    } catch (rescueError) {
                        console.warn(`🔧 [Phase 2 job=${jobId}] Final dt-hook rescue failed: ${rescueError.message}`);
                    }
                }
            }
        }
        const dedupeRepairs = await dedupeMakerMainTsState(projectRoot);
        if (needsStateDedupe || dedupeRepairs.length > 0) {
            if (dedupeRepairs.length > 0) {
                console.warn(`🔧 [Phase 2 job=${jobId}] Final rescue: deduped duplicate state keys (${dedupeRepairs[0].removed.join(', ')})`);
                try {
                    lastRunEvidence = await runMakerProjectEvidence({
                        workspace,
                        projectRoot,
                        generatedAssets,
                        templateContract,
                        assetContract,
                        turnNumber: `${maxTurns}-final-rescue`,
                        phase: 'after_final_state_dedupe',
                        allowedKeys: phase2AllowedAssetKeys,
                        foundationLane: templateContract?.lane || assetContract?.lane || null,
                    });
                } catch (rescueError) {
                    console.warn(`🔧 [Phase 2 job=${jobId}] Final state dedupe rescue failed: ${rescueError.message}`);
                }
            } else if (needsStateDedupe) {
                console.warn(`🔧 [Phase 2 job=${jobId}] Final rescue: TS1117 reported but no duplicate state keys found to remove`);
            }
        }
        if (lastRunEvidence?.success !== true) {
            const crashSummary = (lastRunEvidence?.crashes || []).slice(0, 2).join(' | ')
                || (lastRunEvidence?.diagnostics?.buildFailure?.errors || []).slice(0, 2).join(' | ')
                || 'build or sandbox checks still failing';
            throw new Error(`Phase 2 file agent finished without a passing project after ${maxTurns} turn(s) (implement + ${Math.max(0, maxTurns - 1)} repair): ${crashSummary}`);
        }
    }
    return lastRunEvidence;
}

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
        buildError.buildErrors = rawOutput.split('\n').filter(l => /error/i.test(l)).slice(0, 10);
        buildError.rawOutput = rawOutput.slice(0, 4000);
        console.error(`[Vite Build] Vite build failed`);
        throw buildError;
    }

    console.log(`[Vite Build] ✅ Build succeeded`);
}

async function replaceAsync(input, regex, replacer) {
    const replacements = [];
    input.replace(regex, (...args) => {
        replacements.push(Promise.resolve(replacer(...args)));
        return '';
    });
    const resolved = await Promise.all(replacements);
    let index = 0;
    return input.replace(regex, () => resolved[index++]);
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
async function persistEditableMakerSource(jobId, makerProject, qualityIntent = {}) {
    try {
        if (!jobId || !makerProject?.projectRoot) return;
        const root = makerProject.projectRoot;
        const wanted = ['src/main.ts', 'index.html', 'src/styles.css', 'src/assetKeys.ts'];
        const files = [];
        for (const rel of wanted) {
            try {
                const content = await fs.promises.readFile(path.join(root, rel), 'utf8');
                files.push({ path: rel, content });
            } catch { /* file may not exist for this game; skip */ }
        }
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
            architecture: 'canvas-kernel',
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

async function executeDreamJob(jobId, prompt, mediaAttachments = [], jobPayload = {}) {
    const persistToDb = jobPayload?.persistToDb !== false;
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
    let makerProject = null;
    const makerRepairs = [];
    let makerBenchmark = jobPayload?.benchmark || null;
    let makerTemplateContract = null;
    let makerAssetContract = null;
    let makerDebugProtocol = null;
    let generatedAssets = null;
    let finalSandboxResult = null;
    let buildMode = null;
    let phase2Evidence = null;
    let makerDesignBriefSummary = null;
    let makerGddCompliance = null;
    let makerAcceptanceResult = null;
    let makerBuilderMaps = null;
    let makerFoundationContract = null;
    const makerAgentTurns = [];
    try {
        assertJobNotCancelled(jobId);

        console.log(`🧠 [DREAM JOB] Started DreamStream structured pipeline for job: ${jobId} using ${DREAM_MODELS.premiumBuilder}`);
        const streamStall = getStreamStallConfig();
        const deepseekConfig = getDeepSeekTextConfig();
        const deepseekPrimary = isDeepSeekPrimaryEnabled();
        const nvidiaFailoverFromDeepseek = isNvidiaFailoverFromDeepSeekEnabled();
        const moonshotConfig = getMoonshotTextConfig();
        const moonshotPrimary = !deepseekPrimary && isMoonshotPrimaryEnabled();
        console.log(`🔑 [DREAM JOB] Text keys=${getNvidiaTextKeys().length} deepseekMaxOutput=${DEEPSEEK_MAX_OUTPUT_TOKENS} phase1Timeout=${Math.round(PHASE1_TIMEOUT_MS / 1000)}s phase1MaxTokens=${PHASE1_MAX_OUTPUT_TOKENS} phase1_5MaxTokens=${PHASE1_5_MAX_OUTPUT_TOKENS} phase2ImplementMaxTokens=${MAKER_IMPLEMENT_MAX_TOKENS} phase2RepairMaxTokens=${MAKER_TOOL_MAX_TOKENS} attemptsPerModel=${PHASE1_ATTEMPTS_PER_MODEL} builderModels=${BUILDER_FALLBACK_MODELS.join('>')} streamFirstByte=${Math.round(streamStall.firstByteMs / 1000)}s streamStall=${Math.round(streamStall.stallMs / 1000)}s deepseekPrimary=${deepseekPrimary && deepseekConfig ? `on(${deepseekConfig.model})` : 'off'} nvidiaFailover=${nvidiaFailoverFromDeepseek ? 'on' : 'off'} moonshotPrimary=${moonshotPrimary && moonshotConfig ? `on(${moonshotConfig.model})` : 'off'} moonshotFailover=${!deepseekPrimary && !moonshotPrimary && moonshotConfig ? `on(${moonshotConfig.model})` : 'off'} heuristicFallback=${ALLOW_PHASE1_HEURISTIC_FALLBACK ? 'on' : 'off'} dynamicFoundation=${useDynamicFoundation() ? 'on' : 'off'} factoryMinimal=${isMakerFactoryMinimalMode() ? 'on' : 'off'} makerAgentTools=${useMakerAgentTools() ? 'on' : 'off'} makerImplementMode=${useMakerAgentImplementMode() ? 'on' : 'off'} makerStreaming=${useMakerAgentStreaming() ? 'on' : 'off'} implementTimeout=${Math.round(MAKER_IMPLEMENT_TIMEOUT_MS / 1000)}s implementModels=${MAKER_IMPLEMENT_FALLBACK_MODELS.join('>')} phase2Turns=${getMakerAgentInspectionTurns()}(implement=${resolveMakerAgentImplementTurns(getMakerAgentInspectionTurns())}+repair)`);
        const maker = await createGameTokMakerWorkspace(jobId, prompt, mediaAttachments);
        makerWorkspace = maker.workspace;
        console.log(`📁 [MAKER WORKSPACE] ${makerWorkspace}`);
        await writeMakerText(makerWorkspace, 'maker-system-manual.md', formatMakerSystemManual('full'));
        await writeMakerJson(makerWorkspace, 'maker-system-manual.json', getMakerSystemManualSummary());
        await reportProgress(5, 'maker_workspace', 'Opening GameTok maker workspace...');

        const dynamicFoundation = useDynamicFoundation();

        // ── PHASE 1: MINIMAL INTENT EXTRACTION ──
        await reportProgress(8, 'spec', 'Reading your idea...');
        const phase1ModelLabel = PHASE1_MODEL ? PHASE1_MODEL : getDreamTextModelLabel();
        console.log(`📋 Phase 1/3: ${phase1ModelLabel} extracting game intent...`);
        const phase1 = buildPhase1_Quantize(prompt, { dynamicFoundation });
        let qualityIntent;
        try {
            qualityIntent = await callAI(phase1.system, phase1.user, PHASE1_MAX_OUTPUT_TOKENS, 0.35, { overrideModel: PHASE1_MODEL });
        } catch (phase1Error) {
            if (!ALLOW_PHASE1_HEURISTIC_FALLBACK) {
                throw new Error(`Phase 1 spec extraction failed after exhausting text keys/models: ${phase1Error?.message || phase1Error}`);
            }
            console.warn(`⚠️ Phase 1 JSON extraction failed; using deterministic OpenGame-style fallback spec: ${phase1Error?.message || phase1Error}`);
            qualityIntent = buildHeuristicQualityIntent(prompt, {
                reason: phase1Error?.message || 'phase1_json_failed',
            });
            await writeMakerJson(makerWorkspace, 'phase1-fallback.json', {
                used: true,
                reason: phase1Error?.message || String(phase1Error || 'unknown error'),
                generatedAt: new Date().toISOString(),
                qualityIntent,
            });
        }
        assertJobNotCancelled(jobId);

        if (dynamicFoundation) {
            await reportProgress(14, 'foundation', 'Designing game foundation...');
            console.log(`🏗️ Phase 1.5/3: ${FOUNDATION_MODEL || getDreamTextModelLabel()} architecting dynamic foundation...`);
            const foundationPrompt = buildFoundationAgentPrompt(qualityIntent, prompt);
            await writeMakerText(makerWorkspace, 'logs/foundation-agent-prompt.txt', `${foundationPrompt.system}\n\n---\n\n${foundationPrompt.user}`);
            let rawFoundation;
            try {
                rawFoundation = await callAI(foundationPrompt.system, foundationPrompt.user, PHASE1_5_MAX_OUTPUT_TOKENS, 0.25, { overrideModel: FOUNDATION_MODEL });
            } catch (foundationError) {
                if (!ALLOW_PHASE1_HEURISTIC_FALLBACK) {
                    throw new Error(`Phase 1.5 foundation architect failed after exhausting text keys/models: ${foundationError?.message || foundationError}`);
                }
                // Mirror the Phase 1 heuristic fallback: rather than killing the job at 14%, seed a
                // deterministic foundation from the intent spec. normalizeFoundationContract() fills
                // every required field (renderAll, default player+background slots), so the seed only
                // needs to carry intent-derived flavor.
                console.warn(`⚠️ Phase 1.5 foundation architect failed; using deterministic foundation seed from Phase 1 intent: ${foundationError?.message || foundationError}`);
                rawFoundation = buildFallbackFoundationSeed(qualityIntent);
                await writeMakerJson(makerWorkspace, 'foundation-fallback.json', {
                    used: true,
                    reason: foundationError?.message || String(foundationError || 'unknown error'),
                    generatedAt: new Date().toISOString(),
                    seed: rawFoundation,
                });
            }
            makerFoundationContract = normalizeFoundationContract(rawFoundation, qualityIntent);
            assertFoundationSupported(makerFoundationContract);
            await writeMakerJson(makerWorkspace, 'foundation-contract.json', makerFoundationContract);
            makerTemplateContract = buildMakerTemplateContractFromFoundation(makerFoundationContract, qualityIntent);
            makerAssetContract = buildMakerAssetContractFromFoundation(makerFoundationContract, qualityIntent);
            console.log(`✅ Phase 1.5: "${makerFoundationContract.title}" foundation=${makerFoundationContract.foundationId} lane=${makerFoundationContract.lane} probes=${makerFoundationContract.probeMethods.length}`);
            if (process.env.GAMETOK_SKIP_STUB_PREFLIGHT !== 'true') {
                console.log('🧪 Foundation stub preflight: validating generated main.ts stub (static + tsc) before artist...');
                await runFoundationStubPreflight(makerFoundationContract, qualityIntent);
                console.log('✅ Foundation stub preflight passed');
            }
        } else {
            makerTemplateContract = selectMakerTemplateContract(qualityIntent, prompt);
            makerAssetContract = buildMakerAssetContract(makerTemplateContract, qualityIntent);
        }
        await writeMakerJson(makerWorkspace, 'template-contract.json', makerTemplateContract);
        await writeMakerJson(makerWorkspace, 'asset-contract.json', makerAssetContract);
        await writeMakerJson(makerWorkspace, 'gametok-plan.json', buildMakerPlan(qualityIntent, prompt, makerTemplateContract));
        await reportProgress(20, 'spec', 'Game plan drafted...');
        
        console.log(`✅ Phase 1: "${qualityIntent.title}" — ${qualityIntent.userIntent}`);
        if (qualityIntent.playableExperience?.coreLoop) {
            console.log(`   Loop: ${qualityIntent.playableExperience.coreLoop}`);
        }
        if (qualityIntent.playableExperience?.primaryMechanic) {
            console.log(`   Primary mechanic: ${qualityIntent.playableExperience.primaryMechanic}`);
        }
        console.log(`   Tech: ${qualityIntent.technicalRequirements?.dimension || '2D'} ${qualityIntent.technicalRequirements?.perspective || 'top_down'}`);
        if (dynamicFoundation && makerFoundationContract) {
            console.log(`   Foundation: ${makerFoundationContract.foundationId} lane=${makerFoundationContract.lane} engine=${makerFoundationContract.engine}`);
            console.log(`   Kernel: canvas-kernel (AI-designed contract, shared runtime)`);
        } else {
            console.log(`   Template: ${makerTemplateContract.templateId} (${makerTemplateContract.engine})`);
        }
        if (!dynamicFoundation && makerTemplateContract.classification) {
            const picked = makerTemplateContract.classification;
            const topScores = (picked.scores || [])
                .slice(0, 3)
                .map((score) => `${score.templateId}:${score.score}`)
                .join(', ');
            console.log(`   Classifier: ${picked.selectedTemplateId} confidence=${picked.confidence} profile=${picked.physicsProfile?.physics || 'unknown'} scores=[${topScores}]`);
        }
        console.log(`   Asset contract: ${(makerAssetContract.slots || []).length} slots`);

        // ── ARTIST AGENT: Generate ALL visual assets with AI ──
        const useArtistAgent = process.env.DISABLE_ARTIST_AGENT !== 'true';
        const hasMakerAssetSlots = Array.isArray(makerAssetContract.slots) && makerAssetContract.slots.length > 0;
        generatedAssets = null;
        let dreamAssetPlan = null;
        
        const shouldRunArtistAgent = useArtistAgent && (
            dynamicFoundation
                ? hasMakerAssetSlots
                : (qualityIntent.visualAssets || hasMakerAssetSlots)
        );
        if (shouldRunArtistAgent) {
            let generatedImages = null;
            try {
                console.log(`🎨 Artist Agent: Planning visual asset generation...`);
                await reportProgress(26, 'assets', 'Planning visual assets...');
                let assetPlan;
                if (dynamicFoundation && makerAssetContract) {
                    console.log(`🎨 Artist Agent: Using foundation assetSlots only (${makerAssetContract.slots?.length || 0} slots)`);
                    assetPlan = await buildAssetPlanFromMakerContract(qualityIntent, makerAssetContract);
                } else {
                    assetPlan = await buildDreamAssetPlan(qualityIntent);
                    assetPlan = mergeMakerAssetContractIntoPlan(assetPlan, makerAssetContract);
                }
                dreamAssetPlan = assetPlan;
                const assetToolRequest = buildStructuredAssetToolRequest(assetPlan, makerAssetContract);
                await writeMakerJson(makerWorkspace, 'asset-plan.json', {
                    source: assetPlan.source || null,
                    sourceOfTruth: assetPlan.sourceOfTruth || makerAssetContract?.sourceOfTruth || null,
                    artDirection: assetPlan.artDirection || qualityIntent.artDirection || null,
                    assetContract: summarizeMakerAssetContract(makerAssetContract),
                    imageRequests: assetPlan.imageRequests || [],
                    audioPlan: assetPlan.audio || null,
                    tilesets: assetPlan.tilesets || [],
                });
                await writeMakerJson(makerWorkspace, 'asset-tool-request.json', {
                    ...assetToolRequest,
                    ...(dynamicFoundation ? { makerSystemManual: formatMakerSystemManual('artist') } : {}),
                });
                const assetRequests = assetPlan.imageRequests;
                
                console.log(`🎨 Artist Agent: Generating ${assetRequests.length} visual assets...`);
                await reportProgress(32, 'assets', 'Generating visual ingredients...');
                
                // Generate all assets
                const requiredSlotIds = getRequiredContractSlotIds(makerAssetContract);
                const artistCancel = async () => {
                    await assertJobNotCancelledShared(jobId, { force: true });
                    return false;
                };
                generatedImages = await batchArtistAgent(assetRequests, {
                    tilesets: assetPlan.tilesets || [],
                    requiredSlotIds,
                    shouldCancel: artistCancel,
                });
                const preHealIssues = collectRequiredContractArtIssues(generatedImages, makerAssetContract);
                if (preHealIssues.length > 0) {
                    const healResult = await healRequiredContractArt(
                        generatedImages,
                        assetRequests,
                        makerAssetContract,
                        { shouldCancel: artistCancel },
                    );
                    generatedImages = healResult.batchResult;
                    if (healResult.passes > 0) {
                        const healedSlots = healResult.healLog
                            .filter((entry) => entry.ok)
                            .map((entry) => entry.slotId)
                            .filter(Boolean);
                        if (healResult.healed) {
                            console.log(`[Artist Heal] Recovered required art after ${healResult.passes} pass(es)${healedSlots.length ? `: ${healedSlots.join(', ')}` : ''}`);
                        } else {
                            console.warn(`[Artist Heal] Still missing required art after ${healResult.passes} pass(es): ${
                                (healResult.remainingIssues || []).map((entry) => entry.key || entry.id).join(', ')
                            }`);
                        }
                    }
                } else if (Number(generatedImages?.fallbackCount) === 0) {
                    console.log('[Artist Heal] Skipped — required contract art already satisfied after batch');
                }
                generatedAssets = compileDreamAssetBundle(generatedImages, assetPlan);
                await finalizeMakerArtistPhase({
                    workspace: makerWorkspace,
                    generatedAssets,
                    assetContract: makerAssetContract,
                    templateContract: makerTemplateContract,
                    qualityIntent,
                });
                assertJobNotCancelled(jobId);
                await writeMakerJson(makerWorkspace, 'asset-manifest.json', generatedAssets.makerAssetManifest);
                await writeMakerJson(makerWorkspace, 'asset-summary.json', summarizeMakerAssets(generatedAssets));
                await reportProgress(42, 'assets', 'Visual assets prepared...');
                
                console.log(`✅ Artist Agent: Generated ${Object.keys(generatedAssets.assets).length} custom assets`);
                console.log(`   Asset pack: ${generatedAssets.assetPack.length} entries (${generatedAssets.animations.length} animations, ${generatedAssets.audio?.sfx?.length || 0} sfx, ${generatedAssets.audio?.music?.length || 0} music, ${generatedAssets.tilesets.length} tilesets)`);
                if (generatedAssets.errors) {
                    console.warn(`⚠️ Artist Agent: ${generatedAssets.errors.length} assets used fallbacks`);
                }
            } catch (error) {
                if (error?.code === 'REQUIRED_BACKGROUND_ART_FAILED'
                    || error?.code === 'REQUIRED_CONTRACT_ART_FAILED'
                    || error?.code === PHASE2_ASSET_PACK_INCOMPLETE) {
                    throw error;
                }
                const batchHadFluxArt = dreamAssetPlan && generatedImages
                    && Number(generatedImages.fallbackCount) === 0
                    && Array.isArray(generatedImages.assetPack)
                    && generatedImages.assetPack.some((entry) => String(entry?.url || '').startsWith('data:image/'));
                if (batchHadFluxArt) {
                    console.warn(`[Artist Agent] Post-batch step failed (${error.message}); keeping generated pack and continuing`);
                    try {
                        generatedAssets = compileDreamAssetBundle(generatedImages, dreamAssetPlan);
                        await finalizeMakerArtistPhase({
                            workspace: makerWorkspace,
                            generatedAssets,
                            assetContract: makerAssetContract,
                            templateContract: makerTemplateContract,
                            qualityIntent,
                            errors: [{ phase: 'asset_generation', message: error.message }],
                        });
                        await writeMakerJson(makerWorkspace, 'asset-manifest.json', generatedAssets.makerAssetManifest);
                        await writeMakerJson(makerWorkspace, 'asset-summary.json', summarizeMakerAssets(generatedAssets));
                    } catch (recoveryError) {
                        if (recoveryError?.code === 'REQUIRED_BACKGROUND_ART_FAILED'
                            || recoveryError?.code === 'REQUIRED_CONTRACT_ART_FAILED'
                            || recoveryError?.code === PHASE2_ASSET_PACK_INCOMPLETE) {
                            throw recoveryError;
                        }
                        console.error(`❌ Artist Agent failed after batch recovery:`, recoveryError.message);
                        generatedAssets = null;
                    }
                }
                if (!generatedAssets) {
                    console.error(`❌ Artist Agent failed:`, error.message);
                    console.log(`   Falling back to procedural generation`);
                    generatedAssets = null;
                    const failedAssetManifest = attachMakerAssetManifest(null, {
                        assetContract: makerAssetContract,
                        templateContract: makerTemplateContract,
                        qualityIntent,
                        errors: [{ phase: 'asset_generation', message: error.message }],
                    }).makerAssetManifest;
                    await writeMakerJson(makerWorkspace, 'asset-manifest.json', failedAssetManifest);
                    await writeMakerJson(makerWorkspace, 'asset-summary.json', summarizeMakerAssetManifest(failedAssetManifest));
                }
            }
        }

        if (!generatedAssets && makerWorkspace && !fs.existsSync(path.join(makerWorkspace, 'asset-manifest.json'))) {
            const emptyAssetManifest = attachMakerAssetManifest(null, {
                assetContract: makerAssetContract,
                templateContract: makerTemplateContract,
                qualityIntent,
                errors: useArtistAgent ? [] : [{ phase: 'asset_generation', message: 'Artist agent disabled by configuration.' }],
            });
            await writeMakerJson(makerWorkspace, 'asset-manifest.json', emptyAssetManifest.makerAssetManifest);
            await writeMakerJson(makerWorkspace, 'asset-summary.json', summarizeMakerAssetManifest(emptyAssetManifest.makerAssetManifest));
        }

        generatedAssets = await resolveDreamAudioForJob({
            generatedAssets,
            mediaAttachments,
            qualityIntent,
            assetPlan: dreamAssetPlan,
        });
        const userBgmAttachment = findUserBgmAttachment(mediaAttachments);
        console.log(`🎵 Audio manifest: ${generatedAssets?.audio?.sfx?.length || 0} sfx, ${generatedAssets?.audio?.music?.length || 0} music (${userBgmAttachment ? 'user-selected BGM' : 'auto Freesound BGM'})`);

        makerDebugProtocol = buildMakerDebugProtocol(makerTemplateContract, generatedAssets, makerAssetContract);
        await writeMakerJson(makerWorkspace, 'debug-protocol.json', makerDebugProtocol);
        const makerTemplateScaffold = dynamicFoundation && makerFoundationContract
            ? await buildKernelScaffold(makerFoundationContract, qualityIntent)
            : await loadMakerTemplateScaffold(makerTemplateContract.templateId);
        if (makerTemplateScaffold) {
            await writeMakerJson(makerWorkspace, 'template-scaffold.json', summarizeMakerTemplateScaffold(makerTemplateScaffold));
            await fs.promises.mkdir(path.join(makerWorkspace, 'template-scaffold'), { recursive: true });
            for (const scaffoldFile of makerTemplateScaffold.files) {
                const scaffoldPath = path.join(makerWorkspace, 'template-scaffold', scaffoldFile.path);
                await fs.promises.mkdir(path.dirname(scaffoldPath), { recursive: true });
                await fs.promises.writeFile(scaffoldPath, scaffoldFile.content, 'utf8');
            }
        }
        const makerDesignBrief = buildMakerDesignBrief({
            qualityIntent,
            prompt,
            templateContract: makerTemplateContract,
            assetContract: makerAssetContract,
        });
        await writeMakerText(makerWorkspace, 'GAME_DESIGN.md', makerDesignBrief);
        makerDesignBriefSummary = summarizeMakerDesignBrief(makerDesignBrief);
        await writeMakerJson(makerWorkspace, 'design-brief-summary.json', makerDesignBriefSummary);
        await writeMakerJson(makerWorkspace, 'gdd-summary.json', makerDesignBriefSummary);
        console.log(`   GDD: ${makerDesignBriefSummary.chars} chars across ${makerDesignBriefSummary.gddSections || 0}/6 contract sections`);

        // Legacy asset bundle (disabled by default, only used as fallback)
        const assetBundle = null; // Completely disabled
        
        assertJobNotCancelled(jobId);

        assertMakerAssetsReadyForPhase2({
            generatedAssets,
            assetContract: makerAssetContract,
            artistWasRequired: shouldRunArtistAgent && hasMakerAssetSlots,
        });

        // ── PHASE 2: KIMI BUILDS THE GAME ──
        console.log(`🔨 Phase 2/3: ${DREAM_MODELS.premiumBuilder} building...`);
        await reportProgress(48, 'build', 'Writing game logic...');
        
        // Build audio asset bundle from library (keep audio from library)
        const audioBundle = qualityIntent.audioNeeds ? {
            audio: [], // TODO: Select audio from library based on audioNeeds
            music: [], // TODO: Select music from library based on audioNeeds
        } : null;
        
        const legacyBuildPrompt = ALLOW_LEGACY_HTML_FALLBACK
            ? buildLabsSoloPrototype(prompt, qualityIntent, audioBundle, mediaAttachments, generatedAssets)
            : '';
        if (ALLOW_LEGACY_HTML_FALLBACK) {
            await writeMakerText(makerWorkspace, 'logs/legacy-html-build-contract.txt', legacyBuildPrompt);
        }
        let rawGameHtml = null;
        buildMode = 'file-native';
        try {
            makerProject = GAMETOK_MAKER_RESUME_WORKSPACE
                ? await loadMakerProjectFromWorkspace(makerWorkspace)
                : null;
            let projectBuild = null;
            if (makerProject) {
                buildMode = 'file-agent-native-resume';
                await writeMakerJson(makerWorkspace, 'logs/project-build-source.json', {
                    mode: buildMode,
                    source: 'existing-disk-project',
                    templateId: makerTemplateContract?.templateId || null,
                    fileCount: makerProject.files.length,
                    note: 'Resumed existing project files from disk; builder continues through file-agent turns.',
                });
                console.log(`🧰 Phase 2 resumed project from disk: ${makerProject.files.length} files. Continuing file-agent loop...`);
            } else {
                projectBuild = buildMakerProjectFromScaffold(makerTemplateScaffold, {
                    templateContract: makerTemplateContract,
                });
                if (projectBuild) {
                    buildMode = 'file-agent-native';
                    await writeMakerJson(makerWorkspace, 'logs/project-build-source.json', {
                        mode: buildMode,
                        source: projectBuild.source,
                        templateId: makerTemplateContract?.templateId || null,
                        fileCount: projectBuild.files.length,
                        note: 'Materialized starter scaffold first; builder now edits real files over multiple turns.',
                    });
                    console.log(`🧰 Phase 2 scaffold materialized: ${projectBuild.files.length} files. Starting file-agent loop...`);
                } else {
                    throw new Error(`No native scaffold exists for template ${makerTemplateContract?.templateId || 'unknown'}. Add a scaffold instead of falling back to one-shot project JSON.`);
                }
                makerBuilderMaps = await writeMakerBuilderMaps(makerWorkspace, projectBuild, 'initial_build', { generatedAssets });
                makerProject = await materializeMakerProjectFiles(makerWorkspace, projectBuild, {
                    title: qualityIntent.title || 'GameTok Game',
                    generatedAssets,
                });
            }
            if (!makerBuilderMaps && makerProject?.manifest) {
                makerBuilderMaps = await writeMakerBuilderMaps(makerWorkspace, makerProject.manifest, 'resumed_project', { generatedAssets });
            }
            if (Array.isArray(projectBuild?.assetRequests) && projectBuild.assetRequests.length > 0) {
                console.log(`🎨 [Maker Tool] Builder requested ${projectBuild.assetRequests.length} extra assets.`);
                await writeMakerJson(makerWorkspace, 'logs/project-asset-requests.json', projectBuild.assetRequests);
                await reportProgress(57, 'assets', 'Generating requested game assets...');
                const requestPlan = {
                    version: 2,
                    source: 'gametok-builder-requested-assets',
                    qualityIntent,
                    templateContract: summarizeMakerTemplateContract(makerTemplateContract),
                    artDirection: qualityIntent.artDirection || generatedAssets?.assetPlan?.artDirection || {},
                    imageRequests: projectBuild.assetRequests,
                    animations: [],
                    audio: generatedAssets?.audio || { sfx: [], music: [] },
                    tilesets: generatedAssets?.tilesets || [],
                };
                await writeMakerJson(makerWorkspace, 'logs/requested-asset-tool-request.json', buildStructuredAssetToolRequest(requestPlan, makerAssetContract));
                const requestedImages = await batchArtistAgent(projectBuild.assetRequests, {
                    requiredSlotIds: getRequiredContractSlotIds(makerAssetContract),
                    shouldCancel: async () => {
                        await assertJobNotCancelledShared(jobId, { force: true });
                        return false;
                    },
                });
                let requestedBatch = requestedImages;
                const requestedPreHealIssues = collectRequiredContractArtIssues(requestedBatch, makerAssetContract);
                if (requestedPreHealIssues.length > 0) {
                    const requestedHeal = await healRequiredContractArt(
                        requestedBatch,
                        projectBuild.assetRequests,
                        makerAssetContract,
                        {
                            shouldCancel: async () => {
                                await assertJobNotCancelledShared(jobId, { force: true });
                                return false;
                            },
                        },
                    );
                    requestedBatch = requestedHeal.batchResult;
                }
                const requestedBundle = compileDreamAssetBundle(requestedBatch, requestPlan);
                generatedAssets = mergeDreamAssetBundles(generatedAssets, requestedBundle);
                await finalizeMakerArtistPhase({
                    workspace: makerWorkspace,
                    generatedAssets,
                    assetContract: makerAssetContract,
                    templateContract: makerTemplateContract,
                    qualityIntent,
                });
                await writeMakerJson(makerWorkspace, 'asset-manifest.json', generatedAssets.makerAssetManifest);
                await writeMakerJson(makerWorkspace, 'asset-summary.json', summarizeMakerAssets(generatedAssets));
                await materializeMakerAssetsForProject(makerProject.projectRoot, generatedAssets, { workspace: makerWorkspace });
                makerDebugProtocol = buildMakerDebugProtocol(makerTemplateContract, generatedAssets, makerAssetContract);
                await writeMakerJson(makerWorkspace, 'debug-protocol.json', makerDebugProtocol);

                const projectFiles = await readMakerProjectFiles(makerProject.projectRoot);
                const integrationPrompt = buildMakerAssetIntegrationPrompt({
                    qualityIntent,
                    prompt,
                    projectFiles,
                    generatedAssets,
                    requestedAssets: projectBuild.assetRequests,
                    templateContract: makerTemplateContract,
                    debugProtocol: makerDebugProtocol,
                    assetContract: makerAssetContract,
                    designBrief: makerDesignBrief,
                });
                await writeMakerText(makerWorkspace, 'logs/project-asset-integration-prompt.txt', integrationPrompt);
                const integrationText = await generateCompleteJsonWithBuilder(integrationPrompt, {
                    label: 'Phase 2 Asset Integration',
                    jobId,
                    timeoutMs: BUILDER_REQUEST_TIMEOUT_MS,
                    maxAttempts: 2,
                    progressBase: 58,
                });
                await writeMakerText(makerWorkspace, 'logs/project-asset-integration-response.txt', integrationText);
                const integration = parseMakerFileRepairResponse(integrationText);
                const integrationEdits = await resolveMakerProtocolEdits(makerProject.projectRoot, integration);
                await applyMakerFileEdits(makerProject.projectRoot, integrationEdits, { compileGate: true });
                await rebuildMakerProjectDistWithAutoRepair(makerProject.projectRoot);
            }
            phase2Evidence = await runMakerAgentInspectionTurns({
                workspace: makerWorkspace,
                projectRoot: makerProject.projectRoot,
                turns: makerAgentTurns,
                jobId,
                prompt,
                qualityIntent,
                generatedAssets,
                templateContract: makerTemplateContract,
                assetContract: makerAssetContract,
                debugProtocol: makerDebugProtocol,
                designBrief: makerDesignBrief,
                builderMaps: makerBuilderMaps,
                assetQuality: generatedAssets?.assetQuality || null,
                reportProgress,
            });
            rawGameHtml = await assembleMakerProjectHtmlWithAutoRepair(makerProject.projectRoot);
            console.log(`✅ Phase 2 project build complete: ${makerProject.files.length} files assembled into ${rawGameHtml.length} chars`);
        } catch (projectBuildError) {
            await writeMakerText(makerWorkspace, 'logs/project-build-error.txt', projectBuildError.stack || projectBuildError.message);
            if (!ALLOW_LEGACY_HTML_FALLBACK) {
                throw new Error(`Native maker project build failed and legacy whole-HTML fallback is disabled: ${projectBuildError.message}`);
            }
            console.error(`[Maker Build] File-native project build failed, using explicitly enabled complete HTML fallback: ${projectBuildError.message}`);
            buildMode = 'whole-html-fallback-explicit';
            rawGameHtml = await generateCompleteHtmlWithBuilder(legacyBuildPrompt, { label: 'Phase 2 Build', jobId });
        }
        assertJobNotCancelled(jobId);
        await writeMakerText(makerWorkspace, 'raw-build.html', rawGameHtml);
        await reportProgress(68, 'build', 'Game code assembled...');

        if (!rawGameHtml) {
            throw new Error('Main builder returned empty game output.');
        }
        if (!hasClosedHtmlDocument(rawGameHtml)) {
            throw new Error('Builder output is missing </html> and appears truncated.');
        }
        if (!makerProject) {
            makerProject = await materializeMakerProject(makerWorkspace, rawGameHtml, {
                title: resolveDreamGameTitle({ specTitle: qualityIntent.title, html: rawGameHtml, fallback: 'GameTok Game' }),
                generatedAssets,
            });
        }

        console.log(`✅ Phase 2 complete: ${buildMode} builder generated ${rawGameHtml.length} chars of game code`);

        // Persist the editable source so the user can later "add this / change this" without a full
        // regenerate. The workspace is deleted at job end, so we snapshot the final (post-agent)
        // source files + asset pack into the DB now. Never blocks generation if it fails.
        await persistEditableMakerSource(persistToDb ? jobId : null, makerProject, qualityIntent);

        // ── POST-PROCESS: Inject Juice + Audio engines ──
        const useOpenGameMinimalRuntime = buildMode === 'opengame-template-native';
        const useOpenGameAcceptance = buildMode === 'opengame-template-native';
        let finalHtml = postProcessRawHtml(rawGameHtml, generatedAssets, { minimalRuntime: useOpenGameMinimalRuntime });
        await writeMakerText(makerWorkspace, 'artifact/index.html', finalHtml);
        let finalScreenshot = null;
        finalSandboxResult = null;

        // ── PHASE 3/3: QA SANDBOX AUTO-HEALING LOOP ──
        let repairAttemptsUsed = 0;
        let sandboxVerifyAttempt = 0;
        let p3Success = false;
        const pendingRepairProtocolRecords = [];
        const phase2AgentLoopPassed = Boolean(phase2Evidence?.success) && useMakerAgentTools();
        const phase2ContractChecksClean = !(phase2Evidence?.diagnostics?.failedContractChecks || []).length;

        if (SKIP_PHASE3_REPAIR_WHEN_PHASE2_PASSES && phase2AgentLoopPassed && phase2ContractChecksClean) {
            console.log('✅ Phase 2 forge agent loop passed sandbox/build with clean contract checks — skipping Phase 3 JSON repair loop');
            await reportProgress(78, 'verify', 'Game verified in forge agent loop...');
            p3Success = true;
            finalSandboxResult = {
                success: true,
                crashes: [],
                hasScreenshot: Boolean(phase2Evidence?.screenshot),
                diagnostics: phase2Evidence?.diagnostics || null,
                attempt: 1,
                repairAttemptsUsed: 0,
                checkedAt: new Date().toISOString(),
                skippedPhase3Repair: true,
            };
        }
        
        while (!p3Success) {
            assertJobNotCancelled(jobId);
            sandboxVerifyAttempt += 1;
            console.log(`📸 [Verify ${sandboxVerifyAttempt}/${MAKER_SANDBOX_REPAIR_ATTEMPTS + 1}] Testing game in sandbox...`);
            await reportProgress(74, 'verify', 'Testing the game in a sandbox...');
            let sandboxRes;
            try {
                const runtimeLane = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'first_person'
                    ? 'first_person_threejs'
                    : qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'third_person'
                    ? 'third_person_threejs'
                    : null;
                sandboxRes = await verifyGame(finalHtml, {
                    runtimeLane,
                    requireDreamAssets: hasGeneratedVisualAssets(generatedAssets),
                    sourceHtml: rawGameHtml,
                    templateContract: makerTemplateContract,
                    assetContract: makerAssetContract,
                });
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }
            finalScreenshot = sandboxRes.screenshot || null;
            finalSandboxResult = {
                success: Boolean(sandboxRes.success),
                crashes: sandboxRes.crashes || [],
                hasScreenshot: Boolean(sandboxRes.screenshot),
                diagnostics: sandboxRes.diagnostics || null,
                attempt: sandboxVerifyAttempt,
                repairAttemptsUsed,
                checkedAt: new Date().toISOString(),
            };
            makerGddCompliance = verifyMakerGddCompliance({
                gddSummary: makerDesignBriefSummary,
                templateContract: makerTemplateContract,
                assetContract: makerAssetContract,
                assetManifest: generatedAssets?.makerAssetManifest || null,
                sandbox: finalSandboxResult,
                buildMode,
            });
            makerAcceptanceResult = buildMakerAcceptanceResult({
                sandbox: finalSandboxResult,
                templateContract: makerTemplateContract,
                debugProtocol: makerDebugProtocol,
                assetContract: makerAssetContract,
                assetManifest: generatedAssets?.makerAssetManifest || null,
                assetQuality: useOpenGameAcceptance ? null : (generatedAssets?.assetQuality || null),
                gddCompliance: makerGddCompliance,
            });
            if (sandboxRes.success && !makerAcceptanceResult.passed && !useOpenGameAcceptance) {
                console.warn(`⚠️ Acceptance gate failed after sandbox pass: ${makerAcceptanceResult.grade} (${makerAcceptanceResult.score}/100)`);
                sandboxRes = mergeAcceptanceIntoSandboxDiagnostics(sandboxRes, makerAcceptanceResult);
                finalSandboxResult = {
                    success: false,
                    crashes: sandboxRes.crashes || [],
                    hasScreenshot: Boolean(sandboxRes.screenshot),
                    diagnostics: sandboxRes.diagnostics || null,
                    attempt: sandboxVerifyAttempt,
                    repairAttemptsUsed,
                    checkedAt: new Date().toISOString(),
                    acceptanceGate: makerAcceptanceResult,
                };
            } else {
                if (sandboxRes.success && !makerAcceptanceResult.passed && useOpenGameAcceptance) {
                    console.warn(`⚠️ [OpenGame Maker] Acceptance report is non-blocking after sandbox pass: ${makerAcceptanceResult.grade} (${makerAcceptanceResult.score}/100)`);
                }
                finalSandboxResult.acceptanceGate = makerAcceptanceResult;
            }
            await writeMakerJson(makerWorkspace, 'sandbox-result.json', finalSandboxResult);
            await writeMakerJson(makerWorkspace, `acceptance-result-${finalSandboxResult.attempt}.json`, makerAcceptanceResult);
            await writeMakerJson(makerWorkspace, 'acceptance-result.json', makerAcceptanceResult);
            await appendMakerAgentTurn(makerWorkspace, makerAgentTurns, {
                phase: 'sandbox_verification',
                objective: `Run sandbox verification attempt ${finalSandboxResult.attempt}.`,
                status: sandboxRes.success ? 'complete' : 'failed',
                model: 'sandbox',
                targetedRepairTasks: sandboxRes.success ? [] : buildTargetedRepairTasks(sandboxRes.diagnostics || null),
                sandbox: finalSandboxResult,
                notes: sandboxRes.success
                    ? [`Sandbox and acceptance gate passed (${makerAcceptanceResult.score}/100).`]
                    : ['Sandbox or acceptance verification produced targeted repair tasks.'],
            });

            if (!sandboxRes.success && sandboxRes.crashes && sandboxRes.crashes.length > 0) {
                if (buildMode === 'opengame-template-native') {
                    console.warn(`⚠️ [OpenGame Maker] Template-owned runtime failed verification. Model file repair is disabled for this path; fix the deterministic template/sandbox contract instead. (${sandboxRes.crashes[0]})`);
                    await reportProgress(78, 'verify', 'Template verification failed...');
                    break;
                }
                console.log(`⚠️ Sandbox CRASH DETECTED. Asking main builder to repair... (${sandboxRes.crashes[0]})`);
                await reportProgress(78, 'repair', 'Repairing a sandbox crash...');
                const is3DFirstPerson = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'first_person';
                const is3DThirdPerson = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'third_person';
                
                const repairInstructions = [
                    `The mobile HTML5 game below failed verification after build.`,
                    `FATAL ERROR: ${sandboxRes.crashes[0]}`,
                    '',
                    'The repaired game must still satisfy this operational game spec:',
                    JSON.stringify({
                        playableExperience: qualityIntent.playableExperience || null,
                        mobileControls: qualityIntent.mobileControls || [],
                        playerActions: qualityIntent.playerActions || [],
                        entityRules: qualityIntent.entityRules || [],
                        mustExist: qualityIntent.mustExist || [],
                        feelRules: qualityIntent.feelRules || [],
                        failureModesToAvoid: qualityIntent.failureModesToAvoid || [],
                    }, null, 2),
                    '',
                    'Repair the game so it boots and remains playable on mobile.',
                    is3DFirstPerson
                        ? 'This game MUST remain a true first-person 3D Three.js game with a PerspectiveCamera and mobile look controls. Do not downgrade it into top-down 2D.'
                        : is3DThirdPerson
                        ? 'This game MUST remain a true third-person/chase-camera 3D Three.js game with a visible player or vehicle and follow camera. Do not downgrade it into first-person, top-down, or flat 2D.'
                        : 'Preserve the intended perspective and gameplay fantasy.',
                    'If any error mentions viewport overflow, bounds, canvas sizing, hidden HUD, or off-screen controls, rewrite the layout with responsive innerWidth/innerHeight sizing, GameTok chrome-safe HUD placement, and resize recomputation. Reserve at least the top 112px and bottom 48px for native app chrome; do not place score, lives, wave labels, inventory, pause, or controls under that chrome. The final game must fit a 390x844 phone viewport without horizontal scrolling.',
                    `Preserve the quality target: ${qualityIntent.qualityTarget?.level || 'high'} quality with ${qualityIntent.qualityTarget?.mood || 'engaging'} mood.`,
                    `Maintain polish priorities: ${Array.isArray(qualityIntent.qualityTarget?.polishPriorities) ? qualityIntent.qualityTarget.polishPriorities.join(', ') : 'smooth animations, visual feedback'}`,
                    'Return the COMPLETE corrected HTML file only.',
                    'Do not explain anything.',
                ].join('\n');
                if (repairAttemptsUsed >= MAKER_SANDBOX_REPAIR_ATTEMPTS) {
                    break;
                }
                repairAttemptsUsed += 1;
                const repairAttempt = repairAttemptsUsed;
                let repairedWithProjectFiles = false;
                if (makerProject?.projectRoot) {
                    try {
                        const projectFiles = await readMakerProjectFiles(makerProject.projectRoot);
                        const targetedRepairTasks = buildTargetedRepairTasks(sandboxRes.diagnostics || null);
                        const repairPlaybook = buildMakerRepairPlaybook(targetedRepairTasks);
                        const repairProtocol = await loadMakerRepairProtocol(GAMETOK_MAKER_ROOT);
                        const repairProtocolMatches = matchMakerRepairProtocol(repairProtocol, targetedRepairTasks);
                        const repairEvolutionGuidance = buildMakerRepairEvolutionGuidance(repairProtocol, targetedRepairTasks);

                        // Skip repair if this crash signature has been seen 3+ times and never fixed
                        if (shouldSkipRepair(repairProtocolMatches)) {
                            console.warn(`🧠 [Repair Memory] Skipping repair — this crash type has never been successfully fixed. Sending game as-is.`);
                            await reportProgress(82, 'repair', 'Known issue detected, shipping game...');
                            repairedWithProjectFiles = true; // skip legacy fallback too
                            break;
                        }
                        const fileRepairPrompt = buildMakerFileRepairPrompt({
                            qualityIntent,
                            prompt,
                            crash: sandboxRes.crashes[0],
                            projectFiles,
                            generatedAssets,
                            sandboxDiagnostics: sandboxRes.diagnostics || null,
                            templateContract: makerTemplateContract,
                            debugProtocol: makerDebugProtocol,
                            assetContract: makerAssetContract,
                            designBrief: makerDesignBrief,
                            repairProtocolMatches,
                            repairEvolutionGuidance,
                        });
                        await writeMakerJson(makerWorkspace, `logs/file-repair-request-${repairAttempt}.json`, {
                            attempt: repairAttempt,
                            crash: sandboxRes.crashes[0],
                            diagnostics: sandboxRes.diagnostics || null,
                            targetedRepairTasks,
                            repairPlaybook,
                            repairProtocolMatches,
                            repairEvolutionGuidance,
                            assetSummary: summarizeMakerAssets(generatedAssets),
                            files: projectFiles.map((file) => ({
                                path: file.path,
                                chars: file.content?.length || 0,
                                truncated: Boolean(file.truncated),
                            })),
                        });
                        let repairText = '';
                        let repairError = null;
                        for (let m = 0; m < BUILDER_FALLBACK_MODELS.length; m++) {
                            const mModel = BUILDER_FALLBACK_MODELS[m];
                            try {
                                repairText = await generateCompleteJsonWithBuilder(fileRepairPrompt, {
                                    label: 'Phase 3 File Repair',
                                    jobId,
                                    timeoutMs: BUILDER_REQUEST_TIMEOUT_MS,
                                    maxAttempts: 2,
                                    currentModel: mModel,
                                });
                                break;
                            } catch(e) {
                                repairError = e;
                                console.error(`⚠️ [Phase 3 Repair] ${mModel} failed protocol JSON repair: ${e.message}`);
                            }
                        }
                        if (!repairText) throw new Error(`All models failed Phase 3 File Repair: ${repairError?.message || 'unknown error'}`);
                        await writeMakerText(makerWorkspace, `logs/file-repair-response-${repairAttempt}.json`, repairText);
                        const repair = parseMakerFileRepairResponse(repairText);
                        const repairEdits = await resolveMakerProtocolEdits(makerProject.projectRoot, repair);
                        const applied = await applyMakerFileEdits(makerProject.projectRoot, repairEdits, { compileGate: true });
                        await rebuildMakerProjectDistWithAutoRepair(makerProject.projectRoot);
                        rawGameHtml = await assembleMakerProjectHtmlWithAutoRepair(makerProject.projectRoot);
                        assertJobNotCancelled(jobId);
                        if (!hasClosedHtmlDocument(rawGameHtml)) {
                            throw new Error('Project file repair assembled HTML is missing </html>.');
                        }
                        await writeMakerText(makerWorkspace, 'raw-build.html', rawGameHtml);
                        finalHtml = postProcessRawHtml(rawGameHtml, generatedAssets, { minimalRuntime: useOpenGameMinimalRuntime });
                        await writeMakerText(makerWorkspace, 'artifact/index.html', finalHtml);
                        makerRepairs.push({
                            attempt: repairAttempt,
                            mode: 'project-file-edits',
                            applied,
                            notes: repair.notes,
                        });
                        await appendMakerAgentTurn(makerWorkspace, makerAgentTurns, {
                            phase: 'targeted_file_repair',
                            objective: `Repair sandbox/probe failures for attempt ${repairAttempt}.`,
                            status: 'complete',
                            model: DREAM_MODELS.premiumBuilder,
                            filesRead: summarizeMakerProjectFiles(projectFiles),
                            editsApplied: applied,
                            targetedRepairTasks,
                            sandbox: {
                                success: false,
                                crashes: sandboxRes.crashes || [],
                                diagnostics: sandboxRes.diagnostics || null,
                            },
                            notes: repair.notes,
                        });
                        pendingRepairProtocolRecords.push({
                            attempt: repairAttempt,
                            tasks: targetedRepairTasks,
                            playbook: repairPlaybook,
                            repairNotes: repair.notes,
                            applied,
                            failure: sandboxRes.crashes[0],
                        });
                        repairedWithProjectFiles = true;
                    } catch (fileRepairError) {
                        console.error(`[Maker Repair] File-level repair failed: ${fileRepairError.message}`);
                        makerRepairs.push({
                            attempt: repairAttempt,
                            mode: 'project-file-edits-failed',
                            error: fileRepairError.message,
                        });
                        const failedTasks = buildTargetedRepairTasks(sandboxRes.diagnostics || null);
                        await appendMakerAgentTurn(makerWorkspace, makerAgentTurns, {
                            phase: 'targeted_file_repair',
                            objective: `Repair sandbox/probe failures for attempt ${repairAttempt}.`,
                            status: 'failed',
                            model: DREAM_MODELS.premiumBuilder,
                            targetedRepairTasks: failedTasks,
                            sandbox: {
                                success: false,
                                crashes: sandboxRes.crashes || [],
                                diagnostics: sandboxRes.diagnostics || null,
                            },
                            error: fileRepairError.message,
                        });
                        if (failedTasks.length > 0) {
                            await recordMakerRepairOutcome(GAMETOK_MAKER_ROOT, {
                                jobId,
                                attempt: repairAttempt,
                                templateId: makerTemplateContract?.templateId || null,
                                tasks: failedTasks,
                                verified: false,
                                failure: fileRepairError.message,
                            });
                        }
                    }
                }

                if (!repairedWithProjectFiles) {
                    if (!ALLOW_LEGACY_HTML_FALLBACK) {
                        console.warn('⚠️ [Maker Repair] File repair failed and legacy fallback is disabled. Retrying bounded repair if attempts remain.');
                        if (repairAttemptsUsed < MAKER_SANDBOX_REPAIR_ATTEMPTS) {
                            continue;
                        }
                        break;
                    }
                    console.error('[Maker Repair] Using explicitly enabled whole-HTML regeneration fallback.');
                    const repairPrompt = buildPhase2_EditGame(rawGameHtml, repairInstructions);
                    rawGameHtml = await generateCompleteHtmlWithBuilder(repairPrompt, { label: 'Phase 3 Quality Repair', jobId });
                    assertJobNotCancelled(jobId);
                    if (!hasClosedHtmlDocument(rawGameHtml)) {
                        throw new Error('Builder repair output is missing </html> and appears truncated.');
                    }
                    await writeMakerText(makerWorkspace, 'raw-build.html', rawGameHtml);
                    makerProject = await materializeMakerProject(makerWorkspace, rawGameHtml, {
                        title: resolveDreamGameTitle({ specTitle: qualityIntent.title, html: rawGameHtml, fallback: 'GameTok Game' }),
                        generatedAssets,
                    });
                    finalHtml = postProcessRawHtml(rawGameHtml, generatedAssets, { minimalRuntime: useOpenGameMinimalRuntime });
                    await writeMakerText(makerWorkspace, 'artifact/index.html', finalHtml);
                    makerRepairs.push({
                        attempt: repairAttempt,
                        mode: 'whole-html-regeneration',
                    });
                }
            } else {
                console.log(`✅ Sandbox: Zero Crashes Detected. Game is stable!`);
                await reportProgress(84, 'verify', 'Game boots cleanly...');
                p3Success = true;
                for (const record of pendingRepairProtocolRecords.splice(0)) {
                    await recordMakerRepairOutcome(GAMETOK_MAKER_ROOT, {
                        jobId,
                        attempt: record.attempt,
                        templateId: makerTemplateContract?.templateId || null,
                        tasks: record.tasks,
                        playbook: record.playbook,
                        repairNotes: record.repairNotes,
                        applied: record.applied,
                        verified: true,
                        failure: record.failure,
                    });
                }
            }
        }

        if (!p3Success) {
            for (const record of pendingRepairProtocolRecords.splice(0)) {
                await recordMakerRepairOutcome(GAMETOK_MAKER_ROOT, {
                    jobId,
                    attempt: record.attempt,
                    templateId: makerTemplateContract?.templateId || null,
                    tasks: record.tasks,
                    playbook: record.playbook,
                    repairNotes: record.repairNotes,
                    applied: record.applied,
                    verified: false,
                    failure: record.failure,
                });
            }
            const finalCrash = Array.isArray(finalSandboxResult?.crashes) && finalSandboxResult.crashes.length > 0
                ? finalSandboxResult.crashes[0]
                : 'unknown verifier failure';
            const finalTasks = buildTargetedRepairTasks(finalSandboxResult?.diagnostics || null)
                .map((task) => task.directRepairTask || task.failure)
                .filter(Boolean)
                .slice(0, 3);
            console.error(`⚠️ Sandbox verification failed after ${repairAttemptsUsed} builder repair attempts.`);
            console.error(`⚠️ Last failure: ${finalCrash}`);
            if (finalTasks.length) {
                console.error(`⚠️ Targeted repair tasks: ${finalTasks.join(' | ')}`);
            }
            throw new Error([
                `DreamStream verification failed after ${repairAttemptsUsed} repair attempt(s): ${finalCrash}`,
                finalTasks.length ? `Targeted repair tasks: ${finalTasks.join(' | ')}` : null,
            ].filter(Boolean).join(' '));
        }

        // ── SAVE TO DB ──
        assertJobNotCancelled(jobId);
        await reportProgress(94, 'save', 'Saving your game...');
        const finalTitle = resolveDreamGameTitle({
            specTitle: qualityIntent.title,
            html: rawGameHtml,
            fallback: 'DreamStream Game',
        });
        makerGddCompliance = verifyMakerGddCompliance({
            gddSummary: makerDesignBriefSummary,
            templateContract: makerTemplateContract,
            assetContract: makerAssetContract,
            assetManifest: generatedAssets?.makerAssetManifest || null,
            sandbox: finalSandboxResult,
            buildMode,
        });
        makerAcceptanceResult = buildMakerAcceptanceResult({
            sandbox: finalSandboxResult,
            templateContract: makerTemplateContract,
            debugProtocol: makerDebugProtocol,
            assetContract: makerAssetContract,
            assetManifest: generatedAssets?.makerAssetManifest || null,
            assetQuality: buildMode === 'opengame-template-native' ? null : (generatedAssets?.assetQuality || null),
            gddCompliance: makerGddCompliance,
        });
        await writeMakerJson(makerWorkspace, 'gdd-compliance.json', makerGddCompliance);
        await writeMakerJson(makerWorkspace, 'acceptance-result.json', makerAcceptanceResult);
        const makerBenchmarkResult = makerBenchmark
            ? buildMakerBenchmarkResult({
                benchmark: makerBenchmark,
                jobId,
                prompt,
                status: 'complete',
                templateContract: makerTemplateContract,
                assetContract: makerAssetContract,
                debugProtocol: makerDebugProtocol,
                sandbox: finalSandboxResult,
                repairs: makerRepairs,
                buildMode,
                generatedAssets: summarizeMakerAssets(generatedAssets),
                assetQuality: summarizeMakerAssetQuality(generatedAssets?.assetQuality || null),
                gddSummary: makerDesignBriefSummary,
                gddCompliance: makerGddCompliance,
                agentLoop: summarizeMakerAgentTurns(makerAgentTurns),
                acceptance: makerAcceptanceResult,
                html: finalHtml,
            })
            : null;
        if (makerBenchmarkResult) {
            await writeMakerJson(makerWorkspace, 'benchmark-result.json', makerBenchmarkResult);
            await updateGenerationJobBenchmarkResult(jobId, makerBenchmarkResult);
        }
        await writeMakerJson(makerWorkspace, 'gametok-build-report.json', {
            version: 1,
            jobId,
            title: finalTitle,
            engine: 'gametok-native-maker',
            status: 'complete',
            completedAt: new Date().toISOString(),
            workspace: makerWorkspace,
            projectRoot: makerProject?.projectRoot || null,
            projectIndex: makerProject?.sourceIndex || null,
            projectDistIndex: makerProject?.distIndex || null,
            artifactPath: path.join(makerWorkspace, 'artifact/index.html'),
            rawBuildPath: path.join(makerWorkspace, 'raw-build.html'),
            buildCommand: buildMode === 'file-agent-native' || buildMode === 'file-agent-native-resume' ? 'native-file-agent'
                : buildMode === 'file-native' ? 'native-project-builder'
                    : 'native-html-builder',
            buildMode,
            promptModel: DREAM_MODELS.premiumBuilder,
            specModel: DREAM_MODELS.spec,
            templateContract: summarizeMakerTemplateContract(makerTemplateContract),
            assetContract: summarizeMakerAssetContract(makerAssetContract),
            assetManifest: summarizeMakerAssetManifest(generatedAssets?.makerAssetManifest || null),
            gdd: makerDesignBriefSummary,
            gddCompliance: makerGddCompliance,
            acceptance: makerAcceptanceResult,
            agentLoop: summarizeMakerAgentTurns(makerAgentTurns),
            templateScaffold: summarizeMakerTemplateScaffold(makerTemplateScaffold),
            debugProtocol: makerDebugProtocol,
            assetSummary: summarizeMakerAssets(generatedAssets),
            assetQuality: summarizeMakerAssetQuality(generatedAssets?.assetQuality || null),
            builderMaps: makerBuilderMaps,
            sandbox: finalSandboxResult,
            benchmark: makerBenchmarkResult,
            repairs: makerRepairs,
            htmlBytes: Buffer.byteLength(finalHtml || '', 'utf8'),
            rawHtmlBytes: Buffer.byteLength(rawGameHtml || '', 'utf8'),
            knownLimitations: [],
        });
        if (!persistToDb) {
            console.log(`✅ [DREAM JOB] Complete! "${finalTitle}" exported to ${path.join(makerWorkspace, 'artifact/index.html')}`);
            forgetCancelledJob(jobId);
            return {
                jobId,
                title: finalTitle,
                html: finalHtml,
                rawHtml: rawGameHtml,
                screenshot: finalScreenshot,
                workspace: makerWorkspace,
                artifactPath: path.join(makerWorkspace, 'artifact/index.html'),
                reportPath: path.join(makerWorkspace, 'gametok-build-report.json'),
                buildMode,
                templateContract: summarizeMakerTemplateContract(makerTemplateContract),
                assetContract: summarizeMakerAssetContract(makerAssetContract),
                acceptance: makerAcceptanceResult,
                sandbox: finalSandboxResult,
            };
        }
        const classification = await classifyPublishedGame({
            title: finalTitle,
            prompt,
            description: "Multi-Engine AI Creation: " + prompt,
            htmlPayload: finalHtml,
        });
        assertJobNotCancelled(jobId);
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
                finalHtml,
                rawGameHtml,
                null,
                finalScreenshot,
                null,
                classification.category,
                classification.subcategory,
                classification.primaryTab,
                classification.interactionType,
                classification.confidence,
                JSON.stringify(classification.tags),
                JSON.stringify(classification.discoveryChips || []),
                jobId,
            ]
        );
        console.log(`✅ [DREAM JOB] Complete! "${finalTitle}" saved for job ${jobId} [${classification.primaryTab}/${classification.category}]`);
        forgetCancelledJob(jobId);
        pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
            .then((ownerRes) => notifyGameReady(ownerRes.rows[0]?.user_id, jobId, finalTitle))
            .catch((error) => console.log('[Notifications] Game ready notify error:', error));

    } catch (err) {
        if (isCancellationError(err)) {
            console.log(`🛑 [DREAM JOB] Canceled job ${jobId}.`);
            if (makerWorkspace) {
                await writeMakerJson(makerWorkspace, 'gametok-build-report.json', {
                    version: 1,
                    jobId,
                    engine: 'gametok-native-maker',
                    status: 'canceled',
                    completedAt: new Date().toISOString(),
                    workspace: makerWorkspace,
                    agentLoop: summarizeMakerAgentTurns(makerAgentTurns),
                    error: 'Generation cancelled by user',
                }).catch(() => {});
            }
            if (persistToDb) {
                await markJobCanceled(jobId);
            }
            if (!persistToDb) {
                throw err;
            }
            return;
        }
        console.error("❌ [DREAM JOB] Error:", err);
        if (!makerGddCompliance && makerDesignBriefSummary) {
            makerGddCompliance = verifyMakerGddCompliance({
                gddSummary: makerDesignBriefSummary,
                templateContract: makerTemplateContract,
                assetContract: makerAssetContract,
                assetManifest: generatedAssets?.makerAssetManifest || null,
                sandbox: finalSandboxResult,
                buildMode,
            });
        }
        if (!makerAcceptanceResult && finalSandboxResult) {
            makerAcceptanceResult = buildMakerAcceptanceResult({
                sandbox: finalSandboxResult,
                templateContract: makerTemplateContract,
                debugProtocol: makerDebugProtocol,
                assetContract: makerAssetContract,
                assetManifest: generatedAssets?.makerAssetManifest || null,
                assetQuality: buildMode === 'opengame-template-native' ? null : (generatedAssets?.assetQuality || null),
                gddCompliance: makerGddCompliance,
            });
        }
        const failedBenchmarkResult = makerBenchmark
            ? buildMakerBenchmarkResult({
                benchmark: makerBenchmark,
                jobId,
                prompt,
                status: 'failed',
                error: err?.message || String(err),
                templateContract: makerTemplateContract,
                assetContract: makerAssetContract,
                debugProtocol: makerDebugProtocol,
                sandbox: finalSandboxResult,
                repairs: makerRepairs,
                buildMode,
                generatedAssets: summarizeMakerAssets(generatedAssets),
                assetQuality: summarizeMakerAssetQuality(generatedAssets?.assetQuality || null),
                gddSummary: makerDesignBriefSummary,
                gddCompliance: makerGddCompliance,
                agentLoop: summarizeMakerAgentTurns(makerAgentTurns),
                acceptance: makerAcceptanceResult,
            })
            : null;
        if (failedBenchmarkResult) {
            if (persistToDb) {
                await updateGenerationJobBenchmarkResult(jobId, failedBenchmarkResult).catch(() => {});
            }
        }
        if (makerWorkspace) {
            await writeMakerJson(makerWorkspace, 'gametok-build-report.json', {
                version: 1,
                jobId,
                engine: 'gametok-native-maker',
                status: 'failed',
                completedAt: new Date().toISOString(),
                workspace: makerWorkspace,
                error: err?.message || String(err),
                stack: err?.stack || null,
                gdd: makerDesignBriefSummary,
                gddCompliance: makerGddCompliance,
                acceptance: makerAcceptanceResult,
                agentLoop: summarizeMakerAgentTurns(makerAgentTurns),
                benchmark: failedBenchmarkResult,
            }).catch(() => {});
            if (failedBenchmarkResult) {
                await writeMakerJson(makerWorkspace, 'benchmark-result.json', failedBenchmarkResult).catch(() => {});
            }
        }
        if (persistToDb) {
            await markJobError(jobId, "DreamStream generation failed", err);
        } else {
            throw err;
        }
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

/**
 * Edit an existing canvas-kernel game from its saved source (ai_games.maker_project).
 *
 * Reconstructs the project on disk (kernel scaffold + saved source + saved art), asks the builder to
 * apply ONLY the user's change to src/main.ts, rebuilds, and sandbox-verifies. Saves to the row ONLY
 * on a clean build — a failed edit throws and never touches the original game. On success the new
 * main.ts is re-snapshotted into maker_project so edits chain.
 */
async function executeMakerEditJob(newJobId, parentDraftId, parentDraft, makerProject, instructions) {
    console.log(`🛠️ [MAKER EDIT] job ${newJobId} editing canvas-kernel game ${parentDraftId}: "${instructions}"`);
    const savedFiles = Array.isArray(makerProject.files) ? makerProject.files : [];
    const currentMain = (savedFiles.find((f) => f.path === 'src/main.ts') || {}).content;
    if (!currentMain) throw new Error('Saved project has no src/main.ts to edit.');

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
    const kernel = await loadMakerTemplateScaffold('canvas-kernel');
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

    // 2. Builder applies the edit to main.ts. System manual carries the kernel rules + premium recipes.
    const assetKeys = (savedFiles.find((f) => f.path === 'src/assetKeys.ts') || {}).content || '';
    const editPrompt = [
        formatMakerSystemManual('fileAgent'),
        '',
        'You are editing an existing, working mobile HTML5 game built on the GameTok canvas-kernel.',
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

    // Mini-creeper around the single long builder wait (the one place an edit can stall on the
    // cold queue) so the bar never freezes. unref()'d + cleared in finally.
    setEditProgress(34, 'Applying your change…');
    let editCreep = 34;
    const editCreepTimer = setInterval(() => {
        if (editCreep < 62) {
            editCreep = Math.min(62, editCreep + 2);
            markEphemeralJob(newJobId, { status: 'pending', draftId: parentDraftId, progress: Math.round(editCreep), statusMessage: 'Applying your change…' });
        }
    }, 1500);
    if (typeof editCreepTimer.unref === 'function') editCreepTimer.unref();
    let text;
    try {
        ({ text } = await requestBuilderMessage(editPrompt, { label: 'Maker Edit main.ts', jobId: newJobId }));
    } finally {
        clearInterval(editCreepTimer);
    }
    setEditProgress(66, 'Applying your change…');
    const newMain = stripCodeFences(text);
    if (!newMain || newMain.length < 200 || !/__GAMETOK_TEMPLATE_PROBE__/.test(newMain)) {
        throw new Error('Edit builder returned an invalid main.ts (missing probe API or too short).');
    }
    await fs.promises.writeFile(path.join(projectRoot, 'src', 'main.ts'), newMain, 'utf8');

    // 2b. Re-run the asset-wiring pass so an edit can't silently drop the background or other
    //     required art. When the builder rewrites main.ts to apply a change it sometimes forgets to
    //     re-draw the generated background (a code grid appears instead). This re-injects the safe
    //     contract/background wiring if it's missing — edits stay non-destructive to art. Keys are
    //     read from the reconstructed asset-pack.json, so no contract/generatedAssets needed.
    try {
        const wiring = await applyMainTsAssetWiringRepairs(projectRoot, {});
        const repairs = wiring && wiring[0] && wiring[0].repairs ? wiring[0].repairs : [];
        if (repairs.length) {
            console.log(`🛠️ [MAKER EDIT] re-applied asset wiring after edit: ${repairs.join(', ')}`);
        }
    } catch (e) {
        console.warn(`🛠️ [MAKER EDIT] asset-wiring re-pass skipped: ${e?.message || e}`);
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
        sandboxRes = await verifyGame(finalHtml, {});
    } catch (e) {
        sandboxRes = { success: false, crashes: [e?.message || String(e)], screenshot: null };
    }
    if (!sandboxRes.success && sandboxRes.crashes && sandboxRes.crashes.length) {
        throw new Error(`Edited game failed sandbox verification: ${sandboxRes.crashes[0]}`);
    }

    // 4. Persist (success only): new HTML + re-snapshot source (new main.ts) + edit history. Original
    //    row is left untouched if anything above threw, so a bad edit can never corrupt the game.
    const updatedFiles = savedFiles.map((f) => (f.path === 'src/main.ts' ? { ...f, content: newMain } : f));
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
        const parentRes = await pool.query('SELECT prompt, raw_code, html_payload, artist_code, title, edit_history, maker_project FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");

        const parentDraft = parentRes.rows[0];

        // New-architecture (canvas-kernel) games: edit the saved source, not the compiled HTML.
        let savedProject = parentDraft.maker_project;
        if (typeof savedProject === 'string') {
            try { savedProject = JSON.parse(savedProject); } catch { savedProject = null; }
        }
        if (savedProject && Array.isArray(savedProject.files) && savedProject.files.some((f) => f.path === 'src/main.ts')) {
            return await executeMakerEditJob(newJobId, parentDraftId, parentDraft, savedProject, instructions);
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
        const classification = await classifyPublishedGame({
            title: finalTitle,
            prompt: parentDraft.prompt || '',
            description: `Edited AI game: ${instructions}`,
            htmlPayload: finalHtml,
        });
        
        await pool.query(
            `UPDATE ai_games
             SET title = $1,
                 html_payload = $2,
                 raw_code = $3,
                 artist_code = $4,
                 thumbnail = $5,
                 preview_video_url = $6,
                 edit_history = $7,
                 category = $8,
                 subcategory = $9,
                 primary_tab = $10,
                 interaction_type = $11,
                 classification_confidence = $12,
                 classification_tags = $13,
                 discovery_chips = $14
             WHERE id = $15`,
            [
                finalTitle,
                finalHtml,
                editedHtml,
                null,
                finalScreenshot,
                null,
                JSON.stringify(newHistory),
                classification.category,
                classification.subcategory,
                classification.primaryTab,
                classification.interactionType,
                classification.confidence,
                JSON.stringify(classification.tags),
                JSON.stringify(classification.discoveryChips || []),
                parentDraftId,
            ]
        );
        markEphemeralJob(newJobId, { status: 'complete', draftId: parentDraftId });
        console.log(`✅ [EDIT JOB] Edit complete for job ${newJobId} -> updated draft ${parentDraftId} (history now has ${newHistory.length} edits, ${classification.primaryTab}/${classification.category})`);

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

router.post('/narrative/chat', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        const messages = Array.isArray(req.body?.messages)
            ? req.body.messages
                .filter((message) => ['ai', 'user'].includes(message?.role) && typeof message?.text === 'string')
                .slice(-14)
                .map((message) => ({
                    role: message.role === 'ai' ? 'assistant' : 'user',
                    content: message.text.slice(0, 1200),
                }))
            : [];

        if (messages.length === 0) {
            return res.status(400).json({ error: 'Messages are required' });
        }

        const systemPrompt = [
            'You are Dream Forge AI inside GameTok.',
            'You are not a generic chatbot. Your job is to help the user shape a playable narrative game by chatting naturally.',
            'Respond like a sharp creative director: warm, concise, specific, and useful.',
            'If the user is confused, acknowledge it and ask one better question. Do not continue a rigid questionnaire.',
            'When enough detail exists, summarize what you can build and invite them to forge it.',
            'Always output JSON only with this shape:',
            '{"reply":"short chat response","brief":"complete game brief for the builder","ready":false}',
            'The brief should be a builder-ready prompt for an interactive narrative game with setting, player role, mechanics, choices, tone, and ending direction.',
        ].join('\n');

        const response = await withNvidiaRetries((_, client, providerTag) => {
            const modelToUse = resolveTextModelForProvider(DREAM_MODELS.narrativeChat, providerTag);
            return client.chat.completions.create({
                ...getTextChatOptions(modelToUse, 900, {
                    providerTag,
                    stream: false,
                    temperature: isMoonshotDirectProvider(providerTag) ? undefined : 0.55,
                }),
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages,
                ],
            });
        }, { label: 'Narrative Chat', maxAttempts: 2, baseDelayMs: 1000 });

        const raw = extractText(response);
        let parsed;
        try {
            parsed = JSON.parse(extractJson(raw));
        } catch (error) {
            parsed = {
                reply: raw || 'I’m with you. Tell me the world you want, the player role, and what should make it playable.',
                brief: '',
                ready: false,
            };
        }

        res.json({
            success: true,
            reply: String(parsed.reply || '').slice(0, 1200),
            brief: String(parsed.brief || '').slice(0, 5000),
            ready: Boolean(parsed.ready),
            model: DREAM_MODELS.narrativeChat,
        });
    } catch (error) {
        console.error('[NARRATIVE CHAT] Error:', error);
        res.status(error.statusCode || error.status || 500).json({ error: error.message || 'Narrative chat failed' });
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

        const nvidiaClient = createNvidiaTextClient();

        const fallbackSpec = buildFallbackGameSpec(prompt);
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Spec generation timed out')), 25000);
        });

        const apiCallPromise = nvidiaClient.chat.completions.create({
            model: DREAM_MODELS.narrativeChat,
            messages: [
                {
                    role: 'system',
                    content: `You are a senior mobile game designer writing the pre-create concept card for a game generation app.
Your copy must feel specific, confident, and product-quality.

${formatUnitySpecPromptBlock()}

Return ONLY valid JSON in this exact format:
{
  "title": "Catchy Title (2-3 words max)",
  "description": "1-2 polished sentences describing the specific core loop and player fantasy.",
  "features": ["Feature 1 (one short sentence)", "Feature 2 (one short sentence)"]
}

Rules:
- Title must be 2-3 words maximum
- Description must be under 240 characters
- Features must be 2-3 items, each one short sentence
- Do not use generic filler like "strategy is key", "satisfying gameplay", or "clear controls"
- Do not invent multiplayer, online play, customization, shops, campaigns, upgrades, or extra modes unless the user explicitly requested them
- Every feature must be a real implied mechanic from the prompt
- Prefer concrete verbs and systems: aim, charge, fire, land, dodge, draw, split, ricochet, survive
- Make it sound like a polished store-quality game pitch without overpromising`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.8,
            max_tokens: 250,
        });

        let response;
        try {
            response = await Promise.race([apiCallPromise, timeoutPromise]);
        } catch (error) {
            console.warn('[GENERATE SPEC] Falling back after model failure:', error?.message || error);
            return res.json({
                success: true,
                spec: fallbackSpec,
                fallback: true,
                warning: error?.message || 'Spec model unavailable',
            });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }

        const aiResponse = response.choices[0]?.message?.content || '{}';
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        let spec = fallbackSpec;
        if (jsonMatch) {
            try {
                spec = {
                    ...fallbackSpec,
                    ...JSON.parse(jsonMatch[0]),
                };
            } catch (parseError) {
                console.warn('[GENERATE SPEC] Model returned invalid JSON; using fallback spec:', parseError?.message || parseError);
            }
        }

        res.json({ 
            success: true, 
            spec
        });

    } catch (error) {
        console.error('[GENERATE SPEC] Error:', error);
        res.status(500).json({ error: error.message || 'Spec generation failed' });
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

        const nvidiaClient = createNvidiaTextClient();

        // Build conversation messages
        const messages = [
            {
                role: 'system',
                content: `You are a game design assistant helping refine a game concept through conversation.

Your job is to:
1. Analyze the conversation history and the user's latest message
2. Decide if you have enough context to proceed with building the game
3. If YES: Return ready=true with the final spec
4. If NO: Ask a clarifying question or provide a refined spec and return ready=false

Return ONLY valid JSON in this exact format:
{
  "ready": true/false,
  "spec": {
    "title": "Catchy Title (2-3 words max)",
    "description": "2-3 sentences describing core gameplay",
    "features": ["Feature 1", "Feature 2", "Feature 3"]
  },
  "question": "Your follow-up question (only if ready=false)",
  "aiMessage": "Your response to the user"
}

Rules for deciding readiness:
- If the user has provided clear gameplay mechanics, visual style, and core loop → ready=true
- If critical details are missing (genre, mechanics, goal, etc.) → ready=false, ask specific question
- If the user says "that's good" or "let's build it" → ready=true
- Keep questions focused and specific
- Update the spec with each iteration based on new info`
            },
            ...conversationHistory.map(msg => ({
                role: msg.role === 'ai' ? 'assistant' : 'user',
                content: msg.content
            })),
            {
                role: 'user',
                content: userMessage
            }
        ];

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Refinement timed out')), 25000);
        });

        const apiCallPromise = nvidiaClient.chat.completions.create({
            model: DREAM_MODELS.narrativeChat,
            messages,
            temperature: 0.7,
            max_tokens: 400,
        });

        const response = await Promise.race([apiCallPromise, timeoutPromise]);

        const aiResponse = response.choices[0]?.message?.content || '{}';
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            throw new Error('AI did not return valid JSON');
        }

        const result = JSON.parse(jsonMatch[0]);

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
        const { prompt, attachments } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const mediaAttachments = sanitizeMediaAttachments(attachments);

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets

        const existingJob = await findActiveDuplicateGenerationJob(userId, 'dream', prompt);
        if (existingJob) {
            console.log(`🧠 [DREAM ROUTE] Deduped to active job ${existingJob.id} (${existingJob.status}) for User[${userId}]`);
            return res.json({ success: true, jobId: existingJob.id, deduped: true });
        }

        console.log(`🧠 [DREAM ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        await enqueueGenerationJob({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.dreamPending,
            kind: 'dream',
            payload: { mediaAttachments },
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
            const editResult = await pool.query('SELECT title, html_payload, raw_code, thumbnail, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [targetDraftId]);
            if (editResult.rows.length === 0) {
                return res.status(404).json({ error: 'Draft not found' });
            }

            const row = editResult.rows[0];
            if (!row.html_payload || row.html_payload === '') {
                return res.json({ status: 'pending' });
            }

            return res.json({
                success: true,
                status: 'complete',
                draftId: targetDraftId,
                title: row.title,
                htmlPreview: row.html_payload,
                thumbnail: row.thumbnail,
                classification: getStoredDraftClassification(row),
            });
        }

        const result = await pool.query('SELECT title, html_payload, raw_code, thumbnail, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [jobId]);
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
        
        // If html_payload is still empty, check if it's a hard error or just pending
        if (!row.html_payload || row.html_payload === '') {
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
            // Zombie detection: generation_jobs says 'complete' but html_payload is empty.
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
            thumbnail: row.thumbnail,
            classification: getStoredDraftClassification(row),
            ...(await buildQueueProgressPayload(completeQueueJob || { progress: 100, phase: 'complete', status_message: 'Your game is ready.' }, jobId)),
        });

    } catch(e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// Retry a failed job
router.post('/dream/retry/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');

        // Get the original job details
        const jobResult = await pool.query(
            'SELECT prompt, user_id FROM ai_games WHERE id = $1',
            [jobId]
        );

        if (jobResult.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResult.rows[0];
        if (String(job.user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Not your job' });
        }

        // Create a new job with the same prompt
        const newJobId = randomUUID();
        console.log(`🔄 [RETRY] User[${userId}] retrying failed job ${jobId} as ${newJobId}`);

        await enqueueGenerationJob({
            jobId: newJobId,
            userId,
            prompt: job.prompt,
            title: JOB_TITLES.dreamPending,
            kind: 'dream',
            payload: { mediaAttachments: [] },
            allowDuplicate: true,
        });

        res.json({ success: true, jobId: newJobId });
    } catch (error) {
        console.error('[RETRY] Error:', error);
        res.status(500).json({ error: error.message || 'Retry failed' });
    }
});

router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const drafts = await pool.query("SELECT id, title, prompt, thumbnail, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE user_id = $1 AND is_draft = true AND html_payload != '' ORDER BY created_at DESC", [userId]);
        res.json({ drafts: drafts.rows });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const draft = await pool.query("SELECT id, title, prompt, html_payload, thumbnail, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userId]);
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
        const { title, privacy, html } = req.body || {};

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
                `INSERT INTO ai_games (user_id, title, html_payload, prompt, raw_code, is_draft, privacy, created_at) 
                 VALUES ($1, $2, $3, $4, $5, false, $6, NOW()) 
                 RETURNING *`,
                [userId, title?.trim() || 'Untitled Game', html, `Published from template: ${title?.trim() || 'Untitled Game'}`, html, privacy || 'public']
            );
            draft = insertRes.rows[0];
            console.log('[Publish] Game created:', draft.id);
        } else {
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

router.post('/reclassify-published', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');
        const limit = Math.min(50, Math.max(1, Number(req.body?.limit || 20)));
        const draftId = req.body?.draftId ? String(req.body.draftId) : null;

        const params = [userId];
        let whereClause = "WHERE user_id = $1 AND is_draft = false AND html_payload != ''";
        if (draftId) {
            params.push(draftId);
            whereClause += ` AND id = $${params.length}`;
        }
        params.push(limit);

        const draftsRes = await pool.query(
            `SELECT id, title, prompt, html_payload, thumbnail, preview_video_url
             FROM ai_games
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length}`,
            params
        );

        if (!draftsRes.rows.length) {
            return res.json({ success: true, updated: [], count: 0 });
        }

        const updated = [];
        for (const draft of draftsRes.rows) {
            const { globalId, classification } = await upsertPublishedAIGame({
                draftId: draft.id,
                userId,
                draft,
                forceRefreshClassification: true,
            });
            updated.push({
                draftId: draft.id,
                gameId: globalId,
                title: draft.title,
                classification,
            });
        }

        res.json({ success: true, count: updated.length, updated });
    } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/play/:targetId', async (req, res) => {
    try {
        const game = await pool.query("SELECT html_payload FROM ai_games WHERE id::text LIKE $1 LIMIT 1", [req.params.targetId + '%']);
        if (game.rows.length === 0) return res.status(404).send("AI Game Block Missing / Erased");
        res.setHeader('Content-Type', 'text/html');
        res.send(game.rows[0].html_payload);
    } catch(e) { res.status(500).send("Database extraction failed"); }
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
        let whereClause = "WHERE is_draft = false AND html_payload != ''";
        if (draftId) {
            params.push(draftId);
            whereClause += ` AND id = $${params.length}`;
        }
        params.push(limit);

        const draftsRes = await pool.query(
            `SELECT id, user_id, title, prompt, html_payload, thumbnail, preview_video_url
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

// ========================================================
// 🧪 LABS: Experimental alternate provider path
// ========================================================


async function executeLabsDreamJob(jobId, prompt, mediaAttachments = []) {
    try {
        console.log(`🧪 [LABS JOB] Started Kimi solo Labs pipeline for job: ${jobId}`);
        await updateGenerationJobProgress(jobId, 10, 'spec', 'Preparing Labs build...');
        const requested3DLane = wantsFirstPerson3D(prompt, {});
        const inferredLane = requested3DLane ? 'first_person_threejs' : inferRuntimeLaneFromPrompt(prompt);
        const labsSpecSheet = normalizeDreamSpec(
            {
                title: prompt,
                summary: prompt,
                runtimeLane: inferredLane,
            },
            prompt
        );
        // Asset bundle disabled - all visual assets generated by Artist Agent
        const assetBundle = null;
        const soloPrompt = buildLabsSoloPrototype(prompt, assetBundle, mediaAttachments);
        await updateGenerationJobProgress(jobId, 35, 'build', 'Writing Labs game code...');
        let rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
            model: DREAM_MODELS.labsBuilder,
            systemPrompt: "You are an elite solo HTML5 game creator building the full game yourself. Be practical, obey the format exactly, and prioritize a playable first frame.",
            userPrompt: soloPrompt,
            maxTokens: 12000,
            retryLabel: 'Labs Kimi Generation',
            fallbackModels: BUILDER_FALLBACK_MODELS
        }));
        await updateGenerationJobProgress(jobId, 68, 'build', 'Labs game code assembled...');

        let finalHtml = postProcessRawHtml(rawEngineHtml);
        let finalScreenshot = null;
        let maxRetries = 2;
        let stable = false;

        while (maxRetries >= 0 && !stable) {
            console.log(`🧪 [LABS JOB] Verifying solo build...`);
            await updateGenerationJobProgress(jobId, 78, 'verify', 'Testing Labs build...');
            let sandboxRes;
            try {
                validateGeneratedBuild('', rawEngineHtml, rawEngineHtml);
                validateRuntimeLaneContract(labsSpecSheet.runtimeLane, rawEngineHtml);
                validateControlRigContract(labsSpecSheet, rawEngineHtml);
                validateFirstFrameContract(labsSpecSheet, rawEngineHtml);
                sandboxRes = await verifyGame(finalHtml, { runtimeLane: labsSpecSheet.runtimeLane });
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }

            finalScreenshot = sandboxRes.screenshot || null;
            if (sandboxRes.success || !sandboxRes.crashes?.length) {
                await updateGenerationJobProgress(jobId, 88, 'verify', 'Labs build boots cleanly...');
                stable = true;
                break;
            }

            if (maxRetries === 0) {
                throw new Error(`Labs solo game failed verification: ${sandboxRes.crashes[0]}`);
            }

            console.log(`⚠️ [LABS JOB] Solo build crashed. Repairing with Kimi... (${sandboxRes.crashes[0]})`);
            await updateGenerationJobProgress(jobId, 84, 'repair', 'Repairing Labs build...');
            const repairPrompt = `The mobile HTML5 game below failed verification.
FATAL ERROR: ${sandboxRes.crashes[0]}

You must rewrite the FULL HTML document so it boots and remains playable.
Keep the same game fantasy, but prioritize a working game over ambition.
${labsSpecSheet.runtimeLane === 'first_person_threejs' ? 'This request MUST remain a true first-person 3D Three.js game with a PerspectiveCamera. Do not convert it into a top-down maze or flat 2D view. The opening frame must already show a real 3D world with floor, walls, lighting, and at least one visible landmark, enemy, or pickup.\n' : ''}
${buildControlRigRepairInstruction(labsSpecSheet.controlRig)}
${buildFirstFrameRepairInstruction(labsSpecSheet)}

BROKEN HTML:
\`\`\`html
${rawEngineHtml}
\`\`\`

Output ONLY the complete fixed HTML document.`;

            rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
                model: DREAM_MODELS.labsBuilder,
                systemPrompt: "You are an elite HTML5 game debugger repairing a single-file mobile game. Keep the fantasy, but aggressively prefer correctness and visible playability.",
                userPrompt: repairPrompt,
                maxTokens: 12000,
                retryLabel: 'Labs Kimi Repair',
                fallbackModels: BUILDER_FALLBACK_MODELS
            }));
            finalHtml = postProcessRawHtml(rawEngineHtml);
            maxRetries--;
        }

        await updateGenerationJobProgress(jobId, 94, 'save', 'Saving Labs game...');
        const gameTitle = ("🧪 " + (extractHtmlTitle(rawEngineHtml) || 'Kimi Solo Labs')).substring(0, 255);

        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [gameTitle, finalHtml, rawEngineHtml, finalScreenshot, jobId]
        );
        console.log(`✅ [LABS JOB] Complete! "${gameTitle}" saved for job ${jobId}`);
        pool.query('SELECT user_id FROM ai_games WHERE id = $1', [jobId])
            .then((ownerRes) => notifyGameReady(ownerRes.rows[0]?.user_id, jobId, gameTitle))
            .catch((error) => console.log('[Notifications] Labs ready notify error:', error));

    } catch (err) {
        console.error("❌ [LABS JOB] Error:", err);
        await markJobError(jobId, "Labs generation failed", err);
    }
}

router.post('/dream-labs', async (req, res) => {
    if (!ENABLE_LEGACY_LABS_ROUTE) {
        return res.status(410).json({
            error: 'Legacy Labs generation is disabled. Use /api/ai/dream so the native GameTok maker pipeline runs.',
            code: 'legacy_labs_disabled',
        });
    }
    try {
        const { prompt, attachments } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const mediaAttachments = sanitizeMediaAttachments(attachments);

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets

        const existingJob = await findActiveDuplicateGenerationJob(userId, 'labs', prompt);
        if (existingJob) {
            console.log(`🧪 [LABS ROUTE] Deduped to active job ${existingJob.id} (${existingJob.status}) for User[${userId}]`);
            return res.json({ success: true, jobId: existingJob.id, deduped: true });
        }

        console.log(`🧪 [LABS ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        await enqueueGenerationJob({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.labsPending,
            kind: 'labs',
            payload: { mediaAttachments },
            allowDuplicate: true,
        });

        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("LABS GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "Labs System Error" });
    }
});

generationJobRunners.set('dream', (jobId, prompt, payload = {}) => (
    executeDreamJob(jobId, prompt, payload.mediaAttachments || [], payload)
));
if (ENABLE_LEGACY_LABS_ROUTE) {
    generationJobRunners.set('labs', (jobId, prompt, payload = {}) => (
        executeLabsDreamJob(jobId, prompt, payload.mediaAttachments || [])
    ));
}

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
