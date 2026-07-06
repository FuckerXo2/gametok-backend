import { loadMakerTemplateScaffold } from './maker-scaffolds.js';
import {
    buildIndexHtmlFromFoundation,
    buildMainTsStubFromFoundation,
} from './maker-foundation-agent.js';
import { buildThreeMainTsStubFromFoundation, buildThreeExtraFiles, buildThreeScaffoldFiles, isThreeFoundation } from './maker-threejs-stub.js';
import { validateFoundationStubSources } from './maker-foundation-stub-validator.js';
import { isFreeBuildMode } from './maker-factory-mode.js';

export async function buildKernelScaffold(foundation = {}, qualityIntent = {}) {
    // 3D foundations (dimension '3D' / threejs lanes, model-decided in Phase 1.5 —
    // NOT keyword routing) get the three.js kernel; everything else stays canvas.
    const use3D = isThreeFoundation(foundation);
    const freeBuild = isFreeBuildMode();
    // Phaser games skip canvas-kernel entirely — just use phaser-minimal (no probe contract)
    const usePhaser = !use3D && (freeBuild || foundation.engine === 'phaser3');
    const templateId = use3D ? 'threejs-kernel' 
                     : usePhaser ? 'phaser-minimal'
                     : 'canvas-kernel';
    const base = await loadMakerTemplateScaffold(templateId);
    if (!base || !Array.isArray(base.files) || base.files.length === 0) {
        throw new Error(`${templateId} base scaffold missing — cannot materialize dynamic foundation.`);
    }

    // FREE BUILD: seed the generic MULTI-FILE scaffold for 3D, and allow 2D to generate multiple files.
    const threeScaffold = (use3D && freeBuild) ? buildThreeScaffoldFiles(foundation, qualityIntent) : null;
    const generatedMain = (use3D && freeBuild)
        ? threeScaffold.find((f) => f.path === 'src/main.ts').content
        : use3D
            ? buildThreeMainTsStubFromFoundation(foundation, qualityIntent)
            : buildMainTsStubFromFoundation(foundation, qualityIntent);
    const generatedIndex = buildIndexHtmlFromFoundation(foundation);
    validateFoundationStubSources(generatedMain, generatedIndex);
    const files = base.files.map((file) => {
        const pathKey = String(file.path || '');
        if (pathKey === 'src/main.ts') {
            return { ...file, path: pathKey, content: generatedMain };
        }
        if (pathKey === 'index.html') {
            return { ...file, path: pathKey, content: generatedIndex };
        }
        if (pathKey === 'src/styles.css') {
            return { ...file, path: pathKey, content: file.content };
        }
        return file;
    });

    if (!files.some((file) => file.path === 'src/main.ts')) {
        files.push({ path: 'src/main.ts', content: generatedMain });
    }
    if (!files.some((file) => file.path === 'index.html')) {
        files.push({ path: 'index.html', content: generatedIndex });
    }

    // Seed extra files
    if (use3D && freeBuild) {
        for (const ef of threeScaffold) {
            if (ef.path !== 'src/main.ts' && !files.some((f) => f.path === ef.path)) {
                files.push(ef);
            }
        }
    } else if (use3D) {
        const extraFiles = buildThreeExtraFiles(foundation, qualityIntent);
        for (const ef of extraFiles) {
            if (!files.some((f) => f.path === ef.path)) {
                files.push(ef);
            }
        }
    }

    return {
        templateId,
        source: 'gametok-dynamic-kernel-scaffold',
        foundationId: foundation.foundationId || null,
        rule: (use3D && freeBuild)
            ? 'You are building a 3D game using Native Three.js. Load GLTF models and textures directly from public CDNs (e.g. raw.githubusercontent.com or unpkg). Do NOT use proprietary gametok wrappers. Create your scene in main.ts.'
                : use3D
                ? 'You are building a 3D game using Native Three.js. Load GLTF models and textures directly from public CDNs. Create your scene natively.'
                : freeBuild
                ? 'You are building a 2D game using Native Phaser 3. You MUST load all image and audio assets directly from public CDNs like https://labs.phaser.io/assets/ in your BootScene preload. Build a robust multi-file architecture: you own main.ts, but SHOULD use write_file to create separate files like src/scenes/GameScene.ts, src/entities/Player.ts, etc. to organize your logic cleanly.'
                : 'You are building a 2D game using Native Phaser 3. You MUST load all image and audio assets directly from public CDNs like https://labs.phaser.io/assets/ in your BootScene preload. Do NOT use proprietary gametok wrappers. Phase 2 agent owns main.ts, styles.css, and index.html.',
        files,
    };
}
