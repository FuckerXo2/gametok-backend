/**
 * fetch-3d-model.js — Live Sketchfab 3D model search & download tool for Kimi CLI.
 *
 * Usage:  node fetch-3d-model.js "iron man"
 *         node fetch-3d-model.js "low poly dragon"
 *
 * 1. Searches Sketchfab for downloadable models matching the query.
 * 2. Filters for GLB format, file size ≤ 1MB.
 * 3. Downloads the best match.
 * 4. Uploads it to Cloudflare R2.
 * 5. Prints the public R2 CDN URL to stdout (for Kimi to use in Three.js code).
 *
 * Environment:
 *   SKETCHFAB_API_TOKEN  — Sketchfab API token (required)
 *   R2_ACCOUNT_ID        — Cloudflare R2 account ID
 *   R2_ACCESS_KEY_ID     — R2 access key
 *   R2_SECRET_ACCESS_KEY — R2 secret key
 *   R2_BUCKET_NAME       — R2 bucket name
 *   R2_PUBLIC_URL        — Public URL prefix for the R2 bucket
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ───────────────────────────────────────────────────────────────────

const SKETCHFAB_TOKEN = process.env.SKETCHFAB_API_TOKEN || '';
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
const SEARCH_COUNT = 24; // Number of results to scan per query

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location, headers).then(resolve, reject);
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

function httpGetJson(url, headers = {}) {
    return httpGet(url, { ...headers, Accept: 'application/json' }).then((r) => {
        if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body.toString().slice(0, 200)}`);
        return JSON.parse(r.body.toString());
    });
}

// ─── Sketchfab Search ─────────────────────────────────────────────────────────

async function searchSketchfab(query) {
    const params = new URLSearchParams({
        type: 'models',
        q: query,
        downloadable: 'true',
        count: String(SEARCH_COUNT),
        sort_by: '-relevance',
    });
    const url = `https://api.sketchfab.com/v3/search?${params}`;
    const data = await httpGetJson(url, { Authorization: `Token ${SKETCHFAB_TOKEN}` });
    return data.results || [];
}

// ─── Sketchfab Download URL ───────────────────────────────────────────────────

async function getDownloadUrl(uid) {
    const url = `https://api.sketchfab.com/v3/models/${uid}/download`;
    const data = await httpGetJson(url, { Authorization: `Token ${SKETCHFAB_TOKEN}` });
    // The API returns { glb: { url, size, expires }, gltf: { ... } }
    if (data.glb) {
        return { url: data.glb.url, size: data.glb.size || 0 };
    }
    if (data.gltf) {
        return { url: data.gltf.url, size: data.gltf.size || 0 };
    }
    return null;
}

// ─── R2 Cache Check & Upload ──────────────────────────────────────────────────

function r2Key(uid) {
    return `3d-assets/sketchfab/${uid}.glb`;
}

function r2Url(uid) {
    return `${R2_PUBLIC}/${r2Key(uid)}`;
}

async function isOnR2(uid) {
    try {
        await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(uid) }));
        return true;
    } catch {
        return false;
    }
}

async function uploadToR2(uid, buffer) {
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key(uid),
        Body: buffer,
        ContentType: 'model/gltf-binary',
    }));
    return r2Url(uid);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const query = process.argv.slice(2).join(' ').trim();
    if (!query) {
        console.error('Usage: node fetch-3d-model.js "search query"');
        process.exit(1);
    }
    if (!SKETCHFAB_TOKEN) {
        console.error('Error: SKETCHFAB_API_TOKEN environment variable is not set.');
        process.exit(1);
    }

    console.error(`🔍 Searching Sketchfab for: "${query}"`);
    const results = await searchSketchfab(query);

    if (!results.length) {
        console.error(`❌ No downloadable models found for "${query}"`);
        process.exit(1);
    }

    // Filter and find the best candidate
    for (const model of results) {
        const uid = model.uid;
        const name = model.name || 'unknown';
        const vertexCount = model.vertexCount || 0;
        const hasAnimations = !!(model.animationCount && model.animationCount > 0);

        console.error(`   📦 Checking: "${name}" (uid: ${uid}, vertices: ${vertexCount}, animated: ${hasAnimations})`);

        // Check R2 cache first
        if (await isOnR2(uid)) {
            const url = r2Url(uid);
            console.error(`   ✅ Already cached on R2: ${url}`);
            // Print result to stdout as JSON for Kimi to parse
            const result = {
                url,
                name,
                uid,
                animated: hasAnimations,
                source: 'sketchfab',
            };
            console.log(JSON.stringify(result));
            return;
        }

        // Get download URL and check size
        try {
            const dl = await getDownloadUrl(uid);
            if (!dl) {
                console.error(`   ⚠️  No GLB download available, skipping.`);
                continue;
            }

            // Download the file
            console.error(`   ⬇️  Downloading GLB...`);
            const fileRes = await httpGet(dl.url);
            if (fileRes.status !== 200) {
                console.error(`   ⚠️  Download failed (HTTP ${fileRes.status}), skipping.`);
                continue;
            }

            const fileBuffer = fileRes.body;
            const fileSizeKB = Math.round(fileBuffer.length / 1024);

            if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
                console.error(`   ⚠️  Too large (${fileSizeKB}KB > 1024KB), skipping.`);
                continue;
            }

            // Upload to R2
            console.error(`   ☁️  Uploading to R2 (${fileSizeKB}KB)...`);
            const url = await uploadToR2(uid, fileBuffer);
            console.error(`   ✅ Uploaded: ${url}`);

            // Print result to stdout as JSON
            const result = {
                url,
                name,
                uid,
                sizeKB: fileSizeKB,
                animated: hasAnimations,
                source: 'sketchfab',
            };
            console.log(JSON.stringify(result));
            return;
        } catch (err) {
            console.error(`   ⚠️  Error processing "${name}": ${err.message}`);
            continue;
        }
    }

    console.error(`❌ No suitable GLB models found under 1MB for "${query}"`);
    process.exit(1);
}

main().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
