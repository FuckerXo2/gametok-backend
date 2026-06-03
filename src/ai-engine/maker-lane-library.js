/**
 * Canonical maker lanes: classifier → engine/scaffold → foundation hints → golden audits.
 * Agents pick a lane at generation start; foundation architect fills in game-specific detail.
 */

export const MAKER_LANE_IDS = [
    'endless_lane_dodge',
    'endless_runner',
    'side_platformer',
    'top_down_action',
    'grid_tile_puzzle',
    'rpg_turn_battle',
    'projectile_action',
    'mobile_arcade',
];

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function includesAny(text = '', keywords = []) {
    const hay = String(text || '').toLowerCase();
    return keywords.some((kw) => hay.includes(String(kw).toLowerCase()));
}

function collectPromptText(prompt = '', qualityIntent = {}) {
    const parts = [
        prompt,
        qualityIntent?.title,
        qualityIntent?.userIntent,
        qualityIntent?.playableExperience?.coreLoop,
        qualityIntent?.playableExperience?.primaryMechanic,
        qualityIntent?.technicalRequirements?.perspective,
        qualityIntent?.technicalRequirements?.dimension,
        ...(asArray(qualityIntent?.mustExist)),
        ...(asArray(qualityIntent?.keywords)),
    ];
    const va = qualityIntent?.visualAssets || {};
    for (const bucket of ['player', 'enemies', 'items', 'backgrounds', 'props', 'obstacles']) {
        for (const entry of asArray(va[bucket])) {
            if (entry?.description) parts.push(entry.description);
        }
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
}

/** @type {Record<string, object>} */
export const MAKER_LANE_LIBRARY = {
    endless_lane_dodge: {
        laneId: 'endless_lane_dodge',
        title: 'Endless lane dodge',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'top_down',
        keywords: [
            'highway', 'lane', 'lanes', 'swipe', 'dodge', 'traffic', 'fuel', 'gas',
            'endless drive', 'road', 'overtake',
        ],
        foundationLane: 'endless_lane_dodge',
        physicsProfile: 'top_down_lane_scroll',
        inputModel: ['swipe_left', 'swipe_right', 'touch'],
        requiredStateHints: ['score', 'gameOver', 'lane', 'fuel', 'distance'],
        requiredFunctionHints: ['stepGame', 'resetGame', 'renderAll'],
        probeHints: [
            { name: 'snapshot', description: 'Serializable lane/fuel/distance state' },
            { name: 'step', description: 'Advance scroll simulation' },
            { name: 'reset', description: 'Reset run' },
            { name: 'switchLane', description: 'Move player between discrete lanes' },
        ],
        acceptanceChecks: [
            'Player can switch lanes via swipe or tap within 2 seconds of boot',
            'At least one obstacle or traffic hazard spawns and moves toward the player',
            'Fuel or distance pressure is visible on HUD and changes during play',
            'Collision or fuel empty triggers game over or restart flow',
            'Generated background renders full-bleed on frame 1',
        ],
        antiPatterns: [
            'Do not use cooking/toybox state (cauldronSlots, pantry, customers)',
            'Do not implement lane movement as free analog steering unless prompt demands it',
            'Do not bake HUD text into generated images',
        ],
        implementationNotes: [
            'Discrete lanes (typically 3); player x snaps to lane centers',
            'Scroll world downward or upward; spawn traffic and gas pickups from asset pack',
            'Use getAssetImage for player, enemy variants, gas items, bg_highway/background',
        ],
        assetSlotBlueprint: [
            { id: 'player', role: 'player', required: true, size: 128 },
            { id: 'enemy_sedan', role: 'enemy', required: true, size: 128 },
            { id: 'gas_small', role: 'item', required: true, size: 64 },
            { id: 'bg_highway', role: 'background', assetType: 'background', required: true, width: 768, height: 1344 },
        ],
        requiresTileset: false,
        golden: {
            key: 'highway',
            prompt: 'Make a fun top-down highway driving game where I swipe between lanes to dodge cars and try to go as far as I can. Collect gas so I don\'t run out.',
            logMarkers: [
                { id: 'lane_selected', pattern: /libraryLane=endless_lane_dodge/i, label: 'Lane library: endless_lane_dodge' },
                { id: 'phase2_gate', pattern: /Phase 2\/3:/i, label: 'Reached Phase 2' },
                { id: 'job_complete', pattern: /\[DREAM JOB\] Complete!/i, label: 'Dream job complete' },
            ],
        },
    },
    endless_runner: {
        laneId: 'endless_runner',
        title: 'Endless runner',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-runner',
        perspective: 'side_view',
        keywords: ['runner', 'run', 'jump', 'slide', 'obstacle', 'endless', 'temple', 'sonic'],
        foundationLane: 'endless_runner',
        physicsProfile: 'side_scroll_runner',
        inputModel: ['tap_jump', 'swipe_down_slide'],
        requiredStateHints: ['score', 'gameOver', 'distance', 'speed'],
        requiredFunctionHints: ['stepGame', 'resetGame', 'renderAll'],
        acceptanceChecks: [
            'Tap or swipe triggers jump or slide',
            'Obstacles spawn ahead and collision ends the run',
            'Distance or score increases while alive',
        ],
        requiresTileset: false,
        golden: {
            key: 'runner',
            prompt: 'Make an endless runner where I jump over obstacles and go as far as I can.',
        },
    },
    side_platformer: {
        laneId: 'side_platformer',
        title: 'Side platformer',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'side_view',
        keywords: ['platform', 'platformer', 'jump', 'gravity', 'ledge', 'double jump', 'side view'],
        foundationLane: 'side_platformer',
        physicsProfile: 'side_platformer',
        inputModel: ['tap_jump', 'virtual_pad'],
        requiredStateHints: ['score', 'gameOver', 'vy', 'grounded', 'player'],
        acceptanceChecks: [
            'Gravity pulls player down; grounded state stops fall',
            'Jump input changes vertical velocity',
            'Platforms or ground collision works within 10 seconds',
        ],
        requiresTileset: false,
        golden: {
            key: 'platformer',
            prompt: 'Make a side-view platformer where I jump across platforms and collect stars.',
        },
    },
    top_down_action: {
        laneId: 'top_down_action',
        title: 'Top-down action',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'top_down',
        keywords: ['top-down', 'top down', 'shooter', 'shoot', 'bullet', 'arena', 'survivor', 'waves'],
        foundationLane: 'top_down_action',
        physicsProfile: 'top_down_arcade',
        inputModel: ['joystick', 'tap_move', 'aim'],
        requiredStateHints: ['score', 'gameOver', 'health'],
        acceptanceChecks: [
            'Player moves in top-down plane from input',
            'Enemies or hazards interact with player',
            'Score or health updates on events',
        ],
        requiresTileset: false,
    },
    grid_tile_puzzle: {
        laneId: 'grid_tile_puzzle',
        title: 'Grid / tile puzzle',
        engine: 'phaser-tilemap',
        scaffoldTemplateId: 'canvas-grid-puzzle',
        perspective: 'top_down',
        keywords: [
            'match', 'match-3', 'grid', 'tile', 'tileset', 'puzzle', 'candy', 'swap',
            'board', 'cells', 'rows', 'columns',
        ],
        foundationLane: 'grid_tile_puzzle',
        physicsProfile: 'grid_logic',
        inputModel: ['tap_cell', 'swap_adjacent'],
        requiredStateHints: ['score', 'gameOver', 'grid', 'moves'],
        requiredFunctionHints: ['stepGame', 'resetGame', 'renderAll'],
        acceptanceChecks: [
            'Playable grid visible on boot (at least 6x6 cells)',
            'Tap or swap changes grid state with feedback',
            'Match or clear rule fires within sandbox window',
            'world_tileset or generated tileset renders on the board',
        ],
        implementationNotes: [
            'Use Phaser tilemap / grid scene from scaffold; preload world_tileset',
            'DreamAssets.preloadPhaser in Preloader; gameplay in dedicated level scene',
        ],
        requiresTileset: true,
        golden: {
            key: 'grid',
            prompt: 'Make a match-3 style puzzle game on a colorful grid where I swap tiles to clear matches.',
        },
    },
    rpg_turn_battle: {
        laneId: 'rpg_turn_battle',
        title: 'Turn-based battle',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'scene',
        keywords: ['turn-based', 'turn based', 'rpg', 'battle', 'attack', 'skill', 'enemy hp', 'menu'],
        foundationLane: 'rpg_turn_battle',
        physicsProfile: 'turn_based_menu',
        inputModel: ['tap_menu', 'select_action'],
        requiredStateHints: ['score', 'gameOver', 'turn', 'playerHp', 'enemyHp'],
        acceptanceChecks: [
            'Player chooses an action from menu or buttons',
            'Enemy turn resolves after player action',
            'HP or win/loss state updates and is visible',
        ],
        requiresTileset: false,
        golden: {
            key: 'rpg',
            prompt: 'Make a turn-based RPG battle where I pick attack or defend against an enemy.',
        },
    },
    projectile_action: {
        laneId: 'projectile_action',
        title: 'Projectile / artillery',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'side_view',
        keywords: ['artillery', 'worms', 'angle', 'power', 'wind', 'projectile', 'trajectory', 'tank'],
        foundationLane: 'projectile_action',
        physicsProfile: 'turn_based_projectile',
        inputModel: ['aim', 'power_slider', 'fire'],
        requiredStateHints: ['angle', 'power', 'wind', 'gameOver'],
        acceptanceChecks: [
            'Aim and fire change projectile path',
            'Projectile collision affects terrain or targets',
        ],
        requiresTileset: false,
    },
    mobile_arcade: {
        laneId: 'mobile_arcade',
        title: 'Mobile arcade (general)',
        engine: 'canvas-2d',
        scaffoldTemplateId: 'canvas-kernel',
        perspective: 'top_down',
        keywords: [],
        foundationLane: 'mobile_arcade',
        physicsProfile: 'mobile_arcade',
        inputModel: ['tap'],
        requiredStateHints: ['score', 'gameOver'],
        acceptanceChecks: [
            'Core loop responds to first input within 10 seconds',
            'Visible feedback on score or state change',
        ],
        requiresTileset: false,
    },
};

/**
 * Score prompt + Phase 1 spec against lane keyword lists; return best lane + runner-ups.
 */
export function selectMakerLane(prompt = '', qualityIntent = {}) {
    const text = collectPromptText(prompt, qualityIntent);
    const scores = MAKER_LANE_IDS.map((laneId) => {
        const lane = MAKER_LANE_LIBRARY[laneId];
        let score = 0;
        for (const kw of asArray(lane.keywords)) {
            if (text.includes(String(kw).toLowerCase())) score += kw.length > 6 ? 3 : 2;
        }
        const perspective = String(qualityIntent?.technicalRequirements?.perspective || '').toLowerCase();
        if (lane.perspective && perspective && lane.perspective === perspective) score += 4;
        if (laneId === 'mobile_arcade') score = Math.max(score, 1);
        return { laneId, score, lane };
    }).sort((a, b) => b.score - a.score);

    const best = scores[0];
    const lane = best?.lane || MAKER_LANE_LIBRARY.mobile_arcade;
    return {
        laneId: lane.laneId,
        score: best?.score || 1,
        engine: lane.engine,
        scaffoldTemplateId: lane.scaffoldTemplateId,
        perspective: lane.perspective,
        requiresTileset: Boolean(lane.requiresTileset),
        libraryLane: lane.laneId,
        golden: lane.golden || null,
        runnersUp: scores.slice(1, 4).map((entry) => ({ laneId: entry.laneId, score: entry.score })),
    };
}

function mergeUniqueStrings(...lists) {
    const out = [];
    const seen = new Set();
    for (const list of lists) {
        for (const item of asArray(list)) {
            const text = String(item || '').trim();
            if (!text || seen.has(text)) continue;
            seen.add(text);
            out.push(text);
        }
    }
    return out;
}

/** Apply library lane defaults onto architect JSON (non-destructive merge). */
export function applyLaneToFoundationContract(foundation = {}, laneSelection = null) {
    if (!laneSelection?.laneId) return foundation;
    const lane = MAKER_LANE_LIBRARY[laneSelection.laneId] || null;
    if (!lane) return foundation;

    const merged = { ...foundation };
    merged.libraryLaneId = lane.laneId;
    merged.lane = lane.foundationLane || lane.laneId;
    merged.engine = lane.engine === 'phaser-tilemap' ? 'phaser-tilemap' : (merged.engine || 'canvas-2d');
    merged.perspective = merged.perspective || lane.perspective;
    merged.requiredState = mergeUniqueStrings(lane.requiredStateHints, merged.requiredState);
    merged.requiredFunctions = mergeUniqueStrings(lane.requiredFunctionHints, merged.requiredFunctions);
    merged.acceptanceChecks = mergeUniqueStrings(lane.acceptanceChecks, merged.acceptanceChecks);
    merged.antiPatterns = mergeUniqueStrings(lane.antiPatterns, merged.antiPatterns);
    merged.implementationNotes = mergeUniqueStrings(lane.implementationNotes, merged.implementationNotes);

    const existingProbes = asArray(merged.probeMethods);
    const probeNames = new Set(existingProbes.map((p) => p?.name || p));
    for (const hint of asArray(lane.probeHints)) {
        if (probeNames.has(hint.name)) continue;
        existingProbes.push(hint);
        probeNames.add(hint.name);
    }
    merged.probeMethods = existingProbes;

    return merged;
}

export function getLaneFoundationPromptBlock(laneSelection = null) {
    if (!laneSelection?.laneId) return '';
    const lane = MAKER_LANE_LIBRARY[laneSelection.laneId];
    if (!lane) return '';

    return [
        'LIBRARY LANE (mandatory — design within this tested lane; you still customize title, assets, and flavor):',
        `lane: ${lane.foundationLane || lane.laneId}`,
        `engine: ${lane.engine}`,
        `physicsProfile: ${lane.physicsProfile}`,
        `inputModel: ${asArray(lane.inputModel).join(', ')}`,
        `perspective: ${lane.perspective}`,
        'requiredState must include: ' + asArray(lane.requiredStateHints).join(', '),
        'acceptanceChecks must include lane checks:',
        ...asArray(lane.acceptanceChecks).map((c) => `- ${c}`),
        'antiPatterns must include:',
        ...asArray(lane.antiPatterns).map((c) => `- ${c}`),
        lane.engine === 'phaser-tilemap'
            ? 'Use engine "phaser-tilemap" and plan for world_tileset + Phaser tilemap gameplay scene.'
            : 'Use engine "canvas-2d" and implement gameplay in src/main.ts on #game-canvas.',
    ].join('\n');
}

export function listGoldenLanes() {
    return MAKER_LANE_IDS
        .map((id) => MAKER_LANE_LIBRARY[id]?.golden)
        .filter((g) => g?.prompt);
}

export function getGoldenSpecForLane(laneId = '') {
    const lane = MAKER_LANE_LIBRARY[laneId];
    return lane?.golden || null;
}
