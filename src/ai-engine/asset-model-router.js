const DEFAULT_NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';
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

export function resolveAssetModelConfig(env = process.env) {
    return {
        textImage: {
            provider: 'nvidia-nim',
            model: 'black-forest-labs/flux.1-schnell',
            nvidiaApiKey: env.NVIDIA_API_KEY || "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",
            nvidiaUrl: env.NVIDIA_FLUX_URL || DEFAULT_NVIDIA_FLUX_URL,
            steps: Number(env.NVIDIA_FLUX_STEPS || 4),
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
            },
            imageEdit: {
                provider: this.config.imageEdit.provider,
                model: this.config.imageEdit.model,
            },
        };
    }

    async generateImage(prompt, dimensions = 768) {
        return this.generateImageWithNvidiaFlux(prompt, dimensions);
    }

    async generateImageWithNvidiaFlux(prompt, dimensions = 768) {
        const { width, height } = normalizeNvidiaFluxDimensions(dimensions);
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
                steps: this.config.textImage.steps,
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

    async editImage() {
        return { ok: false, skipped: 'disabled_nim_text_to_image_only' };
    }
}

export const assetModelRouter = new AssetModelRouter();
