import OpenAI from 'openai';

export function getMoonshotTextConfig(env = process.env) {
    const apiKey = String(env.MOONSHOT_API_KEY || '').trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: String(env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, ''),
        model: String(env.MOONSHOT_MODEL || 'kimi-k2-0711-preview').trim(),
    };
}

export function isMoonshotFailoverEnabled(env = process.env) {
    if (!getMoonshotTextConfig(env)) return false;
    return String(env.GAMETOK_MOONSHOT_FAILOVER || 'true').toLowerCase() !== 'false';
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
