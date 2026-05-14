const DEFAULT_NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

export function stripImageDataUrl(imageBase64OrDataUrl) {
    return String(imageBase64OrDataUrl || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

export function asPngDataUrl(imageBase64OrDataUrl) {
    const value = String(imageBase64OrDataUrl || '');
    return value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`;
}

export function normalizeImageDimensions(widthOrSize = 768, height = null) {
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

export function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
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
        json?.url,
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

async function parseImageHttpResponse(response, label) {
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${label} failed: ${response.status} ${text.slice(0, 500)}`);
    }

    if (contentType.startsWith('image/')) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer).toString('base64');
    }

    const json = await response.json();
    const image = parseImageResponse(json);
    if (!image) {
        throw new Error(`${label} returned no image`);
    }

    if (String(image).startsWith('http://') || String(image).startsWith('https://')) {
        return fetchImageAsBase64(image);
    }
    return stripImageDataUrl(image);
}

function hfHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'image/png, application/json',
        'Content-Type': 'application/json',
    };
}

export function resolveAssetModelConfig(env = process.env) {
    const hfToken = env.HF_TOKEN || env.HUGGINGFACE_API_KEY || env.HUGGING_FACE_API_KEY || '';
    const hfBaseUrl = String(env.HF_IMAGE_BASE_URL || 'https://api-inference.huggingface.co/models').replace(/\/+$/, '');
    const hfProvider = env.HF_IMAGE_PROVIDER || 'auto';
    const hfEnabled = env.HF_IMAGE_ENABLED === 'true' || (env.HF_IMAGE_ENABLED !== 'false' && Boolean(hfToken));
    const hfEditEnabled = env.HF_IMAGE_EDIT_ENABLED === 'true' || (env.HF_IMAGE_EDIT_ENABLED !== 'false' && Boolean(hfToken));

    return {
        textImage: {
            provider: hfEnabled ? 'huggingface' : 'nvidia',
            hfToken,
            hfModel: env.HF_IMAGE_MODEL || 'Qwen/Qwen-Image',
            hfProvider,
            hfUrl: env.HF_IMAGE_URL || `${hfBaseUrl}/${env.HF_IMAGE_MODEL || 'Qwen/Qwen-Image'}`,
            hfTimeoutMs: Number(env.HF_IMAGE_TIMEOUT_MS || 180000),
            hfSteps: Number(env.HF_IMAGE_STEPS || 32),
            hfGuidance: Number(env.HF_IMAGE_GUIDANCE || 3.5),
            nvidiaApiKey: env.NVIDIA_API_KEY || "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",
            nvidiaUrl: env.NVIDIA_FLUX_URL || DEFAULT_NVIDIA_FLUX_URL,
        },
        imageEdit: {
            provider: hfEditEnabled ? 'huggingface' : 'disabled',
            hfToken,
            hfModel: env.HF_IMAGE_EDIT_MODEL || 'Qwen/Qwen-Image-Edit-2511',
            hfProvider: env.HF_IMAGE_EDIT_PROVIDER || hfProvider,
            hfUrl: env.HF_IMAGE_EDIT_URL || `${hfBaseUrl}/${env.HF_IMAGE_EDIT_MODEL || 'Qwen/Qwen-Image-Edit-2511'}`,
            hfTimeoutMs: Number(env.HF_IMAGE_EDIT_TIMEOUT_MS || 180000),
            hfSteps: Number(env.HF_IMAGE_EDIT_STEPS || 40),
            hfGuidance: Number(env.HF_IMAGE_EDIT_GUIDANCE || 4),
        },
    };
}

export class AssetModelRouter {
    constructor(config = resolveAssetModelConfig()) {
        this.config = config;
    }

    getStatus() {
        return {
            textImage: {
                provider: this.config.textImage.provider,
                model: this.config.textImage.provider === 'huggingface'
                    ? this.config.textImage.hfModel
                    : 'black-forest-labs/flux.1-schnell',
            },
            imageEdit: {
                provider: this.config.imageEdit.provider,
                model: this.config.imageEdit.hfModel,
            },
        };
    }

    async generateImage(prompt, dimensions = 768) {
        if (this.config.textImage.provider === 'huggingface') {
            return this.generateImageWithHuggingFace(prompt, dimensions);
        }
        return this.generateImageWithNvidiaFlux(prompt, dimensions);
    }

    async generateImageWithNvidiaFlux(prompt, dimensions = 768) {
        const { width, height } = normalizeImageDimensions(dimensions);
        const response = await fetch(this.config.textImage.nvidiaUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.config.textImage.nvidiaApiKey}`,
                Accept: 'application/json',
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
            throw new Error(`NVIDIA FLUX generation failed: ${response.status} ${text.slice(0, 200)}`);
        }

        const json = await response.json();
        const artifact = json?.artifacts?.[0];
        if (!artifact || !artifact.base64) {
            throw new Error('NVIDIA FLUX returned no image');
        }
        return artifact.base64;
    }

    async generateImageWithHuggingFace(prompt, dimensions = 768) {
        const { width, height } = normalizeImageDimensions(dimensions);
        const label = `HF text-to-image ${this.config.textImage.hfModel}`;
        const response = await withTimeout(fetch(this.config.textImage.hfUrl, {
            method: 'POST',
            headers: hfHeaders(this.config.textImage.hfToken),
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    negative_prompt: 'text, watermark, logo, labels, broken anatomy, messy composition, UI, buttons, unreadable text',
                    num_inference_steps: this.config.textImage.hfSteps,
                    guidance_scale: this.config.textImage.hfGuidance,
                    width,
                    height,
                },
                options: {
                    wait_for_model: true,
                    use_cache: false,
                },
                provider: this.config.textImage.hfProvider,
            }),
        }), this.config.textImage.hfTimeoutMs, label);

        return parseImageHttpResponse(response, label);
    }

    async editImage(referenceDataUri, prompt, dimensions = 768) {
        if (this.config.imageEdit.provider !== 'huggingface') {
            return { ok: false, skipped: 'disabled' };
        }
        if (!this.config.imageEdit.hfToken) {
            return { ok: false, skipped: 'missing_hf_token' };
        }

        const { width, height } = normalizeImageDimensions(dimensions);
        const label = `HF image-edit ${this.config.imageEdit.hfModel}`;
        const response = await withTimeout(fetch(this.config.imageEdit.hfUrl, {
            method: 'POST',
            headers: hfHeaders(this.config.imageEdit.hfToken),
            body: JSON.stringify({
                inputs: stripImageDataUrl(referenceDataUri),
                parameters: {
                    prompt,
                    negative_prompt: 'text, labels, watermark, extra characters, cropped subject, duplicate subject, busy background, UI, button, frame, border',
                    num_inference_steps: this.config.imageEdit.hfSteps,
                    guidance_scale: this.config.imageEdit.hfGuidance,
                    target_size: { width, height },
                },
                options: {
                    wait_for_model: true,
                    use_cache: false,
                },
                provider: this.config.imageEdit.hfProvider,
            }),
        }), this.config.imageEdit.hfTimeoutMs, label);

        return {
            ok: true,
            imageBase64: await parseImageHttpResponse(response, label),
            method: `hf:${this.config.imageEdit.hfModel}`,
        };
    }
}

export const assetModelRouter = new AssetModelRouter();
