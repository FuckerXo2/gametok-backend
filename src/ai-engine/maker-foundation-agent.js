import { getMakerSystemManualBlock } from './maker-system-manual.js';
import { mergeCompositionGuidance } from './maker-composition-guidance.js';
import {
    normalizeHudBlocksForFoundation,
    normalizeHudDesignForFoundation,
    usesKernelHudScaffold,
} from './maker-hud-authority.js';
import { stripCookingStateLeaksFromSource } from './maker-foundation-safety.js';

function inferFoundationStateInitializer(key = '', foundation = {}) {
    if (key === 'screenPhase' || key === 'screenState') return "'PLAYING'";
    if (key === 'pantry' || key === 'particles' || key === 'customers' || key === 'ingredients') return '[]';
    if (key === 'cauldronSlots' || key === 'slots') return '[null, null, null]';
    if (key === 'drag') return 'null';
    if (key === 'activeOrder' || key === 'currentCustomer') return 'null';
    if (key === 'customerExpression' || key === 'customerType' || key === 'cookFeedback') return "''";
    if (key === 'gameOver' || key.startsWith('is')) return 'false';
    if (key === 'combo' || key === 'comboMultiplier') return '1';
    if (key === 'score' || key.endsWith('Count')) return '0';
    if (/Flash|Cooldown|Timer|Patience|shift|order|bubble|time|Time|Remaining|Duration/i.test(key)) return '0';
    if (key.endsWith('[]')) return '[]';
    return 'null';
}

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

// 2D FLUX gate: when ON (default), 2D foundations get EMPTY assetSlots — exactly like 3D — so the AI
// image artist never runs. The game uses real Phaser sprites (materialized via the phaser2dBlock path)
// and code-drawn primitives as fallback, never FLUX. Flip GAMETOK_2D_KENNEY_ONLY=false to restore
// FLUX sprite-gen for 2D (e.g. if Phaser coverage is insufficient for a genre).
export function use2dAssetsOnly() {
    return String(process.env.GAMETOK_2D_ASSETS_ONLY || 'true').toLowerCase() !== 'false';
}

export function buildFoundationAgentPrompt(qualityIntent = {}, prompt = '') {
    // If Phase 1 already determined this is 3D, that decision is binding — the foundation may
    // UPGRADE 2D→3D but must never DOWNGRADE 3D→2D (line-63 rule). Enforce it as a hard mandate
    // so a "space shooter / survive waves" prior can't flip a third-person 3D game to a 2D shmup.
    const phase1Dimension = String(qualityIntent?.technicalRequirements?.dimension || '').toUpperCase();
    const phase1Perspective = String(qualityIntent?.technicalRequirements?.perspective || 'third_person').toLowerCase().replace(/\s+/g, '_');
    const mustBe3D = phase1Dimension === '3D';
    // Kenney-only 2D: the foundation gets EMPTY assetSlots (line ~322) because real Kenney sprites are
    // selected AFTER the foundation, in Phase 2. So the FLUX-era "design a painted background image"
    // guidance is a dangling pointer — there is no background image, and top-down has no Phaser backdrop.
    // Swap in tile-the-ground / scatter-props guidance so the foundation stops instructing the blind
    // builder to draw an asset that will never exist.
    const phaser2d = !mustBe3D && use2dAssetsOnly();
    const asset2dBlock = phaser2d
        ? `- ASSETS: this 2D game is built from REAL Phaser sprite art (player, enemies, items, ground tiles, props, decorative background pieces) auto-selected from a themed pack AFTER this foundation. You do NOT design assetSlots — leave "assetSlots": [] (the artist agent does not run). Do NOT invent art briefs or reference a single painted portrait background image (there is none).
- THE WORLD MUST NOT BE A FLAT EMPTY VOID (that is what makes a game look unfinished next to competitors) — but HOW you fill it depends on the camera, so pick the right one:
  * TOP-DOWN / OVERHEAD (arena shooters, dungeons, .io games): TILE THE FLOOR. The builder calls tileGround(ctx, w, h) to fill the whole play area with the pack's seamless \`tiles\`, then scatterProps(ctx, ...) to dress it with ~6-12 static props (crates/barrels/debris). firstFrame: tiled floor → props → player → enemies → HUD.
  * SIDE-SCROLLER / PLATFORMER: do NOT tile a full-screen floor. Draw a SKY (a code gradient sky is CORRECT and good here, not a failure), then a sparse FAR PARALLAX layer from the \`background\` pieces (clouds/hills — via drawParallax(), a few big pieces, NEVER tiled edge-to-edge), then build platforms/ground from platform/tile sprites, then entities, then HUD.
  * BOARD / PUZZLE / CARD / MENU-STYLE (match-3, solitaire, trays): neither — a clean themed uiKit background band + the board/tray art is correct; do not force ground tiles.
- NEVER tile the decorative \`background\` pieces across the screen — they are horizon scenery, not a seamless surface (tiling them looks broken). Ground tiling is ONLY for the \`tiles\` floor role.
- Describe the chosen approach concretely in firstFrame/layoutComposition (e.g. top-down: "tile floor, scatter 8 props"; platformer: "gradient dusk sky, 3 parallax hills, tiled grass platforms").`
        : `- assetSlots are the ONLY list the artist agent will generate. Translate Phase 1 visualAssets (player, enemies, items, backgrounds, props) into concrete assetSlots with matching ids when possible.
- Each assetSlot description must be a complete art brief for the artist (subject, pose, framing, isolation rules). Reuse Phase 1 visual asset descriptions when they fit.
- background assetSlot is REQUIRED for every 2D game: vivid portrait environment art (768x1344), scene-specific to the prompt, premium App Store mobile game quality — not abstract color fields. (3D games skip this — their sky/ground are code-colored.)
- assetSlots for ingredients/items must share palette, line weight, and style with the background artDirection.
- Do not rely on Phase 1 visualAssets being generated separately — if the game needs an image, it must appear in assetSlots.`;
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
- dimension: default to the Phase 1 spec's dimension, but OVERRIDE Phase 1 to "3D" when the idea is clearly a 3D-genre fantasy that Phase 1 mislabeled 2D. Set "3D" if Phase 1 says 3D OR the idea is any of: behind-the-character runner/chaser (Subway Surfers/Temple Run), driving/racing/DRIFTING/kart/motorcycle, board/ski/skate/surf/sled/downhill sports-motion, first-person anything, voxel/Minecraft-style, or flight/space-with-depth. These are 3D third-person/first-person experiences even when the prompt never says "3D" (a "neon drift through midnight streets" game is 3D, not top-down). For 3D set engine "threejs" and a 3D lane: "threejs_world" (general), "voxel_world" (blocky/Minecraft-style), "threejs_runner" (behind-character runner / driver / drifter / boarder), or "threejs_first_person". Do NOT downgrade a 3D-genre idea to 2D. Only genuinely flat ideas (top-down/side-view, match/puzzle/grid, platformer, card/board, or anything the user explicitly asked to be flat/retro/top-down) stay 2D.
- For 3D foundations also set cameraRig: "first_person" | "third_person_chase" | "orbit" | "fixed_angle". Geometry is CODE-BUILT (boxes, planes, instanced voxel fields) — never request 3D models as assets.
- CRITICAL 3D GAMEPLAY TRANSLATION: If Phase 1 describes a flat 2D top-down "gallery shooter" (e.g. "asteroids spawn from edges", "fly up and down on screen"), you MUST rewrite interactionLoops to be a TRUE 3D EXPERIENCE. The player must fly FORWARD into the distance, and obstacles must spawn far away on the Z-axis (e.g. Z = -200) and rush toward the player. Never instruct the builder to spawn things from the "edges of the screen" in a 3D game.
- 3D foundations use FLAT-COLORED code geometry only (Crossy Road style): every surface is a hex color on a box/plane/voxel, distinguished by color + shape. Leave "assetSlots" EMPTY for 3D — no textures, no skyboxes, no billboards, no background art. The artist agent does not run for 3D. Define the look through the "palette" in artDirection instead. (Audio/BGM still applies.)
- 3D scope guard: one compact polished world (a small voxel island, one track loop, one arena) — never an open world. Keep entity counts phone-friendly.
- Design one polished vertical slice, not an impossible MMO.
- requiredFunctions must be real exported/game-level functions the file agent can implement in src/main.ts.
- probeMethods must include snapshot, step, reset at minimum; add game-specific probe methods when needed.
- firstFrame must guarantee visible background + gameplay subject + HUD/affordance on boot (never a blank canvas).
${asset2dBlock}
- acceptanceChecks must be testable in a headless sandbox within 10 seconds.
- uiAuthority: pick canvas, dom, or hybrid-zoned — the file agent must NOT duplicate the same HUD/order/end-state on canvas AND DOM.
- screenStateKey + screenStates: define a screen flow (e.g. PLAYING → SHIFT_END → GAME_OVER). Only one screen state may render at a time.
- layoutComposition.zones: describe WHERE each UI zone lives (layer + region). You design layout; we do NOT ship fixed HTML templates.
- layoutComposition.layoutRules: concrete composition law for THIS game (one end-state headline, hide gameplay chrome on game over, etc.). Genre-neutral — never reference another genre's widgets.
- uiKit: REQUIRED. Define the per-game design system the builder applies to EVERY panel/button/meter/card so the UI feels like one shipped product. styleFamily is derived from THIS game's theme (e.g. casual-candy for a cooking game, retro-pixel for an arcade racer, gritty-military for a shooter, clean-minimal for a puzzle — or invent one that fits). palette/radius/panelStyle/buttonStyle/font are concrete tokens the builder reuses everywhere. This is how we match competitor (Astrocade) polish: one cohesive kit, themed to the game — NOT a generic template, NOT bare text on the background.
- hudDesign: describe the COMPLETE HUD this game's loop genuinely needs — every meter/stat/indicator it actually uses (a shooter: ammo, health, wave/threat; a builder: resource trays, mode tabs; a runner: distance, fuel). Rich where the game is rich, lean where it is lean. HUD STYLE IS GENRE-DEPENDENT — do not box everything by default:
  * ACTION / ARCADE / RUNNER / RACER / SHOOTER / SCORE-CHASE games: use a CLEAN INTEGRATED overlay HUD — big bold glowing or outlined numbers sitting directly in the screen corners, lives as a row of icons/hearts/pips, meters as thin bars. NO boxed chips, NO bordered panels behind individual stats, and NEVER three identical bordered chips in a row (that reads as generic dev UI — premium arcade games use bare themed text, not boxes). Think the clean glowing score of a synthwave runner, not a settings menu.
  * CONTENT-HEAVY CASUAL games (cooking, puzzle, builder, card/tray) where stats sit over busy scene art and need contrast: THEN ground elements on uiKit panels/frames for readability.
  Match the uiKit styleFamily and palette either way (glow, outline, font), never another genre's UI shape.
- backgroundZoning: for content-heavy games (cooking, puzzle, builder, card/tray games) the scene art belongs in a WORLD zone (e.g. top ~55%); behind the control/HUD zones the builder fills a solid or soft-gradient band from the uiKit palette so cards/buttons read with high contrast. Describe this split in layoutComposition.zones (world zone = scene image, control zone = solid uiKit band). Action/arcade games may use full-bleed scene — but interactive UI still sits on uiKit panels.
- endState: every game-over / win screen is ONE centered uiKit panel (bold title + 1-2 stat lines + a big themed Play Again button) — never bare text on a dimmed background. Put this in layoutComposition.layoutRules.
- payoff (CRITICAL — this is what separates a finished game from a toy): design ONE satisfying judged RESULT the player works toward — a scored / graded / %-rated / star-rated outcome, a verdict, or a reveal — NOT an open-ended loop with no end. The top viral mobile micro-games all build to a celebrated payoff: the action is judged, a RESULT card shows a number/grade, and it lands with juice + a success sound. Put a RESULT state in stateFlow and describe it in layoutComposition.layoutRules (centered uiKit result card showing the judged outcome + Play Again, celebrated with a pop/scale/confetti + success sound). Even relaxing/creative games MUST surface a result (a star rating, a "you made X", a happiness/coziness score) — give the player a payoff moment, never an endless loop with no verdict.
- mechanicalFeel (CRITICAL — a game can be visually polished and still feel DEAD): specify how the core interaction should FEEL, not just what it does. Your other directives cover VISUAL polish (uiKit, HUD, payoff); this covers GAME feel — the thing that separates a toy from a game people replay. Controls must be responsive and weighted to the genre: arcade/action/racer games feel INSTANT, snappy, drift-friendly, forgiving on recovery — NEVER a slow floaty sim; a puzzle can be deliberate. Describe movement (acceleration/friction/turning), impact feedback (knockback, hit-stop/freeze-frame, screen shake, particle burst on hit/score/death), and the numeric params the builder must TUNE (gravity, friction, restitution, damping, speed caps, impulse) until it plays FUN not realistic. Set a one-line feel quality bar. Physics-driven games (racer, ball sports, pinball, ragdoll, launch/fling) MUST use the kernel physics engine (cannon-es) — hand-rolled motion feels wrong for them.
- hook: the title/premise is the product — the on-screen framing/copy must be a HOOK that makes someone want to tap (e.g. "The Cursed Dentist", "World's Hardest Button", "Slice the pizza EVENLY"), not a flat literal description. Carry the hook into statusCopy and the result card wording.
- onboarding: the boot hint / "how to play" text must NEVER overlap an interactive zone (ingredient bins, buttons, controls) and must auto-dismiss on the player's first input. Place it in a clear non-interactive area (e.g. center of the world zone) and hide it once play starts. Put this in layoutComposition.layoutRules.
- hudScaffold: false (default). Set true ONLY to opt into legacy pre-built .hud-chip boxes; normally leave false and hudBlocks [].
- hudBlocks: [] unless hudScaffold true.
- hudAuthority: "agent" (default) — implement agent owns HUD layout in #hud and/or canvas, styled with the uiKit palette/font/glow. For action/arcade/runner/score-chase games this is a CLEAN INTEGRATED overlay (corner glowing numbers, icon lives) — NOT boxed chips. For content-heavy casual games it may be grounded uiKit panels. Either way: themed, never generic dev UI, and never three identical bordered stat boxes.
- antiPatterns must include overlapping UI and duplicate end-state copy when relevant.
- Do not reference Phaser unless you truly need it — default engine is canvas-2d.`,
        user: `${mustBe3D ? `MANDATORY — Phase 1 classified this game as 3D (${phase1Perspective}). This is BINDING: you MUST output a 3D foundation — "dimension":"3D", "engine":"threejs", a 3D "lane" (threejs_world | voxel_world | threejs_runner | threejs_first_person), a "cameraRig", and EMPTY "assetSlots". Do NOT output "canvas-2d" or any 2D/flat lane (no *_vertical, top_down, side_view, arcade-flat). "space shooter", "survive waves", "shmup" etc. are still 3D here because Phase 1 said so — downgrading to 2D is a hard failure.

DEPTH MANDATE (equally binding): a 3D play space MUST use the DEPTH axis. interactionLoops must describe obstacles / enemies / targets spawning deep on the -Z axis (e.g. z = -120) and rushing toward the camera, growing as they approach. The player may STRAFE on the X/Y screen plane, but the WORLD travels in depth. Edge-spawning — "asteroids come from the screen edges", "fly up/down and shoot up the screen", any +Y-only screen-plane loop — is the flat 1979-arcade reflex and a HARD FAILURE. If Phase 1 describes such a flat loop, you MUST rewrite interactionLoops into a forward-flight / approach-the-camera depth experience.

` : ''}USER PROMPT:
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
  "engine": "canvas-2d | threejs",
  "cameraRig": "(3D only) first_person | third_person_chase | orbit | fixed_angle",
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
      { "id": "world", "purpose": "Scene image — gameplay subject", "layer": "canvas", "region": "top-55%" },
      { "id": "controls", "purpose": "Solid uiKit band behind trays/buttons for contrast", "layer": "canvas", "region": "bottom-45%" },
      { "id": "hud", "purpose": "Game-specific HUD on grounded uiKit badges", "layer": "agent", "region": "top-safe" }
    ],
    "layoutRules": [
      "Only one screen state visible at a time",
      "Scene art in the world zone; fill the control zone with a solid/gradient uiKit band so cards read",
      "Every interactive element sits on a uiKit panel — nothing floats bare over the background",
      "End state: one centered uiKit panel (title + stats + big Play Again button), never bare text on a dim screen",
      "Onboarding hint sits in a non-interactive area and auto-dismisses on first input — never covers controls"
    ]
  },
  "uiKit": {
    "styleFamily": "theme-matched label for THIS game (casual-candy | retro-pixel | gritty-military | clean-minimal | storybook | invent one)",
    "palette": { "panel": "SOLID opaque card color — white #ffffff for casual/candy, or a solid dark like #1f2937 for neon/dark games (NO alpha/transparency)", "panelBorder": "#38bdf8", "accent": "#38bdf8", "textPrimary": "#ffffff", "textMuted": "#94a3b8" },
    "radius": 16,
    "panelStyle": "solid | beveled (default solid — opaque cards with a soft shadow, NOT see-through outline boxes)",
    "buttonStyle": "filled-rounded | pill | beveled | pixel",
    "font": "rounded-bold | pixel | system-bold | serif",
    "decor": "subtle theme flourish (confetti, sparkles, gradient), or none"
  },
  "hudDesign": "Describe the COMPLETE HUD this game's loop needs (every meter/stat/indicator it uses), each grounded on a uiKit panel, styled to the uiKit styleFamily.",
  "hudScaffold": false,
  "hudBlocks": [],
  "hudAuthority": "agent",
  "firstFrame": [${phaser2d ? '"Fill the world (top-down: tile floor + props; side-scroller: sky + parallax + platforms)", "Draw player", "Show score HUD"' : '"Draw background image", "Draw player", "Show score HUD"'}],
  "interactionLoops": ["short description of core input loop"],
  "entityBlueprints": [
    { "id": "player", "role": "player", "description": "who the player is" }
  ],
  "controls": ["tap", "drag", "button"],
  "mechanicalFeel": {
    "responsiveness": "how snappy/weighted the core control feels for THIS genre (arcade-instant | deliberate | floaty)",
    "movement": "acceleration / friction / turn feel — e.g. 'strong acceleration, drift-friendly turning, stable recovery, no uncontrolled spin'",
    "impact": "feedback on key moments — knockback, hit-stop/freeze frames, screen shake, particle burst on hit/score/death",
    "tuning": "the numeric params the builder must TUNE until it plays FUN not realistic (gravity, friction, restitution, damping, speed caps, impulse)",
    "qualityBar": "one line: what 'feels good' means for THIS game — a technically-complete but boring demo is NOT acceptable"
  },
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

// 'solid' first/default: premium casual UI (Royal Match, Frosting Master) uses SOLID opaque cards
// with a soft shadow, not see-through outline boxes. Translucent kept only as an explicit opt-in.
const UI_KIT_PANEL_STYLES = ['solid', 'beveled', 'translucent-dark', 'translucent-light'];
const UI_KIT_BUTTON_STYLES = ['filled-rounded', 'pill', 'beveled', 'pixel'];
const UI_KIT_FONTS = ['rounded-bold', 'pixel', 'system-bold', 'serif'];

function pickEnum(value, allowed, fallback) {
    const v = String(value ?? '').trim().toLowerCase();
    return allowed.includes(v) ? v : fallback;
}

function sanitizeColor(value, fallback) {
    const v = String(value ?? '').trim();
    // Accept #rgb/#rgba/#rrggbb/#rrggbbaa or rgb()/rgba(); otherwise fall back.
    if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
    if (/^rgba?\([\d\s.,%]+\)$/i.test(v)) return v;
    return fallback;
}

/** Always return a complete, well-formed per-game UI kit, even when the model skimps the field. */
export function normalizeUiKit(raw = {}, qualityIntent = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const sourcePalette = source.palette && typeof source.palette === 'object' ? source.palette : {};
    const styleHint = asString(source.styleFamily, asString(qualityIntent.artDirection?.styleName, 'clean-minimal'));
    return {
        styleFamily: slugify(styleHint).replace(/_/g, '-') || 'clean-minimal',
        palette: {
            panel: sanitizeColor(sourcePalette.panel, '#1f2937'),
            panelBorder: sanitizeColor(sourcePalette.panelBorder, '#38bdf8'),
            accent: sanitizeColor(sourcePalette.accent, '#38bdf8'),
            textPrimary: sanitizeColor(sourcePalette.textPrimary, '#ffffff'),
            textMuted: sanitizeColor(sourcePalette.textMuted, '#94a3b8'),
        },
        radius: Math.max(0, Math.min(40, Math.round(Number(source.radius) || 16))),
        panelStyle: pickEnum(source.panelStyle, UI_KIT_PANEL_STYLES, 'solid'),
        buttonStyle: pickEnum(source.buttonStyle, UI_KIT_BUTTON_STYLES, 'filled-rounded'),
        font: pickEnum(source.font, UI_KIT_FONTS, 'rounded-bold'),
        decor: asString(source.decor, 'none'),
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

    const requiredState = [...new Set(asArray(source.requiredState).filter(Boolean))];
    for (const key of ['score', 'gameOver', 'width', 'height']) {
        if (!requiredState.includes(key)) requiredState.push(key);
    }

    const assetSlots = asArray(source.assetSlots);
    const entityBlueprints = asArray(source.entityBlueprints);
    // 3D games are built from flat-colored code geometry — no FLUX image assets at all.
    const is3DFoundation = asString(source.dimension, qualityIntent.technicalRequirements?.dimension || '2D').toUpperCase() === '3D'
        || asString(source.lane, '').toLowerCase().includes('threejs')
        || asString(source.lane, '').toLowerCase().includes('voxel_world');

    const merged = mergeCompositionGuidance({
        version: 1,
        source: 'gametok-foundation-architect',
        foundationId: slugify(source.foundationId || qualityIntent.title || 'dynamic_game'),
        title: asString(source.title, qualityIntent.title || 'GameTok Game'),
        lane: asString(source.lane, 'arcade'),
        dimension: asString(source.dimension, qualityIntent.technicalRequirements?.dimension || '2D').toUpperCase(),
        perspective: asString(source.perspective, qualityIntent.technicalRequirements?.perspective || 'top_down'),
        engine: asString(source.engine, 'canvas-2d'),
        cameraRig: asString(source.cameraRig, ''),
        initialState: asString(source.initialState, 'PLAYING'),
        stateFlow: asArray(source.stateFlow).length ? asArray(source.stateFlow) : ['PLAYING', 'RESULT'],
        uiAuthority: asString(source.uiAuthority, ''),
        uiKit: normalizeUiKit(source.uiKit, qualityIntent),
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
            : (!is3DFoundation && use2dAssetsOnly()
                ? ['Fill the world (tile floor for top-down, or sky + parallax for side-scroller)', 'Draw player or primary subject', 'Show HUD']
                : ['Draw background', 'Draw player or primary subject', 'Show HUD']),
        interactionLoops: asArray(source.interactionLoops),
        entityBlueprints,
        controls: asArray(source.controls).length ? asArray(source.controls) : ['tap'],
        acceptanceChecks: asArray(source.acceptanceChecks).length
            ? asArray(source.acceptanceChecks)
            : ['Core loop responds to input within 10 seconds'],
        antiPatterns: asArray(source.antiPatterns),
        implementationNotes: asArray(source.implementationNotes),
        assetSlots: (is3DFoundation || use2dAssetsOnly()) ? [] : (assetSlots.length ? assetSlots : buildDefaultAssetSlots(qualityIntent, entityBlueprints)),
        statusCopy: asString(source.statusCopy, 'Tap to play!'),
        userIntent: qualityIntent.userIntent || null,
    });

    return {
        ...merged,
        hudDesign: normalizeHudDesignForFoundation(merged, qualityIntent),
        hudBlocks: normalizeHudBlocksForFoundation(merged, qualityIntent),
        hudScaffold: merged.hudScaffold === true,
    };
}

// Identity for a contract list entry that may be a string OR an object ({name}/{id}).
function scopeEntryKey(entry) {
    if (typeof entry === 'string') return entry;
    return entry?.name || entry?.id || '';
}

// Keep every mustKeep entry (non-negotiable: the mandatory functions/probes/state), then fill up to
// `cap` from the rest IN ORDER (the architect lists most-important first), dropping the tail.
function capScopeList(list, cap, mustKeep = []) {
    const arr = Array.isArray(list) ? list.filter(Boolean) : [];
    if (arr.length <= cap) return { kept: arr, dropped: [] };
    const keepSet = new Set(mustKeep);
    const mandatory = arr.filter((e) => keepSet.has(scopeEntryKey(e)));
    const rest = arr.filter((e) => !keepSet.has(scopeEntryKey(e)));
    const room = Math.max(0, cap - mandatory.length);
    const kept = [...mandatory, ...rest.slice(0, room)];
    const dropped = rest.slice(room).map(scopeEntryKey).filter(Boolean);
    return { kept, dropped };
}

/**
 * Cap the contract SURFACE so a pathologically overscoped ask ("an American football game with ALL
 * the mechanics Madden has" -> 15+ required functions/systems) can't hand Phase 2 a contract too big
 * to implement clean in its turn budget (the TS2339-class build-death). Ceilings are GENEROUS — a
 * normal game (3-6 functions, 6-10 state) is far under them, so legitimately-rich games are untouched;
 * only the impossible asks get trimmed to a buildable vertical slice. Mandatory entries are always
 * preserved. This is a genre-agnostic SIZE cap — NOT lane/keyword routing (see CLAUDE.md: the lane
 * keyword library was reverted; this is deliberately not that).
 */
export function clampFoundationScope(foundation = {}, jobId = null) {
    const f = foundation && typeof foundation === 'object' ? foundation : {};
    const CAPS = {
        requiredFunctions: Math.max(4, Number(process.env.GAMETOK_SCOPE_MAX_FUNCTIONS || 10)),
        probeMethods: Math.max(3, Number(process.env.GAMETOK_SCOPE_MAX_PROBES || 8)),
        requiredState: Math.max(4, Number(process.env.GAMETOK_SCOPE_MAX_STATE || 16)),
        interactionLoops: Math.max(2, Number(process.env.GAMETOK_SCOPE_MAX_LOOPS || 6)),
        entityBlueprints: Math.max(2, Number(process.env.GAMETOK_SCOPE_MAX_ENTITIES || 8)),
    };
    const fn = capScopeList(f.requiredFunctions, CAPS.requiredFunctions, ['stepGame', 'resetGame', 'renderAll']);
    const probe = capScopeList(f.probeMethods, CAPS.probeMethods, ['snapshot', 'step', 'reset']);
    const state = capScopeList(f.requiredState, CAPS.requiredState, ['score', 'gameOver', 'width', 'height']);
    const loops = capScopeList(f.interactionLoops, CAPS.interactionLoops, []);
    const ents = capScopeList(f.entityBlueprints, CAPS.entityBlueprints, []);

    const report = [];
    if (fn.dropped.length) report.push(`functions:-${fn.dropped.length}(${fn.dropped.slice(0, 6).join(',')})`);
    if (probe.dropped.length) report.push(`probes:-${probe.dropped.length}`);
    if (state.dropped.length) report.push(`state:-${state.dropped.length}(${state.dropped.slice(0, 6).join(',')})`);
    if (loops.dropped.length) report.push(`loops:-${loops.dropped.length}`);
    if (ents.dropped.length) report.push(`entities:-${ents.dropped.length}`);
    if (report.length) {
        console.warn(`✂️ [SCOPE CLAMP${jobId ? ` job=${jobId}` : ''}] Overscoped foundation trimmed to a buildable slice :: ${report.join(' ')}`);
    }

    return {
        ...f,
        requiredFunctions: fn.kept,
        probeMethods: probe.kept,
        requiredState: state.kept,
        interactionLoops: loops.kept,
        entityBlueprints: ents.kept,
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

/**
 * Deterministic foundation seed from a Phase 1 intent spec, used when the foundation architect
 * model fails to return usable JSON (and heuristic fallback is enabled). Only carries intent-derived
 * flavor — normalizeFoundationContract() fills every required field and default asset slots.
 */
export function buildFallbackFoundationSeed(qualityIntent = {}) {
    const intent = qualityIntent && typeof qualityIntent === 'object' ? qualityIntent : {};
    const play = intent.playableExperience && typeof intent.playableExperience === 'object'
        ? intent.playableExperience
        : {};
    const tech = intent.technicalRequirements && typeof intent.technicalRequirements === 'object'
        ? intent.technicalRequirements
        : {};

    const entityBlueprints = [];
    const rawVisuals = intent.visualAssets;
    const visualList = Array.isArray(rawVisuals)
        ? rawVisuals
        : (rawVisuals && typeof rawVisuals === 'object' ? Object.values(rawVisuals) : []);
    for (const entry of visualList) {
        if (!entry) continue;
        if (typeof entry === 'string') {
            entityBlueprints.push({ id: slugify(entry), role: 'prop', description: entry });
            continue;
        }
        const role = asString(entry.role || entry.category || entry.type, 'prop');
        const id = asString(entry.id || entry.key || entry.name, role);
        entityBlueprints.push({
            id,
            role,
            description: asString(entry.description || entry.prompt || entry.name, `${role} for ${intent.title || 'the game'}`),
        });
    }

    const coreLoop = asString(play.coreLoop, '');
    const primaryMechanic = asString(play.primaryMechanic, '');

    return {
        foundationId: slugify(intent.title || 'fallback_game'),
        title: asString(intent.title, 'GameTok Game'),
        lane: primaryMechanic ? slugify(primaryMechanic) : 'arcade',
        dimension: asString(tech.dimension, '2D'),
        perspective: asString(tech.perspective, 'top_down'),
        engine: 'canvas-2d',
        interactionLoops: [coreLoop || primaryMechanic || 'Touch-first mobile loop with visible feedback.'].filter(Boolean),
        entityBlueprints,
        controls: asArray(tech.controls).length ? asArray(tech.controls) : ['tap'],
        acceptanceChecks: asArray(intent.acceptanceChecks).length
            ? asArray(intent.acceptanceChecks)
            : [coreLoop ? `Core loop responds to input: ${coreLoop}` : 'Core loop responds to input within 10 seconds'],
        implementationNotes: [intent.userIntent, coreLoop, primaryMechanic]
            .map((note) => asString(note, ''))
            .filter(Boolean),
        statusCopy: asString(play.statusCopy, 'Tap to play!'),
    };
}

export function assertFoundationSupported(foundation = {}) {
    const dimension = String(foundation.dimension || '2D').toUpperCase();
    const lane = String(foundation.lane || '').toLowerCase();
    if (lane === 'unsupported_3d') {
        throw new Error('This idea needs real 3D model generation we do not support yet. Try a version that works with blocky/low-poly art.');
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

    // Backstop: Phase 1's 3D call is binding (see buildFoundationAgentPrompt mandate). If the
    // foundation model still downgraded a Phase-1-3D game to 2D, force 3D here rather than ship a
    // 2D game for a 3D request. Uses the structured Phase 1 dimension field, NOT prompt keywords.
    const phase1Is3D = String(qualityIntent?.technicalRequirements?.dimension || '').toUpperCase() === '3D';
    const is3D = phase1Is3D
        || String(foundation.dimension || '').toUpperCase() === '3D'
        || String(foundation.lane || '').toLowerCase().includes('threejs')
        || String(foundation.lane || '').toLowerCase().includes('voxel_world')
        || String(foundation.engine || '').toLowerCase() === 'threejs';
    if (phase1Is3D && String(foundation.dimension || '').toUpperCase() !== '3D') {
        console.warn(`[Foundation] Phase 1 said 3D but foundation returned dimension=${foundation.dimension || '2D'} engine=${foundation.engine || 'canvas-2d'} lane=${foundation.lane || '?'} — forcing 3D (threejs-kernel) to honor Phase 1.`);
    }
    return {
        version: 1,
        source: 'gametok-dynamic-foundation',
        templateId: is3D ? 'threejs-kernel' : 'canvas-kernel',
        engine: is3D ? 'threejs' : (foundation.engine || 'canvas-2d'),
        archetype: foundation.lane || 'dynamic',
        recommendedLibrary: is3D
            ? 'Three.js (WebGL) on shared GameTok 3D kernel (bootstrap + threeAssets).'
            : 'Canvas 2D on shared GameTok kernel (bootstrap + assetLoader).',
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

// 3D slot types get fixed FLUX-friendly dimensions and prompt constraints so the
// images actually work as Three.js materials (tileable textures, panoramic sky).
const THREE_D_SLOT_RULES = {
    texture: {
        width: 1024,
        height: 1024,
        transparent: false,
        promptSuffix: 'Seamless tileable texture, top-down flat view, perfectly even flat lighting, no shadows, no perspective, no vignette — the pattern must repeat edge-to-edge with no visible seams. No text, no objects, surface material only.',
        fallback: 'solid color material',
    },
    skybox: {
        width: 1344,
        height: 768,
        transparent: false,
        promptSuffix: 'Wide panoramic sky and distant horizon only. No foreground objects, no ground-level detail, no text, no UI. Smooth gradients suitable for wrapping around a 3D scene.',
        fallback: 'gradient sky',
    },
    billboard: {
        width: 768,
        height: 768,
        transparent: true,
        promptSuffix: 'Single isolated subject, centered, full body in frame, clean silhouette on a plain solid background for easy cutout. No text, no ground shadow.',
        fallback: 'code-rendered shape',
    },
};

function threeDSlotRuleFor(slot) {
    const type = String(slot.assetType || slot.type || '').toLowerCase();
    const role = String(slot.role || slot.category || '').toLowerCase();
    return THREE_D_SLOT_RULES[type] || THREE_D_SLOT_RULES[role] || null;
}

export function buildMakerAssetContractFromFoundation(foundation = {}, qualityIntent = {}) {
    const is3D = String(foundation.dimension || '').toUpperCase() === '3D'
        || String(foundation.lane || '').toLowerCase().includes('threejs')
        || String(foundation.lane || '').toLowerCase().includes('voxel_world');
    // 3D games render flat-colored code geometry — NO FLUX image assets. Returning zero
    // image slots makes the artist phase skip entirely (it's gated on slots.length > 0).
    if (is3D) {
        return {
            version: 1,
            templateId: 'threejs-kernel',
            sourceOfTruth: 'code-built flat-colored geometry (no generated image assets)',
            hardRules: [
                '3D worlds are built from code geometry (boxes, planes, voxels) with FLAT hex colors — there are NO generated image textures.',
                'Distinguish entities by color + shape; HUD, text, controls, and meters are code-rendered DOM only.',
                'Gameplay geometry, hitboxes, and colors are all code-defined.',
            ],
            slots: [],
        };
    }
    const slots = [];
    let scenerySlotSeen = false;
    for (const rawSlot of asArray(foundation.assetSlots)) {
        const slot = normalizeSceneryAssetSlot(rawSlot);
        if (slot.role === 'background') {
            if (scenerySlotSeen) continue;
            scenerySlotSeen = true;
        }
        const threeDRule = is3D ? threeDSlotRuleFor(slot) : null;
        slots.push({
            id: slot.id,
            required: Boolean(slot.required),
            assetType: slot.assetType || 'sprite',
            role: slot.role || slot.category || 'prop',
            category: slot.category || slot.role || 'prop',
            size: slot.size || undefined,
            width: threeDRule ? threeDRule.width : (slot.width || undefined),
            height: threeDRule ? threeDRule.height : (slot.height || undefined),
            transparent: threeDRule ? threeDRule.transparent : slot.transparent !== false,
            description: `${slot.description || slot.role}. ${threeDRule ? `${threeDRule.promptSuffix} ` : ''}${artStyleText(qualityIntent)}`.trim(),
            consumedBy: slot.consumedBy || (threeDRule
                ? `threeAssets helpers via getDreamTexture('${slot.id}') / role ${slot.role}`
                : `renderer via getAssetImage('${slot.id}') or role ${slot.role}`),
            fallback: slot.fallback || (threeDRule ? threeDRule.fallback : 'code-rendered shape'),
        });
    }

    return {
        version: 1,
        templateId: is3D ? 'threejs-kernel' : 'canvas-kernel',
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
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${title}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
      font-family: sans-serif;
    }
    #game-container {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    canvas {
      box-shadow: 0 0 20px rgba(0,0,0,0.5);
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
</head>
<body>
  <div id="game-container"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`;
}

function jsString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

export function buildMainTsStubFromFoundation(foundation = {}, qualityIntent = {}) {
    const title = asString(foundation.title, qualityIntent.title || 'GameTok Game');
    const implNotes = asArray(foundation.implementationNotes).slice(0, 8)
        .map((note) => `// ${String(note || '').replace(/[\r\n]+/g, ' ').trim()}`)
        .join('\n');

    return `// @ts-nocheck
// GameTok Native Phaser 3 foundation stub
// Foundation: ${foundation.foundationId || 'dynamic'} (${foundation.lane || 'arcade'})
// Phase 2 owns the full game logic.
// You MUST load all image and audio assets directly from public CDNs like:
// 'https://labs.phaser.io/assets/'
${implNotes}

class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Enable CORS for public CDN loading
        this.load.setCORS('anonymous');
        
        // Example native loading from Phaser Labs:
        // this.load.image('background', 'https://labs.phaser.io/assets/skies/space3.png');
        // this.load.image('player', 'https://labs.phaser.io/assets/sprites/ship.png');
    }

    create() {
        this.scene.start('GameScene');
    }
}

class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    create() {
        const text = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, ${jsString(title + '\\nTap to Start')}, {
            fontSize: '32px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => {
            text.destroy();
            // Start game
        });
    }

    update(time: number, delta: number) {
        // Game loop
    }
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: [BootScene, GameScene],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

new Phaser.Game(config);

// Expose probe for verification
window.__GAMETOK_TEMPLATE_PROBE__ = {
    snapshot() { return { score: 0, started: true }; },
    step() { return this.snapshot(); },
    reset() { return this.snapshot(); }
};
`;
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
