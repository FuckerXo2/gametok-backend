import OpenAI from 'openai';

export const DEEPSEEK_DIRECT_PROVIDER = 'deepseek-direct';

const NVIDIA_DEEPSEEK_PREFIX = 'deepseek-ai/';

export function getDeepSeekTextConfig(env = process.env) {
    const apiKey = String(env.DEEPSEEK_API_KEY || '').trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: String(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
        model: String(env.DEEPSEEK_MODEL || 'deepseek-v4-pro').trim(),
    };
}

/** Opt-in: route all text agents through DeepSeek direct API when DEEPSEEK_API_KEY is set. */
export function isDeepSeekPrimaryEnabled(env = process.env) {
    if (!getDeepSeekTextConfig(env)) return false;
    return String(env.GAMETOK_DEEPSEEK_PRIMARY || 'false').toLowerCase() === 'true';
}

export function isDeepSeekDirectProvider(providerTag = '') {
    return providerTag === DEEPSEEK_DIRECT_PROVIDER;
}

export function createDeepSeekTextClient(env = process.env) {
    const config = getDeepSeekTextConfig(env);
    if (!config) return null;

    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: Number(env.DEEPSEEK_API_TIMEOUT_MS || env.NVIDIA_API_TIMEOUT_MS || 900000),
    });
}

export function maskDeepSeekKey(key = '') {
    const value = String(key || '');
    if (value.length <= 10) return value ? '***' : 'missing';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** Map NVIDIA NIM model ids to DeepSeek direct API model ids. */
export function resolveDeepSeekModel(model = null, env = process.env) {
    const fallback = getDeepSeekTextConfig(env)?.model || 'deepseek-v4-pro';
    const value = String(model || '').trim();
    if (!value) return fallback;
    if (value.startsWith(NVIDIA_DEEPSEEK_PREFIX)) {
        return value.slice(NVIDIA_DEEPSEEK_PREFIX.length);
    }
    return value;
}

export function isDeepSeekV4ModelName(model = '') {
    const value = String(model || '');
    return value.startsWith('deepseek-ai/deepseek-v4') || /^deepseek-v4/i.test(value);
}

export function getDeepSeekMaxOutputTokens(requestedMaxTokens, env = process.env) {
    const requested = Number(requestedMaxTokens || 8192);
    const cap = Math.max(4096, Math.min(384000, Number(env.DEEPSEEK_MAX_OUTPUT_TOKENS || 384000)));
    return Math.min(requested, cap);
}

/**
 * DeepSeek V4 chat options. Disable thinking for tool-calling turns (faster, more reliable).
 */
export function buildDeepSeekChatOptions(model, requestedMaxTokens, {
    hasTools = false,
    stream = true,
    reasoningEffort = null,
    temperature = undefined,
} = {}, env = process.env) {
    const options = {
        model: model || resolveDeepSeekModel(null, env),
        max_tokens: getDeepSeekMaxOutputTokens(requestedMaxTokens, env),
        stream,
    };

    if (hasTools) {
        options.thinking = { type: 'disabled' };
        options.reasoning_effort = reasoningEffort
            || String(env.DEEPSEEK_V4_TOOL_REASONING_EFFORT || env.DEEPSEEK_V4_REASONING_EFFORT || 'low').trim()
            || 'low';
        options.temperature = temperature ?? 0.1;
    } else {
        options.reasoning_effort = reasoningEffort
            || String(env.DEEPSEEK_V4_REASONING_EFFORT || 'medium').trim()
            || 'medium';
        if (temperature !== undefined) {
            options.temperature = temperature;
        }
    }

    return options;
}
