import 'dotenv/config';
import { universalAssetIngestor } from './src/ai-engine/asset-engine/ingestor/universal-asset-ingestor.js';
import { executeAssetTool } from './src/ai-engine/asset-engine/asset-retrieval-tool.js';
import { searchAssetCatalog, searchAnimationCatalog } from './src/ai-engine/asset-engine/asset-search.js';

/**
 * Format-Agnostic Asset Ingestion & Real Retrieval Verification Test
 */
async function runRealTestSuite() {
    console.log('🧪 Starting Comprehensive Format-Agnostic Asset Test Suite...\n');

    // =========================================================================
    // Test 1: GLB Character with Embedded Animations
    // =========================================================================
    console.log('1️⃣  Test 1: Ingesting GLB with embedded animations (Knight)...');
    const glbWithAnims = createMockGlb({
        name: 'GothicPaladin',
        isRigged: true,
        jointNames: ['Hips', 'Spine', 'Chest', 'LeftArm', 'LeftLeg', 'Head'],
        animations: ['idle_stance', 'greatsword_slash', 'shield_block']
    });

    const ingestedGlb1 = await universalAssetIngestor.ingest({
        buffer: glbWithAnims,
        filename: 'GothicPaladin.glb',
        category: 'characters',
        style: 'stylized',
        tags: ['paladin', 'knight', 'gothic', 'warrior', 'sword']
    });

    console.log(`   ✅ Ingested: "${ingestedGlb1.name}" (ID: ${ingestedGlb1.id})`);
    console.log(`      • Rig Type: ${ingestedGlb1.rig_type} (Bones: ${ingestedGlb1.bone_count})`);
    console.log(`      • Embedded Animations: [${ingestedGlb1.embedded_animation_names.join(', ')}]`);
    console.log(`      • Real CDN URL: ${ingestedGlb1.cdn_url}\n`);

    if (!ingestedGlb1.has_embedded_animations || ingestedGlb1.embedded_animation_names.length !== 3) {
        throw new Error('Test 1 failed: embedded animations not correctly cataloged.');
    }

    // =========================================================================
    // Test 2: GLB Rigged Character with ZERO Embedded Animations
    // =========================================================================
    console.log('2️⃣  Test 2: Ingesting GLB rigged with ZERO animations (Skeleton Warrior)...');
    const glbRiggedNoAnims = createMockGlb({
        name: 'SkeletonWarrior',
        isRigged: true,
        jointNames: ['Hips', 'Spine', 'Chest', 'LeftArm', 'LeftLeg', 'Head'],
        animations: [] // 0 animations
    });

    const ingestedGlb2 = await universalAssetIngestor.ingest({
        buffer: glbRiggedNoAnims,
        filename: 'SkeletonWarrior.glb',
        category: 'characters',
        style: 'stylized',
        tags: ['skeleton', 'undead', 'warrior']
    });

    console.log(`   ✅ Ingested: "${ingestedGlb2.name}" (ID: ${ingestedGlb2.id})`);
    console.log(`      • is_rigged: ${ingestedGlb2.is_rigged}`);
    console.log(`      • has_embedded_animations: ${ingestedGlb2.has_embedded_animations}`);
    console.log(`      • rig_type: ${ingestedGlb2.rig_type}\n`);

    if (!ingestedGlb2.is_rigged || ingestedGlb2.has_embedded_animations) {
        throw new Error('Test 2 failed: rigged character with 0 animations was misclassified.');
    }

    // =========================================================================
    // Test 3: Wavefront OBJ Unrigged Static Mesh
    // =========================================================================
    console.log('3️⃣  Test 3: Ingesting Wavefront OBJ unrigged mesh (Medieval Castle Tower)...');
    const mockObjContent = `
# Wavefront OBJ Medieval Tower
v -2.5 0.0 -2.5
v 2.5 0.0 -2.5
v 2.5 0.0 2.5
v -2.5 0.0 2.5
v -2.0 12.0 -2.0
v 2.0 12.0 -2.0
v 2.0 12.0 2.0
v -2.0 12.0 2.0
vn 0.0 1.0 0.0
f 1/1/1 2/2/1 3/3/1
f 1/1/1 3/3/1 4/4/1
f 5/1/1 6/2/1 7/3/1
f 5/1/1 7/3/1 8/4/1
usemtl StoneBrick
`;
    const objBuffer = Buffer.from(mockObjContent, 'utf-8');

    const ingestedObj = await universalAssetIngestor.ingest({
        buffer: objBuffer,
        filename: 'CastleTower.obj',
        category: 'environment',
        style: 'low-poly',
        tags: ['castle', 'tower', 'building', 'stone', 'medieval']
    });

    console.log(`   ✅ Ingested: "${ingestedObj.name}" (ID: ${ingestedObj.id})`);
    console.log(`      • Source format: obj → Canonical runtime format: ${ingestedObj.format}`);
    console.log(`      • is_rigged: ${ingestedObj.is_rigged} (Rig: ${ingestedObj.rig_type})`);
    console.log(`      • Bounding Box Size: ${JSON.stringify(ingestedObj.bounding_box.size)}`);
    console.log(`      • Suggested Scale: ${ingestedObj.suggested_scale}x\n`);

    if (ingestedObj.is_rigged || ingestedObj.format !== 'glb') {
        throw new Error('Test 3 failed: OBJ asset normalization failed.');
    }

    // =========================================================================
    // Test 4: Autodesk FBX Standalone Motion Track (Mixamo Style Animation)
    // =========================================================================
    console.log('4️⃣  Test 4: Ingesting Autodesk FBX Standalone Motion Track (Mixamo Sprint)...');
    const mockFbxAnimContent = `
; FBX 7.4.0 project file (Mixamo Standalone Animation)
FBXHeaderExtension: {
    FBXVersion: 7400
}
Objects: {
    AnimationStack: "Sprint_Forward" {
        Properties70: {
            P: "Description", "KString", "", "", "Mixamo Sprint Forward"
        }
    }
    AnimationLayer: "BaseLayer" {
    }
    AnimCurve: "SubAnim" {
    }
}
`;
    const fbxAnimBuffer = Buffer.from(mockFbxAnimContent, 'utf-8');

    const ingestedAnim = await universalAssetIngestor.ingest({
        buffer: fbxAnimBuffer,
        filename: 'Mixamo_Humanoid_Sprint.fbx',
        targetType: 'standalone_animation',
        animationMetadata: {
            rigTarget: 'humanoid_standard_v1',
            category: 'locomotion',
            action: 'sprint',
            role: 'locomotion',
            durationSeconds: 0.95
        }
    });

    console.log(`   ✅ Ingested Reusable Motion: "${ingestedAnim.name}" (ID: ${ingestedAnim.id})`);
    console.log(`      • Target Rig: ${ingestedAnim.rig_target}`);
    console.log(`      • Action: ${ingestedAnim.action} (${ingestedAnim.category})`);
    console.log(`      • CDN Motion URL: ${ingestedAnim.cdn_url}\n`);

    // =========================================================================
    // Test 5: Reusable Animation Retrieval via Hermes Tool
    // =========================================================================
    console.log('5️⃣  Test 5: Querying shared animation catalog for humanoid locomotion...');
    const animSearch = await executeAssetTool('search_animation_catalog', {
        rig_target: 'humanoid_standard_v1',
        category: 'locomotion'
    });

    console.log(`   ✅ Found ${animSearch.matchCount} shared animation track(s):`);
    for (const anim of animSearch.animations) {
        console.log(`      🎬 [${anim.id}] "${anim.name}" (Action: ${anim.action}) → ${anim.cdn_url}`);
    }
    console.log('');

    // =========================================================================
    // Test 6: Instant Future Reuse (Querying Previously Ingested Paladin)
    // =========================================================================
    console.log('6️⃣  Test 6: Requesting Gothic Paladin via Hermes Tool (Proving Local Reuse)...');
    const reuseQuery = await executeAssetTool('request_component_asset', {
        component_id: 'player_hero',
        concept: 'gothic paladin',
        role: 'player',
        rig_type: 'humanoid_standard'
    });

    console.log('   Result:', JSON.stringify(reuseQuery, null, 2));
    if (reuseQuery.status !== 'selected' || reuseQuery.source !== 'local_catalog') {
        throw new Error('Test 6 failed: previously ingested asset was not reused locally.');
    }
    console.log('   ✅ Test 6 Passed: Asset reused locally with zero re-download.\n');

    console.log('🎉 All Format-Agnostic Ingestion & Real R2 Retrieval tests PASSED 100%!');
    process.exit(0);
}

function createMockGlb({ name, isRigged, jointNames = [], animations = [] }) {
    const gltf = {
        asset: { version: '2.0', generator: 'GameTok Test Generator' },
        meshes: [{ name: `${name}_Mesh`, primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ type: 'VEC3', min: [-0.6, 0.0, -0.4], max: [0.6, 1.9, 0.4], count: 64 }],
        nodes: isRigged ? jointNames.map((jName, i) => ({ name: jName, children: i < jointNames.length - 1 ? [i + 1] : [] })) : [{ name: name, mesh: 0 }],
        skins: isRigged ? [{ name: `${name}_Armature`, joints: jointNames.map((_, i) => i) }] : [],
        animations: animations.map(aName => ({ name: aName, channels: [] })),
        scenes: [{ nodes: [0] }],
        scene: 0
    };

    const jsonStr = JSON.stringify(gltf);
    const jsonLen = Buffer.byteLength(jsonStr, 'utf-8');
    const paddedLen = (jsonLen + 3) & ~3;
    const jsonBuf = Buffer.alloc(paddedLen, 0x20);
    jsonBuf.write(jsonStr, 'utf-8');

    const totalLen = 12 + 8 + paddedLen;
    const glb = Buffer.alloc(totalLen);
    glb.writeUInt32LE(0x46546C67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(totalLen, 8);
    glb.writeUInt32LE(paddedLen, 12);
    glb.writeUInt32LE(0x4E4F534A, 16);
    jsonBuf.copy(glb, 20);

    return glb;
}

runRealTestSuite().catch(err => {
    console.error('❌ Test Suite Failed:', err);
    process.exit(1);
});
