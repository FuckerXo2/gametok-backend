import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateAndUploadFluxImage } from './nvidia-flux-client.js';

let s3Client = null;
function getS3Client() {
    if (s3Client) return s3Client;
    if (process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
        s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
    }
    return s3Client;
}

async function uploadBufferToR2(buffer, prefix = 'game-images', mimeType = 'image/png') {
    const client = getS3Client();
    if (client && process.env.R2_BUCKET_NAME) {
        const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
        const filename = `${prefix}/${randomUUID()}.${ext}`;
        try {
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: filename,
                Body: buffer,
                ContentType: mimeType,
                CacheControl: 'public, max-age=31536000',
            });
            await client.send(command);

            const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
            return `${publicUrlBase.replace(/\/$/, '')}/${filename}`;
        } catch (uploadErr) {
            console.error('[OpenAI Image] R2 upload failed:', uploadErr.message);
        }
    }
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Generate game screenshot card using OpenAI gpt-image-2.5-flare (Low/Fast quality).
 * Seamlessly falls back to FLUX if credits are exhausted.
 */
export async function generateGameScreenshotImage({
    prompt,
    size = '512x512',
    quality = 'low',
    prefix = 'game-screens',
}) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
        try {
            console.log(`⚡ [OpenAI Image] Generating with gpt-image-2.5-flare (${quality}, ${size})...`);
            const openai = new OpenAI({ apiKey, timeout: 8000 });

            const response = await openai.images.generate({
                model: 'gpt-image-2.5-flare',
                prompt,
                n: 1,
                size,
            });

            const imageData = response?.data?.[0];
            if (imageData?.b64_json) {
                const buffer = Buffer.from(imageData.b64_json, 'base64');
                const imageUrl = await uploadBufferToR2(buffer, prefix, 'image/png');
                return { imageUrl, source: 'gpt-image-2.5-flare' };
            } else if (imageData?.url) {
                // Fetch image buffer and upload to R2 for permanent CDN persistence
                const imgRes = await fetch(imageData.url);
                const arrayBuffer = await imgRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const imageUrl = await uploadBufferToR2(buffer, prefix, 'image/png');
                return { imageUrl, source: 'gpt-image-2.5-flare' };
            }
        } catch (openaiErr) {
            console.warn(`⚠️ [OpenAI Image] gpt-image-2.5-flare failed (${openaiErr.message}). Checking fallback...`);
        }
    }

    // Fallback: If OpenAI key has no credits or times out, try FLUX
    try {
        console.log(`🎨 [Image Generator] Trying backup generator for "${prompt.slice(0, 50)}..."`);
        const fluxRes = await generateAndUploadFluxImage({
            prompt,
            width: 768,
            height: 768,
            steps: 12,
            cfg_scale: 3.5,
            prefix,
        });
        if (fluxRes?.imageUrl) {
            return { imageUrl: fluxRes.imageUrl, source: 'flux' };
        }
    } catch (fluxErr) {
        console.warn(`⚠️ [Image Generator] Backup generator error: ${fluxErr.message}`);
    }

    return { imageUrl: null, source: 'none' };
}
