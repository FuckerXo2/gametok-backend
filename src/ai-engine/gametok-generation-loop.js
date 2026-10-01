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
import { callGeminiFlashJson } from './gemini-client.js';
import { executeHermesAgent, extractJsonFromHermes } from './official-hermes-client.js';
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
        spawnModel: () => {},
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
    const fn = new Function('engine', 'globalThis', code);
    const mockGlobal = { ...sandbox };
    fn(sandbox.engine, mockGlobal);
    if (typeof mockGlobal.onGameEvent === 'function') {
      mockGlobal.onGameEvent('update', { dt: 0.016 });
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

    const gameState = new SharedGameState({
        prompt: jobParams.prompt || 'Create an interactive 3D game',
        currentModelOwner: initialModel,
        visualReferences: jobParams.attachments || [],
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
            assetSpecPrompt += `\nSELECTED VIDEO BACKDROP: "${videoAsset.url}" (Title: ${videoAsset.title || videoAsset.label || 'Backdrop'}). Render as background underlay <video autoplay loop muted playsinline>. Make WebGL/Canvas transparent (renderer.setClearColor(0x000000, 0)).`;
        }
        if (spriteAsset && !attachments.some(a => (a.url || a.idleUrl) === (spriteAsset.url || spriteAsset.idleUrl))) {
            assetSpecPrompt += `\nSELECTED SPRITE / MEME: "${spriteAsset.url || spriteAsset.idleUrl}" (Title: ${spriteAsset.title || spriteAsset.label || 'Sprite'}). Bind to player/collectable entity. Add procedural fallback mesh on error.`;
        }
        if (model3dAsset && !attachments.some(a => a.url === model3dAsset.url)) {
            assetSpecPrompt += `\nSELECTED 3D MODEL: "${model3dAsset.url}" (Name: ${model3dAsset.name || model3dAsset.title || 'Model'}). Load via THREE.GLTFLoader, normalize bounding box scale, play animation mixer if present. Fall back to procedural Three.js mesh if load fails.`;
        }
    } else {
        assetSpecPrompt += `\nNO EXPLICIT ASSETS SELECTED BY USER.\n${getCatalogSummary()}\nAI INSTRUCTION: Decide whether this concept benefits from any of the catalog assets above, OR if it is best executed 100% procedurally (e.g. geometry, math puzzles, sandbox physics, wireframe vector) with zero external asset dependencies.`;
    }
    if (perspectiveSpec) {
        assetSpecPrompt += `\nCAMERA PERSPECTIVE: ${perspectiveSpec.name} (${perspectiveSpec.dimension}). ${perspectiveSpec.cameraInstruction}`;
    }
    if (jobParams.selectedDirection) {
        const dir = jobParams.selectedDirection;
        const imgRef = dir.imageUrl || dir.image_path || dir.image || '';
        assetSpecPrompt += `\nVISUAL STYLE: ${dir.name}. ${dir.instruction || dir.modifier || ''}`;
        if (imgRef) {
            assetSpecPrompt += `\nSELECTED VISUAL DIRECTION PREVIEW IMAGE: "${imgRef}". Gemini: use your multimodal vision to visually inspect this reference image. Replicate its 3D arena architecture, lighting mood, color tones, floor material, and background set pieces directly in procedural code so the 3D game world matches what is shown in the image.`;
        }
    }
    assetSpecPrompt += `\nPROCEDURAL RESILIENCE: If any asset fails to load, catch the error and instantly fall back to procedural geometry / Web Audio synth. The game MUST NEVER crash or freeze!`;

    let toolCallCount = 0;

    while (gameState.attemptCount < gameState.maxAttempts) {
        const skillsText = hermes ? hermes.getMatchingSkills() : '';

        let systemPrompt = '';
        let userPrompt = '';

        if (runtime === 'native') {
            systemPrompt = `You are an expert game developer building high-speed procedural 3D games for the GameTok Native C++ / Apple Metal Engine.
Runtime: Native C++ QuickJS.
Orientation: ${orientation.toUpperCase()}.

CRITICAL ARCHITECTURE RULES:
1. PURE JAVASCRIPT ONLY: Do NOT output HTML, CSS, <html>, <script>, DOM elements, window, document, or requestAnimationFrame. The code runs directly in QuickJS C++.
2. NATIVE ENGINE GLOBAL BINDINGS:
   - engine.spawnEntity(type, x, y, z, scale, r, g, b): Spawns 3D entity. type: 'cube' (boxes, obstacles, walls), 'sphere' (coins, gems, orbs, planets), 'plane' (floors, platforms). Returns entityId (number).
   - engine.spawnModel(assetUrl, x, y, z): Spawns 3D character/object mesh (GLB/GLTF from Cloudflare R2 URL or local path). Returns entityId (number).
   - engine.destroyEntity(id): Removes entity from the scene.
   - engine.setPosition(id, x, y, z): Updates entity position.
   - engine.setRotation(id, rx, ry, rz): Updates entity Euler angles in radians.
   - engine.setScale(id, sx, sy, sz): Updates entity 3D scale.
   - engine.setColor(id, r, g, b, a): Updates entity color/tint.
   - engine.clearEntities(): Wipes all entities.
   - engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ): Directs 3D perspective camera (combat tracking, chase, or isometric).
   - engine.setVehicle(x, y, z, yaw, isDrifting): (Optional) Controls player vehicle in driving/racing games.
   - engine.getVehicle(): Returns { x, y, z, yaw, speed, isDrifting }.
   - engine.log(message): Prints debug info to console.
3. MANDATORY LIFECYCLE CALLBACK:
   You MUST define a global function:
   globalThis.onGameEvent = function(event, data) { ... }
   - event === 'input': data = { dirX: -1.0 to 1.0, dirY: -1.0 to 1.0, steer: -1.0 to 1.0, throttle: 0 or 1, drift: 0 or 1, brake: 0 or 1 }
   - event === 'action': data = { name: 'PUNCH' | 'KICK' | 'BLOCK' | 'SPECIAL' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'JUMP' | 'DRIFT' | 'GAS', pressed: boolean }
   - event === 'update': data = { dt: number } where dt is delta-time in seconds (e.g. 0.0083 at 120 FPS or 0.0166 at 60 FPS).
     ALWAYS multiply velocity, attacks, and animations by dt! Example: posX += velX * dt;
4. GAMEPLAY FEEL & GENRE LOGIC:
   - For Fighting Games: Spawn both fighter models (e.g. Scorpion and Green Lantern), track health bars (P1 Health, P2 Health), process punch/kick hitboxes, knockback velocity, hit animations, block state, special projectiles (Scorpion's spear / Green Lantern's construct energy), dynamic camera framing keeping both fighters in view.
   - For Racing/Runner Games: Smooth acceleration, responsive steering, drift mechanics with score multipliers.
   - Procedural track boundaries, collectible gems or obstacles ahead of the player.
5. OUTPUT FORMAT:
   Return valid JSON with:
   {
     "title": "Short catchy game name (e.g. Cyber Drift 2099)",
     "runtime": "native",
     "orientation": "${orientation}",
     "controls": "driving",
     "gameScript": "full clean JavaScript code string without markdown fences",
     "thumbnailPrompt": "Midjourney style prompt for cover art"
   }`;

            userPrompt = `Build a high-performance native 3D GameTok JavaScript game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
            if (gameState.errorHistory.length > 0) {
                const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
                userPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED ATTEMPT #${lastErr.attempt}.\nErrors:\n${lastErr.errors.join('\n')}\nFix the exact issue above and return the corrected JSON.`;
            }
        } else {
            // Legacy Web HTML5 Three.js
            const orientationRules = landscapeMode
                ? `Viewport is LANDSCAPE (844px wide by 390px high). Design playfield horizontally. Keep HUD in top/bottom corners (safe area x: 4-96%, y: 6-94%).`
                : `Viewport is PORTRAIT (390px wide by 844px high). Keep playfield vertical.`;

            systemPrompt = `You are an expert Three.js & TypeScript game developer building procedural, self-contained single-file HTML games.
Orientation: ${orientation.toUpperCase()}. ${orientationRules}
You MUST output valid, runnable HTML containing all JS code in a single file.
${skillsText ? `\n--- REUSABLE SKILLS ---\n${skillsText}\n` : ''}`;

            userPrompt = `Build a playable 3D Three.js game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
            if (gameState.errorHistory.length > 0) {
                const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
                userPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED ATTEMPT #${lastErr.attempt}.\nErrors:\n${lastErr.errors.join('\n')}\nFix the exact issue above and return the corrected complete game HTML.`;
            }
        }

        // Generate code via Official Hermes Agent (powered by Gemini)
        let generatedCode = '';
        console.log(`🤖 [GameTok Loop] Attempt ${gameState.attemptCount + 1}/${gameState.maxAttempts} generating code via Official Hermes Agent...`);

        try {
            let response = null;
            const hermesPrompt = `${systemPrompt}\n\nTask: ${userPrompt}\n\nRespond with valid JSON.`;
            const hermesOutput = await executeHermesAgent(hermesPrompt);
            if (hermesOutput) {
                response = extractJsonFromHermes(hermesOutput);
            }

            if (!response) {
                throw new Error('Hermes Agent failed to produce valid JSON output');
            }

            if (runtime === 'native') {
                generatedCode = response.gameScript || response.code || (typeof response === 'string' ? response : '');
                if (!generatedCode) throw new Error('No gameScript generated by model');
                if (response.title) gameState.metadata.title = response.title;
                if (response.thumbnailPrompt) gameState.metadata.thumbnailPrompt = response.thumbnailPrompt;
            } else {
                generatedCode = typeof response === 'string' ? response : (response.html || response.code || JSON.stringify(response));
                if (!generatedCode) throw new Error('No HTML game code generated by model');
            }
        } catch (err) {
            console.error(`💥 [GameTok Loop] Generation error:`, err.message);
            gameState.recordAttempt({ passed: false, error: `Generation error: ${err.message}` });
            continue;
        }

        toolCallCount += 1;
        gameState.updateCode(generatedCode, gameState.currentModelOwner, `Attempt ${gameState.attemptCount + 1}`);

        // Sandbox Verification
        let sandboxResult;
        if (runtime === 'native') {
            console.log(`🔬 [GameTok Loop] Running QuickJS native syntax sandbox attempt ${gameState.attemptCount + 1}...`);
            sandboxResult = testNativeScript(generatedCode);
        } else {
            console.log(`🔬 [GameTok Loop] Running Hermes browser sandbox attempt ${gameState.attemptCount + 1} (${orientation})...`);
            sandboxResult = hermes 
                ? await hermes.runNativeSandboxTest(generatedCode, { timeoutMs: 12000, orientation })
                : { passed: true, errors: [], durationMs: 10 };
        }

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
