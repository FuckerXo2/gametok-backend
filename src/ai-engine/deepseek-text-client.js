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

/**
 * Fast, non-thinking DeepSeek Flash JSON call for structured-output tasks that don't need deep
 * reasoning (classification, concept-card copy, conversational intent parsing). `thinking: {
 * type: 'disabled' }` is required for genuine non-thinking speed — `reasoning_effort: 'low'` alone
 * still burns ~200+ reasoning tokens before emitting content (measured: 1.5s/0 reasoning tokens
 * disabled vs 4.7s/217 reasoning tokens at 'low'), which can truncate the actual JSON out of a
 * tight max_tokens budget. Returns the parsed JSON object, or throws — caller decides fallback.
 * @param {{systemPrompt: string, messages: {role: string, content: string}[], maxTokens?: number, temperature?: number, model?: string}} args
 */
export async function callDeepSeekFlashJson({ systemPrompt, messages, maxTokens = 400, temperature = 0.3, model = null }, env = process.env) {
    const config = getDeepSeekTextConfig(env);
    if (!config) throw new Error('DeepSeek not configured (DEEPSEEK_API_KEY missing)');
    const client = createDeepSeekTextClient(env);
    const res = await client.chat.completions.create({
        model: model || env.GAMETOK_FLASH_MODEL || 'deepseek-v4-flash',
        max_tokens: getDeepSeekMaxOutputTokens(maxTokens, env),
        stream: false,
        thinking: { type: 'disabled' },
        temperature,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        response_format: { type: 'json_object' },
    });
    return JSON.parse(res.choices[0].message.content);
}

export function getDeepSeekMaxOutputTokens(requestedMaxTokens, env = process.env) {
    const requested = Number(requestedMaxTokens || 8192);
    const cap = Math.max(4096, Math.min(384000, Number(env.DEEPSEEK_MAX_OUTPUT_TOKENS || 384000)));
    return Math.min(requested, cap);
}

/**
 * DeepSeek V4 chat options.
 * Tool implement: thinking enabled + reasoning_effort (plan before write_file).
 * Tool repair: thinking disabled only (fast patches; API rejects disabled + reasoning_effort).
 * JSON/spec turns: reasoning_effort without an explicit thinking block.
 */
export function buildDeepSeekChatOptions(model, requestedMaxTokens, {
    hasTools = false,
    toolThinkingEnabled = false,
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
        if (toolThinkingEnabled) {
            options.thinking = { type: 'enabled' };
            options.reasoning_effort = reasoningEffort
                || String(env.DEEPSEEK_V4_IMPLEMENT_REASONING_EFFORT || env.DEEPSEEK_V4_TOOL_REASONING_EFFORT || env.DEEPSEEK_V4_REASONING_EFFORT || 'low').trim()
                || 'low';
        } else {
            options.thinking = { type: 'disabled' };
        }
        options.temperature = temperature ?? 0.1;
    } else {
        options.reasoning_effort = reasoningEffort
            || String(env.DEEPSEEK_V4_REASONING_EFFORT || 'low').trim()
            || 'low';
        if (temperature !== undefined) {
            options.temperature = temperature;
        }
    }

    return options;
}
