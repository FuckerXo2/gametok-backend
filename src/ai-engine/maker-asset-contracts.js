function normalize(value) {
    return String(value || '').toLowerCase();
}

function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function collectIntentText(qualityIntent = {}) {
    return [
        qualityIntent.title,
        qualityIntent.userIntent,
        qualityIntent.playableExperience?.coreLoop,
        qualityIntent.playableExperience?.primaryMechanic,
        qualityIntent.playableExperience?.firstTenSeconds,
        qualityIntent.technicalRequirements?.genre,
        qualityIntent.technicalRequirements?.perspective,
        qualityIntent.playerActions,
        qualityIntent.entityRules,
        qualityIntent.mustExist,
    ].flat(Infinity).map(normalize).join(' ');
}

function hasAny(text, words) {
    return words.some((word) => text.includes(word));
}

function artStyleText(qualityIntent = {}) {
    const artDirection = qualityIntent.artDirection || {};
    const styleParts = [
        artDirection.visualStyle,
        artDirection.palette,
        artDirection.mood,
        artDirection.camera,
        artDirection.spriteStyle,
    ].filter(Boolean);
    return styleParts.length > 0 ? `Shared art direction: ${styleParts.join(', ')}.` : '';
}

function artilleryTheme(qualityIntent = {}) {
    const text = collectIntentText(qualityIntent);
    if (hasAny(text, ['moon', 'lunar', 'space', 'alien'])) {
        return {
            setting: 'alien moon battlefield with cratered hills, distant stars, and crisp tactical readability',
            player: 'blue compact lunar rover artillery tank with visible cannon, chunky treads, and bright readable silhouette',
            enemy: 'red rival lunar rover artillery tank with visible cannon, chunky treads, and distinct enemy silhouette',
            shell: 'small glowing artillery shell with dark metal body and tiny exhaust spark',
            explosion: 'bright orange-yellow comic blast cloud with debris sparks, transparent edges',
        };
    }
    if (hasAny(text, ['desert', 'sand', 'dune'])) {
        return {
            setting: 'sunset desert battlefield with rolling dunes and tactical foreground contrast',
            player: 'blue desert artillery tank with visible cannon, sand-worn armor, and readable side silhouette',
            enemy: 'red desert artillery tank with visible cannon, sand-worn armor, and readable opposing silhouette',
            shell: 'small black artillery shell with orange tracer glow',
            explosion: 'dusty orange impact explosion with smoke puffs and debris sparks, transparent edges',
        };
    }
    if (hasAny(text, ['snow', 'ice', 'arctic'])) {
        return {
            setting: 'icy mountain artillery range with snowy hills, pale sky, and strong playfield contrast',
            player: 'blue arctic artillery tank with visible cannon, snow-dusted armor, and clear side silhouette',
            enemy: 'red arctic artillery tank with visible cannon, snow-dusted armor, and clear opposing silhouette',
            shell: 'small dark shell with blue-white trail sparkle',
            explosion: 'cold white-orange impact burst with snow spray and debris, transparent edges',
        };
    }
    return {
        setting: 'bright hilly artillery battlefield with layered sky, distant hills, and clean tactical readability',
        player: 'blue side-view artillery tank with visible cannon, readable treads, compact body, and strong silhouette',
        enemy: 'red side-view artillery tank with visible cannon, readable treads, compact body, and distinct enemy silhouette',
        shell: 'small dark artillery shell with subtle orange tracer glow',
        explosion: 'juicy orange-yellow impact explosion with smoke puffs and debris sparks, transparent edges',
    };
}

function artilleryAssetContract(qualityIntent = {}) {
    const theme = artilleryTheme(qualityIntent);
    const style = artStyleText(qualityIntent);
    return {
        version: 1,
        templateId: 'phaser-artillery',
        sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
        hardRules: [
            'HUD, labels, meters, sliders, fire buttons, wind indicators, and health bars are code-rendered only.',
            'Terrain collision and destructible ground remain code-defined heightfield data.',
            'Background images are scenery layers only and never define hitboxes.',
            'Tank sprites replace drawTank visual art only; tank coordinates, health, collision, and turn state remain code-owned.',
            'If a slot is missing or fails, the starter must keep intentional code-rendered fallback art.',
        ],
        slots: [
            {
                id: 'player_tank',
                required: true,
                assetType: 'sprite',
                role: 'player',
                category: 'player',
                size: 128,
                transparent: true,
                description: `${theme.player}. Isolated single subject centered on transparent background. No text, no UI, no scenery. ${style}`.trim(),
                consumedBy: 'resolveThemeAssets() -> state.assets.player -> drawTank(tank, 0)',
                fallback: 'code-rendered blue tank body/cannon/treads',
            },
            {
                id: 'enemy_tank',
                required: true,
                assetType: 'sprite',
                role: 'enemy',
                category: 'enemy',
                size: 128,
                transparent: true,
                description: `${theme.enemy}. Isolated single subject centered on transparent background. No text, no UI, no scenery. ${style}`.trim(),
                consumedBy: 'resolveThemeAssets() -> state.assets.enemy -> drawTank(tank, 1)',
                fallback: 'code-rendered red tank body/cannon/treads',
            },
            {
                id: 'battlefield_background',
                required: false,
                assetType: 'background',
                role: 'background',
                category: 'environment',
                width: 768,
                height: 1344,
                transparent: false,
                description: `${theme.setting}. Portrait mobile background, 768x1344, leave bottom third visually simple because code terrain is drawn over it. No text, no HUD, no tanks, no projectiles, no UI. ${style}`.trim(),
                consumedBy: 'resolveThemeAssets() -> state.assets.background -> drawBackground()',
                fallback: 'code-rendered sky gradient and clouds',
            },
            {
                id: 'artillery_shell',
                required: false,
                assetType: 'sprite',
                role: 'projectile',
                category: 'projectile',
                size: 64,
                transparent: true,
                description: `${theme.shell}. Isolated tiny projectile centered on transparent background. No text, no UI, no scenery. ${style}`.trim(),
                consumedBy: 'resolveThemeAssets() -> state.assets.projectile -> render projectile',
                fallback: 'code-rendered dark shell circle',
            },
            {
                id: 'impact_explosion',
                required: false,
                assetType: 'sprite',
                role: 'effect',
                category: 'effect',
                size: 96,
                transparent: true,
                description: `${theme.explosion}. Isolated impact effect centered on transparent background. No text, no UI, no scenery. ${style}`.trim(),
                consumedBy: 'resolveThemeAssets() -> state.assets.explosion -> drawExplosion() optional overlay',
                fallback: 'code-rendered radial explosion gradient',
            },
        ],
    };
}

export function buildMakerAssetContract(templateContract = null, qualityIntent = {}) {
    const templateId = templateContract?.templateId || null;
    if (templateId === 'phaser-artillery') {
        return artilleryAssetContract(qualityIntent);
    }
    if (templateId === 'phaser-top-down-action') {
        return {
            version: 1,
            templateId,
            sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
            hardRules: [
                'HUD, score, health, combo, wave labels, joysticks, and action buttons are code-rendered only.',
                'Generated images replace actors, enemies, pickups, props, attack effects, and scenery.',
                'Collision circles/boxes, enemy AI, attack ranges, and spawn rules remain code-defined.',
            ],
            slots: [
                {
                    id: 'player_actor',
                    required: true,
                    assetType: 'sprite',
                    role: 'player',
                    category: 'player',
                    size: 128,
                    transparent: true,
                    description: `Main playable character for a top-down action game. Isolated single subject, readable from mobile scale, centered on transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'player entity renderer via DreamAssets role player',
                    fallback: 'code-rendered player avatar',
                },
                {
                    id: 'primary_enemy',
                    required: true,
                    assetType: 'sprite',
                    role: 'enemy',
                    category: 'enemy',
                    size: 128,
                    transparent: true,
                    description: `Primary enemy or hazard for a top-down action game. Isolated single subject, readable silhouette, centered on transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'enemy entity renderer via DreamAssets role enemy',
                    fallback: 'code-rendered enemy shape',
                },
                {
                    id: 'arena_background',
                    required: false,
                    assetType: 'background',
                    role: 'background',
                    category: 'environment',
                    width: 768,
                    height: 1344,
                    transparent: false,
                    description: `Portrait mobile top-down arena or playfield background. Leave center readable for gameplay. No text, no HUD, no controls, no characters. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'background layer via DreamAssets role background',
                    fallback: 'code-rendered arena floor',
                },
                {
                    id: 'primary_attack_effect',
                    required: false,
                    assetType: 'sprite',
                    role: 'effect',
                    category: 'effect',
                    size: 96,
                    transparent: true,
                    description: `Primary attack or impact effect for the game. Isolated effect burst, transparent background, no text, no UI. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'attack/impact particles via DreamAssets role effect',
                    fallback: 'code-rendered particles and hit flashes',
                },
            ],
        };
    }
    if (templateId === 'phaser-platformer') {
        return {
            version: 1,
            templateId,
            sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
            hardRules: [
                'HUD, score, lives, buttons, and prompts are code-rendered only.',
                'Platforms and collision geometry are code-defined even when decorated by images.',
                'Generated images replace character, hazards, collectibles, background, and decorative props.',
            ],
            slots: [
                {
                    id: 'platformer_player',
                    required: true,
                    assetType: 'sprite',
                    role: 'player',
                    category: 'player',
                    size: 128,
                    transparent: true,
                    description: `Side-view platformer player character. Isolated full-body subject, readable silhouette, centered on transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'player renderer via DreamAssets role player',
                    fallback: 'code-rendered player body',
                },
                {
                    id: 'platformer_hazard',
                    required: false,
                    assetType: 'sprite',
                    role: 'enemy',
                    category: 'enemy',
                    size: 96,
                    transparent: true,
                    description: `Side-view platformer enemy or hazard. Isolated single subject, transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'hazard/enemy renderer via DreamAssets role enemy',
                    fallback: 'code-rendered hazard',
                },
                {
                    id: 'platformer_world_background',
                    required: false,
                    assetType: 'background',
                    role: 'background',
                    category: 'environment',
                    width: 768,
                    height: 1344,
                    transparent: false,
                    description: `Portrait mobile side-view platformer background with depth layers. No text, no HUD, no controls, no characters. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'background layer via DreamAssets role background',
                    fallback: 'code-rendered parallax background',
                },
            ],
        };
    }
    if (templateId === 'canvas-simulation') {
        return {
            version: 1,
            templateId,
            sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
            hardRules: [
                'Editor controls, start/reset buttons, labels, and mode indicators are code-rendered only.',
                'Physics bodies, joints, collision bounds, target zones, and goal checks are code-defined.',
                'Generated images decorate bodies, goals, parts, and backgrounds only.',
            ],
            slots: [
                {
                    id: 'goal_object',
                    required: true,
                    assetType: 'sprite',
                    role: 'player',
                    category: 'player',
                    size: 128,
                    transparent: true,
                    description: `Main physics goal object or controlled object. Isolated single object, centered on transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'goal object renderer via DreamAssets role player',
                    fallback: 'code-rendered goal object',
                },
                {
                    id: 'build_part',
                    required: false,
                    assetType: 'sprite',
                    role: 'prop',
                    category: 'prop',
                    size: 96,
                    transparent: true,
                    description: `Representative physics construction part or obstacle. Isolated object, transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'part renderer via DreamAssets role prop',
                    fallback: 'code-rendered blocks and parts',
                },
                {
                    id: 'simulation_background',
                    required: false,
                    assetType: 'background',
                    role: 'background',
                    category: 'environment',
                    width: 768,
                    height: 1344,
                    transparent: false,
                    description: `Portrait mobile simulation workspace background. Keep it subtle and readable. No text, no HUD, no controls. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'background layer via DreamAssets role background',
                    fallback: 'code-rendered workspace background',
                },
            ],
        };
    }
    if (templateId === 'canvas-grid-puzzle') {
        return {
            version: 1,
            templateId,
            sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
            hardRules: [
                'HUD, score, move counters, goal labels, and directional controls are code-rendered only.',
                'Grid cells, legal moves, match checks, score, and goal progress are code-defined.',
                'Generated images decorate live tile cells and background only.',
            ],
            slots: [
                {
                    id: 'grid_tile_primary',
                    required: false,
                    assetType: 'sprite',
                    role: 'item',
                    category: 'item',
                    size: 96,
                    transparent: true,
                    description: `Primary puzzle tile icon or game piece. Isolated centered object, transparent background, no text, no UI, no board. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'tile renderer via DreamAssets role item',
                    fallback: 'code-rendered colored tile',
                },
                {
                    id: 'grid_tile_special',
                    required: false,
                    assetType: 'sprite',
                    role: 'effect',
                    category: 'effect',
                    size: 96,
                    transparent: true,
                    description: `Special matched tile, power-up, or clear effect for a puzzle grid. Isolated centered object/effect, transparent background, no text, no UI. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'special tile renderer via DreamAssets role effect',
                    fallback: 'code-rendered special tile highlight',
                },
                {
                    id: 'grid_world_background',
                    required: false,
                    assetType: 'background',
                    role: 'background',
                    category: 'environment',
                    width: 768,
                    height: 1344,
                    transparent: false,
                    description: `Portrait mobile puzzle background with readable central play area. No text, no HUD, no controls, no board. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'background layer via DreamAssets role background',
                    fallback: 'code-rendered puzzle background',
                },
            ],
        };
    }
    if (templateId === 'story-vignette') {
        return {
            version: 1,
            templateId,
            sourceOfTruth: 'template asset slots consumed by DreamAssets at runtime',
            hardRules: [
                'Choice buttons, dialogue text, labels, meters, and HUD are code-rendered only.',
                'Story graph, flags, meters, consequences, and ending state are code-defined.',
                'Generated images decorate character, scene, prop, and mood only.',
            ],
            slots: [
                {
                    id: 'story_hero',
                    required: false,
                    assetType: 'sprite',
                    role: 'player',
                    category: 'player',
                    size: 128,
                    transparent: true,
                    description: `Main story character or avatar. Isolated single subject, emotionally readable, centered on transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'story scene renderer via DreamAssets role player',
                    fallback: 'code-rendered story character',
                },
                {
                    id: 'story_scene_background',
                    required: false,
                    assetType: 'background',
                    role: 'background',
                    category: 'environment',
                    width: 768,
                    height: 1344,
                    transparent: false,
                    description: `Portrait mobile story scene background with atmospheric depth and clear subject area. No text, no HUD, no controls. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'story scene background via DreamAssets role background',
                    fallback: 'code-rendered story background',
                },
                {
                    id: 'story_symbol',
                    required: false,
                    assetType: 'sprite',
                    role: 'prop',
                    category: 'prop',
                    size: 96,
                    transparent: true,
                    description: `Important story object, relic, clue, or symbolic prop. Isolated object, transparent background, no text, no UI, no scenery. ${artStyleText(qualityIntent)}`.trim(),
                    consumedBy: 'story scene symbol via DreamAssets role prop',
                    fallback: 'code-rendered symbolic prop',
                },
            ],
        };
    }
    return {
        version: 1,
        templateId,
        sourceOfTruth: 'general DreamAssets runtime roles',
        hardRules: [
            'HUD, text, controls, meters, and readable UI are code-rendered only.',
            'Generated images are gameplay/world visuals only.',
            'Gameplay geometry and hitboxes remain code-defined.',
        ],
        slots: [],
    };
}

function hasMatchingRequest(requests, slot) {
    const slotRoles = new Set([slot.id, slot.role, slot.category].filter(Boolean).map(normalize));
    return requests.some((request) => {
        const values = [request.id, request.role, request.category].filter(Boolean).map(normalize);
        return values.some((value) => slotRoles.has(value));
    });
}

export function mergeMakerAssetContractIntoPlan(assetPlan = null, assetContract = null) {
    const plan = assetPlan || {
        version: 1,
        qualityIntent: {},
        artDirection: {},
        imageRequests: [],
        animations: [],
        audio: { sfx: [], music: [] },
        tilesets: [],
    };
    const requests = Array.isArray(plan.imageRequests) ? [...plan.imageRequests] : [];
    const slots = asArray(assetContract?.slots);
    for (const slot of slots) {
        if (!slot?.id || !slot?.description) continue;
        if (!slot.required && hasMatchingRequest(requests, slot)) continue;
        if (slot.required && hasMatchingRequest(requests, slot)) continue;
        requests.push({
            id: slot.id,
            assetType: slot.assetType || 'sprite',
            description: slot.description,
            category: slot.category || slot.role || 'prop',
            role: slot.role || slot.category || 'prop',
            gameplayRole: slot.consumedBy || '',
            size: slot.size || null,
            width: slot.width || undefined,
            height: slot.height || undefined,
            transparent: slot.transparent !== false,
            makerSlot: true,
            required: Boolean(slot.required),
        });
    }
    return {
        ...plan,
        imageRequests: requests,
        makerAssetContract: assetContract || null,
    };
}

export function summarizeMakerAssetContract(assetContract = null) {
    if (!assetContract) return null;
    return {
        version: assetContract.version || 1,
        templateId: assetContract.templateId || null,
        slots: asArray(assetContract.slots).map((slot) => ({
            id: slot.id,
            role: slot.role,
            category: slot.category,
            assetType: slot.assetType,
            required: Boolean(slot.required),
            consumedBy: slot.consumedBy,
            fallback: slot.fallback,
        })),
        hardRules: asArray(assetContract.hardRules),
    };
}
