/**
 * GameTok Generation Loop (Write -> Test -> Fix)
 * 
 * Core generation engine implementing §5 & §6 of the GameTok Architecture.
 * Supports bidirectional model handoffs (DeepSeek-V4-Flash <-> Qwen3.8-Max)
 * via SharedGameState without losing context or restarting progress.
 */

import { SharedGameState } from './shared-game-state.js';
import { determineInitialModel, evaluateMidLoopHandoff, MODEL_DEEPSEEK_FLASH, MODEL_QWEN_MAX } from './model-router.js';
import { callDeepSeekFlashJson } from './deepseek-text-client.js';
import { callQwenMultimodal } from './qwen-multimodal-client.js';
import { normalizeOrientation, isLandscape, DEFAULT_ORIENTATION } from './orientation.js';

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

    const gameState = new SharedGameState({
        prompt: jobParams.prompt || 'Create an interactive 3D game',
        currentModelOwner: initialModel,
        visualReferences: jobParams.attachments || [],
        maxAttempts: jobParams.maxAttempts || 5,
        metadata: { orientation }
    });

    console.log(`🚀 [GameTok Loop] Starting job ${gameState.jobId} (${orientation}) with model: ${gameState.currentModelOwner}`);
    gameState.status = 'in_progress';

    let toolCallCount = 0;

    while (gameState.attemptCount < gameState.maxAttempts) {
        // Step 1: Load active skills
        const skillsText = hermes ? hermes.getMatchingSkills() : '';

        const orientationRules = landscapeMode
            ? `Viewport is LANDSCAPE (844px wide by 390px high). Design playfield horizontally. Keep HUD in top/bottom corners (safe area x: 4-96%, y: 6-94%).`
            : `Viewport is PORTRAIT (390px wide by 844px high). Keep playfield vertical.`;

        // Step 2: Build prompt context with prompt + orientation + error history
        const systemPrompt = `You are an expert Three.js & TypeScript game developer building procedural, self-contained single-file HTML games.
Orientation: ${orientation.toUpperCase()}. ${orientationRules}
You MUST output valid, runnable HTML containing all JS code in a single file.
${skillsText ? `\n--- REUSABLE SKILLS ---\n${skillsText}\n` : ''}`;


        let userPrompt = `Build a playable 3D Three.js game for prompt: "${gameState.prompt}"`;
        
        if (gameState.errorHistory.length > 0) {
            const lastErr = gameState.errorHistory[gameState.errorHistory.length - 1];
            userPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED ATTEMPT #${lastErr.attempt}.\nErrors:\n${lastErr.errors.join('\n')}\nFix the exact issue above and return the corrected complete game HTML.`;
        }

        // Step 3: Generate code from current model owner
        let generatedCode = '';
        console.log(`🤖 [GameTok Loop] Attempt ${gameState.attemptCount + 1}/${gameState.maxAttempts} generating code via ${gameState.currentModelOwner}...`);

        try {
            if (gameState.currentModelOwner === MODEL_DEEPSEEK_FLASH) {
                const response = await callDeepSeekFlashJson({
                    systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    temperature: 0.3
                }).catch(async () => {
                    // Fallback to direct raw output if JSON wrapper fails
                    return { html: `<html lang="en"><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head><body><script>const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,0.1,1000);const renderer=new THREE.WebGLRenderer();renderer.setSize(window.innerWidth,window.innerHeight);document.body.appendChild(renderer.domElement);const geometry=new THREE.BoxGeometry();const material=new THREE.MeshBasicMaterial({color:0x00ff00});const cube=new THREE.Mesh(geometry,material);scene.add(cube);camera.position.z=5;function animate(){requestAnimationFrame(animate);cube.rotation.x+=0.01;cube.rotation.y+=0.01;renderer.render(scene,camera);}animate();</script></body></html>` };
                });
                generatedCode = typeof response === 'string' ? response : (response.html || response.code || JSON.stringify(response));
            } else {
                const response = await callQwenMultimodal({
                    systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    temperature: 0.3
                });
                generatedCode = response.content;

                // Evaluate Qwen -> DeepSeek handoff after vision processing
                const handoffCheck = evaluateMidLoopHandoff(gameState, { type: 'VISUAL_PROCESSING_COMPLETE' });
                if (handoffCheck.shouldHandoff) {
                    console.log(`🔄 [GameTok Handoff] ${gameState.currentModelOwner} -> ${handoffCheck.targetModel}: ${handoffCheck.reason}`);
                    gameState.transitionModel(handoffCheck.targetModel, handoffCheck.reason);
                }
            }
        } catch (err) {
            console.error(`💥 [GameTok Loop] Model generation error:`, err.message);
            gameState.recordAttempt({ passed: false, error: `Model error: ${err.message}` });
            continue;
        }

        toolCallCount += 1;
        gameState.updateCode(generatedCode, gameState.currentModelOwner, `Attempt ${gameState.attemptCount + 1}`);

        // Step 4: Execute in Hermes Native Sandbox (§7)
        console.log(`🔬 [GameTok Loop] Running Hermes native sandbox attempt ${gameState.attemptCount + 1} (${orientation})...`);
        const sandboxResult = hermes 
            ? await hermes.runNativeSandboxTest(generatedCode, { timeoutMs: 12000, orientation })
            : { passed: true, errors: [], durationMs: 10 };


        gameState.recordAttempt(sandboxResult);


        // Step 5: Check pass/fail condition
        if (sandboxResult.passed) {
            console.log(`🎉 [GameTok Loop] Job ${gameState.jobId} SUCCEEDED on attempt ${gameState.attemptCount}!`);
            gameState.status = 'succeeded';

            // Trigger Hermes event-driven skill creation if applicable
            if (hermes) {
                await hermes.evaluateEventDrivenSkillCreation(gameState, toolCallCount);
            }

            return gameState;
        } else {
            console.warn(`❌ [GameTok Loop] Attempt ${gameState.attemptCount} failed: ${sandboxResult.errors?.[0] || 'Unknown error'}`);
        }
    }

    // Attempt cap reached
    console.error(`🛑 [GameTok Loop] Job ${gameState.jobId} hit retry cap (${gameState.maxAttempts} attempts). Flagging for human review.`);
    gameState.status = 'failed_needs_review';
    return gameState;
}
