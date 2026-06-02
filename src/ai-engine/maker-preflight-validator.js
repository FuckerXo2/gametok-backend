import fs from 'fs/promises';
import path from 'path';
import { applyMainTsAssetWiringRepairs } from './maker-agent-asset-keys.js';

async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return '';
    }
}

async function readJsonIfExists(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
        return null;
    }
}

async function readProjectSources(projectRoot) {
    const sources = [];
    async function walk(dir) {
        let entries = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
            } else if (/\.(ts|tsx|js|jsx|html|css|json)$/i.test(entry.name)) {
                sources.push({
                    path: path.relative(projectRoot, absolute).replace(/\\/g, '/'),
                    content: await readTextIfExists(absolute),
                });
            }
        }
    }
    await walk(path.join(projectRoot || '', 'src'));
    const index = await readTextIfExists(path.join(projectRoot || '', 'index.html'));
    if (index) sources.push({ path: 'index.html', content: index });
    return sources;
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function requiredAssetSlots(assetContract = null) {
    return (Array.isArray(assetContract?.slots) ? assetContract.slots : [])
        .filter((slot) => slot && slot.required !== false)
        .map((slot) => ({
            id: String(slot.id || slot.key || slot.name || slot.role || '').trim(),
            role: String(slot.role || slot.id || slot.key || slot.name || '').trim(),
        }))
        .filter((slot) => slot.id || slot.role);
}

function generatedAssetRoles(generatedAssets = null) {
    const pack = Array.isArray(generatedAssets?.assetPack) ? generatedAssets.assetPack : [];
    const materialized = Array.isArray(generatedAssets?.materializedAssetPack?.meta?.runtimeAssets)
        ? generatedAssets.materializedAssetPack.meta.runtimeAssets
        : Array.isArray(generatedAssets?.materializedAssetPack?.runtimeAssets)
            ? generatedAssets.materializedAssetPack.runtimeAssets
            : [];
    return unique([...pack, ...materialized].map((asset) => String(asset?.role || asset?.category || '').trim()));
}

function collectOpenGamePackAssets(assetPack = null) {
    const assets = [];
    if (!assetPack || typeof assetPack !== 'object') return assets;
    if (Array.isArray(assetPack?.meta?.runtimeAssets)) assets.push(...assetPack.meta.runtimeAssets);
    if (Array.isArray(assetPack?.runtimeAssets)) assets.push(...assetPack.runtimeAssets);
    if (Array.isArray(assetPack?.generated?.files)) assets.push(...assetPack.generated.files);
    for (const [sectionName, section] of Object.entries(assetPack)) {
        if (sectionName === 'meta' || !section || typeof section !== 'object') continue;
        if (!Array.isArray(section.files)) continue;
        for (const file of section.files) {
            assets.push({
                ...file,
                role: file.role || file.category || sectionName.replace(/s$/, ''),
                category: file.category || file.role || sectionName.replace(/s$/, ''),
            });
        }
    }
    return assets;
}

function sourceReferencesAny(source, values) {
    return values.some((value) => {
        if (!value) return false;
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(source);
    });
}

function collectAssetPackFacts(assetPack = null) {
    const runtimeAssets = collectOpenGamePackAssets(assetPack);
    const keys = new Set();
    const roles = new Set();
    const urls = new Set();
    for (const asset of runtimeAssets) {
        if (asset?.key) keys.add(String(asset.key));
        if (asset?.runtimeKey) keys.add(String(asset.runtimeKey));
        if (asset?.id) keys.add(String(asset.id));
        if (asset?.role) roles.add(String(asset.role));
        if (asset?.category) roles.add(String(asset.category));
        if (asset?.url) urls.add(String(asset.url));
    }
    return { runtimeAssets, keys, roles, urls };
}

function sourceAssetReferences(source) {
    const refs = new Set();
    const patterns = [
        /\b(?:getAssetImage|firstByRole|imageFor|spriteFor|assetFor)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /\bDreamAssets\.(?:getImage|loadImageElement|get|firstByRole|addSprite|addBackgroundCover)\s*\(\s*[^,)]*['"`]([^'"`]+)['"`]/g,
        /\bDREAM_IMAGES\s*(?:\?\.)?\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /\bDREAM_ASSETS\s*(?:\?\.)?\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /\b(?:this\.)?textures\.exists\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        /\b(?:this\.)?load\.(?:image|spritesheet|audio)\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /\b(?:this\.)?(?:add|physics\.add)\.(?:image|sprite)\s*\(\s*[^,\n]+,\s*[^,\n]+,\s*['"`]([^'"`]+)['"`]/g,
        /\.setTexture\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) refs.add(match[1]);
    }
    return Array.from(refs);
}

function unsafeCanvasDrawImageCalls(source) {
    const calls = [];
    const pattern = /\b(?:ctx|context|canvasContext|renderCtx)\.drawImage\s*\(\s*([^,\n)]+)/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const firstArg = match[1].trim();
        if (/DreamAssets\.getImage|DREAM_ASSET_PACK|DREAM_ASSETS|\.find\s*\(|assetPack|asset\s*$|entry\s*$|manifest/i.test(firstArg)) {
            calls.push(firstArg.slice(0, 120));
        }
    }
    return calls;
}

function collectAnimationFrameKeys(value, keys = new Set()) {
    if (!value || typeof value !== 'object') return keys;
    if (Array.isArray(value)) {
        for (const item of value) collectAnimationFrameKeys(item, keys);
        return keys;
    }
    for (const [key, item] of Object.entries(value)) {
        if (['key', 'textureKey', 'assetKey', 'frameKey'].includes(key) && typeof item === 'string') keys.add(item);
        if (Array.isArray(item) && /frames?/i.test(key)) {
            for (const frame of item) {
                if (typeof frame === 'string') keys.add(frame);
                else collectAnimationFrameKeys(frame, keys);
            }
            continue;
        }
        collectAnimationFrameKeys(item, keys);
    }
    return keys;
}

function levenshtein(a = '', b = '') {
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

function extractBalancedObjectLiteral(source, markerRegex) {
    const marker = markerRegex.exec(source);
    if (!marker) return '';
    const start = source.indexOf('{', marker.index);
    if (start < 0) return '';
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
        const ch = source[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return '';
}

function segmentObjectKey(segment = '') {
    const trimmed = String(segment || '').trim();
    if (!trimmed || trimmed.startsWith('...')) return null;
    if (/^(?:get|set|async)\s+/i.test(trimmed)) return null;
    const explicit = /^(?:['"`]([^'"`]+)['"`]|([A-Za-z_$][\w$]*))\s*:/.exec(trimmed);
    if (explicit?.[1] || explicit?.[2]) return explicit[1] || explicit[2];
    const shorthand = /^(?:['"`]([^'"`]+)['"`]|([A-Za-z_$][\w$]*))(?:\s*,?\s*)$/.exec(trimmed);
    return shorthand?.[1] || shorthand?.[2] || null;
}

function splitTopLevelObjectSegments(objectLiteral = '') {
    const segments = [];
    let depth = 0;
    let quote = null;
    let escaped = false;
    let segmentStart = 1;
    const pushSegment = (segment) => {
        if (String(segment || '').trim()) segments.push(segment);
    };
    for (let i = 1; i < objectLiteral.length - 1; i += 1) {
        const ch = objectLiteral[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') depth += 1;
        if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
            pushSegment(objectLiteral.slice(segmentStart, i));
            segmentStart = i + 1;
        }
    }
    pushSegment(objectLiteral.slice(segmentStart, -1));
    return segments;
}

function topLevelObjectKeys(objectLiteral = '') {
    const keys = new Set();
    for (const segment of splitTopLevelObjectSegments(objectLiteral)) {
        const key = segmentObjectKey(segment);
        if (key) keys.add(key);
    }
    return keys;
}

function dedupeTopLevelObjectLiteral(objectLiteral = '') {
    const segments = splitTopLevelObjectSegments(objectLiteral);
    const seen = new Set();
    const kept = [];
    const removed = [];
    for (const segment of segments) {
        const key = segmentObjectKey(segment);
        if (key && seen.has(key)) {
            removed.push(key);
            continue;
        }
        if (key) seen.add(key);
        kept.push(segment);
    }
    if (removed.length === 0) return { objectLiteral, removed };
    const inner = kept.length > 0 ? `\n${kept.join(',\n')}\n` : '';
    return { objectLiteral: `{${inner}}`, removed };
}

function extractMainStateObjectLiteral(source = '') {
    return extractBalancedObjectLiteral(source, /\b(?:const|let|var)\s+state\s*=/g);
}

function statePropertyIssues(mainSource = '') {
    const objectLiteral = extractMainStateObjectLiteral(mainSource);
    if (!objectLiteral) return [];
    const keys = topLevelObjectKeys(objectLiteral);
    if (keys.size === 0) return [];
    const refs = new Set();
    const refPattern = /\bstate\.([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = refPattern.exec(mainSource)) !== null) refs.add(match[1]);
    return Array.from(refs)
        .filter((ref) => !keys.has(ref))
        .map((ref) => {
            const suggestion = Array.from(keys)
                .map((key) => ({ key, distance: levenshtein(ref.toLowerCase(), key.toLowerCase()) }))
                .sort((a, b) => a.distance - b.distance)[0];
            return {
                key: ref,
                suggestion: suggestion && suggestion.distance <= 3 ? suggestion.key : null,
            };
        });
}

function collectStatePropertyUsageSnippets(key, source = '') {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\bstate\\.${escaped}\\b[\\s\\S]{0,80}`, 'g');
    const snippets = [];
    let match;
    while ((match = pattern.exec(source)) !== null) snippets.push(match[0]);
    return snippets.join(' ');
}

function inferStatePropertyInitializer(key, source = '') {
    const usageText = collectStatePropertyUsageSnippets(key, source);
    if (/\.(?:push|pop|shift|unshift|splice|filter|map|forEach|find|some|every|includes|slice)\s*\(/.test(usageText)
        || /\[\s*\d+\s*\]/.test(usageText)
        || /\.length\s*(?:[><=!+\-]|(?:\+\+|--))/.test(usageText)) {
        return '[]';
    }
    if (/\b=\s*['"`]/.test(usageText)) return "''";
    if (/\b=\s*(?:true|false)\b/.test(usageText)) return 'false';
    if (/\b(?:\+\+|--|[+\-*\/]=|[><=!]=?)\s*$|\b=\s*\d/.test(usageText)) return '0';
    if (/^(?:is|has|show|enabled|active|visible|dragging|cooking|paused)/i.test(key)) return 'false';
    if (/Expression|Mode|Status|Phase|Label|Text|Name|Type|Kind|Tone|Message/i.test(key)) return "''";
    if (/Map|Record|Settings|Config|Lookup|Index|Registry/i.test(key)) return '{}';
    if (/Flash|Cooldown|Timer|Score|Time|Count|Delay|Duration|Patience|Elapsed|Progress|Level|Wave|Offset|Alpha|Opacity|Frame|Tick|Remaining|Interval|Patience|Shift/i.test(key)) {
        return '0';
    }
    if (/pantry|particles|items|slots|orders|ingredients|list|targets|enemies|effects|trail|queue|cards|customers|rows|cells|nodes|history|events|bullets|drops|pickups/i.test(key)) {
        return '[]';
    }
    return 'null';
}

function renameMisspelledStateProperties(source = '', missingEntries = []) {
    let content = source;
    const renamed = [];
    for (const entry of missingEntries) {
        const wrong = entry?.key;
        const right = entry?.suggestion;
        if (!wrong || !right || wrong === right) continue;
        const pattern = new RegExp(`\\bstate\\.${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        const after = content.replace(pattern, `state.${right}`);
        if (after !== content) {
            renamed.push({ from: wrong, to: right });
            content = after;
        }
    }
    return { content, renamed };
}

function addMissingStateProperties(source = '', missingEntries = []) {
    const markerMatch = /\b(?:const|let|var)\s+state\s*=/.exec(source);
    if (!markerMatch) return { content: source, added: [] };

    const objectLiteral = extractMainStateObjectLiteral(source);
    const literalStart = source.indexOf('{', markerMatch.index);
    if (!objectLiteral || literalStart < 0) return { content: source, added: [] };

    const existingKeys = topLevelObjectKeys(objectLiteral);
    const toAdd = (Array.isArray(missingEntries) ? missingEntries : [])
        .filter((entry) => entry?.key && !entry?.suggestion && !existingKeys.has(entry.key));
    if (toAdd.length === 0) return { content: source, added: [] };

    const literalEnd = literalStart + objectLiteral.length;
    const inner = objectLiteral.slice(1, -1);
    const trimmedInner = inner.trim();
    const additions = toAdd.map(({ key }) => `  ${key}: ${inferStatePropertyInitializer(key, source)}`);
    const newInner = trimmedInner
        ? `${inner}${trimmedInner.endsWith(',') ? '' : ','}\n${additions.join(',\n')}\n`
        : `\n${additions.join(',\n')}\n`;
    const newLiteral = `{${newInner}}`;
    return {
        content: `${source.slice(0, literalStart)}${newLiteral}${source.slice(literalEnd)}`,
        added: toAdd.map((entry) => entry.key),
    };
}

function dedupeStateObjectProperties(source = '') {
    const markerMatch = /\b(?:const|let|var)\s+state\s*=/.exec(source);
    if (!markerMatch) return { content: source, removed: [] };

    const objectLiteral = extractMainStateObjectLiteral(source);
    const literalStart = source.indexOf('{', markerMatch.index);
    if (!objectLiteral || literalStart < 0) return { content: source, removed: [] };

    const deduped = dedupeTopLevelObjectLiteral(objectLiteral);
    if (deduped.removed.length === 0) return { content: source, removed: [] };
    return {
        content: `${source.slice(0, literalStart)}${deduped.objectLiteral}${source.slice(literalStart + objectLiteral.length)}`,
        removed: deduped.removed,
    };
}

export function applyDeterministicStatePropertyRepairs(source = '', missingEntries = []) {
    const rename = renameMisspelledStateProperties(source, missingEntries);
    const renamedKeys = new Set(rename.renamed.map((entry) => entry.from));
    const toAddEntries = (Array.isArray(missingEntries) ? missingEntries : [])
        .filter((entry) => entry?.key && !entry?.suggestion && !renamedKeys.has(entry.key));
    const add = addMissingStateProperties(rename.content, toAddEntries);
    const dedupe = dedupeStateObjectProperties(add.content);
    return {
        content: dedupe.content,
        renamed: rename.renamed,
        added: add.added,
        deduped: dedupe.removed,
    };
}

export function applyDeterministicStateObjectDedupeRepairs(source = '') {
    const dedupe = dedupeStateObjectProperties(source);
    return dedupe.removed.length > 0 ? dedupe : { content: source, removed: [] };
}

export async function applyDeterministicPreflightRepairs(projectRoot, preflight = {}, options = {}) {
    const applied = [];
    const mainPath = path.join(projectRoot || '', 'src', 'main.ts');
    let source = await readTextIfExists(mainPath);
    if (!source.trim()) return applied;

    const assetIssues = (preflight.issues || []).filter((issue) => [
        'preflight_required_asset_slots_unreferenced',
        'preflight_asset_key_missing_from_pack',
        'preflight_background_not_wired',
    ].includes(issue.id));
    if (assetIssues.length > 0) {
        const assetRepairs = await applyMainTsAssetWiringRepairs(projectRoot, {
            allowedKeys: options.allowedKeys || [],
            assetContract: options.assetContract || null,
            generatedAssets: options.generatedAssets || null,
        });
        for (const repair of assetRepairs) {
            applied.push(repair);
        }
        if (assetRepairs.length > 0) {
            source = await readTextIfExists(mainPath);
        }
    }

    for (const issue of preflight.issues || []) {
        if (issue.id !== 'preflight_state_property_missing' || !Array.isArray(issue.missingKeys) || issue.missingKeys.length === 0) {
            continue;
        }
        const repair = applyDeterministicStatePropertyRepairs(source, issue.missingKeys);
        if (repair.renamed.length === 0 && repair.added.length === 0 && repair.deduped.length === 0) continue;
        source = repair.content;
        if (repair.renamed.length > 0) {
            applied.push({
                path: 'src/main.ts',
                type: 'preflight_state_property_typo_rename',
                renamed: repair.renamed,
                from: repair.renamed.map((entry) => entry.from).join(', '),
                to: repair.renamed.map((entry) => entry.to).join(', '),
            });
        }
        if (repair.added.length > 0) {
            applied.push({
                path: 'src/main.ts',
                type: 'preflight_state_property_auto_declared',
                keys: repair.added,
                from: 'undeclared state refs',
                to: repair.added.join(', '),
            });
        }
        if (repair.deduped?.length > 0) {
            applied.push({
                path: 'src/main.ts',
                type: 'preflight_state_property_deduped',
                keys: repair.deduped,
                from: 'duplicate state keys',
                to: repair.deduped.join(', '),
            });
        }
    }

    if (applied.length > 0) {
        await fs.writeFile(mainPath, source, 'utf8');
    }
    return applied;
}

function sourceConfigReferences(source) {
    const refs = new Set();
    const patterns = [
        /\bgameConfig\.([A-Za-z_$][\w$]*)/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) refs.add(match[1]);
    }
    return Array.from(refs);
}

function htmlIds(html = '') {
    const ids = new Set();
    const pattern = /\bid\s*=\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = pattern.exec(html)) !== null) ids.add(match[1]);
    return ids;
}

function collectPhaserParentTargets(source = '') {
    const targets = new Set();
    const patterns = [
        /\bparent\s*:\s*['"`]([^'"`]+)['"`]/g,
        /\bparent\s*:\s*document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) targets.add(match[1]);
    }
    return Array.from(targets);
}

function collectMissingAppendTargets(source = '', ids = new Set()) {
    const missing = new Set();
    const directPattern = /document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*(?:!|\?)?\.appendChild\s*\(/g;
    let match;
    while ((match = directPattern.exec(source)) !== null) {
        if (!ids.has(match[1])) missing.add(match[1]);
    }

    const variableTargets = new Map();
    const assignmentPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((match = assignmentPattern.exec(source)) !== null) variableTargets.set(match[1], match[2]);
    for (const [variable, id] of variableTargets.entries()) {
        if (ids.has(id)) continue;
        const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\s*(?:!|\\?)?\\.appendChild\\s*\\(`).test(source)) missing.add(id);
    }

    return Array.from(missing);
}

function usesPhaserDomObjects(source = '') {
    return /\b(?:this|scene)\.add\.dom\s*\(|\badd\.dom\s*\(|\.createFromHTML\s*\(|\bPhaser\.GameObjects\.DOMElement\b/.test(source);
}

function hasPhaserDomContainerEnabled(source = '') {
    return /\bdom\s*:\s*\{[\s\S]{0,300}?\bcreateContainer\s*:\s*true\b/.test(source);
}

function collectInvalidPhaserScaleKeys(source = '') {
    const issues = [];
    const invalidKeys = new Set(['maxWidth', 'maxHeight', 'minWidth', 'minHeight']);
    const scalePattern = /\bscale\s*:/g;
    let match;
    while ((match = scalePattern.exec(source)) !== null) {
        const literal = extractBalancedObjectLiteral(source.slice(match.index), /\bscale\s*:/g);
        if (!literal) continue;
        for (const key of topLevelObjectKeys(literal)) {
            if (invalidKeys.has(key)) issues.push(key);
        }
    }
    return unique(issues);
}

function collectInheritedScenePropertyRedeclarations(projectSources = []) {
    const reserved = new Set([
        'player',
        'enemies',
        'enemyMeleeTriggers',
        'decorations',
        'obstacles',
        'playerBullets',
        'enemyBullets',
        'ySortGroup',
        'worldWidth',
        'worldHeight',
    ]);
    const issues = [];
    for (const file of projectSources) {
        if (!/\.(ts|tsx|js|jsx)$/i.test(file.path)) continue;
        if (/\/Base[A-Za-z0-9_$]*\.(ts|tsx|js|jsx)$/i.test(file.path)) continue;
        if (!/\bextends\s+Base(?:Game|Arena|Level)Scene\b/.test(file.content)) continue;
        const lines = file.content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const declaration = /^\s*(?:(?:public|private|protected|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:[!?:=]|:\s*[^=;]+[=;])/.exec(line);
            const property = declaration?.[1];
            if (!property || !reserved.has(property)) continue;
            if (/\b(?:constructor|if|for|while|switch|return|const|let|var|function)\b/.test(line)) continue;
            issues.push({ path: file.path, line: index + 1, property });
        }
    }
    return issues;
}

export async function runMakerPreflightChecks({ projectRoot, generatedAssets = null, assetContract = null } = {}) {
    const sourcePath = path.join(projectRoot || '', 'src', 'main.ts');
    const source = await readTextIfExists(sourcePath);
    const projectSources = await readProjectSources(projectRoot);
    const projectSource = projectSources.map((file) => `\n/* ${file.path} */\n${file.content}`).join('\n');
    const localAssetPack = await readJsonIfExists(path.join(projectRoot || '', 'public', 'assets', 'asset-pack.json'));
    const localAnimations = await readJsonIfExists(path.join(projectRoot || '', 'public', 'assets', 'animations.json'));
    const localAudio = await readJsonIfExists(path.join(projectRoot || '', 'public', 'assets', 'audio-manifest.json'));
    const gameConfig = await readJsonIfExists(path.join(projectRoot || '', 'src', 'gameConfig.json'));
    const packFacts = collectAssetPackFacts(localAssetPack || generatedAssets?.materializedAssetPack || null);
    const indexHtml = await readTextIfExists(path.join(projectRoot || '', 'index.html'));
    const indexIds = htmlIds(indexHtml);
    const issues = [];

    if (!source.trim()) {
        issues.push({
            id: 'preflight_missing_main_source',
            severity: 'critical',
            message: 'src/main.ts is missing or empty before build.',
            repair: 'Restore a complete src/main.ts implementation from the selected scaffold before running build or sandbox checks.',
        });
    }

    const hasVisualAssets = generatedAssets?.assets && Object.keys(generatedAssets.assets).length > 0;
    if (hasVisualAssets && !localAssetPack) {
        issues.push({
            id: 'preflight_asset_pack_missing',
            severity: 'critical',
            message: 'Generated visual assets exist, but public/assets/asset-pack.json was not materialized.',
            repair: 'Materialize generated assets into public/assets/asset-pack.json before build or sandbox verification.',
        });
    }
    if (hasVisualAssets && !/assets\/asset-pack\.json|DreamAssets|DREAM_ASSET_PACK|DREAM_ASSET_LIST|DREAM_ASSETS/.test(projectSource)) {
        issues.push({
            id: 'preflight_asset_pack_ignored',
            severity: 'critical',
            message: 'Generated visual assets exist, but project source never loads public/assets/asset-pack.json or DreamAssets.',
            repair: 'Load generated gameplay art through public/assets/asset-pack.json, DreamAssets, or DREAM_ASSET_PACK before falling back to procedural placeholders.',
        });
    }

    const requiredSlots = requiredAssetSlots(assetContract);
    const roles = generatedAssetRoles(generatedAssets);
    const materializedSlots = localAssetPack?.meta?.slots
        || localAssetPack?.slots
        || generatedAssets?.materializedAssetPack?.meta?.slots
        || generatedAssets?.materializedAssetPack?.slots
        || [];
    const slotsWithoutRuntimeKey = requiredSlots
        .filter((slot) => {
            const slotReport = materializedSlots.find((entry) => entry?.id === slot.id || entry?.role === slot.role);
            return !slotReport || (slotReport.required !== false && slotReport.status !== 'ready' && !slotReport.fallbackRecorded);
        })
        .map((slot) => slot.id || slot.role);
    if (slotsWithoutRuntimeKey.length > 0 && hasVisualAssets) {
        issues.push({
            id: 'preflight_required_asset_slots_missing_runtime_key',
            severity: 'critical',
            message: `Required asset slots have no stable runtime key or recorded fallback: ${slotsWithoutRuntimeKey.join(', ')}.`,
            missingSlots: slotsWithoutRuntimeKey,
            repair: 'Resolve each required contract slot to a runtime key in public/assets/asset-pack.json, or record an explicit fallback if the generated asset is missing.',
        });
    }
    const missingRequiredSlots = requiredSlots
        .filter((slot) => {
            const slotReport = materializedSlots.find((entry) => entry?.id === slot.id || entry?.role === slot.role);
            return !sourceReferencesAny(projectSource, unique([slot.id, slot.role, slotReport?.runtimeKey]));
        })
        .map((slot) => slot.id || slot.role);
    if (missingRequiredSlots.length > 0 && roles.length > 0) {
        issues.push({
            id: 'preflight_required_asset_slots_unreferenced',
            severity: 'critical',
            message: `Required generated asset slots are not referenced before build: ${missingRequiredSlots.join(', ')}.`,
            missingSlots: missingRequiredSlots,
            repair: 'Reference each required slot by role/key and render that generated asset in the matching gameplay renderer.',
        });
    }

    const requiresBackgroundArt = requiredSlots.some((slot) => slot.required && (
        slot.role === 'background'
        || slot.assetType === 'background'
        || slot.category === 'environment'
    ));
    const packHasBackgroundArt = packFacts.roles.has('background')
        || packFacts.roles.has('environment')
        || [...packFacts.keys].some((key) => /^background/i.test(String(key)));
    const wiresBackgroundRenderer = /resolveBackgroundImage|function drawBackground|getAssetImage\(['"](?:background1|background|environment)['"]\)/.test(source);
    if (requiresBackgroundArt && packHasBackgroundArt && hasVisualAssets && !wiresBackgroundRenderer) {
        issues.push({
            id: 'preflight_background_not_wired',
            severity: 'critical',
            message: 'A generated background asset exists in the pack, but src/main.ts does not draw it (missing resolveBackgroundImage/drawBackground/getAssetImage background wiring).',
            repair: 'In renderAll, call resolveBackgroundImage() or getAssetImage("background1") and ctx.drawImage the result full-bleed before entities. Do not ship flat gradient placeholders when background art exists.',
        });
    }

    const unknownAssetRefs = sourceAssetReferences(projectSource)
        .filter((ref) => !packFacts.keys.has(ref) && !packFacts.roles.has(ref) && !['player', 'enemy', 'item', 'prop', 'effect', 'background', 'environment', 'collectible', 'sfx', 'music'].includes(ref));
    if (localAssetPack && unknownAssetRefs.length > 0) {
        issues.push({
            id: 'preflight_asset_key_missing_from_pack',
            severity: 'critical',
            message: `Project references asset keys that are not in public/assets/asset-pack.json: ${unknownAssetRefs.slice(0, 8).join(', ')}.`,
            missingKeys: unknownAssetRefs.slice(0, 12),
            repair: 'Use keys from public/assets/asset-pack.json, or add the missing generated asset entries before build.',
        });
    }

    const unsafeDraws = unsafeCanvasDrawImageCalls(projectSource);
    if (unsafeDraws.length > 0) {
        issues.push({
            id: 'preflight_unsafe_canvas_draw_image_source',
            severity: 'critical',
            message: `Canvas drawImage is called with manifest/data objects instead of loaded image elements: ${unsafeDraws.slice(0, 4).join(', ')}.`,
            unsafeDraws: unsafeDraws.slice(0, 8),
            repair: 'For canvas rendering, preload keys through DreamAssets.loadImageElement(keyOrRole) or window.DREAM_IMAGES, cache HTMLImageElement instances, then pass only those loaded elements to ctx.drawImage.',
        });
    }

    const missingStateRefs = statePropertyIssues(source);
    if (missingStateRefs.length > 0) {
        issues.push({
            id: 'preflight_state_property_missing',
            severity: 'critical',
            message: `Project references state properties not declared in the state object: ${missingStateRefs.map((entry) => entry.suggestion ? `${entry.key} (did you mean ${entry.suggestion})` : entry.key).slice(0, 8).join(', ')}.`,
            missingKeys: missingStateRefs.slice(0, 12),
            repair: 'Use the existing state property name or add the missing property to the state initializer before build.',
        });
    }

    if (localAnimations) {
        const animationFrameKeys = Array.from(collectAnimationFrameKeys(localAnimations));
        const missingFrameKeys = animationFrameKeys.filter((key) => !packFacts.keys.has(key));
        if (missingFrameKeys.length > 0) {
            issues.push({
                id: 'preflight_animation_frame_key_missing_from_pack',
                severity: 'critical',
                message: `Animation manifest references frame keys missing from public/assets/asset-pack.json: ${missingFrameKeys.slice(0, 8).join(', ')}.`,
                missingKeys: missingFrameKeys.slice(0, 12),
                repair: 'Regenerate/fix animations.json or asset-pack.json so every animation frame key exists in the loaded asset pack.',
            });
        }
    }

    const registeredScenes = new Set();
    const sceneClassPattern = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+Phaser\.Scene[\s\S]{0,300}?super\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let sceneMatch;
    while ((sceneMatch = sceneClassPattern.exec(projectSource)) !== null) registeredScenes.add(sceneMatch[2]);
    const sceneArrayPattern = /\bscene\s*:\s*\[([\s\S]*?)\]/g;
    while ((sceneMatch = sceneArrayPattern.exec(projectSource)) !== null) {
        const block = sceneMatch[1];
        const names = block.match(/\b[A-Z][A-Za-z0-9_$]*/g) || [];
        for (const name of names) registeredScenes.add(name);
    }
    const sceneTargets = new Set();
    const sceneStartPattern = /\.scene\.(?:start|launch|switch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((sceneMatch = sceneStartPattern.exec(projectSource)) !== null) sceneTargets.add(sceneMatch[1]);
    const missingScenes = Array.from(sceneTargets).filter((scene) => !registeredScenes.has(scene));
    if (missingScenes.length > 0) {
        issues.push({
            id: 'preflight_scene_key_missing',
            severity: 'critical',
            message: `Project starts Phaser scenes that are not registered or declared: ${missingScenes.slice(0, 8).join(', ')}.`,
            missingKeys: missingScenes.slice(0, 12),
            repair: 'Register every scene key in the Phaser game config and keep scene.start/launch keys identical to each scene constructor key.',
        });
    }

    const configRefs = sourceConfigReferences(projectSource);
    if (gameConfig && configRefs.length > 0) {
        const missingConfigRefs = configRefs.filter((key) => !Object.prototype.hasOwnProperty.call(gameConfig, key));
        if (missingConfigRefs.length > 0) {
            issues.push({
                id: 'preflight_game_config_key_missing',
                severity: 'critical',
                message: `Project references gameConfig fields missing from src/gameConfig.json: ${missingConfigRefs.slice(0, 8).join(', ')}.`,
                missingKeys: missingConfigRefs.slice(0, 12),
                repair: 'Add the referenced gameConfig fields or update the source to use fields that exist.',
            });
        }
    }

    const missingPhaserParents = collectPhaserParentTargets(projectSource).filter((target) => !indexIds.has(target));
    if (missingPhaserParents.length > 0) {
        issues.push({
            id: 'preflight_dom_parent_missing',
            severity: 'critical',
            message: `Phaser config references missing DOM parent id(s): ${missingPhaserParents.slice(0, 8).join(', ')}.`,
            missingKeys: missingPhaserParents.slice(0, 12),
            repair: 'Keep <div id="game-container"></div> in index.html and set Phaser config parent to "game-container", or add the referenced mount element before new Phaser.Game runs.',
        });
    }

    const missingAppendTargets = collectMissingAppendTargets(projectSource, indexIds);
    if (missingAppendTargets.length > 0) {
        issues.push({
            id: 'preflight_dom_append_target_missing',
            severity: 'critical',
            message: `Source appends children to missing DOM id(s): ${missingAppendTargets.slice(0, 8).join(', ')}.`,
            missingKeys: missingAppendTargets.slice(0, 12),
            repair: 'Only call appendChild on document.body or on DOM IDs present in index.html; for Phaser, use the existing game-container mount element and null-check custom DOM targets.',
        });
    }

    if (usesPhaserDomObjects(projectSource) && !hasPhaserDomContainerEnabled(projectSource)) {
        issues.push({
            id: 'preflight_phaser_dom_container_missing',
            severity: 'critical',
            message: 'Phaser DOM game objects are used, but the Phaser config does not enable dom.createContainer.',
            repair: 'Keep dom: { createContainer: true } in the Phaser game config whenever UI scenes or helpers use this.add.dom/createFromHTML, or remove Phaser DOM objects entirely.',
        });
    }

    const invalidScaleKeys = collectInvalidPhaserScaleKeys(projectSource);
    if (invalidScaleKeys.length > 0) {
        issues.push({
            id: 'preflight_phaser_invalid_scale_config',
            severity: 'critical',
            message: `Phaser ScaleConfig includes unsupported top-level key(s): ${invalidScaleKeys.join(', ')}.`,
            missingKeys: invalidScaleKeys,
            repair: 'Remove unsupported ScaleConfig keys such as maxWidth/maxHeight/minWidth/minHeight. Use width, height, mode, autoCenter, and CSS/container constraints instead.',
        });
    }

    const inheritedSceneRedeclarations = collectInheritedScenePropertyRedeclarations(projectSources);
    if (inheritedSceneRedeclarations.length > 0) {
        issues.push({
            id: 'preflight_inherited_scene_property_redeclared',
            severity: 'critical',
            message: `Generated scene redeclares scaffold-owned property/properties: ${inheritedSceneRedeclarations.map((entry) => `${entry.path}:${entry.line} ${entry.property}`).slice(0, 8).join(', ')}.`,
            missingKeys: inheritedSceneRedeclarations.map((entry) => entry.property).slice(0, 12),
            repair: 'Do not redeclare BaseGameScene/BaseArenaScene-owned fields such as player, enemies, bullets, obstacles, or world dimensions. Use the inherited Phaser groups as-is, or rename custom arrays/state to maker-specific names like sliceTargets.',
        });
    }

    const touchPointerMismatch = /addEventListener\s*\(\s*['"`]touch(?:start|move|end|cancel)['"`][\s\S]{0,240}\(\s*\w+\s*:\s*PointerEvent\s*\)/m.test(projectSource);
    if (touchPointerMismatch) {
        issues.push({
            id: 'preflight_touch_pointer_event_mismatch',
            severity: 'critical',
            message: 'A touch event listener is wired to a handler typed as PointerEvent, which TypeScript rejects.',
            repair: 'Use pointerdown/pointermove/pointerup for PointerEvent handlers, or type touch handlers as TouchEvent/Event and narrow safely.',
        });
    }

    const isPhaserProject = /\bnew\s+Phaser\.Game\s*\(|\bextends\s+Phaser\.Scene\b/.test(projectSource);
    const likelyNoFirstFrame = !isPhaserProject
        && source.trim()
        && /document\.createElement\s*\(\s*['"`]canvas['"`]\s*\)|getElementById\s*\(\s*['"`][^'"`]*(?:canvas|game)[^'"`]*['"`]\s*\)/i.test(projectSource)
        && !/requestAnimationFrame|setInterval|setTimeout\s*\(\s*(?:render|draw|loop|tick|update)|\b(?:render|draw|loop|tick|update)\s*\(\s*\)/i.test(projectSource);
    if (likelyNoFirstFrame) {
        issues.push({
            id: 'preflight_no_visible_first_frame_path',
            severity: 'critical',
            message: 'Canvas setup does not clearly schedule an animation loop or immediate render call.',
            repair: 'Draw a visible boot frame synchronously, then start requestAnimationFrame so sandbox pixel checks see gameplay immediately.',
        });
    }

    const generatedUiImageRisk = /\b(?:button|hud|score|label|meter|menu|toolbar|ui)[A-Za-z0-9_$]*\s*[:=]\s*[^;\n]*(?:DREAM_IMAGES|DreamAssets|getAssetImage|textures\.exists)/i.test(projectSource);
    if (generatedUiImageRisk) {
        issues.push({
            id: 'preflight_generated_image_used_for_ui',
            severity: 'critical',
            message: 'Generated images appear to be wired into HUD/buttons/text instead of gameplay art.',
            repair: 'Keep HUD/buttons/text code-rendered and use generated images only for sprites, backgrounds, props, items, effects, or scenery.',
        });
    }

    return {
        success: !issues.some((issue) => issue.severity === 'critical'),
        issues,
        evidence: {
            assetPackPresent: Boolean(localAssetPack),
            animationsPresent: Boolean(localAnimations),
            audioManifestPresent: Boolean(localAudio),
            assetKeys: Array.from(packFacts.keys).slice(0, 80),
            assetRoles: Array.from(packFacts.roles).slice(0, 40),
            sourceFiles: projectSources.map((file) => file.path),
        },
    };
}
