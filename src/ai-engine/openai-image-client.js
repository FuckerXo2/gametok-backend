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
 * Sanitize game concept art prompts to avoid triggering strict violence filters in image models (OpenAI, DALL-E).
 * Replaces graphic weapon attacks, violent verbs, blood, and lethal actions with safe, dynamic superhero/game terms.
 */
export function sanitizePromptForImageGen(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';

    let sanitized = prompt;

    const replacements = [
        // Targeted weapons / attacks against characters
        [/unleashing a (blazing )?spear against/gi, 'casting fiery blazing energy toward'],
        [/spear against/gi, 'fiery projectile toward'],
        [/glowing kunai chains? clashing against/gi, 'glowing energy tethers dueling with'],
        [/kunai chains?/gi, 'energy chains'],
        [/blazing spear/gi, 'blazing energy blast'],
        [/\bkunai\b/gi, 'energy projectile'],
        [/\bspear\b/gi, 'energy beam'],
        [/chains? clashing against/gi, 'energy bursts clashing with'],
        [/chains? wrapped around/gi, 'energy aura swirling around'],
        
        // Lethal / graphic combat terms
        [/\b(decapitat(e|ed|ing|ion)|impale?d?|impaling|stabbing|slashed|slashing)\b/gi, 'striking dynamic martial arts stance with'],
        [/\b(blood|bloody|gore|gory|mutilat(e|ed|ion)|dismember(ed|ment)?)\b/gi, 'vibrant particle sparks'],
        [/\b(killing|murdering|execut(e|ing|ion)|fatality)\b/gi, 'ultimate finisher visual effect'],
        [/\b(violently attacking|beating up|crushing)\b/gi, 'dueling dramatically with'],
        [/\b(death|fatal|torture)\b/gi, 'showdown'],
        [/\b(weapon(s)? drawn to strike)\b/gi, 'ready in dynamic combat stance'],
        [/\b(scorched flesh|severed)\b/gi, 'battle-tested armor'],
    ];

    for (const [pattern, replacement] of replacements) {
        sanitized = sanitized.replace(pattern, replacement);
    }

    return sanitized;
}

/**
 * Fallback image generation using Google Gemini Imagen 3 (imagen-3.0-generate-001)
 */
export async function generateGeminiImagenImage(prompt) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not configured');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`;
    const payload = {
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
    };

    console.log(`✨ [Gemini Imagen 3] Generating fallback image for prompt: "${prompt.slice(0, 80)}..."`);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Imagen API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    }
    throw new Error('Gemini Imagen 3 returned no image prediction data');
}

/**
 * Generate visual style concept preview card.
 * Multi-layer resilience:
 * 1. Proactive prompt sanitization (removes violent words that trip OpenAI safety).
 * 2. OpenAI gpt-image-2.5-flare.
 * 3. If OpenAI throws safety violation (400), immediate retry with clean hero standoff prompt.
 * 4. If OpenAI fails completely, automatic fallback to Google Gemini Imagen 3.
 */
export async function generateConceptCardImage({
    prompt,
    size = '1024x1024',
    quality = 'low',
    prefix = 'concept-cards',
}) {
    const apiKey = process.env.OPENAI_API_KEY;
    const sanitizedPrompt = sanitizePromptForImageGen(prompt);

    // 1. Try OpenAI if API key available
    if (apiKey) {
        try {
            console.log(`⚡ [OpenAI Image] Generating with gpt-image-2.5-flare (${quality}, ${size})...`);
            const openai = new OpenAI({ apiKey, timeout: 30000 });

            const response = await openai.images.generate({
                model: 'gpt-image-2.5-flare',
                prompt: sanitizedPrompt,
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
        } catch (openAiErr) {
            const isSafetyViolation = /safety|safety_violations|rejected by the safety system/i.test(openAiErr.message) || openAiErr.status === 400;
            console.warn(`⚠️ [OpenAI Image] Generation failed (${openAiErr.message}). Safety rejection: ${isSafetyViolation}`);

            // Retry with ultra-safe generic game prompt if safety rejection
            if (isSafetyViolation) {
                try {
                    const safeStandoffPrompt = `Playable 3D fighting video game visual concept preview, stylized hero characters in dynamic arena standoff, clean UI HUD mockup with health bars and super meters, 1:1 aspect ratio, high visual fidelity, vibrant cinematic lighting`;
                    console.log(`🛡️ [OpenAI Image] Retrying with safe standoff prompt...`);
                    const openai = new OpenAI({ apiKey, timeout: 25000 });
                    const retryResponse = await openai.images.generate({
                        model: 'gpt-image-2.5-flare',
                        prompt: safeStandoffPrompt,
                        n: 1,
                        size,
                    });
                    const retryData = retryResponse?.data?.[0];
                    if (retryData?.b64_json) {
                        const buffer = Buffer.from(retryData.b64_json, 'base64');
                        const imageUrl = await uploadBufferToR2(buffer, prefix, 'image/png');
                        return { imageUrl, source: 'gpt-image-2.5-flare-safe-retry' };
                    } else if (retryData?.url) {
                        const imgRes = await fetch(retryData.url);
                        const arrayBuffer = await imgRes.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const imageUrl = await uploadBufferToR2(buffer, prefix, 'image/png');
                        return { imageUrl, source: 'gpt-image-2.5-flare-safe-retry' };
                    }
                } catch (retryErr) {
                    console.warn(`⚠️ [OpenAI Image] Safe retry also failed: ${retryErr.message}`);
                }
            }
        }
    }

    // 2. Fallback to Gemini Imagen 3
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log(`🔄 [Image Client] Falling back to Gemini Imagen 3 (imagen-3.0-generate-001)...`);
            const imagenBuffer = await generateGeminiImagenImage(sanitizedPrompt);
            const imageUrl = await uploadBufferToR2(imagenBuffer, prefix, 'image/png');
            console.log(`✅ [Gemini Imagen 3] Successfully generated card: ${imageUrl}`);
            return { imageUrl, source: 'gemini-imagen-3' };
        } catch (imagenErr) {
            console.error(`❌ [Gemini Imagen 3] Fallback failed: ${imagenErr.message}`);
        }
    }

    throw new Error('All image generation backends (OpenAI & Gemini Imagen) failed');
}

export const generateGameScreenshotImage = generateConceptCardImage;

