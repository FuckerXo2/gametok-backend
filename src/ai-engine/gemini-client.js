import OpenAI from 'openai';
import fs from 'node:fs';
import { recordGeminiUsage } from './token-tracker.js';

export const GEMINI_FLASH_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash'];

export function getGeminiConfig(env = process.env) {
    const apiKey = String(env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
    }

    return {
        apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: String(env.GEMINI_MODEL || GEMINI_FLASH_MODEL).trim(),
    };
}

export function createGeminiClient(env = process.env) {
    const config = getGeminiConfig(env);
    if (!config) return null;

    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: 45000,
    });
}

/**
 * Call Gemini Flash for structured JSON game code generation
 * Automatically falls back to gemini-3.8-flash if 3.7 experiences temporary traffic spikes
 * 
 * @param {{ systemPrompt: string, messages: Array<any>, temperature?: number, maxTokens?: number, model?: string }} args
 * @param {object} env
 */
export async function callGeminiFlashJson({ systemPrompt, messages = [], temperature = 0.3, maxTokens = null, model = null, jobId = null }, env = process.env) {
    const config = getGeminiConfig(env);
    if (!config) {
        throw new Error('Gemini API key missing (set GEMINI_API_KEY in .env)');
    }

    const client = createGeminiClient(env);
    const targetModel = model || config.model;

    const formattedMessages = systemPrompt 
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [...messages];

    async function executeCall(m) {
        const payload = {
            model: m,
            response_format: { type: 'json_object' },
            messages: formattedMessages,
        };
        if (maxTokens) {
            payload.max_tokens = maxTokens;
        }
        const response = await client.chat.completions.create(payload);

        if (response.usage) {
            if (jobId) {
                recordGeminiUsage(jobId, response.usage);
            }
            console.log(`🧠 [Gemini Client] Model ${m} tokens: ${response.usage.prompt_tokens} prompt / ${response.usage.completion_tokens} completion (Total: ${response.usage.total_tokens})`);
        }

        let content = (response.choices?.[0]?.message?.content || '{}').trim();
        
        function cleanAndParse(raw) {
            if (!raw) return null;
            let str = raw.trim();
            if (str.startsWith('```')) {
                str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            }
            // 1. Direct try
            try { return JSON.parse(str); } catch (_) {}

            // 2. Strip trailing commas before closing braces/brackets
            let sanitized = str.replace(/,\s*([\]}])/g, '$1');
            try { return JSON.parse(sanitized); } catch (_) {}

            // 3. Insert missing commas between objects: } { -> }, {
            sanitized = sanitized.replace(/\}\s*\{/g, '},{');
            try { return JSON.parse(sanitized); } catch (_) {}

            // 4. Insert missing commas between lines: "val" \n "key": -> "val", \n "key":
            sanitized = sanitized.replace(/(["\d\]}])\s*\n\s*"/g, '$1,\n"');
            try { return JSON.parse(sanitized); } catch (_) {}

            // 5. Extract outermost object
            const startObj = sanitized.indexOf('{');
            const endObj = sanitized.lastIndexOf('}');
            if (startObj !== -1 && endObj > startObj) {
                try {
                    return JSON.parse(sanitized.slice(startObj, endObj + 1));
                } catch (_) {}
            }

            // 6. Extract outermost array
            const startArr = sanitized.indexOf('[');
            const endArr = sanitized.lastIndexOf(']');
            if (startArr !== -1 && endArr > startArr) {
                try {
                    return JSON.parse(sanitized.slice(startArr, endArr + 1));
                } catch (_) {}
            }

            // 7. Regex recovery: salvage valid JSON objects from broken responses
            const objectMatches = str.match(/\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}/g);
            if (objectMatches && objectMatches.length > 0) {
                const recovered = [];
                for (const m of objectMatches) {
                    try { recovered.push(JSON.parse(m)); } catch (_) {}
                }
                if (recovered.length >= 3) {
                    if (str.includes('directions')) return { directions: recovered };
                    if (str.includes('perspectives')) return { perspectives: recovered };
                }
            }

            // Safe fallback: never throw raw exception
            try {
                return JSON.parse(str);
            } catch (_) {
                return null;
            }
        }

        const parsed = cleanAndParse(content);
        if (parsed && typeof parsed === 'object' && response.usage) {
            try {
                Object.defineProperty(parsed, '_usage', {
                    value: response.usage,
                    enumerable: false,
                    writable: true,
                });
            } catch (_) {}
        }
        return parsed;
    }

    const candidateModels = [targetModel, ...GEMINI_FALLBACK_MODELS.filter(m => m !== targetModel)];
    let lastError = null;

    for (const m of candidateModels) {
        try {
            return await executeCall(m);
        } catch (err) {
            lastError = err;
            const isTemporary = err.status === 503 || err.status === 429 ||
                String(err.message).includes('503') ||
                String(err.message).includes('429') ||
                String(err.message).includes('UNAVAILABLE') ||
                String(err.message).includes('high demand');
            if (isTemporary) {
                console.warn(`[Gemini Client] Model ${m} unavailable (${err.status || err.message}), waiting 1000ms before failover...`);
                await new Promise(res => setTimeout(res, 1000));
                continue;
            }
            throw err;
        }
    }

    throw lastError;
}

const visualAnalysisCache = new Map();

/**
 * Use Gemini 3.8 Flash Multimodal Vision to deconstruct a visual style card or camera perspective image
 * into concrete, code-ready 3D/2D visual blueprints for Hermes Agent.
 *
 * @param {object} params
 * @param {string} params.imageUrl - URL or local file path of the image
 * @param {string} [params.prompt] - Optional custom prompt
 * @param {boolean} [params.is2D] - Whether this is a 2D game
 * @param {string} [params.jobId] - Optional tracking job ID
 * @param {object} [env]
 * @returns {Promise<string|null>} Structured visual blueprint text
 */
export async function analyzeVisualReferenceWithGemini({ imageUrl, prompt = null, is2D = false, jobId = null }, env = process.env) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    const cacheKey = `${imageUrl}_${is2D ? '2d' : '3d'}`;
    if (visualAnalysisCache.has(cacheKey)) {
        console.log(`👁️ [Gemini Vision] Using cached visual blueprint for reference image.`);
        return visualAnalysisCache.get(cacheKey);
    }

    try {
        let base64DataUrl = null;
        if (imageUrl.startsWith('data:image/')) {
            base64DataUrl = imageUrl;
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            console.log(`👁️ [Gemini Vision] Fetching visual style card for analysis: ${imageUrl.slice(0, 90)}...`);
            const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching image from ${imageUrl}`);
            const arrayBuffer = await res.arrayBuffer();
            const mimeType = res.headers.get('content-type') || 'image/png';
            base64DataUrl = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
        } else if (fs.existsSync(imageUrl)) {
            const fileBuf = fs.readFileSync(imageUrl);
            const ext = imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg') ? 'jpeg' : 'png';
            base64DataUrl = `data:image/${ext};base64,${fileBuf.toString('base64')}`;
        } else {
            console.warn(`[Gemini Vision] Image reference not accessible: ${imageUrl}`);
            return null;
        }

        const client = createGeminiClient(env);
        if (!client) return null;

        const defaultPrompt = is2D
            ? `Analyze this 2D game visual preview card in extreme technical detail for an HTML5 Canvas 2D game developer. Provide an exact, concrete visual blueprint:
1. Core Color Palette: Dominant background, arena/grid border, entity/tile colors, and particle accents with exact hex codes.
2. Background Atmosphere: Gradients, starfields, grid overlays, or subtle textures to render in canvas.
3. Entity & Item Aesthetics: Outline thickness, drop shadows, glow effects, corner radii, and iconography style.
4. Particle & Juiciness VFX: Burst colors, trails, screen flash colors on points/combo.
Keep it concise, code-ready, and highly actionable.`
            : `Analyze this 3D game visual preview card in extreme technical detail for a Three.js / WebGL game developer. Provide an exact, concrete visual blueprint:
1. Core Color Palette: Arena floor, boundaries, background void/sky, and glowing accents with exact hex codes.
2. Lighting & Atmosphere: Key light color, ambient light intensity, fog color and density (e.g. THREE.FogExp2), and shadow style.
3. Arena & Floor Geometry: Floor material (hexagonal tiles, glossy grid, stone, metallic roughness, reflectivity), boundary walls/pillars, and distant backdrop structures.
4. Camera & Perspective: View angle (isometric, top-down, third-person), camera height/tilt, and field of view.
5. VFX & Shaders: Particle sparks, bloom/glow colors, pulse rings, and material emissive highlights.
Keep it concise, code-ready, and highly actionable.`;

        const messages = [
            {
                role: 'system',
                content: 'You are an elite game art director and graphics programmer with computer vision mastery. Your job is to visually inspect game reference cards and deconstruct their exact visual DNA into actionable specifications for game code generation.'
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt || defaultPrompt,
                    },
                    {
                        type: 'image_url',
                        image_url: { url: base64DataUrl },
                    }
                ]
            }
        ];

        console.log(`👁️ [Gemini Vision] Inspecting visual style card with Gemini 3.8 Flash Vision...`);

        // Retry with backoff on transient 503/429 errors (same pattern as art director failover)
        let blueprint = null;
        const maxVisionRetries = 3;
        for (let vAttempt = 0; vAttempt < maxVisionRetries; vAttempt++) {
            try {
                const response = await client.chat.completions.create({
                    model: GEMINI_FLASH_MODEL,
                    messages,
                    max_tokens: 800,
                });

                if (response.usage && jobId) {
                    recordGeminiUsage(jobId, response.usage);
                }

                blueprint = response.choices?.[0]?.message?.content?.trim() || null;
                break; // success — exit retry loop
            } catch (apiErr) {
                const status = apiErr?.status || apiErr?.response?.status || 0;
                const isRetryable = status === 503 || status === 429 || status >= 500;
                if (isRetryable && vAttempt < maxVisionRetries - 1) {
                    const delay = 1500 * (vAttempt + 1);
                    console.warn(`👁️ [Gemini Vision] Attempt ${vAttempt + 1} failed (${status}), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw apiErr; // non-retryable or exhausted retries
            }
        }

        if (blueprint) {
            console.log(`✅ [Gemini Vision] Extracted rich visual blueprint (${blueprint.length} chars) from image.`);
            visualAnalysisCache.set(cacheKey, blueprint);
        }
        return blueprint;
    } catch (err) {
        console.warn(`⚠️ [Gemini Vision] Visual analysis skipped (${err.message}). Proceeding with text directives.`);
        return null;
    }
}

