import OpenAI from 'openai';
import { getNvidiaTextKeys, nextNvidiaTextApiKey } from './nvidia-key-pool.js';

export const MOONSHOT_DIRECT_PROVIDER = 'moonshot-direct';

/**
 * Resolve a Kimi text client for one-shot calls (planning/edit conversations).
 * Mirrors the game-generator CLI (kimi-cli-auth.js): Moonshot-direct when its key
 * is set (the paid primary), otherwise NVIDIA-hosted Kimi K2.6 with a rotated key
 * from the shared pool. Returns null only when no provider is configured at all.
 *
 * `allowTemperature` is false on NVIDIA because Kimi K2.6 rejects custom
 * temperature/top_p — sending it 400s the request.
 */
export function resolveKimiJsonClient(env = process.env) {
    const moonshot = getMoonshotTextConfig(env);
    if (moonshot) {
        return {
            client: new OpenAI({ apiKey: moonshot.apiKey, baseURL: moonshot.baseURL, timeout: Number(env.MOONSHOT_API_TIMEOUT_MS || 900000) }),
            model: moonshot.model || 'kimi-k2.7',
            provider: 'moonshot',
            allowTemperature: true,
        };
    }
    const key = nextNvidiaTextApiKey(env) || getNvidiaTextKeys(env)[0];
    if (key) {
        return {
            client: new OpenAI({
                apiKey: key,
                baseURL: String(env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
                timeout: Number(env.NVIDIA_API_TIMEOUT_MS || 900000),
            }),
            model: String(env.NVIDIA_MODEL || 'moonshotai/kimi-k2.6').trim(),
            provider: 'nvidia',
            allowTemperature: false,
        };
    }
    return null;
}

export function getMoonshotTextConfig(env = process.env) {
    const apiKey = String(env.MOONSHOT_API_KEY || '').trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: String(env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, ''),
        model: String(env.MOONSHOT_MODEL || 'kimi-k2.7').trim(),
    };
}

export function isMoonshotFailoverEnabled(env = process.env) {
    if (!getMoonshotTextConfig(env)) return false;
    if (isMoonshotPrimaryEnabled(env)) return false;
    return String(env.GAMETOK_MOONSHOT_FAILOVER || 'false').toLowerCase() === 'true';
}

/** Opt-in: route text agents through Moonshot when MOONSHOT_API_KEY is set. Default off — NVIDIA path. */
export function isMoonshotPrimaryEnabled(env = process.env) {
    if (!getMoonshotTextConfig(env)) return false;
    return String(env.GAMETOK_MOONSHOT_PRIMARY || 'false').toLowerCase() === 'true';
}

export function isMoonshotDirectProvider(providerTag = '') {
    return providerTag === MOONSHOT_DIRECT_PROVIDER;
}

export function createMoonshotTextClient(env = process.env) {
    const config = getMoonshotTextConfig(env);
    if (!config) return null;

    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: Number(env.MOONSHOT_API_TIMEOUT_MS || env.NVIDIA_API_TIMEOUT_MS || 900000),
    });
}

/**
 * One-shot JSON call to Kimi. Used by the planning conversation (the pitch the
 * user reads before hitting Create) so the model that PLANS the game is the same
 * model that BUILDS it — no translation loss between planner and builder.
 */
export async function callKimiJson(
    { systemPrompt, messages, maxTokens = 400, temperature = 0.8, model = null },
    env = process.env,
) {
    const kimi = resolveKimiJsonClient(env);
    if (!kimi) throw new Error('No Kimi text provider configured (need MOONSHOT_API_KEY or an NVIDIA key)');
    const req = {
        model: model || kimi.model,
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        response_format: { type: 'json_object' },
    };
    if (kimi.allowTemperature) req.temperature = temperature;
    const res = await kimi.client.chat.completions.create(req);
    return JSON.parse(res.choices[0].message.content);
}

export function maskMoonshotKey(key = '') {
    const value = String(key || '');
    if (value.length <= 10) return value ? '***' : 'missing';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function resolveMoonshotModel(_nvidiaModel = null, env = process.env) {
    return getMoonshotTextConfig(env)?.model || 'kimi-k2.7';
}

/**
 * Kimi K2.6 rejects custom temperature/top_p. Disable thinking for tool-calling turns.
 */
export function buildMoonshotChatOptions(model, requestedMaxTokens, { hasTools = false, stream = true } = {}) {
    const requested = Number(requestedMaxTokens || 8192);
    const maxTokens = Math.max(256, Math.min(32768, requested));

    const options = {
        model: model || 'kimi-k2.7',
        max_tokens: maxTokens,
        stream,
    };

    if (hasTools) {
        options.thinking = { type: 'disabled' };
    }

    return options;
}
