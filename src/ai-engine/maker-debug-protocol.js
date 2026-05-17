import { summarizeMakerTemplateContract } from './maker-templates.js';

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
    ],
    'story-vignette': [
        {
            id: 'story_meaningful_choice',
            severity: 'fatal',
            check: 'The player must see and select meaningful choices that change flags, meters, or later content.',
            repair: 'Implement currentNode, choices, consequences, and state-dependent rendering.',
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
};

export function buildMakerDebugProtocol(templateContract = null, generatedAssets = null) {
    const templateSummary = summarizeMakerTemplateContract(templateContract);
    const templateId = templateSummary?.templateId || 'canvas-arcade';
    const hasAssets = Boolean(generatedAssets?.assets && Object.keys(generatedAssets.assets).length > 0);
    const checks = [
        ...BASE_DEBUG_CHECKS,
        ...(TEMPLATE_DEBUG_CHECKS[templateId] || []),
    ];

    return {
        version: 1,
        source: 'gametok-native-debug-protocol',
        template: templateSummary,
        hasGeneratedAssets: hasAssets,
        executionOrder: [
            'static_source_checks',
            'sandbox_boot',
            'viewport_and_canvas_checks',
            'pointer_interaction_probe',
            'asset_usage_probe',
            'template_contract_probe',
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
