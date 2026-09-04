import { RemixClassifier } from './remix-classifier.js';
import { SurgicalPatcher } from './surgical-patcher.js';
import { GameVersionManager } from './game-version-manager.js';
import { ManifestSynthesizer } from './manifest-synthesizer.js';
import { HermesHeadlessOrchestrator } from '../../hermes-headless-orchestrator.js';
import { QwenGameVisualReviewer } from '../visual/qwen-game-reviewer.js';

/**
 * GameTok Surgical Remix Engine
 * 
 * Executes surgical, component-level game remixes with version preservation,
 * animation retargeting, and sandbox verification.
 */
export class RemixEngine {
    /**
     * Execute a surgical remix on an existing game
     * @param {object} params
     * @param {string} params.gameId Target game ID
     * @param {string} params.prompt User remix instructions
     * @param {string} params.existingCode Current HTML payload
     * @param {object} [params.existingManifest] Current component manifest
     * @param {string} [params.orientation] 'portrait' | 'landscape'
     * @param {HermesHeadlessOrchestrator} [params.hermes]
     * @returns {Promise<{ success: boolean, gameId: string, version: number, code: string, manifest: object, diffDescription: string, screenshot?: string }>}
     */
    static async executeRemix({ gameId, prompt, existingCode, existingManifest = null, orientation = 'portrait', hermes = null }) {
        console.log(`🌀 [Remix Engine] Executing remix for game "${gameId}": "${prompt}"`);

        // 1. Ensure existing manifest exists (synthesize if legacy game)
        const manifest = existingManifest 
            ? existingManifest
            : ManifestSynthesizer.synthesize({ gameId, code: existingCode, orientation });

        const baseVersion = manifest.version || 1;

        // 2. Save previous version snapshot before modifying
        await GameVersionManager.saveVersionSnapshot({
            gameId,
            versionNumber: baseVersion,
            code: existingCode,
            manifest,
            changeSummary: 'Pre-remix baseline'
        });

        // 3. Classify surgical operation
        const classification = RemixClassifier.classify({ prompt, manifest, code: existingCode });
        console.log(`   🎯 Operation Classified: ${classification.operation} (${classification.description}) [Model: ${classification.model}]`);

        // 4. Apply surgical modification
        const patchResult = await SurgicalPatcher.applySurgicalPatch({
            prompt,
            existingCode,
            existingManifest: manifest,
            classification
        });

        console.log(`   🛠️  Surgical Patch Applied: ${patchResult.diffDescription}`);

        // 5. Native Puppeteer Sandbox Verification
        const orchestrator = hermes || new HermesHeadlessOrchestrator();
        console.log(`   🔬 Verifying remixed game in native sandbox...`);
        const sandboxResult = await orchestrator.runNativeSandboxTest(patchResult.updatedCode, {
            orientation,
            timeoutMs: 15000
        });

        if (!sandboxResult.passed) {
            console.error(`   ❌ Sandbox Verification Failed: ${sandboxResult.errors?.[0] || 'Unknown error'}`);
            // Rollback is automatic since we do not overwrite the version
            throw new Error(`Remix failed sandbox validation: ${sandboxResult.errors?.join(', ') || 'Runtime execution error'}`);
        }

        console.log(`   ✅ Sandbox Passed in ${sandboxResult.durationMs}ms`);

        // 6. Visual Review via Qwen (ONLY if visual/aesthetic changes were made)
        if (classification.requiresQwenVisual && sandboxResult.screenshot) {
            console.log(`   👁️  Running Qwen Visual Review on remixed visual overhaul...`);
            try {
                const visualReview = await QwenGameVisualReviewer.reviewGameRender({
                    screenshotBase64: sandboxResult.screenshot,
                    prompt,
                    orientation
                });
                console.log(`   🎨 Visual Quality Score: ${(visualReview.visualQualityScore * 100).toFixed(0)}% — "${visualReview.critique}"`);
            } catch (vErr) {
                console.warn(`   ⚠️ Visual review skipped: ${vErr.message}`);
            }
        } else {
            console.log(`   ⏩ Logic / Component swap verified cleanly; skipped redundant visual review.`);
        }

        // 7. Save and commit new version snapshot
        const newVersion = patchResult.updatedManifest.version;
        await GameVersionManager.saveVersionSnapshot({
            gameId,
            versionNumber: newVersion,
            code: patchResult.updatedCode,
            manifest: patchResult.updatedManifest,
            changeSummary: patchResult.diffDescription
        });

        console.log(`🎉 [Remix Engine] Successfully created version ${newVersion} for game "${gameId}"!\n`);

        return {
            success: true,
            gameId,
            version: newVersion,
            code: patchResult.updatedCode,
            manifest: patchResult.updatedManifest.toJSON(),
            diffDescription: patchResult.diffDescription,
            screenshot: sandboxResult.screenshot || null
        };
    }
}
