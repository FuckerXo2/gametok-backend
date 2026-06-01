import OpenAI from 'openai';

export const MOONSHOT_DIRECT_PROVIDER = 'moonshot-direct';

export function getMoonshotTextConfig(env = process.env) {
    const apiKey = String(env.MOONSHOT_API_KEY || '').trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: String(env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, ''),
        model: String(env.MOONSHOT_MODEL || 'kimi-k2.6').trim(),
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

export function maskMoonshotKey(key = '') {
    const value = String(key || '');
    if (value.length <= 10) return value ? '***' : 'missing';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function resolveMoonshotModel(_nvidiaModel = null, env = process.env) {
    return getMoonshotTextConfig(env)?.model || 'kimi-k2.6';
}

/**
 * Kimi K2.6 rejects custom temperature/top_p. Disable thinking for tool-calling turns.
 */
export function buildMoonshotChatOptions(model, requestedMaxTokens, { hasTools = false, stream = true } = {}) {
    const requested = Number(requestedMaxTokens || 8192);
    const maxTokens = Math.max(256, Math.min(32768, requested));

    const options = {
        model: model || 'kimi-k2.6',
        max_tokens: maxTokens,
        stream,
    };

    if (hasTools) {
        options.thinking = { type: 'disabled' };
    }

    return options;
}
