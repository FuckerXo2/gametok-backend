import { getNvidiaImageKeys, maskNvidiaKey, nextNvidiaImageApiKey } from './nvidia-key-pool.js';

const DEFAULT_NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';
const DEFAULT_NVIDIA_FLUX_DEV_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev';
const NIM_FLUX_ALLOWED_DIMENSIONS = [768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344];

export function stripImageDataUrl(imageBase64OrDataUrl) {
    return String(imageBase64OrDataUrl || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
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

function nearestAllowedFluxDimension(value) {
    const requested = Number(value || 768);
    const aboveOrEqual = NIM_FLUX_ALLOWED_DIMENSIONS.find((dimension) => dimension >= requested);
    return aboveOrEqual || NIM_FLUX_ALLOWED_DIMENSIONS[NIM_FLUX_ALLOWED_DIMENSIONS.length - 1];
}

export function normalizeNvidiaFluxDimensions(widthOrSize = 768, height = null) {
    const { width, height: resolvedHeight } = normalizeImageDimensions(widthOrSize, height);
    return {
        width: nearestAllowedFluxDimension(width),
        height: nearestAllowedFluxDimension(resolvedHeight),
    };
}

export function resolveFluxModelProfile(model = 'schnell', env = process.env) {
    if (model === 'dev') {
        return {
            key: 'dev',
            model: 'black-forest-labs/flux.1-dev',
            nvidiaUrl: env.NVIDIA_FLUX_DEV_URL || DEFAULT_NVIDIA_FLUX_DEV_URL,
            steps: Number(env.NVIDIA_FLUX_DEV_STEPS || 28),
            cfgScale: Number(env.NVIDIA_FLUX_DEV_CFG_SCALE || 3.5),
        };
    }
    return {
        key: 'schnell',
        model: 'black-forest-labs/flux.1-schnell',
        nvidiaUrl: env.NVIDIA_FLUX_URL || DEFAULT_NVIDIA_FLUX_URL,
        steps: Number(env.NVIDIA_FLUX_STEPS || 4),
        cfgScale: 0,
    };
}

export function resolveAssetModelConfig(env = process.env) {
    const schnell = resolveFluxModelProfile('schnell', env);
    const dev = resolveFluxModelProfile('dev', env);
    return {
        textImage: {
            provider: 'nvidia-nim',
            model: schnell.model,
            nvidiaApiKeys: getNvidiaImageKeys(env),
            nvidiaUrl: schnell.nvidiaUrl,
            steps: schnell.steps,
        },
        backgroundFallback: {
            enabled: env.NVIDIA_FLUX_BACKGROUND_DEV_FALLBACK !== 'false',
            model: dev.model,
            nvidiaUrl: dev.nvidiaUrl,
            steps: dev.steps,
            cfgScale: dev.cfgScale,
        },
        imageEdit: {
            provider: 'disabled',
            model: null,
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
                model: this.config.textImage.model,
                keyCount: this.config.textImage.nvidiaApiKeys?.length || 0,
            },
            backgroundFallback: {
                enabled: this.config.backgroundFallback.enabled,
                model: this.config.backgroundFallback.model,
            },
            imageEdit: {
                provider: this.config.imageEdit.provider,
                model: this.config.imageEdit.model,
            },
        };
    }

    async generateImage(prompt, dimensions = 768, options = {}) {
        const result = await this.generateImageDetailed(prompt, dimensions, options);
        return result.base64;
    }

    async generateImageDetailed(prompt, dimensions = 768, options = {}) {
        const profile = resolveFluxModelProfile(options.model === 'dev' ? 'dev' : 'schnell');
        const { width, height } = normalizeNvidiaFluxDimensions(dimensions);
        const imageKeys = getNvidiaImageKeys();
        if (!imageKeys.length) {
            throw new Error('NVIDIA image API key is not configured');
        }
        const maxKeyAttempts = Math.min(imageKeys.length, 3);
        let lastError = null;

        for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt += 1) {
            const apiKey = nextNvidiaImageApiKey();
            try {
                return await this.generateImageDetailedOnce({
                    prompt,
                    profile,
                    apiKey,
                    width,
                    height,
                });
            } catch (error) {
                lastError = error;
                const retryable = /finishReason=CONTENT_FILTERED|finishReason=ERROR/.test(String(error.message || ''));
                if (!retryable || keyAttempt + 1 >= maxKeyAttempts) {
                    throw error;
                }
                console.warn(
                    `[asset-router] FLUX ${profile.model} key ${maskNvidiaKey(apiKey)} blocked (${error.message}); rotating key`,
                );
            }
        }

        throw lastError || new Error(`NVIDIA FLUX ${profile.model} generation failed`);
    }

    async generateImageDetailedOnce({ prompt, profile, apiKey, width, height }) {
        const response = await fetch(profile.nvidiaUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt,
                width,
                height,
                cfg_scale: profile.cfgScale,
                mode: 'base',
                samples: 1,
                steps: profile.steps,
                seed: Math.floor(Math.random() * 4_000_000_000),
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(
                `NVIDIA FLUX ${profile.model} failed (${maskNvidiaKey(apiKey)}): ${response.status} ${text.slice(0, 200)}`,
            );
        }

        const json = await response.json();
        const artifact = json?.artifacts?.[0];
        if (!artifact || !artifact.base64) {
            throw new Error(`NVIDIA FLUX ${profile.model} returned no image`);
        }

        const finishReason = String(artifact.finishReason || 'UNKNOWN').toUpperCase();
        const decodedBytes = Buffer.from(artifact.base64, 'base64').length;
        if (finishReason !== 'SUCCESS') {
            throw new Error(
                `NVIDIA FLUX ${profile.model} finishReason=${finishReason} for ${width}x${height}`
                + ` (${decodedBytes} bytes)`,
            );
        }
        if (decodedBytes < 2500) {
            throw new Error(
                `NVIDIA FLUX ${profile.model} returned suspiciously small image (${decodedBytes} bytes)`
                + ` for ${width}x${height}`,
            );
        }

        return {
            base64: artifact.base64,
            finishReason,
            seed: artifact.seed,
            model: profile.model,
            modelKey: profile.key,
            width,
            height,
            decodedBytes,
        };
    }

    isBackgroundDevFallbackEnabled() {
        return Boolean(this.config.backgroundFallback.enabled);
    }

    async editImage() {
        return { ok: false, skipped: 'disabled_nim_text_to_image_only' };
    }
}

export const assetModelRouter = new AssetModelRouter();
