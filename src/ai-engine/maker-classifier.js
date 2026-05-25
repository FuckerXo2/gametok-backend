// ─────────────────────────────────────────────────────────
// LLM-POWERED GAME CLASSIFIER
// The AI (Phase 1) now picks the archetype directly.
// This file just maps that archetype string to a templateId
// and physics profile. No more regex keyword scoring.
// ─────────────────────────────────────────────────────────

const ARCHETYPE_TO_TEMPLATE = {
    turn_based_artillery: {
        templateId: 'phaser-artillery',
        profile: { dimension: '2D', perspective: 'side_view', physics: 'projectile_ballistics', movement: 'turn_based_aim_and_fire' },
    },
    top_down_action: {
        templateId: 'phaser-top-down-action',
        profile: { dimension: '2D', perspective: 'top_down', physics: 'entity_collisions', movement: 'free_movement' },
    },
    platformer: {
        templateId: 'phaser-platformer',
        profile: { dimension: '2D', perspective: 'side_view', physics: 'gravity_platform_collision', movement: 'run_jump' },
    },
    runner: {
        templateId: 'canvas-runner',
        profile: { dimension: '2D', perspective: 'side_view', physics: 'scrolling_obstacle_collision', movement: 'auto_run' },
    },
    arcade_shooter: {
        templateId: 'canvas-arcade-shooter',
        profile: { dimension: '2D', perspective: 'arcade', physics: 'projectile_collision', movement: 'move_and_fire' },
    },
    physics_simulation: {
        templateId: 'canvas-simulation',
        profile: { dimension: '2D', perspective: 'side_view', physics: 'sandbox_rigid_body', movement: 'edit_then_simulate' },
    },
    grid_puzzle: {
        templateId: 'canvas-grid-puzzle',
        profile: { dimension: '2D', perspective: 'grid', physics: 'discrete_grid_rules', movement: 'tile_selection' },
    },
    interactive_story: {
        templateId: 'story-vignette',
        profile: { dimension: '2D', perspective: 'scene', physics: 'state_machine', movement: 'choice_navigation' },
    },
    first_person_3d: {
        templateId: 'three-first-person',
        profile: { dimension: '3D', perspective: 'first_person', physics: '3d_collision', movement: 'first_person_move_look' },
    },
    arcade: {
        templateId: 'canvas-arcade',
        profile: { dimension: '2D', perspective: 'arcade', physics: 'entity_collision', movement: 'direct_input' },
    },
};

const DEFAULT_FALLBACK = ARCHETYPE_TO_TEMPLATE.arcade;

export function classifyMakerGame(qualityIntent = {}, _prompt = '') {
    // Read the archetype directly from the LLM's Phase 1 output
    const llmArchetype = String(qualityIntent.technicalRequirements?.archetype || '').trim().toLowerCase();
    const llmReasoning = String(qualityIntent.technicalRequirements?.archetypeReasoning || '');

    const match = ARCHETYPE_TO_TEMPLATE[llmArchetype] || null;
    const selectedTemplateId = match ? match.templateId : DEFAULT_FALLBACK.templateId;
    const selectedArchetype = match ? llmArchetype : 'arcade';
    const physicsProfile = match ? match.profile : DEFAULT_FALLBACK.profile;

    return {
        version: 2,
        source: 'gametok-llm-classifier',
        selectedTemplateId,
        selectedArchetype,
        confidence: match ? 0.9 : 0.3,
        physicsProfile,
        reasoning: match
            ? `LLM selected ${selectedArchetype}: ${llmReasoning}`
            : `LLM archetype "${llmArchetype}" not recognized; falling back to canvas-arcade.`,
    };
}
