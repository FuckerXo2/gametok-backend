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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SharedGameState } from './shared-game-state.js';
import { determineInitialModel, evaluateMidLoopHandoff, MODEL_GEMINI_FLASH } from './model-router.js';
import { executeHermesAgent, extractJsonFromHermes, extractScriptWithMetadata, clearSessionHistory } from './official-hermes-client.js';
import { normalizeOrientation, isLandscape, DEFAULT_ORIENTATION } from './orientation.js';
import { getCatalogSummary } from './asset-catalog.js';
import { calculateJobSpend, purgeJobSpend } from './token-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


function testGameScript(code, orientation = 'portrait') {
  const startTime = Date.now();
  try {
    if (!code || typeof code !== 'string' || code.trim().length < 50) {
      return { passed: false, errors: ['Generated code is empty or too short'], durationMs: 1 };
    }

    const trimmed = code.trim();
    const isHtml = trimmed.startsWith('<') || trimmed.includes('<!DOCTYPE') || trimmed.includes('<html');

    if (isHtml) {
      // 1. Verify HTML structure
      if (!trimmed.includes('<script')) {
        return { passed: false, errors: ['HTML does not contain any <script> tags'], durationMs: 2 };
      }

      // 2. Extract scripts and test syntax
      const scriptMatches = trimmed.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
      let foundScript = false;
      for (const match of scriptMatches) {
        const scriptContent = match[1].trim();
        // Skip external scripts with only src attribute
        if (scriptContent.length > 0) {
          foundScript = true;
          try {
            new Function(scriptContent);
          } catch (err) {
            return { passed: false, errors: [`JavaScript syntax error: ${err.message}`], durationMs: Date.now() - startTime };
          }
        }
      }

      // If scripts were purely external without inline script, check for basic body
      if (!foundScript && !trimmed.includes('src=')) {
        return { passed: false, errors: ['No executable JavaScript found inside HTML script tags'], durationMs: 2 };
      }

      return { passed: true, errors: [], durationMs: Date.now() - startTime };
    } else {
      // Pure JS verification
      try {
        new Function(trimmed);
        return { passed: true, errors: [], durationMs: Date.now() - startTime };
      } catch (err) {
        return { passed: false, errors: [`JavaScript syntax error: ${err.message}`], durationMs: Date.now() - startTime };
      }
    }
  } catch (err) {
    return { passed: false, errors: [err.message], durationMs: Date.now() - startTime };
  }
}


function attachSpendSummary(gameState, jobParams = {}) {
    const hasVisualDir = Boolean(jobParams.selectedDirection);
    const hasPerspectives = Boolean(jobParams.selectedPerspective && jobParams.selectedPerspective.requiresSelection !== false);
    const fallbackContext = {
        prompt: gameState.prompt,
        code: gameState.currentCode,
        attempts: gameState.attemptCount || 1,
        hasVisualDir,
        hasPerspectives,
    };

    const spend = calculateJobSpend(gameState.jobId, fallbackContext);
    gameState.spend = spend;

    console.log(`\n======================================================`);
    console.log(`🧾 [GAMETOK SPEND RECEIPT] Job ${gameState.jobId}`);
    console.log(`├── 🎨 OpenAI Flare Images: ${spend.imageCount} cards ($${spend.imageCostUsd.toFixed(4)})`);
    console.log(`├── 🧠 Gemini 3.8 Flash: ${spend.geminiInputTokens.toLocaleString()} in / ${spend.geminiOutputTokens.toLocaleString()} out ($${spend.geminiCostUsd.toFixed(4)})${spend.geminiCachedTokens > 0 ? ` [${spend.geminiCachedTokens.toLocaleString()} cached @ 90% off]` : ''}`);
    console.log(`├── 🦴 Blender 3D Rigging: $0.0000 (Headless Local / Docker)`);
    console.log(`├── ☁️ Cloudflare R2: $0.0000 (Zero Egress Tier)`);
    console.log(`└── 💰 TOTAL SPEND: $${spend.totalUsd.toFixed(4)} (${(spend.totalUsd * 100).toFixed(1)}¢) ${spend.isMeasured ? '[REAL TELEMETRY]' : '[CALCULATED]'}`);
    console.log(`======================================================\n`);

    purgeJobSpend(gameState.jobId);
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
    
    // Smart asset auto-selection based on prompt keywords
    if (!model3dAsset && !hasAttachments) {
        const promptLower = (gameState.prompt || '').toLowerCase();
        const { CURATED_3D_MODELS } = await import('./asset-catalog.js');
        
        // Match characters by name in prompt
        for (const model of CURATED_3D_MODELS) {
            if (model.category !== 'character') continue;
            const nameLower = model.name.toLowerCase();
            const tagsMatched = model.tags.some(tag => promptLower.includes(tag.toLowerCase()));
            
            if (tagsMatched || promptLower.includes(nameLower)) {
                console.log(`🎯 [Asset Auto-Select] Matched ${model.name} for prompt keywords`);
                if (!model3dAsset) {
                    model3dAsset = model;
                } else {
                    // Second character - add to attachments
                    attachments.push({
                        type: '3d-model',
                        role: 'character',
                        url: model.url,
                        name: model.name,
                        label: model.name,
                    });
                }
            }
        }
    }

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
            assetSpecPrompt += `\nSELECTED 3D MODEL: "${model3dAsset.url}" (Name: ${model3dAsset.name || model3dAsset.title || 'Model'}). Load in Three.js using THREE.GLTFLoader. If model has animations or external animations are used, bind using THREE.AnimationMixer(gltf.scene).`;
        }
    } else {
        assetSpecPrompt += `\nNO EXPLICIT ASSETS SELECTED BY USER.\n${getCatalogSummary()}\nAI INSTRUCTION: Decide whether this concept benefits from any of the catalog assets above (characters, Mixamo animations), OR if it is best executed 100% procedurally with stylized Three.js geometry.`;
    }
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

    // Visual direction context — agy already knows the directions from the art director session.
    // We just tell it which one the user picked.
    if (jobParams.selectedDirection) {
        const dir = jobParams.selectedDirection;
        assetSpecPrompt += `\nVISUAL STYLE SELECTED BY USER: "${dir.name}". ${dir.instruction || dir.modifier || ''}`;
        if (dir.dimension) assetSpecPrompt += `\nDIMENSION: ${dir.dimension}`;
        if (dir.cameraInstruction) assetSpecPrompt += `\nCAMERA: ${dir.cameraInstruction}`;
        if (dir.colors && dir.colors.length > 0) assetSpecPrompt += `\nCOLOR PALETTE: ${dir.colors.join(', ')}`;
    }
    if (perspectiveSpec) {
        assetSpecPrompt += `\nCAMERA PERSPECTIVE: ${perspectiveSpec.name} (${perspectiveSpec.dimension}). ${perspectiveSpec.cameraInstruction}`;
    }
    assetSpecPrompt += `\nPROCEDURAL RESILIENCE: If any external asset fails to load, catch the error and instantly fall back to procedural Three.js geometry. The game MUST NEVER crash or freeze!`;

    let toolCallCount = 0;

    while (gameState.attemptCount < gameState.maxAttempts) {
        const skillsText = hermes ? hermes.getMatchingSkills() : '';

        let systemPrompt = '';
        let userPrompt = '';

        if (is2DGame) {
            systemPrompt = `You are an expert game developer building a high-speed, hyper-juicy 2D mobile game for GameTOK (running inside an Apple Metal hardware-accelerated WebKit container at up to 120 FPS).
Runtime: HTML5 Canvas 2D (Apple Metal Accelerated).
Orientation: ${orientation.toUpperCase()}.

CRITICAL ARCHITECTURE RULES:
1. OUTPUT FORMAT: Single-file complete, runnable HTML (<!DOCTYPE html><html>...</html>).
   Include header directives in HTML comments at the top:
<!-- @title: Short catchy game name -->
<!-- @orientation: ${orientation} -->
<!-- @controls: {"movement":"none","buttons":[]} -->
<!-- @thumbnail: Dynamic colorful screenshot prompt for AI cover art -->

2. FULLSCREEN MOBILE RESPONSIVE CANVAS & RETINA SCALING:
   <style>
     * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
     html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #0c0814; touch-action: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
     canvas { display: block; width: 100vw; height: 100vh; outline: none; }
   </style>
   - Auto-resize and Retina scaling:
     const dpr = Math.min(window.__GAMETOK_DPR__ || window.devicePixelRatio || 1, 3);
     canvas.width = Math.floor(window.innerWidth * dpr);
     canvas.height = Math.floor(window.innerHeight * dpr);
     ctx.scale(dpr, dpr);
   - Re-scale on window resize.

3. JUICY GAME FEEL & PROCEDURAL POLISH:
   - Squash & stretch animations, spring oscillations on tap or match (scale = 1.0 + Math.sin(t * 8) * 0.12).
   - Radial gradients, drop-shadows, glossy specular shine arcs, and rounded rects for tiles/cards/candies.
   - Particle bursts (sparkles, confetti, star bursts, glow rings) that explode and fade out on matches/points.
   - Screen shake: cameraShake decaying smoothly each frame on combos or impacts (ctx.translate(shakeX, shakeY)).
   - Floating score text (+100, COMBO x3!) floating upward and fading out.

4. HARDWARE TAPTIC & PLATFORM BRIDGE (GAMETOK NATIVE BRIDGE):
   The container injects 'window.GameTOK'. You MUST call:
   - window.GameTOK?.haptic('light') on selection / dragging.
   - window.GameTOK?.haptic('medium') on match / collect / bounce.
   - window.GameTOK?.haptic('heavy') on combo / bomb / big blast.
   - window.GameTOK?.haptic('success') on stage clear or high combo.
   - window.GameTOK?.haptic('error') on fail or game over.
   - window.GameTOK?.submitScore(score) whenever score changes.
   - window.GameTOK?.gameOver(won, score) when game ends.

5. PROCEDURAL WEB AUDIO SYNTHESIZER:
   - Zero external audio files required! Synthesize sound effects using AudioContext and oscillators:
     * pop / tap: short high sine blip
     * match / coin: pentatonic chime arpeggio
     * whoosh: noise / bandpass sweep
     * fanfare / victory: ascending major triad
   - Auto-resume AudioContext on first pointerdown / touchstart.

6. TOUCH INTERACTION:
   - Use 'pointerdown', 'pointermove', 'pointerup' for responsive mobile touch picking, dragging, and swiping.
`;
            userPrompt = `Build a high-performance, juicy 2D HTML5 Canvas GameTOK game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
        } else {
            const nativeOrientationRules = landscapeMode
                ? `VIEWPORT ORIENTATION: LANDSCAPE (Wide Aspect 16:9 / 19.5:9 widescreen).
- Camera Framing: Position camera for widescreen horizontal breadth (aspect ratio > 2.0). Set camera back along Z/Y to frame horizontal movement across the X-axis (e.g. wide arena, side-view brawler, racing track with sweeping turns).
- Controls Safe Zone: Left/Right thumb controls sit at screen edges; keep the center 60% of the screen open for character action.`
                : `VIEWPORT ORIENTATION: PORTRAIT (Vertical Aspect 9:16 mobile / TikTok style).
- Camera Framing: Deep forward Z-axis perspective or elevated 3rd-person chase camera. Action flows vertically (e.g. forward track runner, top-down arena).
- Controls Safe Zone: Thumb controls sit at the bottom 25%; keep the upper 75% open for deep 3D perspective visuals.`;

            systemPrompt = `You are a master 3D game developer building commercial-grade, hardware-accelerated 3D games for GameTOK (running inside an Apple Metal WebKit container at up to 120 FPS).
Runtime: HTML5 / Three.js (Hardware-Accelerated WebGL on Apple Metal).
Orientation: ${orientation.toUpperCase()}.
${nativeOrientationRules}

CRITICAL ARCHITECTURE RULES:
1. OUTPUT FORMAT: Single-file complete, runnable HTML (<!DOCTYPE html><html>...</html>).
   Include header directives in HTML comments at the top:
<!-- @title: Catchy Game Name -->
<!-- @orientation: ${orientation} -->
<!-- @controls: {"movement":"joystick","buttons":[{"action":"ACTION","label":"LABEL","color":"#HEX"}]} -->
<!-- @thumbnail: Cinematic description of the 3D game scene for AI cover generation -->

2. LIBRARIES VIA RELIABLE CDN:
   - Three.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
   - GLTFLoader: <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>

3. FULLSCREEN MOBILE RESPONSIVE STYLING:
   <style>
     * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
     html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #05050a; touch-action: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
     canvas { display: block; width: 100vw; height: 100vh; outline: none; }
   </style>

4. RETINA DISPLAY & THREE.JS SETUP:
   - const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
   - renderer.setPixelRatio(Math.min(window.__GAMETOK_DPR__ || window.devicePixelRatio || 1, 3));
   - renderer.setSize(window.innerWidth, window.innerHeight);
   - renderer.shadowMap.enabled = true;
   - renderer.shadowMap.type = THREE.PCFSoftShadowMap;
   - Handle window resize listener to update camera.aspect, camera.updateProjectionMatrix(), and renderer.setSize.

5. PBR LIGHTING & COMMERCIAL VISUAL QUALITY:
   - Never use flat unlit materials! Use THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.25 }) with specular highlights.
   - Dynamic lighting rig:
     * THREE.AmbientLight(0xffffff, 0.5) for balanced fill.
     * THREE.DirectionalLight(0xfff5e6, 1.2) casting soft shadows.
     * Colorful rim light or point light (e.g. cyan, magenta, or gold) for cinematic highlights on character edges.
   - Build a real, visible, expansive 3D world: stylized floors, obstacles, floating rings, collectible gems, neon tracks, or sci-fi arena geometry.
   - Particle systems: Spawn bursts of sparks/particles on collect, impact, or jump using THREE.Points or instanced meshes.
   - Camera: Dynamic third-person chase camera or isometric follower that smoothly lerps behind player action (camera.position.lerp(targetPos, 0.1); camera.lookAt(player.position)).

6. HARDWARE TAPTIC & PLATFORM BRIDGE (GAMETOK NATIVE BRIDGE):
   The container injects 'window.GameTOK'. You MUST call:
   - window.GameTOK?.haptic('light') on subtle movements / steps.
   - window.GameTOK?.haptic('medium') on coin / gem collection or button taps.
   - window.GameTOK?.haptic('heavy') on collisions, crashes, or strong hits.
   - window.GameTOK?.haptic('success') on stage clear or high combo.
   - window.GameTOK?.haptic('error') on death / game over.
   - window.GameTOK?.submitScore(score) whenever score changes.
   - window.GameTOK?.gameOver(won, score) when player finishes or dies.

7. PROCEDURAL WEB AUDIO SYNTHESIZER:
   - Zero external audio files required! Synthesize sound effects using AudioContext and oscillators:
     * jump / boost: frequency sweep upward
     * coin / gem: high pitched arpeggio chime (e.g. 523Hz -> 659Hz -> 784Hz)
     * hit / crash: low distorted noise / pitch drop
     * game over: minor chord cascade
   - Resume AudioContext on first touch / pointerdown.

8. ON-SCREEN MOBILE TOUCH CONTROLS:
   - Provide responsive on-screen touch controls: virtual floating joystick or drag area on the left thumb, action buttons on the right thumb, with active touch feedback.
   - Also listen for keyboard (Arrow keys / WASD / Space) for developer testing.
`;
            userPrompt = `Build a high-performance, hardware-accelerated 3D Three.js GameTOK game for prompt: "${gameState.prompt}"${assetSpecPrompt}`;
        }
        // Generate code via AGY Agent
        let generatedCode = '';
        const isRetry = gameState.attemptCount > 0;
        // Use the SAME forge session ID as the art director — agy already has full context
        // of the visual directions, style descriptions, and everything from the earlier stage.
        // One continuous conversation, just like ChatGPT.
        const sessionId = jobParams.sessionId || `codegen_${jobParams.jobId || gameState.jobId}`;
        console.log(`🤖 [GameTok Loop] Attempt ${gameState.attemptCount + 1}/${gameState.maxAttempts} generating code via AGY Agent${isRetry ? ' (patching previous attempt)' : ''}...`);

        try {
            let response = null;

            if (isRetry && gameState.errorHistory.length > 0) {
                // SMART RETRY: Send a focused fix instruction to the SAME session
                // agy still has its previous code in context and can patch it
                const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
                const fixPrompt = `Your previous game output had issues:\n${lastErr.errors.join('\n')}\n\nYour task: Output a COMPLETE, FULLY WORKING game from start to finish. Include:\n1. Complete <!DOCTYPE html><html><head>...</head>\n2. Full <body> with canvas/game container\n3. Complete JavaScript with all functions closed\n4. Proper </body></html> closing tags\n\nDo NOT output partial code. Do NOT stop mid-function. Output the ENTIRE working game in one response. No markdown fences.`;
                const hermesOutput = await executeHermesAgent(fixPrompt, {
                    sessionId,
                    reasoning: 'low',
                });
                response = extractScriptWithMetadata(hermesOutput, orientation);
            } else {
                // FIRST ATTEMPT: Continue from the art director session — agy already knows the visual directions
                const dirContext = jobParams.selectedDirection
                    ? `\nThe user has chosen visual direction "${jobParams.selectedDirection.name}" from the options you conceptualized earlier. Build the game matching that exact style.`
                    : '';
                const agyPrompt = `${systemPrompt}\n\nTask: ${userPrompt}${dirContext}\n\nCRITICAL REQUIREMENT: Output complete, unbroken single-file HTML (<!DOCTYPE html><html>...</html>) with closing </script> and </html> tags. Ensure the code is clean, concise, and complete without truncating mid-function. Do NOT wrap output in markdown code fences.`;
                const hermesOutput = await executeHermesAgent(agyPrompt, {
                    sessionId,
                    reasoning: 'low',
                });
                response = extractScriptWithMetadata(hermesOutput, orientation);
            }

            if (!response || !response.gameScript) {
                throw new Error('AGY Agent completed execution but failed to produce a valid gameScript in its output');
            }

            generatedCode = response.gameScript;
            if (response.title) gameState.metadata.title = response.title;
            if (response.thumbnailPrompt) gameState.metadata.thumbnailPrompt = response.thumbnailPrompt;
            if (response.controls) {
                gameState.metadata.controls = response.controls;
                const controlsJson = typeof response.controls === 'string' ? response.controls : JSON.stringify(response.controls);
                if (!generatedCode.includes('@controls:')) {
                    generatedCode = `<!-- @controls: ${controlsJson} -->\n` + generatedCode;
                }
            }
        } catch (err) {
            console.error(`💥 [GameTok Loop] Generation error:`, err.message);
            // Only clear session on complete generation failure (not validation failure)
            const sid = jobParams.sessionId || jobParams.jobId || gameState.jobId;
            clearSessionHistory(sid);
            gameState.recordAttempt({ passed: false, error: `Generation error: ${err.message}` });
            continue;
        }

        toolCallCount += 1;
        gameState.updateCode(generatedCode, gameState.currentModelOwner, `Attempt ${gameState.attemptCount + 1}`);

        // Hardware Accelerated Game Sandbox Verification
        console.log(`🔬 [GameTok Loop] Running sandbox verification attempt ${gameState.attemptCount + 1}...`);
        const sandboxResult = testGameScript(generatedCode, orientation);

        gameState.recordAttempt(sandboxResult);

        if (sandboxResult.passed) {
            console.log(`🎉 [GameTok Loop] Job ${gameState.jobId} compiled cleanly on attempt ${gameState.attemptCount}!`);
            gameState.status = 'succeeded';
            attachSpendSummary(gameState, jobParams);
            return gameState;
        } else {
            console.warn(`❌ [GameTok Loop] Attempt ${gameState.attemptCount} failed: ${sandboxResult.errors?.[0] || 'Unknown error'}`);
            // DON'T clear session history — Hermes needs to see its own output to fix it
        }
    }

    console.error(`🛑 [GameTok Loop] Job ${gameState.jobId} hit retry cap (${gameState.maxAttempts} attempts).`);
    gameState.status = 'failed_needs_review';
    attachSpendSummary(gameState, jobParams);
    return gameState;
}
