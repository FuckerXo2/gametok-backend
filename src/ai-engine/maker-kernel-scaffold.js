import { loadMakerTemplateScaffold } from './maker-scaffolds.js';
import {
    buildIndexHtmlFromFoundation,
    buildMainTsStubFromFoundation,
} from './maker-foundation-agent.js';
import { buildThreeMainTsStubFromFoundation, buildThreeExtraFiles, isThreeFoundation } from './maker-threejs-stub.js';
import { validateFoundationStubSources } from './maker-foundation-stub-validator.js';

export async function buildKernelScaffold(foundation = {}, qualityIntent = {}) {
    // 3D foundations (dimension '3D' / threejs lanes, model-decided in Phase 1.5 —
    // NOT keyword routing) get the three.js kernel; everything else stays canvas.
    const use3D = isThreeFoundation(foundation);
    const templateId = use3D ? 'threejs-kernel' : 'canvas-kernel';
    const base = await loadMakerTemplateScaffold(templateId);
    if (!base || !Array.isArray(base.files) || base.files.length === 0) {
        throw new Error(`${templateId} base scaffold missing — cannot materialize dynamic foundation.`);
    }

    const generatedMain = use3D
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

    // For structured 3D lanes (runner, racer) inject scene.ts + mechanics.ts stubs.
    // These are the only files Phase 2 writes — main.ts is pre-wired and read-only for those lanes.
    if (use3D) {
        const extraFiles = buildThreeExtraFiles(foundation, qualityIntent);
        for (const ef of extraFiles) {
            if (!files.some((f) => f.path === ef.path)) {
                files.push(ef);
            }
        }
    }

    const isRunner = String(foundation?.lane || '').toLowerCase().match(/runner|surfer|dash/);
    const isRacer  = String(foundation?.lane || '').toLowerCase().match(/racer|racing|kart/);
    const agentOwnsFiles = use3D && (isRunner || isRacer)
        ? 'src/scene.ts and src/mechanics.ts'
        : 'main.ts, styles.css, and index.html structure';

    return {
        templateId,
        source: 'gametok-dynamic-kernel-scaffold',
        foundationId: foundation.foundationId || null,
        rule: use3D
            ? `Kernel files (bootstrap, assetLoader, threeAssets, types) are read-only. Phase 2 agent owns ${agentOwnsFiles}. createThreeStage() owns renderer/camera/lights/resize — extend it, never delete it.`
            : 'Kernel files (bootstrap, assetLoader, types) are read-only. Phase 2 agent owns main.ts, styles.css, and index.html structure.',
        files,
    };
}
