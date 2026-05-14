/**
 * Artist Agent - AI-Driven Asset Generation
 * 
 * This is the "Artist Agent" that Phase 2 (Kimi) calls to generate ALL game assets.
 * Completely replaces the 84K asset library with on-demand AI generation.
 * 
 * Flow:
 * 1. Generate image with FLUX.1-schnell (FREE, fast)
 * 2. Remove sprite backgrounds with IMG.LY locally, then optional hosted/local fallbacks
 * 3. Downscale to target size (64/128/256px) with Sharp
 * 4. Return base64 PNG data URI
 * 
 * Generation time: ~3-5 seconds per sprite
 * Cost: $0 (completely free on NVIDIA build.nvidia.com)
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
const FAL_RMBG_URL = 'https://fal.run/fal-ai/bria/background/remove';
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || process.env.HUGGING_FACE_API_KEY || '';
const HF_IMAGE_EDIT_ENABLED = process.env.HF_IMAGE_EDIT_ENABLED === 'true';
const HF_IMAGE_EDIT_MODEL = process.env.HF_IMAGE_EDIT_MODEL || 'black-forest-labs/FLUX.1-Kontext-dev';
const HF_IMAGE_EDIT_PROVIDER = process.env.HF_IMAGE_EDIT_PROVIDER || 'fal-ai';
const HF_IMAGE_EDIT_URL = process.env.HF_IMAGE_EDIT_URL || `https://api-inference.huggingface.co/models/${HF_IMAGE_EDIT_MODEL}`;
const HF_IMAGE_EDIT_TIMEOUT_MS = Number(process.env.HF_IMAGE_EDIT_TIMEOUT_MS || 180000);
const HF_IMAGE_EDIT_STEPS = Number(process.env.HF_IMAGE_EDIT_STEPS || 28);
const HF_IMAGE_EDIT_GUIDANCE = Number(process.env.HF_IMAGE_EDIT_GUIDANCE || 3.5);
const BACKGROUND_DISTANCE_THRESHOLD = Number(process.env.SPRITE_BG_DISTANCE_THRESHOLD || 92);
const EDGE_SAMPLE_SIZE = 12;
const IMGLY_RMBG_DISABLED = process.env.IMGLY_RMBG_DISABLED === 'true';
const IMGLY_RMBG_MODEL = process.env.IMGLY_RMBG_MODEL || 'medium';
const IMGLY_RMBG_TIMEOUT_MS = Number(process.env.IMGLY_RMBG_TIMEOUT_MS || 90000);

function stripDataUrl(imageBase64OrDataUrl) {
    return String(imageBase64OrDataUrl || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
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
    const { width, height } = normalizeDimensions(dimensions);
    const response = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${NVIDIA_API_KEY}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt,
            width,
            height,
            cfg_scale: 0,
            mode: 'base',
            samples: 1,
            steps: 4,
            seed: Math.floor(Math.random() * 4_000_000_000),
        }),
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`FLUX generation failed: ${response.status} ${text.slice(0, 200)}`);
    }
    
    const json = await response.json();
    const artifact = json?.artifacts?.[0];
    
    if (!artifact || !artifact.base64) {
        throw new Error('FLUX returned no image');
    }
    
    return artifact.base64;
}

function parseImageResponse(json) {
    const candidates = [
        json?.image,
        json?.image_base64,
        json?.b64_json,
        json?.data?.[0]?.b64_json,
        json?.data?.[0]?.image,
        json?.artifacts?.[0]?.base64,
        json?.images?.[0],
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (typeof candidate === 'string') return candidate;
        if (typeof candidate?.url === 'string') return candidate.url;
        if (typeof candidate?.base64 === 'string') return candidate.base64;
    }

    return null;
}

async function fetchImageAsBase64(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`image download failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
}

async function editImageWithHuggingFace(referenceDataUri, prompt, dimensions) {
    if (!HF_IMAGE_EDIT_ENABLED) {
        return { ok: false, skipped: 'disabled' };
    }
    if (!HF_TOKEN) {
        return { ok: false, skipped: 'missing_hf_token' };
    }

    const { width, height } = normalizeDimensions(dimensions);
    const payload = {
        inputs: stripDataUrl(referenceDataUri),
        parameters: {
            prompt,
            negative_prompt: 'text, labels, watermark, extra characters, cropped subject, duplicate subject, busy background, UI, button, frame, border',
            num_inference_steps: HF_IMAGE_EDIT_STEPS,
            guidance_scale: HF_IMAGE_EDIT_GUIDANCE,
            target_size: { width, height },
        },
        options: {
            wait_for_model: true,
            use_cache: false,
        },
        provider: HF_IMAGE_EDIT_PROVIDER,
    };

    const response = await withTimeout(fetch(HF_IMAGE_EDIT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            Accept: 'image/png, application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    }), HF_IMAGE_EDIT_TIMEOUT_MS, 'Hugging Face image edit');

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HF image edit failed: ${response.status} ${text.slice(0, 400)}`);
    }

    if (contentType.startsWith('image/')) {
        const arrayBuffer = await response.arrayBuffer();
        return {
            ok: true,
            imageBase64: Buffer.from(arrayBuffer).toString('base64'),
            method: `hf:${HF_IMAGE_EDIT_MODEL}`,
        };
    }

    const json = await response.json();
    const image = parseImageResponse(json);
    if (!image) {
        throw new Error('HF image edit returned no image');
    }

    const imageBase64 = String(image).startsWith('http://') || String(image).startsWith('https://')
        ? await fetchImageAsBase64(image)
        : stripDataUrl(image);

    return {
        ok: true,
        imageBase64,
        method: `hf:${HF_IMAGE_EDIT_MODEL}`,
    };
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
    console.log(`[sprite-gen] ✓ Generated ${dimensions.width}x${dimensions.height} image`);
    
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
            ui: 'ui',
            prop: 'item',
            obstacle: 'item',
        };
        const spriteType = typeMap[category] || 'character';
        
        // Generate the asset
        const base64Image = await generateSprite({
            description,
            type: spriteType,
            targetSize: width || height ? { width: width || size, height: height || width || size } : size,
            removeBg: transparent,
        });
        
        // Return as data URI
        const dataUri = `data:image/png;base64,${base64Image}`;
        console.log(`[Artist Agent] ✓ Generated ${assetType} (${dataUri.length} chars)`);
        
        return dataUri;
    } catch (error) {
        console.error(`[Artist Agent] Failed to generate ${assetType}:`, error.message);
        // Return a fallback colored square so the game doesn't break
        return generateFallbackAsset(size, category);
    }
}

/**
 * Generate a fallback colored square if AI generation fails
 */
function generateFallbackAsset(size, category) {
    // Simple colored square as fallback
    const colors = {
        player: '#4ade80',
        enemy: '#f87171',
        item: '#fbbf24',
        vehicle: '#60a5fa',
        environment: '#94a3b8',
        ui: '#a78bfa',
        prop: '#c084fc',
        obstacle: '#c084fc',
    };
    const color = colors[category] || '#9ca3af';
    
    // Create a simple SVG square and convert to data URI
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${color}"/></svg>`;
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
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

function buildFrameEditPrompt(assetRequest, category, variant, index, totalFrames) {
    const description = assetRequest.description || assetRequest.gameplayRole || category;
    const actionPrompts = {
        idle: 'subtle idle breathing pose, same stance and silhouette, tiny lively change',
        move: 'dynamic movement frame with shifted limbs or body motion, same character, same camera angle',
        hit: 'impact reaction frame with squash, recoil, bright action emphasis, same character',
        pulse: 'glowing pulse variant with slightly stronger energy and readable silhouette',
    };
    const action = actionPrompts[variant.name] || variant.name;

    return [
        `Edit the reference into animation frame ${index + 1} of ${totalFrames} for a mobile game sprite.`,
        `Subject: ${description}.`,
        `Action: ${action}.`,
        `Keep the exact same subject identity, art style, proportions, camera angle, facing direction, and centered placement.`,
        `Keep one foreground asset only with clear empty margin. Do not add text, UI, borders, labels, extra characters, or scenery.`,
        `Output should remain a clean game sprite suitable for transparent-background extraction.`,
    ].join(' ');
}

async function createSemanticFrameVariant(dataUri, width, height, assetRequest, category, variant, index, totalFrames) {
    const prompt = buildFrameEditPrompt(assetRequest, category, variant, index, totalFrames);
    const edited = await editImageWithHuggingFace(dataUri, prompt, { width, height });
    if (!edited.ok) return null;

    let processedImage = edited.imageBase64;
    const backgroundResult = await removeBackground(processedImage);
    processedImage = backgroundResult.imageBase64;
    const finalImage = await downscaleImage(processedImage, { width, height });

    return {
        dataUri: `data:image/png;base64,${finalImage}`,
        method: edited.method,
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

        try {
            const semanticFrame = await createSemanticFrameVariant(dataUri, width, height, assetRequest, category, variant, index, variants.length);
            if (semanticFrame?.dataUri) {
                frameUri = semanticFrame.dataUri;
                generationMethod = semanticFrame.method;
                console.log(`[sprite-gen] ✓ Semantic frame ${frameId} via ${generationMethod}`);
            }
        } catch (error) {
            console.warn(`[sprite-gen] Semantic frame ${frameId} failed, using local transform: ${error.message}`);
        }

        if (!frameUri) {
            frameUri = await createFrameVariant(dataUri, width, height, variant);
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
export async function batchArtistAgent(requests) {
    console.log(`[Batch Artist Agent] Generating ${requests.length} assets...`);
    
    const results = {};
    const errors = [];
    const manifestAssets = [];
    const assetPack = [];
    const animations = [];
    
    // Generate assets sequentially to avoid rate limits
    // (NVIDIA free tier has rate limits)
    for (const request of requests) {
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
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`[Batch Artist Agent] Failed to generate ${id}:`, error.message);
            errors.push({ id, error: error.message });
            // Generate fallback
            const dataUri = generateFallbackAsset(Math.max(width, height), category);
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
    
    console.log(`[Batch Artist Agent] ✓ Generated ${Object.keys(results).length} assets (${errors.length} fallbacks)`);
    
    return {
        assets: results,
        manifest: {
            version: 1,
            assets: manifestAssets,
        },
        assetPack,
        animations,
        errors: errors.length > 0 ? errors : null,
    };
}
