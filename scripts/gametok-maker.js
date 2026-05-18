#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import pool, { initDB } from '../src/db.js';
import { listMakerTemplateContracts, selectMakerTemplateContract } from '../src/ai-engine/maker-templates.js';
import { buildMakerDebugProtocol } from '../src/ai-engine/maker-debug-protocol.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from '../src/ai-engine/maker-scaffolds.js';
import { buildMakerAssetContract, summarizeMakerAssetContract } from '../src/ai-engine/maker-asset-contracts.js';
import { buildMakerDesignBrief, summarizeMakerDesignBrief } from '../src/ai-engine/maker-design-brief.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultPromptPreviewLength = 240;

function parseArgs(argv) {
    const args = {
        command: null,
        prompt: null,
        userId: process.env.GAMETOK_MAKER_USER_ID || null,
        jobId: null,
        outDir: process.env.GAMETOK_MAKER_OUT_DIR || null,
        json: false,
        help: false,
        force: false,
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
        } else if (arg === '--force') {
            args.force = true;
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            positionals.push(arg);
        }
    }

    const knownCommands = new Set(['generate', 'inspect', 'run-job', 'run-prompt', 'templates', 'env']);
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
        '  gametok-maker "Create a lunar lander game"',
        '  gametok-maker -p "Create a lunar lander game"',
        '  gametok-maker generate -p "Create a tank artillery game" --out ./maker-runs',
        '  gametok-maker inspect -p "turn-based artillery tank game"',
        '  gametok-maker templates',
        '  gametok-maker env',
        '  gametok-maker run-job --job-id <uuid>',
        '',
        'Commands:',
        '  generate              Create an ai_games job, run the native maker, and write artifacts.',
        '  run-job               Re-run an existing ai_games job id through the native maker.',
        '  inspect               Classify a prompt and print template/debug/asset contracts.',
        '  templates             List available maker templates.',
        '  env                   Validate required generation environment variables.',
        '',
        'Options:',
        '  -p, --prompt <text>       Prompt to generate.',
        '      --user-id <uuid>     ai_games owner. Defaults to GAMETOK_MAKER_USER_ID.',
        '      --job-id <uuid>      Existing ai_games id for run-job.',
        '      --out <dir>          Maker workspace root. Defaults to storage/gametok-maker-cli.',
        '      --json               Print machine-readable result JSON.',
        '      --force              Allow env command to exit 0 even when generation env is incomplete.',
        '  -h, --help              Show this help.',
        '',
        'Environment:',
        '  DATABASE_URL or PG* connection settings are required for generation.',
        '  NVIDIA_API_KEY is required for NIM Flux asset generation.',
        '  GAMETOK_MAKER_USER_ID is required for generate unless --user-id is passed.',
    ].join('\n');
}

function defaultOutDir() {
    return path.join(repoRoot, 'storage', 'gametok-maker-cli');
}

function slugify(value = 'game') {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'game';
}

function hasDatabaseEnv() {
    return Boolean(process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER));
}

function validateGenerationEnv({ userId, jobId } = {}) {
    const missing = [];
    if (!hasDatabaseEnv()) missing.push('DATABASE_URL or PGHOST/PGDATABASE/PGUSER');
    if (!process.env.NVIDIA_API_KEY) missing.push('NVIDIA_API_KEY');
    if (!jobId && !userId && !process.env.GAMETOK_MAKER_USER_ID) missing.push('GAMETOK_MAKER_USER_ID or --user-id');
    return {
        ok: missing.length === 0,
        missing,
        values: {
            database: hasDatabaseEnv() ? 'configured' : 'missing',
            nvidia: process.env.NVIDIA_API_KEY ? 'configured' : 'missing',
            userId: (userId || process.env.GAMETOK_MAKER_USER_ID || jobId) ? 'configured' : 'missing',
            makerRoot: process.env.GAMETOK_MAKER_OUT_DIR || defaultOutDir(),
        },
    };
}

function printEnvStatus(status) {
    console.log(`Database: ${status.values.database}`);
    console.log(`NVIDIA NIM key: ${status.values.nvidia}`);
    console.log(`Maker user: ${status.values.userId}`);
    console.log(`Default output: ${status.values.makerRoot}`);
    if (!status.ok) {
        console.log('');
        console.log(`Missing: ${status.missing.join(', ')}`);
    }
}

async function withStructuredJsonOutput(enabled, callback) {
    if (!enabled) return callback();
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => originalError(...args);
    console.error = (...args) => originalError(...args);
    try {
        return await callback();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
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
        error: report?.error || null,
        row,
        report,
    };
}

async function readFileIfExists(filePath, encoding = 'utf8') {
    try {
        return await fs.promises.readFile(filePath, encoding);
    } catch {
        return null;
    }
}

async function finalizeOutput(output, workspaceRoot) {
    const artifactHtml = await readFileIfExists(output.artifactPath);
    const html = artifactHtml || output.row?.html_payload || '';
    const failed = output.status === 'failed' || String(output.title || '').startsWith('ERROR:') || output.error;
    if (failed) {
        throw new Error(output.error || output.title || 'Maker reported a failed build.');
    }
    if (!html || html.length < 500) {
        throw new Error('Maker completed without a playable HTML artifact.');
    }

    await fs.promises.mkdir(path.dirname(output.artifactPath), { recursive: true });
    if (!artifactHtml) {
        await fs.promises.writeFile(output.artifactPath, html, 'utf8');
    }

    const safeTitle = slugify(output.title || output.jobId);
    const publicDir = path.join(workspaceRoot, 'exports', `${safeTitle}-${output.jobId.slice(0, 8)}`);
    const publicArtifactPath = path.join(publicDir, 'index.html');
    const resultPath = path.join(publicDir, 'result.json');
    const latestJsonPath = path.join(workspaceRoot, 'latest.json');
    const latestHtmlPath = path.join(workspaceRoot, 'latest.html');

    const manifest = {
        jobId: output.jobId,
        title: output.title,
        status: output.status,
        buildMode: output.buildMode,
        template: output.template,
        workspace: output.workspace,
        artifactPath: output.artifactPath,
        publicArtifactPath,
        reportPath: output.reportPath,
        resultPath,
        latestHtmlPath,
        htmlBytes: Buffer.byteLength(html, 'utf8'),
        acceptance: output.acceptance,
        completedAt: new Date().toISOString(),
    };

    await fs.promises.mkdir(publicDir, { recursive: true });
    await fs.promises.writeFile(publicArtifactPath, html, 'utf8');
    await fs.promises.writeFile(latestHtmlPath, html, 'utf8');
    await fs.promises.writeFile(resultPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.promises.writeFile(latestJsonPath, JSON.stringify(manifest, null, 2), 'utf8');

    return manifest;
}

function printTemplates(json = false) {
    const templates = listMakerTemplateContracts().map((contract) => ({
        templateId: contract.templateId,
        engine: contract.engine,
        archetype: contract.archetype,
        recommendedLibrary: contract.recommendedLibrary,
        requiredFunctions: contract.requiredFunctions || [],
        controls: contract.controls || [],
        acceptanceChecks: contract.acceptanceChecks || [],
    }));
    if (json) {
        console.log(JSON.stringify({ templates }, null, 2));
        return;
    }
    for (const template of templates) {
        console.log(`${template.templateId} (${template.engine}, ${template.archetype})`);
        console.log(`  library: ${template.recommendedLibrary}`);
        console.log(`  functions: ${template.requiredFunctions.join(', ')}`);
        console.log(`  controls: ${template.controls.join('; ')}`);
    }
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
        console.log(`Debug checks: ${(debugProtocol.checks || []).length}`);
        console.log(`GDD summary: ${output.designBrief.chars} chars`);
    }
}

async function runNativeMaker({ prompt, userId, jobId, outDir, json }) {
    const workspaceRoot = path.resolve(outDir || defaultOutDir());
    const envStatus = validateGenerationEnv({ userId, jobId });
    if (!envStatus.ok) {
        throw new Error(`Generation environment is incomplete. Missing: ${envStatus.missing.join(', ')}`);
    }
    process.env.GAMETOK_MAKER_ROOT = workspaceRoot;
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    await initDB();

    const job = jobId
        ? await getJob(jobId)
        : await createPendingJob(prompt, userId);

    const { executeDreamJob } = await import('../src/ai-engine/routes.js');
    const startedAt = Date.now();
    const manifest = await withStructuredJsonOutput(json, async () => {
        console.log(`[GameTok Maker CLI] job=${job.id}`);
        console.log(`[GameTok Maker CLI] workspace=${path.join(workspaceRoot, job.id)}`);
        console.log(`[GameTok Maker CLI] prompt=${job.prompt.slice(0, defaultPromptPreviewLength)}${job.prompt.length > defaultPromptPreviewLength ? '...' : ''}`);

        await executeDreamJob(job.id, job.prompt, []);
        const output = await readResult(job.id, workspaceRoot);
        output.durationMs = Date.now() - startedAt;
        const finalized = await finalizeOutput(output, workspaceRoot);
        finalized.durationMs = output.durationMs;
        return finalized;
    });

    if (json) {
        console.log(JSON.stringify(manifest, null, 2));
    } else {
        console.log('');
        console.log(`[GameTok Maker CLI] complete: ${manifest.title || job.id}`);
        console.log(`[GameTok Maker CLI] status=${manifest.status} buildMode=${manifest.buildMode || 'unknown'} template=${manifest.template || 'unknown'}`);
        console.log(`[GameTok Maker CLI] artifact=${manifest.publicArtifactPath}`);
        console.log(`[GameTok Maker CLI] latest=${manifest.latestHtmlPath}`);
        console.log(`[GameTok Maker CLI] result=${manifest.resultPath}`);
        console.log(`[GameTok Maker CLI] report=${manifest.reportPath}`);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(usage());
        return;
    }

    if (args.command === 'env') {
        const status = validateGenerationEnv(args);
        if (args.json) console.log(JSON.stringify(status, null, 2));
        else printEnvStatus(status);
        if (!status.ok && !args.force) process.exitCode = 1;
        return;
    }

    if (args.command === 'templates') {
        printTemplates(args.json);
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
