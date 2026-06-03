import { getMakerSystemManualBlock } from './maker-system-manual.js';
import { mergeCompositionGuidance } from './maker-composition-guidance.js';
import {
    normalizeHudBlocksForFoundation,
    normalizeHudDesignForFoundation,
    usesKernelHudScaffold,
} from './maker-hud-authority.js';
import {
    inferFoundationStateInitializer,
    isTimedOrderCookingLane,
    mergeLaneRequiredState,
    stripCookingStateLeaksFromSource,
} from './maker-lane-scaffolds.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function slugify(value = '') {
    return String(value || 'game')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'game';
}

export function useDynamicFoundation() {
    return String(process.env.GAMETOK_DYNAMIC_FOUNDATION || 'true').toLowerCase() !== 'false';
}

export function buildFoundationAgentPrompt(qualityIntent = {}, prompt = '') {
    return {
        system: `${getMakerSystemManualBlock('foundation')}

You are the GameTok Foundation Architect for mobile HTML5 canvas games.

Your job is to design the per-game foundation contract that the implementation agent will build on top of the shared runtime kernel described in the system manual above.

The kernel already provides (DO NOT redesign these):
- src/bootstrap.ts loads DreamAssets then imports src/main.ts
- src/assetLoader.ts populates window.DREAM_IMAGES from asset-pack + DREAM_ASSET_PACK
- Vite single-file build, mobile viewport, touch-first controls
- window.__GAMETOK_TEMPLATE_PROBE__ for sandbox verification

You MUST output ONLY raw JSON.

Rules:
- dimension must be "2D" unless explicitly unsupported; we do not ship real 3D yet — if the user wants 3D, set dimension to "3D" and lane to "unsupported_3d".
- Design one polished vertical slice, not an impossible MMO.
- requiredFunctions must be real exported/game-level functions the file agent can implement in src/main.ts.
- probeMethods must include snapshot, step, reset at minimum; add game-specific probe methods when needed.
- firstFrame must guarantee visible background + gameplay subject + HUD/affordance on boot (never a blank canvas).
- assetSlots are the ONLY list the artist agent will generate. Translate Phase 1 visualAssets (player, enemies, items, backgrounds, props) into concrete assetSlots with matching ids when possible.
- Each assetSlot description must be a complete art brief for the artist (subject, pose, framing, isolation rules). Reuse Phase 1 visual asset descriptions when they fit.
- background assetSlot is REQUIRED for every game: vivid portrait environment art (768x1344), scene-specific to the prompt, premium App Store mobile game quality — not abstract color fields.
- assetSlots for ingredients/items must share palette, line weight, and style with the background artDirection.
- Do not rely on Phase 1 visualAssets being generated separately — if the game needs an image, it must appear in assetSlots.
- acceptanceChecks must be testable in a headless sandbox within 10 seconds.
- uiAuthority: pick canvas, dom, or hybrid-zoned — the file agent must NOT duplicate the same HUD/order/end-state on canvas AND DOM.
- screenStateKey + screenStates: define a screen flow (e.g. PLAYING → SHIFT_END → GAME_OVER). Only one screen state may render at a time.
- layoutComposition.zones: describe WHERE each UI zone lives (layer + region + maxElements). You design layout; we do NOT ship fixed HTML templates.
- layoutComposition.layoutRules: concrete composition law for this game (hide pantry on game over, minimal HUD, one end-state headline, etc.).
- hudDesign: one paragraph — what HUD the player needs (which meters/stats, placement, visual style). Phase 2 implements it; only include stats the loop truly needs (competitor bar: Astrocade-style minimal UI).
- hudScaffold: false (default). Set true ONLY to opt into legacy pre-built .hud-chip boxes; normally leave false and hudBlocks [].
- hudBlocks: [] unless hudScaffold true. Do NOT default to Score/Time/Fuel triple chips.
- hudAuthority: "agent" (default) — implement agent owns HUD layout in #hud and/or canvas; match artDirection (pixel borders, corner panels, bars — not generic dev UI).
- antiPatterns must include overlapping UI and duplicate end-state copy when relevant.
- Do not reference Phaser unless you truly need it — default engine is canvas-2d.`,
        user: `USER PROMPT:
${prompt}

PHASE 1 SPEC:
${JSON.stringify(qualityIntent, null, 2)}

Return this JSON shape:
{
  "foundationId": "short_snake_case_id",
  "title": "Game title",
  "lane": "short_snake_case design lane for this game (e.g. timed_order_cooking, projectile_action, endless_runner — not a legacy template folder name)",
  "dimension": "2D | 3D",
  "perspective": "top_down | side_view | arcade | scene",
  "engine": "canvas-2d",
  "initialState": "MENU | PLAYING | PREP",
  "stateFlow": ["PLAYING", "RESULT"],
  "requiredState": ["score", "gameOver"],
  "requiredFunctions": ["stepGame", "resetGame", "renderAll"],
  "probeMethods": [
    { "name": "snapshot", "description": "Return serializable game state" },
    { "name": "step", "description": "Advance simulation ms" },
    { "name": "reset", "description": "Reset round" }
  ],
  "uiAuthority": "canvas | dom | hybrid-zoned",
  "screenStateKey": "screenPhase",
  "screenStates": ["PLAYING", "SHIFT_END", "GAME_OVER"],
  "layoutComposition": {
    "zones": [
      { "id": "world", "purpose": "Background staging", "layer": "canvas", "region": "upper-60%" },
      { "id": "hud", "purpose": "Agent-designed minimal HUD", "layer": "agent", "region": "top-safe", "maxElements": 4 }
    ],
    "layoutRules": ["Only one screen state visible at a time", "HUD minimal and game-specific — no three identical stat pills"]
  },
  "hudDesign": "Describe minimal HUD for this game (stats, meters, corners, style).",
  "hudScaffold": false,
  "hudBlocks": [],
  "hudAuthority": "agent",
  "firstFrame": ["Draw background image", "Draw player", "Show score HUD"],
  "interactionLoops": ["short description of core input loop"],
  "entityBlueprints": [
    { "id": "player", "role": "player", "description": "who the player is" }
  ],
  "controls": ["tap", "drag", "button"],
  "acceptanceChecks": ["testable check"],
  "antiPatterns": ["things to avoid"],
  "implementationNotes": ["concrete guidance for file agent"],
  "assetSlots": [
    {
      "id": "player",
      "role": "player",
      "category": "player",
      "assetType": "sprite",
      "required": true,
      "size": 128,
      "transparent": true,
      "description": "Art brief for artist agent"
    }
  ],
  "statusCopy": "Short hint shown to player on boot"
}

Output ONLY JSON.`,
    };
}

export function normalizeFoundationContract(raw = {}, qualityIntent = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const probeMethods = asArray(source.probeMethods).map((entry, index) => {
        if (typeof entry === 'string') {
            return { name: entry, description: `${entry} probe method` };
        }
        return {
            name: asString(entry?.name, `probe_${index + 1}`),
            description: asString(entry?.description, `${entry?.name || 'probe'} method`),
        };
    });
    const defaultProbes = [
        { name: 'snapshot', description: 'Return serializable game state' },
        { name: 'step', description: 'Advance simulation by milliseconds' },
        { name: 'reset', description: 'Reset round state' },
    ];
    for (const probe of defaultProbes) {
        if (!probeMethods.some((entry) => entry.name === probe.name)) {
            probeMethods.push(probe);
        }
    }

    const requiredFunctions = asArray(source.requiredFunctions).filter(Boolean);
    for (const fn of ['stepGame', 'resetGame', 'renderAll']) {
        if (!requiredFunctions.includes(fn)) requiredFunctions.push(fn);
    }

    const requiredState = asArray(source.requiredState).filter(Boolean);
    for (const key of ['score', 'gameOver', 'width', 'height']) {
        if (!requiredState.includes(key)) requiredState.push(key);
    }

    const assetSlots = asArray(source.assetSlots);
    const entityBlueprints = asArray(source.entityBlueprints);

    const merged = mergeCompositionGuidance(mergeLaneRequiredState({
        version: 1,
        source: 'gametok-foundation-architect',
        foundationId: slugify(source.foundationId || qualityIntent.title || 'dynamic_game'),
        title: asString(source.title, qualityIntent.title || 'GameTok Game'),
        lane: asString(source.lane, 'arcade'),
        dimension: asString(source.dimension, qualityIntent.technicalRequirements?.dimension || '2D').toUpperCase(),
        perspective: asString(source.perspective, qualityIntent.technicalRequirements?.perspective || 'top_down'),
        engine: asString(source.engine, 'canvas-2d'),
        initialState: asString(source.initialState, 'PLAYING'),
        stateFlow: asArray(source.stateFlow).length ? asArray(source.stateFlow) : ['PLAYING', 'RESULT'],
        uiAuthority: asString(source.uiAuthority, ''),
        hudDesign: asString(source.hudDesign, ''),
        hudScaffold: source.hudScaffold === true,
        hudAuthority: asString(source.hudAuthority, 'agent'),
        screenStateKey: asString(source.screenStateKey, 'screenPhase'),
        screenStates: asArray(source.screenStates),
        layoutComposition: source.layoutComposition && typeof source.layoutComposition === 'object'
            ? source.layoutComposition
            : null,
        requiredState,
        requiredFunctions,
        probeMethods,
        hudBlocks: asArray(source.hudBlocks),
        firstFrame: asArray(source.firstFrame).length
            ? asArray(source.firstFrame)
            : ['Draw background', 'Draw player or primary subject', 'Show HUD'],
        interactionLoops: asArray(source.interactionLoops),
        entityBlueprints,
        controls: asArray(source.controls).length ? asArray(source.controls) : ['tap'],
        acceptanceChecks: asArray(source.acceptanceChecks).length
            ? asArray(source.acceptanceChecks)
            : ['Core loop responds to input within 10 seconds'],
        antiPatterns: asArray(source.antiPatterns),
        implementationNotes: asArray(source.implementationNotes),
        assetSlots: assetSlots.length ? assetSlots : buildDefaultAssetSlots(qualityIntent, entityBlueprints),
        statusCopy: asString(source.statusCopy, 'Tap to play!'),
        userIntent: qualityIntent.userIntent || null,
    }));

    return {
        ...merged,
        hudDesign: normalizeHudDesignForFoundation(merged, qualityIntent),
        hudBlocks: normalizeHudBlocksForFoundation(merged, qualityIntent),
        hudScaffold: merged.hudScaffold === true,
    };
}

function buildDefaultAssetSlots(qualityIntent = {}, entityBlueprints = []) {
    const artStyle = [
        qualityIntent.artDirection?.styleName,
        qualityIntent.artDirection?.palette ? `Palette: ${qualityIntent.artDirection.palette}` : '',
    ].filter(Boolean).join('. ');
    const slots = [];
    const rolesSeen = new Set();
    for (const entity of entityBlueprints) {
        const role = asString(entity.role, 'prop');
        if (rolesSeen.has(role)) continue;
        rolesSeen.add(role);
        slots.push({
            id: asString(entity.id, role),
            role,
            category: role,
            assetType: role === 'background' || role === 'environment' ? 'background' : 'sprite',
            required: role === 'player' || role === 'background',
            size: role === 'background' ? undefined : 128,
            width: role === 'background' ? 768 : undefined,
            height: role === 'background' ? 1344 : undefined,
            transparent: role !== 'background' && role !== 'environment',
            description: `${entity.description || role}. ${artStyle}`.trim(),
        });
    }
    if (!rolesSeen.has('player')) {
        slots.unshift({
            id: 'player',
            role: 'player',
            category: 'player',
            assetType: 'sprite',
            required: true,
            size: 128,
            transparent: true,
            description: `Main playable character. ${artStyle}`.trim(),
        });
    }
    if (!rolesSeen.has('background') && !rolesSeen.has('environment')) {
        slots.push({
            id: 'background1',
            role: 'background',
            category: 'environment',
            assetType: 'background',
            required: true,
            width: 768,
            height: 1344,
            transparent: false,
            description: `Portrait mobile gameplay environment for this game world — layered scenery, rich color, premium shipped mobile game quality, scenery only, no HUD or characters. ${artStyle}`.trim(),
        });
    }
    return slots;
}

export function assertFoundationSupported(foundation = {}) {
    const dimension = String(foundation.dimension || '2D').toUpperCase();
    const lane = String(foundation.lane || '').toLowerCase();
    if (dimension === '3D' || lane === 'unsupported_3d') {
        throw new Error('3D game generation is not supported yet. Try a 2D version of your idea for now.');
    }
    if (!asArray(foundation.requiredFunctions).includes('renderAll')) {
        throw new Error('Foundation contract missing renderAll() — first frame would be blank.');
    }
    return true;
}

export function buildMakerTemplateContractFromFoundation(foundation = {}, qualityIntent = {}) {
    const common = {
        viewport: {
            targetWidth: 390,
            targetHeight: 844,
            chromeSafeTop: 112,
            chromeSafeBottom: 48,
            rule: 'Compute safe bounds from innerWidth/innerHeight and keep gameplay, HUD, and controls visible inside them.',
        },
        files: ['index.html', 'src/styles.css', 'src/main.ts'],
        hardRules: [
            'No external navigation, popups, forms, or remote dependencies.',
            'HUD, labels, meters, buttons, and text are code-rendered.',
            'Images are used for world art, sprites, props, items, and backgrounds only.',
            'The first frame must show the game world, primary actor, key goal/threat, and usable controls or affordances.',
            'All mutable game state resets cleanly on restart or round transition.',
            `Screen flow via state.${foundation.screenStateKey || 'screenPhase'} — only one screen state visible at a time.`,
            'Do not duplicate HUD, order UI, or end-state on canvas AND DOM.',
            ...(foundation.layoutComposition?.layoutRules || []).slice(0, 4),
        ],
        dreamAssets: [
            'Use window.DREAM_IMAGES, DREAM_ASSET_PACK keys, or getAssetImage(key) helpers.',
            'Never paste generated data URLs into source files; reference runtime keys.',
        ],
    };

    const probeApi = asArray(foundation.probeMethods).map(
        (probe) => `window.__GAMETOK_TEMPLATE_PROBE__.${probe.name}`,
    );

    return {
        version: 1,
        source: 'gametok-dynamic-foundation',
        templateId: 'canvas-kernel',
        engine: foundation.engine || 'canvas-2d',
        archetype: foundation.lane || 'dynamic',
        recommendedLibrary: 'Canvas 2D on shared GameTok kernel (bootstrap + assetLoader).',
        architecture: [
            'Foundation architect designed this job-specific loop and probe contract.',
            'src/bootstrap.ts and src/assetLoader.ts are kernel-owned and read-only.',
            'src/main.ts implements requiredFunctions and first-frame guarantees.',
            foundation.interactionLoops?.[0] || 'Touch-first mobile loop with visible feedback.',
        ],
        requiredState: foundation.requiredState,
        requiredFunctions: foundation.requiredFunctions,
        requiredProbeApi: probeApi,
        controls: foundation.controls,
        firstFrame: foundation.firstFrame,
        acceptanceChecks: foundation.acceptanceChecks,
        antiPatterns: foundation.antiPatterns,
        foundation,
        classification: {
            version: 3,
            source: 'gametok-foundation-architect',
            selectedTemplateId: 'canvas-kernel',
            selectedArchetype: foundation.lane || 'dynamic',
            confidence: 0.95,
            physicsProfile: {
                dimension: foundation.dimension || '2D',
                perspective: foundation.perspective || 'top_down',
                physics: foundation.lane || 'dynamic',
            },
            reasoning: `Foundation architect designed a ${foundation.lane || 'dynamic'} loop for "${foundation.title}".`,
        },
        common,
        implementationNotes: foundation.implementationNotes,
    };
}

function artStyleText(qualityIntent = {}) {
    return [
        qualityIntent.artDirection?.styleName ? `Art style: ${qualityIntent.artDirection.styleName}.` : '',
        qualityIntent.artDirection?.palette ? `Palette: ${qualityIntent.artDirection.palette}.` : '',
    ].filter(Boolean).join(' ');
}

function isSceneryAssetSlot(slot = {}) {
    const role = String(slot.role || slot.category || '').toLowerCase();
    const category = String(slot.category || slot.role || '').toLowerCase();
    return slot.assetType === 'background'
        || role === 'background'
        || role === 'environment'
        || category === 'environment';
}

function normalizeSceneryAssetSlot(slot = {}) {
    if (!isSceneryAssetSlot(slot)) {
        return {
            ...slot,
            role: slot.role || slot.category || 'prop',
            category: slot.category || slot.role || 'prop',
        };
    }
    return {
        ...slot,
        role: 'background',
        category: 'environment',
        assetType: slot.assetType || 'background',
    };
}

export function buildMakerAssetContractFromFoundation(foundation = {}, qualityIntent = {}) {
    const slots = [];
    let scenerySlotSeen = false;
    for (const rawSlot of asArray(foundation.assetSlots)) {
        const slot = normalizeSceneryAssetSlot(rawSlot);
        if (slot.role === 'background') {
            if (scenerySlotSeen) continue;
            scenerySlotSeen = true;
        }
        slots.push({
            id: slot.id,
            required: Boolean(slot.required),
            assetType: slot.assetType || 'sprite',
            role: slot.role || slot.category || 'prop',
            category: slot.category || slot.role || 'prop',
            size: slot.size || undefined,
            width: slot.width || undefined,
            height: slot.height || undefined,
            transparent: slot.transparent !== false,
            description: `${slot.description || slot.role}. ${artStyleText(qualityIntent)}`.trim(),
            consumedBy: slot.consumedBy || `renderer via getAssetImage('${slot.id}') or role ${slot.role}`,
            fallback: slot.fallback || 'code-rendered shape',
        });
    }

    return {
        version: 1,
        templateId: 'canvas-kernel',
        sourceOfTruth: 'foundation architect assetSlots + DreamAssets runtime',
        hardRules: [
            'HUD, text, controls, meters, and readable UI are code-rendered only.',
            'Generated images are gameplay/world visuals only.',
            'Gameplay geometry and hitboxes remain code-defined.',
        ],
        slots,
    };
}

export function buildIndexHtmlFromFoundation(foundation = {}) {
    const title = asString(foundation.title, 'GameTok Game');
    const hudIdsSeen = new Set();
    const hudBlocks = asArray(foundation.hudBlocks).filter((block) => {
        const id = slugify(block);
        if (hudIdsSeen.has(id)) return false;
        hudIdsSeen.add(id);
        return true;
    });
    const useScaffold = usesKernelHudScaffold(foundation) && hudBlocks.length > 0;
    const hudInner = useScaffold
        ? hudBlocks.map((block) => {
            const id = slugify(block);
            return `      <div class="hud-chip hud-${id}">
        <span>${block}</span>
        <strong id="${id}-value">0</strong>
      </div>`;
        }).join('\n')
        : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${title}</title>
  <style>
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100%;
      height: 100%;
      overflow: hidden !important;
    }
    #game-shell {
      position: fixed;
      inset: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    #game-canvas {
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      display: block;
    }
  </style>
</head>
<body>
  <main id="game-shell" aria-label="${title}">
    <canvas id="game-canvas"></canvas>
    <div id="hud" data-hud aria-live="polite">
${hudInner}
    </div>
    <div id="controls-layer" data-controls></div>
    <div id="status-line" role="status">${asString(foundation.statusCopy, 'Tap to play!')}</div>
  </main>
  <script type="module" src="/src/bootstrap.ts"></script>
</body>
</html>
`;
}

function jsString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

export function buildMainTsStubFromFoundation(foundation = {}, qualityIntent = {}) {
    const cookingLane = isTimedOrderCookingLane(foundation);
    const title = asString(foundation.title, qualityIntent.title || 'GameTok Game');
    const hudBlocks = asArray(foundation.hudBlocks);
    const useHudScaffold = usesKernelHudScaffold(foundation) && hudBlocks.length > 0;
    const hudIdsSeen = new Set(['score']);
    const hudRefs = useHudScaffold ? hudBlocks
        .map((block) => slugify(block))
        .filter((id) => {
            if (hudIdsSeen.has(id)) return false;
            hudIdsSeen.add(id);
            return true;
        })
        .map((id) => `  ${id}: document.getElementById('${id}-value'),`)
        .join('\n') : '';
    const stateKeys = [...new Set(asArray(foundation.requiredState).filter((key) => !['width', 'height'].includes(key)))];
    const coveredStateKeys = new Set(stateKeys);
    const stateInit = stateKeys.map((key) => {
        if (key === 'score' || key.endsWith('Count')) return `  ${key}: 0,`;
        if (key === 'combo' || key === 'comboMultiplier') return `  ${key}: 1,`;
        if (key === 'timeLeft' || key === 'orderTimeLeft' || key === 'dayTimer' || key === 'time') return `  ${key}: 120,`;
        if (key === 'gameOver' || key.startsWith('is')) return `  ${key}: false,`;
        if (key.endsWith('[]')) return `  ${key}: [],`;
        const laneInit = inferFoundationStateInitializer(key, foundation);
        return `  ${key}: ${laneInit},`;
    }).join('\n');
    const hudStateInit = useHudScaffold ? hudBlocks
        .map((block) => slugify(block))
        .filter((id, index, ids) => id !== 'score' && !coveredStateKeys.has(id) && ids.indexOf(id) === index)
        .map((id) => {
            coveredStateKeys.add(id);
            if (id.includes('time')) return `  ${id}: 120,`;
            if (id.includes('combo')) return `  ${id}: 1,`;
            return `  ${id}: 0,`;
        })
        .join('\n') : '';
    const combinedStateInit = [stateInit, hudStateInit].filter(Boolean).join('\n');

    const probeMethods = asArray(foundation.probeMethods);
    const extraProbeLines = probeMethods
        .filter((probe) => !['snapshot', 'step', 'reset', 'placeIngredient', 'triggerCooking', 'serveOrder', 'spawnCustomer'].includes(probe.name))
        .map((probe) => `  ${probe.name}(...args) {
    // Foundation probe stub — Phase 2 agent implements ${probe.name}(): ${probe.description || probe.name}
    return null;
  },`)
        .join('\n');
    const implNotes = asArray(foundation.implementationNotes).slice(0, 8)
        .map((note) => `// ${note}`)
        .join('\n');

    const stubBody = `// @ts-nocheck
// GameTok dynamic foundation stub — Phase 2 file agent: implement the full game loop below.
// Foundation: ${foundation.foundationId || 'dynamic'} (${foundation.lane || 'arcade'})
// Phase 2 owns full layout (index.html, styles.css, main.ts) — follow layoutComposition in foundation contract.
${implNotes}
import './styles.css';

const canvasEl = document.getElementById('game-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game-canvas element');
}
const canvas = canvasEl;
const ctxOrNull = canvas.getContext('2d');
if (!ctxOrNull) {
  throw new Error('Could not acquire 2D canvas context');
}
const ctx = ctxOrNull;
const statusLine = document.getElementById('status-line');
const hudMount = document.getElementById('hud');
${useHudScaffold ? `const hud = {
  score: document.getElementById('score-value'),
${hudRefs}
};` : '// Phase 2: design minimal game-specific HUD in #hud and/or canvas (see foundation hudDesign).'}

const GAME_THEME = {
  title: ${jsString(title)},
  backgroundA: '#0f172a',
  backgroundB: '#1e293b',
  accent: '#38bdf8',
  danger: '#fb7185',
};

const state = {
  width: 390,
  height: 844,
${combinedStateInit}
  lastTick: performance.now(),
  started: false,
};

function resizeCanvas() {
  state.width = window.innerWidth || 390;
  state.height = window.innerHeight || 844;
  canvas.width = state.width;
  canvas.height = state.height;
}

function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

function resolveBackgroundImage() {
  const candidates = ['background1', 'background', 'environment', 'toybox_background'];
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  for (const asset of pack) {
    const role = String(asset?.role || asset?.category || '').toLowerCase();
    const type = String(asset?.type || '').toLowerCase();
    if (type === 'background' || role === 'background' || role === 'environment') {
      candidates.push(asset.key || asset.id || asset.runtimeKey);
    }
  }
  const seen = new Set();
  for (const key of candidates) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const img = getAssetImage(key);
    if (img) return img;
  }
  return null;
}

function drawBackground() {
  const bg = resolveBackgroundImage();
  if (bg) {
    const scale = Math.max(state.width / bg.naturalWidth, state.height / bg.naturalHeight);
    const w = bg.naturalWidth * scale;
    const h = bg.naturalHeight * scale;
    ctx.drawImage(bg, (state.width - w) / 2, (state.height - h) / 2, w, h);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, GAME_THEME.backgroundA);
  gradient.addColorStop(1, GAME_THEME.backgroundB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawPlayerFallback(x, y, size) {
  ctx.fillStyle = GAME_THEME.accent;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const img = getAssetImage('player') || getAssetImage('player1');
  const x = state.width * 0.5;
  const y = state.height * 0.62;
  const size = Math.min(state.width, state.height) * 0.16;
  if (img) {
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    return;
  }
  drawPlayerFallback(x, y, size);
}

${useHudScaffold ? `function syncHud() {
  if (hud.score) hud.score.textContent = String(state.score ?? 0);
  ${hudBlocks.filter((b) => slugify(b) !== 'score').map((block) => {
        const id = slugify(block);
        return `if (hud.${id}) hud.${id}.textContent = String(state.${id} ?? 0);`;
    }).join('\n  ')}
}

function drawHud() {
  syncHud();
}` : `function drawHud() {
  // TODO Phase 2: implement minimal HUD per foundation hudDesign (fuel bar top-left, distance top-right, etc.)
}`}

export function renderAll() {
  ctx.clearRect(0, 0, state.width, state.height);
  drawBackground();
  drawPlayer();
  drawHud();
  if (statusLine && !state.started) {
    statusLine.textContent = ${jsString(foundation.statusCopy || 'Tap to play!')};
  }
}

export function stepGame(dt = 16) {
  if (state.gameOver) return;
  state.started = true;
  // TODO: Phase 2 agent implements ${foundation.lane || 'core'} loop here.
}

export function resetGame() {
  state.score = 0;
  state.gameOver = false;
  state.started = false;
  state.lastTick = performance.now();
${cookingLane ? `  if (Array.isArray(state.cauldronSlots)) state.cauldronSlots = [null, null, null];
  if (Array.isArray(state.pantry)) state.pantry.length = 0;
` : ''}  renderAll();
}

function gameLoop(now) {
  const dt = Math.min(32, now - state.lastTick);
  state.lastTick = now;
  stepGame(dt);
  renderAll();
  requestAnimationFrame(gameLoop);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  snapshot() {
    return JSON.parse(JSON.stringify({
      score: state.score,
      gameOver: state.gameOver,
      started: state.started,
      lane: ${jsString(foundation.lane || 'dynamic')},
    }));
  },
  step(ms = 16) {
    stepGame(ms);
    renderAll();
    return this.snapshot();
  },
  reset() {
    resetGame();
    return this.snapshot();
  },
${extraProbeLines ? `${extraProbeLines}\n` : ''}};

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('pointerdown', () => {
  state.started = true;
  if (statusLine) statusLine.textContent = 'Playing!';
});
renderAll();
requestAnimationFrame(gameLoop);
`;
    return stripCookingStateLeaksFromSource(stubBody, foundation).content;
}

export function buildFoundationDebugChecks(foundation = {}) {
    return asArray(foundation.acceptanceChecks).slice(0, 6).map((check, index) => ({
        id: `foundation_check_${String(index + 1).padStart(2, '0')}`,
        severity: index === 0 ? 'fatal' : 'major',
        check,
        repair: asArray(foundation.implementationNotes)[0]
            || 'Implement the foundation acceptance check in src/main.ts with visible gameplay feedback.',
    }));
}
