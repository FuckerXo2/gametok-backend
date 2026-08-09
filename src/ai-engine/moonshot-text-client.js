import OpenAI from 'openai';

export const MOONSHOT_DIRECT_PROVIDER = 'moonshot-direct';

/**
 * Resolve a Kimi text client for one-shot calls (planning/director/edit conversations).
 * Mirrors the game-generator CLI (kimi-cli-auth.js): Moonshot-direct, and nothing else.
 * Returns null when no provider is configured — callers must surface that as a failure
 * rather than routing the request to some other vendor's model.
 *
 * NVIDIA-hosted Kimi used to sit under this as a fallback. It was removed 2026-08-01:
 * NVIDIA was banned from the text/game-gen path on 2026-07-08, and the fallback quietly
 * became the PRIMARY brain of the whole maker once the Moonshot key came off Railway.
 * A silent provider substitution is exactly the failure mode that ban existed to prevent,
 * so there is no fallback here by design. See routes.js's NVIDIA-removal note.
 */
export function resolveKimiJsonClient(env = process.env) {
    const moonshot = getMoonshotTextConfig(env);
    if (moonshot) {
        return {
            client: new OpenAI({ apiKey: moonshot.apiKey, baseURL: moonshot.baseURL, timeout: Number(env.MOONSHOT_API_TIMEOUT_MS || 900000) }),
            model: moonshot.model || 'kimi-k2.7-code',
            provider: 'moonshot',
            allowTemperature: true,
        };
    }
    return null;
}

/**
 * NOTE ON THE MODEL ID: it is "kimi-k2.7-code", not "kimi-k2.7". Moonshot ships k2.7 ONLY as the
 * -code (and -code-highspeed) variant — a plain "kimi-k2.7" does not exist in the catalog and 404s
 * on every call, which is the same failure shape that made NVIDIA's hosted k2.6 useless. Verified
 * against platform.kimi.ai's model list 2026-08-01.
 */
export function getMoonshotTextConfig(env = process.env) {
    const apiKey = String(env.MOONSHOT_API_KEY || '').trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: String(env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, ''),
        model: String(env.MOONSHOT_MODEL || 'kimi-k2.7-code').trim(),
    };
}

export function isMoonshotFailoverEnabled(env = process.env) {
    if (!getMoonshotTextConfig(env)) return false;
    if (isMoonshotPrimaryEnabled(env)) return false;
    return String(env.GAMETOK_MOONSHOT_FAILOVER || 'false').toLowerCase() === 'true';
}

/** Opt-in flag kept for the legacy agent path: route those text agents through Moonshot explicitly. */
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
        timeout: Number(env.MOONSHOT_API_TIMEOUT_MS || 900000),
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
    if (!kimi) throw new Error('No Kimi text provider configured (set MOONSHOT_API_KEY)');
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

export function resolveMoonshotModel(_legacyModel = null, env = process.env) {
    return getMoonshotTextConfig(env)?.model || 'kimi-k2.7-code';
}

/**
 * Kimi K2.6 rejects custom temperature/top_p. Disable thinking for tool-calling turns.
 */
export function buildMoonshotChatOptions(model, requestedMaxTokens, { hasTools = false, stream = true } = {}) {
    const requested = Number(requestedMaxTokens || 8192);
    const maxTokens = Math.max(256, Math.min(32768, requested));

    const options = {
        model: model || 'kimi-k2.7-code',
        max_tokens: maxTokens,
        stream,
    };

    if (hasTools) {
        options.thinking = { type: 'disabled' };
    }

    return options;
}
