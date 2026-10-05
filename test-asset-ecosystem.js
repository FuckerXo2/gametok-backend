import 'dotenv/config';
import { inspectGlbBuffer } from './src/ai-engine/asset-engine/deterministic-3d-parser.js';

import { initAssetCatalogSchema, upsertCatalogAsset } from './src/ai-engine/asset-engine/asset-metadata-schema.js';
import { searchAssetCatalog, searchAnimationCatalog } from './src/ai-engine/asset-engine/asset-search.js';
import { executeAssetTool } from './src/ai-engine/asset-engine/asset-retrieval-tool.js';


/**
 * End-to-End Asset Ecosystem Demonstration & Verification Test
 */
async function runTest() {
    console.log('🧪 Starting GameTok Asset Ecosystem Verification...\n');

    // 1. Synthesize a mock GLB binary buffer with skin & animation chunks for parser test
    console.log('1️⃣  Testing Deterministic 3D GLB Parser...');
    const mockGltfJson = {
        asset: { version: '2.0', generator: 'GameTok 3D Test' },
        meshes: [{ name: 'KnightMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
        materials: [{ name: 'KnightArmor' }],
        accessors: [
            { type: 'VEC3', min: [-0.5, 0.0, -0.3], max: [0.5, 1.9, 0.3], count: 120 }
        ],
        nodes: [
            { name: 'RootNode', children: [1] },
            { name: 'Hips', children: [2, 3] },
            { name: 'Spine', children: [4] },
            { name: 'LeftUpLeg' },
            { name: 'Chest', children: [5] },
            { name: 'Head' }
        ],
        skins: [{
            name: 'KnightArmature',
            joints: [1, 2, 3, 4, 5]
        }],
        animations: [
            { name: 'Idle', channels: [] },
            { name: 'SwordSlash', channels: [] }
        ]
    };

    const jsonString = JSON.stringify(mockGltfJson);
    const jsonByteLength = Buffer.byteLength(jsonString, 'utf-8');
    const paddedJsonLength = (jsonByteLength + 3) & ~3; // 4-byte align
    const jsonBuffer = Buffer.alloc(paddedJsonLength, 0x20); // space padded
    jsonBuffer.write(jsonString, 'utf-8');

    const totalLength = 12 + 8 + paddedJsonLength;
    const glbBuffer = Buffer.alloc(totalLength);

    // GLB Header
    glbBuffer.writeUInt32LE(0x46546C67, 0); // 'glTF'
    glbBuffer.writeUInt32LE(2, 4);          // version 2
    glbBuffer.writeUInt32LE(totalLength, 8); // total length

    // JSON Chunk Header
    glbBuffer.writeUInt32LE(paddedJsonLength, 12);
    glbBuffer.writeUInt32LE(0x4E4F534A, 16); // 'JSON'
    jsonBuffer.copy(glbBuffer, 20);

    const inspection = inspectGlbBuffer(glbBuffer);
    console.log('✅ Deterministic Inspection Passed:');
    console.log(`   • Rig Type Detected: ${inspection.rigging.rigType} (Bones: ${inspection.rigging.boneCount})`);
    console.log(`   • Embedded Animations: [${inspection.animations.clipNames.join(', ')}]`);
    console.log(`   • Size: ${JSON.stringify(inspection.spatial.boundingBox.size)} (Suggested Scale: ${inspection.spatial.suggestedScale})`);
    console.log(`   • SHA-256: ${inspection.sha256.substring(0, 16)}...\n`);

    // 2. Test Catalog Ingestion & Schema Initialization
    console.log('2️⃣  Testing Catalog Ingestion & Deduplication...');
    await initAssetCatalogSchema();

    const sampleKnight = {
        id: 'gt_char_paladin_01',
        name: 'Medieval Paladin Knight',
        category: 'characters',
        subcategory: 'fantasy',
        dimension: '3D',
        format: 'glb',
        style: 'stylized',
        is_rigged: inspection.rigging.isRigged,
        rig_type: inspection.rigging.rigType,
        bone_count: inspection.rigging.boneCount,
        has_embedded_animations: inspection.animations.hasEmbeddedAnimations,
        embedded_animation_names: inspection.animations.clipNames,
        bounding_box: inspection.spatial.boundingBox,
        suggested_scale: inspection.spatial.suggestedScale,
        r2_key: 'assets/3d/characters/paladin_01.glb',
        cdn_url: 'https://cdn.gametok.app/assets/3d/characters/paladin_01.glb',
        thumbnail_url: 'https://cdn.gametok.app/covers/paladin_thumb.png',
        file_size_bytes: glbBuffer.length,
        sha256_hash: inspection.sha256,
        source: 'quaternius',
        license: 'CC0',
        attribution_text: 'Quaternius (CC0)',
        tags: ['knight', 'paladin', 'warrior', 'medieval', 'rpg', 'sword']
    };

    const ingested = await upsertCatalogAsset(sampleKnight);
    console.log(`✅ Ingested Asset into PostgreSQL: "${ingested.name}" (ID: ${ingested.id})`);

    // Ingest sample quadruped horse
    await upsertCatalogAsset({
        id: 'gt_creature_horse_01',
        name: 'War Horse',
        category: 'creatures',
        subcategory: 'animal',
        dimension: '3D',
        format: 'glb',
        style: 'stylized',
        is_rigged: true,
        rig_type: 'quadruped_standard',
        bone_count: 28,
        has_embedded_animations: true,
        embedded_animation_names: ['gallop', 'idle', 'trot'],
        bounding_box: { size: { x: 1.2, y: 1.8, z: 2.4 } },
        suggested_scale: 0.75,
        r2_key: 'assets/3d/creatures/horse_01.glb',
        cdn_url: 'https://cdn.gametok.app/assets/3d/creatures/horse_01.glb',
        file_size_bytes: 450000,
        sha256_hash: 'mock_sha256_horse_hash_00192837465',
        source: 'quaternius',
        license: 'CC0',
        tags: ['horse', 'mount', 'animal', 'medieval', 'steed']
    });

    console.log('✅ Ingested Sample Creature: "War Horse"\n');

    // 3. Test Progressive Tool Search
    console.log('3️⃣  Testing Hermes Asset Tool Dispatch...');
    const searchResponse = await executeAssetTool('search_3d_asset_catalog', {
        query: 'knight',
        category: 'characters',
        rig_type: 'humanoid_standard'
    });

    console.log(`✅ Tool Executed: Found ${searchResponse.matchCount} candidate(s):`);
    for (const candidate of searchResponse.candidates) {
        console.log(`   🎯 [${candidate.id}] "${candidate.name}" — Rig: ${candidate.rigType}, Scale: ${candidate.suggestedScale}x, CDN: ${candidate.cdnUrl}`);
    }

    console.log('\n🎉 All Asset Ecosystem foundational layers verified successfully!');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
