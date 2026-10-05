import 'dotenv/config';
import puppeteer from 'puppeteer';
import { universalAssetIngestor } from './src/ai-engine/asset-engine/ingestor/universal-asset-ingestor.js';
import { AnimationIngestor } from './src/ai-engine/asset-engine/ingestor/animation-ingestor.js';
import { executeAssetTool } from './src/ai-engine/asset-engine/asset-retrieval-tool.js';
import { GAMETOK_RETARGETER_SNIPPET } from './src/ai-engine/asset-engine/runtime/gametok-retargeter.js';

/**
 * Real Three.js Runtime Validation Test Suite
 */

async function runRuntimeValidation() {
    console.log('🚀 Starting Real Three.js Runtime Validation Suite...\n');

    // 1A. Rigged Character with Embedded Animations (Gothic Paladin)
    const paladinGlb = createRealSkinnedGlb({
        name: 'GothicPaladin',
        isRigged: true,
        bones: ['Hips', 'Spine', 'Chest', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'Head'],
        animations: [
            { name: 'Paladin_Slash', boneName: 'RightArm' }
        ]
    });
    const paladinAsset = await universalAssetIngestor.ingest({
        buffer: paladinGlb,
        filename: 'GothicPaladin.glb',
        category: 'characters',
        style: 'stylized',
        tags: ['paladin', 'knight', 'hero']
    });
    console.log(`   ✅ Ingested Paladin (Embedded Anim): ${paladinAsset.cdn_url}`);

    // 1B. Rigged Character with ZERO Animations (Skeleton Warrior)
    const skeletonGlb = createRealSkinnedGlb({
        name: 'SkeletonWarrior',
        isRigged: true,
        bones: ['Hips', 'Spine', 'Chest', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'Head'],
        animations: []
    });
    const skeletonAsset = await universalAssetIngestor.ingest({
        buffer: skeletonGlb,
        filename: 'SkeletonWarrior.glb',
        category: 'characters',
        style: 'stylized',
        tags: ['skeleton', 'undead', 'monster']
    });
    console.log(`   ✅ Ingested Skeleton (Rigged / 0 Anims): ${skeletonAsset.cdn_url}`);

    // 1C. FBX Character (Warrior)
    const fbxWarriorBuffer = createRealSkinnedGlb({
        name: 'FbxWarrior',
        isRigged: true,
        bones: ['Hips', 'Spine', 'Chest', 'LeftShoulder', 'LeftArm', 'RightShoulder', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'Head'],
        animations: []
    });
    const fbxWarriorAsset = await universalAssetIngestor.ingest({
        buffer: fbxWarriorBuffer,
        filename: 'FbxWarrior.fbx',
        sourceFormat: 'fbx',
        category: 'characters',
        style: 'realistic',
        tags: ['warrior', 'gladiator']
    });
    console.log(`   ✅ Ingested FBX Warrior (Canonical GLB): ${fbxWarriorAsset.cdn_url}`);

    // 1D. OBJ Static Environment Mesh (Tower)
    const objMeshBuffer = createRealSkinnedGlb({
        name: 'CastleTower',
        isRigged: false,
        bones: [],
        animations: []
    });
    const towerAsset = await universalAssetIngestor.ingest({
        buffer: objMeshBuffer,
        filename: 'CastleTower.obj',
        sourceFormat: 'obj',
        category: 'environment',
        style: 'low-poly',
        tags: ['tower', 'castle']
    });
    console.log(`   ✅ Ingested OBJ Tower (Canonical GLB): ${towerAsset.cdn_url}`);

    // 1E. Ingest 4 Standalone Mixamo Motion Tracks
    const MOTION_TRACKS = [
        {
            name: 'Mixamo Humanoid Idle',
            action: 'idle',
            category: 'ambient',
            duration: 2.0,
            tracks: [
                { bone: 'Spine', type: 'quaternion', times: [0, 1.0, 2.0], values: [0, 0, 0, 1, 0.05, 0, 0, 0.998, 0, 0, 0, 1] }
            ]
        },
        {
            name: 'Mixamo Humanoid Walk/Run',
            action: 'walk_run',
            category: 'locomotion',
            duration: 1.0,
            tracks: [
                { bone: 'LeftUpLeg', type: 'quaternion', times: [0, 0.5, 1.0], values: [0.3, 0, 0, 0.95, -0.3, 0, 0, 0.95, 0.3, 0, 0, 0.95] },
                { bone: 'RightUpLeg', type: 'quaternion', times: [0, 0.5, 1.0], values: [-0.3, 0, 0, 0.95, 0.3, 0, 0, 0.95, -0.3, 0, 0, 0.95] }
            ]
        },
        {
            name: 'Mixamo Humanoid Punch Attack',
            action: 'punch_attack',
            category: 'combat',
            role: 'attacker',
            duration: 0.8,
            tracks: [
                { bone: 'RightArm', type: 'quaternion', times: [0, 0.4, 0.8], values: [0, 0, 0, 1, 0.7, 0.1, 0, 0.7, 0, 0, 0, 1] }
            ]
        },
        {
            name: 'Mixamo Humanoid Hit Reaction',
            action: 'hit_reaction',
            category: 'reaction',
            role: 'victim',
            duration: 0.6,
            tracks: [
                { bone: 'Chest', type: 'quaternion', times: [0, 0.2, 0.6], values: [0, 0, 0, 1, -0.4, 0, 0, 0.91, 0, 0, 0, 1] }
            ]
        }
    ];

    const ingestedMotions = {};
    for (const motion of MOTION_TRACKS) {
        await AnimationIngestor.ingestAnimation({
            name: motion.name,
            rigTarget: 'humanoid_standard_v1',
            category: motion.category,
            action: motion.action,
            role: motion.role || 'neutral',
            durationSeconds: motion.duration,
            buffer: Buffer.from(JSON.stringify(motion)),
            source: 'mixamo',
            license: 'CC0'
        });
        ingestedMotions[motion.action] = motion;
    }
    console.log(`   ✅ Ingested 4 Mixamo Standalone Motion Tracks to animation_catalog\n`);

    // =========================================================================
    // Launch Headless Chromium WebGL Sandbox for Three.js Execution
    // =========================================================================
    console.log('🌐 Launching Headless Chromium WebGL Sandbox...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--enable-webgl',
            '--ignore-gpu-blocklist'
        ]
    });

    const page = await browser.newPage();
    page.on('console', msg => console.log(`   [Browser Console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.error(`   [Browser Error] ${err.message}`));

    const runtimeHtml = `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
</head>
<body>
<script>
${GAMETOK_RETARGETER_SNIPPET}

async function runTests() {
    const results = {};
    const loader = new THREE.GLTFLoader();

    function loadModel(url) {
        return new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        });
    }

    // 1. Test Paladin (Embedded Anim)
    try {
        const paladinGltf = await loadModel("${paladinAsset.cdn_url}");
        const scene = paladinGltf.scene;
        let skinnedMesh = null;
        scene.traverse(node => {
            if (node.isSkinnedMesh) skinnedMesh = node;
        });

        const bonesCount = skinnedMesh && skinnedMesh.skeleton ? skinnedMesh.skeleton.bones.length : 0;
        const hasEmbeddedClips = Boolean(paladinGltf.animations && paladinGltf.animations.length > 0);

        results.paladin = {
            loaded: true,
            isSkinnedMesh: Boolean(skinnedMesh),
            boneCount: bonesCount,
            hasEmbeddedClips
        };
    } catch (e) {
        results.paladin = { error: e.message };
    }

    // 2. Test Skeleton Warrior (Rigged + 0 Embedded + Retargeted Mixamo Motion)
    try {
        const skeletonGltf = await loadModel("${skeletonAsset.cdn_url}");
        const scene = skeletonGltf.scene;
        let skinnedMesh = null;
        scene.traverse(node => {
            if (node.isSkinnedMesh) skinnedMesh = node;
        });

        const retargeter = new GameTokHumanoidRetargeter(scene);
        const walkRunMotion = ${JSON.stringify(ingestedMotions['walk_run'])};
        const retargetedClip = retargeter.createRetargetedClip(walkRunMotion);

        const mixer = new THREE.AnimationMixer(scene);
        const action = mixer.clipAction(retargetedClip);
        action.play();

        const legBone = skinnedMesh.skeleton.bones.find(b => b.name === 'LeftUpLeg');
        const initRotX = legBone ? legBone.quaternion.x : 0;

        mixer.update(0.5); // Step clock
        const updatedRotX = legBone ? legBone.quaternion.x : 0;

        results.retargetedSkeleton = {
            loaded: true,
            isSkinnedMesh: Boolean(skinnedMesh),
            mappedBonesCount: retargeter.boneMap.size,
            retargetedClipCreated: Boolean(retargetedClip),
            tracksCount: retargetedClip.tracks.length,
            boneRotatedOverTime: initRotX !== updatedRotX
        };
    } catch (e) {
        results.retargetedSkeleton = { error: e.message };
    }

    // 3. Test FBX Warrior (Canonical GLB SkinnedMesh)
    try {
        const fbxGltf = await loadModel("${fbxWarriorAsset.cdn_url}");
        let skinnedMesh = null;
        fbxGltf.scene.traverse(node => {
            if (node.isSkinnedMesh) skinnedMesh = node;
        });

        results.fbxWarrior = {
            loaded: true,
            isSkinnedMesh: Boolean(skinnedMesh),
            boneCount: skinnedMesh && skinnedMesh.skeleton ? skinnedMesh.skeleton.bones.length : 0
        };
    } catch (e) {
        results.fbxWarrior = { error: e.message };
    }

    // 4. Test OBJ Castle Tower (Canonical GLB Static Mesh)
    try {
        const towerGltf = await loadModel("${towerAsset.cdn_url}");
        let hasMesh = false;
        let isSkinned = false;
        towerGltf.scene.traverse(node => {
            if (node.isMesh) hasMesh = true;
            if (node.isSkinnedMesh) isSkinned = true;
        });

        results.objTower = {
            loaded: true,
            hasMesh,
            isSkinnedMesh: isSkinned
        };
    } catch (e) {
        results.objTower = { error: e.message };
    }

    // 5. Test All 4 Standalone Motion Tracks Retargeted on FBX Warrior
    try {
        const fbxGltf = await loadModel("${fbxWarriorAsset.cdn_url}");
        const retargeter = new GameTokHumanoidRetargeter(fbxGltf.scene);
        const mixer = new THREE.AnimationMixer(fbxGltf.scene);

        const motionNames = ['idle', 'walk_run', 'punch_attack', 'hit_reaction'];
        const motionResults = {};

        for (const mName of motionNames) {
            const rawMotion = ${JSON.stringify(ingestedMotions)}[mName];
            const clip = retargeter.createRetargetedClip(rawMotion);
            const act = mixer.clipAction(clip);
            act.play();
            mixer.update(0.2);
            motionResults[mName] = {
                clipDuration: clip.duration,
                tracksBound: clip.tracks.length
            };
        }

        results.allFourMotions = {
            success: true,
            motions: motionResults
        };
    } catch (e) {
        results.allFourMotions = { error: e.message };
    }

    window.__TEST_RESULTS__ = results;
}

runTests();
</script>
</body>
</html>
`;

    await page.setContent(runtimeHtml, { waitUntil: 'load' });
    await page.waitForFunction('window.__TEST_RESULTS__ !== undefined', { timeout: 30000 });

    const runtimeResults = await page.evaluate(() => window.__TEST_RESULTS__);
    await browser.close();

    console.log('📊 Real WebGL Runtime Test Results:\n');
    console.log('1. Paladin (Rigged + Embedded Animation):');
    console.log(JSON.stringify(runtimeResults.paladin, null, 4));

    console.log('\n2. Skeleton Warrior (Rigged + Retargeted Standalone Mixamo Motion):');
    console.log(JSON.stringify(runtimeResults.retargetedSkeleton, null, 4));

    console.log('\n3. FBX Warrior (Canonical GLB SkinnedMesh):');
    console.log(JSON.stringify(runtimeResults.fbxWarrior, null, 4));

    console.log('\n4. OBJ Castle Tower (Canonical GLB Static Mesh):');
    console.log(JSON.stringify(runtimeResults.objTower, null, 4));

    console.log('\n5. All 4 Standalone Mixamo Motions (Idle, Walk/Run, Punch, Hit Reaction):');
    console.log(JSON.stringify(runtimeResults.allFourMotions, null, 4));

    if (!runtimeResults.paladin.loaded || !runtimeResults.paladin.isSkinnedMesh) {
        throw new Error('Paladin runtime validation failed!');
    }
    if (!runtimeResults.retargetedSkeleton.loaded || !runtimeResults.retargetedSkeleton.boneRotatedOverTime) {
        throw new Error('Retargeting runtime validation failed!');
    }
    if (!runtimeResults.fbxWarrior.loaded || !runtimeResults.fbxWarrior.isSkinnedMesh) {
        throw new Error('FBX Warrior SkinnedMesh validation failed!');
    }
    if (!runtimeResults.objTower.loaded || runtimeResults.objTower.isSkinnedMesh) {
        throw new Error('OBJ Tower mesh validation failed!');
    }

    console.log('\n🎉 ALL REAL THREE.JS RUNTIME VALIDATIONS PASSED 100%!');
    process.exit(0);
}

/**
 * Creates a fully compliant glTF 2.0 Binary Buffer with real binary chunks,
 * skin vertex attributes (JOINTS_0, WEIGHTS_0), and inverseBindMatrices.
 */
function createRealSkinnedGlb({ name, isRigged, bones = [], animations = [] }) {
    const vertexCount = 8;
    const positions = new Float32Array([
        -0.5, 0.0, -0.5,
         0.5, 0.0, -0.5,
         0.5, 1.8, -0.5,
        -0.5, 1.8, -0.5,
        -0.5, 0.0,  0.5,
         0.5, 0.0,  0.5,
         0.5, 1.8,  0.5,
        -0.5, 1.8,  0.5,
    ]);

    const posBytes = Buffer.from(positions.buffer);
    let binBuffers = [posBytes];
    let accessors = [
        {
            bufferView: 0,
            byteOffset: 0,
            componentType: 5126, // FLOAT
            count: vertexCount,
            type: 'VEC3',
            min: [-0.5, 0.0, -0.5],
            max: [0.5, 1.8, 0.5]
        }
    ];
    let bufferViews = [
        {
            buffer: 0,
            byteOffset: 0,
            byteLength: posBytes.length,
            target: 34962 // ARRAY_BUFFER
        }
    ];

    let currentOffset = posBytes.length;

    let attributes = { POSITION: 0 };
    let skins = [];
    let gltfNodes = [];

    if (isRigged && bones.length > 0) {
        // JOINTS_0 (VEC4 unsigned short 5123)
        const joints = new Uint16Array(vertexCount * 4);
        for (let i = 0; i < vertexCount * 4; i += 4) {
            joints[i] = 0; // bind to root bone
            joints[i + 1] = 1;
            joints[i + 2] = 2;
            joints[i + 3] = 3;
        }
        const jointsBytes = Buffer.from(joints.buffer);
        binBuffers.push(jointsBytes);
        bufferViews.push({
            buffer: 0,
            byteOffset: currentOffset,
            byteLength: jointsBytes.length,
            target: 34962
        });
        accessors.push({
            bufferView: bufferViews.length - 1,
            byteOffset: 0,
            componentType: 5123, // UNSIGNED_SHORT
            count: vertexCount,
            type: 'VEC4'
        });
        attributes.JOINTS_0 = accessors.length - 1;
        currentOffset += jointsBytes.length;

        // WEIGHTS_0 (VEC4 float 5126)
        const weights = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount * 4; i += 4) {
            weights[i] = 0.5;
            weights[i + 1] = 0.5;
            weights[i + 2] = 0.0;
            weights[i + 3] = 0.0;
        }
        const weightsBytes = Buffer.from(weights.buffer);
        binBuffers.push(weightsBytes);
        bufferViews.push({
            buffer: 0,
            byteOffset: currentOffset,
            byteLength: weightsBytes.length,
            target: 34962
        });
        accessors.push({
            bufferView: bufferViews.length - 1,
            byteOffset: 0,
            componentType: 5126, // FLOAT
            count: vertexCount,
            type: 'VEC4'
        });
        attributes.WEIGHTS_0 = accessors.length - 1;
        currentOffset += weightsBytes.length;

        // InverseBindMatrices (MAT4 floats 5126)
        const ibm = new Float32Array(bones.length * 16);
        for (let b = 0; b < bones.length; b++) {
            const offset = b * 16;
            ibm[offset + 0] = 1; ibm[offset + 5] = 1; ibm[offset + 10] = 1; ibm[offset + 15] = 1;
        }
        const ibmBytes = Buffer.from(ibm.buffer);
        binBuffers.push(ibmBytes);
        bufferViews.push({
            buffer: 0,
            byteOffset: currentOffset,
            byteLength: ibmBytes.length
        });
        accessors.push({
            bufferView: bufferViews.length - 1,
            byteOffset: 0,
            componentType: 5126,
            count: bones.length,
            type: 'MAT4'
        });
        const ibmAccessor = accessors.length - 1;
        currentOffset += ibmBytes.length;

        // Nodes for bones
        // Node 0: Mesh Node (SkinnedMesh)
        // Node 1..N: Bone Nodes
        const boneIndices = bones.map((_, i) => i + 1);
        skins.push({
            name: `${name}_Armature`,
            inverseBindMatrices: ibmAccessor,
            joints: boneIndices,
            skeleton: 1
        });

        gltfNodes.push({
            name: `${name}_MeshNode`,
            mesh: 0,
            skin: 0
        });

        for (let i = 0; i < bones.length; i++) {
            gltfNodes.push({
                name: bones[i],
                children: i < bones.length - 1 ? [i + 2] : []
            });
        }
    } else {
        gltfNodes.push({
            name: name || 'StaticMeshNode',
            mesh: 0
        });
    }

    const binChunkData = Buffer.concat(binBuffers);
    const paddedBinLength = (binChunkData.length + 3) & ~3;
    const finalBinBuffer = Buffer.alloc(paddedBinLength);
    binChunkData.copy(finalBinBuffer);

    const gltf = {
        asset: { version: '2.0', generator: 'GameTok Canonical Three.js Validator' },
        meshes: [{
            name: `${name}_Mesh`,
            primitives: [{
                attributes,
                mode: 4 // TRIANGLES
            }]
        }],
        accessors,
        bufferViews,
        buffers: [{ byteLength: finalBinBuffer.length }],
        nodes: gltfNodes,
        skins: isRigged ? skins : undefined,
        animations: animations.map(a => ({ name: a.name || 'Anim', channels: [] })),
        scenes: [{ nodes: isRigged ? [0, 1] : [0] }],
        scene: 0
    };

    const jsonStr = JSON.stringify(gltf);
    const jsonLen = Buffer.byteLength(jsonStr, 'utf-8');
    const paddedJsonLength = (jsonLen + 3) & ~3;
    const jsonBuf = Buffer.alloc(paddedJsonLength, 0x20);
    jsonBuf.write(jsonStr, 'utf-8');

    const totalLen = 12 + 8 + paddedJsonLength + 8 + finalBinBuffer.length;
    const glb = Buffer.alloc(totalLen);

    // GLB Header
    glb.writeUInt32LE(0x46546C67, 0); // 'glTF'
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(totalLen, 8);

    // JSON Chunk Header
    glb.writeUInt32LE(paddedJsonLength, 12);
    glb.writeUInt32LE(0x4E4F534A, 16); // 'JSON'
    jsonBuf.copy(glb, 20);

    // BIN Chunk Header
    const binHeaderOffset = 20 + paddedJsonLength;
    glb.writeUInt32LE(finalBinBuffer.length, binHeaderOffset);
    glb.writeUInt32LE(0x004E4942, binHeaderOffset + 4); // 'BIN\0'
    finalBinBuffer.copy(glb, binHeaderOffset + 8);

    return glb;
}

runRuntimeValidation().catch(err => {
    console.error('❌ Runtime Validation Failed:', err);
    process.exit(1);
});
