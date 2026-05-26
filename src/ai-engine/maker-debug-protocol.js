import { summarizeMakerTemplateContract } from './maker-templates.js';
import { buildFoundationDebugChecks } from './maker-foundation-agent.js';

const BASE_DEBUG_CHECKS = [
    {
        id: 'no_external_navigation',
        severity: 'fatal',
        check: 'Source must not call window.location, window.open, submit forms, or create external links.',
        repair: 'Remove navigation and keep the game fully self-contained inside the GameTok webview.',
    },
    {
        id: 'mobile_safe_viewport',
        severity: 'fatal',
        check: 'The game must fit a 390x844 viewport with top and bottom GameTok chrome safe zones.',
        repair: 'Clamp canvas, HUD, and controls to an inner safe rectangle based on window.innerWidth/window.innerHeight.',
    },
    {
        id: 'visible_first_frame',
        severity: 'fatal',
        check: 'The first frame must render visible gameplay, not a blank screen, loading screen, or marketing page.',
        repair: 'Draw the world, player, goal or threat, and controls immediately on boot.',
    },
    {
        id: 'input_proves_mechanic',
        severity: 'major',
        check: 'Pointer input in the first 10 seconds must change gameplay state.',
        repair: 'Wire pointerdown/pointermove/pointerup controls to live state and visual feedback.',
    },
    {
        id: 'code_rendered_hud',
        severity: 'major',
        check: 'HUD, text, meters, buttons, labels, and controls must be code-rendered.',
        repair: 'Use DOM or canvas text/shapes for UI. Do not use AI images for HUD copy or buttons.',
    },
    {
        id: 'asset_usage',
        severity: 'major',
        check: 'If generated assets exist, source must use DreamAssets, DREAM_ASSETS, or DREAM_ASSET_PACK for gameplay visuals.',
        repair: 'Load player, enemy, prop, item, or background assets through the DreamAssets runtime helpers.',
    },
    {
        id: 'restartable_state',
        severity: 'major',
        check: 'Restart/round transition must reset mutable state without reloading the app.',
        repair: 'Centralize initial state construction and call it for restart or next round.',
    },
];

const TEMPLATE_DEBUG_CHECKS = {
    'phaser-artillery': [
        {
            id: 'artillery_arc_live',
            severity: 'fatal',
            check: 'Angle, power, and wind must visibly affect the projectile arc preview before firing.',
            repair: 'Compute trajectory points from angle, power, wind, and gravity each frame before drawing.',
        },
        {
            id: 'artillery_turn_resolution',
            severity: 'fatal',
            check: 'The fire button must launch exactly one shell, resolve impact/miss, then alternate turns.',
            repair: 'Add a projectile state machine: aiming -> flying -> resolving -> nextTurn.',
        },
        {
            id: 'artillery_destructible_terrain',
            severity: 'major',
            check: 'Destructible terrain must change code-defined terrain data after explosions.',
            repair: 'Deform the terrain heightfield or mask within the explosion radius and redraw from data.',
        },
    ],
    'phaser-top-down-action': [
        {
            id: 'topdown_active_threats',
            severity: 'fatal',
            check: 'At least one enemy, target, hazard, or objective must appear and interact within 10 seconds.',
            repair: 'Spawn visible entities near the player and run collision or attack logic immediately.',
        },
        {
            id: 'topdown_feedback_loop',
            severity: 'major',
            check: 'Hits, pickups, score, combo, health, or wave progress must visibly change live.',
            repair: 'Wire interactions to HUD updates, particles, shake, hit-stop, or score changes.',
        },
    ],
    'phaser-platformer': [
        {
            id: 'platform_collision',
            severity: 'fatal',
            check: 'Platforms must have real collision; player cannot fall through visible ground.',
            repair: 'Use code-defined platform bounds and resolve vertical/horizontal movement against them.',
        },
        {
            id: 'platform_controls',
            severity: 'major',
            check: 'Mobile left/right/jump controls must be visible and responsive.',
            repair: 'Add large pointer controls outside the main action area and map them to movement state.',
        },
    ],
    'canvas-toybox': [
        {
            id: 'toybox_slot_fill',
            severity: 'fatal',
            check: 'Ingredient selection must fill slot state and render visible slot contents.',
            repair: 'Wire pantry taps to selectIngredient() and update slot DOM/canvas from state.slots.',
        },
        {
            id: 'toybox_cook_loop',
            severity: 'fatal',
            check: 'Cooking a matched order must increase score/combo and spawn a new order.',
            repair: 'Compare sorted slots against currentOrder in cookOrder() and mutate score/combo on success.',
        },
        {
            id: 'toybox_timer_pressure',
            severity: 'major',
            check: 'Order or round timers must decrease during gameplay steps.',
            repair: 'Advance timeLeft/orderTimeLeft inside stepGame() and update HUD bars every frame.',
        },
    ],
    'canvas-simulation': [
        {
            id: 'simulation_edit_run_modes',
            severity: 'fatal',
            check: 'The user must be able to edit/build first, then start the simulation.',
            repair: 'Separate edit mode from running mode and make START/RESET controls explicit.',
        },
        {
            id: 'simulation_goal_check',
            severity: 'major',
            check: 'Win/loss must be computed from simulated state, not a timer-only fake result.',
            repair: 'Check the goal object position/velocity against target/failure zones every physics step.',
        },
        {
            id: 'simulation_body_mutation',
            severity: 'major',
            check: 'Adding a part must mutate the simulation body list and be visible before START.',
            repair: 'Wire palette/drag placement to addBody() and render the new body in edit mode.',
        },
    ],
    'canvas-grid-puzzle': [
        {
            id: 'grid_stateful_moves',
            severity: 'fatal',
            check: 'Selecting and moving tiles must mutate grid state, not just animate decorative tiles.',
            repair: 'Represent the board as a grid array and update a grid signature after every legal move.',
        },
        {
            id: 'grid_goal_resolution',
            severity: 'major',
            check: 'Puzzle resolution must change score, moves, goal progress, or status from live board state.',
            repair: 'Connect resolveMatches/applyGoalProgress to board data and visible HUD updates.',
        },
    ],
    'canvas-runner': [
        {
            id: 'runner_jump_slide_state',
            severity: 'fatal',
            check: 'Jump and slide controls must change player physics/collision state.',
            repair: 'Implement jump velocity, gravity, slide timer, and collision bounds that respond to controls.',
        },
        {
            id: 'runner_progression_loop',
            severity: 'major',
            check: 'Runner distance, obstacles, collectibles, or score must progress without fake static scrolling.',
            repair: 'Spawn live obstacle/collectible entities and advance distance/score inside updateRunner().',
        },
    ],
    'canvas-arcade-shooter': [
        {
            id: 'shooter_projectile_loop',
            severity: 'fatal',
            check: 'Fire must create projectiles that move and collide with enemies.',
            repair: 'Implement fireWeapon(), updateProjectiles(), spawnEnemy(), and resolveCollisions() against live arrays.',
        },
        {
            id: 'shooter_wave_pressure',
            severity: 'major',
            check: 'Enemy waves must spawn and threaten the player without relying on keyboard-only play.',
            repair: 'Spawn visible enemies on timers and support drag/joystick mobile movement.',
        },
    ],
    'story-vignette': [
        {
            id: 'story_meaningful_choice',
            severity: 'fatal',
            check: 'The player must see and select meaningful choices that change flags, meters, or later content.',
            repair: 'Implement currentNode, choices, consequences, and state-dependent rendering.',
        },
        {
            id: 'story_mobile_readability',
            severity: 'major',
            check: 'Story copy and choices must fit phone UI containers and stay tappable.',
            repair: 'Use responsive DOM choice buttons, short visible text blocks, and safe-area layout.',
        },
    ],
    'three-first-person': [
        {
            id: 'three_true_perspective',
            severity: 'fatal',
            check: 'The game must use a PerspectiveCamera and visible 3D world geometry.',
            repair: 'Create a Three.js scene, camera, renderer, depth cues, and first-person controls.',
        },
    ],
    'canvas-arcade': [
        {
            id: 'arcade_live_input',
            severity: 'fatal',
            check: 'Mobile input and the probe move() method must change player or cursor state.',
            repair: 'Wire pointer controls and probe move() to the same live player state used by drawWorld().',
        },
        {
            id: 'arcade_primary_action',
            severity: 'major',
            check: 'The primary action must create or mutate a live gameplay entity, meter, score, or goal state.',
            repair: 'Implement primaryAction() and visible controls through the same gameplay function.',
        },
        {
            id: 'arcade_threat_or_goal_loop',
            severity: 'major',
            check: 'The game must spawn threats, goals, pickups, or objectives that progress through update/collision state.',
            repair: 'Add live entities and collision/progression logic instead of a static interactive toy.',
        },
    ],
};

export function buildMakerDebugProtocol(templateContract = null, generatedAssets = null, assetContract = null) {
    const templateSummary = summarizeMakerTemplateContract(templateContract);
    const templateId = templateSummary?.templateId || 'canvas-arcade';
    const foundation = templateContract?.foundation || null;
    const hasAssets = Boolean(generatedAssets?.assets && Object.keys(generatedAssets.assets).length > 0);
    const hasFrameSequences = Array.isArray(generatedAssets?.animations)
        && generatedAssets.animations.some((animation) => animation?.type === 'frame_sequence');
    const hasTilesets = Array.isArray(generatedAssets?.tilesets)
        && generatedAssets.tilesets.some((tileset) => tileset?.imageKey || tileset?.sheetKey);
    const checks = [
        ...BASE_DEBUG_CHECKS,
        ...(hasFrameSequences ? [{
            id: 'animation_asset_usage',
            severity: 'major',
            check: 'If frame_sequence animations exist, source must use DREAM_ANIMATIONS, DreamAssets.createAnimations(), DreamAssets.animationsFor(), DreamAssets.applyTween(), or animation keys.',
            repair: 'Connect generated animation frame sequences to the matching player/enemy sprites or manually cycle the frame keys in canvas renderers.',
        }] : []),
        ...(hasTilesets ? [{
            id: 'tileset_asset_usage',
            severity: 'major',
            check: 'If DREAM_TILESETS exist, tile/grid/platform/terrain renderers must use DreamAssets.firstTileset(), DreamAssets.getTileset(), DREAM_TILESETS, or tileset keys.',
            repair: 'Load the generated 7x7 tileset image and use it as the visual vocabulary for code-defined tile terrain or platform surfaces.',
        }] : []),
        ...(TEMPLATE_DEBUG_CHECKS[templateId] || []),
        ...(templateId === 'canvas-kernel' && foundation ? buildFoundationDebugChecks(foundation) : []),
    ];

    return {
        version: 1,
        source: 'gametok-native-debug-protocol',
        template: templateSummary,
        hasGeneratedAssets: hasAssets,
        hasFrameSequences,
        hasTilesets,
        assetContract: assetContract ? {
            templateId: assetContract.templateId || null,
            slots: Array.isArray(assetContract.slots)
                ? assetContract.slots.map((slot) => ({
                    id: slot.id,
                    role: slot.role,
                    assetType: slot.assetType,
                    required: Boolean(slot.required),
                    consumedBy: slot.consumedBy,
                }))
                : [],
        } : null,
        executionOrder: [
            'static_source_checks',
            'sandbox_boot',
            'viewport_and_canvas_checks',
            'pointer_interaction_probe',
            'asset_usage_probe',
            'template_contract_probe',
            'asset_contract_probe',
            'file_repair_loop',
        ],
        checks,
        repairPolicy: {
            preferFileEdits: true,
            maxRepairAttempts: 2,
            preserveUserPrompt: true,
            preserveTemplateContract: true,
            preserveGeneratedAssets: hasAssets,
            fallbackWholeHtmlRepair: true,
        },
    };
}

export function formatMakerDebugProtocolPromptBlock(debugProtocol = null) {
    if (!debugProtocol) return '';
    return [
        'Native debug protocol:',
        JSON.stringify(debugProtocol, null, 2),
    ].join('\n');
}
