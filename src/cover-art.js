/**
 * Cover art generation via NVIDIA NIM FLUX.1-schnell.
 *
 * Generates rich illustrated cover art for AI-published games.
 * Falls back gracefully to existing screenshot thumbnails when the model
 * is unavailable, rate-limited, or returns invalid output.
 *
 * Pipeline:
 *  1. Build a rich prompt from (title, original idea prompt, classification).
 *  2. POST to https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell
 *  3. Decode base64 JPEG → save to /public/uploads/covers/<gameId>.jpg
 *  4. Update ai_games.thumbnail and games.thumbnail with /uploads/covers/<gameId>.jpg
 *
 * Designed to run async / fire-and-forget so we never block publish.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { maskNvidiaKey, nextNvidiaImageApiKey } from './ai-engine/nvidia-key-pool.js';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Cloudflare R2 S3 Client
const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const COVER_ROOT = path.join(__dirname, '../public/uploads/covers');
fs.mkdirSync(COVER_ROOT, { recursive: true });

const NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

// --- Prompt engineering -----------------------------------------------------

const STYLE_BY_CATEGORY = {
    Action: [
        'EXPLOSIVE cinematic action-game screenshot, DRAMATIC hero pose, flying debris, INTENSE rim lighting, razor-sharp composition with MAXIMUM IMPACT',
        'BOLD comic-book combat panel, thick inked shapes, EXPLOSIVE energy effects, SATURATED vibrant accents, dynamic motion',
        'EPIC third-person adventure key frame, HEROIC silhouette, layered environment with DRAMATIC depth and lighting',
    ],
    Adventure: [
        'VIBRANT hand-painted storybook world, LUSH colorful environment, MAGICAL atmospheric lighting with glowing elements',
        'SWEEPING fantasy travel poster, tiny brave explorer, MAJESTIC landscape with DRAMATIC scale and depth',
        'BRIGHT cheerful 3D adventure key art, playful proportions, INVITING path with GLOWING highlights',
    ],
    Puzzle: [
        'CLEAN minimalist isometric puzzle diorama, VIBRANT pastel palette, SHARP geometric composition with glowing edges',
        'TACTILE tabletop puzzle scene, colorful cards and tokens, WARM dramatic lighting, shallow depth of field',
        'BOLD graphic brain-teaser art, CRISP glowing symbols, VIBRANT matte colors, elegant negative space',
    ],
    Arcade: [
        'RETRO arcade flyer art, BOLD pixel-inspired shapes, ELECTRIC CMYK palette, halftone texture, NEON glow effects',
        'PLAYFUL toy-like mobile arcade scene, SHINY floating collectibles, VIBRANT clay render, CHEERFUL dramatic lighting',
        'PUNCHY pixel-art inspired gameplay scene, CHUNKY silhouettes, SATURATED limited palette, HIGH-ENERGY composition',
    ],
    Strategy: [
        'PREMIUM tabletop board-game cover art, DRAMATIC top-down composition, RICH painted textures, DETAILED miniatures',
        'EPIC miniature battlefield diorama, COLORFUL strategic pieces, CINEMATIC overhead lighting with shadows',
        'CLEAN tactical map illustration, GLOWING icons as physical tokens, VIBRANT readable lanes with depth',
    ],
    Sports: [
        'ENERGETIC sports promo art, EXTREME perspective, DYNAMIC motion lines, ELECTRIC vibrant colors, INTENSE action',
        'DRAMATIC stadium action still, shallow depth of field, GLISTENING sweat and EXPLOSIVE speed effects',
        'BOLD graphic sports-card illustration, PUNCHY shapes, VIBRANT team-color palette with GLOWING highlights',
    ],
    Casual: [
        'ADORABLE friendly chibi-style illustration, ROUNDED shapes, CHEERFUL vibrant palette, SOFT dramatic shadows',
        'COZY casual-game diorama, WARM golden sunlight, CHARMING tiny details, INVITING atmosphere',
        'FLAT playful app-store art, SIMPLE bold forms, CANDY-BRIGHT colors, STRONG focal object with glow',
    ],
    Story: [
        'DRAMATIC graphic novel splash page, INTENSE character pose, PAINTERLY cinematic lighting, MOODY atmosphere',
        'EXPRESSIVE visual novel key scene, EMOTIONAL character close-up, SOFT atmospheric background depth',
        'MOODY interactive-fiction cover, SYMBOLIC glowing object foreground, ATMOSPHERIC dramatic setting',
    ],
    Music: [
        'ELECTRIC concert poster art, VIBRANT neon glow, PULSING equalizer waveforms, FLOWING rhythmic shapes',
        'DYNAMIC rhythm-game stage scene, DRAMATIC spotlights, GLOWING speakers, musical objects in ENERGETIC motion',
        'BOLD abstract sound visualizer art, PULSING vibrant shapes, MAXIMUM contrast with neon accents',
    ],
    Horror: [
        'EERIE grainy psychological horror still, DRAMATIC desaturated palette, LONELY hallway, UNSETTLING negative space with fog',
        'INTENSE found-footage horror frame, DIM flashlight beam cutting through darkness, VHS noise, REALISTIC dramatic shadows',
        'GOTHIC survival-horror illustration, THICK fog, FLICKERING candlelight, RESTRAINED crimson accents, OMINOUS atmosphere',
    ],
    Racing: [
        'INTENSE low-angle racing photo-illustration, WET reflective asphalt, DRAMATIC motion blur, GLEAMING chrome reflections',
        'HIGH-OCTANE arcade racing splash screen, DYNAMIC car chase, VIBRANT sunset road, EXAGGERATED dramatic perspective',
        'FUTURISTIC cockpit racing scene, GLOWING neon dashboard, STREAKING tunnel lights, ELECTRIC long exposure effects',
    ],
    Simulation: [
        'DETAILED isometric scene, COZY warm dramatic lighting, PAINTERLY miniature look with VIBRANT colors',
        'CHARMING management-game diorama, CLEAN interface-free scene, DELIGHTFUL colorful objects with soft glow',
        'INVITING life-sim illustration, FRIENDLY town corner, NATURAL golden-hour light, RELAXED welcoming mood',
    ],
    default: [
        'DISTINCTIVE mobile-game scene, CLEAR focal subject with DRAMATIC lighting, POLISHED premium composition',
        'STYLIZED game world snapshot, UNIQUE subject matter, READABLE action with VIBRANT colors and depth',
        'PREMIUM illustrated gameplay moment, BOLD heroic silhouette, BALANCED saturated colors with glow effects',
    ],
};

function hashSeed(value) {
    let hash = 2166136261;
    const text = String(value || 'gametok-cover');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
}

function pick(items, seed) {
    return items[Math.abs(seed) % items.length];
}

function styleForClassification(classification = {}, seed = 0) {
    const category = classification.category || 'default';
    const styles = STYLE_BY_CATEGORY[category] || STYLE_BY_CATEGORY.default;
    return pick(styles, seed);
}

/**
 * Use AI to analyze the game and generate a truly adaptive thumbnail prompt.
 * This creates a unique, custom prompt for each game based on its specific characteristics.
 */
async function generateAdaptiveThumbnailPrompt({ title, prompt, classification }) {
    const titleText = title ? title.replace(/[^A-Za-z0-9 \-']/g, '') : 'PLAY NOW';
    const cleanedPrompt = String(prompt || '')
        .replace(/\bhtml\b|\bcanvas\b|\bjavascript\b|\bjs\b|\bcss\b|\bgame mechanic[s]?\b|\bscoring\b|\btap to\b|\bswipe\b|\bdrag\b|\bbuttons?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const analysisPrompt = `You are an expert at creating mobile game promotional art prompts for AI image generators.

Analyze this game and create a detailed, specific prompt for generating its thumbnail:

Game Title: ${titleText}
Game Description: ${cleanedPrompt}
Category: ${classification?.category || 'unknown'}
Subcategory: ${classification?.subcategory || 'none'}
Tags: ${classification?.tags?.join(', ') || 'none'}

Based on this game's unique characteristics, create a detailed image generation prompt that includes:
1. How the title text should appear (style, effects, mood-appropriate typography)
2. The specific art style that matches this game's theme and mechanics
3. The composition, camera angle, and focal points
4. Color palette and lighting that fits the mood
5. Specific visual elements that represent the game's core concept
6. The overall aesthetic intensity and appeal

Make it vibrant, eye-catching, and perfectly matched to THIS specific game. The prompt should be 150-250 words and create a portrait-oriented mobile game promotional poster.

Return ONLY the image generation prompt, no explanations or meta-commentary.`;

    try {
        // Use the same Llama model that Phase 1 uses for consistency
        const nvidiaClient = await import('openai').then(m => m.default);
        const client = new nvidiaClient({
            baseURL: 'https://integrate.api.nvidia.com/v1',
            apiKey: process.env.NVIDIA_API_KEY,
        });

        const response = await client.chat.completions.create({
            model: 'meta/llama-3.3-70b-instruct',
            messages: [{ role: 'user', content: analysisPrompt }],
            temperature: 0.8,
            max_tokens: 500,
        });

        const generatedPrompt = response.choices[0]?.message?.content?.trim();

        if (generatedPrompt && generatedPrompt.length > 50) {
            console.log(`[cover-art] Generated adaptive prompt for "${titleText}"`);
            return generatedPrompt;
        }

        throw new Error('Generated prompt too short or empty');
    } catch (error) {
        console.warn(`[cover-art] AI prompt generation failed: ${error.message}, falling back to template`);
        return buildFallbackPrompt({ title, prompt, classification });
    }
}

/**
 * Fallback prompt builder using the enhanced template system.
 * Used when AI prompt generation fails.
 */
function buildFallbackPrompt({ title, prompt, classification }) {
    const seed = hashSeed(`${title || ''} ${prompt || ''} ${classification?.category || ''} ${classification?.subcategory || ''}`);
    const cleanedPrompt = String(prompt || '')
        .replace(/\bhtml\b|\bcanvas\b|\bjavascript\b|\bjs\b|\bcss\b|\bgame mechanic[s]?\b|\bscoring\b|\btap to\b|\bswipe\b|\bdrag\b|\bbuttons?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 380);

    const styleHint = styleForClassification(classification, seed);
    const mediumHint = pick([
        'cinematic 3D key art',
        'flat graphic poster illustration',
        'pixel-art inspired scene',
        'clay-render mobile-game diorama',
        'hand-painted storybook illustration',
        'anime key visual',
        'realistic atmospheric still',
        'clean isometric game-board art',
    ], Math.floor(seed / 3));
    const cameraHint = pick([
        'close-up composition',
        'wide establishing composition',
        'top-down readable composition',
        'low-angle dramatic composition',
        'centered character-and-environment composition',
    ], Math.floor(seed / 7));
    const tagHint = Array.isArray(classification?.tags) && classification.tags.length
        ? classification.tags.slice(0, 4).join(', ')
        : '';

    const subjectLine = cleanedPrompt;
    const titleText = title ? title.replace(/[^A-Za-z0-9 \-']/g, '') : 'PLAY NOW';

    const textStyle = (() => {
        const cat = classification?.category || 'default';
        if (['Casual', 'Puzzle'].includes(cat)) return 'clean, bold, friendly typography with soft glow';
        if (['Action', 'Racing', 'Sports'].includes(cat)) return 'bold, dynamic 3D typography with dramatic lighting';
        if (['Horror', 'Story'].includes(cat)) return 'atmospheric, stylized typography';
        if (['Arcade', 'Music'].includes(cat)) return 'vibrant, neon-style bold typography';
        return 'bold, polished typography with subtle depth';
    })();

    const intensityLevel = (() => {
        const cat = classification?.category || 'default';
        if (['Casual', 'Puzzle', 'Simulation'].includes(cat)) return 'vibrant, inviting, polished';
        if (['Action', 'Racing', 'Sports'].includes(cat)) return 'EXPLOSIVE, INTENSE, DRAMATIC';
        if (['Horror'].includes(cat)) return 'atmospheric, moody, unsettling';
        return 'vibrant, eye-catching, premium';
    })();

    return [
        `High-end mobile game promotional poster for "${titleText}".`,
        `Title displayed at top in ${textStyle}.`,
        `Art style: ${styleHint}, ${mediumHint}.`,
        `${cameraHint}, featuring ${subjectLine}.`,
        tagHint ? `Themes: ${tagHint}.` : '',
        `Aesthetic: ${intensityLevel}, professional app-store quality.`,
        'Portrait composition, eye-catching, clear focal point.',
    ].filter(Boolean).join(' ');
}

/**
 * Build a rich, descriptive prompt for FLUX.1-schnell.
 * Now uses AI to generate truly adaptive prompts.
 */
export async function buildCoverPrompt({ title, prompt, classification }) {
    return await generateAdaptiveThumbnailPrompt({ title, prompt, classification });
}

// --- NVIDIA call ------------------------------------------------------------

/**
 * Calls FLUX.1-schnell. Returns Buffer (JPEG) or null on failure.
 * Portrait dimensions 832x1216 fit our portrait card aspect (≈11:14).
 */
async function callFluxSchnell(prompt, { width = 832, height = 1216, seed = 0, steps = 4 } = {}) {
    const nvidiaKey = nextNvidiaImageApiKey();
    if (!nvidiaKey) {
        throw new Error('NVIDIA_API_KEY is not configured');
    }

    const body = {
        prompt,
        width,
        height,
        cfg_scale: 0,
        mode: 'base',
        samples: 1,
        seed: seed || Math.floor(Math.random() * 4_000_000_000),
        steps,
    };

    const res = await fetch(NVIDIA_FLUX_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${nvidiaKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`FLUX ${res.status} ${res.statusText} (${maskNvidiaKey(nvidiaKey)}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const artifact = json?.artifacts?.[0];
    if (!artifact || artifact.finishReason !== 'SUCCESS' || !artifact.base64) {
        throw new Error(`FLUX returned non-success artifact (finishReason=${artifact?.finishReason || 'missing'})`);
    }
    return Buffer.from(artifact.base64, 'base64');
}

// --- Pollinations fallback --------------------------------------------------

async function callPollinationsFallback(prompt) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=832&height=1216&nologo=true&enhance=true&model=flux`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Pollinations ${res.status} ${res.statusText}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
}

// --- Saving -----------------------------------------------------------------

async function saveCoverBuffer(gameId, buffer) {
    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const filename = `${safeId}.jpg`;
    
    // Only try R2 if properly configured
    if (process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
        try {
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `covers/${filename}`,
                Body: buffer,
                ContentType: 'image/jpeg',
            });
            
            await s3Client.send(command);
            
            const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
            return `${publicUrlBase.replace(/\/$/, '')}/covers/${filename}`;
        } catch (err) {
            console.error('[cover-art] S3/R2 upload failed:', err.message);
        }
    }

    // No R2? Use a Pollinations URL directly (survives Railway redeploys)
    console.warn('[cover-art] R2 not configured, returning Pollinations URL instead of saving locally');
    return null; // Signal caller to use Pollinations URL
}

// --- Public API -------------------------------------------------------------

/**
 * Build a permanent Pollinations URL for a game (no download needed).
 */
function buildPollinationsUrl({ title, prompt, classification, gameId }) {
    // Use fallback for Pollinations URL (synchronous)
    const finalPrompt = buildFallbackPrompt({ title, prompt, classification });
    const seed = hashSeed(`${gameId || ''} ${title || ''}`);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=512&height=768&nologo=true&enhance=true&model=flux&seed=${seed}`;
}

/**
 * Generate a cover-art image and return its public URL, or null.
 * Tries FLUX.1-schnell → R2 first. If R2 isn't configured, returns a
 * permanent Pollinations URL (no local disk needed).
 */
export async function generateCoverArtImage({ title, prompt, classification, gameId }) {
    // Fast path: if R2 isn't configured, skip downloading entirely
    // and just return a Pollinations URL that the frontend can load directly
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
        return buildPollinationsUrl({ title, prompt, classification, gameId });
    }

    // R2 is configured — try to generate and upload a real image
    const finalPrompt = await buildCoverPrompt({ title, prompt, classification });
    let buffer;
    try {
        buffer = await callFluxSchnell(finalPrompt);
    } catch (err) {
        console.warn('[cover-art] FLUX failed:', err.message);
        try {
            buffer = await callPollinationsFallback(finalPrompt);
        } catch (err2) {
            console.warn('[cover-art] Pollinations fallback failed:', err2.message);
            // Even if download fails, return a URL the frontend can load
            return buildPollinationsUrl({ title, prompt, classification, gameId });
        }
    }

    if (!buffer || buffer.length < 1024) {
        console.warn('[cover-art] empty/too-small buffer, using Pollinations URL');
        return buildPollinationsUrl({ title, prompt, classification, gameId });
    }

    const savedUrl = await saveCoverBuffer(gameId, buffer);
    // If R2 save failed (returned null), use Pollinations URL
    return savedUrl || buildPollinationsUrl({ title, prompt, classification, gameId });
}

/**
 * Generate cover art and persist it to ai_games.thumbnail and games.thumbnail.
 * Caller passes a shared pool to avoid rebuilding connections.
 * gameId is the global games.id (e.g. "gm-ai-xxxx"), draftId is ai_games.id.
 */
export async function generateAndApplyCover(pool, { draftId, gameId, title, prompt, classification }) {
    if (!draftId) {
        console.warn('[cover-art] no draftId provided, skipping');
        return null;
    }

    const url = await generateCoverArtImage({ title, prompt, classification, gameId: gameId || draftId });
    if (!url) return null;

    try {
        await pool.query('UPDATE ai_games SET thumbnail = $1 WHERE id = $2', [url, draftId]);
        if (gameId) {
            await pool.query('UPDATE games SET thumbnail = $1 WHERE id = $2', [url, gameId]);
        }
    } catch (err) {
        console.warn('[cover-art] DB update failed:', err.message);
    }

    console.log(`[cover-art] ✓ saved ${url} (draft=${draftId})`);
    return url;
}

export async function deleteCoverAsset(url) {
    if (!url || typeof url !== 'string' || url.startsWith('data:')) return false;

    let pathname = url;
    try {
        pathname = new URL(url).pathname;
    } catch {
        pathname = url;
    }

    const filename = path.basename(pathname);
    if (!filename || filename === '.' || filename === '/') return false;

    const isGeneratedCover = pathname.includes('/uploads/covers/') || pathname.includes('/covers/');
    if (!isGeneratedCover) return false;

    let deleted = false;
    const localPath = path.join(COVER_ROOT, filename);
    try {
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            deleted = true;
        }
    } catch (err) {
        console.warn('[cover-art] local cover delete failed:', err.message);
    }

    if (process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
        try {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `covers/${filename}`,
            }));
            deleted = true;
        } catch (err) {
            console.warn('[cover-art] R2 cover delete failed:', err.message);
        }
    }

    return deleted;
}

// --- Fire-and-forget queue --------------------------------------------------

const COVER_CONCURRENCY = Number(process.env.COVER_ART_CONCURRENCY || 2);
let activeJobs = 0;
const pendingQueue = [];

function drainQueue() {
    while (activeJobs < COVER_CONCURRENCY && pendingQueue.length > 0) {
        const job = pendingQueue.shift();
        activeJobs += 1;
        Promise.resolve()
            .then(() => job.run())
            .catch((err) => console.warn('[cover-art] job failed:', err.message))
            .finally(() => {
                activeJobs -= 1;
                drainQueue();
            });
    }
}

/**
 * Schedule a cover-art generation in the background. Never throws, never blocks.
 */
export function enqueueCoverGeneration(pool, params) {
    if (process.env.DISABLE_COVER_ART === '1') return;
    pendingQueue.push({
        run: () => generateAndApplyCover(pool, params),
    });
    drainQueue();
}

export const coverArtInternals = {
    buildCoverPrompt,
    callFluxSchnell,
    callPollinationsFallback,
    saveCoverBuffer,
    COVER_ROOT,
};
