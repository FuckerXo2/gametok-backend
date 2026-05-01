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
    Action: 'dynamic action poster, cinematic lighting, motion blur, high contrast, neon highlights',
    Adventure: 'epic fantasy book cover illustration, lush environment, atmospheric lighting',
    Puzzle: 'minimalist isometric illustration, soft pastel palette, clean geometric composition',
    Arcade: 'retro arcade flyer art, bold pixel-inspired shapes, vibrant CMYK palette, halftone texture',
    Strategy: 'tabletop board-game cover art, top-down composition, painted textures, rich detail',
    Sports: 'energetic sports promo art, dramatic perspective, kinetic motion lines, vibrant colors',
    Casual: 'friendly chibi-style illustration, rounded shapes, cheerful palette, soft shadows',
    Story: 'graphic novel splash page, dramatic character pose, painterly lighting, cinematic mood',
    Music: 'concert poster art, neon glow, equalizer waveforms, flowing rhythmic shapes',
    Horror: 'dark moody illustration, gothic palette, eerie fog, candlelight, painterly texture',
    Racing: 'motion-blurred racing cover art, low-angle shot, neon trails, cinematic speed',
    Simulation: 'detailed isometric scene, cozy warm lighting, painterly miniature look',
    default: 'vibrant illustrated mobile game cover art, dynamic composition, painterly detail, bold contrasting palette',
};

function styleForClassification(classification = {}) {
    const category = classification.category || 'default';
    return STYLE_BY_CATEGORY[category] || STYLE_BY_CATEGORY.default;
}

/**
 * Build a rich, descriptive prompt for FLUX.1-schnell that yields a
 * vertical mobile-game-cover-style illustration. We strip mechanic-y words
 * the model can't visualize and inject style cues based on classification.
 */
export function buildCoverPrompt({ title, prompt, classification }) {
    const cleanedPrompt = String(prompt || '')
        .replace(/\bhtml\b|\bcanvas\b|\bjavascript\b|\bjs\b|\bcss\b|\bgame mechanic[s]?\b|\bscoring\b|\btap to\b|\bswipe\b|\bdrag\b|\bbuttons?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 380);

    const styleHint = styleForClassification(classification);
    const tagHint = Array.isArray(classification?.tags) && classification.tags.length
        ? classification.tags.slice(0, 4).join(', ')
        : '';

    const subjectLine = cleanedPrompt;
    const moodHint = title
        ? `Inspired by the concept of ${title.replace(/[^A-Za-z0-9 \-']/g, ' ')} but never showing the name.`
        : '';

    return [
        `Mobile game key art for: ${subjectLine}.`,
        styleHint + '.',
        tagHint ? `Visual themes: ${tagHint}.` : '',
        moodHint,
        'Pure illustration. Vertical poster composition. Strong focal subject, dramatic depth, leave breathing room at the top.',
        'Absolutely NO text, NO letters, NO words, NO signage, NO captions, NO logo, NO watermark, NO UI, NO buttons, NO HUD.',
        'Environmental and character art only — like a movie poster background, no titling.',
        'Colorful, glossy, premium illustration suitable for a TikTok-style portrait game card.',
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
    
    try {
        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: `covers/${filename}`,
            Body: buffer,
            ContentType: 'image/jpeg',
        });
        
        await s3Client.send(command);
        
        // Return the public URL formatted with the R2_PUBLIC_URL from env
        const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
        return `${publicUrlBase.replace(/\/$/, '')}/covers/${filename}`;
    } catch (err) {
        console.error('[cover-art] S3/R2 upload failed:', err.message);
        // Fallback to local save if R2 fails or is misconfigured
        const fsPath = path.join(COVER_ROOT, filename);
        fs.writeFileSync(fsPath, buffer);
        return `/uploads/covers/${filename}`;
    }
}

// --- Public API -------------------------------------------------------------

/**
 * Generate a cover-art image and return its public URL, or null.
 * Tries FLUX.1-schnell first, falls back to Pollinations.
 */
export async function generateCoverArtImage({ title, prompt, classification, gameId }) {
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
            return null;
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
