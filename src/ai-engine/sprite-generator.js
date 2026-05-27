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
    const minChars = isBackground
        ? Math.max(8000, Math.round((width * height) / 20))
        : Math.max(350, Math.round((width * height) / 16));

    if (text.length < minChars) {
        return { ok: false, reason: `payload_too_small (${text.length} chars)` };
    }

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
            return { ok: true, reason: 'background_ok' };
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
        prop: 'item',
        obstacle: 'item',
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

    const fallbackUri = await generateFallbackAsset(Math.max(targetWidth, targetHeight), category);
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

async function generateWithFlux(prompt, dimensions = 768) {
    return assetModelRouter.generateImage(prompt, dimensions);
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
        enemy: 'professional mobile game sprite, creature or opponent design, centered, full body view, clean silhouette, game asset style',
        background: 'professional mobile game background, environment scene, atmospheric, layered scenery, game asset style',
        ui: 'professional mobile game icon or decorative UI source art, clean design, game asset style',
    };
    
    const base = basePrompts[type] || basePrompts.character;
    
    // Content filter avoidance: replace sensitive words
    const safeDescription = String(description)
        .replace(/\bzombie\b/gi, 'undead creature')
        .replace(/\bgun\b/gi, 'blaster')
        .replace(/\brifle\b/gi, 'weapon')
        .replace(/\bblood\b/gi, 'red particles')
        .replace(/\bgore\b/gi, 'effects')
        .replace(/\bkill\b/gi, 'defeat')
        .replace(/\bdead\b/gi, 'fallen')
        .replace(/\bviolent\b/gi, 'action-packed');
    
    const backgroundInstruction = type === 'background'
        ? 'full-bleed scenery only, layered depth, clean readable composition, no text, no labels, no HUD, no buttons, no foreground characters, no UI overlays'
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
            prop: 'item',
            obstacle: 'item',
        };
        const spriteType = assetType === 'background' ? 'background' : (typeMap[category] || 'character');
        
        // Generate the asset
        const base64Image = await generateSprite({
            description,
            type: spriteType,
            targetSize: width || height ? { width: width || size, height: height || width || size } : size,
            removeBg: spriteType === 'background' ? false : transparent,
        });

        const resolved = await resolveGeneratedAssetDataUri(
            `data:image/png;base64,${base64Image}`,
            request,
            `${assetType}:${category}`,
        );
        console.log(
            `[Artist Agent] ✓ Generated ${assetType} (${resolved.dataUri.length} chars`
            + `${resolved.usedFallback ? ', fallback' : resolved.retried ? ', retried' : ''})`,
        );
        return resolved.dataUri;
    } catch (error) {
        console.error(`[Artist Agent] Failed to generate ${assetType}:`, error.message);
        return generateFallbackAsset(size, category);
    }
}

/**
 * Generate a fallback PNG placeholder if AI generation fails or quality checks reject output.
 */
async function generateFallbackAsset(size, category) {
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

/**
 * BATCH ARTIST AGENT - Generate multiple assets in one call
 * 
 * This is optimized for Phase 2 to request all needed assets at once.
 * Generates assets sequentially to avoid rate limits.
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
    
    // Generate assets sequentially to avoid rate limits
    // (NVIDIA free tier has rate limits)
    for (const request of requests) {
        if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
            throw new Error('Generation cancelled by user');
        }
        const { id, ...assetRequest } = request;
        const category = assetRequest.category || request.category || 'item';
        const width = Number(assetRequest.width || request.width || assetRequest.size || request.size || 128);
        const height = Number(assetRequest.height || request.height || assetRequest.size || request.size || width);
        const size = width === height ? width : { width, height };
        
        try {
            const dataUri = await artistAgent(assetRequest);
            results[id] = dataUri;
            const assetMeta = {
                id,
                key: id,
                type: 'image',
                kind: assetRequest.assetType || request.assetType || 'sprite',
                role: category,
                category,
                width,
                height,
                transparent: assetRequest.transparent !== false,
                description: assetRequest.description || request.description || '',
                gameplayRole: assetRequest.gameplayRole || request.gameplayRole || '',
                url: dataUri,
            };
            manifestAssets.push(assetMeta);
            assetPack.push({
                id,
                key: id,
                type: 'image',
                kind: assetRequest.assetType || request.assetType || 'sprite',
                url: dataUri,
                width,
                height,
                role: category,
                category,
                transparent: assetRequest.transparent !== false,
                description: assetRequest.description || request.description || '',
                gameplayRole: assetRequest.gameplayRole || request.gameplayRole || '',
            });

            try {
                const frameBundle = await buildFrameAssetsForRequest(id, assetRequest, dataUri, width, height);
                for (const frame of frameBundle.frames) {
                    results[frame.key] = frame.url;
                    manifestAssets.push(frame);
                    assetPack.push(frame);
                }
                animations.push(...frameBundle.animations);
                if (frameBundle.frames.length > 0) {
                    console.log(`[Batch Artist Agent] ✓ Generated ${frameBundle.frames.length} animation frames for ${id}`);
                }
            } catch (frameError) {
                console.warn(`[Batch Artist Agent] Animation frame generation skipped for ${id}:`, frameError.message);
            }
            
            // Small delay between requests to avoid rate limiting
            if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
                throw new Error('Generation cancelled by user');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            if (error?.message === 'Generation cancelled by user') {
                throw error;
            }
            console.error(`[Batch Artist Agent] Failed to generate ${id}:`, error.message);
            errors.push({ id, error: error.message });
            // Generate fallback
            const dataUri = await generateFallbackAsset(Math.max(width, height), category);
            results[id] = dataUri;
            const assetMeta = {
                id,
                key: id,
                type: 'image',
                kind: assetRequest.assetType || request.assetType || 'sprite',
                role: category,
                category,
                width,
                height,
                transparent: assetRequest.transparent !== false,
                description: assetRequest.description || request.description || '',
                gameplayRole: assetRequest.gameplayRole || request.gameplayRole || '',
                url: dataUri,
                fallback: true,
            };
            manifestAssets.push(assetMeta);
            assetPack.push({
                id,
                key: id,
                type: 'image',
                kind: assetRequest.assetType || request.assetType || 'sprite',
                url: dataUri,
                width,
                height,
                role: category,
                category,
                transparent: assetRequest.transparent !== false,
                description: assetRequest.description || request.description || '',
                gameplayRole: assetRequest.gameplayRole || request.gameplayRole || '',
                fallback: true,
            });
        }
    }

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
    
    console.log(`[Batch Artist Agent] ✓ Generated ${Object.keys(results).length} assets (${errors.length} fallbacks)`);
    
    return {
        assets: results,
        manifest: {
            version: 1,
            assets: manifestAssets,
        },
        assetPack,
        animations,
        tilesets,
        errors: errors.length > 0 ? errors : null,
    };
}
