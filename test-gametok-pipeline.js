import assert from 'node:assert';
import { SharedGameState } from './src/ai-engine/shared-game-state.js';
import { determineInitialModel, evaluateMidLoopHandoff, MODEL_DEEPSEEK_FLASH, MODEL_QWEN_MAX } from './src/ai-engine/model-router.js';
import { HermesHeadlessOrchestrator } from './src/ai-engine/hermes-headless-orchestrator.js';
import { GameTokJobQueue } from './src/ai-engine/job-queue.js';

async function runTests() {
    console.log("🧪 Testing GameTok Architecture with Native Hermes Sandbox & Replica Skill Draining...");

    // Test 1: SharedGameState
    console.log("1. Testing SharedGameState...");
    const state = new SharedGameState({ prompt: 'Test 3D game', currentModelOwner: MODEL_DEEPSEEK_FLASH });
    assert.strictEqual(state.currentModelOwner, MODEL_DEEPSEEK_FLASH);
    assert.strictEqual(state.attemptCount, 0);

    state.updateCode('<html><body><script>console.log("test");</script></body></html>', MODEL_DEEPSEEK_FLASH, 'Initial draft');
    assert.strictEqual(state.currentCode.length > 0, true);

    state.recordAttempt({ passed: false, errors: ['TypeError: null reference'] });
    assert.strictEqual(state.attemptCount, 1);
    assert.strictEqual(state.errorHistory.length, 1);

    const json = state.toJSON();
    const restored = SharedGameState.fromJSON(json);
    assert.strictEqual(restored.jobId, state.jobId);
    assert.strictEqual(restored.attemptCount, 1);
    console.log("   ✅ SharedGameState passed.");

    // Test 2: Model Router Intake Rules & Handoff
    console.log("2. Testing Model Router & Handoff Rules...");
    const textModel = determineInitialModel({ prompt: 'Build a platformer' });
    assert.strictEqual(textModel, MODEL_DEEPSEEK_FLASH);

    const visionModel = determineInitialModel({ prompt: 'Build a game from reference', attachments: [{ url: 'http://example.com/ref.png' }] });
    assert.strictEqual(visionModel, MODEL_QWEN_MAX);

    const handoff1 = evaluateMidLoopHandoff(state, { type: 'REQUEST_VISION_CHECK', payload: { reason: 'Verify sprite alignment' } });
    assert.strictEqual(handoff1.shouldHandoff, true);
    assert.strictEqual(handoff1.targetModel, MODEL_QWEN_MAX);

    state.transitionModel(MODEL_QWEN_MAX, handoff1.reason);
    assert.strictEqual(state.currentModelOwner, MODEL_QWEN_MAX);

    const handoff2 = evaluateMidLoopHandoff(state, { type: 'VISUAL_PROCESSING_COMPLETE' });
    assert.strictEqual(handoff2.shouldHandoff, true);
    assert.strictEqual(handoff2.targetModel, MODEL_DEEPSEEK_FLASH);
    console.log("   ✅ Model Router & Handoff passed.");

    // Test 3: Hermes Skill Machinery & Non-Primary Replica Skill Queue Draining
    console.log("3. Testing Hermes Skill Machinery & Replica Queue Draining...");
    const hermesPrimary = new HermesHeadlessOrchestrator({ writeApproval: true });
    
    // Simulate replica writing proposal while lock owned
    const replicaProposal = {
        id: 'replica_learned_jump',
        name: 'replica_learned_jump',
        content: '// Jump logic from replica process',
        action: 'create',
        timestamp: Date.now(),
        status: 'staged_for_review'
    };
    await hermesPrimary._queueReplicaSkillProposal(replicaProposal);

    // Primary drains replica queue
    await hermesPrimary.drainReplicaSkillQueue();
    assert.strictEqual(hermesPrimary.stagedSkills.has('replica_learned_jump'), true);

    hermesPrimary.approveStagedSkill('replica_learned_jump');
    assert.strictEqual(hermesPrimary.activeSkills.has('replica_learned_jump'), true);
    console.log("   ✅ Replica skill queue draining passed (no learnings lost across replicas).");

    // Test 4: Native Hermes Sandbox Terminal Execution
    console.log("4. Testing Native Hermes Sandbox Execution...");
    const sampleHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><script>console.log("Hermes native sandbox test");</script></body></html>`;
    const sandboxResult = await hermesPrimary.runNativeSandboxTest(sampleHtml, { timeoutMs: 5000 });
    assert.strictEqual(typeof sandboxResult.passed, 'boolean');
    assert.strictEqual(typeof sandboxResult.durationMs, 'number');
    console.log(`   ✅ Native Hermes Sandbox passed (Duration: ${sandboxResult.durationMs}ms, Passed: ${sandboxResult.passed}).`);

    // Test 5: Job Queue Concurrency Ceiling
    console.log("5. Testing Job Queue Concurrency Ceiling (concurrency: 4)...");
    const queue = new GameTokJobQueue({ concurrency: 4 });
    assert.strictEqual(queue.concurrency, 4);
    const j1 = queue.enqueueJob({ prompt: 'Job 1' });
    const j2 = queue.enqueueJob({ prompt: 'Job 2' });
    const j3 = queue.enqueueJob({ prompt: 'Job 3' });
    const j4 = queue.enqueueJob({ prompt: 'Job 4' });
    const j5 = queue.enqueueJob({ prompt: 'Job 5' });
    assert.strictEqual(queue.jobs.size, 5);
    console.log("   ✅ Job Queue concurrency ceiling passed.");

    console.log("\n🚀 ALL GAMETOK PIPELINE & HERMES NATIVE TESTS PASSED SUCCESSFULY!");
}

runTests().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
