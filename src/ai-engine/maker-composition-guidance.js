import { isTimedOrderCookingLane } from './maker-lane-scaffolds.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

const GLOBAL_ANTI_PATTERNS = [
    'Drawing the same HUD, order UI, or end-state on canvas AND DOM at the same time',
    'Showing multiple screen states simultaneously (e.g. PLAYING chrome while GAME_OVER overlay is up)',
    'Stacking duplicate end-state copy (Shift Over + Game Over + status line all visible)',
    'More than 3 HUD stat chips visible at once',
    'Leaving pantry/order controls visible when gameOver is true or screenPhase is GAME_OVER',
];

const GLOBAL_ACCEPTANCE_CHECKS = [
    'Only one screen state from stateFlow is rendered at a time',
    'When gameOver is true, gameplay controls and order UI are hidden',
    'HUD shows at most three distinct stats (score, time, combo/lives — pick what fits)',
    'First frame shows background, primary subject, and one clear affordance — not a blank canvas',
];

const COOKING_LAYOUT_RULES = [
    'Background and character staging on canvas; interactive pantry, slots, and COOK on DOM OR all on canvas — pick one authority per zone, never both',
    'Customer order bubble icons must reference the same asset keys as pantry ingredient cards',
    'When screenPhase is SHIFT_END or GAME_OVER, hide order station, pantry, and duplicate HUD labels',
    'Use one headline for end states — do not show BLEH, Game Over, and Shift Over at once',
];

const COOKING_ZONES = [
    { id: 'world', purpose: 'Background + character staging', layer: 'canvas', region: 'upper-60%' },
    { id: 'orderStation', purpose: 'Customer bubble, cauldron slots, cook action', layer: 'dom', region: 'center' },
    { id: 'pantry', purpose: 'Ingredient picker (touch/drag)', layer: 'dom', region: 'bottom-strip' },
    { id: 'hud', purpose: 'Score, shift timer, combo/lives only', layer: 'dom', region: 'top-safe', maxElements: 3 },
];

export function inferDefaultLayoutComposition(foundation = {}) {
    const architectScreenStates = asArray(foundation.screenStates);
    const flowFromArchitect = architectScreenStates.length
        ? architectScreenStates
        : asArray(foundation.stateFlow);
    const hasShiftFlow = flowFromArchitect.some((state) => /shift|round|wave/i.test(String(state)));

    if (isTimedOrderCookingLane(foundation)) {
        return {
            uiAuthority: 'hybrid-zoned',
            screenStateKey: 'screenPhase',
            screenStates: hasShiftFlow && flowFromArchitect.length >= 2
                ? flowFromArchitect
                : ['PLAYING', 'SHIFT_END', 'GAME_OVER'],
            zones: COOKING_ZONES,
            layoutRules: COOKING_LAYOUT_RULES,
        };
    }
    return {
        uiAuthority: 'canvas',
        screenStateKey: 'screenPhase',
        screenStates: asArray(foundation.stateFlow).length >= 2
            ? asArray(foundation.stateFlow)
            : ['PLAYING', 'GAME_OVER'],
        zones: [
            { id: 'world', purpose: 'Gameplay world', layer: 'canvas', region: 'full-bleed' },
            { id: 'hud', purpose: 'Score and primary timer', layer: 'dom', region: 'top-safe', maxElements: 3 },
        ],
        layoutRules: [
            'Gameplay entities render on canvas; HUD on DOM header chips or canvas text — not duplicated',
            'Only one screen state visible at a time',
        ],
    };
}

export function mergeCompositionGuidance(foundation = {}) {
    const defaults = inferDefaultLayoutComposition(foundation);
    const sourceLayout = foundation.layoutComposition && typeof foundation.layoutComposition === 'object'
        ? foundation.layoutComposition
        : {};
    const layoutComposition = {
        ...defaults,
        ...sourceLayout,
        zones: asArray(sourceLayout.zones).length ? asArray(sourceLayout.zones) : defaults.zones,
        layoutRules: [...new Set([
            ...asArray(defaults.layoutRules),
            ...asArray(sourceLayout.layoutRules),
        ])],
    };

    const screenStateKey = asString(foundation.screenStateKey, defaults.screenStateKey);
    const screenStates = asArray(foundation.screenStates).length
        ? asArray(foundation.screenStates)
        : layoutComposition.screenStates;
    const uiAuthority = asString(foundation.uiAuthority, defaults.uiAuthority);

    const antiPatterns = [...new Set([
        ...GLOBAL_ANTI_PATTERNS,
        ...asArray(foundation.antiPatterns),
    ])];
    const acceptanceChecks = [...new Set([
        ...GLOBAL_ACCEPTANCE_CHECKS,
        ...asArray(foundation.acceptanceChecks),
    ])];

    const requiredState = [...new Set([
        ...asArray(foundation.requiredState),
        screenStateKey,
    ])];

    const implementationNotes = [...new Set([
        ...asArray(foundation.implementationNotes),
        `Own screen flow via state.${screenStateKey} — render only the active screen state.`,
        `Follow layoutComposition zones; uiAuthority=${uiAuthority}. Do not duplicate UI across canvas and DOM.`,
        ...layoutComposition.layoutRules.slice(0, 3).map((rule) => `Layout: ${rule}`),
    ])].slice(0, 12);

    return {
        ...foundation,
        uiAuthority,
        screenStateKey,
        screenStates,
        layoutComposition,
        stateFlow: screenStates,
        requiredState,
        antiPatterns,
        acceptanceChecks,
        implementationNotes,
    };
}

export function summarizeCompositionForImplement(foundation = {}) {
    if (!foundation || typeof foundation !== 'object') return null;
    return {
        uiAuthority: foundation.uiAuthority || null,
        screenStateKey: foundation.screenStateKey || 'screenPhase',
        screenStates: foundation.screenStates || foundation.stateFlow || [],
        hudBlocks: foundation.hudBlocks || [],
        layoutComposition: foundation.layoutComposition || null,
        antiPatterns: (foundation.antiPatterns || []).slice(0, 8),
        stateFlow: foundation.stateFlow || [],
    };
}

export function buildCompositionGuidancePromptBlock(foundation = {}) {
    const composition = summarizeCompositionForImplement(foundation);
    if (!composition) return '';
    const lines = [
        'MOBILE COMPOSITION LAW (follow foundation — you design layout, not a fixed template):',
        `- Screen state key: state.${composition.screenStateKey}. Allowed values: ${(composition.screenStates || []).join(' | ') || 'PLAYING | GAME_OVER'}.`,
        `- UI authority: ${composition.uiAuthority || 'canvas'}. Each zone uses ONE layer only — never mirror order/HUD/end-state on canvas and DOM.`,
        '- At most 3 HUD stats. Hide pantry, slots, order bubble, and duplicate labels when gameOver or end-state screen is active.',
        '- One end-state headline per screen — no stacked Shift Over + Game Over + status spam.',
    ];
    const rules = composition.layoutComposition?.layoutRules || [];
    for (const rule of rules.slice(0, 5)) {
        lines.push(`- ${rule}`);
    }
    const anti = composition.antiPatterns || [];
    if (anti.length) {
        lines.push('- Anti-patterns (instant fail): ' + anti.slice(0, 4).join('; '));
    }
    return lines.join('\n');
}
