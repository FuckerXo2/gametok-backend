/**
 * Artist Agent - AI-Driven Asset Generation
 * 
 * This is the "Artist Agent" that Phase 2 (Kimi) calls to generate ALL game assets.
 * Completely replaces the 84K asset library with on-demand AI generation.
 * 
 * Flow:
 * 1. Generate image with NVIDIA NIM FLUX.1-schnell
 * 2. Remove sprite backgrounds with IMG.LY locally, then optional hosted/local fallbacks
 * 3. Downscale to target size (64/128/256px) with Sharp
 * 4. Return base64 PNG data URI
 * 
 * Generation time: ~3-5 seconds per sprite
 */

import { assetModelRouter } from './asset-model-router.js';
import { expandCoreTileset3x3To7x7 } from './maker-tileset-processor.js';

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
const FAL_RMBG_URL = 'https://fal.run/fal-ai/bria/background/remove';
const BACKGROUND_DISTANCE_THRESHOLD = Number(process.env.SPRITE_BG_DISTANCE_THRESHOLD || 92);
const EDGE_SAMPLE_SIZE = 12;
const IMGLY_RMBG_DISABLED = process.env.IMGLY_RMBG_DISABLED === 'true';
const IMGLY_RMBG_MODEL = process.env.IMGLY_RMBG_MODEL || 'medium';
const IMGLY_RMBG_TIMEOUT_MS = Number(process.env.IMGLY_RMBG_TIMEOUT_MS || 90000);

function stripDataUrl(imageBase64OrDataUrl) {
    return String(imageBase64OrDataUrl || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

function normalizeSpriteCategory(category = 'item', assetType = 'sprite') {
    const value = String(category || 'item').toLowerCase();
    if (assetType === 'background' || value === 'environment' || value === 'background') return 'background';
    return value;
}

export async function inspectGeneratedAssetDataUri(dataUri, {
    width = 128,
    height = 128,
    assetType = 'sprite',
    category = 'item',
} = {}) {
    const text = String(dataUri || '');
    if (!text.startsWith('data:image/')) {
        return { ok: false, reason: 'missing_data_uri' };
    }

    const normalizedCategory = normalizeSpriteCategory(category, assetType);
    const isBackground = assetType === 'background' || normalizedCategory === 'background';

    try {
        const sharp = (await import('sharp')).default;
        const buffer = Buffer.from(stripDataUrl(text), 'base64');
        if (buffer.length < 256) {
            return { ok: false, reason: `decoded_too_small (${buffer.length} bytes)` };
        }

        const metadata = await sharp(buffer).metadata();
        if ((metadata.width || 0) < 8 || (metadata.height || 0) < 8) {
            return { ok: false, reason: 'invalid_dimensions' };
        }

        if (isBackground) {
            const minBytes = Math.max(8000, Math.round((width * height) / 200));
            if (buffer.length < minBytes) {
                return { ok: false, reason: `payload_too_small (${buffer.length} bytes decoded)` };
            }
            const sample = await sharp(buffer)
                .resize(64, 64, { fit: 'cover' })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            const buckets = new Set();
            let lumaSum = 0;
            let lumaSq = 0;
            const pixels = sample.info.width * sample.info.height;
            for (let i = 0; i < sample.data.length; i += 4) {
                const r = sample.data[i];
                const g = sample.data[i + 1];
                const b = sample.data[i + 2];
                buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
                const luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
                lumaSum += luma;
                lumaSq += luma * luma;
            }
            const avgLuma = pixels ? lumaSum / pixels : 0;
            const lumaVariance = pixels ? (lumaSq / pixels) - (avgLuma * avgLuma) : 0;
            if (buckets.size <= 3 || lumaVariance < 2) {
                return { ok: false, reason: `background_too_flat (buckets=${buckets.size})` };
            }
            return { ok: true, reason: 'background_ok' };
        }

        const minChars = Math.max(350, Math.round((width * height) / 16));
        if (text.length < minChars) {
            return { ok: false, reason: `payload_too_small (${text.length} chars)` };
        }

        const sample = await sharp(buffer)
            .ensureAlpha()
            .resize(48, 48, { fit: 'inside', withoutEnlargement: true })
            .raw()
            .toBuffer({ resolveWithObject: true });
        const pixels = sample.info.width * sample.info.height;
        let visible = 0;
        for (let i = 3; i < sample.data.length; i += 4) {
            if (sample.data[i] > 24) visible += 1;
        }
        const visibleRatio = pixels ? visible / pixels : 0;
        if (visibleRatio < 0.015) {
            return { ok: false, reason: 'blank_or_transparent' };
        }
        return { ok: true, reason: 'visible_content' };
    } catch (error) {
        return { ok: false, reason: `decode_failed: ${error.message}` };
    }
}

async function resolveGeneratedAssetDataUri(dataUri, request, label = 'asset') {
    const {
        assetType = 'sprite',
        category = 'item',
        size = 128,
        width,
        height,
    } = request;
    const targetWidth = Number(width || size || 128);
    const targetHeight = Number(height || width || size || 128);
    const inspection = await inspectGeneratedAssetDataUri(dataUri, {
        width: targetWidth,
        height: targetHeight,
        assetType,
        category,
    });
    if (inspection.ok) {
        return { dataUri, inspection, usedFallback: false, retried: false };
    }

    console.warn(`[Artist Agent] ${label} failed quality check (${inspection.reason}); retrying once...`);
    const typeMap = {
        player: 'character',
        enemy: 'enemy',
        item: 'item',
        vehicle: 'vehicle',
        environment: 'background',
        background: 'background',
        ui: 'ui',
        prop: 'prop',
        obstacle: 'obstacle',
    };
    const spriteType = assetType === 'background' ? 'background' : (typeMap[category] || 'character');
    try {
        const retryBase64 = await generateSprite({
            description: request.description,
            type: spriteType,
            targetSize: targetWidth === targetHeight
                ? targetWidth
                : { width: targetWidth, height: targetHeight },
            removeBg: spriteType === 'background' ? false : request.transparent !== false,
        });
        const retryUri = `data:image/png;base64,${retryBase64}`;
        const retryInspection = await inspectGeneratedAssetDataUri(retryUri, {
            width: targetWidth,
            height: targetHeight,
            assetType,
            category,
        });
        if (retryInspection.ok) {
            return { dataUri: retryUri, inspection: retryInspection, usedFallback: false, retried: true };
        }
        console.warn(`[Artist Agent] ${label} retry still failed (${retryInspection.reason}); using fallback art.`);
    } catch (retryError) {
        console.warn(`[Artist Agent] ${label} retry threw: ${retryError.message}`);
    }

    const fallbackUri = await generateFallbackAsset(
        Math.max(targetWidth, targetHeight),
        category,
        assetType,
        { width: targetWidth, height: targetHeight },
    );
    return {
        dataUri: fallbackUri,
        inspection: { ok: true, reason: 'fallback_asset' },
        usedFallback: true,
        retried: true,
    };
}

function asPngDataUrl(imageBase64OrDataUrl) {
    const value = String(imageBase64OrDataUrl || '');
    return value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`;
}

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}

/**
 * Generate sprite with FLUX.1-schnell (768px minimum, we'll use that)
 */
function normalizeDimensions(widthOrSize = 768, height = null) {
    if (typeof widthOrSize === 'object' && widthOrSize) {
        return {
            width: Number(widthOrSize.width || widthOrSize.size || 768),
            height: Number(widthOrSize.height || widthOrSize.size || widthOrSize.width || 768),
        };
    }
    const width = Number(widthOrSize || 768);
    return {
        width,
        height: Number(height || width),
    };
}

function compactFluxDescription(description = '', maxLen = 360) {
    let text = String(description || '')
        .replace(/\s+/g, ' ')
        .trim();
    const boilerplatePatterns = [
        /\.\s*Art style:[^.]*(?=(\.|$))/gi,
        /\.\s*Palette:[^.]*(?=(\.|$))/gi,
        /\.\s*Sprite style:[^.]*(?=(\.|$))/gi,
        /\.\s*Background style:[^.]*(?=(\.|$))/gi,
        /\.\s*Mobile composition:[^.]*(?=(\.|$))/gi,
        /\.\s*Camera angle:[^.]*(?=(\.|$))/gi,
        /\.\s*Consistency:[^.]*(?=(\.|$))/gi,
        /\.\s*Scenery only[^.]*(?=(\.|$))/gi,
    ];
    for (const pattern of boilerplatePatterns) {
        text = text.replace(pattern, '.');
    }
    text = text.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim();
    const sentences = text.split(/\.\s+/).filter(Boolean);
    text = sentences.slice(0, 2).join('. ');
    if (text.length > maxLen) {
        text = text.slice(0, maxLen).trim();
    }
    return text;
}

async function generateWithFlux(prompt, dimensions = 768, options = {}) {
    const attempts = [
        prompt,
        compactFluxDescription(prompt, 220),
        compactFluxDescription(prompt, 120),
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
        const attemptPrompt = attempts[index];
        try {
            const result = await assetModelRouter.generateImageDetailed(attemptPrompt, dimensions, options);
            if (index > 0) {
                console.log(`[sprite-gen] FLUX accepted compact prompt attempt ${index + 1} (${attemptPrompt.length} chars)`);
            }
            return result.base64;
        } catch (error) {
            lastError = error;
            const message = String(error.message || '');
            const retryable = /finishReason=CONTENT_FILTERED|finishReason=ERROR/.test(message);
            if (!retryable || index + 1 >= attempts.length) {
                throw error;
            }
            console.warn(
                `[sprite-gen] FLUX content filtered on attempt ${index + 1}; retrying shorter prompt`,
            );
        }
    }

    throw lastError || new Error('NVIDIA FLUX generation failed');
}

function resolveAssetTargetSize(request, spriteType) {
    const { size = 128, width, height, assetType } = request;
    const isBackground = spriteType === 'background' || assetType === 'background';
    if (isBackground) {
        return {
            width: Number(width || 768),
            height: Number(height || 1344),
        };
    }
    if (width || height) {
        return {
            width: Number(width || size || 128),
            height: Number(height || width || size || 128),
        };
    }
    return Number(size || 128);
}

async function inspectBackgroundRaster(base64, targetWidth, targetHeight) {
    const sharp = (await import('sharp')).default;
    const buffer = Buffer.from(stripDataUrl(base64), 'base64');
    if (buffer.length < 3500) {
        return { ok: false, reason: `flux_decode_too_small (${buffer.length} bytes)` };
    }
    let metadata;
    try {
        metadata = await sharp(buffer).metadata();
    } catch (error) {
        return { ok: false, reason: `flux_decode_failed: ${error.message}` };
    }
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (width < 256 || height < 256) {
        return { ok: false, reason: `flux_dimensions_too_small (${width}x${height})` };
    }

    const sample = await sharp(buffer)
        .resize(64, 64, { fit: 'cover' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const buckets = new Set();
    let lumaSum = 0;
    let lumaSq = 0;
    const pixels = sample.info.width * sample.info.height;
    for (let i = 0; i < sample.data.length; i += 4) {
        const r = sample.data[i];
        const g = sample.data[i + 1];
        const b = sample.data[i + 2];
        buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
        const luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
        lumaSum += luma;
        lumaSq += luma * luma;
    }
    const avgLuma = pixels ? lumaSum / pixels : 0;
    const lumaVariance = pixels ? (lumaSq / pixels) - (avgLuma * avgLuma) : 0;
    if (buckets.size <= 3 || lumaVariance < 2) {
        return { ok: false, reason: `background_too_flat (buckets=${buckets.size}, variance=${lumaVariance.toFixed(2)})` };
    }

    const cropped = await sharp(buffer)
        .resize(targetWidth, targetHeight, {
            kernel: 'lanczos3',
            fit: 'cover',
            position: 'centre',
        })
        .png({ compressionLevel: 6 })
        .toBuffer();
    return {
        ok: true,
        buffer: cropped,
        metadata: { width, height },
    };
}

function buildBackgroundFluxPrompt(description = '', variant = 0) {
    const safeDescription = compactFluxDescription(description, variant === 2 ? 120 : variant === 1 ? 180 : 260);
    if (variant === 1) {
        return [
            'mobile game environment background',
            'layered scenery, vivid colors, atmospheric depth',
            'no text, no hud, no characters',
            safeDescription,
        ].join(', ');
    }
    if (variant === 2) {
        return `video game background art, atmospheric environment scene, no text, ${safeDescription}`;
    }
    return [
        'premium mobile game environment background art',
        'portrait orientation layered scenery',
        'vivid color, atmospheric depth, cinematic composition',
        'no text, no hud, no characters, no buttons, no ui overlays',
        safeDescription,
    ].join(', ');
}

function buildBackgroundFluxSizes(targetDims) {
    const sizes = [];
    const nativeLabel = `${targetDims.width}x${targetDims.height} native portrait`;
    sizes.push({
        width: targetDims.width,
        height: targetDims.height,
        label: nativeLabel,
    });
    if (targetDims.width !== 768 || targetDims.height !== 768) {
        sizes.push({ width: 768, height: 768, label: '768 square (NIM default)' });
    }
    if (targetDims.width !== 1024 || targetDims.height !== 1024) {
        sizes.push({ width: 1024, height: 1024, label: '1024 square' });
    }
    return sizes;
}

async function attemptBackgroundFluxAtSize({
    description,
    targetDims,
    size,
    model = 'schnell',
    retry = 0,
}) {
    const prompt = buildBackgroundFluxPrompt(description, retry);
    const fluxImage = await generateWithFlux(prompt, size, { model });
    const inspected = await inspectBackgroundRaster(
        fluxImage,
        targetDims.width,
        targetDims.height,
    );
    return { inspected, promptVariant: retry };
}

async function attemptBackgroundSpritePathFallback(description, targetDims, model = 'schnell') {
    const spritePrompt = buildSpritePrompt(
        `${description}. Full environment scenery plate spanning the whole frame, rich layered background, no characters, no text, no hud.`,
        'background',
        false,
    );
    const fluxImage = await generateWithFlux(spritePrompt, { width: 128, height: 128 }, { model });
    return inspectBackgroundRaster(
        fluxImage,
        targetDims.width,
        targetDims.height,
    );
}

async function generateBackgroundWithFluxModel(description, targetDims, model = 'schnell') {
    const modelLabel = model === 'dev' ? 'flux.1-dev' : 'flux.1-schnell';
    const fluxSizes = buildBackgroundFluxSizes(targetDims);

    for (const size of fluxSizes) {
        for (let retry = 0; retry < 3; retry += 1) {
            try {
                const { inspected } = await attemptBackgroundFluxAtSize({
                    description,
                    targetDims,
                    size,
                    model,
                    retry,
                });
                if (!inspected.ok) {
                    console.warn(
                        `[sprite-gen] FLUX background ${modelLabel} ${size.label}`
                        + ` retry=${retry + 1} rejected: ${inspected.reason}`,
                    );
                    continue;
                }
                console.log(
                    `[sprite-gen] ✓ FLUX background accepted (${modelLabel}) at ${size.label} retry=${retry + 1}`
                    + ` (source ${inspected.metadata.width}x${inspected.metadata.height}`
                    + ` -> ${targetDims.width}x${targetDims.height}, ${inspected.buffer.length} bytes)`,
                );
                return inspected.buffer.toString('base64');
            } catch (error) {
                console.warn(
                    `[sprite-gen] FLUX background ${modelLabel} ${size.label}`
                    + ` retry=${retry + 1} failed: ${error.message}`,
                );
            }
        }
    }

    try {
        const inspected = await attemptBackgroundSpritePathFallback(description, targetDims, model);
        if (inspected.ok) {
            console.log(
                `[sprite-gen] ✓ FLUX background accepted (${modelLabel}) via sprite-path fallback`
                + ` (source ${inspected.metadata.width}x${inspected.metadata.height}`
                + ` -> ${targetDims.width}x${targetDims.height}, ${inspected.buffer.length} bytes)`,
            );
            return inspected.buffer.toString('base64');
        }
        console.warn(
            `[sprite-gen] FLUX background ${modelLabel} sprite-path fallback rejected: ${inspected.reason}`,
        );
    } catch (error) {
        console.warn(
            `[sprite-gen] FLUX background ${modelLabel} sprite-path fallback failed: ${error.message}`,
        );
    }

    return null;
}

async function generateBackgroundFluxImage(description, targetSize) {
    const targetDims = normalizeDimensions(targetSize);

    const schnellResult = await generateBackgroundWithFluxModel(description, targetDims, 'schnell');
    if (schnellResult) {
        return schnellResult;
    }

    if (assetModelRouter.isBackgroundDevFallbackEnabled()) {
        console.log('[sprite-gen] FLUX schnell background exhausted; trying flux.1-dev fallback...');
        const devResult = await generateBackgroundWithFluxModel(description, targetDims, 'dev');
        if (devResult) {
            return devResult;
        }
    }

    throw new Error('FLUX background generation failed after schnell and dev attempts');
}

/**
 * Downscale image using sharp (high-quality)
 */
async function downscaleImage(imageBase64, targetSize = 128) {
    try {
        const sharp = (await import('sharp')).default;
        const buffer = Buffer.from(imageBase64, 'base64');
        const { width, height } = normalizeDimensions(targetSize);
        
        const resized = await sharp(buffer)
            .resize(width, height, {
                kernel: 'lanczos3',
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();
        
        return resized.toString('base64');
    } catch (error) {
        console.warn('[sprite-gen] Downscaling failed, using original:', error.message);
        return imageBase64;
    }
}

function colorDistance(colorA, colorB) {
    const dr = colorA.r - colorB.r;
    const dg = colorA.g - colorB.g;
    const db = colorA.b - colorB.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getPixel(data, width, x, y) {
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

function quantizeColor({ r, g, b }) {
    const bucket = 24;
    return {
        r: Math.round(r / bucket) * bucket,
        g: Math.round(g / bucket) * bucket,
        b: Math.round(b / bucket) * bucket,
    };
}

function collectEdgeBackgroundColors(data, width, height) {
    const samples = new Map();
    const addSample = (x, y) => {
        const color = quantizeColor(getPixel(data, width, x, y));
        const key = `${color.r},${color.g},${color.b}`;
        const existing = samples.get(key) || { ...color, count: 0 };
        existing.count++;
        samples.set(key, existing);
    };

    for (let offset = 0; offset < EDGE_SAMPLE_SIZE; offset++) {
        for (let x = 0; x < width; x += 2) {
            addSample(x, offset);
            addSample(x, height - 1 - offset);
        }
        for (let y = 0; y < height; y += 2) {
            addSample(offset, y);
            addSample(width - 1 - offset, y);
        }
    }

    return Array.from(samples.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
}

function isBackgroundLike(data, index, backgroundColors, threshold) {
    const pixel = { r: data[index], g: data[index + 1], b: data[index + 2] };
    return backgroundColors.some((color) => colorDistance(pixel, color) <= threshold);
}

function softenAlpha(data, width, height, transparentMask) {
    const originalAlpha = new Uint8Array(width * height);
    for (let pos = 0; pos < transparentMask.length; pos++) {
        originalAlpha[pos] = data[pos * 4 + 3];
    }

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const pos = y * width + x;
            if (transparentMask[pos]) continue;
            let transparentNeighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    if (transparentMask[(y + dy) * width + (x + dx)]) transparentNeighbors++;
                }
            }
            if (transparentNeighbors > 0) {
                data[pos * 4 + 3] = Math.max(80, Math.round(originalAlpha[pos] * (1 - transparentNeighbors * 0.08)));
            }
        }
    }
}

async function removeBackgroundWithImgly(imageBase64) {
    if (IMGLY_RMBG_DISABLED) {
        return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'imgly', skipped: 'disabled' };
    }

    try {
        const { removeBackground } = await import('@imgly/background-removal-node');
        const inputBlob = new Blob([Buffer.from(stripDataUrl(imageBase64), 'base64')], { type: 'image/png' });
        const outputBlob = await withTimeout(
            removeBackground(inputBlob, {
                model: IMGLY_RMBG_MODEL,
                output: {
                    format: 'image/png',
                    type: 'foreground',
                },
            }),
            IMGLY_RMBG_TIMEOUT_MS,
            'IMG.LY background removal'
        );
        const arrayBuffer = await outputBlob.arrayBuffer();
        return {
            imageBase64: Buffer.from(arrayBuffer).toString('base64'),
            removed: true,
            method: 'imgly',
        };
    } catch (error) {
        console.warn('[sprite-gen] IMG.LY background removal error:', error.message);
        return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'imgly' };
    }
}

/**
 * Optional hosted fallback via fal-hosted BRIA RMBG 2.0.
 */
async function removeBackgroundWithFal(imageBase64) {
    if (!FAL_KEY) {
        return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'fal-bria', skipped: 'missing_fal_key' };
    }

    try {
        const response = await fetch(FAL_RMBG_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                image_url: asPngDataUrl(imageBase64),
                sync_mode: true,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.warn(`[sprite-gen] FAL BRIA background removal failed: status=${response.status} body=${text.slice(0, 500)}`);
            return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'fal-bria' };
        }

        const json = await response.json();
        const outputUrl = json?.image?.url;
        if (!outputUrl) {
            console.warn('[sprite-gen] FAL BRIA background removal returned no image.url');
            return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'fal-bria' };
        }

        if (outputUrl.startsWith('data:image/')) {
            return { imageBase64: stripDataUrl(outputUrl), removed: true, method: 'fal-bria' };
        }

        const imageResponse = await fetch(outputUrl);
        if (!imageResponse.ok) {
            const text = await imageResponse.text().catch(() => '');
            console.warn(`[sprite-gen] FAL BRIA output download failed: status=${imageResponse.status} body=${text.slice(0, 300)}`);
            return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'fal-bria' };
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        return {
            imageBase64: Buffer.from(arrayBuffer).toString('base64'),
            removed: true,
            method: 'fal-bria',
        };
    } catch (error) {
        console.warn('[sprite-gen] FAL BRIA background removal error:', error.message);
        return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'fal-bria' };
    }
}

async function removeBackgroundLocally(imageBase64) {
    try {
        const sharp = (await import('sharp')).default;
        const inputBuffer = Buffer.from(stripDataUrl(imageBase64), 'base64');
        const { data, info } = await sharp(inputBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height } = info;
        const backgroundColors = collectEdgeBackgroundColors(data, width, height);
        const visited = new Uint8Array(width * height);
        const transparentMask = new Uint8Array(width * height);
        const queue = [];
        const enqueue = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return;
            const pos = y * width + x;
            if (visited[pos]) return;
            const idx = pos * 4;
            if (!isBackgroundLike(data, idx, backgroundColors, BACKGROUND_DISTANCE_THRESHOLD)) return;
            visited[pos] = 1;
            queue.push(pos);
        };

        for (let x = 0; x < width; x++) {
            enqueue(x, 0);
            enqueue(x, height - 1);
        }
        for (let y = 0; y < height; y++) {
            enqueue(0, y);
            enqueue(width - 1, y);
        }

        let removedPixels = 0;
        for (let head = 0; head < queue.length; head++) {
            const pos = queue[head];
            const x = pos % width;
            const y = Math.floor(pos / width);
            data[pos * 4 + 3] = 0;
            transparentMask[pos] = 1;
            removedPixels++;
            enqueue(x + 1, y);
            enqueue(x - 1, y);
            enqueue(x, y + 1);
            enqueue(x, y - 1);
        }

        if (removedPixels < width * height * 0.05) {
            console.warn(`[sprite-gen] Local background removal removed too little (${removedPixels}px), using original`);
            return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'local-edge', removedPixels };
        }

        softenAlpha(data, width, height, transparentMask);

        const output = await sharp(data, { raw: { width, height, channels: 4 } })
            .png()
            .toBuffer();

        return {
            imageBase64: output.toString('base64'),
            removed: true,
            method: 'local-edge',
            removedPixels,
        };
    } catch (error) {
        console.warn('[sprite-gen] Local background removal error:', error.message);
        return { imageBase64: stripDataUrl(imageBase64), removed: false, method: 'local-edge' };
    }
}

async function removeBackground(imageBase64) {
    const imglyResult = await removeBackgroundWithImgly(imageBase64);
    if (imglyResult.removed) return imglyResult;

    if (imglyResult.skipped === 'disabled') {
        console.warn('[sprite-gen] IMG.LY background removal disabled; trying hosted fallback');
    } else {
        console.warn('[sprite-gen] IMG.LY unavailable; trying hosted fallback');
    }

    const falResult = await removeBackgroundWithFal(imageBase64);
    if (falResult.removed) return falResult;

    if (falResult.skipped === 'missing_fal_key') {
        console.warn('[sprite-gen] FAL_KEY missing; falling back to local background removal');
    } else {
        console.warn('[sprite-gen] FAL BRIA unavailable; falling back to local background removal');
    }

    return removeBackgroundLocally(imageBase64);
}

/**
 * Build optimized sprite prompt with content filter avoidance
 */
function buildSpritePrompt(description, type = 'character', wantsTransparent = false) {
    const basePrompts = {
        character: 'professional mobile game sprite, character design, centered, full body view, clean silhouette, game asset style',
        vehicle: 'professional mobile game sprite, vehicle design, centered, readable silhouette, game asset style',
        item: 'professional mobile game sprite, item design, centered, clean silhouette, game asset style',
        prop: 'professional mobile game sprite, road hazard or scenery prop, centered, clean silhouette, game asset style',
        obstacle: 'professional mobile game sprite, hazard or obstacle object, centered, clean silhouette, game asset style',
        enemy: 'professional mobile game sprite, creature or opponent design, centered, full body view, clean silhouette, game asset style',
        background: 'premium mobile game environment background, rich layered scenery, atmospheric depth, polished App Store game art, cinematic composition, vivid color',
        ui: 'professional mobile game icon or decorative UI source art, clean design, game asset style',
    };
    
    const base = basePrompts[type] || basePrompts.character;
    
    // Content filter avoidance: replace sensitive words
    const safeDescription = compactFluxDescription(
        String(description)
            .replace(/\bzombie\b/gi, 'undead creature')
            .replace(/\bgun\b/gi, 'blaster')
            .replace(/\brifle\b/gi, 'weapon')
            .replace(/\bblood\b/gi, 'red particles')
            .replace(/\bgore\b/gi, 'effects')
            .replace(/\bkill\b/gi, 'defeat')
            .replace(/\bdead\b/gi, 'fallen')
            .replace(/\bviolent\b/gi, 'action-packed'),
        type === 'background' ? 260 : 220,
    );

    const backgroundInstruction = type === 'background'
        ? 'portrait 9:16 full-bleed environment, layered depth, vivid premium mobile game scenery, clean readable composition, no text, no labels, no HUD, no buttons, no foreground characters, no UI overlays, no flat single-color fill'
        : wantsTransparent
        ? 'single foreground asset, centered with clear empty margin, no text'
        : 'simple background';

    return `${base}, ${safeDescription}, ${backgroundInstruction}, high contrast, clear edges, cohesive art direction, production-quality game art`;
}

/**
 * Generate a game sprite (main function)
 * 
 * @param {Object} options
 * @param {string} options.description - What to generate (e.g., "zombie with green skin")
 * @param {string} options.type - Type: 'character', 'vehicle', 'item', 'enemy', 'background', 'ui'
 * @param {number} options.targetSize - Final size (64, 128, or 256)
 * @param {boolean} options.removeBg - Whether to remove background
 * @returns {Promise<string>} Base64 PNG image
 */
export async function generateSprite({
    description,
    type = 'character',
    targetSize = 128,
    removeBg = true,
}) {
    const dimensions = normalizeDimensions(targetSize);
    console.log(`[sprite-gen] Generating ${type}: ${description} (target: ${dimensions.width}x${dimensions.height})`);
    
    // Step 1: Generate with FLUX
    const shouldRemoveBackground = removeBg && type !== 'background' && type !== 'ui';
    const prompt = buildSpritePrompt(description, type, shouldRemoveBackground);
    if (type === 'background') {
        const finalImage = await generateBackgroundFluxImage(description, targetSize);
        console.log(`[sprite-gen] ✓ Background ready at ${dimensions.width}x${dimensions.height}`);
        return finalImage;
    }
    const fluxImage = await generateWithFlux(prompt, dimensions);
    console.log(`[sprite-gen] ✓ Generated source image for ${dimensions.width}x${dimensions.height} target`);
    
    // Step 2: Remove background (optional, skip for backgrounds/ui)
    let processedImage = fluxImage;
    if (shouldRemoveBackground) {
        const backgroundResult = await removeBackground(fluxImage);
        processedImage = backgroundResult.imageBase64;
        if (backgroundResult.removed) {
            console.log(`[sprite-gen] ✓ Background removed via ${backgroundResult.method} (${backgroundResult.removedPixels || 0}px)`);
        } else {
            console.warn(`[sprite-gen] Background removal unavailable, using original image`);
        }
    }
    
    // Step 3: Downscale to target size
    const finalImage = await downscaleImage(processedImage, targetSize);
    console.log(`[sprite-gen] ✓ Downscaled to ${dimensions.width}x${dimensions.height}`);
    
    return finalImage;
}

/**
 * ARTIST AGENT - Main entry point for Phase 2 (Kimi)
 * 
 * This function generates ALL assets needed for a game on-demand.
 * Replaces the 84K asset library completely.
 * 
 * @param {Object} request - Asset generation request from Phase 2
 * @param {string} request.assetType - 'sprite' | 'background' | 'ui' | 'audio'
 * @param {string} request.description - What to generate
 * @param {string} request.category - 'player' | 'enemy' | 'item' | 'vehicle' | 'environment' | 'ui'
 * @param {number} request.size - Target size (64, 128, 256, 512)
 * @param {boolean} request.transparent - Whether to remove background
 * @returns {Promise<string>} Data URI (data:image/png;base64,...)
 */
export async function artistAgent(request) {
    const {
        assetType = 'sprite',
        description,
        category = 'character',
        size = 128,
        width,
        height,
        transparent = true,
    } = request;
    
    console.log(`[Artist Agent] Request: ${assetType} - ${category} - "${description}"`);
    
    try {
        // Map category to sprite type
        const typeMap = {
            player: 'character',
            enemy: 'enemy',
            item: 'item',
            vehicle: 'vehicle',
            environment: 'background',
            background: 'background',
            ui: 'ui',
            prop: 'prop',
            obstacle: 'obstacle',
        };
        const spriteType = assetType === 'background' ? 'background' : (typeMap[category] || 'character');
        
        // Generate the asset
        const base64Image = await generateSprite({
            description,
            type: spriteType,
            targetSize: resolveAssetTargetSize(request, spriteType),
            removeBg: spriteType === 'background' ? false : transparent,
        });

        const resolved = await resolveGeneratedAssetDataUri(
            `data:image/png;base64,${base64Image}`,
            request,
            `${assetType}:${category}`,
        );
        const generationSource = resolved.usedFallback
            ? 'fallback'
            : (resolved.retried ? 'flux_retry' : 'flux');
        console.log(
            `[Artist Agent] ✓ Generated ${assetType} (${resolved.dataUri.length} chars`
            + `${resolved.usedFallback ? ', fallback' : resolved.retried ? ', retried' : ''})`,
        );
        return {
            dataUri: resolved.dataUri,
            usedFallback: Boolean(resolved.usedFallback),
            retried: Boolean(resolved.retried),
            generationSource,
            inspectionReason: resolved.inspection?.reason || null,
        };
    } catch (error) {
        console.error(`[Artist Agent] Failed to generate ${assetType}:`, error.message);
        const targetWidth = Number(width || size || 128);
        const targetHeight = Number(height || width || size || 128);
        const dataUri = await generateFallbackAsset(
            Math.max(targetWidth, targetHeight),
            category,
            assetType,
            { width: targetWidth, height: targetHeight },
        );
        return {
            dataUri,
            usedFallback: true,
            retried: false,
            generationSource: 'fallback',
            inspectionReason: error.message || 'generation_failed',
        };
    }
}

async function generateFallbackBackgroundAsset(width = 768, height = 1344) {
    const w = Math.max(320, Math.round(Number(width) || 768));
    const h = Math.max(480, Math.round(Number(height) || 1344));
    const horizonY = Math.round(h * 0.58);
    const floorY = Math.round(h * 0.68);
    const windowY = Math.round(h * 0.14);
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#120826"/>
    <stop offset="45%" stop-color="#2e1b4a"/>
    <stop offset="100%" stop-color="#0b1220"/>
  </linearGradient>
  <radialGradient id="nebula" cx="72%" cy="18%" r="42%">
    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#334155"/>
    <stop offset="100%" stop-color="#111827"/>
  </linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
<rect width="${w}" height="${h}" fill="url(#nebula)"/>
<circle cx="${Math.round(w * 0.78)}" cy="${Math.round(h * 0.16)}" r="${Math.round(Math.min(w, h) * 0.08)}" fill="#f9dc5c" opacity="0.85"/>
<rect x="${Math.round(w * 0.12)}" y="${windowY}" width="${Math.round(w * 0.28)}" height="${Math.round(h * 0.18)}" rx="18" fill="#0ea5e9" opacity="0.35"/>
<rect x="0" y="${horizonY}" width="${w}" height="${Math.round(h * 0.08)}" fill="#475569" opacity="0.55"/>
<rect x="0" y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>
<rect x="0" y="${Math.round(h * 0.82)}" width="${w}" height="3" fill="#00c9db" opacity="0.65"/>
</svg>`;
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Generate a fallback PNG placeholder if AI generation fails or quality checks reject output.
 */
async function generateFallbackAsset(size, category, assetType = 'sprite', dimensions = null) {
    const normalizedCategory = normalizeSpriteCategory(category, assetType);
    if (normalizedCategory === 'background') {
        const { width, height } = normalizeDimensions(dimensions || { width: 768, height: 1344 });
        return generateFallbackBackgroundAsset(width, height);
    }
    const colors = {
        player: '#4ade80',
        enemy: '#f87171',
        item: '#fbbf24',
        vehicle: '#60a5fa',
        environment: '#94a3b8',
        background: '#475569',
        ui: '#a78bfa',
        prop: '#c084fc',
        obstacle: '#c084fc',
    };
    const color = colors[category] || '#9ca3af';
    const dimension = Math.max(32, Number(size) || 128);
    const radius = Math.round(dimension * 0.34);
    const cx = Math.round(dimension / 2);
    const cy = Math.round(dimension / 2);
    const eyeRadius = Math.max(2, Math.round(radius * 0.14));
    const svg = `<svg width="${dimension}" height="${dimension}" xmlns="http://www.w3.org/2000/svg">
<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" />
<circle cx="${cx - Math.round(radius * 0.25)}" cy="${cy - Math.round(radius * 0.18)}" r="${eyeRadius}" fill="#ffffff" opacity="0.9" />
<circle cx="${cx + Math.round(radius * 0.25)}" cy="${cy - Math.round(radius * 0.18)}" r="${eyeRadius}" fill="#ffffff" opacity="0.9" />
</svg>`;
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function createFrameVariant(dataUri, width, height, variant = {}) {
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(stripDataUrl(dataUri), 'base64');
    const scaleX = Number(variant.scaleX || 1);
    const scaleY = Number(variant.scaleY || 1);
    const dx = Number(variant.dx || 0);
    const dy = Number(variant.dy || 0);
    const frameWidth = Math.max(1, Math.min(width, Math.round(width * scaleX)));
    const frameHeight = Math.max(1, Math.min(height, Math.round(height * scaleY)));
    let frame = sharp(input)
        .resize(frameWidth, frameHeight, {
            fit: 'fill',
            kernel: 'lanczos3',
        });

    if (variant.brightness || variant.saturation) {
        frame = frame.modulate({
            brightness: Number(variant.brightness || 1),
            saturation: Number(variant.saturation || 1),
        });
    }

    const resized = await frame.png().toBuffer();
    const left = Math.max(0, Math.min(width - 1, Math.round((width - frameWidth) / 2 + dx)));
    const top = Math.max(0, Math.min(height - 1, Math.round((height - frameHeight) / 2 + dy)));
    const composited = await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([{ input: resized, left, top }])
        .png()
        .toBuffer();

    return `data:image/png;base64,${composited.toString('base64')}`;
}

function buildGeneratedFramePrompt(assetRequest, category, variant, index, totalFrames) {
    const description = assetRequest.description || assetRequest.gameplayRole || category;
    const actionPrompts = {
        idle: 'idle animation pose, calm readable silhouette, subtle breathing variation',
        move: 'movement animation pose, dynamic body shift, clear direction energy, motion-ready silhouette',
        hit: 'impact reaction frame, squash-and-stretch, bright feedback emphasis, recoiling pose',
        pulse: 'glowing pulse frame, stronger aura, clean centered readable silhouette',
    };
    const action = actionPrompts[variant.name] || `${variant.name} animation pose`;
    return [
        'Professional mobile game animation frame sprite.',
        `Frame ${index + 1} of ${totalFrames}.`,
        `Subject: ${description}.`,
        `Action: ${action}.`,
        'One foreground subject only, centered, readable at small size, clean empty margin.',
        'Use the same broad art direction, colors, camera angle, and silhouette language as the asset pack; exact identity is not required.',
        'No text, no labels, no HUD, no buttons, no borders, no scenery.',
        'White or simple plain background suitable for transparent-background extraction.',
    ].join(' ');
}

async function createGeneratedFrameVariant(width, height, assetRequest, category, variant, index, totalFrames) {
    const prompt = buildGeneratedFramePrompt(assetRequest, category, variant, index, totalFrames);
    const generated = await assetModelRouter.generateImage(prompt, { width, height });
    let processedImage = generated;
    const backgroundResult = await removeBackground(processedImage);
    processedImage = backgroundResult.imageBase64;
    const finalImage = await downscaleImage(processedImage, { width, height });

    return {
        dataUri: `data:image/png;base64,${finalImage}`,
        method: 'text-to-image-frame',
        backgroundMethod: backgroundResult.method,
        backgroundRemoved: backgroundResult.removed,
    };
}

function shouldBuildFrameAssets(assetRequest, category) {
    const kind = assetRequest.assetType || 'sprite';
    if (kind === 'background' || category === 'environment' || category === 'background' || category === 'ui') return false;
    return ['player', 'enemy', 'vehicle', 'prop', 'item'].includes(category);
}

async function buildFrameAssetsForRequest(id, assetRequest, dataUri, width, height) {
    const category = assetRequest.category || 'item';
    if (!shouldBuildFrameAssets(assetRequest, category)) {
        return { frames: [], animations: [] };
    }

    const primaryMotion = category === 'player' || category === 'enemy' || category === 'vehicle';
    const variants = primaryMotion
        ? [
            { name: 'idle', scaleX: 1, scaleY: 1, dy: 0, duration: 220 },
            { name: 'idle', scaleX: 1.03, scaleY: 0.97, dy: -2, duration: 220 },
            { name: 'move', scaleX: 1.08, scaleY: 0.92, dx: -2, dy: 1, duration: 90 },
            { name: 'move', scaleX: 0.94, scaleY: 1.06, dx: 2, dy: -1, duration: 90 },
            { name: 'hit', scaleX: 1.12, scaleY: 0.88, brightness: 1.25, duration: 70 },
            { name: 'hit', scaleX: 0.92, scaleY: 1.08, brightness: 1.08, duration: 70 },
        ]
        : [
            { name: 'pulse', scaleX: 1, scaleY: 1, duration: 260 },
            { name: 'pulse', scaleX: 1.1, scaleY: 1.1, brightness: 1.18, duration: 260 },
        ];

    const frames = [];
    for (let index = 0; index < variants.length; index++) {
        const variant = variants[index];
        const frameId = `${id}_${variant.name}_${String(index + 1).padStart(2, '0')}`;
        let frameUri = null;
        let generationMethod = 'local-transform';

        if (!frameUri && primaryMotion) {
            try {
                const generatedFrame = await createGeneratedFrameVariant(width, height, assetRequest, category, variant, index, variants.length);
                if (generatedFrame?.dataUri) {
                    frameUri = generatedFrame.dataUri;
                    generationMethod = generatedFrame.method;
                    console.log(`[sprite-gen] ✓ Generated frame ${frameId} via ${generationMethod}`);
                }
            } catch (error) {
                console.warn(`[sprite-gen] Generated frame ${frameId} failed, using local transform: ${error.message}`);
            }
        }

        if (!frameUri) {
            frameUri = await createFrameVariant(dataUri, width, height, variant);
            generationMethod = 'local-transform';
        } else {
            const frameInspection = await inspectGeneratedAssetDataUri(frameUri, {
                width,
                height,
                assetType: 'sprite',
                category,
            });
            if (!frameInspection.ok) {
                console.warn(`[sprite-gen] Frame ${frameId} failed quality (${frameInspection.reason}); using local transform`);
                frameUri = await createFrameVariant(dataUri, width, height, variant);
                generationMethod = 'local-transform-fallback';
            }
        }

        frames.push({
            id: frameId,
            key: frameId,
            url: frameUri,
            type: 'image',
            kind: 'animation_frame',
            role: category,
            category,
            sourceKey: id,
            animationKey: `${id}_${variant.name}`,
            frameName: variant.name,
            frameIndex: index,
            width,
            height,
            duration: variant.duration,
            transparent: true,
            generationMethod,
        });
    }

    const animations = Array.from(new Set(frames.map((frame) => frame.animationKey))).map((animationKey) => {
        const sequenceFrames = frames.filter((frame) => frame.animationKey === animationKey);
        return {
            key: animationKey,
            type: 'frame_sequence',
            sourceKey: id,
            role: category,
            frames: sequenceFrames.map((frame) => frame.key),
            frameRate: animationKey.endsWith('_move') || animationKey.endsWith('_hit') ? 10 : 4,
            repeat: animationKey.endsWith('_hit') ? 0 : -1,
        };
    });

    return { frames, animations };
}

function buildTilesetPrompt(tileset = {}) {
    return [
        'Professional mobile game 3x3 core tileset sheet.',
        `Theme: ${tileset.description || tileset.theme || tileset.role || 'game terrain tiles'}.`,
        'Exactly nine square tiles arranged as a 3 by 3 grid: top-left corner, top edge, top-right corner, left edge, center fill, right edge, bottom-left corner, bottom edge, bottom-right corner.',
        'Seamless pixel-art or clean painted game terrain, no labels, no UI, no text, no characters.',
        'The tiles should align at edges and be readable on mobile.',
    ].join(' ');
}

async function generateTilesetAsset(tileset = {}) {
    const tileSize = Number(tileset.tileSize || 32);
    const key = tileset.key || 'world_tileset';
    const coreKey = `${key}_core_3x3`;
    const sheetKey = `${key}_7x7`;
    const coreSize = tileSize * 3;
    console.log(`[sprite-gen] Generating tileset core ${coreKey} (${tileSize}px tiles)`);
    const coreImage = await assetModelRouter.generateImage(buildTilesetPrompt(tileset), { width: coreSize, height: coreSize });
    const coreDataUri = `data:image/png;base64,${await downscaleImage(coreImage, { width: coreSize, height: coreSize })}`;
    const expanded = await expandCoreTileset3x3To7x7(coreDataUri, { tileSize });
    console.log(`[sprite-gen] ✓ Expanded tileset ${sheetKey} to ${expanded.columns}x${expanded.rows}`);

    const coreAsset = {
        id: coreKey,
        key: coreKey,
        type: 'image',
        kind: 'tileset_core',
        role: tileset.role || 'environment',
        category: 'tileset',
        width: tileSize * 3,
        height: tileSize * 3,
        tileSize,
        columns: 3,
        rows: 3,
        transparent: false,
        description: tileset.description || '3x3 core tileset',
        url: coreDataUri,
    };
    const sheetAsset = {
        id: sheetKey,
        key: sheetKey,
        type: 'image',
        kind: 'tileset',
        role: tileset.role || 'environment',
        category: 'tileset',
        width: tileSize * 7,
        height: tileSize * 7,
        tileSize,
        columns: 7,
        rows: 7,
        transparent: false,
        description: tileset.description || 'expanded 7x7 tileset',
        url: expanded.dataUri,
    };
    const manifest = {
        key,
        type: 'tileset',
        role: tileset.role || 'environment',
        tileSize,
        coreKey,
        sheetKey,
        coreGrid: '3x3',
        expandedGrid: '7x7',
        columns: 7,
        rows: 7,
        sourceColumns: 3,
        sourceRows: 3,
        imageKey: sheetKey,
        tileKeys: expanded.tileKeys,
        instructions: tileset.instructions || [],
    };

    return { coreAsset, sheetAsset, manifest };
}

async function buildTilesetAssets(tilesets = []) {
    const assets = {};
    const manifestAssets = [];
    const assetPack = [];
    const manifests = [];
    const errors = [];

    for (const tileset of tilesets || []) {
        try {
            const generated = await generateTilesetAsset(tileset);
            for (const asset of [generated.coreAsset, generated.sheetAsset]) {
                assets[asset.key] = asset.url;
                manifestAssets.push(asset);
                assetPack.push(asset);
            }
            manifests.push(generated.manifest);
        } catch (error) {
            const key = tileset?.key || 'world_tileset';
            console.warn(`[Batch Artist Agent] Tileset generation failed for ${key}: ${error.message}`);
            errors.push({ id: key, phase: 'tileset_generation', error: error.message });
            manifests.push({
                key,
                type: 'tileset',
                role: tileset?.role || 'environment',
                tileSize: Number(tileset?.tileSize || 32),
                coreGrid: '3x3',
                expandedGrid: '7x7',
                status: 'failed',
                error: error.message,
                instructions: tileset?.instructions || [],
            });
        }
    }

    return { assets, manifestAssets, assetPack, tilesets: manifests, errors };
}

/**
 * Generate multiple sprites for a game
 * 
 * @param {Object} gameSpec - Phase 1 output with title, intent, searchTerms
 * @returns {Promise<Object>} { player, enemy, item }
 */
export async function generateGameSprites(gameSpec) {
    const { title, intent, searchTerms } = gameSpec;
    
    // Extract sprite descriptions from search terms
    const playerTerm = searchTerms.find(t => 
        t.includes('player') || t.includes('character') || t.includes('hero')
    ) || searchTerms[0];
    
    const enemyTerm = searchTerms.find(t => 
        t.includes('enemy') || t.includes('monster') || t.includes('zombie') || t.includes('obstacle')
    ) || searchTerms[1];
    
    console.log(`[sprite-gen] Generating sprites for: ${title}`);
    
    try {
        // Generate player sprite
        const playerSprite = await generateSprite({
            description: playerTerm,
            type: 'character',
            targetSize: 128,
            removeBg: true,
        });
        
        // Wait a bit to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Generate enemy sprite
        const enemySprite = await generateSprite({
            description: enemyTerm,
            type: 'enemy',
            targetSize: 128,
            removeBg: true,
        });
        
        return {
            player: `data:image/png;base64,${playerSprite}`,
            enemy: `data:image/png;base64,${enemySprite}`,
        };
    } catch (error) {
        console.error('[sprite-gen] Failed to generate sprites:', error);
        return null;
    }
}

function batchHealDelayMs() {
    return Math.max(200, Number(process.env.GAMETOK_ARTIST_HEAL_DELAY_MS || 800));
}

/** Batch/heal may pass either in-flight state ({ results }) or batchArtistAgent return ({ assets }). */
export function normalizeBatchState(batchState = {}) {
    if (!batchState || typeof batchState !== 'object') {
        return {
            results: {},
            assets: {},
            manifestAssets: [],
            assetPack: [],
            animations: [],
            errors: [],
            fallbackCount: 0,
        };
    }
    if (!batchState.results && batchState.assets) {
        batchState.results = batchState.assets;
    }
    if (!batchState.assets && batchState.results) {
        batchState.assets = batchState.results;
    }
    if (!batchState.results) {
        batchState.results = {};
        batchState.assets = batchState.results;
    }
    if (!Array.isArray(batchState.manifestAssets)) batchState.manifestAssets = [];
    if (!Array.isArray(batchState.assetPack)) batchState.assetPack = [];
    if (!Array.isArray(batchState.animations)) batchState.animations = [];
    if (!Array.isArray(batchState.errors)) batchState.errors = [];
    if (typeof batchState.fallbackCount !== 'number') batchState.fallbackCount = 0;
    return batchState;
}

function isRequiredBatchSlot(id, options = {}) {
    const required = options.requiredSlotIds;
    if (!required) return false;
    if (required instanceof Set) return required.has(id);
    if (Array.isArray(required)) return required.includes(id);
    return false;
}

function purgeBatchAssetFrames(batchState, sourceId) {
    normalizeBatchState(batchState);
    const hadFallback = batchState.assetPack.some((asset) => (
        (asset?.id === sourceId || asset?.key === sourceId) && asset?.fallback
    ));
    if (hadFallback) {
        batchState.fallbackCount = Math.max(0, batchState.fallbackCount - 1);
    }
    const prefix = `${sourceId}_`;
    for (const key of Object.keys(batchState.results)) {
        if (key !== sourceId && key.startsWith(prefix)) {
            delete batchState.results[key];
        }
    }
    batchState.manifestAssets = batchState.manifestAssets.filter((asset) => {
        const assetId = String(asset?.id || asset?.key || '');
        return assetId !== sourceId && !assetId.startsWith(prefix) && asset?.sourceKey !== sourceId;
    });
    batchState.assetPack = batchState.assetPack.filter((asset) => {
        const assetId = String(asset?.id || asset?.key || '');
        return assetId !== sourceId && !assetId.startsWith(prefix) && asset?.sourceKey !== sourceId;
    });
    batchState.animations = batchState.animations.filter((animation) => animation?.sourceKey !== sourceId);
    batchState.errors = batchState.errors.filter((entry) => entry?.id !== sourceId);
}

function buildBatchAssetMeta(id, request, dataUri, { usedFallback = false, generationSource = 'flux', inspectionReason = null } = {}) {
    const category = request.category || request.role || 'item';
    const width = Number(request.width || request.size || 128);
    const height = Number(request.height || request.size || width);
    return {
        id,
        key: id,
        type: 'image',
        kind: request.assetType || 'sprite',
        role: category,
        category,
        width,
        height,
        transparent: request.transparent !== false,
        description: request.description || '',
        gameplayRole: request.gameplayRole || '',
        url: dataUri,
        fallback: usedFallback,
        generationSource,
        inspectionReason,
    };
}

function recordBatchAssetSuccess(batchState, id, request, dataUri, artistResult) {
    normalizeBatchState(batchState);
    const usedFallback = typeof artistResult === 'object' ? Boolean(artistResult.usedFallback) : false;
    const generationSource = typeof artistResult === 'object'
        ? (artistResult.generationSource || (usedFallback ? 'fallback' : 'flux'))
        : 'flux';
    if (usedFallback) {
        batchState.fallbackCount += 1;
        batchState.errors.push({
            id,
            phase: 'asset_generation',
            error: artistResult?.inspectionReason || 'fallback_art_used',
            generationSource,
        });
    }
    batchState.results[id] = dataUri;
    const assetMeta = buildBatchAssetMeta(id, request, dataUri, {
        usedFallback,
        generationSource,
        inspectionReason: artistResult?.inspectionReason || null,
    });
    batchState.manifestAssets.push(assetMeta);
    batchState.assetPack.push({ ...assetMeta });
}

async function attachBatchFrameAssets(batchState, id, request, dataUri, width, height) {
    try {
        const frameBundle = await buildFrameAssetsForRequest(id, request, dataUri, width, height);
        for (const frame of frameBundle.frames) {
            batchState.results[frame.key] = frame.url;
            batchState.manifestAssets.push(frame);
            batchState.assetPack.push(frame);
        }
        batchState.animations.push(...frameBundle.animations);
        if (frameBundle.frames.length > 0) {
            console.log(`[Batch Artist Agent] ✓ Generated ${frameBundle.frames.length} animation frames for ${id}`);
        }
    } catch (frameError) {
        console.warn(`[Batch Artist Agent] Animation frame generation skipped for ${id}:`, frameError.message);
    }
}

async function recordBatchAssetFallback(batchState, id, request, width, height, errorMessage = 'generation_failed') {
    batchState.errors.push({ id, error: errorMessage, generationSource: 'fallback' });
    batchState.fallbackCount += 1;
    const dataUri = await generateFallbackAsset(
        Math.max(width, height),
        request.category || request.role || 'item',
        request.assetType || 'sprite',
        { width, height },
    );
    recordBatchAssetSuccess(batchState, id, request, dataUri, {
        usedFallback: true,
        generationSource: 'fallback',
        inspectionReason: errorMessage,
    });
    await attachBatchFrameAssets(batchState, id, request, dataUri, width, height);
}

/**
 * Generate (or regenerate) one asset into a batch result object.
 * Required slots retry FLUX before accepting procedural fallback.
 */
export async function generateOneBatchAsset(batchState, request, id, options = {}) {
    normalizeBatchState(batchState);
    const { id: requestId, ...assetRequest } = request;
    const category = assetRequest.category || request.category || 'item';
    const width = Number(assetRequest.width || request.width || assetRequest.size || request.size || 128);
    const height = Number(assetRequest.height || request.height || assetRequest.size || request.size || width);
    const required = isRequiredBatchSlot(id, options);
    const maxAttempts = required
        ? Math.max(1, Math.min(4, Number(options.maxRetriesPerRequired || process.env.GAMETOK_ARTIST_REQUIRED_RETRIES || 2)))
        : 1;

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
            throw new Error('Generation cancelled by user');
        }
        try {
            const artistResult = await artistAgent(assetRequest);
            const dataUri = typeof artistResult === 'string' ? artistResult : artistResult.dataUri;
            const usedFallback = typeof artistResult === 'object' ? Boolean(artistResult.usedFallback) : false;
            if (required && usedFallback && attempt < maxAttempts) {
                console.warn(`[Batch Artist Agent] Required ${id} used fallback on attempt ${attempt}/${maxAttempts}; retrying...`);
                await new Promise((resolve) => setTimeout(resolve, batchHealDelayMs()));
                continue;
            }
            purgeBatchAssetFrames(batchState, id);
            recordBatchAssetSuccess(batchState, id, request, dataUri, artistResult);
            await attachBatchFrameAssets(batchState, id, request, dataUri, width, height);
            return { ok: !usedFallback, usedFallback, attempt };
        } catch (error) {
            if (error?.message === 'Generation cancelled by user') {
                throw error;
            }
            lastError = error;
            if (required && attempt < maxAttempts) {
                console.warn(`[Batch Artist Agent] Required ${id} failed (${error.message}); retry ${attempt}/${maxAttempts}`);
                await new Promise((resolve) => setTimeout(resolve, batchHealDelayMs()));
                continue;
            }
            break;
        }
    }

    purgeBatchAssetFrames(batchState, id);
    await recordBatchAssetFallback(batchState, id, request, width, height, lastError?.message || 'generation_failed');
    return { ok: false, usedFallback: true, error: lastError?.message || 'generation_failed' };
}

/** Concurrency for batch asset generation. Spread across the NVIDIA key pool. */
function artistBatchConcurrency() {
    const raw = Number(process.env.GAMETOK_ARTIST_CONCURRENCY);
    if (Number.isFinite(raw) && raw > 0) return Math.min(8, Math.floor(raw));
    return 4;
}

/** Fold an isolated per-request batch state into the shared aggregate, preserving order. */
function mergeBatchState(target, source) {
    normalizeBatchState(target);
    normalizeBatchState(source);
    Object.assign(target.results, source.results);
    target.manifestAssets.push(...source.manifestAssets);
    target.assetPack.push(...source.assetPack);
    target.animations.push(...source.animations);
    target.errors.push(...source.errors);
    target.fallbackCount += source.fallbackCount;
}

/**
 * Generate all requests concurrently (bounded), each into its own isolated batch state, then
 * merge results back in request order. generateOneBatchAsset already retries + falls back per
 * request, so an isolated state never half-fails the aggregate.
 */
async function runBatchRequestsConcurrently(requests, options, aggregate) {
    const isolatedStates = new Array(requests.length);
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= requests.length) return;
            const request = requests[index];
            const isolated = normalizeBatchState({});
            await generateOneBatchAsset(isolated, request, request.id, options);
            isolatedStates[index] = isolated;
        }
    };
    const workerCount = Math.max(1, Math.min(artistBatchConcurrency(), requests.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    for (const isolated of isolatedStates) {
        if (isolated) mergeBatchState(aggregate, isolated);
    }
}

/**
 * BATCH ARTIST AGENT - Generate multiple assets in one call
 *
 * This is optimized for Phase 2 to request all needed assets at once.
 * Generates assets concurrently (bounded) across the NVIDIA key pool.
 *
 * @param {Array<Object>} requests - Array of asset requests
 * @returns {Promise<Object>} Map of asset IDs to data URIs
 */
export async function batchArtistAgent(requests, options = {}) {
    console.log(`[Batch Artist Agent] Generating ${requests.length} assets...`);
    const modelStatus = assetModelRouter.getStatus();
    console.log(`[Batch Artist Agent] Model router: image=${modelStatus.textImage.provider}/${modelStatus.textImage.model} edit=${modelStatus.imageEdit.provider}/${modelStatus.imageEdit.model}`);
    
    const results = {};
    const errors = [];
    const manifestAssets = [];
    const assetPack = [];
    const animations = [];
    const tilesets = [];
    let fallbackCount = 0;
    
    // Generate assets concurrently (bounded) across the NVIDIA key pool. Each request runs in an
    // isolated batch state and is merged back in request order, so output stays deterministic.
    const batchState = normalizeBatchState({
        results,
        assets: results,
        errors,
        manifestAssets,
        assetPack,
        animations,
        fallbackCount,
    });

    const concurrency = Math.max(1, Math.min(artistBatchConcurrency(), requests.length));
    console.log(`[Batch Artist Agent] Concurrency=${concurrency} across ${requests.length} requests`);
    if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
        throw new Error('Generation cancelled by user');
    }
    await runBatchRequestsConcurrently(requests, options, batchState);

    fallbackCount = batchState.fallbackCount;

    if (Array.isArray(options.tilesets) && options.tilesets.length > 0) {
        if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
            throw new Error('Generation cancelled by user');
        }
        console.log(`[Batch Artist Agent] Generating ${options.tilesets.length} tilesets...`);
        const tilesetBundle = await buildTilesetAssets(options.tilesets);
        Object.assign(results, tilesetBundle.assets);
        manifestAssets.push(...tilesetBundle.manifestAssets);
        assetPack.push(...tilesetBundle.assetPack);
        tilesets.push(...tilesetBundle.tilesets);
        errors.push(...tilesetBundle.errors);
    }
    
    console.log(`[Batch Artist Agent] ✓ Generated ${Object.keys(results).length} assets (${fallbackCount} fallbacks)`);
    
    return {
        assets: results,
        results,
        manifest: {
            version: 1,
            assets: manifestAssets,
        },
        assetPack,
        animations,
        tilesets,
        errors: errors.length > 0 ? errors : null,
        fallbackCount,
    };
}
