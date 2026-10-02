import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

export async function uploadBufferToR2(buffer, prefix = 'game-images', mimeType = 'image/png') {
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
 * Generate visual style concept preview card strictly using OpenAI gpt-image-2.5-flare (Low/Fast quality).
 * NO FALLBACKS: If OpenAI fails or has no credits, throws error directly.
 */
export async function generateConceptCardImage({
    prompt,
    size = '1024x1024',
    quality = 'low',
    prefix = 'concept-cards',
}) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not configured in environment variables');
    }

    console.log(`⚡ [OpenAI Image] Generating with gpt-image-2.5-flare (${quality}, ${size})...`);
    const openai = new OpenAI({ apiKey, timeout: 30000 });

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
        const imgRes = await fetch(imageData.url);
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const imageUrl = await uploadBufferToR2(buffer, prefix, 'image/png');
        return { imageUrl, source: 'gpt-image-2.5-flare' };
    }

    throw new Error('OpenAI gpt-image-2.5-flare returned no image data');
}

export const generateGameScreenshotImage = generateConceptCardImage;
