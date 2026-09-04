import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cloudflare R2 Asset Storage Layer
 * 
 * Provides unified, production-grade S3-compatible upload & delivery for:
 * - 3D Canonical Models (GLB / glTF)
 * - Standalone Motion Tracks (GTAnim / JSON)
 * - Standardized WebP Thumbnails
 * - 2D Sprites & Audio
 */

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'gametok-games-assets';
const PUBLIC_CDN_BASE = process.env.R2_PUBLIC_URL 
    ? (process.env.R2_PUBLIC_URL.startsWith('http') ? process.env.R2_PUBLIC_URL : `https://${process.env.R2_PUBLIC_URL}`)
    : 'https://cdn.gametok.app';

/**
 * Upload an asset buffer to Cloudflare R2
 * @param {object} params
 * @param {string} params.key R2 object key path e.g. 'assets/3d/characters/paladin_01.glb'
 * @param {Buffer} params.buffer Binary buffer
 * @param {string} [params.contentType] e.g. 'model/gltf-binary', 'application/json', 'image/webp'
 * @param {string} [params.cacheControl] Default: 1 year immutable
 * @returns {Promise<{ key: string, cdnUrl: string, sizeBytes: number }>}
 */
export async function uploadAssetBufferToR2({
    key,
    buffer,
    contentType = 'application/octet-stream',
    cacheControl = 'public, max-age=31536000, immutable'
}) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('Upload failed: buffer must be a valid Node.js Buffer.');
    }
    if (!key || typeof key !== 'string') {
        throw new Error('Upload failed: key must be a non-empty string.');
    }

    const cleanKey = key.replace(/^\/+/, ''); // remove leading slash

    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: cleanKey,
            Body: buffer,
            ContentType: contentType,
            CacheControl: cacheControl,
        }));

        const cdnUrl = `${PUBLIC_CDN_BASE}/${cleanKey}`;
        return {
            key: cleanKey,
            cdnUrl,
            sizeBytes: buffer.length
        };
    } catch (err) {
        console.error(`💥 [R2 Storage] Failed to upload "${cleanKey}":`, err.message);
        throw new Error(`R2 Upload Error: ${err.message}`);
    }
}

/**
 * Get the public CDN URL for an R2 key
 * @param {string} key 
 * @returns {string}
 */
export function getCdnUrlForKey(key) {
    const cleanKey = key.replace(/^\/+/, '');
    return `${PUBLIC_CDN_BASE}/${cleanKey}`;
}
