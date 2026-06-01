import fs from 'fs/promises';
import path from 'path';

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function collectKeysFromAssetPack(assetPack = null) {
    const keys = new Set();
    if (!assetPack || typeof assetPack !== 'object') return [];

    const pushAsset = (asset) => {
        if (asset?.key) keys.add(String(asset.key));
        if (asset?.runtimeKey) keys.add(String(asset.runtimeKey));
        if (asset?.id) keys.add(String(asset.id));
    };

    if (Array.isArray(assetPack?.meta?.runtimeAssets)) {
        assetPack.meta.runtimeAssets.forEach(pushAsset);
    }
    if (Array.isArray(assetPack?.runtimeAssets)) {
        assetPack.runtimeAssets.forEach(pushAsset);
    }
    if (Array.isArray(assetPack?.generated?.files)) {
        assetPack.generated.files.forEach(pushAsset);
    }
    for (const [sectionName, section] of Object.entries(assetPack)) {
        if (sectionName === 'meta' || !section || typeof section !== 'object') continue;
        if (!Array.isArray(section.files)) continue;
        for (const file of section.files) pushAsset({ ...file, role: file.role || sectionName.replace(/s$/, '') });
    }
    return Array.from(keys);
}

export function collectAllowedAssetPackKeys({ generatedAssets = null, assetPack = null } = {}) {
    const pack = assetPack
        || generatedAssets?.materializedAssetPack
        || null;
    const fromPack = collectKeysFromAssetPack(pack);
    const fromGenerated = unique(
        (Array.isArray(generatedAssets?.assetPack) ? generatedAssets.assetPack : [])
            .flatMap((asset) => [asset?.key, asset?.id, asset?.runtimeKey]),
    );
    const fromManifest = unique(
        (generatedAssets?.makerAssetManifest?.flatAssets || [])
            .flatMap((asset) => [asset?.key, asset?.id, asset?.runtimeKey]),
    );
    return unique([...fromPack, ...fromGenerated, ...fromManifest]).sort();
}

export async function readProjectAssetPackKeys(projectRoot) {
    try {
        const raw = await fs.readFile(
            path.join(projectRoot || '', 'public', 'assets', 'asset-pack.json'),
            'utf8',
        );
        return collectAllowedAssetPackKeys({ assetPack: JSON.parse(raw) });
    } catch {
        return [];
    }
}

export function buildAssetSlotRuntimeHints({ assetContract = null, generatedAssets = null } = {}) {
    const manifestSlots = generatedAssets?.makerAssetManifest?.slots;
    const slots = Array.isArray(manifestSlots) && manifestSlots.length > 0
        ? manifestSlots
        : (Array.isArray(assetContract?.slots) ? assetContract.slots : []);
    return slots
        .map((slot) => ({
            id: slot?.id || slot?.role || null,
            runtimeKey: slot?.runtimeKey || slot?.key || slot?.id || null,
        }))
        .filter((slot) => slot.id && slot.runtimeKey);
}

export function buildAllowedAssetKeysPromptBlock(allowedKeys = [], slotHints = []) {
    if (!Array.isArray(allowedKeys) || allowedKeys.length === 0) {
        return 'Asset pack keys were not available yet. Use getAssetImage/firstByRole with roles from the asset contract; do not invent camelCase variants.';
    }
    const lines = [
        'ALLOWED ASSET PACK KEYS (mandatory — copy these strings exactly, case-sensitive):',
        allowedKeys.join(', '),
    ];
    if (Array.isArray(slotHints) && slotHints.length > 0) {
        lines.push(
            'Foundation slot → runtime key:',
            slotHints.map((slot) => `${slot.id}=${slot.runtimeKey}`).join(', '),
        );
    }
    lines.push('Never invent new keys (e.g. cauldronProp) when the pack lists a different spelling (e.g. cauldronprop).');
    return lines.join('\n');
}

export function normalizeAssetKeyReferencesInSource(source = '', allowedKeys = []) {
    if (!source || !Array.isArray(allowedKeys) || allowedKeys.length === 0) return source;
    const byLower = new Map(
        allowedKeys
            .filter(Boolean)
            .map((key) => [String(key).toLowerCase(), String(key)]),
    );
    if (byLower.size === 0) return source;

    let out = source;

    out = out.replace(
        /(\b(?:getAssetImage|firstByRole|imageFor|spriteFor|assetFor)\s*\(\s*)(['"`])([^'"`]+)\2/g,
        (match, prefix, quote, key) => {
            const exact = byLower.get(String(key).toLowerCase());
            if (!exact || exact === key) return match;
            return `${prefix}${quote}${exact}${quote}`;
        },
    );

    out = out.replace(
        /(\bDREAM_IMAGES\s*(?:\?\.)?\[\s*)(['"`])([^'"`]+)\2(\s*\])/g,
        (match, prefix, quote, key, suffix) => {
            const exact = byLower.get(String(key).toLowerCase());
            if (!exact || exact === key) return match;
            return `${prefix}${quote}${exact}${quote}${suffix}`;
        },
    );

    out = out.replace(
        /(\bDREAM_ASSETS\s*(?:\?\.)?\[\s*)(['"`])([^'"`]+)\2(\s*\])/g,
        (match, prefix, quote, key, suffix) => {
            const exact = byLower.get(String(key).toLowerCase());
            if (!exact || exact === key) return match;
            return `${prefix}${quote}${exact}${quote}${suffix}`;
        },
    );

    return out;
}

export async function normalizeMainTsAssetKeys(projectRoot, allowedKeys = []) {
    if (!projectRoot || !Array.isArray(allowedKeys) || allowedKeys.length === 0) {
        return { changed: false, path: 'src/main.ts' };
    }
    const mainPath = path.join(projectRoot, 'src/main.ts');
    let content = '';
    try {
        content = await fs.readFile(mainPath, 'utf8');
    } catch {
        return { changed: false, path: 'src/main.ts' };
    }
    const normalized = normalizeAssetKeyReferencesInSource(content, allowedKeys);
    if (normalized === content) {
        return { changed: false, path: 'src/main.ts' };
    }
    await fs.writeFile(mainPath, normalized, 'utf8');
    return { changed: true, path: 'src/main.ts' };
}
