const BASE_SCAFFOLD_LOCK = {
    preserve: [
        'Required state object names and shape.',
        'Required function names listed in the template contract.',
        'window.__GAMETOK_TEMPLATE_PROBE__ and all required probe methods.',
        'Pointer/touch input paths.',
        'Mobile safe-rect sizing and resize handling.',
        'Code-owned HUD, controls, collision geometry, hitboxes, and win/loss state.',
    ],
    customize: [
        'Theme copy, colors, labels, particle feel, and balance numbers.',
        'Entity visuals and world art through approved DreamAssets slots.',
        'Level layout, spawn pacing, difficulty, and feedback intensity.',
        'Optional helper functions if required names remain intact.',
    ],
    forbidden: [
        'Replacing the scaffold with a single static mockup.',
        'Removing probe APIs because they are not visible to the player.',
        'Using generated images for readable HUD text, buttons, sliders, or collision terrain.',
        'Adding external navigation, links, forms, popups, or remote asset URLs.',
    ],
};

const TEMPLATE_MANUALS = {
    'phaser-artillery': {
        purpose: 'Turn-based ballistic duel on destructible terrain.',
        implementationOrder: [
            'Start with the scaffold terrain, tank, projectile, and turn state intact.',
            'Theme tanks/background/projectile/explosion using DreamAssets roles.',
            'Tune wind, angle, power, gravity, explosion radius, and damage for the prompt.',
            'Keep trajectory preview live before firing and recompute it whenever angle/power/wind changes.',
            'Make impact resolution deform terrain, damage nearby tanks, show feedback, then switch turns.',
        ],
        qualityBar: [
            'The first shot should be possible within 5 seconds.',
            'Projectile arc preview must visibly change with both angle and power.',
            'Terrain deformation must change actual height/mask data, not just draw a flash.',
            'Enemy and player tanks must remain visible and readable under GameTok chrome.',
        ],
        commonMistakes: [
            'Large decorative UI hiding terrain or tanks.',
            'Using background art as the terrain collision source.',
            'Letting FIRE launch multiple shells before the previous one resolves.',
        ],
    },
    'canvas-arcade-shooter': {
        purpose: 'Immediate move-and-fire arcade combat with live projectiles and waves.',
        implementationOrder: [
            'Preserve player, enemy, projectile, pickup, score, wave, health, and reset state.',
            'Theme player/enemy/projectile/background visuals with DreamAssets roles.',
            'Keep movement and fire controls visible and touch-first.',
            'Spawn threats immediately and pace waves so the first 10 seconds prove combat.',
            'Make collisions mutate score, enemy state, health, particles, and wave progress.',
        ],
        qualityBar: [
            'Player movement must be visible on first touch.',
            'Fire must create live projectile entities, not decorative beams only.',
            'At least one enemy should be hittable quickly.',
            'Powerups can exist, but must not change template routing into artillery.',
        ],
        commonMistakes: [
            'Empty arena with no threat.',
            'Keyboard-only controls.',
            'Projectile visuals that never collide with enemies.',
        ],
    },
    'phaser-top-down-action': {
        purpose: 'Top-down action loop with movement, enemies, attacks, collisions, and score/combo feedback.',
        implementationOrder: [
            'Preserve entity arrays and update/draw loop from the scaffold.',
            'Create immediate enemies or hazards near but not on top of the player.',
            'Wire primary attack/gesture/button to live enemies or world objects.',
            'Use assets for actors/effects/background while keeping hitboxes code-defined.',
            'Make feedback change health, score, combo, wave, cooldowns, or pickups.',
        ],
        qualityBar: [
            'First 10 seconds must show movement, enemy threat, attack, hit feedback, and progress.',
            'Player should never spawn alone in a huge empty arena.',
            'Controls must fit below/inside the safe area.',
        ],
        commonMistakes: [
            'Decorative particles with no damage state.',
            'Top-down prompt accidentally becoming side-view platformer.',
            'Offscreen enemies or unreachable goals.',
        ],
    },
    'phaser-platformer': {
        purpose: 'Side-view gravity platforming with solid collisions, jump, hazards, collectibles, and goal.',
        implementationOrder: [
            'Preserve gravity, platform collision, player motion, and reset.',
            'Theme the player, hazards, collectibles, background, and goal.',
            'Place nearby platforms/hazards so jump and collision prove themselves immediately.',
            'Keep mobile left/right/jump controls large and visible.',
            'Make collectibles/hazards/goal mutate live score, health, or completion state.',
        ],
        qualityBar: [
            'Player must stand on solid ground on first frame.',
            'Jump must land back on platforms without falling through.',
            'Goal or collectible should be visible or directionally obvious.',
        ],
        commonMistakes: [
            'Drawn platforms without collision.',
            'Jump button under native app chrome.',
            'Camera framing that hides the player after movement.',
        ],
    },
    'canvas-runner': {
        purpose: 'Auto-forward runner with jump/slide/dodge, scrolling obstacles, pickups, distance, and fail/restart.',
        implementationOrder: [
            'Preserve auto-scroll, player motion, obstacle/pickup arrays, score/distance, and reset.',
            'Theme runner, obstacles, pickups, track, and background with assets.',
            'Spawn an obstacle and collectible early enough to prove dodge/score quickly.',
            'Keep jump/slide controls touch-first and outside chrome overlap.',
        ],
        qualityBar: [
            'Jump or slide must visibly change the runner state.',
            'Obstacles must collide and end/damage the run.',
            'Distance/score must advance continuously.',
        ],
        commonMistakes: [
            'Scrolling scenery with no collisions.',
            'A runner that waits too long before the first obstacle.',
        ],
    },
    'canvas-simulation': {
        purpose: 'Editable physics toy/puzzle with build mode, simulate mode, goal object, and target/failure checks.',
        implementationOrder: [
            'Preserve edit -> simulate -> result state machine.',
            'Keep goal object, target zone, bodies, gravity, collisions, and reset code-owned.',
            'Theme parts/goal/background using DreamAssets roles.',
            'Let the player place/modify at least one part before simulation starts.',
            'Compute win/loss from live body positions and velocities.',
        ],
        qualityBar: [
            'The game must not auto-run before the player can build.',
            'START must visibly switch mode and advance physics.',
            'RESET must return to editable state without reload.',
        ],
        commonMistakes: [
            'Fake physics animation with no body state.',
            'Target zone shown as art only with no goal check.',
            'Confusing editor controls hidden beneath large canvas content.',
        ],
    },
    'canvas-grid-puzzle': {
        purpose: 'Discrete board puzzle with selectable tiles, legal moves, scoring/goal progress, and reset.',
        implementationOrder: [
            'Preserve grid, selection, move/resolve functions, score/moves/goal state.',
            'Theme tile art and background only; board state remains data.',
            'Show a legal move or obvious first interaction on first frame.',
            'Make selection and moves visibly change the grid signature.',
        ],
        qualityBar: [
            'Tap/select must change visible selection state.',
            'Move/swap must mutate grid data.',
            'Score, moves, or goal progress must change after resolution.',
        ],
        commonMistakes: [
            'Decorative board with no legal move model.',
            'Text too small for mobile puzzle controls.',
        ],
    },
    'story-vignette': {
        purpose: 'Interactive story state machine with choices, flags/meters, consequences, and reachable endings.',
        implementationOrder: [
            'Preserve currentNode, choices, flags/meters, history, consequence, and ending state.',
            'Theme character/scene/prop visuals with assets.',
            'Show meaningful choices quickly; do not start as a static poster.',
            'Make each choice mutate flags/meters and alter later text or visuals.',
        ],
        qualityBar: [
            'At least two meaningful choices must be visible early.',
            'Later state must reflect previous decisions.',
            'One ending/chapter resolution must be reachable.',
        ],
        commonMistakes: [
            'Long unreadable paragraphs.',
            'Choices that all lead to the same state.',
            'Static story card with no state machine.',
        ],
    },
    'canvas-arcade': {
        purpose: 'Flexible 2D arcade fallback with one clear mechanic, live entities, input, feedback, scoring/progress, and reset.',
        implementationOrder: [
            'Define the primary verb before drawing: collect, dodge, tap, drag, match, defend, chase, or survive.',
            'Preserve player/entities/score/health/progress/gameOver state and expose it through the probe API.',
            'Make move(), primaryAction(), spawnThreat(), step(), and reset() call the same functions used by visible controls.',
            'Spawn at least one threat, goal, pickup, or objective early enough to prove the loop in 10 seconds.',
            'Keep HUD and controls code-rendered and theme only gameplay art through DreamAssets.',
        ],
        qualityBar: [
            'The first input must visibly change gameplay state.',
            'The primary action must mutate score, projectiles/actions, inventory, progress, or objective state.',
            'Threat/goal entities must be live arrays updated by step(), not just painted scenery.',
            'Reset must restore a fresh playable state without reload.',
        ],
        commonMistakes: [
            'A pretty toy with no objective, health, score, or fail/win path.',
            'A single button that only plays particles.',
            'Decorative threats that never collide or affect state.',
        ],
    },
};

export function getMakerTemplateManual(templateId) {
    const manual = TEMPLATE_MANUALS[templateId] || {
        purpose: 'General mobile arcade game with live input, state, feedback, and reset.',
        implementationOrder: [
            'Preserve the starter loop, input, draw, collision, score/health, and reset systems.',
            'Customize visuals, theme, pacing, and controls to match the prompt.',
            'Use assets for approved visuals only; keep HUD and gameplay data code-owned.',
        ],
        qualityBar: [
            'First frame shows player, goal/threat, controls, and state feedback.',
            'First input changes live gameplay state.',
            'Restart/reset works without reload.',
        ],
        commonMistakes: [
            'Static mockup.',
            'Hidden controls.',
            'Decorative sprites with no gameplay state.',
        ],
    };

    return {
        version: 1,
        templateId,
        source: 'gametok-native-template-manual',
        scaffoldLock: BASE_SCAFFOLD_LOCK,
        ...manual,
    };
}

export function formatMakerTemplateManual(manual = null) {
    if (!manual) return 'No template manual available.';
    const section = (title, items = []) => [
        `## ${title}`,
        ...(Array.isArray(items) && items.length ? items.map((item) => `- ${item}`) : ['- None specified.']),
    ].join('\n');

    return [
        `# ${manual.templateId} Manual`,
        '',
        `Purpose: ${manual.purpose}`,
        '',
        section('Implementation Order', manual.implementationOrder),
        '',
        section('Quality Bar', manual.qualityBar),
        '',
        section('Common Mistakes', manual.commonMistakes),
        '',
        section('Scaffold Must Preserve', manual.scaffoldLock?.preserve),
        '',
        section('Scaffold Safe Customization', manual.scaffoldLock?.customize),
        '',
        section('Scaffold Forbidden Changes', manual.scaffoldLock?.forbidden),
    ].join('\n');
}
