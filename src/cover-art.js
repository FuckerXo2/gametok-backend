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
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;

// --- Prompt engineering -----------------------------------------------------

const STYLE_BY_CATEGORY = {
    Action: [
        'cinematic action-game screenshot, dramatic pose, debris, rim lighting, sharp composition',
        'comic-book combat panel, bold inked shapes, explosive timing, saturated accents',
        'third-person adventure key frame, readable hero silhouette, layered environment depth',
    ],
    Adventure: [
        'hand-painted storybook world, lush environment, atmospheric lighting',
        'wide fantasy travel poster, tiny explorer, sweeping landscape scale',
        'bright 3D adventure key art, playful proportions, clear path into the world',
    ],
    Puzzle: [
        'minimalist isometric puzzle diorama, soft pastel palette, clean geometric composition',
        'tactile tabletop puzzle scene, cards and tokens, warm desk lamp, shallow depth of field',
        'graphic brain-teaser art, crisp symbols, matte colors, elegant negative space',
    ],
    Arcade: [
        'retro arcade flyer art, bold pixel-inspired shapes, vibrant CMYK palette, halftone texture',
        'toy-like mobile arcade scene, floating collectibles, clean clay render, cheerful lighting',
        'pixel-art inspired gameplay scene, chunky silhouettes, limited palette, old-school energy',
    ],
    Strategy: [
        'tabletop board-game cover art, top-down composition, painted textures, rich detail',
        'miniature battlefield diorama, strategic pieces, soft overhead light',
        'clean tactical map illustration, icons as physical tokens, readable lanes',
    ],
    Sports: [
        'energetic sports promo art, dramatic perspective, kinetic motion lines, vibrant colors',
        'stadium action still, shallow depth of field, sweat and speed',
        'graphic sports-card illustration, bold shapes, clean team-color palette',
    ],
    Casual: [
        'friendly chibi-style illustration, rounded shapes, cheerful palette, soft shadows',
        'cozy casual-game diorama, warm sunlight, charming tiny details',
        'flat playful app-store art, simple forms, candy colors, strong focal object',
    ],
    Story: [
        'graphic novel splash page, dramatic character pose, painterly lighting, cinematic mood',
        'visual novel key scene, expressive character close-up, soft background depth',
        'moody interactive-fiction cover, symbolic object foreground, atmospheric setting',
    ],
    Music: [
        'concert poster art, neon glow, equalizer waveforms, flowing rhythmic shapes',
        'rhythm-game stage scene, spotlights, speakers, musical objects in motion',
        'bold abstract sound visualizer art, pulsing shapes, crisp contrast',
    ],
    Horror: [
        'grainy psychological horror still, desaturated blue black palette, lonely hallway, uneasy negative space',
        'found-footage horror frame, dim flashlight beam, VHS noise, realistic shadows',
        'gothic survival-horror illustration, fog, candlelight, restrained crimson accents',
    ],
    Racing: [
        'low-angle racing photo-illustration, wet asphalt, motion blur, chrome reflections',
        'arcade racing splash screen, dynamic car chase, sunset road, exaggerated perspective',
        'futuristic cockpit racing scene, glowing dashboard, tunnel lights, long exposure streaks',
    ],
    Simulation: [
        'detailed isometric scene, cozy warm lighting, painterly miniature look',
        'management-game diorama, clean interface-free scene, delightful objects',
        'life-sim illustration, friendly town corner, natural light, relaxed inviting mood',
    ],
    default: [
        'distinctive mobile-game scene, clear focal subject, polished composition',
        'stylized game world snapshot, unique subject matter, readable action',
        'premium illustrated gameplay moment, bold silhouette, balanced colors',
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
 * Build a rich, descriptive prompt for FLUX.1-schnell that yields a
 * vertical mobile-game-cover-style illustration. We strip mechanic-y words
 * the model can't visualize and inject style cues based on classification.
 */
export function buildCoverPrompt({ title, prompt, classification }) {
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

    return [
        `High-end mobile game promotional poster for a game titled "${titleText}".`,
        `The exact words "${titleText}" MUST be written prominently at the very top of the image in huge, bold, glowing, 3D extruded cinematic typography.`,
        `The art style below the text should be ${styleHint}, ${mediumHint}.`,
        `${cameraHint}, featuring ${subjectLine}.`,
        tagHint ? `Visual themes: ${tagHint}.` : '',
        'Extremely vibrant, high contrast, insanely polished app-store promotional art.',
        'Portrait composition. The background should be dynamic and match the theme (e.g. voxel for minecraft-like, moody for horror, bright skies for hypercasual).',
        'Make the 3D text logo pop out with rim lighting and strong drop shadows.',
    ]
        .filter(Boolean)
        .join(' ');
}

// --- NVIDIA call ------------------------------------------------------------

/**
 * Calls FLUX.1-schnell. Returns Buffer (JPEG) or null on failure.
 * Portrait dimensions 832x1216 fit our portrait card aspect (≈11:14).
 */
async function callFluxSchnell(prompt, { width = 832, height = 1216, seed = 0, steps = 4 } = {}) {
    if (!NVIDIA_KEY) {
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
            'Authorization': `Bearer ${NVIDIA_KEY}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`FLUX ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
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
    const finalPrompt = buildCoverPrompt({ title, prompt, classification });
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
    const finalPrompt = buildCoverPrompt({ title, prompt, classification });
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
