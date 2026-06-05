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
            role: slot?.role || slot?.category || null,
            required: slot?.required !== false,
        }))
        .filter((slot) => slot.id && slot.runtimeKey);
}

export function buildAllowedAssetKeysPromptBlock(allowedKeys = [], slotHints = []) {
    if (!Array.isArray(allowedKeys) || allowedKeys.length === 0) {
        return 'Asset pack keys were not available yet. Use getAssetImage/firstByRole with roles from the asset contract; do not invent camelCase variants.';
    }
    const allowedSet = new Set(allowedKeys);
    const forbiddenTemplateKeys = ['prop1', 'prop2', 'item1', 'item2', 'item3', 'enemy', 'player1']
        .filter((key) => !allowedSet.has(key));
    const lines = [
        'ALLOWED ASSET PACK KEYS (mandatory — copy these strings exactly, case-sensitive):',
        allowedKeys.join(', '),
    ];
    if (Array.isArray(slotHints) && slotHints.length > 0) {
        lines.push(
            'Foundation slot → runtime key:',
            slotHints.map((slot) => `${slot.id}=${slot.runtimeKey}`).join(', '),
        );
        const requiredSlots = slotHints.filter((slot) => slot.required !== false);
        if (requiredSlots.length > 0) {
            lines.push(
                'Required slots — must call getAssetImage(key) or firstByRole(role) for each:',
                requiredSlots.map((slot) => `${slot.id} → getAssetImage("${slot.runtimeKey || slot.id}")`).join('; '),
            );
        }
    }
    if (forbiddenTemplateKeys.length > 0) {
        lines.push(`Do NOT use template placeholder keys unless listed above: ${forbiddenTemplateKeys.join(', ')}.`);
    }
    lines.push('Never invent new keys (e.g. cauldronProp, prop1) when the pack lists a different spelling.');
    lines.push('Draw backgrounds via resolveBackgroundImage(), drawBackground(), or getAssetImage(backgroundKey) full-bleed in renderAll.');
    lines.push('Import { __GT_CONTRACT_ASSET_KEYS__ } from "./assetKeys.ts" in src/main.ts — keys are already on disk; do not read_file assetKeys.ts.');
    return lines.join('\n');
}

export function buildAssetKeysTsSource({ allowedKeys = [], slotHints = [] } = {}) {
    const keys = unique(allowedKeys.map(String)).sort();
    const slotEntries = (Array.isArray(slotHints) ? slotHints : [])
        .filter((slot) => slot?.id)
        .map((slot) => ({
            id: String(slot.id),
            runtimeKey: String(slot.runtimeKey || slot.id),
            role: slot.role ? String(slot.role) : null,
            required: slot.required !== false,
        }));

    return [
        '// Auto-generated by GameTok forge — do not edit manually.',
        '// Foundation "slots" are the artist brief; this lists every runtime pack key (animation frames, variants, etc.).',
        '',
        `export const __GT_CONTRACT_ASSET_KEYS__ = ${JSON.stringify(keys)} as const;`,
        'export type ContractAssetKey = typeof __GT_CONTRACT_ASSET_KEYS__[number];',
        '',
        `export const ASSET_SLOT_HINTS = ${JSON.stringify(slotEntries, null, 4)} as const;`,
        '',
        'export const ALLOWED_ASSET_KEYS: readonly string[] = __GT_CONTRACT_ASSET_KEYS__;',
        '',
    ].join('\n');
}

export async function writeMakerAssetKeysTs(projectRoot, { allowedKeys = [], slotHints = [] } = {}) {
    if (!projectRoot) {
        throw new Error('writeMakerAssetKeysTs requires projectRoot');
    }
    const content = buildAssetKeysTsSource({ allowedKeys, slotHints });
    const absolutePath = path.join(projectRoot, 'src', 'assetKeys.ts');
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    return {
        path: 'src/assetKeys.ts',
        bytes: Buffer.byteLength(content, 'utf8'),
        keyCount: allowedKeys.length,
    };
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

const GENERIC_ASSET_ROLE_WORDS = new Set([
    'player', 'enemy', 'item', 'prop', 'effect', 'background', 'environment', 'collectible', 'sfx', 'music',
]);

function levenshteinDistance(a = '', b = '') {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            matrix[i][j] = a[i - 1] === b[j - 1]
                ? matrix[i - 1][j - 1]
                : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[a.length][b.length];
}

function sourceReferencesToken(source = '', token = '') {
    if (!token) return false;
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(source);
}

function pickFirstMatchingKey(allowedKeys = [], pattern) {
    return allowedKeys.find((key) => pattern.test(String(key))) || null;
}

function remapUnknownAssetKey(ref = '', allowedKeys = []) {
    const key = String(ref || '').trim();
    if (!key || allowedKeys.includes(key)) return key;
    const lower = key.toLowerCase();
    const exactIgnoreCase = allowedKeys.find((candidate) => candidate.toLowerCase() === lower);
    if (exactIgnoreCase) return exactIgnoreCase;
    if (GENERIC_ASSET_ROLE_WORDS.has(lower)) return key;

    if (/^prop\d+$/i.test(key)) {
        return pickFirstMatchingKey(allowedKeys, /^prop\d+/i)
            || pickFirstMatchingKey(allowedKeys, /^prop/i)
            || key;
    }
    if (/^obstacle\d+$/i.test(key)) {
        return pickFirstMatchingKey(allowedKeys, /^obstacle\d+/i)
            || pickFirstMatchingKey(allowedKeys, /^obstacle/i)
            || key;
    }
    if (/^item\d+$/i.test(key)) {
        return pickFirstMatchingKey(allowedKeys, /^item\d+/i)
            || pickFirstMatchingKey(allowedKeys, /item|ingredient/i)
            || key;
    }
    if (key === 'player1' || key === 'player') {
        return pickFirstMatchingKey(allowedKeys, /^player/i)
            || (allowedKeys.includes('player_car') ? 'player_car' : key);
    }
    if (/^enemy\d+$/i.test(key) && !allowedKeys.includes(key)) {
        return pickFirstMatchingKey(allowedKeys, /^enemy\d+/i)
            || pickFirstMatchingKey(allowedKeys, /enemy/i)
            || key;
    }
    if (/^background\d+$/i.test(key) && !allowedKeys.includes(key)) {
        return pickFirstMatchingKey(allowedKeys, /background|environment|diner|bg/i) || key;
    }

    let best = key;
    let bestDistance = Infinity;
    for (const candidate of allowedKeys) {
        const distance = levenshteinDistance(lower, candidate.toLowerCase());
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    return bestDistance <= 3 ? best : pickFirstMatchingKey(allowedKeys, new RegExp(lower.replace(/\d+$/, ''))) || key;
}

export function replaceInvalidAssetKeyReferencesInSource(source = '', allowedKeys = []) {
    if (!source || !Array.isArray(allowedKeys) || allowedKeys.length === 0) return source;
    const allowed = new Set(allowedKeys);
    let out = source;

    out = out.replace(
        /(\b(?:getAssetImage|firstByRole|imageFor|spriteFor|assetFor)\s*\(\s*)(['"`])([^'"`]+)\2/g,
        (match, prefix, quote, ref) => {
            if (allowed.has(ref) || GENERIC_ASSET_ROLE_WORDS.has(String(ref).toLowerCase())) return match;
            const mapped = remapUnknownAssetKey(ref, allowedKeys);
            return mapped && mapped !== ref ? `${prefix}${quote}${mapped}${quote}` : match;
        },
    );

    out = out.replace(
        /(\bDREAM_IMAGES\s*(?:\?\.)?\[\s*)(['"`])([^'"`]+)\2(\s*\])/g,
        (match, prefix, quote, ref, suffix) => {
            if (allowed.has(ref) || GENERIC_ASSET_ROLE_WORDS.has(String(ref).toLowerCase())) return match;
            const mapped = remapUnknownAssetKey(ref, allowedKeys);
            return mapped && mapped !== ref ? `${prefix}${quote}${mapped}${quote}${suffix}` : match;
        },
    );

    out = out.replace(
        /(\bDREAM_ASSETS\s*(?:\?\.)?\[\s*)(['"`])([^'"`]+)\2(\s*\])/g,
        (match, prefix, quote, ref, suffix) => {
            if (allowed.has(ref) || GENERIC_ASSET_ROLE_WORDS.has(String(ref).toLowerCase())) return match;
            const mapped = remapUnknownAssetKey(ref, allowedKeys);
            return mapped && mapped !== ref ? `${prefix}${quote}${mapped}${quote}${suffix}` : match;
        },
    );

    return out;
}

const GAME_TOK_WIRING_MARKER = '// @gameTokAssetContractWiring';

function collectRequiredAssetKeyRefs(assetContract = null, slotHints = [], allowedKeys = []) {
    const slots = Array.isArray(assetContract?.slots) ? assetContract.slots : [];
    const refs = [];
    for (const slot of slots) {
        if (slot?.required === false) continue;
        const hint = slotHints.find((entry) => entry.id === slot.id || entry.role === slot.role);
        const runtimeKey = hint?.runtimeKey || slot.id || slot.role;
        if (runtimeKey) refs.push(runtimeKey);
    }
    for (const key of allowedKeys) {
        if (/^(player|enemy\d*|item\d*|prop\d*|obstacle\d*|background)/i.test(String(key))) {
            refs.push(key);
        }
    }
    return [...new Set(refs.filter(Boolean))];
}

function contractNeedsInjectedDrawWiring(source = '', assetContract = null, allowedKeys = []) {
    if (contractRequiresItemRole(assetContract, allowedKeys)
        && !sourceRendersItemAssets(source, allowedKeys)
        && !/__gtDrawPickups\s*\(/.test(source)) {
        return true;
    }
    if (contractRequiresPropRole(assetContract, allowedKeys)
        && !sourceRendersPropAssets(source, allowedKeys)
        && !/__gtDrawProps\s*\(/.test(source)) {
        return true;
    }
    if (contractRequiresObstacleRole(assetContract, allowedKeys)
        && !sourceRendersObstacleAssets(source, allowedKeys)
        && !/__gtDrawHazards\s*\(/.test(source)) {
        return true;
    }
    return false;
}

function injectGameTokAssetContractWiring(source = '', requiredKeyRefs = [], allowedKeys = [], assetContract = null) {
    if (!requiredKeyRefs.length && !contractNeedsInjectedDrawWiring(source, assetContract, allowedKeys)) return source;
    const usesAssetKeysModule = /from\s+['"]\.\/assetKeys(?:\.ts)?['"]/.test(source)
        || /import\s*\{[^}]*__GT_CONTRACT_ASSET_KEYS__/.test(source);
    const missingRefs = requiredKeyRefs.filter((ref) => !sourceReferencesToken(source, ref));
    const needsBackgroundHelper = !/resolveBackgroundImage|function drawBackground|__gtResolveGeneratedBackground/.test(source)
        && !/getAssetImage\(['"](?:background1|background|environment)['"]\)/.test(source);
    const needsDrawWiring = contractNeedsInjectedDrawWiring(source, assetContract, allowedKeys);
    if (missingRefs.length === 0 && !needsBackgroundHelper && !needsDrawWiring) return source;
    if (usesAssetKeysModule && !needsBackgroundHelper && !needsDrawWiring) return source;

    const keysLiteral = usesAssetKeysModule
        ? '__GT_CONTRACT_ASSET_KEYS__'
        : JSON.stringify([...new Set([...requiredKeyRefs, ...missingRefs])]);
    const backgroundKey = pickFirstMatchingKey(allowedKeys, /background|environment|diner|bg/i) || 'background1';
    let block = '';
    if (!source.includes(GAME_TOK_WIRING_MARKER)) {
        block = `
${GAME_TOK_WIRING_MARKER}
${usesAssetKeysModule ? '' : `const __GT_CONTRACT_ASSET_KEYS__ = ${keysLiteral};\n`}
function __gtEnsureContractAssetsReferenced() {
  const assetKeys = ${usesAssetKeysModule ? '__GT_CONTRACT_ASSET_KEYS__' : keysLiteral};
  for (const assetKey of assetKeys) {
    void getAssetImage(assetKey);
  }
}
function __gtResolveGeneratedBackground() {
  const candidates = [${JSON.stringify(backgroundKey)}, 'background1', 'background', 'environment'];
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  for (const asset of pack) {
    const role = String(asset?.role || asset?.category || '').toLowerCase();
    if (role === 'background' || role === 'environment') {
      candidates.push(String(asset.key || asset.id || asset.runtimeKey || ''));
    }
  }
  const seen = new Set();
  for (const key of candidates) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const img = getAssetImage(key);
    if (img) return img;
  }
  return null;
}
function resolveBackgroundImage() {
  return __gtResolveGeneratedBackground();
}
function drawBackground() {
  const bg = resolveBackgroundImage();
  if (!bg || !ctx?.canvas) return false;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const scale = Math.max(width / Math.max(bg.naturalWidth, 1), height / Math.max(bg.naturalHeight, 1));
  const w = bg.naturalWidth * scale;
  const h = bg.naturalHeight * scale;
  ctx.drawImage(bg, (width - w) / 2, (height - h) / 2, w, h);
  return true;
}
function __gtDrawGeneratedBackground(ctxRef, width, height) {
  const bg = resolveBackgroundImage();
  if (!bg) return false;
  const scale = Math.max(width / Math.max(bg.naturalWidth, 1), height / Math.max(bg.naturalHeight, 1));
  const w = bg.naturalWidth * scale;
  const h = bg.naturalHeight * scale;
  ctxRef.drawImage(bg, (width - w) / 2, (height - h) / 2, w, h);
  return true;
}
`;
    }

    let out = source;
    if (block) {
        const anchor = out.match(/\nfunction getAssetImage\s*\(/);
        if (anchor && anchor.index !== undefined) {
            out = `${out.slice(0, anchor.index)}${block}${out.slice(anchor.index)}`;
        } else {
            const exportAnchor = out.search(/\nexport function renderAll\s*\(/);
            out = exportAnchor >= 0
                ? `${out.slice(0, exportAnchor)}${block}${out.slice(exportAnchor)}`
                : `${out}\n${block}`;
        }
    }

    if (!/(__gtEnsureContractAssetsReferenced|__gtDrawGeneratedBackground)\s*\(\s*\)/.test(out)) {
        out = out.replace(
            /((?:export )?function renderAll\s*\(\)\s*\{)/,
            '$1\n  __gtEnsureContractAssetsReferenced();',
        );
        out = out.replace(
            /((?:export )?function renderAll\s*\(\)\s*\{[\s\S]*?ctx\.clearRect\([^)]*\);\s*)/,
            (match) => `${match}  drawBackground();\n`,
        );
    }

    return out;
}

const COLLECTIBLE_WIRING_MARKER = '// @gameTokCollectibleWiring';

function contractRequiresItemRole(assetContract = null, allowedKeys = []) {
    const slots = Array.isArray(assetContract?.slots) ? assetContract.slots : [];
    const slotRequiresItem = slots.some((slot) => slot?.required !== false && (
        String(slot?.role || '').toLowerCase() === 'item'
        || String(slot?.category || '').toLowerCase() === 'item'
        || /^item\d+$/i.test(String(slot?.id || ''))
    ));
    const packHasItemKeys = allowedKeys.some((key) => /^item\d*$/i.test(String(key)));
    return slotRequiresItem || packHasItemKeys;
}

// Generic "the builder already draws its assets" signal: any loop (forEach/for) that drawImages a
// getAssetImage(...) result, regardless of what the collection is named (toppings, props, stickers,
// placed*, tray, board...). Used by every render detector so NON-runner games aren't misread as
// "unrendered" and stapled with a falling-lane spawner on top of their real rendering.
function sourceIteratesAndDrawsAsset(source = '') {
    return /(?:\.forEach\(|\bfor\s*\()[\s\S]{0,320}drawImage\(\s*getAssetImage\(/i.test(source);
}

// The injected __gtDraw* renderers are all falling-down-lanes spawners — only valid for scroller/
// runner/collector games. Gate EVERY injection behind this so a drag/decorate/match/tap/static game
// never gets runner mechanics (falling items/props/hazards) bolted on.
function sourceHasScrollerSemantics(source = '') {
    return /\b(scroll|lane|spawn|fall|falling|drop|dropping|conveyor|gravity|runner|descend)\b/i.test(source)
        || /\.(vy|velocityY|speedY)\b/.test(source);
}

function sourceRendersItemAssets(source = '', allowedKeys = []) {
    const itemKeys = allowedKeys.filter((key) => /^item\d*$/i.test(String(key)));
    const drawsItemKey = itemKeys.some((key) => {
        const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`getAssetImage\\(\\s*['"\`]${escaped}['"\`]\\s*\\)[^;{]*drawImage`, 's').test(source)
            || new RegExp(`drawImage\\(\\s*getAssetImage\\(\\s*['"\`]${escaped}['"\`]`, 's').test(source)
            || new RegExp(`drawImage\\([^;]{0,240}${escaped}`, 's').test(source);
    });
    if (drawsItemKey) return true;
    if (sourceIteratesAndDrawsAsset(source)) return true;
    return /drawImage\(\s*[^,)]*(?:item\d*|['"`]item['"`])/i.test(source)
        || /firstByRole\(\s*['"`]item['"`]\s*\)[^;{]*drawImage/is.test(source)
        || /(?:pickups|collectibles|fuelCans|gasCans|items|toppings|decorations|stickers|placed\w*)\.forEach\([\s\S]{0,400}drawImage/is.test(source);
}

function injectCollectibleAssetRendering(source = '', allowedKeys = [], assetContract = null) {
    if (!contractRequiresItemRole(assetContract, allowedKeys)) return source;
    if (source.includes(COLLECTIBLE_WIRING_MARKER)) return source;
    if (sourceRendersItemAssets(source, allowedKeys)) return source;
    // __gtDrawPickups is a falling-down-lanes spawner — only sane for scroller/runner games.
    if (!sourceHasScrollerSemantics(source)) return source;

    const block = `
${COLLECTIBLE_WIRING_MARKER}
function __gtItemAssetKeys() {
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  const fromPack = pack
    .filter((asset) => String(asset?.role || asset?.category || '').toLowerCase() === 'item')
    .map((asset) => String(asset.key || asset.id || asset.runtimeKey || ''))
    .filter(Boolean);
  const fallback = ${JSON.stringify(allowedKeys.filter((key) => /^item\d*$/i.test(String(key))))};
  const seen = new Set();
  const keys = [];
  for (const key of [...fromPack, ...fallback, 'item1', 'item2', 'item']) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (getAssetImage(key)) keys.push(key);
  }
  return keys;
}
function __gtEnsurePickups(stateRef) {
  const keys = __gtItemAssetKeys();
  if (keys.length === 0) return;
  if (!Array.isArray(stateRef.pickups)) stateRef.pickups = [];
  if (!Array.isArray(stateRef.collectibles)) stateRef.collectibles = stateRef.pickups;
  while (stateRef.pickups.length < Math.min(2, keys.length)) {
    const key = keys[stateRef.pickups.length % keys.length];
    stateRef.pickups.push({ key, lane: stateRef.pickups.length % 3, y: -72, w: 48, h: 48 });
  }
}
function __gtUpdatePickups(stateRef, dt) {
  __gtEnsurePickups(stateRef);
  if (!stateRef.pickups?.length) return;
  const speed = Number(stateRef.roadScroll ?? stateRef.scrollSpeed ?? stateRef.speed ?? 140) || 140;
  for (const pickup of stateRef.pickups) {
    pickup.y += speed * dt;
    if (pickup.y > stateRef.height + 96) {
      pickup.y = -48 - Math.random() * 160;
      pickup.lane = Math.floor(Math.random() * 3);
    }
  }
}
function __gtDrawPickups(ctxRef, stateRef) {
  __gtUpdatePickups(stateRef, 1 / 60);
  __gtEnsurePickups(stateRef);
  if (!ctxRef || !stateRef.pickups?.length) return;
  const lanes = Math.max(3, Number(stateRef.laneCount || stateRef.lanes || 3));
  const laneWidth = stateRef.width / lanes;
  for (const pickup of stateRef.pickups) {
    const img = getAssetImage(pickup.key);
    if (!img) continue;
    const w = pickup.w || Math.min(64, img.naturalWidth || 48);
    const h = pickup.h || Math.min(64, img.naturalHeight || 48);
    const x = laneWidth * (pickup.lane + 0.5) - w / 2;
    ctxRef.drawImage(img, x, pickup.y, w, h);
  }
}
`;

    let out = source;
    const anchor = out.match(/\nfunction getAssetImage\s*\(/);
    if (anchor && anchor.index !== undefined) {
        out = `${out.slice(0, anchor.index)}${block}${out.slice(anchor.index)}`;
    } else {
        out = `${block}${out}`;
    }

    if (!/__gtDrawPickups\s*\(/.test(out)) {
        if (/(?:export )?function renderAll\s*\(\)/.test(out)) {
            out = out.replace(
                /((?:export )?function renderAll\s*\(\)\s*\{)/,
                '$1\n  __gtDrawPickups(ctx, state);',
            );
        } else if (/(?:export )?function render\s*\(/.test(out)) {
            out = out.replace(
                /((?:export )?function render\s*\([^)]*\)\s*\{)/,
                '$1\n  __gtDrawPickups(ctx, state);',
            );
        }
    }

    return out;
}

const PROP_WIRING_MARKER = '// @gameTokPropWiring';
const OBSTACLE_WIRING_MARKER = '// @gameTokObstacleWiring';

function contractRequiresPropRole(assetContract = null, allowedKeys = []) {
    const slots = Array.isArray(assetContract?.slots) ? assetContract.slots : [];
    const slotRequiresProp = slots.some((slot) => slot?.required !== false && (
        String(slot?.role || '').toLowerCase() === 'prop'
        || String(slot?.category || '').toLowerCase() === 'prop'
        || /^prop\d+$/i.test(String(slot?.id || ''))
    ));
    const packHasPropKeys = allowedKeys.some((key) => /^prop\d*$/i.test(String(key)));
    return slotRequiresProp || packHasPropKeys;
}

function contractRequiresObstacleRole(assetContract = null, allowedKeys = []) {
    const slots = Array.isArray(assetContract?.slots) ? assetContract.slots : [];
    const slotRequiresObstacle = slots.some((slot) => slot?.required !== false && (
        String(slot?.role || '').toLowerCase() === 'obstacle'
        || String(slot?.category || '').toLowerCase() === 'obstacle'
        || /^obstacle\d+$/i.test(String(slot?.id || ''))
    ));
    const packHasObstacleKeys = allowedKeys.some((key) => /^obstacle\d*$/i.test(String(key)));
    return slotRequiresObstacle || packHasObstacleKeys;
}

function sourceRendersPropAssets(source = '', allowedKeys = []) {
    const propKeys = allowedKeys.filter((key) => /^prop\d*$/i.test(String(key)));
    const drawsPropKey = propKeys.some((key) => {
        const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`getAssetImage\\(\\s*['"\`]${escaped}['"\`]\\s*\\)[^;{]*drawImage`, 's').test(source)
            || new RegExp(`drawImage\\(\\s*getAssetImage\\(\\s*['"\`]${escaped}['"\`]`, 's').test(source)
            || new RegExp(`drawImage\\([^;]{0,240}${escaped}`, 's').test(source);
    });
    if (drawsPropKey) return true;
    if (sourceIteratesAndDrawsAsset(source)) return true;
    return /firstByRole\(\s*['"`]prop['"`]\s*\)[^;{]*drawImage/is.test(source)
        || /(?:props|decorations|stickers|placed\w*|tray|trays|board\w*|shelf|furniture)\.forEach\([\s\S]{0,400}drawImage/is.test(source)
        || /__gtDrawProps\s*\(/.test(source);
}

function sourceRendersObstacleAssets(source = '', allowedKeys = []) {
    const obstacleKeys = allowedKeys.filter((key) => /^obstacle\d*$/i.test(String(key)));
    const drawsObstacleKey = obstacleKeys.some((key) => {
        const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`getAssetImage\\(\\s*['"\`]${escaped}['"\`]\\s*\\)[^;{]*drawImage`, 's').test(source)
            || new RegExp(`drawImage\\(\\s*getAssetImage\\(\\s*['"\`]${escaped}['"\`]`, 's').test(source)
            || new RegExp(`drawImage\\([^;]{0,240}${escaped}`, 's').test(source);
    });
    if (drawsObstacleKey) return true;
    if (sourceIteratesAndDrawsAsset(source)) return true;
    return /drawImage\(\s*[^,)]*(?:obstacle\d*|['"`]obstacle['"`])/i.test(source)
        || /firstByRole\(\s*['"`]obstacle['"`]\s*\)[^;{]*drawImage/is.test(source)
        || /(?:obstacles|hazards|barriers|cones|walls|blockers)\.forEach\([\s\S]{0,400}drawImage/is.test(source)
        || /__gtDrawHazards\s*\(/.test(source);
}

function injectPropAssetRendering(source = '', allowedKeys = [], assetContract = null) {
    if (!contractRequiresPropRole(assetContract, allowedKeys)) return source;
    if (source.includes(PROP_WIRING_MARKER)) return source;
    if (sourceRendersPropAssets(source, allowedKeys)) return source;
    // __gtDrawProps spawns falling road-props — only sane for scroller/runner games. A decorate/
    // static game's props (tray, signboard, shelf) are placed by the builder, not falling.
    if (!sourceHasScrollerSemantics(source)) return source;

    const block = `
${PROP_WIRING_MARKER}
function __gtPropAssetKeys() {
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  const fromPack = pack
    .filter((asset) => String(asset?.role || asset?.category || '').toLowerCase() === 'prop')
    .map((asset) => String(asset.key || asset.id || asset.runtimeKey || ''))
    .filter(Boolean);
  const fallback = ${JSON.stringify(allowedKeys.filter((key) => /^prop\d*$/i.test(String(key))))};
  const seen = new Set();
  const keys = [];
  for (const key of [...fromPack, ...fallback, 'prop1', 'prop2']) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (getAssetImage(key)) keys.push(key);
  }
  return keys;
}
function __gtEnsureProps(stateRef) {
  const keys = __gtPropAssetKeys();
  if (keys.length === 0) return;
  if (!Array.isArray(stateRef.__gtRoadProps)) stateRef.__gtRoadProps = [];
  while (stateRef.__gtRoadProps.length < Math.min(2, keys.length)) {
    const key = keys[stateRef.__gtRoadProps.length % keys.length];
    stateRef.__gtRoadProps.push({ key, lane: stateRef.__gtRoadProps.length % 3, y: -120 - stateRef.__gtRoadProps.length * 140, w: 80, h: 80 });
  }
}
function __gtUpdateProps(stateRef, dt) {
  __gtEnsureProps(stateRef);
  if (!stateRef.__gtRoadProps?.length) return;
  const speed = Number(stateRef.roadScroll ?? stateRef.scrollSpeed ?? stateRef.speed ?? 140) || 140;
  for (const prop of stateRef.__gtRoadProps) {
    prop.y += speed * dt;
    if (prop.y > stateRef.height + 120) {
      prop.y = -80 - Math.random() * 180;
      prop.lane = Math.floor(Math.random() * 3);
    }
  }
}
function __gtDrawProps(ctxRef, stateRef) {
  __gtUpdateProps(stateRef, 1 / 60);
  __gtEnsureProps(stateRef);
  if (!ctxRef || !stateRef.__gtRoadProps?.length) return;
  const lanes = Math.max(3, Number(stateRef.laneCount || stateRef.lanes || 3));
  const laneWidth = stateRef.width / lanes;
  for (const prop of stateRef.__gtRoadProps) {
    const img = getAssetImage(prop.key);
    if (!img) continue;
    const w = prop.w || Math.min(96, img.naturalWidth || 72);
    const h = prop.h || Math.min(96, img.naturalHeight || 72);
    const x = laneWidth * (prop.lane + 0.5) - w / 2;
    ctxRef.drawImage(img, x, prop.y, w, h);
  }
}
`;

    let out = source;
    const anchor = out.match(/\nfunction getAssetImage\s*\(/);
    if (anchor && anchor.index !== undefined) {
        out = `${out.slice(0, anchor.index)}${block}${out.slice(anchor.index)}`;
    } else {
        out = `${block}${out}`;
    }

    if (!/__gtDrawProps\s*\(/.test(out)) {
        if (/(?:export )?function renderAll\s*\(\)/.test(out)) {
            out = out.replace(
                /((?:export )?function renderAll\s*\(\)\s*\{)/,
                '$1\n  __gtDrawProps(ctx, state);',
            );
        } else if (/(?:export )?function render\s*\(/.test(out)) {
            out = out.replace(
                /((?:export )?function render\s*\([^)]*\)\s*\{)/,
                '$1\n  __gtDrawProps(ctx, state);',
            );
        }
    }

    return out;
}

function injectObstacleAssetRendering(source = '', allowedKeys = [], assetContract = null) {
    if (!contractRequiresObstacleRole(assetContract, allowedKeys)) return source;
    if (source.includes(OBSTACLE_WIRING_MARKER)) return source;
    if (sourceRendersObstacleAssets(source, allowedKeys)) return source;
    // __gtDrawHazards spawns falling lane hazards — only sane for scroller/runner games.
    if (!sourceHasScrollerSemantics(source)) return source;

    const block = `
${OBSTACLE_WIRING_MARKER}
function __gtObstacleAssetKeys() {
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  const fromPack = pack
    .filter((asset) => String(asset?.role || asset?.category || '').toLowerCase() === 'obstacle')
    .map((asset) => String(asset.key || asset.id || asset.runtimeKey || ''))
    .filter(Boolean);
  const fallback = ${JSON.stringify(allowedKeys.filter((key) => /^obstacle\d*$/i.test(String(key))))};
  const seen = new Set();
  const keys = [];
  for (const key of [...fromPack, ...fallback, 'obstacle1', 'obstacle2']) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (getAssetImage(key)) keys.push(key);
  }
  return keys;
}
function __gtEnsureHazards(stateRef) {
  const keys = __gtObstacleAssetKeys();
  if (keys.length === 0) return;
  if (!Array.isArray(stateRef.__gtHazards)) stateRef.__gtHazards = [];
  while (stateRef.__gtHazards.length < Math.min(3, keys.length)) {
    const key = keys[stateRef.__gtHazards.length % keys.length];
    stateRef.__gtHazards.push({ key, lane: (stateRef.__gtHazards.length + 1) % 3, y: -96 - stateRef.__gtHazards.length * 120, w: 72, h: 72 });
  }
}
function __gtUpdateHazards(stateRef, dt) {
  __gtEnsureHazards(stateRef);
  if (!stateRef.__gtHazards?.length) return;
  const speed = Number(stateRef.roadScroll ?? stateRef.scrollSpeed ?? stateRef.speed ?? 140) || 140;
  for (const hazard of stateRef.__gtHazards) {
    hazard.y += speed * dt;
    if (hazard.y > stateRef.height + 120) {
      hazard.y = -72 - Math.random() * 200;
      hazard.lane = Math.floor(Math.random() * 3);
    }
  }
}
function __gtDrawHazards(ctxRef, stateRef) {
  __gtUpdateHazards(stateRef, 1 / 60);
  __gtEnsureHazards(stateRef);
  if (!ctxRef || !stateRef.__gtHazards?.length) return;
  const lanes = Math.max(3, Number(stateRef.laneCount || stateRef.lanes || 3));
  const laneWidth = stateRef.width / lanes;
  for (const hazard of stateRef.__gtHazards) {
    const img = getAssetImage(hazard.key);
    if (!img) continue;
    const w = hazard.w || Math.min(96, img.naturalWidth || 72);
    const h = hazard.h || Math.min(96, img.naturalHeight || 72);
    const x = laneWidth * (hazard.lane + 0.5) - w / 2;
    ctxRef.drawImage(img, x, hazard.y, w, h);
  }
}
`;

    let out = source;
    const anchor = out.match(/\nfunction getAssetImage\s*\(/);
    if (anchor && anchor.index !== undefined) {
        out = `${out.slice(0, anchor.index)}${block}${out.slice(anchor.index)}`;
    } else {
        out = `${block}${out}`;
    }

    if (!/__gtDrawHazards\s*\(/.test(out)) {
        if (/(?:export )?function renderAll\s*\(\)/.test(out)) {
            out = out.replace(
                /((?:export )?function renderAll\s*\(\)\s*\{)/,
                '$1\n  __gtDrawHazards(ctx, state);',
            );
        } else if (/(?:export )?function render\s*\(/.test(out)) {
            out = out.replace(
                /((?:export )?function render\s*\([^)]*\)\s*\{)/,
                '$1\n  __gtDrawHazards(ctx, state);',
            );
        }
    }

    return out;
}

/** Remove update-hook lines that reference `dt` before the agent declares it (TS2448). */
export function stripGtWiringDtUpdateHooks(source = '') {
    const cleaned = String(source || '').replace(
        /^\s*__gtUpdate(?:Pickups|Hazards)\(state,\s*dt\);\s*\n/gm,
        '',
    );
    return cleaned === source ? source : cleaned;
}

export function repairMainTsAssetWiringInSource(source = '', {
    allowedKeys = [],
    assetContract = null,
    slotHints = [],
} = {}) {
    if (!source.trim() || allowedKeys.length === 0) {
        return { content: source, changed: false, repairs: [] };
    }
    const repairs = [];
    let content = source;

    const remapped = replaceInvalidAssetKeyReferencesInSource(content, allowedKeys);
    if (remapped !== content) {
        content = remapped;
        repairs.push('remapped_invalid_asset_keys');
    }

    const normalized = normalizeAssetKeyReferencesInSource(content, allowedKeys);
    if (normalized !== content) {
        content = normalized;
        repairs.push('normalized_asset_key_casing');
    }

    const requiredKeyRefs = collectRequiredAssetKeyRefs(assetContract, slotHints, allowedKeys);
    if (!/\bfunction getAssetImage\s*\(/.test(content) && !/\bconst getAssetImage\s*=/.test(content)) {
        content = `function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}
${content}`;
        repairs.push('injected_getAssetImage_helper');
    }
    if (!/from\s+['"]\.\/assetKeys(?:\.ts)?['"]/.test(content)
        && !/const\s+__GT_CONTRACT_ASSET_KEYS__\s*=/.test(content)) {
        content = `import { __GT_CONTRACT_ASSET_KEYS__ } from './assetKeys.ts';\n${content}`;
        repairs.push('imported_asset_keys_module');
    }
    const wired = injectGameTokAssetContractWiring(content, requiredKeyRefs, allowedKeys, assetContract);
    if (wired !== content) {
        content = wired;
        repairs.push('injected_contract_asset_wiring');
    }

    const collectibleWired = injectCollectibleAssetRendering(content, allowedKeys, assetContract);
    if (collectibleWired !== content) {
        content = collectibleWired;
        repairs.push('injected_collectible_item_rendering');
    }

    const propWired = injectPropAssetRendering(content, allowedKeys, assetContract);
    if (propWired !== content) {
        content = propWired;
        repairs.push('injected_prop_rendering');
    }

    const obstacleWired = injectObstacleAssetRendering(content, allowedKeys, assetContract);
    if (obstacleWired !== content) {
        content = obstacleWired;
        repairs.push('injected_obstacle_rendering');
    }

    const dtHookStripped = stripGtWiringDtUpdateHooks(content);
    if (dtHookStripped !== content) {
        content = dtHookStripped;
        repairs.push('stripped_gt_dt_update_hooks');
    }

    return {
        content,
        changed: content !== source,
        repairs,
    };
}

export async function applyMainTsAssetWiringRepairs(projectRoot, {
    allowedKeys = [],
    assetContract = null,
    generatedAssets = null,
} = {}) {
    const mainPath = path.join(projectRoot || '', 'src', 'main.ts');
    let source = '';
    try {
        source = await fs.readFile(mainPath, 'utf8');
    } catch {
        return [];
    }
    const keys = allowedKeys.length > 0
        ? allowedKeys
        : [...new Set([
            ...await readProjectAssetPackKeys(projectRoot),
            ...collectAllowedAssetPackKeys({ generatedAssets }),
        ])].sort();
    const slotHints = buildAssetSlotRuntimeHints({ assetContract, generatedAssets });
    const repair = repairMainTsAssetWiringInSource(source, {
        allowedKeys: keys,
        assetContract,
        slotHints,
    });
    if (!repair.changed) return [];
    await fs.writeFile(mainPath, repair.content, 'utf8');
    return [{
        path: 'src/main.ts',
        type: 'asset_wiring_auto_repair',
        repairs: repair.repairs,
    }];
}
