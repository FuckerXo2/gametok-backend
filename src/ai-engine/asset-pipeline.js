function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeId(value, fallback) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function includesAny(text, terms) {
    const haystack = String(text || '').toLowerCase();
    return terms.some((term) => haystack.includes(term));
}

function collectSpecText(qualityIntent = {}) {
    return [
        qualityIntent.userIntent,
        qualityIntent.playableExperience?.coreFantasy,
        qualityIntent.playableExperience?.coreLoop,
        qualityIntent.playableExperience?.primaryMechanic,
        qualityIntent.technicalRequirements?.screenComposition,
        ...asArray(qualityIntent.playerActions),
        ...asArray(qualityIntent.mustExist),
        ...asArray(qualityIntent.feelRules),
        ...asArray(qualityIntent.failureModesToAvoid),
        ...asArray(qualityIntent.entityRules).flatMap((rule) => [
            rule.entity,
            rule.role,
            rule.behavior,
            rule.interaction,
            rule.feedback,
        ]),
    ].filter(Boolean).join(' ');
}

function findRoleDescription(assetRoles, assetId, fallback = '') {
    const match = asArray(assetRoles).find((role) => role.assetId === assetId || role.assetId === safeId(assetId, assetId));
    return match?.roleInGameplay || fallback;
}

function pushRequest(requests, request, seen) {
    const id = safeId(request.id, `asset_${requests.length + 1}`);
    if (seen.has(id)) return;
    seen.add(id);
    requests.push({
        ...request,
        id,
    });
}

export function buildDreamAssetPlan(qualityIntent = {}) {
    const visualAssets = qualityIntent.visualAssets || {};
    const assetRoles = asArray(qualityIntent.assetRoles);
    const requests = [];
    const seen = new Set();

    if (visualAssets.player) {
        pushRequest(requests, {
            id: 'player',
            assetType: 'sprite',
            description: visualAssets.player.description,
            category: 'player',
            role: 'player',
            gameplayRole: findRoleDescription(assetRoles, 'player', 'main playable character'),
            size: visualAssets.player.size || 128,
            transparent: visualAssets.player.transparent !== false,
        }, seen);
    }

    asArray(visualAssets.enemies).forEach((enemy, idx) => {
        const id = enemy.id || `enemy${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: enemy.description,
            category: 'enemy',
            role: 'enemy',
            gameplayRole: findRoleDescription(assetRoles, id, 'opponent or hazard'),
            size: enemy.size || 128,
            transparent: enemy.transparent !== false,
        }, seen);
    });

    asArray(visualAssets.items).forEach((item, idx) => {
        const id = item.id || `item${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: item.description,
            category: 'item',
            role: 'item',
            gameplayRole: findRoleDescription(assetRoles, id, 'pickup, collectible, power-up, or resource'),
            size: item.size || 64,
            transparent: item.transparent !== false,
        }, seen);
    });

    asArray(visualAssets.backgrounds).forEach((bg, idx) => {
        const id = bg.id || `background${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'background',
            description: bg.description,
            category: 'environment',
            role: 'background',
            gameplayRole: findRoleDescription(assetRoles, id, 'main playfield backdrop'),
            size: bg.size || 512,
            transparent: bg.transparent === true,
        }, seen);
    });

    asArray(visualAssets.ui).forEach((ui, idx) => {
        const id = ui.id || `ui${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'ui',
            description: ui.description,
            category: 'ui',
            role: 'ui',
            gameplayRole: findRoleDescription(assetRoles, id, 'HUD or control feedback'),
            size: ui.size || 32,
            transparent: ui.transparent !== false,
        }, seen);
    });

    asArray(visualAssets.props).forEach((prop, idx) => {
        const id = prop.id || `prop${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: prop.description,
            category: 'prop',
            role: 'prop',
            gameplayRole: findRoleDescription(assetRoles, id, 'obstacle, decoration, or interactive prop'),
            size: prop.size || 96,
            transparent: prop.transparent !== false,
        }, seen);
    });

    const specText = collectSpecText(qualityIntent);
    const animations = buildAnimationPlan(requests, qualityIntent);
    const audio = buildAudioPlan(qualityIntent);
    const tilesets = buildTilesetPlan(qualityIntent, specText);

    return {
        version: 1,
        imageRequests: requests,
        animations,
        audio,
        tilesets,
    };
}

function buildAnimationPlan(requests, qualityIntent = {}) {
    const perspective = String(qualityIntent.technicalRequirements?.perspective || '').toLowerCase();
    const isTopDown = perspective === 'top_down' || perspective === 'isometric';
    const player = requests.find((request) => request.role === 'player');
    const enemies = requests.filter((request) => request.role === 'enemy').slice(0, 3);
    const animations = [];

    if (player) {
        animations.push({
            key: 'player_idle',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: ['idle'],
            implementation: 'subtle breathing scale, small vertical bob, cloak/limb sway if applicable',
        });
        animations.push({
            key: 'player_move',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: isTopDown ? ['move_up', 'move_down', 'move_left', 'move_right'] : ['move'],
            implementation: 'direction-aware flip/rotation, squash on acceleration, dust or trail particles',
        });
        animations.push({
            key: 'player_hit_or_dash',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: ['hit', 'dash'],
            implementation: 'flash tint, afterimage trail, brief scale pop, short hit-stop on impact',
        });
    }

    enemies.forEach((enemy) => {
        animations.push({
            key: `${enemy.id}_motion`,
            type: 'procedural_tween',
            sourceKey: enemy.id,
            role: 'enemy',
            states: ['idle', 'move', 'hit', 'defeat'],
            implementation: 'squash-and-stretch movement, hit flash, particle burst on defeat',
        });
    });

    return animations;
}

function buildAudioPlan(qualityIntent = {}) {
    const sfxNeeds = asArray(qualityIntent.audioNeeds?.sfx);
    const musicNeeds = asArray(qualityIntent.audioNeeds?.music);
    const mustExistText = asArray(qualityIntent.mustExist).join(' ');
    const defaults = [
        { key: 'ui_tap', role: 'ui', trigger: 'button press or menu selection', style: 'short soft click' },
        { key: 'impact', role: 'feedback', trigger: 'player or enemy takes damage', style: 'punchy low thud with bright transient' },
        { key: 'collect', role: 'reward', trigger: 'pickup, score, combo, or resource gain', style: 'rising chime' },
    ];

    if (includesAny(mustExistText, ['cast', 'spell', 'shoot', 'fire', 'attack'])) {
        defaults.push({ key: 'primary_action', role: 'action', trigger: 'main player attack/cast/use action', style: 'snappy magical or arcade burst' });
    }
    if (includesAny(mustExistText, ['dash', 'boost', 'jump', 'move'])) {
        defaults.push({ key: 'movement_burst', role: 'movement', trigger: 'dash, jump, boost, or fast movement', style: 'quick whoosh' });
    }
    if (includesAny(mustExistText, ['win', 'wave', 'survive', 'level'])) {
        defaults.push({ key: 'success', role: 'success', trigger: 'wave clear, win, or milestone', style: 'short victory sparkle' });
    }
    if (includesAny(mustExistText, ['lose', 'health', 'death', 'fail'])) {
        defaults.push({ key: 'failure', role: 'failure', trigger: 'loss, defeat, or health depleted', style: 'short descending sting' });
    }

    const sfx = defaults.map((entry, index) => ({
        ...entry,
        type: 'procedural_web_audio',
        assetType: 'sfx',
        description: sfxNeeds[index] || entry.style,
    }));

    const music = musicNeeds.length > 0
        ? musicNeeds.map((description, index) => ({
            key: index === 0 ? 'bgm_main' : `bgm_${index + 1}`,
            type: 'procedural_web_audio',
            assetType: 'music',
            role: 'background_music',
            trigger: 'gameplay loop',
            description,
        }))
        : [{
            key: 'bgm_main',
            type: 'procedural_web_audio',
            assetType: 'music',
            role: 'background_music',
            trigger: 'gameplay loop',
            description: 'subtle loop matching the game mood without overpowering mobile play',
        }];

    return { sfx, music };
}

function buildTilesetPlan(qualityIntent = {}, specText = '') {
    const needsTiles = includesAny(specText, [
        'tile',
        'tileset',
        'platform',
        'maze',
        'grid',
        'dungeon',
        'room',
        'wall',
        'floor',
        'terrain',
    ]);

    if (!needsTiles) return [];

    return [{
        key: 'world_tileset',
        type: 'procedural_tileset',
        role: 'environment',
        coreGrid: '3x3',
        expandedGrid: '7x7',
        tileSize: 32,
        instructions: [
            'Generate a repeatable 3x3 core tile vocabulary in code or from the environment art.',
            'Expand into a 7x7 rule grid with corners, edges, center fills, hazards, and decorative variants.',
            'Use this for collision platforms, arena walls, floors, paths, rooms, or terrain whenever the game needs tile rhythm.',
        ],
    }];
}

export function compileDreamAssetBundle(generatedImages = null, assetPlan = null) {
    if (!generatedImages) return null;

    const imagePack = Array.isArray(generatedImages.assetPack) ? generatedImages.assetPack : [];
    const manifestAssets = Array.isArray(generatedImages.manifest?.assets) ? generatedImages.manifest.assets : [];
    const animations = assetPlan?.animations || generatedImages.animations || [];
    const audio = assetPlan?.audio || { sfx: [], music: [] };
    const tilesets = assetPlan?.tilesets || [];

    return {
        ...generatedImages,
        assetPlan,
        manifest: {
            version: 2,
            assets: manifestAssets,
            animations,
            audio,
            tilesets,
        },
        assetPack: [
            ...imagePack,
            ...animations.map((animation) => ({
                key: animation.key,
                type: 'animation',
                sourceKey: animation.sourceKey,
                role: animation.role,
                states: animation.states || [],
                implementation: animation.implementation,
            })),
            ...audio.sfx.map((sound) => ({ ...sound, type: 'sfx' })),
            ...audio.music.map((track) => ({ ...track, type: 'music' })),
            ...tilesets.map((tileset) => ({ ...tileset, type: 'tileset' })),
        ],
        animations,
        audio,
        tilesets,
    };
}
