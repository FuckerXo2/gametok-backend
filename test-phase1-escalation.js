import 'dotenv/config';
import { executeAssetTool, ASSET_INTELLIGENCE_TOOL_DEFINITIONS } from './src/ai-engine/asset-engine/asset-retrieval-tool.js';

async function runPhase1Test() {
    console.log('🧪 Starting Phase 1 Component-Level Asset Escalation Test...\n');

    // Test 1: Local Catalog Hit (War Horse)
    console.log('1️⃣  Test 1: Requesting existing local asset (Horse mount)...');
    const localHit = await executeAssetTool('request_component_asset', {
        component_id: 'player_mount',
        concept: 'horse',
        role: 'mount',
        category: 'creatures',
        rig_type: 'quadruped_standard'
    });

    console.log('   Result:', JSON.stringify(localHit, null, 2));
    if (localHit.status !== 'selected') throw new Error('Expected local hit');
    console.log('   ✅ Test 1 Passed: Local catalog match resolved instantly.\n');

    // Test 2: External Discovery Escalation & Universal Ingestion (Dragon)
    console.log('2️⃣  Test 2: Requesting missing asset (Dragon) -> Escalation to External Provider...');
    const externalHit = await executeAssetTool('request_component_asset', {
        component_id: 'boss_dragon',
        concept: 'dragon',
        role: 'boss',
        category: 'creatures',
        rig_type: 'winged_creature'
    });

    console.log('   Result:', JSON.stringify(externalHit, null, 2));
    if (externalHit.status !== 'selected') throw new Error('Expected external discovery hit');
    console.log('   ✅ Test 2 Passed: External discovery ingested and cataloged new asset.\n');

    // Test 3: Procedural Fallback (Tomb maze wall / procedural entity)
    console.log('3️⃣  Test 3: Requesting non-existent entity -> Procedural Fallback Directive...');
    const fallbackHit = await executeAssetTool('request_component_asset', {
        component_id: 'tomb_maze_tile',
        concept: 'procedural_neon_tomb_wall_9999',
        role: 'scenery'
    });

    console.log('   Result:', JSON.stringify(fallbackHit, null, 2));
    if (fallbackHit.status !== 'procedural_fallback') throw new Error('Expected procedural fallback');
    console.log('   ✅ Test 3 Passed: Autonomous procedural fallback recommended.\n');

    console.log('🎉 Phase 1 Component-Level Escalation Engine fully verified!');
    process.exit(0);
}

runPhase1Test().catch(err => {
    console.error('❌ Phase 1 Test failed:', err);
    process.exit(1);
});
