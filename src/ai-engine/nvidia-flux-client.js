import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const NVIDIA_FLUX_ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev';

// Configure Cloudflare R2 S3 Client if credentials exist
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

/**
 * Generate an image using NVIDIA NIM Flux.1-dev.
 * 
 * @param {Object} options
 * @param {string} options.prompt - Text prompt describing the image
 * @param {number} [options.width=1024] - Width (1024)
 * @param {number} [options.height=1024] - Height (1024)
 * @param {number} [options.steps=25] - Inference steps (20-50)
 * @param {number} [options.cfg_scale=3.5] - Guidance scale
 * @param {number} [options.seed=0] - Random seed (0 for random)
 * @returns {Promise<{ base64: string, buffer: Buffer, seed: number }>}
 */
export async function generateFluxImage({
    prompt,
    width = 1024,
    height = 1024,
    steps = 25,
    cfg_scale = 3.5,
    seed = 0,
}) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        throw new Error('NVIDIA_API_KEY is not configured in environment variables');
    }

    const payload = {
        prompt,
        mode: 'base',
        steps,
        cfg_scale,
        width,
        height,
        seed: seed || Math.floor(Math.random() * 1000000),
    };

    const res = await fetch(NVIDIA_FLUX_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`NVIDIA Flux API error (${res.status} ${res.statusText}): ${errorText.slice(0, 300)}`);
    }

    const json = await res.json();
    const artifact = json?.artifacts?.[0];

    if (!artifact?.base64) {
        throw new Error(`NVIDIA Flux returned no image artifact: ${JSON.stringify(json).slice(0, 200)}`);
    }

    const buffer = Buffer.from(artifact.base64, 'base64');
    return {
        base64: artifact.base64,
        buffer,
        seed: artifact.seed || payload.seed,
        finishReason: artifact.finishReason,
    };
}

/**
 * Generate a Flux image and upload directly to Cloudflare R2.
 * Returns public CDN URL or base64 data URI fallback.
 * 
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.prefix='visual-directions'] - R2 storage prefix/folder
 * @returns {Promise<{ imageUrl: string, base64: string, seed: number }>}
 */
export async function generateAndUploadFluxImage(options) {
    const { prefix = 'visual-directions', ...fluxOpts } = options;
    const { base64, buffer, seed } = await generateFluxImage(fluxOpts);

    const client = getS3Client();
    if (client && process.env.R2_BUCKET_NAME) {
        const filename = `${prefix}/${randomUUID()}.png`;
        try {
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: filename,
                Body: buffer,
                ContentType: 'image/png',
                CacheControl: 'public, max-age=31536000',
            });

            await client.send(command);

            const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
            const imageUrl = `${publicUrlBase.replace(/\/$/, '')}/${filename}`;
            return {
                imageUrl,
                base64,
                seed,
            };
        } catch (uploadErr) {
            console.error('[NVIDIA Flux] R2 upload failed, falling back to data URL:', uploadErr.message);
        }
    }

    // Fallback: return data URI if R2 is not configured or fails
    const dataUrl = `data:image/png;base64,${base64}`;
    return {
        imageUrl: dataUrl,
        base64,
        seed,
    };
}
