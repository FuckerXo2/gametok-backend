import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
    buildIndexHtmlFromFoundation,
    buildMainTsStubFromFoundation,
} from './maker-foundation-agent.js';
import { loadMakerTemplateScaffold } from './maker-scaffolds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../..');

const OBJECT_LITERAL_TARGETS = ['hud', 'state'];

export const FOUNDATION_STUB_FIXTURES = [
    {
        id: 'alien_chef_duplicate_score_hud',
        note: 'Regression: hudBlocks included score while stub also hardcoded score (TS1117).',
        foundation: {
            foundationId: 'alien_chef_cosmic_diner',
            title: 'Alien Chef',
            lane: 'timed_order_cooking',
            hudBlocks: ['score', 'time', 'tips'],
            requiredState: ['score', 'gameOver', 'dayTimer', 'comboMultiplier', 'customers'],
            requiredFunctions: ['stepGame', 'resetGame', 'renderAll'],
            probeMethods: [
                { name: 'snapshot' },
                { name: 'step' },
                { name: 'reset' },
            ],
        },
    },
    {
        id: 'alien_chef_game_probes',
        note: 'Regression: extra probes referenced nonexistent state keys.',
        foundation: {
            foundationId: 'alien_chef_diner',
            title: 'Alien Chef',
            lane: 'timed_order_cooking',
            hudBlocks: ['score', 'time'],
            requiredState: ['score', 'gameOver', 'dayTimer'],
            requiredFunctions: ['stepGame', 'resetGame', 'renderAll'],
            probeMethods: [
                { name: 'snapshot' },
                { name: 'step' },
                { name: 'reset' },
                { name: 'placeIngredient' },
                { name: 'triggerCooking' },
            ],
        },
    },
    {
        id: 'alien_chef_mixed_hud_state_keys',
        note: 'Regression: HUD labels did not match requiredState key names.',
        foundation: {
            foundationId: 'alien_chef_dash',
            title: 'Alien Chef Dash',
            lane: 'timed_order_cooking',
            hudBlocks: ['score', 'time', 'reputation'],
            requiredState: ['score', 'gameOver', 'timeRemaining', 'reputation', 'earningsTarget'],
            requiredFunctions: ['stepGame', 'resetGame', 'renderAll'],
            probeMethods: [{ name: 'snapshot' }, { name: 'step' }, { name: 'reset' }],
        },
    },
    {
        id: 'alien_chef_full_customer_roster',
        note: 'Stress: many asset slots, HUD blocks, and custom probes.',
        foundation: {
            foundationId: 'alien_chef_cosmic_diner',
            title: 'Alien Chef: Cosmic Diner',
            lane: 'timed_order_cooking',
            hudBlocks: ['score', 'time', 'tips', 'reputation'],
            requiredState: [
                'score',
                'gameOver',
                'reputation',
                'dailyTips',
                'dayTimer',
                'customers',
                'ingredients',
                'prepStation',
                'comboMultiplier',
            ],
            requiredFunctions: ['stepGame', 'resetGame', 'renderAll'],
            probeMethods: [
                { name: 'snapshot' },
                { name: 'step' },
                { name: 'reset' },
                { name: 'spawnCustomer' },
                { name: 'serveOrder' },
            ],
            assetSlots: [
                { id: 'player', role: 'player', required: true, description: 'Chef sprite' },
                { id: 'background1', role: 'background', required: true, description: 'Diner interior' },
            ],
        },
    },
];

function collectDuplicateObjectKeys(source = '', objectName = '') {
    const pattern = new RegExp(`const\\s+${objectName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`, 'm');
    const match = String(source).match(pattern);
    if (!match) return [];

    const body = match[1];
    const seen = new Set();
    const duplicates = new Set();
    const keyPattern = /^\s*([A-Za-z_$][\w$]*)\s*:/gm;
    for (const entry of body.matchAll(keyPattern)) {
        const key = entry[1];
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
    }
    return [...duplicates];
}

function collectDuplicateProbeMethods(source = '') {
    const match = String(source).match(/window\.__GAMETOK_TEMPLATE_PROBE__\s*=\s*\{([\s\S]*?)\n\};/m);
    if (!match) return [];

    const body = match[1];
    const seen = new Set();
    const duplicates = new Set();
    const methodPattern = /^\s*([A-Za-z_$][\w$]*)\s*\(/gm;
    for (const entry of body.matchAll(methodPattern)) {
        const key = entry[1];
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
    }
    return [...duplicates];
}

export function analyzeFoundationStubSources(mainTs = '', indexHtml = '') {
    const issues = [];

    for (const objectName of OBJECT_LITERAL_TARGETS) {
        const duplicates = collectDuplicateObjectKeys(mainTs, objectName);
        if (duplicates.length > 0) {
            issues.push({
                id: `duplicate_${objectName}_keys`,
                severity: 'error',
                message: `Generated stub ${objectName} object has duplicate keys: ${duplicates.join(', ')}`,
            });
        }
    }

    const probeDuplicates = collectDuplicateProbeMethods(mainTs);
    if (probeDuplicates.length > 0) {
        issues.push({
            id: 'duplicate_probe_methods',
            severity: 'error',
            message: `Generated probe object has duplicate methods: ${probeDuplicates.join(', ')}`,
        });
    }

    if (!String(mainTs).includes("import './styles.css'")) {
        issues.push({
            id: 'missing_styles_import',
            severity: 'warn',
            message: 'Generated stub is missing import "./styles.css".',
        });
    }

    if (!String(indexHtml).includes('id="game-canvas"')) {
        issues.push({
            id: 'missing_game_canvas',
            severity: 'error',
            message: 'Generated index.html is missing #game-canvas.',
        });
    }

    if (!String(indexHtml).includes('position: fixed')) {
        issues.push({
            id: 'missing_critical_layout_css',
            severity: 'warn',
            message: 'Generated index.html is missing critical full-bleed layout CSS.',
        });
    }

    return {
        ok: issues.every((issue) => issue.severity !== 'error'),
        issues,
    };
}

export function buildFoundationStubSources(foundation = {}, qualityIntent = {}) {
    return {
        mainTs: buildMainTsStubFromFoundation(foundation, qualityIntent),
        indexHtml: buildIndexHtmlFromFoundation(foundation),
    };
}

export function validateFoundationStubSources(mainTs = '', indexHtml = '') {
    const analysis = analyzeFoundationStubSources(mainTs, indexHtml);
    if (!analysis.ok) {
        const message = analysis.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join(' ');
        const error = new Error(`Foundation stub preflight failed: ${message}`);
        error.code = 'FOUNDATION_STUB_STATIC_FAILED';
        error.issues = analysis.issues;
        throw error;
    }
    return analysis;
}

export function validateFoundationStub(foundation = {}, qualityIntent = {}) {
    const sources = buildFoundationStubSources(foundation, qualityIntent);
    return validateFoundationStubSources(sources.mainTs, sources.indexHtml);
}

async function symlinkBackendNodeModules(projectRoot) {
    const projectNodeModules = path.join(projectRoot, 'node_modules');
    const backendNodeModules = path.join(BACKEND_ROOT, 'node_modules');
    const stat = await fs.lstat(projectNodeModules).catch(() => null);
    if (!stat || !stat.isSymbolicLink()) {
        if (stat) await fs.rm(projectNodeModules, { recursive: true, force: true });
        if (await fs.stat(backendNodeModules).catch(() => null)) {
            await fs.symlink(backendNodeModules, projectNodeModules, 'dir');
        }
    }
}

export async function compileFoundationStubProject(mainTs = '', indexHtml = '', options = {}) {
    const tempRoot = options.projectRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'gametok-stub-preflight-'));
    const ownsTempRoot = !options.projectRoot;

    try {
        const scaffold = await loadMakerTemplateScaffold('canvas-kernel');
        if (!scaffold?.files?.length) {
            throw new Error('canvas-kernel scaffold missing for stub compile preflight.');
        }

        for (const file of scaffold.files) {
            const filePath = path.join(tempRoot, file.path);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            let content = file.content;
            if (file.path === 'src/main.ts') content = mainTs;
            if (file.path === 'index.html') content = indexHtml;
            await fs.writeFile(filePath, content, 'utf8');
        }

        await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
        await fs.writeFile(path.join(tempRoot, 'src/main.ts'), mainTs, 'utf8');
        await fs.writeFile(path.join(tempRoot, 'index.html'), indexHtml, 'utf8');

        await symlinkBackendNodeModules(tempRoot);

        execSync('npx tsc --noEmit', {
            cwd: tempRoot,
            stdio: 'pipe',
            timeout: options.timeoutMs || 60_000,
        });

        return { ok: true, projectRoot: tempRoot };
    } catch (error) {
        const stderr = error.stderr?.toString?.() || '';
        const stdout = error.stdout?.toString?.() || '';
        const rawOutput = `${stdout}\n${stderr}`.trim();
        const tsErrors = rawOutput
            .split('\n')
            .filter((line) => /^src\/.*\(\d+,\d+\):\s*error\s+TS\d+/.test(line) || /^error\s+TS\d+/.test(line))
            .slice(0, 15);
        const compileError = new Error(
            `Foundation stub TypeScript preflight failed with ${tsErrors.length || 1} error(s):\n${(tsErrors.join('\n') || rawOutput).slice(0, 2000)}`
        );
        compileError.code = 'FOUNDATION_STUB_TSC_FAILED';
        compileError.buildErrors = tsErrors;
        compileError.rawOutput = rawOutput.slice(0, 4000);
        throw compileError;
    } finally {
        if (ownsTempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
        }
    }
}

export async function runFoundationStubPreflight(foundation = {}, qualityIntent = {}, options = {}) {
    const sources = buildFoundationStubSources(foundation, qualityIntent);
    const staticAnalysis = validateFoundationStubSources(sources.mainTs, sources.indexHtml);

    if (options.compile === false) {
        return { ...staticAnalysis, compiled: false, sources };
    }

    await compileFoundationStubProject(sources.mainTs, sources.indexHtml, options);
    return { ...staticAnalysis, compiled: true, sources };
}

export async function runFoundationStubFixtureChecks(options = {}) {
    const results = [];
    for (const fixture of FOUNDATION_STUB_FIXTURES) {
        const qualityIntent = { title: fixture.foundation.title || fixture.id };
        try {
            await runFoundationStubPreflight(fixture.foundation, qualityIntent, options);
            results.push({ id: fixture.id, ok: true, note: fixture.note });
        } catch (error) {
            results.push({
                id: fixture.id,
                ok: false,
                note: fixture.note,
                message: error?.message || String(error),
            });
        }
    }
    return results;
}
