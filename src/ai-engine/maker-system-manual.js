/**
 * GameTok Maker System Manual
 * Shared operating model injected into pipeline agents so each job sees the same
 * full picture: pipeline roles, kernel vs foundation vs implementation, assets,
 * sandbox law, and known failure modes.
 */

const PIPELINE = {
    phases: [
        'Phase 1 — Spec: understand the user prompt (title, loop, mechanics, art direction). No code.',
        'Phase 1.5 — Foundation Architect: design THIS game foundation contract JSON (state, functions, probes, asset slots, first frame, acceptance). Do not pick legacy template folders.',
        'Artist — Generate PNG assets from foundation assetSlots + art direction. Assets load at runtime via DREAM_IMAGES.',
        'Phase 2 — File Agent: implement the full game in src/main.ts (and html/css if needed) on top of the kernel scaffold stub.',
        'Phase 3 — Sandbox: headless boot, blank-canvas check, probe API, asset usage, foundation acceptance checks.',
    ],
    agents: {
        spec: 'Extract playable behavior only. Do not choose template folders when dynamic foundation is enabled.',
        foundation: 'Author the per-job foundation contract. You design the game shape; the kernel is fixed.',
        artist: 'Generate isolated sprites/backgrounds matching assetSlots roles. No HUD text baked into images.',
        fileAgent: 'Implement foundation requiredFunctions and probeMethods. Replace stub gameplay with the real loop.',
        sandbox: 'Enforces foundation contract + global laws (visible first frame, no external nav, assets used).',
    },
};

const KERNEL = {
    templateId: 'canvas-kernel',
    readOnlyFiles: [
        'src/bootstrap.ts',
        'src/assetLoader.ts',
        'src/types/global.d.ts',
        'package.json',
        'tsconfig.json',
        'vite.config.js',
    ],
    bootOrder: [
        'index.html loads src/bootstrap.ts',
        'bootstrap calls loadDreamAssets() from assetLoader.ts',
        'assetLoader fills window.DREAM_IMAGES from public/assets/asset-pack.json + window.DREAM_ASSET_PACK',
        'bootstrap dynamic-imports src/main.ts after assets resolve (or on failure, boot anyway)',
    ],
    runtimeGlobals: [
        'window.DREAM_IMAGES — HTMLImageElement map by asset key/role',
        'window.DREAM_ASSET_PACK — runtime asset metadata array',
        'window.DREAM_ASSETS — optional inline data URLs',
        'window.DREAM_ANIMATIONS / DREAM_TILESETS / DREAM_AUDIO_MANIFEST when present',
        'window.__GAMETOK_TEMPLATE_PROBE__ — sandbox verification API (methods from foundation contract)',
    ],
    firstFrameLaw: [
        'Frame 1 must NOT be blank.',
        'Draw background (generated background role or code gradient fallback).',
        'Draw primary subject (player or equivalent) using DREAM_IMAGES or code fallback shape.',
        'Show code-rendered HUD or status affordance.',
        'Prove the game exists before the player taps.',
    ],
};

const FOUNDATION_CONTRACT = {
    purpose: 'Single source of truth for THIS job. Saved as foundation-contract.json in the maker workspace.',
    fields: {
        foundationId: 'Short id for this game foundation.',
        lane: 'Game design lane label (e.g. timed_order_cooking, projectile_action). Not a legacy template folder.',
        requiredState: 'Mutable state keys the file agent must own (score, gameOver, slots, etc.).',
        requiredFunctions: 'Must exist in src/main.ts (always include stepGame, resetGame, renderAll unless foundation says otherwise).',
        probeMethods: 'Methods on __GAMETOK_TEMPLATE_PROBE__ — minimum snapshot, step, reset.',
        firstFrame: 'Visible requirements checked conceptually by sandbox.',
        assetSlots: 'Roles the artist generates (player, enemy, background, item, prop).',
        acceptanceChecks: 'Testable gameplay proofs for this specific game.',
        implementationNotes: 'Concrete guidance for the Phase 2 file agent.',
        uiAuthority: 'canvas | dom | hybrid-zoned — file agent must not duplicate UI across layers.',
        uiKit: 'Per-game design system (styleFamily, palette, radius, panelStyle, buttonStyle, font) — apply to EVERY panel/button/meter so the UI is cohesive. Theme-matched to this game, never another genre\'s template.',
        screenStateKey: 'State key (e.g. screenPhase) — only one screen state renders at a time.',
        layoutComposition: 'Zones (layer + region) and layoutRules — architect designs layout; no fixed HTML templates.',
    },
    scaffoldAssembly: [
        'Kernel files are copied from canvas-kernel/.',
        'Minimal index.html + src/main.ts stub from foundation (canvas, HUD shell, status line only).',
        'Phase 2 file agent owns full mobile layout per layoutComposition — replaces stub with real game.',
    ],
};

const COMPOSITION_LAW = [
    'The foundation architect designs layout zones — we do NOT ship fixed competitor HTML templates.',
    'Each UI zone uses ONE layer: canvas OR DOM, never both for the same affordance (order bubble, HUD stat, end-state headline).',
    'Screen flow via screenStateKey (default screenPhase): only PLAYING, SHIFT_END, or GAME_OVER chrome visible at once.',
    'HUD cap: at most 3 stat chips (score, time, combo/lives).',
    'End states: one headline — no stacked Shift Over + Game Over + status line + canvas duplicate.',
    'Cooking lanes: order bubble icons must use the same asset keys as pantry cards.',
    'When gameOver is true, hide pantry, slots, order UI, and gameplay controls.',
];

const ASSET_LAW = [
    'Sprites: transparent PNG subjects (player, enemy, item, prop, effect).',
    'Backgrounds: opaque scenery only — no HUD, no characters, no text, no buttons.',
    'HUD, meters, buttons, labels, timers: code-rendered only (DOM or canvas text/shapes).',
    'Use getAssetImage(key) or DREAM_IMAGES[key] in canvas games — never paste data URLs into source.',
    'Background keys commonly aliased: background1, background, environment, toybox_background.',
    'If an asset fails quality (blank/transparent), use a code fallback shape — do not pretend the broken PNG is fine.',
];

const SANDBOX_LAW = [
    'Blank canvas = fatal failure.',
    'Canvas must fill the mobile viewport (0,0 to innerWidth/innerHeight). Default body margin or offset canvas = failure.',
    'Keep import "./styles.css" in src/main.ts OR rely on index.html critical layout CSS — never leave the page on browser default margins.',
    'Missing required probe methods = failure.',
    'External navigation / window.open = fatal.',
    'Generated assets exist but never drawn = failure.',
    '3D requests on 2D kernel = blocked before build (when unsupported).',
];

const KNOWN_FAILURES = [
    'Blockshot pattern: user asked 3D but game ran on 2D canvas → blank or wrong game. Fix: block unsupported 3D early.',
    'Blank canvas pattern: code boots but renderAll/stepGame never draws → sandbox fails. Fix: implement foundation firstFrame + renderAll.',
    'Asset orphan pattern: artist generated sprites but main.ts never calls getAssetImage → acceptance fails. Fix: wire assetSlots to renderers.',
    'Transparent player pattern: imgly/RMBG wiped sprite → quality gate fails. Fix: regen asset or code fallback.',
    'Classifier mismatch (legacy): archetype routed to wrong template folder. Fix: dynamic foundation replaces folder picking.',
    'Canvas viewport overflow pattern: main.ts dropped styles.css or offset the canvas → sandbox fails with rect like 8,8,398,852 on a 390x844 viewport. Fix: full-bleed canvas at 0,0; guard canvas with instanceof HTMLCanvasElement.',
    'Repair TS18047 canvas-null spiral: after getElementById("game-canvas"), narrow with instanceof HTMLCanvasElement before using canvas.width/height.',
    'Dual UI pattern: agent draws order/HUD/end-state on canvas while DOM scaffold also shows the same chrome → overlapping mess. Fix: follow layoutComposition uiAuthority; one layer per zone.',
    'Multi screen-state pattern: PLAYING pantry visible while GAME_OVER overlay and status line also show. Fix: gate renderAll/DOM visibility on screenPhase.',
];

const ROLE_SECTIONS = {
    phase1: ['pipeline', 'agents.spec', 'assetLaw', 'sandboxLaw'],
    foundation: ['pipeline', 'agents.foundation', 'kernel', 'foundationContract', 'compositionLaw', 'assetLaw', 'firstFrame', 'knownFailures'],
    fileAgent: ['pipeline', 'agents.fileAgent', 'kernel', 'foundationContract', 'compositionLaw', 'assetLaw', 'sandboxLaw', 'firstFrame', 'knownFailures'],
    artist: ['pipeline', 'agents.artist', 'assetLaw', 'foundationContract.assetSlots'],
};

function sectionPipeline() {
    return [
        '## GameTok Maker Pipeline',
        ...PIPELINE.phases.map((line, index) => `${index + 1}. ${line}`),
        '',
        'Agent roles:',
        ...Object.entries(PIPELINE.agents).map(([key, value]) => `- ${key}: ${value}`),
    ].join('\n');
}

function sectionKernel() {
    return [
        '## Shared Canvas Kernel (read-only)',
        `Template id: ${KERNEL.templateId}`,
        '',
        'Boot order:',
        ...KERNEL.bootOrder.map((line) => `- ${line}`),
        '',
        'Read-only files (file agent must NOT rewrite):',
        ...KERNEL.readOnlyFiles.map((file) => `- ${file}`),
        '',
        'Runtime globals:',
        ...KERNEL.runtimeGlobals.map((line) => `- ${line}`),
    ].join('\n');
}

function sectionFoundationContract() {
    return [
        '## Foundation Contract (per-job blueprint)',
        FOUNDATION_CONTRACT.purpose,
        '',
        'Fields:',
        ...Object.entries(FOUNDATION_CONTRACT.fields).map(([key, value]) => `- ${key}: ${value}`),
        '',
        'Scaffold assembly:',
        ...FOUNDATION_CONTRACT.scaffoldAssembly.map((line) => `- ${line}`),
    ].join('\n');
}

function sectionAssetLaw() {
    return ['## Asset Law', ...ASSET_LAW.map((line) => `- ${line}`)].join('\n');
}

function sectionSandboxLaw() {
    return ['## Sandbox Law', ...SANDBOX_LAW.map((line) => `- ${line}`)].join('\n');
}

function sectionFirstFrame() {
    return ['## First Frame Law', ...KERNEL.firstFrameLaw.map((line) => `- ${line}`)].join('\n');
}

function sectionKnownFailures() {
    return ['## Known Failure Patterns (avoid these)', ...KNOWN_FAILURES.map((line) => `- ${line}`)].join('\n');
}

function sectionCompositionLaw() {
    return ['## Mobile Composition Law', ...COMPOSITION_LAW.map((line) => `- ${line}`)].join('\n');
}

const SECTION_BUILDERS = {
    pipeline: sectionPipeline,
    kernel: sectionKernel,
    foundationContract: sectionFoundationContract,
    compositionLaw: sectionCompositionLaw,
    assetLaw: sectionAssetLaw,
    sandboxLaw: sectionSandboxLaw,
    firstFrame: sectionFirstFrame,
    knownFailures: sectionKnownFailures,
    'agents.spec': () => `- spec agent: ${PIPELINE.agents.spec}`,
    'agents.foundation': () => `- foundation agent: ${PIPELINE.agents.foundation}`,
    'agents.fileAgent': () => `- file agent: ${PIPELINE.agents.fileAgent}`,
    'agents.artist': () => `- artist: ${PIPELINE.agents.artist}`,
    'foundationContract.assetSlots': () => '- foundation assetSlots drive artist requests and must be consumed in main.ts renderers.',
};

export function formatMakerSystemManual(role = 'full') {
    const key = String(role || 'full').toLowerCase();
    const sections = ROLE_SECTIONS[key] || Object.keys(SECTION_BUILDERS);
    const parts = [
        '# GameTok Maker System Manual',
        'This is the shared operating model for all GameTok native maker agents.',
        '',
    ];
    for (const sectionKey of sections) {
        const builder = SECTION_BUILDERS[sectionKey];
        if (builder) parts.push(builder(), '');
    }
    return parts.join('\n').trim();
}

export function getMakerSystemManualBlock(role = 'full') {
    return [
        '=== GAMETOK MAKER SYSTEM MANUAL (shared memory) ===',
        formatMakerSystemManual(role),
        '=== END SYSTEM MANUAL ===',
    ].join('\n');
}

export function getMakerSystemManualSummary() {
    return {
        version: 1,
        source: 'gametok-maker-system-manual',
        kernelTemplateId: KERNEL.templateId,
        pipelinePhases: PIPELINE.phases.length,
        readOnlyKernelFiles: KERNEL.readOnlyFiles,
        firstFrameLaw: KERNEL.firstFrameLaw,
        assetLawCount: ASSET_LAW.length,
        knownFailurePatterns: KNOWN_FAILURES.length,
    };
}
