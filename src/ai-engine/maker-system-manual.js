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
        fileAgent: 'Implement foundation requiredFunctions and probeMethods. You have CLI access: use run_command for python scripts, npm installs, and scaffolding. Do NOT run blocking commands like npm run dev. Replace stub gameplay with the real loop.',
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
    'HUD: ALWAYS design HIGH-FIDELITY, PREMIUM interfaces. Use CSS/Canvas for segmented health bars (linear-gradient), circular minimaps/radars (arc), angled glassmorphism panels (clip-path, backdrop-filter), and sleek crosshairs. NEVER output bare text.',
    'HUD REQUIREMENT: Emulate AAA sci-fi games. Include glowing gauges, speedometers, dynamic compass lines, or rotating vector dials drawn purely with code. If a 3D game, the HUD must look like an advanced visor or dashboard.',
    'End states: ONE centered uiKit panel (title + 1-2 stat lines + a big Play Again button) — never bare text on a dimmed screen, never stacked headlines.',
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

const THREEJS_GAMEPLAY_LAW = [
    '3D GAMEPLAY MUST FEEL 3D: The player must move FORWARD through the world (or world moves toward player) in the Z-axis. ABSOLUTELY DO NOT restrict the player to a flat 2D plane (strafing only X/Y) while things fly at them. NEVER BUILD A FLAT 2D "GALLERY SHOOTER" (like Space Invaders or classic Asteroids) in a 3D engine unless explicitly asked. The camera must follow the player flying *into* the screen.',
    'CAMERA LAG & LOOK-AHEAD: A third-person chase camera must softly follow the player with slight lag using lerp, and look slightly ahead of the player velocity. Do not hard-lock the camera directly to the player position.',
    'GAME FEEL & JUICE: Implement acceleration, deceleration, and friction. Add camera shake on collisions/hits. Add FOV kick/punch on boost or high speeds.',
    'COLLISION: Use simple distance checks for arcade triggers, but account for 3D bounds (radii or boxes).',
    'PROPORTION & SCALE: The world must feel vast. Scale entities appropriately. Spawn obstacles far ahead in the distance (e.g. Z = -100 to -300) so the player can see them coming, and despawn them when they pass behind the camera.',
];

const SANDBOX_LAW = [
    'Blank canvas = fatal failure.',
    'Canvas must fill the mobile viewport (0,0 to innerWidth/innerHeight). Default body margin or offset canvas = failure.',
    'Keep import "./styles.css" in src/main.ts OR rely on index.html critical layout CSS — never leave the page on browser default margins.',
    'Missing required probe methods = failure.',
    'CONTROLS: for any on-screen joystick / d-pad / action button, use the kernel helpers `import { createJoystick, createButton } from "./input.ts"`. createJoystick returns UP = +y (it un-inverts screen-Y for you) — read stick.x (right+) / stick.y (up+/forward) directly. A joystick where dragging UP/forward moves the player DOWN/backward (raw un-flipped screen dy) is a HARD FAILURE — never hand-roll the pointer math. Do NOT draw a joystick on the canvas with manual hit-detection (it silently breaks); use the helper.',
    'RESTART: the RESULT-screen "Play Again" MUST be a real tappable element (createButton with onTap, or a DOM <button>), wired to resetGame(). A canvas-drawn Play Again with hand-rolled hit-detection is the #1 dead-restart-button bug — it renders but never fires. Verify the button actually calls reset, not just that resetGame() exists.',
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

// Concrete canvas recipes for premium "casual mobile" UI (Royal Match / Toon Blast / Frosting
// Master look). The builder knows WHAT style to aim for from the uiKit; these give it the HOW so
// it stops drawing flat rectangles. Reuse the SAME helpers everywhere → one cohesive design system.
const VISUAL_RECIPES = `Implement these helpers (adapt colors/sizes to the foundation uiKit) and use them for EVERY
panel, button, badge, meter, and end-state. Never draw a bare flat rect or float text on the scene.

\`\`\`ts
// One rounded display font for the whole UI — reads like a shipped mobile game, not dev text.
// ui-rounded maps to SF Pro Rounded on iOS for free; falls back gracefully elsewhere.
var UI_FONT = "ui-rounded, 'Baloo 2', 'Nunito', system-ui, sans-serif";

// PREMIUM TEXT — use for EVERY score, stat, currency, timer, label, headline. Rounded font + dark
// outline + drop shadow (+ optional neon glow). Bare ctx.fillText for UI numbers is the #1 thing
// that makes a game look unfinished — never do that for HUD/score/stat text.
function drawValue(ctx, text, x, y, opts) {
  opts = opts || {};
  var size = opts.size || 26, weight = opts.weight || 800;
  ctx.save();
  ctx.font = weight + ' ' + size + 'px ' + UI_FONT;
  ctx.textAlign = opts.align || 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
  ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = opts.stroke || '#0b1020';
  ctx.strokeText(text, x, y);
  ctx.shadowColor = opts.glow || 'transparent'; ctx.shadowBlur = opts.glow ? 12 : 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = opts.color || '#ffffff'; ctx.fillText(text, x, y);
  ctx.restore();
}

// Raised card with depth — drop shadow + a top highlight so it sits ABOVE the scene, not on it.
// A plain outlined box reads as wireframe/dev UI; the highlight + shadow make it feel tactile.
function drawPanel(ctx, x, y, w, h, opts) {
  opts = opts || {};
  var fill = opts.fill || '#ffffff', border = opts.border || 'rgba(0,0,0,0.10)';
  var radius = opts.radius != null ? opts.radius : 16;
  var shadow = opts.shadow !== false, highlight = opts.highlight !== false;
  ctx.save();
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8; }
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
  if (highlight) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x + 2, y + 2, w - 4, h * 0.5, Math.max(0, radius - 2));
    var g = ctx.createLinearGradient(x, y, x, y + h * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
  }
  ctx.beginPath(); ctx.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius);
  ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke();
}

// Glossy/beveled button: gradient + white top highlight + shadow + stroked label (via drawValue).
function drawButton(ctx, x, y, w, h, label, opts) {
  opts = opts || {};
  var accent = opts.accent || '#ff4d8d', radius = opts.radius != null ? opts.radius : 18, size = opts.size || 20;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
  var grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, lighten(accent, 0.20)); grad.addColorStop(1, accent);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = grad; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(x + 4, y + 3, w - 8, h * 0.42, Math.max(0, radius - 4));
  ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fill();
  drawValue(ctx, label, x + w / 2, y + h / 2, { size: size, color: opts.text || '#ffffff', align: 'center' });
}

// Pill badge for score / coins / wave. Value drawn with drawValue. Returns width to lay them in a row.
function drawBadge(ctx, label, x, y, opts) {
  opts = opts || {};
  var size = opts.size || 18;
  ctx.save(); ctx.font = '800 ' + size + 'px ' + UI_FONT;
  var padX = 16, h = size + 16, w = ctx.measureText(label).width + padX * 2; ctx.restore();
  drawPanel(ctx, x, y, w, h, { fill: opts.fill || 'rgba(8,12,24,0.72)', radius: h / 2, border: 'rgba(255,255,255,0.12)', highlight: false });
  drawValue(ctx, label, x + w / 2, y + h / 2, { size: size, color: opts.text || '#ffffff', align: 'center' });
  return w;
}

// GAMEPLAY TOKEN — round game pieces (bubble, gem, orb, dot, tile). Code-drawn circles look like
// washed-out placeholders; this gives the candy look: saturated radial fill + dark outline + a
// glossy highlight + soft shadow. Use it for every code-rendered game piece, never a flat ctx.arc fill.
function drawToken(ctx, x, y, r, color, opts) {
  opts = opts || {};
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = r * 0.4; ctx.shadowOffsetY = r * 0.18;
  var grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, lighten(color, 0.35)); grad.addColorStop(1, color);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, r * 0.12); ctx.strokeStyle = opts.outline || 'rgba(0,0,0,0.55)'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x - r * 0.32, y - r * 0.36, r * 0.30, r * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
}

// Lighten a #hex toward white by t (0..1) — for the glossy gradient top stop.
function lighten(hex, t) {
  const c = hex.replace('#',''); const n = parseInt(c.length === 3 ? c.replace(/(.)/g,'$1$1') : c.slice(0,6), 16);
  const r=(n>>16)&255,g=(n>>8)&255,b=n&255,mix=(v)=>Math.round(v+(255-v)*t);
  return \`rgb(\${mix(r)},\${mix(g)},\${mix(b)})\`;
}
\`\`\`

TYPOGRAPHY (the #1 premium tell — flat system-font numbers look unfinished):
- Every score, stat, currency, timer, label, and headline is drawn with drawValue — NEVER bare
  ctx.fillText. Numbers must have the rounded font + dark outline + drop shadow.
- For neon/glow kits, pass glow=<uiKit.accent> so the text blooms instead of sitting flat.
- DOM HUD text: font-family: ui-rounded,'Baloo 2',system-ui; font-weight 800; add text-shadow AND
  -webkit-text-stroke (e.g. 1.5px rgba(0,0,0,.55)) on numbers. Panels get a solid/translucent fill +
  box-shadow + an inset top highlight (inset 0 2px 0 rgba(255,255,255,.18)) — not just a 1px border.

MATERIAL (the premium-vs-prototype tell — compare a shipped game to a wireframe):
- Panels/cards are SOLID and OPAQUE with a soft shadow — they look like raised physical cards. Use a
  white/light fill for casual/candy themes, a solid (NOT translucent) dark fill for neon/dark themes.
  NEVER ship see-through outline boxes (e.g. a 1px border over an 80%-alpha fill) — that reads wireframe.
- Content lives IN cards: every selectable/draggable item (topping, ingredient, color swatch, character,
  furniture) sits in its OWN solid rounded card with a thin border — like Frosting Master's topping tray.
  Do not scatter bare icons on the background.
- Buttons are chunky, SOLID, color-coded by action (e.g. green confirm, red cancel) — drawButton, never
  an outline-only button.
- Mode/section switches are pill tabs with a clear selected state (filled + accent border).
- Game pieces (bubbles, gems, dots) use drawToken — saturated, outlined, glossy — never a flat ctx.arc.

COMPOSITION ("solid cards on a themed background" — Royal Match / Frosting Master / Color Bloom):
- Draw the generated scene art in the WORLD zone only (e.g. top ~55%). Behind the control/HUD zones,
  fill a solid or soft-gradient band from the uiKit palette so cards read with high contrast.
- Every interactive element (tray slot, card, button, meter) is a drawPanel() — never a bare sprite
  or text floating directly on the scene.
- END STATES (game over / win): one centered drawPanel() with a drawValue headline, 1-2 stat lines,
  and a big drawButton('Play Again') — SAME kit tokens as gameplay. Never bare text on a dimmed screen.
- DOM HUD variant: solid card backgrounds (opaque, not rgba<1) + box-shadow + inset top highlight +
  border-radius + the rounded font with text-stroke. Match the same kit tokens.`;

const ROLE_SECTIONS = {
    phase1: ['pipeline', 'agents.spec', 'assetLaw', 'sandboxLaw'],
    foundation: ['pipeline', 'agents.foundation', 'kernel', 'foundationContract', 'compositionLaw', 'threejsGameplayLaw', 'visualRecipes', 'assetLaw', 'firstFrame', 'knownFailures'],
    fileAgent: ['pipeline', 'agents.fileAgent', 'kernel', 'foundationContract', 'compositionLaw', 'threejsGameplayLaw', 'visualRecipes', 'assetLaw', 'sandboxLaw', 'firstFrame', 'knownFailures'],
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

function sectionThreeJSGameplayLaw() {
    return ['## 3D Gameplay & Game Feel Law', ...THREEJS_GAMEPLAY_LAW.map((line) => `- ${line}`)].join('\n');
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

function sectionVisualRecipes() {
    return ['## Visual Recipes (premium casual-mobile UI — use these, do not draw flat rects)', VISUAL_RECIPES].join('\n');
}

const SECTION_BUILDERS = {
    pipeline: sectionPipeline,
    kernel: sectionKernel,
    foundationContract: sectionFoundationContract,
    compositionLaw: sectionCompositionLaw,
    threejsGameplayLaw: sectionThreeJSGameplayLaw,
    visualRecipes: sectionVisualRecipes,
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
