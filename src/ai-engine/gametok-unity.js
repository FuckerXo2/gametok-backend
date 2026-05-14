/**
 * GameTok Unity Contract
 *
 * One shared source of truth for what the generator may promise, plan, assetize,
 * and build. Keep this compact because these blocks are inserted into model
 * prompts on the spec, planning, and build paths.
 */

export const GAMETOK_UNITY = Object.freeze({
    platform: {
        runtime: 'single self-contained mobile HTML5 game',
        primarySurface: 'portrait phone inside GameTok preview chrome',
        controls: 'touch-first; no keyboard required',
        output: 'one playable game, not a landing page, website, or external link',
    },
    supportedCapabilities: [
        'single-player arcade/action/puzzle/simulation loops',
        'local same-device turn-taking when the prompt asks for turns',
        'code-rendered HUD, meters, menus, score, labels, and touch controls',
        'procedural or code-defined gameplay geometry and collision',
        'projectile physics, aiming arcs, gravity, wind, fuel, health, score, timers',
        'simple AI opponents and scripted hazards',
        'AI-generated sprites, scenery backgrounds, props, VFX source art, and collectibles',
        'R2-hosted GameTok audio library for SFX and music',
        'sandbox verification and repair when the built game crashes',
    ],
    explicitOnlyCapabilities: [
        'online multiplayer',
        'matchmaking',
        'live chat',
        'account systems inside generated games',
        'shops, battle passes, real-money economies, or payments',
        'deep character/tank/weapon customization',
        'campaigns, level editors, cloud saves, or persistent progression',
        'sharing, leaderboards, or social feeds inside the generated game',
    ],
    unsupportedPromises: [
        'external websites or navigation',
        'networked real-time multiplayer',
        'server-backed generated-game state',
        'real purchases or real account management inside generated games',
        'features that require backend APIs not present in the generated HTML',
    ],
    specCopy: {
        bannedFiller: [
            'strategy is key',
            'satisfying gameplay',
            'clear controls',
            'multiplayer mode',
            'customization',
            'endless fun',
        ],
        rule: 'Concept cards must describe real implied mechanics from the user prompt, not generic app-store filler or fake capabilities.',
    },
    assetPolicy: {
        hudRuntimeOnly: true,
        noAiHudImages: true,
        gameplayGeometryIsCode: true,
        background: {
            defaultWidth: 768,
            defaultHeight: 1344,
            forbiddenPrompt: 'Scenery only. No text, no labels, no HUD, no buttons, no foreground characters, no watermarks, and no playable terrain collision baked into the image.',
        },
        transparentSpriteRoles: [
            'player',
            'enemy',
            'item',
            'prop',
            'projectile',
            'effect',
        ],
    },
});

function list(items) {
    return items.map((item) => `- ${item}`).join('\n');
}

export function formatUnityPromptBlock({ audience = 'builder' } = {}) {
    const modeLine = audience === 'spec'
        ? 'Use this when writing the user-facing pre-create concept card.'
        : audience === 'phase1'
            ? 'Use this when deciding what the game actually is before code or assets are made.'
            : 'Use this when building the generated game.';

    return `GAMETOK UNITY CONTRACT:
${modeLine}

Platform truth:
- Runtime: ${GAMETOK_UNITY.platform.runtime}
- Surface: ${GAMETOK_UNITY.platform.primarySurface}
- Controls: ${GAMETOK_UNITY.platform.controls}
- Output: ${GAMETOK_UNITY.platform.output}

Supported capabilities:
${list(GAMETOK_UNITY.supportedCapabilities)}

Only promise or build these if the user explicitly asked:
${list(GAMETOK_UNITY.explicitOnlyCapabilities)}

Never promise:
${list(GAMETOK_UNITY.unsupportedPromises)}

Asset truth:
- HUD, meters, labels, score, menus, prompts, and touch controls are code-rendered runtime UI.
- Do not request or use AI-generated HUD panels/buttons/text as the interface.
- Background art is scenery only. ${GAMETOK_UNITY.assetPolicy.background.forbiddenPrompt}
- Collision terrain, platforms, paths, landing pads, tactical grids, hitboxes, and win/loss zones must be code-defined.
- Transparent AI sprites are for player/enemy/item/prop/projectile/effect roles.

Spec copy truth:
- ${GAMETOK_UNITY.specCopy.rule}
- Banned filler: ${GAMETOK_UNITY.specCopy.bannedFiller.join(', ')}.`;
}

export function formatUnitySpecPromptBlock() {
    return formatUnityPromptBlock({ audience: 'spec' });
}

export function formatUnityPhase1PromptBlock() {
    return formatUnityPromptBlock({ audience: 'phase1' });
}
