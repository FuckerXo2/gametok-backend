/**
 * Cover art generation pipeline.
 *
 * Primary:   OpenAI gpt-image-1 (paid, reliable) → R2
 * Fallback1: Hugging Face Inference API SDXL (free, limited credits) → R2
 * Fallback2: Stable Horde (free, community GPU, slow) → R2
 *
 * Designed to run async / fire-and-forget so we never block publish.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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

const STABLE_HORDE_URL = 'https://stablehorde.net/api/v2/generate/async';
const STABLE_HORDE_APIKEY = process.env.STABLE_HORDE_APIKEY || '0000000000'; // anonymous key works
const HF_MODEL_URL = 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers';

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
1. The specific art style that matches this game's theme and mechanics
2. The composition, camera angle, and focal points
3. Color palette and lighting that fits the mood
4. Specific visual elements that represent the game's core concept
5. The overall aesthetic intensity and appeal

Make it vibrant, eye-catching, and perfectly matched to THIS specific game. The prompt should be 150-250 words and create a portrait-oriented mobile game promotional poster.

CRITICAL: Include the game title "${titleText}" rendered directly in the artwork as bold, professional key-art typography (like a real app store poster) — clean, legible, well-composed with the scene, not cluttered. Specify where the title sits (top, bottom, or integrated into the scene) and its style (font weight, color, glow/shadow) so it looks intentional, not slapped on.

Return ONLY the image generation prompt, no explanations or meta-commentary.`;

    try {
        const OpenAI = await import('openai').then(m => m.default);
        const client = new OpenAI({
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: process.env.DEEPSEEK_API_KEY,
        });

        const response = await client.chat.completions.create({
            model: 'deepseek-chat',
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
        `High-end mobile game key art illustration for a game called "${titleText}".`,
        `Art style: ${styleHint}, ${mediumHint}.`,
        `${cameraHint}, featuring ${subjectLine}.`,
        tagHint ? `Themes: ${tagHint}.` : '',
        `Aesthetic: ${intensityLevel}, professional app-store quality.`,
        'Portrait composition, eye-catching, clear focal point.',
        `Title "${titleText}" rendered in the artwork as ${textStyle}, positioned like real app store key art — legible, well-integrated, not cluttered.`,
    ].filter(Boolean).join(' ');
}

/**
 * Build a rich, descriptive prompt for image generation.
 * Uses AI (gpt-4o-mini) to generate truly adaptive prompts.
 */
export async function buildCoverPrompt({ title, prompt, classification }) {
    return await generateAdaptiveThumbnailPrompt({ title, prompt, classification });
}

// --- Stable Horde (fallback, free) -------------------------------------------

// Anonymous Stable Horde keys are capped at ~576x576 and rate-limited to
// a couple of submissions per second — stay under both.
async function callStableHorde(prompt, { width = 448, height = 576 } = {}) {
    // Small jitter to avoid tripping the "2 per 1 second" anon rate limit
    // when several jobs fall back to Horde at once.
    await new Promise(r => setTimeout(r, 400 + Math.random() * 800));

    // Submit job
    const submitRes = await fetch(STABLE_HORDE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': STABLE_HORDE_APIKEY,
            'Client-Agent': 'gametok:1.0:gametok.co',
        },
        body: JSON.stringify({
            prompt,
            params: {
                width,
                height,
                steps: 25,
                cfg_scale: 7,
                sampler_name: 'k_euler_a',
                karras: true,
            },
            models: ['stable_diffusion_xl'],
            r2: false,
            nsfw: false,
            censor_nsfw: true,
        }),
    });

    if (!submitRes.ok) {
        const t = await submitRes.text().catch(() => '');
        throw new Error(`StableHorde submit ${submitRes.status}: ${t.slice(0, 200)}`);
    }

    const { id } = await submitRes.json();
    if (!id) throw new Error('StableHorde: no job id returned');

    // Poll until done (max 3 minutes)
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000));
        const checkRes = await fetch(`https://stablehorde.net/api/v2/generate/check/${id}`, {
            headers: { 'apikey': STABLE_HORDE_APIKEY },
        });
        if (!checkRes.ok) continue;
        const check = await checkRes.json();
        if (!check.done) continue;

        const statusRes = await fetch(`https://stablehorde.net/api/v2/generate/status/${id}`, {
            headers: { 'apikey': STABLE_HORDE_APIKEY },
        });
        if (!statusRes.ok) throw new Error(`StableHorde status ${statusRes.status}`);
        const status = await statusRes.json();
        const gen = status?.generations?.[0];
        if (!gen?.img) throw new Error('StableHorde: no image in result');

        // img is a URL to the generated image
        const imgRes = await fetch(gen.img);
        if (!imgRes.ok) throw new Error(`StableHorde image fetch ${imgRes.status}`);
        const arr = await imgRes.arrayBuffer();
        return Buffer.from(arr);
    }

    throw new Error('StableHorde: timed out after 3 minutes');
}

// --- Hugging Face SDXL (primary, free) --------------------------------------

async function callHuggingFace(prompt) {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.HF_TOKEN) headers['Authorization'] = `Bearer ${process.env.HF_TOKEN}`;

    const res = await fetch(HF_MODEL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            inputs: prompt,
            parameters: { width: 832, height: 1216 },
        }),
    });

    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HuggingFace ${res.status}: ${t.slice(0, 200)}`);
    }

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
}

// --- OpenAI gpt-image-1 (paid fallback) -------------------------------------

// Org tier caps gpt-image-1 at ~5 images/min — retry on 429 instead of
// immediately falling through to the unreliable free providers.
async function callOpenAiImage(prompt, { retries = 3 } = {}) {
    const OpenAI = await import('openai').then(m => m.default);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await client.images.generate({
                model: 'gpt-image-1',
                prompt,
                size: '1024x1536',
                quality: 'low',
                // Default is PNG (~1.9MB). JPEG keeps the download small;
                // saveCoverBuffer still resizes/re-encodes before upload.
                output_format: 'jpeg',
                output_compression: 85,
            });

            const b64 = response?.data?.[0]?.b64_json;
            if (!b64) throw new Error('OpenAI: no image data returned');
            return Buffer.from(b64, 'base64');
        } catch (err) {
            const isRateLimit = err?.status === 429 || /rate limit/i.test(err?.message || '');
            if (!isRateLimit || attempt === retries) throw err;

            const waitMatch = /try again in (\d+(?:\.\d+)?)s/i.exec(err?.message || '');
            const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500 : 15000;
            console.warn(`[cover-art] OpenAI rate-limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
}

// --- Saving -----------------------------------------------------------------

// Covers are displayed at most ~360px wide (feed poster); 720px keeps a
// retina-sharp image at a fraction of the bytes.
const COVER_MAX_WIDTH = 720;
const COVER_MAX_HEIGHT = 1080;
const COVER_QUALITY = 82;

/**
 * Normalise any provider's output to a real, right-sized JPEG.
 *
 * gpt-image-1 returns ~1.9MB PNGs; those were being uploaded raw under a
 * .jpg name with an image/jpeg content-type, so the feed was pulling
 * ~2MB per card. Re-encoding here fixes every provider at once.
 */
export async function compressCoverBuffer(buffer) {
    try {
        const sharp = await import('sharp').then(m => m.default);
        return await sharp(buffer)
            .rotate()
            .resize(COVER_MAX_WIDTH, COVER_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: COVER_QUALITY, mozjpeg: true })
            .toBuffer();
    } catch (err) {
        console.warn('[cover-art] compression failed, storing original:', err.message);
        return buffer;
    }
}

async function saveCoverBuffer(gameId, buffer) {
    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const filename = `${safeId}.jpg`;

    const body = await compressCoverBuffer(buffer);

    // Only try R2 if properly configured
    if (process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
        try {
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `covers/${filename}`,
                Body: body,
                ContentType: 'image/jpeg',
                CacheControl: 'public, max-age=31536000',
            });
            
            await s3Client.send(command);
            
            const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
            return `${publicUrlBase.replace(/\/$/, '')}/covers/${filename}`;
        } catch (err) {
            console.error('[cover-art] S3/R2 upload failed:', err.message);
        }
    }

    console.warn('[cover-art] R2 not configured — cover art requires R2');
    return null;
}

// --- Public API -------------------------------------------------------------

/**
 * Generate a cover-art image and return its R2 public URL, or null.
 * Pipeline: OpenAI gpt-image-1 (paid, reliable) → Hugging Face SDXL → Stable Horde.
 * Requires R2 to be configured — returns null otherwise.
 */
export async function generateCoverArtImage({ title, prompt, classification, gameId }) {
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
        console.warn('[cover-art] R2 not configured — skipping cover art');
        return null;
    }

    const finalPrompt = await buildCoverPrompt({ title, prompt, classification });
    let buffer;

    try {
        console.log('[cover-art] Trying OpenAI gpt-image-1...');
        buffer = await callOpenAiImage(finalPrompt);
    } catch (err) {
        console.warn('[cover-art] OpenAI failed:', err.message);
        try {
            console.log('[cover-art] Trying Hugging Face SDXL...');
            buffer = await callHuggingFace(finalPrompt);
        } catch (err2) {
            console.warn('[cover-art] Hugging Face failed:', err2.message);
            try {
                console.log('[cover-art] Trying Stable Horde...');
                buffer = await callStableHorde(finalPrompt);
            } catch (err3) {
                console.warn('[cover-art] Stable Horde failed:', err3.message);
                return null;
            }
        }
    }

    if (!buffer || buffer.length < 1024) {
        console.warn('[cover-art] empty/too-small buffer, skipping');
        return null;
    }

    return await saveCoverBuffer(gameId, buffer);
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

/**
 * Re-encode an already-uploaded cover in place (same key, same URL).
 * Used to shrink the ~1.9MB PNGs that were stored before compression
 * was added. Returns { before, after } byte counts, or null if skipped.
 */
export async function recompressCoverByUrl(url) {
    if (!url || !url.includes('/covers/')) return null;
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) return null;

    const filename = path.basename(new URL(url).pathname);
    if (!filename) return null;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const original = Buffer.from(await res.arrayBuffer());

    const compressed = await compressCoverBuffer(original);
    // Already small enough — don't churn the object for nothing.
    if (compressed.length >= original.length) return { before: original.length, after: original.length, skipped: true };

    await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: `covers/${filename}`,
        Body: compressed,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
    }));

    return { before: original.length, after: compressed.length };
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
    callStableHorde,
    callHuggingFace,
    callOpenAiImage,
    saveCoverBuffer,
    COVER_ROOT,
};
