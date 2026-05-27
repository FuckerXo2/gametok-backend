import { loadMakerTemplateScaffold } from './maker-scaffolds.js';
import {
    buildIndexHtmlFromFoundation,
    buildMainTsStubFromFoundation,
} from './maker-foundation-agent.js';
import { validateFoundationStubSources } from './maker-foundation-stub-validator.js';

export async function buildKernelScaffold(foundation = {}, qualityIntent = {}) {
    const base = await loadMakerTemplateScaffold('canvas-kernel');
    if (!base || !Array.isArray(base.files) || base.files.length === 0) {
        throw new Error('canvas-kernel base scaffold missing — cannot materialize dynamic foundation.');
    }

    const generatedMain = buildMainTsStubFromFoundation(foundation, qualityIntent);
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
        return file;
    });

    if (!files.some((file) => file.path === 'src/main.ts')) {
        files.push({ path: 'src/main.ts', content: generatedMain });
    }
    if (!files.some((file) => file.path === 'index.html')) {
        files.push({ path: 'index.html', content: generatedIndex });
    }

    return {
        templateId: 'canvas-kernel',
        source: 'gametok-dynamic-kernel-scaffold',
        foundationId: foundation.foundationId || null,
        rule: 'Kernel files (bootstrap, assetLoader, types) are read-only. Phase 2 agent owns main.ts, styles.css, and index.html structure.',
        files,
    };
}
