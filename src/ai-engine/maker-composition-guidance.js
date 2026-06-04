import { resolveHudAuthority } from './maker-hud-authority.js';

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
    'Three identical generic .hud-chip stat pills across the top (kernel dev UI look)',
    'HUD stats the player never needs for this loop',
    'Leaving pantry/order controls visible when gameOver is true or screenPhase is GAME_OVER',
    'Replacing the generated background image with a flat CSS/canvas gradient when DREAM_IMAGES has a background role',
    'Generic slate/navy placeholder gradients instead of the artist-generated environment art',
    'Onboarding/how-to-play hint overlapping interactive controls (ingredient bins, buttons) or never dismissing on first input',
];

const GLOBAL_ACCEPTANCE_CHECKS = [
    'Only one screen state from stateFlow is rendered at a time',
    'When gameOver is true, gameplay controls and order UI are hidden',
    'HUD is game-specific and complete — every stat the loop needs, each grounded on a uiKit panel, styled to the uiKit styleFamily (Astrocade-level polish, not bare text and not another genre\'s template)',
    'HUD stats appear in exactly one layer (designed #hud markup OR canvas — never duplicate the same stat)',
    'First frame shows background, primary subject, and one clear affordance — not a blank canvas',
    'Generated background image is drawn full-bleed via drawImage/resolveBackgroundImage on frame 1 when a background asset exists',
    'Item/world icons share the same art style and palette as the background scene; no flat emoji mixed with rendered art',
];

const PREMIUM_VISUAL_RULES = [
    'Premium mobile game bar: cohesive palette, readable silhouettes, one hero focal point per screen',
    'Background is a vivid generated environment scene — never a flat dev gradient if background art exists',
    'Every interactive element (buttons, slots, trays, meters, cards) sits on a uiKit panel grounded against the background — nothing floats as bare shapes or text over the scene',
    'Dim or zone the area behind active gameplay/controls so UI reads clearly against the background art',
    'One visual language: every panel, button, and icon uses the uiKit radius, border, and palette — never mix flat emoji with rendered art',
    'Touch targets at least 44px; control strips feel intentional, not cramped debug UI',
];

export function inferDefaultLayoutComposition(foundation = {}) {
    const architectScreenStates = asArray(foundation.screenStates);
    const flowFromArchitect = architectScreenStates.length
        ? architectScreenStates
        : asArray(foundation.stateFlow);
    const architectLayout = foundation.layoutComposition && typeof foundation.layoutComposition === 'object'
        ? foundation.layoutComposition
        : null;
    const architectZones = asArray(architectLayout?.zones);
    const architectRules = asArray(architectLayout?.layoutRules);

    if (architectZones.length > 0) {
        return {
            uiAuthority: asString(foundation.uiAuthority, architectLayout?.uiAuthority || 'agent-designed'),
            screenStateKey: asString(foundation.screenStateKey, 'screenPhase'),
            screenStates: flowFromArchitect.length >= 2 ? flowFromArchitect : ['PLAYING', 'GAME_OVER'],
            zones: architectZones,
            layoutRules: architectRules.length ? architectRules : [
                'Only one screen state visible at a time',
                'Do not duplicate the same HUD on canvas and DOM',
            ],
        };
    }

    return {
        uiAuthority: asString(foundation.uiAuthority, 'agent-designed'),
        screenStateKey: asString(foundation.screenStateKey, 'screenPhase'),
        screenStates: flowFromArchitect.length >= 2 ? flowFromArchitect : ['PLAYING', 'GAME_OVER'],
        zones: [
            { id: 'world', purpose: 'Gameplay world', layer: 'canvas', region: 'full-bleed' },
            { id: 'hud', purpose: 'Game-specific HUD on grounded uiKit panels', layer: 'agent', region: 'top-safe' },
        ],
        layoutRules: [
            'You design HUD in index.html + styles.css + drawHud() — every stat this game needs, each on a uiKit panel matched to the styleFamily',
            'Ground all UI on uiKit panels; never float bare text/shapes over the background',
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
            ...PREMIUM_VISUAL_RULES,
        ])],
    };

    const screenStateKey = asString(foundation.screenStateKey, defaults.screenStateKey);
    const screenStates = asArray(foundation.screenStates).length
        ? asArray(foundation.screenStates)
        : layoutComposition.screenStates;
    const uiAuthority = asString(foundation.uiAuthority, defaults.uiAuthority);
    const hudAuthority = resolveHudAuthority({ ...foundation, uiAuthority, layoutComposition });

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

    const hudDesign = asString(foundation.hudDesign, '');
    const hudAuthorityNote = hudAuthority === 'agent'
        ? `HUD authority=agent: implement foundation hudDesign in #hud and/or canvas drawHud() — minimal, polished, game-specific.`
        : hudAuthority === 'dom'
            ? 'HUD authority=dom: legacy chip scaffold only — do not duplicate stats on canvas.'
            : 'HUD authority=canvas: draw stats on canvas only.';

    const implementationNotes = [...new Set([
        ...asArray(foundation.implementationNotes),
        `Own screen flow via state.${screenStateKey} — render only the active screen state.`,
        `Follow layoutComposition zones; uiAuthority=${uiAuthority}. Do not duplicate UI across canvas and DOM.`,
        hudAuthorityNote,
        ...(hudDesign ? [`HUD design brief: ${hudDesign}`] : []),
        ...layoutComposition.layoutRules.slice(0, 3).map((rule) => `Layout: ${rule}`),
        'Visual: draw generated background full-bleed in renderAll before gameplay entities — keep resolveBackgroundImage() or equivalent.',
    ])].slice(0, 14);

    return {
        ...foundation,
        uiAuthority,
        hudAuthority,
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
        hudAuthority: foundation.hudAuthority || resolveHudAuthority(foundation),
        screenStateKey: foundation.screenStateKey || 'screenPhase',
        screenStates: foundation.screenStates || foundation.stateFlow || [],
        hudDesign: foundation.hudDesign || null,
        hudBlocks: foundation.hudBlocks || [],
        hudScaffold: foundation.hudScaffold === true,
        uiKit: foundation.uiKit && typeof foundation.uiKit === 'object' ? foundation.uiKit : null,
        layoutComposition: foundation.layoutComposition || null,
        antiPatterns: (foundation.antiPatterns || []).slice(0, 8),
        stateFlow: foundation.stateFlow || [],
    };
}

export function buildCompositionGuidancePromptBlock(foundation = {}) {
    const composition = summarizeCompositionForImplement(foundation);
    if (!composition) return '';
    const hudAuthority = composition.hudAuthority || resolveHudAuthority(foundation);
    const hudDesign = asString(composition.hudDesign || foundation.hudDesign, '');
    const lines = [
        'MOBILE COMPOSITION LAW (follow foundation — you design layout, not a fixed template):',
        `- Screen state key: state.${composition.screenStateKey}. Allowed values: ${(composition.screenStates || []).join(' | ') || 'PLAYING | GAME_OVER'}.`,
        `- UI authority: ${composition.uiAuthority || 'agent-designed'}. Each zone uses ONE layer only — never mirror order/HUD/end-state on canvas and DOM.`,
        `- HUD authority: ${hudAuthority}. #hud is an empty mount — YOU design markup + CSS + drawHud() (competitor bar: Astrocade — only what is needed, corners/meters, match game art).`,
        ...(hudDesign ? [`- HUD brief: ${hudDesign}`] : []),
        '- Forbidden: three identical generic slate stat pills; Score+Time+Fuel defaults; duplicate same stat on canvas and DOM.',
        '- Hide gameplay chrome and HUD when gameOver or end-state screen is active.',
        '- One end-state headline per screen — no stacked Shift Over + Game Over + status spam.',
        '- Onboarding/how-to-play hint: place it in a non-interactive area (never over bins/buttons/controls) and auto-dismiss it on the first input.',
        'VISUAL PREMIUM (competitor bar — art must feel shipped, not debug):',
        '- Frame 1 MUST drawImage the generated background (background1/background role) full-bleed — never ship flat slate/navy gradients if DREAM_IMAGES has background art.',
        '- Preserve or reimplement resolveBackgroundImage() + cover-scale drawImage before entities/HUD.',
        '- Ground every interactive element (button, slot, tray, meter, card) on a panel — never bare text/shapes floating over the background.',
    ];
    const uiKit = composition.uiKit && typeof composition.uiKit === 'object' ? composition.uiKit : null;
    if (uiKit) {
        const palette = uiKit.palette && typeof uiKit.palette === 'object' ? uiKit.palette : {};
        lines.push(
            `UI KIT (apply to EVERY panel/button/meter/card so the whole UI is one design system — style: ${uiKit.styleFamily || 'clean-minimal'}):`,
            `- Panels/cards: fill ${palette.panel || '#1f2937cc'}, border ${palette.panelBorder || '#38bdf8'}, corner radius ${uiKit.radius ?? 16}px, style ${uiKit.panelStyle || 'translucent-dark'}.`,
            `- Buttons: ${uiKit.buttonStyle || 'filled-rounded'} using accent ${palette.accent || '#38bdf8'}; big, obviously tappable, labelled.`,
            `- Text: primary ${palette.textPrimary || '#ffffff'}, muted ${palette.textMuted || '#94a3b8'}; font feel ${uiKit.font || 'rounded-bold'}.`,
            '- Panels/cards are SOLID and OPAQUE (white for casual, solid dark for neon) with a soft shadow — drawPanel. NEVER see-through outline boxes (border over an alpha<1 fill); that reads wireframe, not premium.',
            '- Content lives IN cards: every selectable/draggable item (swatch, topping, choice, piece) sits in its own solid rounded card, like Frosting Master. Buttons are chunky solid + color-coded by action (green confirm / red cancel) via drawButton — never outline-only.',
            '- Draw EVERY score/stat/currency/timer/label with drawValue (rounded font + dark outline + drop shadow; pass glow=accent for neon kits) — never bare ctx.fillText. Flat system-font numbers are the #1 thing that makes a game look unfinished.',
            '- Code-rendered game pieces (bubbles, gems, dots, tiles) use drawToken (saturated fill + dark outline + glossy highlight + shadow) — never a flat ctx.arc; flat pale circles look like placeholders.',
            '- Reuse these exact tokens + helpers for HUD, controls, AND the game-over/win panel — one radius, one palette, one language. No flat emoji mixed with rendered art.',
            ...(uiKit.decor && uiKit.decor !== 'none' ? [`- Theme flourish: ${uiKit.decor} (subtle, never blocks gameplay).`] : []),
        );
    }
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
