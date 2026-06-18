import { resolveHudAuthority } from './maker-hud-authority.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedThreeJSSkills = null;

function loadAllThreeJSSkills() {
    if (cachedThreeJSSkills) return cachedThreeJSSkills;
    try {
        const skillsDir = path.join(__dirname, 'threejs-skills');
        if (!fs.existsSync(skillsDir)) return '';
        
        let allSkills = [];
        
        // Only load pure knowledge from references. Ignore SKILL.md to avoid CLI/Python conflicts.
        function readDirRecursive(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    readDirRecursive(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    // Only include files that are inside a "references" folder somewhere in their path
                    if (fullPath.includes('/references/') && entry.name !== 'SKILL.md') {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        allSkills.push(`\n=== KNOWLEDGE REFERENCE: ${entry.name} ===\n${content}`);
                    }
                }
            }
        }
        
        readDirRecursive(skillsDir);
        cachedThreeJSSkills = [
            "CRITICAL CONTEXT: The following references are from the ThreeJS AAA Skills repository.",
            "You are the Maker Agent. You do NOT have a terminal, you cannot run python scripts, and you must implement the game primarily inside src/main.ts.",
            "ADAPT the architectural wisdom (camera lag, physics, lighting, movement) from these references into your single-file architecture.",
            allSkills.join('\n')
        ].join('\n');
        return cachedThreeJSSkills;
    } catch (e) {
        console.error('Failed to load ThreeJS skills:', e);
        return '';
    }
}
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
    'A persistent instructional banner/write-up that stays on screen over the controls instead of a brief auto-dismissing hint',
    'Rendering different named items/toppings/choices (e.g. Sprinkles vs Candy vs Fruit) with the SAME icon or shape — each distinct type must use its own generated sprite and look visibly different',
    'Shipping a DECORATIVE SCENE instead of a game: a pretty background with a couple of pre-placed/static sprites and "Playing!" but NONE of the foundation\'s interactions (no toolbar/tray to drag from, no tap/feed/select handlers, no meters) — that is a screensaver, not a playable game',
    'Naming a container the player fills in the prompt (tank, jar, bowl, plate, board, room, garden) but rendering items floating in open space with no visible vessel/frame drawn around the play area — the named container must be an explicit drawn element, not just the background',
    'An open-ended toy with no payoff: the player does the action forever with no judged result, no score/grade/verdict/reveal, and no celebrated result card — every finished micro-game builds to a result moment',
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
    const is3D = String(foundation.dimension || '').toUpperCase() === '3D' || String(foundation.lane || '').toLowerCase().includes('threejs');
    
    const lane = String(foundation.lane || '').toLowerCase();
    const genre = String(foundation.genre || '').toLowerCase();
    const isAction = /runner|racer|racing|shooter|arcade|action|surfer|dash/.test(lane + genre);
    const isCasual = !isAction;

    const lines = [
        'MOBILE COMPOSITION LAW (follow foundation — you design layout, not a fixed template):',
        `- Screen state key: state.${composition.screenStateKey}. Allowed values: ${(composition.screenStates || []).join(' | ') || 'PLAYING | GAME_OVER'}.`,
        `- UI authority: ${composition.uiAuthority || 'agent-designed'}. Each zone uses ONE layer only — never mirror order/HUD/end-state on canvas and DOM.`,
        `- HUD authority: ${hudAuthority}. #hud is an empty mount — YOU design markup + CSS + drawHud().`,
        ...(hudDesign ? [`- HUD brief: ${hudDesign}`] : []),
        '- Hide gameplay chrome and HUD when gameOver or end-state screen is active.',
        '- Onboarding/how-to-play hint: ONE short line max, in dead space (NEVER over buttons/tray/controls), and auto-dismiss it on the first input AND after ~2.5s with a fade.',
        '- BUILD TO A PAYOFF: When the player completes the action/round, JUDGE it and show a RESULT: a centered uiKit result card with the outcome (score/verdict/reveal), then a big Play Again. Trigger this when the round ends.',
    ];

    if (!is3D) {
        lines.push(
            'VISUAL PREMIUM (2D Canvas):',
            '- Frame 1 MUST drawImage the generated background full-bleed (preserve resolveBackgroundImage() + cover-scale drawImage).',
            '- Ground every interactive element (button, slot, tray, meter, card) on a panel — never bare text/shapes floating over the background.',
            '- IMPLEMENT THE WHOLE LOOP, not a renderable scene. Build EVERY interaction the foundation loop describes (toolbar, drag-and-drop, tap/feed).'
        );
        if (isCasual) {
            lines.push(
                '- Distinct items look distinct: each named item TYPE MUST drawImage ITS OWN generated sprite key — never reuse one icon/emoji for different things.',
                '- Draw the named CONTAINER: If the prompt names a vessel (tank, jar, plate), render it as a VISIBLE framed play-area grounded on the uiKit. Items sit INSIDE it.'
            );
        }
    }

    const uiKit = composition.uiKit && typeof composition.uiKit === 'object' ? composition.uiKit : null;
    if (uiKit) {
        const palette = uiKit.palette && typeof uiKit.palette === 'object' ? uiKit.palette : {};
        lines.push(
            `UI KIT (style: ${uiKit.styleFamily || 'clean-minimal'}):`,
            `- Panels/cards: fill ${palette.panel || '#1f2937cc'}, border ${palette.panelBorder || '#38bdf8'}, corner radius ${uiKit.radius ?? 16}px.`,
            `- Buttons: ${uiKit.buttonStyle || 'filled-rounded'} using accent ${palette.accent || '#38bdf8'}.`,
            `- Text: primary ${palette.textPrimary || '#ffffff'}, muted ${palette.textMuted || '#94a3b8'}.`
        );
        
        if (!is3D) {
            if (isAction) {
                lines.push('- ACTION HUD: Render a CLEAN INTEGRATED overlay (bold glowing numbers, icon rows). Do NOT wrap each stat in a bordered box.');
            } else {
                lines.push('- Panels/cards are SOLID and OPAQUE with a soft shadow — drawPanel.');
                lines.push('- Content lives IN cards. Buttons are chunky solid + color-coded by action via drawButton.');
            }
            lines.push('- Draw EVERY score/stat with drawValue (rounded font + dark outline + drop shadow) — never bare ctx.fillText.');
            lines.push('- Code-rendered game pieces use drawToken (saturated fill + dark outline + glossy highlight) — never a flat ctx.arc.');
        } else {
             if (isAction) {
                 lines.push('- ACTION HUD: Clean integrated DOM overlay. Big bold numbers, discrete meters. No giant boxed panels filling the screen.');
             } else {
                 lines.push('- Use DOM elements for panels, cards, and buttons matched to the palette.');
             }
        }
    }
    
    const rules = composition.layoutComposition?.layoutRules || [];
    for (const rule of rules.slice(0, 5)) {
        lines.push(`- ${rule}`);
    }
    const anti = composition.antiPatterns || [];
    if (anti.length) {
        lines.push('- Anti-patterns (instant fail): ' + anti.slice(0, 4).join('; '));
    }
    
    if (is3D) {
        const threejsSkills = loadAllThreeJSSkills();
        if (threejsSkills) {
            lines.push('\n=== THREE.JS GAMEPLAY & GRAPHICS SKILLS ===');
            lines.push('READ THE FOLLOWING SKILLS CAREFULLY AND APPLY THEM TO THIS GAME. THIS IS YOUR PRIMARY ARCHITECTURE AND GAME-FEEL GUIDANCE:');
            lines.push(threejsSkills);
            lines.push('=== END THREE.JS SKILLS ===\n');
        }
    }

    return lines.join('\n');
}
