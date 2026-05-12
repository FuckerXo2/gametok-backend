import express from 'express';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { buildLabsSoloPrototype, buildPhase1_Quantize, buildPhase2_BuildPrototype, buildPhase2_EditGame, buildPhase3_Repair, buildPhase3_SelfCritique, postProcessRawHtml } from './promptRegistry.js';
import { normalizeDreamSpec, wantsFirstPerson3D, inferRuntimeLaneFromPrompt } from './spec-normalizer.js';
import { verifyGame } from './sandbox.js';
import { setAssetBaseUrl, buildDreamAssetBundle, buildDreamAssetBundleWithAI, getAssetRuntimeDiagnostics } from './asset-dictionary.js';
import { notifyGameReady } from '../notifications.js';
import { deleteCoverAsset, enqueueCoverGeneration } from '../cover-art.js';
import { artistAgent, batchArtistAgent, generateGameSprites } from './sprite-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const router = express.Router();

const DEFAULT_KIMI_BUILDER_MODEL = "moonshotai/kimi-k2.6";

const DREAM_MODELS = {
    spec: process.env.DREAMSTREAM_SPEC_MODEL || DEFAULT_KIMI_BUILDER_MODEL, // Use Kimi for Phase 1 too
    premiumBuilder: process.env.DREAMSTREAM_MAIN_MODEL || DEFAULT_KIMI_BUILDER_MODEL,
    labsBuilder: process.env.DREAMSTREAM_LABS_MODEL || DEFAULT_KIMI_BUILDER_MODEL,
    narrativeChat: process.env.DREAMSTREAM_NARRATIVE_MODEL || "meta/llama-3.3-70b-instruct",
};

const BUILDER_MAX_TOKENS = Number(process.env.DREAMSTREAM_BUILDER_MAX_TOKENS || 16000);
const BUILDER_MAX_CONTINUATIONS = Number(process.env.DREAMSTREAM_BUILDER_MAX_CONTINUATIONS || 2);

const JOB_TITLES = {
    dreamPending: 'Pending Dream...',
    remixPending: 'Updating Game...',
    labsPending: '🧪 Labs: Cooking...',
};

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
    timeout: Number(process.env.NVIDIA_API_TIMEOUT_MS || 900000),
});

// OpenRouter is only used by the experimental Labs route.
const openRouterClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://gametok.app',
        'X-Title': 'DreamStream Game Engine',
    },
});

const pendingJobBoots = new Map();
const cancelledJobs = new Map();

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
}

function forgetCancelledJob(jobId) {
    cancelledJobs.delete(jobId);
}

function isJobCancelled(jobId) {
    return cancelledJobs.has(jobId) || pendingJobBoots.get(jobId)?.status === 'canceled';
}

function assertJobNotCancelled(jobId) {
    if (isJobCancelled(jobId)) {
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

async function callAI(systemPrompt, userPrompt, maxTokens = 2000, temperature = 0.3) {
    const res = await nvidiaClient.chat.completions.create({
        model: DREAM_MODELS.spec,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature
    });
    if (!res || !res.choices || !res.choices[0]) {
        throw new Error("API Provider Error (Phase 1): " + (res?.error?.message || JSON.stringify(res)));
    }
    const raw = res.choices[0].message.content;
    const extracted = extractJson(raw);
    
    try {
        return JSON.parse(extracted);
    } catch (parseError) {
        console.error('[callAI] JSON parse failed. Raw response length:', raw.length);
        console.error('[callAI] Extracted JSON length:', extracted.length);
        console.error('[callAI] Last 200 chars of extracted:', extracted.slice(-200));
        throw new Error(`JSON parse failed: ${parseError.message}. Response was likely truncated (${extracted.length} chars). Increase max_tokens.`);
    }
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

        const classificationPromise = nvidiaClient.chat.completions.create({
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

function isRetryableProviderError(error) {
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

async function withNvidiaRetries(task, { label, maxAttempts = 3, baseDelayMs = 1500 }) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`🔁 [${label}] Retry ${attempt}/${maxAttempts}...`);
            }
            return await task();
        } catch (error) {
            lastError = error;
            if (!isRetryableProviderError(error) || attempt === maxAttempts) {
                throw error;
            }
            const waitMs = baseDelayMs * attempt;
            console.warn(`⚠️ [${label}] Provider hiccup: ${error?.message || error}. Retrying in ${waitMs}ms...`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

function extractText(response) {
    return response?.choices?.[0]?.message?.content?.trim() || '';
}

function isDeepSeekV4Model(model) {
    return typeof model === 'string' && model.startsWith('deepseek-ai/deepseek-v4');
}

function getMaxTokensForModel(model, requestedMaxTokens) {
    if (isDeepSeekV4Model(model)) {
        return Math.min(Number(requestedMaxTokens || 8192), 16384);
    }
    return requestedMaxTokens;
}

function getNvidiaChatOptions(model, requestedMaxTokens) {
    const options = {
        model,
        max_tokens: getMaxTokensForModel(model, requestedMaxTokens),
        temperature: 0.25,
        stream: true,
    };

    if (isDeepSeekV4Model(model)) {
        options.reasoning_effort = process.env.DEEPSEEK_V4_REASONING_EFFORT || 'high';
    }

    return options;
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

async function requestBuilderMessage(userPrompt, { label, jobId = null } = {}) {
    assertJobNotCancelled(jobId);
    
    let finishReason = null;
    const text = await withNvidiaRetries(async () => {
        assertJobNotCancelled(jobId);
        const stream = await nvidiaClient.chat.completions.create({
            ...getNvidiaChatOptions(DREAM_MODELS.premiumBuilder, BUILDER_MAX_TOKENS),
            messages: [{ role: 'user', content: userPrompt }],
        });

        let output = "";
        for await (const chunk of stream) {
            assertJobNotCancelled(jobId);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
                output += delta;
            }
            const chunkFinishReason = chunk.choices?.[0]?.finish_reason;
            if (chunkFinishReason) {
                finishReason = chunkFinishReason;
            }
        }
        return output;
    }, { label, maxAttempts: 3, baseDelayMs: 1500 });

    return {
        text,
        stopReason: finishReason,
    };
}

async function generateCompleteHtmlWithBuilder(initialPrompt, { label, jobId = null } = {}) {
    assertJobNotCancelled(jobId);
    let { text, stopReason } = await requestBuilderMessage(initialPrompt, { label, jobId });
    assertJobNotCancelled(jobId);
    let html = normalizeHtmlDocument(text);
    console.log(`🧾 [${label}] stop_reason=${stopReason || 'unknown'} chars=${html.length}`);

    let continuationCount = 0;
    while (!hasClosedHtmlDocument(html) && continuationCount < BUILDER_MAX_CONTINUATIONS) {
        assertJobNotCancelled(jobId);
        continuationCount += 1;
        console.warn(`⚠️ [${label}] Output truncated or incomplete. Requesting continuation ${continuationCount}/${BUILDER_MAX_CONTINUATIONS}...`);
        const continuationPrompt = buildBuilderContinuationPrompt(html);
        const continuation = await requestBuilderMessage(continuationPrompt, { label: `${label} Continue`, jobId });
        assertJobNotCancelled(jobId);
        const continuationText = cleanBuilderContinuation(continuation.text);
        console.log(`🧾 [${label} Continue] stop_reason=${continuation.stopReason || 'unknown'} chars=${continuationText.length}`);
        if (!continuationText) {
            break;
        }
        html += continuationText;
    }

    return html;
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

async function streamNvidiaText({ model, systemPrompt, userPrompt, maxTokens, temperature, retryLabel }) {
    return withNvidiaRetries(async () => {
        const stream = await nvidiaClient.chat.completions.create({
            ...getNvidiaChatOptions(model, maxTokens),
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature,
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
        baseDelayMs: 1500
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
    await pool.query(
        `UPDATE ai_games SET title = $1 WHERE id = $2`,
        ['ERROR: ' + (err?.message || fallbackMessage), jobId]
    );
}

async function markJobCanceled(jobId) {
    rememberCancelledJob(jobId);
    rememberPendingBoot(jobId, { status: 'canceled', error: 'Generation cancelled by user' });
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
    const dbRes = await withTimeout(pool.query(
        `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [jobId, userId, prompt, title, '', '', true]
    ), 12000, 'Dream job creation');
    console.log(`⏱️ [AI DB] Pending job row created in ${Date.now() - startedAt}ms`);
    return dbRes.rows[0].id;
}

function queuePendingJobBootstrap({ jobId, userId, prompt, title, logLabel, run, runArgs = [] }) {
    rememberPendingBoot(jobId, { status: 'pending', userId });

    setImmediate(() => {
        void (async () => {
            try {
                assertJobNotCancelled(jobId);
                console.log(`🚀 [${logLabel}] Bootstrapping pending job ${jobId}`);
                await createPendingJob(userId, prompt, title, jobId);
                assertJobNotCancelled(jobId);
                forgetPendingBoot(jobId);
                await run(jobId, prompt, ...runArgs);
            } catch (error) {
                if (isCancellationError(error)) {
                    console.log(`🛑 [${logLabel}] Job ${jobId} was canceled before or during bootstrap.`);
                    await markJobCanceled(jobId);
                    return;
                }
                console.error(`❌ [${logLabel}] Bootstrap failed for ${jobId}:`, error);
                rememberPendingBoot(jobId, {
                    status: 'error',
                    error: error?.message || 'Job bootstrap failed',
                });
            }
        })();
    });
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

// ═══════════════════════════════════════════════════════════
// DREAMSTREAM MAIN PIPELINE
// Phase 1: Llama 3.3 on NIM extracts a playable spec
// Phase 2: Main builder model writes the entire game in one pass
// Phase 3: Puppeteer verifies the result before save
// ═══════════════════════════════════════════════════════════
async function executeDreamJob(jobId, prompt, mediaAttachments = []) {
    try {
        assertJobNotCancelled(jobId);

        console.log(`🧠 [DREAM JOB] Started DreamStream structured pipeline for job: ${jobId} using ${DREAM_MODELS.premiumBuilder}`);

        // ── PHASE 1: MINIMAL INTENT EXTRACTION ──
        console.log(`📋 Phase 1/3: ${DREAM_MODELS.spec} extracting game intent...`);
        const phase1 = buildPhase1_Quantize(prompt);
        const qualityIntent = await callAI(phase1.system, phase1.user, 3000, 0.4); // Increased from 800 to 3000 for multi-frame animation schema
        assertJobNotCancelled(jobId);
        
        console.log(`✅ Phase 1: "${qualityIntent.title}" — ${qualityIntent.userIntent}`);
        console.log(`   Tech: ${qualityIntent.technicalRequirements?.dimension || '2D'} ${qualityIntent.technicalRequirements?.perspective || 'top_down'}`);

        // ── ARTIST AGENT: Generate ALL visual assets with AI ──
        const useArtistAgent = process.env.DISABLE_ARTIST_AGENT !== 'true';
        let generatedAssets = null;
        
        if (useArtistAgent && qualityIntent.visualAssets) {
            try {
                console.log(`🎨 Artist Agent: Planning visual asset generation...`);
                
                // Build asset request list from Phase 1 plan
                const assetRequests = [];
                
                // Player
                if (qualityIntent.visualAssets.player) {
                    assetRequests.push({
                        id: 'player',
                        assetType: 'sprite',
                        description: qualityIntent.visualAssets.player.description,
                        category: 'player',
                        size: qualityIntent.visualAssets.player.size || 128,
                        transparent: qualityIntent.visualAssets.player.transparent !== false,
                    });
                }
                
                // Enemies
                if (Array.isArray(qualityIntent.visualAssets.enemies)) {
                    qualityIntent.visualAssets.enemies.forEach((enemy, idx) => {
                        assetRequests.push({
                            id: enemy.id || `enemy${idx + 1}`,
                            assetType: 'sprite',
                            description: enemy.description,
                            category: 'enemy',
                            size: enemy.size || 128,
                            transparent: enemy.transparent !== false,
                        });
                    });
                }
                
                // Items
                if (Array.isArray(qualityIntent.visualAssets.items)) {
                    qualityIntent.visualAssets.items.forEach((item, idx) => {
                        assetRequests.push({
                            id: item.id || `item${idx + 1}`,
                            assetType: 'sprite',
                            description: item.description,
                            category: 'item',
                            size: item.size || 64,
                            transparent: item.transparent !== false,
                        });
                    });
                }
                
                // Backgrounds
                if (Array.isArray(qualityIntent.visualAssets.backgrounds)) {
                    qualityIntent.visualAssets.backgrounds.forEach((bg, idx) => {
                        assetRequests.push({
                            id: bg.id || `background${idx + 1}`,
                            assetType: 'sprite',
                            description: bg.description,
                            category: 'environment',
                            size: bg.size || 512,
                            transparent: bg.transparent === true,
                        });
                    });
                }
                
                // UI elements
                if (Array.isArray(qualityIntent.visualAssets.ui)) {
                    qualityIntent.visualAssets.ui.forEach((ui, idx) => {
                        assetRequests.push({
                            id: ui.id || `ui${idx + 1}`,
                            assetType: 'sprite',
                            description: ui.description,
                            category: 'ui',
                            size: ui.size || 32,
                            transparent: ui.transparent !== false,
                        });
                    });
                }
                
                // Props
                if (Array.isArray(qualityIntent.visualAssets.props)) {
                    qualityIntent.visualAssets.props.forEach((prop, idx) => {
                        assetRequests.push({
                            id: prop.id || `prop${idx + 1}`,
                            assetType: 'sprite',
                            description: prop.description,
                            category: 'prop',
                            size: prop.size || 96,
                            transparent: prop.transparent !== false,
                        });
                    });
                }
                
                console.log(`🎨 Artist Agent: Generating ${assetRequests.length} visual assets...`);
                
                // Generate all assets
                generatedAssets = await batchArtistAgent(assetRequests);
                assertJobNotCancelled(jobId);
                
                console.log(`✅ Artist Agent: Generated ${Object.keys(generatedAssets.assets).length} custom assets`);
                if (generatedAssets.errors) {
                    console.warn(`⚠️ Artist Agent: ${generatedAssets.errors.length} assets used fallbacks`);
                }
            } catch (error) {
                console.error(`❌ Artist Agent failed:`, error.message);
                console.log(`   Falling back to procedural generation`);
                generatedAssets = null;
            }
        }

        // Legacy asset bundle (disabled by default, only used as fallback)
        const assetBundle = null; // Completely disabled
        
        assertJobNotCancelled(jobId);

        // ── PHASE 2: KIMI BUILDS THE GAME ──
        console.log(`🔨 Phase 2/3: ${DREAM_MODELS.premiumBuilder} building...`);
        
        // Build audio asset bundle from library (keep audio from library)
        const audioBundle = qualityIntent.audioNeeds ? {
            audio: [], // TODO: Select audio from library based on audioNeeds
            music: [], // TODO: Select music from library based on audioNeeds
        } : null;
        
        const buildPrompt = buildLabsSoloPrototype(prompt, qualityIntent, audioBundle, mediaAttachments, generatedAssets);
        let rawGameHtml = await generateCompleteHtmlWithBuilder(buildPrompt, { label: 'Phase 2 Build', jobId });
        assertJobNotCancelled(jobId);

        if (!rawGameHtml) {
            throw new Error('Main builder returned empty game output.');
        }
        if (!hasClosedHtmlDocument(rawGameHtml)) {
            throw new Error('Builder output is missing </html> and appears truncated.');
        }

        console.log(`✅ Phase 2 complete: builder generated ${rawGameHtml.length} chars of game code`);

        // ── POST-PROCESS: Inject Juice + Audio engines ──
        let finalHtml = postProcessRawHtml(rawGameHtml);
        let finalScreenshot = null;

        // ── PHASE 3/3: QA SANDBOX AUTO-HEALING LOOP ──
        let maxRetries = 2;
        let p3Success = false;
        
        while (maxRetries > 0 && !p3Success) {
            assertJobNotCancelled(jobId);
            console.log(`📸 [Attempt ${3 - maxRetries}/2] Verifying game in sandbox...`);
            let sandboxRes;
            try {
                const runtimeLane = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'first_person'
                    ? 'first_person_threejs'
                    : qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'third_person'
                    ? 'third_person_threejs'
                    : null;
                sandboxRes = await verifyGame(finalHtml, { runtimeLane });
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }
            finalScreenshot = sandboxRes.screenshot || null;

            if (!sandboxRes.success && sandboxRes.crashes && sandboxRes.crashes.length > 0) {
                console.log(`⚠️ Sandbox CRASH DETECTED. Asking main builder to repair... (${sandboxRes.crashes[0]})`);
                const is3DFirstPerson = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'first_person';
                const is3DThirdPerson = qualityIntent.technicalRequirements?.dimension === '3D' && qualityIntent.technicalRequirements?.perspective === 'third_person';
                
                const repairInstructions = [
                    `The mobile HTML5 game below failed verification after build.`,
                    `FATAL ERROR: ${sandboxRes.crashes[0]}`,
                    '',
                    'Repair the game so it boots and remains playable on mobile.',
                    is3DFirstPerson
                        ? 'This game MUST remain a true first-person 3D Three.js game with a PerspectiveCamera and mobile look controls. Do not downgrade it into top-down 2D.'
                        : is3DThirdPerson
                        ? 'This game MUST remain a true third-person/chase-camera 3D Three.js game with a visible player or vehicle and follow camera. Do not downgrade it into first-person, top-down, or flat 2D.'
                        : 'Preserve the intended perspective and gameplay fantasy.',
                    'If any error mentions viewport overflow, bounds, canvas sizing, or off-screen controls, rewrite the layout with responsive innerWidth/innerHeight sizing, safe-area clamped HUD, and resize recomputation. The final game must fit a 390x844 phone viewport without horizontal scrolling.',
                    `Preserve the quality target: ${qualityIntent.qualityTarget?.level || 'high'} quality with ${qualityIntent.qualityTarget?.mood || 'engaging'} mood.`,
                    `Maintain polish priorities: ${Array.isArray(qualityIntent.qualityTarget?.polishPriorities) ? qualityIntent.qualityTarget.polishPriorities.join(', ') : 'smooth animations, visual feedback'}`,
                    'Return the COMPLETE corrected HTML file only.',
                    'Do not explain anything.',
                ].join('\n');
                const repairPrompt = buildPhase2_EditGame(rawGameHtml, repairInstructions);
                rawGameHtml = await generateCompleteHtmlWithBuilder(repairPrompt, { label: 'Phase 3 Quality Repair', jobId });
                assertJobNotCancelled(jobId);
                if (!hasClosedHtmlDocument(rawGameHtml)) {
                    throw new Error('Builder repair output is missing </html> and appears truncated.');
                }
                finalHtml = postProcessRawHtml(rawGameHtml);
                maxRetries--;
            } else {
                console.log(`✅ Sandbox: Zero Crashes Detected. Game is stable!`);
                p3Success = true;
            }
        }

        if (!p3Success) {
            throw new Error('Sandbox verification failed after 2 builder repair attempts.');
        }

        // ── PHASE 3B: SELF-CRITIQUE + QUALITY IMPROVEMENT ──
        assertJobNotCancelled(jobId);
        console.log(`🔍 Phase 3B: Kimi reviewing its own output for quality...`);
        const critiquePrompt = buildPhase3_SelfCritique(prompt, rawGameHtml);
        const improvedHtml = await generateCompleteHtmlWithBuilder(critiquePrompt, { label: 'Phase 3B Self-Critique', jobId });
        assertJobNotCancelled(jobId);

        if (improvedHtml && hasClosedHtmlDocument(improvedHtml) && improvedHtml.length > rawGameHtml.length * 0.7) {
            // Verify the improved version still boots
            let improvedSandboxRes;
            try {
                improvedSandboxRes = await verifyGame(postProcessRawHtml(improvedHtml), {});
            } catch (e) {
                improvedSandboxRes = { success: false };
            }

            if (improvedSandboxRes.success) {
                console.log(`✅ Phase 3B: Improved version passes sandbox — using it`);
                rawGameHtml = improvedHtml;
                finalHtml = postProcessRawHtml(improvedHtml);
                if (improvedSandboxRes.screenshot) finalScreenshot = improvedSandboxRes.screenshot;
            } else {
                console.log(`⚠️ Phase 3B: Improved version failed sandbox — keeping original`);
            }
        } else {
            console.log(`⚠️ Phase 3B: Self-critique output invalid — keeping original`);
        }

        // ── SAVE TO DB ──
        assertJobNotCancelled(jobId);
        const finalTitle = extractHtmlTitle(rawGameHtml) || qualityIntent.title || 'DreamStream Game';
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
            await markJobCanceled(jobId);
            return;
        }
        console.error("❌ [DREAM JOB] Error:", err);
        await markJobError(jobId, "DreamStream generation failed", err);
    }
}


async function executeEditJob(newJobId, parentDraftId, instructions, mediaAttachments = []) {
    try {
        console.log(`🚀 [EDIT JOB] Starting edit job ${newJobId} based on parent ${parentDraftId}`);
        markEphemeralJob(newJobId, { status: 'pending', draftId: parentDraftId });
        
        // 1. Fetch parent draft with all context
        const parentRes = await pool.query('SELECT prompt, raw_code, html_payload, artist_code, title, edit_history FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");
        
        const parentDraft = parentRes.rows[0];
        const existingHtml = parentDraft.artist_code
            ? (parentDraft.html_payload || '')
            : (parentDraft.raw_code || parentDraft.html_payload || '');
        const editHistory = Array.isArray(parentDraft.edit_history) ? parentDraft.edit_history : [];
        const priorInstructions = editHistory.slice(-6);

        if (!existingHtml || existingHtml.length < 100) {
            throw new Error(`Parent draft has no usable code!`);
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

        const finalTitle = extractHtmlTitle(editedHtml) || parentDraft.title.replace(/^Remix of /i, '') || 'DreamStream Game';

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

        const response = await withNvidiaRetries(() => nvidiaClient.chat.completions.create({
            model: DREAM_MODELS.narrativeChat,
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages,
            ],
            max_tokens: 900,
            temperature: 0.55,
        }), { label: 'Narrative Chat', maxAttempts: 2, baseDelayMs: 1000 });

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

// === GAME SPEC GENERATION ===
router.post('/generate-spec', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        await getUserIdFromToken(token, 'Expired session');

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });

        const nvidiaClient = new OpenAI({
            apiKey: process.env.NVIDIA_API_KEY,
            baseURL: 'https://integrate.api.nvidia.com/v1',
        });

        const response = await nvidiaClient.chat.completions.create({
            model: DREAM_MODELS.narrativeChat,
            messages: [
                {
                    role: 'system',
                    content: `You are a game design assistant. Given a game idea, generate a polished game specification.

Return ONLY valid JSON in this exact format:
{
  "title": "Catchy Title (2-3 words max)",
  "description": "2-3 sentences describing core gameplay. Be concise and exciting.",
  "features": ["Feature 1 (one short sentence)", "Feature 2 (one short sentence)"]
}

Rules:
- Title must be 2-3 words maximum
- Description must be 2-3 sentences maximum (under 200 characters)
- Features must be 2-3 items, each one short sentence
- Be creative but concise
- Make it sound exciting`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.8,
            max_tokens: 250,
        });

        const aiResponse = response.choices[0]?.message?.content || '{}';
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        const spec = jsonMatch ? JSON.parse(jsonMatch[0]) : {
            title: 'Your Game',
            description: prompt.substring(0, 200),
            features: []
        };

        res.json({ 
            success: true, 
            spec
        });

    } catch (error) {
        console.error('[GENERATE SPEC] Error:', error);
        res.status(500).json({ error: error.message || 'Spec generation failed' });
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
        console.log(`🧠 [DREAM ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        queuePendingJobBootstrap({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.dreamPending,
            logLabel: 'DREAM ROUTE',
            run: executeDreamJob,
            runArgs: [mediaAttachments],
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
        const ephemeralJob = pendingJobBoots.get(jobId);
        if (ephemeralJob?.status === 'canceled' || isJobCancelled(jobId)) {
            return res.json({ success: false, status: 'canceled', error: ephemeralJob?.error || 'Generation cancelled by user' });
        }
        if (ephemeralJob?.draftId) {
            if (ephemeralJob.status === 'error') {
                return res.json({ status: 'error', error: ephemeralJob.error || 'Job failed' });
            }
            if (ephemeralJob.status !== 'complete') {
                return res.json({ status: 'pending' });
            }

            const targetDraftId = ephemeralJob.draftId;
            const editResult = await pool.query('SELECT title, html_payload, raw_code, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [targetDraftId]);
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
                classification: getStoredDraftClassification(row),
            });
        }

        const result = await pool.query('SELECT title, html_payload, raw_code, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1', [jobId]);
        if (result.rows.length === 0) {
            const pendingBoot = pendingJobBoots.get(jobId);
            if (pendingBoot?.status === 'error') {
                return res.json({ status: 'error', error: pendingBoot.error || 'Job startup failed' });
            }
            if (pendingBoot) {
                return res.json({ status: 'pending' });
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
            return res.json({ status: 'pending' });
        }
        
        // Done! Return the payload (even if it's an errorHtml payload, let the webview render it)
        return res.json({
            success: true,
            status: 'complete',
            draftId: jobId,
            title: row.title,
            htmlPreview: row.html_payload,
            classification: getStoredDraftClassification(row),
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
        const drafts = await pool.query("SELECT id, title, prompt, thumbnail, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE user_id = $1 AND is_draft = true AND html_payload != '' ORDER BY created_at DESC", [userId]);
        res.json({ drafts: drafts.rows });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const draft = await pool.query("SELECT id, title, prompt, html_payload, created_at, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userId]);
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
                await pool.query("UPDATE ai_games SET title = $1 WHERE id = $2 AND user_id = $3", [title.trim(), req.params.draftId, userId]);
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
        let rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
            model: DREAM_MODELS.labsBuilder,
            systemPrompt: "You are an elite solo HTML5 game creator building the full game yourself. Be practical, obey the format exactly, and prioritize a playable first frame.",
            userPrompt: soloPrompt,
            maxTokens: 12000,
            retryLabel: 'Labs Kimi Generation'
        }));

        let finalHtml = postProcessRawHtml(rawEngineHtml);
        let finalScreenshot = null;
        let maxRetries = 2;
        let stable = false;

        while (maxRetries >= 0 && !stable) {
            console.log(`🧪 [LABS JOB] Verifying solo build...`);
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
                stable = true;
                break;
            }

            if (maxRetries === 0) {
                throw new Error(`Labs solo game failed verification: ${sandboxRes.crashes[0]}`);
            }

            console.log(`⚠️ [LABS JOB] Solo build crashed. Repairing with Kimi... (${sandboxRes.crashes[0]})`);
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
                retryLabel: 'Labs Kimi Repair'
            }));
            finalHtml = postProcessRawHtml(rawEngineHtml);
            maxRetries--;
        }

        const gameTitle = "🧪 " + (extractHtmlTitle(rawEngineHtml) || 'Kimi Solo Labs');

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
    try {
        const { prompt, attachments } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');
        const mediaAttachments = sanitizeMediaAttachments(attachments);

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets
        console.log(`🧪 [LABS ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        queuePendingJobBootstrap({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.labsPending,
            logLabel: 'LABS ROUTE',
            run: executeLabsDreamJob,
            runArgs: [mediaAttachments],
        });

        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("LABS GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "Labs System Error" });
    }
});

// Internal exports for in-process callers (e.g., the bot engine running
// the same Dream pipeline real users go through). Keep these as the only
// non-default exports so the public surface stays intentional.
export {
    executeDreamJob,
    upsertPublishedAIGame,
    createPendingJob,
};

export default router;
