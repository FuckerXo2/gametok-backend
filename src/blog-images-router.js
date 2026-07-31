// Blog imagery — generate from a prompt, or upload a real file.
//
// Both paths end at the same place: a compressed JPEG in R2 under `blog/`, returning a public URL
// the post editor drops into markdown or the cover field.
//
// Two deliberate differences from game cover art:
//   1. The prompt is passed through verbatim. The cover-art path runs prompts through an LLM that
//      rewrites them into a game poster and burns the title into the artwork — correct for a game
//      tile, wrong for an article image.
//   2. Landscape. gpt-image-1 has no true 16:9, so we ask for 1536x1024 and crop with sharp.
//
// Uploads go to R2, NOT the /api/assets/upload router — that writes to local disk, which is
// ephemeral on Railway and would lose every image on redeploy.
//
// Mounted under /api/admin, so requireAdmin already applies.

import express from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import pool from './db.js';
import { generateCoverArtImage, compressCoverBuffer, coverArtInternals } from './cover-art.js';

const router = express.Router();

// In-memory: files go straight to R2, never to disk.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
});

/** Nothing in the cover-art pipeline counts spend, so the ceiling lives here. */
const DAILY_LIMIT = Number(process.env.BLOG_IMAGE_DAILY_LIMIT || 40);

const ASPECTS = {
    // 16:9 hero. gpt-image-1's closest native size is 1536x1024; sharp crops the rest.
    wide: { openAiSize: '1536x1024', hfSize: { width: 1216, height: 704 }, hordeSize: { width: 640, height: 384 }, maxWidth: 1536, maxHeight: 864 },
    // 3:2 inline figure.
    inline: { openAiSize: '1536x1024', hfSize: { width: 1216, height: 832 }, hordeSize: { width: 640, height: 448 }, maxWidth: 1200, maxHeight: 800 },
    square: { openAiSize: '1024x1024', hfSize: { width: 1024, height: 1024 }, hordeSize: { width: 512, height: 512 }, maxWidth: 1000, maxHeight: 1000 },
};

/**
 * Editorial framing, not game key art. Notably: no instruction to render text,
 * because a headline baked into a hero image can't be edited or translated.
 */
function buildBlogImagePrompt(userPrompt) {
    return [
        'Editorial illustration for a technology article.',
        String(userPrompt || '').trim(),
        'Cinematic lighting, rich colour, clean composition with a clear focal point.',
        'Wide landscape framing with room around the subject.',
        'Absolutely no text, no words, no letters, no numbers, no logos, no watermarks, and no user-interface elements anywhere in the image.',
    ].filter(Boolean).join(' ');
}

async function generationsToday() {
    const res = await pool.query(
        "SELECT COUNT(*)::int AS c FROM blog_image_generations WHERE created_at >= NOW() - INTERVAL '24 hours'",
    );
    return res.rows[0].c;
}

router.get('/usage', async (_req, res) => {
    try {
        const used = await generationsToday();
        res.json({ used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/generate', async (req, res) => {
    try {
        const prompt = String(req.body?.prompt || '').trim();
        if (!prompt) return res.status(400).json({ error: 'prompt is required' });

        const aspect = ASPECTS[req.body?.aspect] ? req.body.aspect : 'wide';
        const spec = ASPECTS[aspect];

        const used = await generationsToday();
        if (used >= DAILY_LIMIT) {
            return res.status(429).json({
                error: `Daily image generation limit reached (${used}/${DAILY_LIMIT}). Upload an image instead, or try tomorrow.`,
            });
        }

        const result = await generateCoverArtImage({
            rawPrompt: buildBlogImagePrompt(prompt),
            gameId: `blog-${Date.now()}`,
            prefix: 'blog',
            unique: true,
            openAiSize: spec.openAiSize,
            hfSize: spec.hfSize,
            hordeSize: spec.hordeSize,
            // 'cover' crops to the exact aspect; the default 'inside' would
            // letterbox and leave the hero the wrong shape.
            compress: { maxWidth: spec.maxWidth, maxHeight: spec.maxHeight, quality: 84, fit: 'cover' },
        });

        if (!result?.url) {
            return res.status(502).json({ error: 'All image providers failed. Try again, or upload an image.' });
        }

        await pool.query(
            'INSERT INTO blog_image_generations (prompt, url, provider) VALUES ($1, $2, $3)',
            [prompt.slice(0, 2000), result.url, result.provider],
        );

        res.json({ url: result.url, provider: result.provider, aspect, used: used + 1, limit: DAILY_LIMIT });
    } catch (e) {
        console.error('[blog-images] generate failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!/^image\//.test(req.file.mimetype || '')) {
            return res.status(400).json({ error: 'That file is not an image' });
        }
        if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
            return res.status(503).json({ error: 'R2 is not configured' });
        }

        const aspect = ASPECTS[req.body?.aspect] ? req.body.aspect : null;
        // Uploads are real photos and screenshots — resize to keep bytes sane, but
        // never crop, or a team photo comes back with someone's head missing.
        const body = await compressCoverBuffer(req.file.buffer, {
            maxWidth: aspect ? ASPECTS[aspect].maxWidth : 1600,
            maxHeight: aspect ? ASPECTS[aspect].maxHeight : 1200,
            quality: 86,
            fit: 'inside',
        });

        const stem = String(req.file.originalname || 'image')
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 60) || 'image';
        const filename = `${stem}-${Math.random().toString(36).slice(2, 10)}.jpg`;

        await coverArtInternals.s3Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: `blog/${filename}`,
            Body: body,
            ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000',
        }));

        const base = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
        res.json({ url: `${base.replace(/\/$/, '')}/blog/${filename}`, bytes: body.length });
    } catch (e) {
        console.error('[blog-images] upload failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

export default router;
