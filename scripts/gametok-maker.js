#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import pool, { initDB } from '../src/db.js';
import { selectMakerTemplateContract } from '../src/ai-engine/maker-templates.js';
import { buildMakerDebugProtocol } from '../src/ai-engine/maker-debug-protocol.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from '../src/ai-engine/maker-scaffolds.js';
import { buildMakerAssetContract, summarizeMakerAssetContract } from '../src/ai-engine/maker-asset-contracts.js';
import { buildMakerDesignBrief, summarizeMakerDesignBrief } from '../src/ai-engine/maker-design-brief.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const args = {
        command: null,
        prompt: null,
        userId: process.env.GAMETOK_MAKER_USER_ID || null,
        jobId: null,
        outDir: process.env.GAMETOK_MAKER_OUT_DIR || null,
        json: false,
        maxAttempts: 1,
        help: false,
    };
    const positionals = [];
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--json') {
            args.json = true;
        } else if (arg === '--prompt' || arg === '-p') {
            args.prompt = argv[++index] || '';
        } else if (arg === '--user-id') {
            args.userId = argv[++index] || null;
        } else if (arg === '--job-id') {
            args.jobId = argv[++index] || null;
        } else if (arg === '--out' || arg === '--out-dir') {
            args.outDir = argv[++index] || null;
        } else if (arg === '--max-attempts') {
            args.maxAttempts = Math.max(1, Number(argv[++index] || 1));
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            positionals.push(arg);
        }
    }

    const knownCommands = new Set(['generate', 'inspect', 'run-job', 'run-prompt']);
    if (positionals.length > 0 && knownCommands.has(positionals[0])) {
        args.command = positionals.shift();
    }
    if (!args.command) args.command = args.jobId ? 'run-job' : 'generate';
    if (!args.prompt && positionals.length > 0) args.prompt = positionals.join(' ');
    return args;
}

function usage() {
    return [
        'GameTok Maker CLI',
        '',
        'Usage:',
        '  gametok-maker -p "Create a lunar lander game"',
        '  gametok-maker generate -p "Create a tank artillery game" --out ./maker-runs',
        '  gametok-maker inspect -p "turn-based artillery tank game"',
        '  gametok-maker run-job --job-id <uuid>',
        '',
        'Options:',
        '  -p, --prompt <text>       Prompt to generate.',
        '      --user-id <uuid>     ai_games owner. Defaults to GAMETOK_MAKER_USER_ID.',
        '      --job-id <uuid>      Existing ai_games id for run-job.',
        '      --out <dir>          Maker workspace root. Defaults to storage/gametok-maker-cli.',
        '      --json               Print machine-readable result JSON.',
        '      --max-attempts <n>   Reserved for CLI retry policy. Default 1.',
        '  -h, --help              Show this help.',
        '',
        'Environment:',
        '  DATABASE_URL, NVIDIA_API_KEY, GAMETOK_MAKER_USER_ID are required for real generation.',
    ].join('\n');
}

function defaultOutDir() {
    return path.join(repoRoot, 'storage', 'gametok-maker-cli');
}

async function getJob(jobId) {
    const result = await pool.query('SELECT id, prompt, user_id FROM ai_games WHERE id = $1', [jobId]);
    if (result.rows.length === 0) {
        throw new Error(`No ai_games row found for job ${jobId}`);
    }
    return result.rows[0];
}

async function createPendingJob(prompt, userId) {
    const jobId = randomUUID();
    const ownerId = userId || process.env.GAMETOK_MAKER_USER_ID;
    if (!ownerId) {
        throw new Error('Generation requires --user-id or GAMETOK_MAKER_USER_ID so the draft has a real owner.');
    }
    await pool.query(
        `INSERT INTO ai_games (id, user_id, title, prompt, html_payload, raw_code, is_public, is_draft, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, true, NOW(), NOW())`,
        [jobId, ownerId, 'Pending Dream...', prompt, '', '']
    );
    return { id: jobId, prompt, user_id: ownerId };
}

async function readResult(jobId, workspaceRoot) {
    const result = await pool.query('SELECT id, title, html_payload, raw_code FROM ai_games WHERE id = $1', [jobId]);
    const row = result.rows[0] || {};
    const workspace = path.join(workspaceRoot, jobId);
    const reportPath = path.join(workspace, 'gametok-build-report.json');
    const artifactPath = path.join(workspace, 'artifact', 'index.html');
    let report = null;
    try {
        report = JSON.parse(await fs.promises.readFile(reportPath, 'utf8'));
    } catch {
        report = null;
    }
    return {
        jobId,
        title: row.title || report?.title || null,
        status: report?.status || (row.html_payload ? 'complete' : 'unknown'),
        workspace,
        artifactPath,
        reportPath,
        htmlBytes: row.html_payload ? Buffer.byteLength(row.html_payload, 'utf8') : 0,
        buildMode: report?.buildMode || null,
        template: report?.templateContract?.templateId || null,
        acceptance: report?.acceptance || null,
    };
}

async function inspectPrompt(prompt, json = false) {
    const template = selectMakerTemplateContract({}, prompt);
    const assetContract = buildMakerAssetContract(template, {});
    const debugProtocol = buildMakerDebugProtocol(template, null, assetContract);
    const scaffold = await loadMakerTemplateScaffold(template.templateId);
    const designBrief = buildMakerDesignBrief({
        qualityIntent: {},
        prompt,
        templateContract: template,
        assetContract,
    });
    const output = {
        template,
        designBrief: summarizeMakerDesignBrief(designBrief),
        assetContract: summarizeMakerAssetContract(assetContract),
        debugProtocol,
        scaffold: summarizeMakerTemplateScaffold(scaffold),
    };
    if (json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log(`Template: ${template.templateId} (${template.engine})`);
        console.log(`Asset slots: ${(assetContract.slots || []).length}`);
        console.log(`Debug probes: ${(debugProtocol.probes || []).length}`);
        console.log(`GDD summary: ${output.designBrief.chars} chars`);
    }
}

async function runNativeMaker({ prompt, userId, jobId, outDir, json }) {
    const workspaceRoot = path.resolve(outDir || defaultOutDir());
    process.env.GAMETOK_MAKER_ROOT = workspaceRoot;
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    await initDB();

    const job = jobId
        ? await getJob(jobId)
        : await createPendingJob(prompt, userId);

    const { executeDreamJob } = await import('../src/ai-engine/routes.js');
    const startedAt = Date.now();
    console.log(`[GameTok Maker CLI] job=${job.id}`);
    console.log(`[GameTok Maker CLI] workspace=${path.join(workspaceRoot, job.id)}`);
    console.log(`[GameTok Maker CLI] prompt=${job.prompt.slice(0, 240)}${job.prompt.length > 240 ? '...' : ''}`);

    await executeDreamJob(job.id, job.prompt, []);
    const output = await readResult(job.id, workspaceRoot);
    output.durationMs = Date.now() - startedAt;

    if (json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log('');
        console.log(`[GameTok Maker CLI] complete: ${output.title || job.id}`);
        console.log(`[GameTok Maker CLI] status=${output.status} buildMode=${output.buildMode || 'unknown'} template=${output.template || 'unknown'}`);
        console.log(`[GameTok Maker CLI] artifact=${output.artifactPath}`);
        console.log(`[GameTok Maker CLI] report=${output.reportPath}`);
        console.log(`[GameTok Maker CLI] workspace=${output.workspace}`);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(usage());
        return;
    }

    if (args.command === 'inspect') {
        if (!args.prompt) throw new Error('inspect requires -p/--prompt.');
        await inspectPrompt(args.prompt, args.json);
        return;
    }

    if (args.command === 'run-prompt') args.command = 'generate';
    if (args.command === 'generate') {
        if (!args.prompt) throw new Error('generate requires -p/--prompt.');
        await runNativeMaker(args);
        return;
    }

    if (args.command === 'run-job') {
        if (!args.jobId) throw new Error('run-job requires --job-id.');
        await runNativeMaker(args);
        return;
    }

    throw new Error(`Unknown command: ${args.command}`);
}

main()
    .catch((error) => {
        console.error(`[GameTok Maker CLI] ${error.stack || error.message || error}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
