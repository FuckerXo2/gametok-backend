import { loadMakerTemplateScaffold } from './maker-scaffolds.js';
import {
    buildIndexHtmlFromFoundation,
    buildMainTsStubFromFoundation,
} from './maker-foundation-agent.js';
import { validateFoundationStubSources } from './maker-foundation-stub-validator.js';
import { MAKER_LANE_LIBRARY } from './maker-lane-library.js';

/**
 * Materialize the project scaffold for a library lane (canvas kernel vs Phaser grid template).
 */
export async function buildMakerScaffoldForLane(foundation = {}, qualityIntent = {}, laneSelection = null) {
    const laneId = laneSelection?.laneId || foundation?.libraryLaneId || 'mobile_arcade';
    const lane = MAKER_LANE_LIBRARY[laneId] || MAKER_LANE_LIBRARY.mobile_arcade;
    const templateId = laneSelection?.scaffoldTemplateId || lane.scaffoldTemplateId || 'canvas-kernel';

    if (templateId === 'canvas-grid-puzzle' || lane.engine === 'phaser-tilemap') {
        return buildPhaserGridScaffold(foundation, qualityIntent, lane, templateId);
    }

    if (templateId === 'canvas-runner') {
        return buildRunnerScaffold(foundation, qualityIntent, lane);
    }

    return buildCanvasKernelScaffold(foundation, qualityIntent, lane);
}

async function buildCanvasKernelScaffold(foundation, qualityIntent, lane) {
    const base = await loadMakerTemplateScaffold('canvas-kernel');
    if (!base?.files?.length) {
        throw new Error('canvas-kernel base scaffold missing — cannot materialize dynamic foundation.');
    }

    const generatedMain = buildMainTsStubFromFoundation(foundation, qualityIntent, { lane });
    const generatedIndex = buildIndexHtmlFromFoundation(foundation);
    validateFoundationStubSources(generatedMain, generatedIndex);

    const files = base.files.map((file) => {
        const pathKey = String(file.path || '');
        if (pathKey === 'src/main.ts') return { ...file, path: pathKey, content: generatedMain };
        if (pathKey === 'index.html') return { ...file, path: pathKey, content: generatedIndex };
        return file;
    });

    if (!files.some((f) => f.path === 'src/main.ts')) {
        files.push({ path: 'src/main.ts', content: generatedMain });
    }
    if (!files.some((f) => f.path === 'index.html')) {
        files.push({ path: 'index.html', content: generatedIndex });
    }

    return {
        templateId: 'canvas-kernel',
        source: 'gametok-dynamic-kernel-scaffold',
        libraryLaneId: lane.laneId,
        foundationId: foundation.foundationId || null,
        rule: `Kernel + lane ${lane.laneId}. Phase 2 owns main.ts gameplay (${lane.physicsProfile}).`,
        files,
    };
}

async function buildRunnerScaffold(foundation, qualityIntent, lane) {
    const base = await loadMakerTemplateScaffold('canvas-runner');
    if (!base?.files?.length) {
        return buildCanvasKernelScaffold(foundation, qualityIntent, lane);
    }

    return {
        templateId: 'canvas-runner',
        source: 'gametok-lane-runner-scaffold',
        libraryLaneId: lane.laneId,
        foundationId: foundation.foundationId || null,
        rule: 'Runner scaffold with side-view jump/slide loop. Phase 2 customizes src/main.ts.',
        files: base.files.map((file) => ({ ...file, path: file.path, content: file.content })),
    };
}

async function buildPhaserGridScaffold(foundation, qualityIntent, lane, templateId = 'canvas-grid-puzzle') {
    const base = await loadMakerTemplateScaffold(templateId);
    if (!base?.files?.length) {
        throw new Error(`${templateId} scaffold missing — cannot materialize Phaser tilemap lane.`);
    }

    return {
        templateId,
        source: 'gametok-phaser-tilemap-scaffold',
        libraryLaneId: lane.laneId,
        engine: 'phaser-tilemap',
        foundationId: foundation.foundationId || null,
        rule: [
            `Phaser tilemap lane (${lane.laneId}).`,
            'Keep Preloader, UIScene, and BaseGridScene patterns.',
            'Phase 2 implements grid level in a dedicated scene; preload world_tileset from asset pack.',
            'Do not delete src/scenes/Preloader.ts or assetLoader integration.',
        ].join(' '),
        files: base.files.map((file) => ({
            ...file,
            path: file.path,
            content: file.content,
        })),
    };
}
