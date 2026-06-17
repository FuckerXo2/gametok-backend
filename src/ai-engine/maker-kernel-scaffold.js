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
    const templateId = use3D ? 'threejs-kernel' : 'canvas-kernel';
    const base = await loadMakerTemplateScaffold(templateId);
    if (!base || !Array.isArray(base.files) || base.files.length === 0) {
        throw new Error(`${templateId} base scaffold missing — cannot materialize dynamic foundation.`);
    }

    // FREE BUILD 3D: seed the generic MULTI-FILE scaffold (entry + game + core +
    // systems + entities + world) — a playable base the model specializes. Single
    // file (flag off / 2D) keeps the original in-place stub.
    const freeBuild3D = use3D && isFreeBuildMode();
    const threeScaffold = freeBuild3D ? buildThreeScaffoldFiles(foundation, qualityIntent) : null;
    const generatedMain = freeBuild3D
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

    // Single-file 3D: buildThreeExtraFiles() returns [] (no scene.ts/mechanics.ts).
    // The whole game lives in main.ts — kept as a call site in case extra read-only
    // helpers are ever reintroduced, but never splits gameplay across files.
    if (freeBuild3D) {
        // Seed the multi-file scaffold modules (everything except main.ts, already set).
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
        rule: freeBuild3D
            ? 'Kernel files (bootstrap, assetLoader, threeAssets, types) are read-only. Phase 2 agent OWNS the multi-file game under src/ (game/, core/, systems/, entities/, world/) plus a thin main.ts entry. createThreeStage() provides renderer/camera/lights/shadows; keep main.ts exporting stepGame/renderAll/resetGame and setting __GAMETOK_TEMPLATE_PROBE__. Specialize the seeded modules into the requested game.'
            : use3D
                ? 'Kernel files (bootstrap, assetLoader, threeAssets, types) are read-only. Phase 2 agent owns the entire game in src/main.ts (single file — state, refs, loop, probe are pre-wired; fill the TODO functions in place). createThreeStage() owns renderer/camera/lights/resize — extend it, never delete it.'
                : 'Kernel files (bootstrap, assetLoader, types) are read-only. Phase 2 agent owns main.ts, styles.css, and index.html structure.',
        files,
    };
}
