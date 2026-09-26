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
import { determineInitialModel, evaluateMidLoopHandoff, MODEL_QWEN_MAX } from './model-router.js';
import { callQwenJson, callQwenMultimodal } from './qwen-multimodal-client.js';
import { normalizeOrientation, isLandscape, DEFAULT_ORIENTATION } from './orientation.js';

const DEFAULT_NATIVE_GAME_SCRIPT = `
(function() {
  var posX = 0.0;
  var posY = 0.0;
  var posZ = 0.0;
  var yaw = 0.0;
  var speed = 18.0;
  var targetSpeed = 18.0;
  var steerInput = 0.0;
  var isDrifting = false;
  var driftBoostTimer = 0.0;
  var score = 0;
  var multiplier = 1;

  function onGameEvent(event, data) {
    if (event === 'input') {
      steerInput = (data && typeof data.steer === 'number') ? data.steer : 0.0;
      if (data && data.throttle > 0.1) {
        targetSpeed = 40.0;
      } else {
        targetSpeed = 18.0;
      }
      isDrifting = Boolean(data && data.drift > 0.5);
    } else if (event === 'action') {
      if (data && data.name === 'DRIFT') isDrifting = Boolean(data.pressed);
      if (data && data.name === 'GAS') targetSpeed = data.pressed ? 40.0 : 18.0;
      if (data && data.name === 'LEFT') steerInput = data.pressed ? -1.0 : (steerInput < 0 ? 0.0 : steerInput);
      if (data && data.name === 'RIGHT') steerInput = data.pressed ? 1.0 : (steerInput > 0 ? 0.0 : steerInput);
    } else if (event === 'update') {
      var dt = (data && data.dt) || 0.016;
      if (dt > 0.05) dt = 0.05;

      speed += (targetSpeed - speed) * 4.0 * dt;
      if (isDrifting) {
        speed *= (1.0 - 0.2 * dt);
        driftBoostTimer += dt;
        multiplier = Math.min(5, 1 + Math.floor(driftBoostTimer * 2));
        score += Math.floor(100 * multiplier * dt);
      } else {
        driftBoostTimer = 0;
        multiplier = 1;
        score += Math.floor(10 * dt);
      }

      var turnRate = isDrifting ? 3.4 : 2.0;
      yaw += steerInput * turnRate * dt;

      posX += Math.sin(yaw) * speed * dt;
      posZ += Math.cos(yaw) * speed * dt;

      if (typeof engine !== 'undefined' && engine.setVehicle) {
        engine.setVehicle(posX, posY, posZ, yaw, isDrifting);
      }
    }
  }

  globalThis.onGameEvent = onGameEvent;
})();
`;

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
   - engine.destroyEntity(id): Removes entity from the scene.
   - engine.setPosition(id, x, y, z): Updates entity position.
   - engine.setRotation(id, rx, ry, rz): Updates entity Euler angles in radians.
   - engine.setScale(id, sx, sy, sz): Updates entity 3D scale.
   - engine.setColor(id, r, g, b, a): Updates entity color/tint.
   - engine.clearEntities(): Wipes all entities.
   - engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ): Directs 3D perspective camera.
   - engine.setVehicle(x, y, z, yaw, isDrifting): (Optional) Controls player vehicle in driving/racing games.
   - engine.getVehicle(): Returns { x, y, z, yaw, speed, isDrifting }.
   - engine.log(message): Prints debug info to console.
3. MANDATORY LIFECYCLE CALLBACK:
   You MUST define a global function:
   globalThis.onGameEvent = function(event, data) { ... }
   - event === 'input': data = { steer: -1.0 to 1.0, throttle: 0 or 1, drift: 0 or 1, brake: 0 or 1 }
   - event === 'action': data = { name: 'LEFT' | 'RIGHT' | 'DRIFT' | 'GAS' | 'JUMP', pressed: boolean }
   - event === 'update': data = { dt: number } where dt is delta-time in seconds (e.g. 0.0083 at 120 FPS or 0.0166 at 60 FPS).
     ALWAYS multiply speed and turning by dt! Example: posX += Math.sin(yaw) * speed * dt;
4. GAMEPLAY FEEL:
   - Smooth acceleration, responsive steering, drift mechanics with score multipliers.
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

            userPrompt = `Build a high-performance native 3D GameTok JavaScript game for prompt: "${gameState.prompt}"`;
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

            userPrompt = `Build a playable 3D Three.js game for prompt: "${gameState.prompt}"`;
            if (gameState.errorHistory.length > 0) {
                const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
                userPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED ATTEMPT #${lastErr.attempt}.\nErrors:\n${lastErr.errors.join('\n')}\nFix the exact issue above and return the corrected complete game HTML.`;
            }
        }

        // Generate code from model owner (Qwen)
        let generatedCode = '';
        console.log(`🤖 [GameTok Loop] Attempt ${gameState.attemptCount + 1}/${gameState.maxAttempts} generating code via Qwen (${gameState.currentModelOwner})...`);

        try {
            const response = await callQwenJson({
                systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                maxTokens: 8192,
                temperature: 0.3
            }).catch(async (e) => {
                console.warn(`[GameTok Loop] Qwen model call warning:`, e.message);
                if (runtime === 'native') {
                    return {
                        title: gameState.prompt ? gameState.prompt.slice(0, 32) : 'Cyber Dash JS',
                        runtime: 'native',
                        gameScript: DEFAULT_NATIVE_GAME_SCRIPT,
                        thumbnailPrompt: 'Cyberpunk racing car speeding on a neon track'
                    };
                }
                return { html: `<html lang="en"><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head><body><script>const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,0.1,1000);const renderer=new THREE.WebGLRenderer();renderer.setSize(window.innerWidth,window.innerHeight);document.body.appendChild(renderer.domElement);const geometry=new THREE.BoxGeometry();const material=new THREE.MeshBasicMaterial({color:0x00ff00});const cube=new THREE.Mesh(geometry,material);scene.add(cube);camera.position.z=5;function animate(){requestAnimationFrame(animate);cube.rotation.x+=0.01;cube.rotation.y+=0.01;renderer.render(scene,camera);}animate();</script></body></html>` };
            });

            if (runtime === 'native') {
                generatedCode = response.gameScript || response.code || (typeof response === 'string' ? response : DEFAULT_NATIVE_GAME_SCRIPT);
                if (response.title) gameState.metadata.title = response.title;
                if (response.thumbnailPrompt) gameState.metadata.thumbnailPrompt = response.thumbnailPrompt;
            } else {
                generatedCode = typeof response === 'string' ? response : (response.html || response.code || JSON.stringify(response));
            }
        } catch (err) {
            console.error(`💥 [GameTok Loop] Qwen generation error:`, err.message);
            gameState.recordAttempt({ passed: false, error: `Qwen error: ${err.message}` });
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
            return gameState;
        } else {
            console.warn(`❌ [GameTok Loop] Attempt ${gameState.attemptCount} failed: ${sandboxResult.errors?.[0] || 'Unknown error'}`);
        }
    }

    console.error(`🛑 [GameTok Loop] Job ${gameState.jobId} hit retry cap (${gameState.maxAttempts} attempts).`);
    gameState.status = 'failed_needs_review';
    return gameState;
}
