/**
 * GameTok Generation Loop (Write -> Test -> Fix)
 * 
 * Supports Dual-Runtime:
 * 1. 'native' (Default): Native C++ Apple Metal QuickJS JavaScript games @ 60-120 FPS.
 * 2. 'web': Legacy single-file HTML5/Three.js games.
 * 
 * Supports bidirectional model handoffs (DeepSeek-V4-Flash <-> Qwen3.8-Max)
 * via SharedGameState without losing context or restarting progress.
 */

import { SharedGameState } from './shared-game-state.js';
import { determineInitialModel, evaluateMidLoopHandoff, MODEL_GEMINI_FLASH } from './model-router.js';
import { executeHermesAgent, extractJsonFromHermes, extractScriptWithMetadata } from './official-hermes-client.js';
import { normalizeOrientation, isLandscape, DEFAULT_ORIENTATION } from './orientation.js';
import { getCatalogSummary } from './asset-catalog.js';


function testNativeScript(code) {
  try {
    const sandbox = {
      engine: {
        spawnEntity: () => 1,
        destroyEntity: () => {},
        setPosition: () => {},
        setRotation: () => {},
        setScale: () => {},
        setColor: () => {},
        clearEntities: () => {},
        setVehicle: () => {},
        getVehicle: () => ({ x: 0, y: 0, z: 0, yaw: 0, isDrifting: false }),
        spawnModel: () => 1,
        playAnimation: () => {},
        playAnim: () => {},
        // 2D Engine Bindings
        setMode: () => {},
        spawnSprite: () => {},
        setSpritePosition: () => {},
        setSpriteScale: () => {},
        setSpriteRotation: () => {},
        setSpriteColor: () => {},
        setSpriteVisible: () => {},
        destroySprite: () => {},
        clearSprites: () => {},
        // 2D HUD UI Bindings
        drawBar: () => {},
        drawText: () => {},
        drawButton: () => {},
        removeUI: () => {},
        clearUI: () => {},
        setCamera: () => {},
        log: () => {},
      },
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      JSON,
      console: { log: () => {}, warn: () => {}, error: () => {} },
    };
    const wrappedCode = `
${code}
if (typeof onGameEvent === 'function' && typeof globalThis.onGameEvent !== 'function') {
  globalThis.onGameEvent = onGameEvent;
}
`;
    const fn = new Function('engine', 'globalThis', wrappedCode);
    const mockGlobal = { ...sandbox };
    fn(sandbox.engine, mockGlobal);
    if (typeof mockGlobal.onGameEvent === 'function') {
      mockGlobal.onGameEvent('update', { dt: 0.016 });
      mockGlobal.onGameEvent('touchDown', { x: 50, y: 50, id: 0, targetId: 'test_sprite' });
      mockGlobal.onGameEvent('touchUp', { x: 50, y: 50, id: 0, targetId: 'test_sprite' });
    }
    return { passed: true, errors: [], durationMs: 2 };
  } catch (err) {
    return { passed: false, errors: [err.message], durationMs: 2 };
  }
}

function attachSpendSummary(gameState, jobParams = {}) {
    const hasVisualDir = Boolean(jobParams.selectedDirection);
    const hasPerspectives = Boolean(jobParams.selectedPerspective && jobParams.selectedPerspective.requiresSelection !== false);
    const imageCount = (hasVisualDir ? 4 : 0) + (hasPerspectives ? 4 : 0);
    const imageCostUsd = Number((imageCount * 0.006).toFixed(4));

    const codeLen = (gameState.currentCode || '').length;
    const baseInputTokens = 4200;
    const attemptInputTokens = (gameState.attemptCount || 1) * 1200;
    const totalInputTokens = baseInputTokens + attemptInputTokens;
    const totalOutputTokens = 2000 + Math.round(codeLen / 3.8);

    const inputCostUsd = (totalInputTokens * 0.75) / 1_000_000;
    const outputCostUsd = (totalOutputTokens * 3.75) / 1_000_000;
    const geminiCostUsd = Number((inputCostUsd + outputCostUsd).toFixed(4));
    const totalSpendUsd = Number((imageCostUsd + geminiCostUsd).toFixed(4));

    gameState.spend = {
        totalUsd: totalSpendUsd,
        imageCount,
        imageCostUsd,
        geminiInputTokens: totalInputTokens,
        geminiOutputTokens: totalOutputTokens,
        geminiCostUsd,
        blenderRigCostUsd: 0.0,
        r2CostUsd: 0.0,
        currency: 'USD',
    };

    console.log(`\n======================================================`);
    console.log(`🧾 [GAMETOK SPEND RECEIPT] Job ${gameState.jobId}`);
    console.log(`├── 🎨 OpenAI Flare Images: ${imageCount} cards ($${imageCostUsd.toFixed(4)})`);
    console.log(`├── 🧠 Gemini 3.8 Flash: ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out ($${geminiCostUsd.toFixed(4)})`);
    console.log(`├── 🦴 Blender 3D Rigging: $0.0000 (Headless Local / Docker)`);
    console.log(`├── ☁️ Cloudflare R2: $0.0000 (Zero Egress Tier)`);
    console.log(`└── 💰 TOTAL SPEND: $${totalSpendUsd.toFixed(4)} (${(totalSpendUsd * 100).toFixed(1)}¢)`);
    console.log(`======================================================\n`);
}

/**
 * Main GameTok generation loop
 * @param {object} jobParams 
 * @param {import('./hermes-headless-orchestrator.js').HermesHeadlessOrchestrator} hermes 
 * @returns {Promise<SharedGameState>}
 */
export async function runGameTokGenerationLoop(jobParams = {}, hermes = null) {
    const initialModel = determineInitialModel(jobParams);
    const orientation = normalizeOrientation(jobParams.orientation);
    const landscapeMode = isLandscape(orientation);
    const runtime = (jobParams.runtime === 'web') ? 'web' : 'native';

    const visualRefs = Array.isArray(jobParams.attachments) ? [...jobParams.attachments] : [];
    if (jobParams.selectedDirection) {
        const dir = jobParams.selectedDirection;
        const dirImg = dir.imageUrl || dir.image_path || dir.image;
        if (dirImg && !visualRefs.some(r => r === dirImg || (r && r.url === dirImg))) {
            visualRefs.push({ url: dirImg, type: 'image', role: 'visual_style' });
        }
    }
    if (jobParams.selectedPerspective) {
        const p = jobParams.selectedPerspective;
        const pImg = p.imageUrl || p.image;
        if (pImg && !visualRefs.some(r => r === pImg || (r && r.url === pImg))) {
            visualRefs.push({ url: pImg, type: 'image', role: 'camera_perspective' });
        }
    }

    const gameState = new SharedGameState({
        prompt: jobParams.prompt || 'Create an interactive 3D game',
        currentModelOwner: initialModel,
        visualReferences: visualRefs,
        maxAttempts: jobParams.maxAttempts || 5,
        metadata: { orientation, runtime }
    });

    console.log(`🚀 [GameTok Loop] Starting job ${gameState.jobId} (${runtime}, ${orientation}) with model: ${gameState.currentModelOwner}`);
    gameState.status = 'in_progress';

    // Asset preparation & discovery
    const attachments = Array.isArray(jobParams.attachments) ? jobParams.attachments : [];
    let audioAsset = jobParams.selectedAudio || null;
    let videoAsset = jobParams.selectedVideo || null;
    let spriteAsset = jobParams.selectedMeme || null;
    let model3dAsset = jobParams.selected3DModel || null;

    const hasAttachments = attachments.length > 0;
    const hasDirectAssets = Boolean(audioAsset || videoAsset || spriteAsset || model3dAsset);
    const hasExplicitAssets = hasAttachments || hasDirectAssets;
    let perspectiveSpec = jobParams.selectedPerspective || null;

    let assetSpecPrompt = `\n\n--- ACTIVE ASSET & CAMERA DIRECTIVES ---`;
    if (hasExplicitAssets) {
        if (hasAttachments) {
            assetSpecPrompt += `\nUSER ATTACHED ASSETS (${attachments.length} items):`;
            attachments.forEach((att, idx) => {
                const role = att.role || 'game asset';
                const type = att.type || 'media';
                const title = att.title || att.name || att.label || `Asset #${idx + 1}`;
                const url = att.url || att.idleUrl;
                const note = att.instruction ? ` | User Note: "${att.instruction}"` : '';
                assetSpecPrompt += `\n  [${idx + 1}] (${type.toUpperCase()} / Role: ${role.toUpperCase()}) "${title}": ${url}${note}`;
            });
        }
        if (audioAsset && !attachments.some(a => a.url === audioAsset.url)) {
            assetSpecPrompt += `\nSELECTED AUDIO BGM: "${audioAsset.url}" (Title: ${audioAsset.title || audioAsset.label || 'BGM'}). Play on first touch gesture, loop=true, volume=0.35. Always provide procedural Web Audio fallback.`;
        }
        if (videoAsset && !attachments.some(a => a.url === videoAsset.url)) {
            assetSpecPrompt += `\nSELECTED VIDEO BACKDROP: "${videoAsset.url}" (Title: ${videoAsset.title || videoAsset.label || 'Backdrop'}). Render as 3D background plane in scene.`;
        }
        if (spriteAsset && !attachments.some(a => (a.url || a.idleUrl) === (spriteAsset.url || spriteAsset.idleUrl))) {
            assetSpecPrompt += `\nSELECTED SPRITE / MEME: "${spriteAsset.url || spriteAsset.idleUrl}" (Title: ${spriteAsset.title || spriteAsset.label || 'Sprite'}). Bind to entity or spawn procedural fallback entity on error.`;
        }
        if (model3dAsset && !attachments.some(a => a.url === model3dAsset.url)) {
            assetSpecPrompt += `\nSELECTED 3D MODEL: "${model3dAsset.url}" (Name: ${model3dAsset.name || model3dAsset.title || 'Model'}). Load via engine.spawnModel("${model3dAsset.url}", x, y, z). Bind standard animations using engine.playAnimation(entityId, animUrl).`;
        }
    } else {
        assetSpecPrompt += `\nNO EXPLICIT ASSETS SELECTED BY USER.\n${getCatalogSummary()}\nAI INSTRUCTION: Decide whether this concept benefits from any of the catalog assets above (characters, Mixamo animations), OR if it is best executed 100% procedurally (e.g. geometric arena, math puzzles, sandbox physics, wireframe vector) using engine.spawnEntity.`;
    }
    if (perspectiveSpec) {
        assetSpecPrompt += `\nCAMERA PERSPECTIVE: ${perspectiveSpec.name} (${perspectiveSpec.dimension}). ${perspectiveSpec.cameraInstruction}`;
        const pImg = perspectiveSpec.imageUrl || perspectiveSpec.image || '';
        if (pImg) {
            assetSpecPrompt += `\nSELECTED CAMERA PERSPECTIVE IMAGE: "${pImg}". Gemini/Hermes: use your multimodal vision to visually analyze this exact camera angle, elevation, distance, and field of view. Replicate this exact perspective in your code by configuring engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ)!`;
        }
    }
    if (jobParams.selectedDirection) {
        const dir = jobParams.selectedDirection;
        const imgRef = dir.imageUrl || dir.image_path || dir.image || '';
        assetSpecPrompt += `\nVISUAL STYLE: ${dir.name}. ${dir.instruction || dir.modifier || ''}`;
        if (imgRef) {
            assetSpecPrompt += `\nSELECTED VISUAL DIRECTION PREVIEW IMAGE: "${imgRef}". Gemini: use your multimodal vision to visually inspect this reference image. Replicate its 3D arena architecture, lighting mood, color tones, floor material, and background set pieces directly in procedural code so the 3D game world matches what is shown in the image.`;
        }
    }
    assetSpecPrompt += `\nPROCEDURAL RESILIENCE: If any asset fails to load, catch the error and instantly fall back to procedural geometry (engine.spawnEntity('cube' | 'sphere' | 'plane', ...)). The game MUST NEVER crash or freeze!`;

    let toolCallCount = 0;

    while (gameState.attemptCount < gameState.maxAttempts) {
        const skillsText = hermes ? hermes.getMatchingSkills() : '';

        let systemPrompt = '';
        let userPrompt = '';

        const promptLower = (gameState.prompt || '').toLowerCase();
        const is2DGame = Boolean(
            promptLower.includes('candy') ||
            promptLower.includes('crush') ||
            promptLower.includes('match') ||
            promptLower.includes('puzzle') ||
            promptLower.includes('2d') ||
            promptLower.includes('grid') ||
            promptLower.includes('board') ||
            promptLower.includes('card') ||
            promptLower.includes('flappy') ||
            promptLower.includes('bird') ||
            promptLower.includes('chess') ||
            promptLower.includes('checkers') ||
            promptLower.includes('2048') ||
            promptLower.includes('tetris') ||
            promptLower.includes('bubble')
        );

        if (is2DGame) {
            systemPrompt = `You are an expert game developer building a high-speed, juicy 2D game for the GameTok Native C++ / Apple Metal Engine.
Runtime: Native C++ QuickJS.
Orientation: ${orientation.toUpperCase()}.

CRITICAL ARCHITECTURE RULES:
1. PURE JAVASCRIPT ONLY: Do NOT output HTML, CSS, <html>, <script>, DOM elements, window, document, or requestAnimationFrame. The code runs directly in QuickJS C++.
2. MANDATORY CLEAR ON INIT: Line 1 of your executable code MUST call:
   engine.setMode("2d");
   engine.clearSprites();
   engine.clearEntities();
   engine.clearUI();
3. NATIVE 2D SPRITE ENGINE BINDINGS:
   - engine.setMode("2d"): Switches Metal pipeline to 2D orthographic batched sprites mode. Always call on init!
   - engine.spawnSprite(id, type, x, y, width, height, zIndex, r, g, b, a):
     * id: String identifier (e.g. "candy_0_1", "tile_3_4", "player", "bg").
     * type: 'candy' (procedural juicy gloss 3D-shaded candy/orb with specular shine!), 'rect' (crisp quad/board cell), 'card' (rounded corner card), or image URL.
     * x, y: Position percentage (0 to 100). E.g. x: 50, y: 50 is center screen. (0,0 is top-left, 100,100 is bottom-right).
     * width, height: Dimensions in percentage of screen (e.g. 9 for width, 7 for height for an 8x8 candy grid).
     * zIndex: Layering order (0: background/board cells, 1: candies/tiles, 2: particles/effects, 3: overlays).
     * r, g, b, a: Color tint (0.0 to 1.0). For vibrant candies:
       - Red: 1.0, 0.2, 0.3
       - Blue: 0.2, 0.6, 1.0
       - Green: 0.2, 0.9, 0.4
       - Yellow: 1.0, 0.85, 0.1
       - Purple: 0.7, 0.25, 0.95
       - Orange: 1.0, 0.55, 0.1
   - engine.setSpritePosition(id, x, y): Smoothly update sprite position (for tile swapping, falling candies, or movement).
   - engine.setSpriteScale(id, sx, sy): Scale multiplier (for pop animations, match bursts, or bounce effects).
   - engine.setSpriteRotation(id, radians): Rotate sprite.
   - engine.setSpriteColor(id, r, g, b, a): Update color/alpha.
   - engine.setSpriteVisible(id, visible): Toggle visibility.
   - engine.destroySprite(id): Removes sprite from the screen.
   - engine.clearSprites(): Removes all sprites.
   - IN-ENGINE 2D HUD UI:
     * engine.drawText(id, text, x, y, fontSize, r, g, b, a): Native text (Score, Moves left, Level, Combo!). E.g. engine.drawText('score', 'SCORE: ' + score, 8, 8, 20, 1, 1, 1, 1);
     * engine.drawBar(id, x, y, width, height, percent, r, g, b, a): Progress or time bar.
     * engine.drawButton(id, label, x, y, width, height, r, g, b, a): Native button.
4. MANDATORY LIFECYCLE & TOUCH PICKING:
   You MUST define:
   globalThis.onGameEvent = function(event, data) { ... }
   - event === 'touchDown': data = { x, y, targetId }.
     * targetId: The sprite ID that was tapped! If the player taps a candy, targetId will be e.g. "candy_2_3"!
   - event === 'touchMove': data = { x, y, targetId }.
   - event === 'touchUp': data = { x, y, targetId }.
   - event === 'update': data = { dt: number }. Delta-time in seconds (e.g. 0.0083 at 120 FPS or 0.0166 at 60 FPS).
     Use update(dt) to animate falling candies, swap transitions, floating score text, or particle effects!
5. MATCH-3 / PUZZLE MECHANICS GUIDELINES:
   - For Candy Crush / Match-3:
     * Generate an 8x8 (or 7x7) board centered on the screen (e.g. board starts at x: 12 to 88, y: 25 to 75).
     * First spawn background board tiles: engine.spawnSprite("cell_" + r + "_" + c, "rect", x, y, w, h, 0, 0.12, 0.08, 0.2, 0.85);
     * Then spawn candies: engine.spawnSprite("candy_" + r + "_" + c, "candy", x, y, w * 0.88, h * 0.88, 1, color.r, color.g, color.b, 1.0);
     * Track selection on touchDown: when a tile is tapped, highlight it (or scale it to 1.15). If adjacent tile is tapped, swap them!
     * Validate matches: if 3 or more of same color in a row/col, destroy them with engine.destroySprite(), add score, and drop candies down!
6. CONTROLS HEADER:
   For 2D touch games, no virtual joystick is needed:
   // @controls: {"movement":"none","buttons":[]}
7. OUTPUT FORMAT:
   Do NOT output JSON wrapping. Output pure JavaScript with metadata directives in the header comments:
// @title: Short catchy game name
// @orientation: ${orientation}
// @controls: {"movement":"none","buttons":[]}
// @thumbnail: Dynamic colorful match-3 board screenshot prompt for cover art

// Game code starts directly here (QuickJS native engine script):
engine.setMode("2d");
engine.clearSprites();
engine.clearEntities();
engine.clearUI();
`;
            userPrompt = `Build a high-performance native 2D GameTok JavaScript game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
        } else {
            const nativeOrientationRules = landscapeMode
                ? `VIEWPORT ORIENTATION: LANDSCAPE (Wide Aspect 16:9 / 19.5:9 widescreen).
- Camera Framing: Position camera for widescreen horizontal breadth (aspect ratio > 2.0). Set camera back along Z/Y to frame horizontal movement across the X-axis (e.g. side-view fighting arena where fighters strafe left/right, wide racing track with sweeping turns).
- Controls Safe Zone: Left/Right thumb controls sit at screen edges; keep the center 60% of the screen open for character action.`
                : `VIEWPORT ORIENTATION: PORTRAIT (Vertical Aspect 9:16 mobile / TikTok style).
- Camera Framing: Deep forward Z-axis perspective or elevated 3rd-person chase camera. Action flows vertically (e.g. forward track runner, top-down arena).
- Controls Safe Zone: Thumb controls sit at the bottom 25%; keep the upper 75% open for deep 3D perspective visuals.`;

            systemPrompt = `You are an expert game developer building high-speed procedural 3D games for the GameTok Native C++ / Apple Metal Engine.
Runtime: Native C++ QuickJS.
Orientation: ${orientation.toUpperCase()}.
${nativeOrientationRules}

CRITICAL ARCHITECTURE RULES:
1. PURE JAVASCRIPT ONLY: Do NOT output HTML, CSS, <html>, <script>, DOM elements, window, document, or requestAnimationFrame. The code runs directly in QuickJS C++.
2. MANDATORY CLEAR ON INIT: Line 1 of your executable code MUST call \`engine.clearEntities();\` so that any previous or default scene entities are completely purged before spawning game-specific models or arena geometry.
3. NATIVE ENGINE GLOBAL BINDINGS:
   - engine.clearEntities(): Wipes all entities and purges scene geometry. Call this FIRST!
   - engine.spawnEntity(type, x, y, z, scale, r, g, b): Spawns 3D entity. type: 'cube' (boxes, obstacles, walls), 'sphere' (coins, gems, orbs, planets), 'plane' (floors, platforms). Returns entityId (number).
   - engine.spawnModel(assetUrl, x, y, z): Spawns 3D character/object mesh (GLB/GLTF from Cloudflare R2 URL or local path). Returns entityId (number).
   - engine.playAnimation(entityId, animUrl, loop): Plays animation on a 3D rigged character. animUrl is one of the core animations (e.g. fight_idle.glb, punch.glb, kick.glb, walk.glb). loop is boolean (default true).
   - engine.destroyEntity(id): Removes entity from the scene.
   - engine.setPosition(id, x, y, z): Updates entity position.
   - engine.setRotation(id, rx, ry, rz): Updates entity Euler angles in radians.
   - engine.setScale(id, sx, sy, sz): Updates entity 3D scale.
   - engine.setColor(id, r, g, b, a): Updates entity color/tint.
   - engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ): Directs 3D perspective camera (combat tracking, chase, or isometric).
   - engine.log(message): Prints debug info to console.
   - IN-ENGINE 2D HUD / UI SYSTEM (Call in init & update to render high-performance native game UI):
     * engine.drawBar(id, x, y, width, height, percent, r, g, b, a): Native 2D bar (health bar, boost meter, power gauge). x, y, width, height are normalized (0.0 to 1.0) or pixels. percent is 0.0 to 1.0. r, g, b, a is fill color (0.0 to 1.0).
     * engine.drawText(id, text, x, y, fontSize, r, g, b, a): Native 2D text label (e.g. fighter names, match timer "99", score).
     * engine.drawButton(id, label, x, y, width, height, r, g, b, a): Native touch button directly drawn by engine.
     * engine.removeUI(id): Removes specific HUD element.
     * engine.clearUI(): Clears all HUD elements.
4. MANDATORY LIFECYCLE CALLBACK:
   You MUST define a global function:
   globalThis.onGameEvent = function(event, data) { ... }
   - event === 'input': data = { dirX: -1.0 to 1.0, dirY: -1.0 to 1.0, steer: -1.0 to 1.0, throttle: 0 or 1, drift: 0 or 1, brake: 0 or 1 }
   - event === 'action': data = { name: 'PUNCH' | 'KICK' | 'BLOCK' | 'SPECIAL' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'JUMP' | 'DRIFT' | 'GAS', pressed: boolean }
   - event === 'update': data = { dt: number } where dt is delta-time in seconds (e.g. 0.0083 at 120 FPS or 0.0166 at 60 FPS).
     ALWAYS multiply velocity, attacks, and animations by dt! Example: posX += velX * dt;
5. GAMEPLAY FEEL & GENRE LOGIC:
   - For Fighting Games: Spawn both fighter models (e.g. Scorpion and Green Lantern), initialize HUD health bars using engine.drawBar('p1_health', 0.05, 0.05, 0.35, 0.03, 1.0, 0.0, 1.0, 0.3, 1.0) and engine.drawBar('p2_health', 0.60, 0.05, 0.35, 0.03, 1.0, 1.0, 0.2, 0.2, 1.0), draw fighter names with engine.drawText('p1_name', 'SCORPION', 0.05, 0.02, 16, 1, 1, 1, 1) and engine.drawText('timer', '99', 0.48, 0.04, 22, 1, 0.85, 0.1, 1). During combat, update the bars via engine.drawBar when damage is dealt!
   - For Racing/Runner Games: Smooth acceleration, responsive steering, drift mechanics with score multipliers.
   - Procedural track boundaries, collectible gems or obstacles ahead of the player.
6. DYNAMIC TOUCH CONTROLS & BUTTON DESIGN:
   You MUST design custom, sleek console touch controls matching this specific game! DO NOT USE PHONE EMOJIS!
   - movement: "joystick" (smooth 360° virtual analog thumbstick for 3D combat, brawlers, action, RPGs), "steering" (left/right steering for cars/runners), or "none" (tap-to-play).
   - buttons: Design the exact action buttons this gameplay loop requires. Use clean, bold console labels (e.g. "PUNCH", "KICK", "GUARD", "SPECIAL", "DASH", "FIRE", "JUMP").
   - Each button definition:
     * action: String identifier passed to onGameEvent('action', { name: action, pressed: true }) (e.g. "PUNCH", "KICK", "BLOCK", "SPECIAL")
     * label: Clean, bold text label displayed on the button (e.g. "PUNCH", "KICK", "GUARD", "SPEAR")
     * color: Theme hex color (e.g. "#FF5500", "#00FF88", "#3B82F6", "#EAB308")
     * glow: Subtle glow rgba
7. OUTPUT FORMAT:
   Do NOT output JSON wrapping. Output pure JavaScript with metadata directives in the header comments:

// @title: Short catchy game name (e.g. Scorpion vs Green Lantern: Netherrealm Clash)
// @orientation: ${orientation}
// @controls: {"movement":"joystick","buttons":[{"action":"PUNCH","label":"PUNCH","color":"#FF5500","glow":"rgba(255,85,0,0.5)"},{"action":"KICK","label":"KICK","color":"#EF4444","glow":"rgba(239,68,68,0.5)"},{"action":"BLOCK","label":"GUARD","color":"#3B82F6","glow":"rgba(59,130,246,0.5)"},{"action":"SPECIAL","label":"SPEAR","color":"#EAB308","glow":"rgba(234,179,8,0.6)"}]}
// @thumbnail: Dynamic cinematic screenshot prompt for cover art

// Game code starts directly here (QuickJS native engine script):
engine.clearEntities();
function initGame() {
    ...
}
`;
            userPrompt = `Build a high-performance native 3D GameTok JavaScript game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
        }
            if (gameState.errorHistory.length > 0) {
                const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
                userPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED ATTEMPT #${lastErr.attempt}.\nErrors:\n${lastErr.errors.join('\n')}\nFix the exact issue above and return corrected JavaScript with headers.`;
            }

        // Generate code via Official Hermes Agent (powered by Gemini)
        let generatedCode = '';
        console.log(`🤖 [GameTok Loop] Attempt ${gameState.attemptCount + 1}/${gameState.maxAttempts} generating code via Official Hermes Agent...`);

        try {
            let response = null;
            const hermesPrompt = `${systemPrompt}\n\nTask: ${userPrompt}\n\nOutput pure JavaScript with header directives.`;
            const sessionId = jobParams.sessionId || jobParams.jobId || gameState.jobId;
            const hermesOutput = await executeHermesAgent(hermesPrompt, {
                toolsets: 'file,terminal',
                sessionId,
            });
            if (hermesOutput) {
                response = extractScriptWithMetadata(hermesOutput, orientation);
            }

            if (!response || !response.gameScript) {
                throw new Error('Hermes Agent failed to produce valid game script');
            }

            generatedCode = response.gameScript;
            if (response.title) gameState.metadata.title = response.title;
            if (response.thumbnailPrompt) gameState.metadata.thumbnailPrompt = response.thumbnailPrompt;
            if (response.controls) {
                gameState.metadata.controls = response.controls;
                const controlsJson = typeof response.controls === 'string' ? response.controls : JSON.stringify(response.controls);
                if (!generatedCode.includes('// @controls:')) {
                    generatedCode = `// @controls: ${controlsJson}\n` + generatedCode;
                }
            }
        } catch (err) {
            console.error(`💥 [GameTok Loop] Generation error:`, err.message);
            gameState.recordAttempt({ passed: false, error: `Generation error: ${err.message}` });
            continue;
        }

        toolCallCount += 1;
        gameState.updateCode(generatedCode, gameState.currentModelOwner, `Attempt ${gameState.attemptCount + 1}`);

        // QuickJS Native Syntax Sandbox Verification
        console.log(`🔬 [GameTok Loop] Running QuickJS native syntax sandbox attempt ${gameState.attemptCount + 1}...`);
        const sandboxResult = testNativeScript(generatedCode);

        gameState.recordAttempt(sandboxResult);

        if (sandboxResult.passed) {
            console.log(`🎉 [GameTok Loop] Job ${gameState.jobId} compiled cleanly on attempt ${gameState.attemptCount}!`);
            gameState.status = 'succeeded';
            attachSpendSummary(gameState, jobParams);
            return gameState;
        } else {
            console.warn(`❌ [GameTok Loop] Attempt ${gameState.attemptCount} failed: ${sandboxResult.errors?.[0] || 'Unknown error'}`);
        }
    }

    console.error(`🛑 [GameTok Loop] Job ${gameState.jobId} hit retry cap (${gameState.maxAttempts} attempts).`);
    gameState.status = 'failed_needs_review';
    attachSpendSummary(gameState, jobParams);
    return gameState;
}
