const keyPoolIndexes = new Map();

export function parseKeyList(value = '') {
    return String(value || '')
        .split(/[\n,]+/)
        .map((key) => key.trim())
        .filter(Boolean);
}

function readPool(env, names = []) {
    const seen = new Set();
    const keys = [];
    for (const name of names) {
        for (const key of parseKeyList(env[name])) {
            if (seen.has(key)) continue;
            seen.add(key);
            keys.push(key);
        }
    }
    return keys;
}

export function getNvidiaImageKeys(env = process.env) {
    // Prefer dedicated image pools, then merge legacy NVIDIA keys (deduped).
    // DeepSeek handles text generation; NVIDIA keys are primarily for FLUX image NIM.
    return readPool(env, [
        'NIM_IMAGE_API_KEYS',
        'NVIDIA_IMAGE_API_KEYS',
        'NVIDIA_API_KEY',
        'NIM_API_KEYS',
        'NVIDIA_NIM_API_KEY',
    ]);
}

export function getNvidiaTextKeys(env = process.env) {
    // An nvapi key is fungible — the same key serves both the text (Kimi) and
    // image (FLUX) NIM endpoints — and each key has its own rate limit. So for
    // the Kimi CLI we MERGE every NVIDIA key we know about into one rotating
    // pool (deduped), including the "image" vars, which are just idle nvapi keys
    // now that cover art runs on OpenAI. More keys = more rate-limit headroom.
    return readPool(env, [
        'NIM_TEXT_API_KEYS', 'NVIDIA_TEXT_API_KEYS', 'DREAMSTREAM_NVIDIA_API_KEYS',
        'NVIDIA_API_KEY', 'NIM_API_KEYS', 'NVIDIA_NIM_API_KEY',
        'NIM_IMAGE_API_KEYS', 'NVIDIA_IMAGE_API_KEYS',
    ]);
}

function nextKey(poolName, keys = []) {
    if (!Array.isArray(keys) || keys.length === 0) return null;
    const index = keyPoolIndexes.get(poolName) || 0;
    keyPoolIndexes.set(poolName, (index + 1) % keys.length);
    return keys[index % keys.length];
}

export function nextNvidiaImageApiKey(env = process.env) {
    return nextKey('image', getNvidiaImageKeys(env));
}

export function nextNvidiaTextApiKey(env = process.env) {
    return nextKey('text', getNvidiaTextKeys(env));
}

export function maskNvidiaKey(key = '') {
    const value = String(key || '');
    if (value.length <= 10) return value ? '***' : 'missing';
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function summarizeNvidiaKeyPools(env = process.env) {
    const imageKeys = getNvidiaImageKeys(env);
    const textKeys = getNvidiaTextKeys(env);
    return {
        imageKeyCount: imageKeys.length,
        textKeyCount: textKeys.length,
        imageKeys: imageKeys.map(maskNvidiaKey),
        textKeys: textKeys.map(maskNvidiaKey),
        hasSplitImagePool: parseKeyList(env.NIM_IMAGE_API_KEYS || env.NVIDIA_IMAGE_API_KEYS).length > 0,
        usesLegacyImagePool: parseKeyList(env.NVIDIA_API_KEY).length > 0,
        hasSplitTextPool: parseKeyList(env.NIM_TEXT_API_KEYS || env.NVIDIA_TEXT_API_KEYS || env.DREAMSTREAM_NVIDIA_API_KEYS).length > 0,
        usesLegacyTextPool: parseKeyList(env.NVIDIA_API_KEY).length > 0
            && parseKeyList(env.NIM_TEXT_API_KEYS || env.NVIDIA_TEXT_API_KEYS || env.DREAMSTREAM_NVIDIA_API_KEYS).length === 0,
        hasLegacyPool: parseKeyList(env.NVIDIA_API_KEY).length > 0,
    };
}
