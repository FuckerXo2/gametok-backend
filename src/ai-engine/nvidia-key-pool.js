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
    return readPool(env, [
        'NIM_IMAGE_API_KEYS',
        'NVIDIA_IMAGE_API_KEYS',
        'NVIDIA_API_KEY',
        'NIM_API_KEYS',
        'NVIDIA_NIM_API_KEY',
    ]);
}

export function getNvidiaTextKeys(env = process.env) {
    return readPool(env, [
        'NIM_TEXT_API_KEYS',
        'NVIDIA_TEXT_API_KEYS',
        'DREAMSTREAM_NVIDIA_API_KEYS',
        'NVIDIA_API_KEY',
        'NIM_API_KEYS',
        'NVIDIA_NIM_API_KEY',
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
