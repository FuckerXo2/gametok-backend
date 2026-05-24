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
    const materialized = Array.isArray(generatedAssets?.materializedAssetPack?.runtimeAssets)
        ? generatedAssets.materializedAssetPack.runtimeAssets
        : [];
    return unique([...pack, ...materialized].map((asset) => String(asset?.role || asset?.category || '').trim()));
}

function sourceReferencesAny(source, values) {
    return values.some((value) => {
        if (!value) return false;
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(source);
    });
}

function collectAssetPackFacts(assetPack = null) {
    const runtimeAssets = Array.isArray(assetPack?.runtimeAssets)
        ? assetPack.runtimeAssets
        : Array.isArray(assetPack?.generated?.files)
            ? assetPack.generated.files
            : [];
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
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) refs.add(match[1]);
    }
    return Array.from(refs);
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
    const materializedSlots = localAssetPack?.slots || generatedAssets?.materializedAssetPack?.slots || [];
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
