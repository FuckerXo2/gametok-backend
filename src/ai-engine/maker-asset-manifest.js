function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeRole(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function visualAssetType(asset = {}) {
    const type = normalizeRole(asset.type || asset.kind || asset.assetType);
    if (['background', 'sprite', 'image', 'tileset', 'animation', 'sfx', 'music'].includes(type)) {
        return type;
    }
    if (asset.url || asset.key) return 'image';
    return type || 'unknown';
}

function assetKey(asset = {}) {
    return asset.key || asset.id || null;
}

function assetHasPayload(asset = {}, generatedAssets = null) {
    const key = assetKey(asset);
    return Boolean(asset.url || (key && generatedAssets?.assets?.[key]));
}

function summarizeAsset(asset = {}, generatedAssets = null) {
    const key = assetKey(asset);
    const role = normalizeRole(asset.role || asset.category || asset.gameplayRole || key);
    const type = visualAssetType(asset);
    const hasEmbeddedImage = assetHasPayload(asset, generatedAssets);
    return {
        id: asset.id || key,
        key,
        runtimeKey: key,
        type,
        role: role || null,
        category: normalizeRole(asset.category || asset.role) || null,
        transparent: asset.transparent !== false && type !== 'background',
        width: asset.width || null,
        height: asset.height || null,
        gameplayRole: asset.gameplayRole || asset.roleInGameplay || null,
        source: asset.source || asset.provider || 'gametok-artist-agent',
        status: hasEmbeddedImage || ['animation', 'sfx', 'music', 'tileset'].includes(type) ? 'ready' : 'metadata_only',
        hasEmbeddedImage,
    };
}

function findAssetForSlot(slot = {}, assets = [], generatedAssets = null) {
    const slotValues = [
        slot.id,
        slot.role,
        slot.category,
    ].map(normalizeRole).filter(Boolean);

    return assets.find((asset) => {
        const values = [
            asset.id,
            asset.key,
            asset.role,
            asset.category,
            asset.gameplayRole,
        ].map(normalizeRole).filter(Boolean);
        return slotValues.some((slotValue) => values.includes(slotValue));
    }) || assets.find((asset) => {
        const slotRole = normalizeRole(slot.role || slot.category);
        const assetRole = normalizeRole(asset.role || asset.category);
        return slotRole && assetRole && slotRole === assetRole && assetHasPayload(asset, generatedAssets);
    }) || null;
}

function groupAssets(assets = []) {
    const groups = {
        backgrounds: [],
        sprites: [],
        effects: [],
        items: [],
        props: [],
        animations: [],
        audio: [],
        tilesets: [],
        other: [],
    };

    for (const asset of assets) {
        const type = visualAssetType(asset);
        const role = normalizeRole(asset.role || asset.category);
        if (type === 'background' || role === 'background' || role === 'environment') {
            groups.backgrounds.push(asset);
        } else if (type === 'animation') {
            groups.animations.push(asset);
        } else if (type === 'sfx' || type === 'music' || type === 'audio_file') {
            groups.audio.push(asset);
        } else if (type === 'tileset') {
            groups.tilesets.push(asset);
        } else if (role === 'effect' || role === 'projectile') {
            groups.effects.push(asset);
        } else if (role === 'item' || role === 'collectible') {
            groups.items.push(asset);
        } else if (role === 'prop') {
            groups.props.push(asset);
        } else if (['player', 'enemy', 'boss', 'hazard'].includes(role) || type === 'sprite' || type === 'image') {
            groups.sprites.push(asset);
        } else {
            groups.other.push(asset);
        }
    }

    return groups;
}

export function buildMakerAssetManifest({
    generatedAssets = null,
    assetContract = null,
    templateContract = null,
    qualityIntent = {},
    errors = [],
} = {}) {
    const packAssets = asArray(generatedAssets?.assetPack).map((asset) => summarizeAsset(asset, generatedAssets));
    const manifestAssets = asArray(generatedAssets?.manifest?.assets).map((asset) => summarizeAsset(asset, generatedAssets));
    const byKey = new Map();
    for (const asset of [...manifestAssets, ...packAssets]) {
        const key = asset.key || asset.id || JSON.stringify(asset);
        byKey.set(key, { ...(byKey.get(key) || {}), ...asset });
    }
    const assets = Array.from(byKey.values());
    const groups = groupAssets(assets);
    const slots = asArray(assetContract?.slots).map((slot) => {
        const match = findAssetForSlot(slot, assets, generatedAssets);
        const role = normalizeRole(slot.role || slot.category || slot.id);
        return {
            id: slot.id || role,
            role,
            category: normalizeRole(slot.category || slot.role) || role,
            assetType: slot.assetType || slot.type || 'sprite',
            required: Boolean(slot.required),
            transparent: slot.transparent !== false,
            dimensions: {
                size: slot.size || null,
                width: slot.width || null,
                height: slot.height || null,
            },
            consumedBy: slot.consumedBy || null,
            fallback: slot.fallback || null,
            runtimeKey: match?.runtimeKey || match?.key || null,
            matchedAssetId: match?.id || null,
            status: match && match.status !== 'metadata_only' ? 'ready' : 'missing',
        };
    });

    const missingRequiredSlots = slots
        .filter((slot) => slot.required && slot.status !== 'ready')
        .map((slot) => slot.id);

    return {
        version: 3,
        source: 'gametok-native-maker',
        generatedAt: new Date().toISOString(),
        templateId: templateContract?.templateId || assetContract?.templateId || null,
        title: qualityIntent?.title || null,
        style: qualityIntent?.artDirection || generatedAssets?.assetPlan?.artDirection || null,
        runtimeApi: {
            globals: ['window.DREAM_ASSETS', 'window.DREAM_ASSET_PACK', 'window.DREAM_ASSET_MANIFEST', 'window.DreamAssets'],
            recommendedLookups: [
                'DreamAssets.firstByRole("player")',
                'DreamAssets.firstByRole("enemy")',
                'DreamAssets.firstByRole("background")',
                'DreamAssets.getImage(asset.key)',
            ],
            phaserHelpers: ['DreamAssets.preloadPhaser(scene)', 'DreamAssets.addSprite(scene, roleOrKey, x, y, options)', 'DreamAssets.addBackgroundCover(scene, roleOrKey, width, height)'],
        },
        codeOnlyUiRules: [
            'HUD text, labels, scores, health bars, buttons, sliders, meters, and touch controls are code-rendered only.',
            'Generated images are allowed for scenery, actors, enemies, effects, props, collectibles, and decorative non-interactive surfaces.',
            'Collision geometry, terrain data, hitboxes, landing pads, tactical paths, and objective zones stay code-defined.',
        ],
        loadPlan: [
            'Install DreamAssets runtime before game code.',
            'Preload every ready image asset into Phaser or create HTMLImageElement cache before first render.',
            'Render a generated background first when a background slot is ready.',
            'Use required player/enemy slots before falling back to code-rendered shapes.',
            'Audio is optional and must never block gameplay boot.',
        ],
        slots,
        missingRequiredSlots,
        assets: groups,
        flatAssets: assets,
        animations: asArray(generatedAssets?.animations),
        audio: generatedAssets?.audio || { sfx: [], music: [] },
        tilesets: asArray(generatedAssets?.tilesets),
        productionContract: generatedAssets?.productionContract || generatedAssets?.manifest?.productionContract || null,
        errors: [
            ...asArray(errors),
            ...asArray(generatedAssets?.errors),
        ],
    };
}

export function summarizeMakerAssetManifest(manifest = null) {
    if (!manifest) {
        return {
            version: 3,
            assets: [],
            slots: [],
            missingRequiredSlots: [],
            counts: {},
            errors: [],
        };
    }
    const counts = {};
    for (const [group, assets] of Object.entries(manifest.assets || {})) {
        counts[group] = Array.isArray(assets) ? assets.length : 0;
    }
    return {
        version: manifest.version || 3,
        source: manifest.source || 'gametok-native-maker',
        templateId: manifest.templateId || null,
        counts,
        slots: asArray(manifest.slots).map((slot) => ({
            id: slot.id,
            role: slot.role,
            required: slot.required,
            status: slot.status,
            runtimeKey: slot.runtimeKey,
            consumedBy: slot.consumedBy,
            fallback: slot.fallback,
        })),
        assets: asArray(manifest.flatAssets).map((asset) => ({
            key: asset.key,
            role: asset.role,
            category: asset.category,
            type: asset.type,
            status: asset.status,
            transparent: asset.transparent,
        })),
        runtimeApi: manifest.runtimeApi || null,
        codeOnlyUiRules: manifest.codeOnlyUiRules || [],
        missingRequiredSlots: manifest.missingRequiredSlots || [],
        errors: manifest.errors || [],
    };
}
