function normalizeText(value) {
    return String(value || '').toLowerCase();
}

function collectIntentText(qualityIntent = {}, prompt = '') {
    return [
        prompt,
        qualityIntent.title,
        qualityIntent.userIntent,
        qualityIntent.playableExperience?.coreLoop,
        qualityIntent.playableExperience?.primaryMechanic,
        qualityIntent.playableExperience?.firstTenSeconds,
        qualityIntent.technicalRequirements?.dimension,
        qualityIntent.technicalRequirements?.perspective,
        qualityIntent.technicalRequirements?.genre,
        qualityIntent.playerActions,
        qualityIntent.entityRules,
        qualityIntent.mustExist,
    ].flat(Infinity).map(normalizeText).join(' ');
}

function hasAny(text, words) {
    return words.some((word) => text.includes(word));
}

const COMMON_CONSTRAINTS = {
    viewport: {
        targetWidth: 390,
        targetHeight: 844,
        chromeSafeTop: 112,
        chromeSafeBottom: 48,
        rule: 'Compute safe bounds from innerWidth/innerHeight and keep gameplay, HUD, and controls visible inside them.',
    },
    files: [
        'index.html',
        'src/styles.css',
        'src/game.js',
    ],
    hardRules: [
        'No external navigation, popups, forms, or remote dependencies.',
        'HUD, labels, meters, buttons, and text are code-rendered.',
        'Images are used for world art, sprites, props, items, and backgrounds only.',
        'The first frame must show the game world, primary actor, key goal/threat, and usable controls or affordances.',
        'The first 10 seconds must prove the core mechanic with input, simulation, feedback, and score/win/loss progress.',
        'All mutable game state resets cleanly on restart or round transition.',
    ],
    dreamAssets: [
        'Use DreamAssets.firstByRole(role), DreamAssets.getImage(key), or DREAM_ASSET_PACK to load generated gameplay visuals.',
        'Call DreamAssets.safeRect(width, height) or implement the same safe-rect behavior for layout.',
        'Never paste generated data URLs into source files; reference runtime keys.',
    ],
};

const TEMPLATE_CONTRACTS = {
    'phaser-artillery': {
        templateId: 'phaser-artillery',
        engine: 'phaser-or-canvas-2d',
        archetype: 'turn_based_artillery',
        recommendedLibrary: 'Phaser when available, otherwise deterministic Canvas 2D.',
        architecture: [
            'GameState owns turn, tanks, terrain, projectile, wind, health, and round status.',
            'Terrain is a sampled heightfield or polygon mask, not an AI image hitbox.',
            'Projectile physics uses angle, power, wind, gravity, collision sampling, and explosion radius.',
            'HUD and controls are normal DOM or canvas overlay elements tied to live state.',
        ],
        requiredState: [
            'currentTurn',
            'wind',
            'angle',
            'power',
            'tanks[].health',
            'tanks[].x',
            'tanks[].y',
            'terrainHeights or terrainMask',
            'projectile',
            'winner',
        ],
        requiredFunctions: [
            'generateTerrain',
            'sampleTerrainY',
            'computeTrajectoryPoints',
            'trajectorySignature',
            'drawTrajectoryPreview',
            'fireProjectile',
            'updateProjectile',
            'applyExplosionDamage',
            'deformTerrain',
            'endTurn',
            'resetRound',
        ],
        requiredProbeApi: [
            'window.__GAMETOK_TEMPLATE_PROBE__.snapshot',
            'window.__GAMETOK_TEMPLATE_PROBE__.setAim',
            'window.__GAMETOK_TEMPLATE_PROBE__.fire',
            'window.__GAMETOK_TEMPLATE_PROBE__.probeDeformTerrain',
            'window.__GAMETOK_TEMPLATE_PROBE__.reset',
        ],
        controls: [
            'large angle control',
            'large power control',
            'fire button',
            'visible wind indicator',
        ],
        firstFrame: [
            'both tanks visible on terrain',
            'wind indicator visible',
            'angle and power controls visible',
            'projectile arc preview visible before firing',
        ],
        acceptanceChecks: [
            'Changing angle or power visibly changes the arc preview.',
            'Firing launches one shell and disables repeat fire until impact or miss.',
            'Impact creates explosion feedback, damages tanks within radius, and deforms terrain.',
            'Turns alternate after shell resolution.',
            'A round ends when one tank reaches zero health.',
        ],
        antiPatterns: [
            'Do not make a static tank picture with fake controls.',
            'Do not use AI-generated terrain as collision geometry.',
            'Do not hide the enemy tank or controls under app chrome.',
            'Do not claim destructible terrain unless the terrain data actually changes.',
        ],
    },
    'phaser-top-down-action': {
        templateId: 'phaser-top-down-action',
        engine: 'phaser-or-canvas-2d',
        archetype: 'top_down_action',
        recommendedLibrary: 'Phaser when available, otherwise Canvas 2D with explicit entity arrays.',
        architecture: [
            'Entity arrays own player, enemies, projectiles, pickups, hazards, and particles.',
            'Main loop handles input, movement, collisions, spawning, feedback, score, and wave pacing.',
            'Camera-safe HUD uses code-rendered meters and labels.',
        ],
        requiredState: [
            'player',
            'enemies[]',
            'projectiles[] or attacks[]',
            'particles[]',
            'score',
            'combo or wave',
            'cooldowns',
            'gameOver',
        ],
        requiredFunctions: [
            'handleInput',
            'updatePlayer',
            'spawnEnemies',
            'updateEnemies',
            'resolveCollisions',
            'performPrimaryAttack',
            'applyHitFeedback',
            'drawHud',
            'resetGame',
        ],
        requiredProbeApi: [
            'window.__GAMETOK_TEMPLATE_PROBE__.snapshot',
            'window.__GAMETOK_TEMPLATE_PROBE__.move',
            'window.__GAMETOK_TEMPLATE_PROBE__.attack',
            'window.__GAMETOK_TEMPLATE_PROBE__.spawnEnemyNearPlayer',
            'window.__GAMETOK_TEMPLATE_PROBE__.reset',
        ],
        controls: [
            'virtual joystick or drag-to-move',
            'primary action gesture/button',
            'secondary action when relevant',
        ],
        firstFrame: [
            'player visible',
            'at least one enemy or target visible within 10 seconds',
            'primary action affordance visible',
            'score/health feedback visible',
        ],
        acceptanceChecks: [
            'Player can move immediately.',
            'Enemies pursue, patrol, or threaten the player.',
            'Primary action affects enemies or world objects.',
            'Hit, score, health, or combo feedback changes live.',
        ],
        antiPatterns: [
            'Do not leave the player alone in an empty arena.',
            'Do not use only decorative particles as gameplay.',
            'Do not make controls too small for mobile.',
        ],
    },
    'phaser-platformer': {
        templateId: 'phaser-platformer',
        engine: 'phaser-or-canvas-2d',
        archetype: 'platformer',
        recommendedLibrary: 'Phaser Arcade Physics or deterministic Canvas physics.',
        architecture: [
            'Tile or platform collision geometry is code-defined.',
            'Player movement uses gravity, jump buffering or coyote time, hazards, collectibles, and goal state.',
        ],
        requiredState: [
            'player',
            'platforms[]',
            'hazards[]',
            'collectibles[]',
            'camera',
            'score',
            'lives or health',
            'goal',
        ],
        requiredFunctions: [
            'buildLevel',
            'handleInput',
            'updatePlayerPhysics',
            'resolvePlatformCollisions',
            'collectItem',
            'hitHazard',
            'reachGoal',
            'resetLevel',
        ],
        controls: [
            'left/right movement',
            'jump button',
            'optional action button',
        ],
        firstFrame: [
            'player on solid ground',
            'nearest platform or hazard visible',
            'goal direction or collectible visible',
            'mobile movement and jump controls visible',
        ],
        acceptanceChecks: [
            'Jumping and landing are physically readable.',
            'Player cannot fall through platforms.',
            'Collectibles, hazards, or goal change state.',
        ],
        antiPatterns: [
            'Do not draw platforms without collision.',
            'Do not place controls over the player or HUD.',
        ],
    },
    'canvas-simulation': {
        templateId: 'canvas-simulation',
        engine: 'canvas-2d',
        archetype: 'physics_simulation',
        recommendedLibrary: 'Canvas 2D with deterministic custom physics, or Matter.js only if already embedded.',
        architecture: [
            'Simulation state owns bodies, joints, forces, collisions, goal checks, edit/run mode, and reset.',
            'Editor controls are DOM/canvas controls, not image UI.',
        ],
        requiredState: [
            'mode',
            'bodies[]',
            'constraints[]',
            'gravity',
            'selectedTool',
            'goalObject',
            'targetZone',
            'running',
            'result',
        ],
        requiredFunctions: [
            'addBody',
            'startSimulation',
            'stepPhysics',
            'resolveCollisions',
            'checkGoal',
            'resetSimulation',
            'drawEditor',
            'drawSimulation',
        ],
        requiredProbeApi: [
            'window.__GAMETOK_TEMPLATE_PROBE__.snapshot',
            'window.__GAMETOK_TEMPLATE_PROBE__.addBody',
            'window.__GAMETOK_TEMPLATE_PROBE__.start',
            'window.__GAMETOK_TEMPLATE_PROBE__.step',
            'window.__GAMETOK_TEMPLATE_PROBE__.reset',
        ],
        controls: [
            'tool or part selector',
            'start/simulate button',
            'reset/edit button',
            'drag placement',
        ],
        firstFrame: [
            'parts or controls visible',
            'goal object visible',
            'target zone visible',
            'start simulation affordance visible',
        ],
        acceptanceChecks: [
            'User can place or modify something.',
            'Start runs visible physics.',
            'Goal success/failure is computed from live simulation.',
        ],
        antiPatterns: [
            'Do not animate fake physics without collision state.',
            'Do not auto-run before the user can interact if the prompt asks for building.',
        ],
    },
    'story-vignette': {
        templateId: 'story-vignette',
        engine: 'dom-canvas-hybrid',
        archetype: 'interactive_story',
        recommendedLibrary: 'DOM for choices, Canvas for scene and feedback.',
        architecture: [
            'Story state owns current node, flags, meters, choices, consequences, and ending.',
            'Visual scene reflects state changes after each choice.',
        ],
        requiredState: [
            'currentNode',
            'flags',
            'meters',
            'choices[]',
            'history[]',
            'ending',
        ],
        requiredFunctions: [
            'renderScene',
            'renderChoices',
            'chooseOption',
            'applyConsequence',
            'unlockNodes',
            'renderHud',
            'restartStory',
        ],
        controls: [
            'large choice buttons',
            'tap or drag exploration if needed',
        ],
        firstFrame: [
            'main character or world visible',
            'clear objective or tension visible',
            'at least two meaningful choices visible within 10 seconds',
        ],
        acceptanceChecks: [
            'Choices change flags or meters.',
            'Later text or visuals reflect earlier choices.',
            'At least one ending or chapter resolution is reachable.',
        ],
        antiPatterns: [
            'Do not make a static story card with no state.',
            'Do not use tiny unreadable paragraphs on mobile.',
        ],
    },
    'three-first-person': {
        templateId: 'three-first-person',
        engine: 'threejs',
        archetype: 'first_person_3d',
        recommendedLibrary: 'Three.js.',
        architecture: [
            'Scene owns camera, player body, world geometry, interactables, collisions, and mobile look/move controls.',
            'Use PerspectiveCamera and visible depth cues.',
        ],
        requiredState: [
            'scene',
            'camera',
            'renderer',
            'player',
            'velocity',
            'lookState',
            'interactables[]',
            'gameState',
        ],
        requiredFunctions: [
            'initThreeScene',
            'buildWorld',
            'handleLookInput',
            'handleMoveInput',
            'updatePlayer',
            'checkInteractions',
            'renderHud',
            'animate',
        ],
        controls: [
            'left move joystick or drag zone',
            'right look drag zone',
            'action button when relevant',
        ],
        firstFrame: [
            'PerspectiveCamera active',
            '3D world geometry visible',
            'mobile look and movement affordances visible',
            'objective or interactable visible',
        ],
        acceptanceChecks: [
            'Camera moves or rotates from input.',
            'Player cannot see only a flat/blank screen.',
            'At least one 3D interaction or goal changes state.',
        ],
        antiPatterns: [
            'Do not fake first person with a flat top-down canvas.',
            'Do not create a Three.js scene inside a tiny card.',
        ],
    },
    'canvas-arcade': {
        templateId: 'canvas-arcade',
        engine: 'canvas-2d',
        archetype: 'arcade',
        recommendedLibrary: 'Canvas 2D.',
        architecture: [
            'Single game loop owns state, input, entities, collisions, feedback, scoring, and reset.',
        ],
        requiredState: [
            'player',
            'entities[]',
            'score',
            'health or lives',
            'timer or level',
            'gameOver',
        ],
        requiredFunctions: [
            'initGame',
            'handleInput',
            'update',
            'resolveCollisions',
            'drawWorld',
            'drawHud',
            'resetGame',
        ],
        controls: [
            'mobile-safe primary controls',
        ],
        firstFrame: [
            'player visible',
            'goal/threat visible',
            'controls visible',
            'score or state feedback visible',
        ],
        acceptanceChecks: [
            'Input changes player state.',
            'Collisions or goals change score/health/progress.',
            'Game can restart without reload.',
        ],
        antiPatterns: [
            'Do not output a static mockup.',
            'Do not rely on hidden keyboard-only controls.',
        ],
    },
};

export function selectMakerTemplateContract(qualityIntent = {}, prompt = '') {
    const text = collectIntentText(qualityIntent, prompt);
    const tech = qualityIntent.technicalRequirements || {};
    let templateId = 'canvas-arcade';

    if (
        (normalizeText(tech.dimension).includes('3d') && normalizeText(tech.perspective).includes('first'))
        || hasAny(text, ['first person', 'fps', 'walking simulator'])
    ) {
        templateId = 'three-first-person';
    } else if (hasAny(text, ['artillery', 'tank', 'trajectory', 'wind', 'angle', 'power', 'shell', 'cannon'])) {
        templateId = 'phaser-artillery';
    } else if (hasAny(text, ['platformer', 'platform', 'jump', 'side scroller', 'side-scroller'])) {
        templateId = 'phaser-platformer';
    } else if (hasAny(text, ['drag block', 'contraption', 'sandbox', 'physics block', 'build zone', 'simulate physics', 'construction'])) {
        templateId = 'canvas-simulation';
    } else if (hasAny(text, ['choice', 'dialogue', 'dialog', 'narrative', 'story node', 'reputation', 'branching'])) {
        templateId = 'story-vignette';
    } else if (
        normalizeText(tech.perspective).includes('top')
        || hasAny(text, ['top down', 'top-down', 'survive', 'wave', 'slime', 'shooter', 'rogue-lite', 'dash'])
    ) {
        templateId = 'phaser-top-down-action';
    }

    const selected = TEMPLATE_CONTRACTS[templateId] || TEMPLATE_CONTRACTS['canvas-arcade'];
    return {
        version: 1,
        source: 'gametok-native-template-contract',
        common: COMMON_CONSTRAINTS,
        ...selected,
    };
}

export function summarizeMakerTemplateContract(contract = null) {
    if (!contract) return null;
    return {
        templateId: contract.templateId,
        engine: contract.engine,
        archetype: contract.archetype,
        requiredState: contract.requiredState || [],
        requiredFunctions: contract.requiredFunctions || [],
        requiredProbeApi: contract.requiredProbeApi || [],
        controls: contract.controls || [],
        firstFrame: contract.firstFrame || [],
        acceptanceChecks: contract.acceptanceChecks || [],
        antiPatterns: contract.antiPatterns || [],
    };
}
