import fs from 'fs/promises';
import path from 'path';

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

function topLevelObjectKeys(objectLiteral = '') {
    const keys = new Set();
    let depth = 0;
    let quote = null;
    let escaped = false;
    let segmentStart = 1;
    const pushSegment = (segment) => {
        const match = /^\s*(?:['"`]([^'"`]+)['"`]|([A-Za-z_$][\w$]*))\s*:/.exec(segment);
        const key = match?.[1] || match?.[2];
        if (key) keys.add(key);
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
    return keys;
}

function statePropertyIssues(projectSource = '') {
    const objectLiteral = extractBalancedObjectLiteral(projectSource, /\b(?:const|let|var)\s+state\s*=/g);
    if (!objectLiteral) return [];
    const keys = topLevelObjectKeys(objectLiteral);
    if (keys.size === 0) return [];
    const refs = new Set();
    const refPattern = /\bstate\.([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = refPattern.exec(projectSource)) !== null) refs.add(match[1]);
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

    const missingStateRefs = statePropertyIssues(projectSource);
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

    const touchPointerMismatch = /addEventListener\s*\(\s*['"`]touch(?:start|move|end|cancel)['"`][\s\S]{0,240}\(\s*\w+\s*:\s*PointerEvent\s*\)/m.test(projectSource);
    if (touchPointerMismatch) {
        issues.push({
            id: 'preflight_touch_pointer_event_mismatch',
            severity: 'critical',
            message: 'A touch event listener is wired to a handler typed as PointerEvent, which TypeScript rejects.',
            repair: 'Use pointerdown/pointermove/pointerup for PointerEvent handlers, or type touch handlers as TouchEvent/Event and narrow safely.',
        });
    }

    const likelyNoFirstFrame = source.trim()
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
