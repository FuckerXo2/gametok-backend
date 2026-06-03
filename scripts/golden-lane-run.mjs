#!/usr/bin/env node
/**
 * Golden lane runner — audit or batch-test maker lanes from maker-lane-library.js
 *
 *   npm run golden:lane -- --lane endless_lane_dodge --runs 1
 *   npm run golden:lane -- --list
 *   npm run golden:lane -- --audit <jobId>
 */
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const { MAKER_LANE_LIBRARY, MAKER_LANE_IDS, getGoldenSpecForLane } = await import(
    '../src/ai-engine/maker-lane-library.js'
);

function parseArgs(argv) {
    const opts = {
        lane: 'endless_lane_dodge',
        runs: 0,
        auditJobId: null,
        list: false,
        outDir: path.join(repoRoot, 'storage', 'golden-path'),
    };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--lane' && argv[i + 1]) opts.lane = argv[++i];
        else if (arg === '--runs' && argv[i + 1]) opts.runs = Math.max(0, Math.min(5, Number(argv[++i]) || 0));
        else if ((arg === '--audit' || arg === '--audit-job') && argv[i + 1]) opts.auditJobId = argv[++i];
        else if (arg === '--list') opts.list = true;
        else if (arg === '--out' && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
        else if (arg === '--help' || arg === '-h') opts.help = true;
    }
    return opts;
}

async function auditWorkspace(jobId) {
    const makerRoot = process.env.GAMETOK_MAKER_ROOT || process.env.ASSET_STORAGE_ROOT || '/app/storage';
    const candidates = [
        path.join(makerRoot, 'gametok-maker-jobs', jobId),
        path.join(repoRoot, 'storage', 'gametok-maker-jobs', jobId),
    ];
    let workspace = null;
    for (const c of candidates) {
        try {
            await fs.access(c);
            workspace = c;
            break;
        } catch { /* next */ }
    }
    if (!workspace) return { ok: false, error: 'workspace_not_found' };

    const laneJson = JSON.parse(await fs.readFile(path.join(workspace, 'maker-lane.json'), 'utf8').catch(() => '{}'));
    const foundation = JSON.parse(await fs.readFile(path.join(workspace, 'foundation-contract.json'), 'utf8').catch(() => '{}'));
    return {
        ok: true,
        workspace,
        lane: laneJson?.selected?.laneId || foundation?.libraryLaneId || 'unknown',
        engine: foundation?.engine || laneJson?.selected?.engine,
        scaffold: laneJson?.selected?.scaffoldTemplateId,
    };
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help || opts.list) {
        console.log('Golden lanes:\n');
        for (const id of MAKER_LANE_IDS) {
            const lane = MAKER_LANE_LIBRARY[id];
            const g = lane?.golden;
            console.log(`  ${id}`);
            console.log(`    engine=${lane.engine} scaffold=${lane.scaffoldTemplateId}`);
            if (g?.prompt) console.log(`    prompt: ${g.prompt.slice(0, 72)}...`);
        }
        return;
    }

    if (opts.auditJobId) {
        const report = await auditWorkspace(opts.auditJobId);
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    const spec = getGoldenSpecForLane(opts.lane);
    if (!spec?.prompt) {
        console.error(`Unknown or missing golden spec for lane: ${opts.lane}`);
        process.exit(1);
    }

    console.log(`Lane: ${opts.lane}`);
    console.log(`Prompt: ${spec.prompt}`);
    if (opts.runs < 1) {
        console.log('Pass --runs N to execute live generations (needs API keys).');
        return;
    }

    const missing = [];
    const nvidiaOk = process.env.NVIDIA_API_KEY
        || process.env.NIM_API_KEYS
        || process.env.NVIDIA_NIM_API_KEYS;
    if (!nvidiaOk) missing.push('NVIDIA_API_KEY (or NIM_API_KEYS) for sprite/background art');
    if (!process.env.DEEPSEEK_API_KEY) missing.push('DEEPSEEK_API_KEY');
    if (missing.length > 0) {
        throw new Error(`Cannot run generation locally. Missing: ${missing.join(', ')}.`);
    }

    process.env.GAMETOK_FACTORY_MINIMAL = process.env.GAMETOK_FACTORY_MINIMAL ?? 'true';
    process.env.GAMETOK_MAKER_ROOT = opts.outDir;
    const { executeDreamJob } = await import('../src/ai-engine/routes.js');
    const results = [];
    for (let i = 0; i < opts.runs; i += 1) {
        const jobId = randomUUID();
        console.log(`\nRun ${i + 1}/${opts.runs} job=${jobId} workspace=${path.join(opts.outDir, jobId)}`);
        try {
            await executeDreamJob(jobId, spec.prompt, [], { persistToDb: false, userId: 'golden-lane-runner' });
            const audit = await auditWorkspace(jobId);
            results.push({ jobId, ok: true, audit });
        } catch (error) {
            results.push({ jobId, ok: false, error: error.message });
        }
    }

    await fs.mkdir(opts.outDir, { recursive: true });
    const outPath = path.join(opts.outDir, `${opts.lane}-results.json`);
    await fs.writeFile(outPath, JSON.stringify({ lane: opts.lane, prompt: spec.prompt, results }, null, 2));
    console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
