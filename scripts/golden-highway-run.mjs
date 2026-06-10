#!/usr/bin/env node
/**
 * Step 2 golden path: highway swipe + gas prompt.
 * - Run generations: npm run golden:highway (needs NVIDIA + DeepSeek env)
 * - Audit a finished job workspace: npm run golden:highway -- --audit <jobId>
 * - Audit Railway log export: npm run golden:highway -- --logs /path/to.log
 */
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

export const GOLDEN_HIGHWAY_PROMPT = 'Make a fun top-down highway driving game where I swipe between lanes to dodge cars and try to go as far as I can. Collect gas so I don\'t run out.';

const LOG_MARKERS = [
    { id: 'factory_minimal', pattern: /factoryMinimal=on/i, label: 'Factory minimal on' },
    { id: 'phase2_turns', pattern: /phase2Turns=2\(implement=1\+repair\)/i, label: 'Phase 2: 1 implement + 1 repair' },
    { id: 'foundation_15', pattern: /Phase 1\.5\/3:.*foundation=/i, label: 'Phase 1.5 foundation' },
    { id: 'stub_preflight', pattern: /Foundation stub preflight passed/i, label: 'Foundation stub preflight passed' },
    { id: 'vite_ok', pattern: /\[Vite Build\].*succeeded/i, label: 'Vite build succeeded' },
    { id: 'sandbox_pass', pattern: /Sandbox\/build passed after turn/i, label: 'Sandbox passed after agent turn' },
    { id: 'job_complete', pattern: /\[DREAM JOB\] Complete!/i, label: 'Dream job complete' },
];

const LOG_FAILURE_PATTERNS = [
    { id: 'preflight_block', pattern: /PREFLIGHT ERROR:/i, label: 'Preflight blocked job (legacy)' },
    { id: 'ts1117', pattern: /TS1117:.*multiple properties/i, label: 'Duplicate state keys (TS1117)' },
    { id: 'cauldron', pattern: /cauldronSlots/i, label: 'Cooking state leak' },
    { id: 'phase2_exhausted', pattern: /finished without a passing project/i, label: 'Phase 2 exhausted turns' },
    { id: 'player_idle_manifest', pattern: /player_idle, player_move, player_hit/i, label: 'False animation manifest gate' },
];

function parseArgs(argv) {
    const opts = {
        runs: 1,
        auditJobId: null,
        logsPath: null,
        outDir: path.join(repoRoot, 'storage', 'golden-path'),
        prompt: GOLDEN_HIGHWAY_PROMPT,
        json: false,
    };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--runs' && argv[i + 1]) {
            opts.runs = Math.max(1, Math.min(5, Number(argv[++i]) || 1));
        } else if ((arg === '--audit' || arg === '--audit-job') && argv[i + 1]) {
            opts.auditJobId = argv[++i];
        } else if (arg === '--logs' && argv[i + 1]) {
            opts.logsPath = argv[++i];
        } else if (arg === '--out' && argv[i + 1]) {
            opts.outDir = path.resolve(argv[++i]);
        } else if (arg === '--prompt' && argv[i + 1]) {
            opts.prompt = argv[++i];
        } else if (arg === '--json') {
            opts.json = true;
        } else if (arg === '--help' || arg === '-h') {
            opts.help = true;
            break;
        }
    }
    return opts;
}

async function readJsonIfExists(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
        return null;
    }
}

async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

function resolveJobWorkspace(jobId, makerRoot) {
    const candidates = [
        path.join(makerRoot, 'gametok-maker-jobs', jobId),
        path.join(makerRoot, jobId),
        path.join(repoRoot, 'storage', 'gametok-maker-jobs', jobId),
        path.join(repoRoot, 'storage', 'gametok-maker-cli', jobId),
    ];
    return candidates;
}

async function findExistingWorkspace(jobId, makerRoot = process.env.GAMETOK_MAKER_ROOT || process.env.ASSET_STORAGE_ROOT || '/app/storage') {
    for (const candidate of resolveJobWorkspace(jobId, makerRoot)) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isDirectory()) return candidate;
        } catch {
            // continue
        }
    }
    return null;
}

function auditLogsText(text = '') {
    const markers = LOG_MARKERS.map((entry) => ({
        ...entry,
        hit: entry.pattern.test(text),
    }));
    const failures = LOG_FAILURE_PATTERNS.map((entry) => ({
        ...entry,
        hit: entry.pattern.test(text),
    }));
    const minimalNonBlock = /minimal mode:.*preflight issue\(s\) non-blocking/i.test(text);
    return {
        markers,
        failures: failures.filter((f) => f.hit),
        minimalNonBlock,
        pass: failures.filter((f) => f.hit && f.id !== 'preflight_block').length === 0
            && markers.some((m) => m.id === 'foundation_15' && m.hit),
    };
}

async function auditJobWorkspace(workspaceDir) {
    const checks = [];
    const add = (id, ok, detail = '') => checks.push({ id, ok, detail });

    const report = await readJsonIfExists(path.join(workspaceDir, 'gametok-build-report.json'));
    const contract = await readJsonIfExists(path.join(workspaceDir, 'GAMETOK_MAKER_CONTRACT.json'))
        || await readJsonIfExists(path.join(workspaceDir, 'foundation-contract.json'));
    const preflight = await readJsonIfExists(path.join(workspaceDir, 'preflight-report.json'));
    const artifact = await readTextIfExists(path.join(workspaceDir, 'artifact', 'index.html'));

    add('workspace_exists', true, workspaceDir);
    add('build_report_complete', report?.status === 'complete', report?.status || 'missing');
    add('sandbox_success', report?.sandbox?.success === true, String(report?.sandbox?.success));
    add('artifact_html', Boolean(artifact && artifact.length >= 500), `${artifact?.length || 0} bytes`);
    add('foundation_contract', Boolean(contract?.foundation || contract?.templateContract?.foundation), 'foundation present');
    add('dynamic_foundation_lane', Boolean(contract?.foundation?.lane || contract?.templateContract?.foundation?.lane), contract?.foundation?.lane || 'n/a');

    const evidenceFiles = [];
    try {
        const entries = await fs.readdir(workspaceDir);
        for (const name of entries) {
            if (/^agent-run-evidence/.test(name)) evidenceFiles.push(name);
        }
    } catch {
        // ignore
    }
    let lastEvidence = null;
    for (const name of evidenceFiles.sort()) {
        lastEvidence = await readJsonIfExists(path.join(workspaceDir, name));
    }
    add('agent_evidence_success', lastEvidence?.success === true, lastEvidence ? path.basename(evidenceFiles.at(-1) || '') : 'no evidence file');

    if (preflight) {
        const issueCount = Array.isArray(preflight.issues) ? preflight.issues.length : 0;
        add('preflight_logged', true, `${issueCount} issue(s), success=${preflight.success}`);
    }

    const pass = checks.filter((c) => ['workspace_exists'].includes(c.id) ? false : true).every((c) => c.ok);
    return { workspaceDir, checks, pass, report, lastEvidence };
}

async function appendResult(outDir, entry) {
    await fs.mkdir(outDir, { recursive: true });
    const resultsPath = path.join(outDir, 'highway-results.json');
    let history = { prompt: GOLDEN_HIGHWAY_PROMPT, runs: [] };
    try {
        history = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
    } catch {
        // fresh
    }
    history.runs.push({ ...entry, at: new Date().toISOString() });
    history.consecutivePasses = 0;
    for (let i = history.runs.length - 1; i >= 0; i -= 1) {
        if (history.runs[i].pass) history.consecutivePasses += 1;
        else break;
    }
    history.step2GoalMet = history.consecutivePasses >= 3;
    await fs.writeFile(resultsPath, JSON.stringify(history, null, 2), 'utf8');
    return history;
}

async function runOneGeneration(prompt, outDir) {
    const missing = [];
    const nvidiaOk = process.env.NVIDIA_API_KEY
        || process.env.NIM_API_KEYS
        || process.env.NVIDIA_NIM_API_KEYS;
    if (!nvidiaOk) missing.push('NVIDIA_API_KEY (or NIM_API_KEYS) for sprite/background art');
    const hasDeepSeek = process.env.DEEPSEEK_API_KEY;
    if (!hasDeepSeek) missing.push('DEEPSEEK_API_KEY');
    if (hasDeepSeek && String(process.env.GAMETOK_DEEPSEEK_PRIMARY || 'true').toLowerCase() !== 'true') {
        console.warn('⚠️  Set GAMETOK_DEEPSEEK_PRIMARY=true to match Railway text routing.');
    }
    if (missing.length > 0) {
        throw new Error(`Cannot run generation locally. Missing: ${missing.join(', ')}. Use Forge on Railway or set keys in .env`);
    }

    process.env.GAMETOK_FACTORY_MINIMAL = process.env.GAMETOK_FACTORY_MINIMAL ?? 'true';
    process.env.GAMETOK_MAKER_ROOT = outDir;
    const jobId = randomUUID();
    const workspaceDir = path.join(outDir, jobId);
    const { executeDreamJob } = await import('../src/ai-engine/routes.js');

    console.log(`\n🛣️  Golden highway run — job ${jobId}`);
    console.log(`   factoryMinimal=${process.env.GAMETOK_FACTORY_MINIMAL}`);
    console.log(`   workspace: ${workspaceDir}\n`);

    const startedAt = Date.now();
    await executeDreamJob(jobId, prompt, [], { persistToDb: false });
    const audit = await auditJobWorkspace(workspaceDir);
    return {
        jobId,
        durationMs: Date.now() - startedAt,
        pass: audit.pass,
        audit,
        artifactPath: path.join(workspaceDir, 'artifact', 'index.html'),
    };
}

function printAudit(audit, { title = 'Workspace audit' } = {}) {
    console.log(`\n${title}: ${audit.workspaceDir || '(logs only)'}`);
    if (audit.checks) {
        for (const check of audit.checks) {
            console.log(`  ${check.ok ? '✅' : '❌'} ${check.id}${check.detail ? ` — ${check.detail}` : ''}`);
        }
    }
    if (audit.markers) {
        console.log('\n  Log markers:');
        for (const marker of audit.markers) {
            console.log(`  ${marker.hit ? '✅' : '○'} ${marker.label}`);
        }
    }
    if (audit.failures?.length) {
        console.log('\n  Log failures:');
        for (const failure of audit.failures) {
            console.log(`  ❌ ${failure.label}`);
        }
    }
    if (audit.minimalNonBlock) {
        console.log('  ℹ️  Factory minimal: preflight was non-blocking');
    }
    console.log(`\n  ${audit.pass ? '✅ PASS' : '❌ FAIL'}\n`);
}

function printHelp() {
    console.log(`
Golden highway — Step 2

Prompt (copy into Forge):
  ${GOLDEN_HIGHWAY_PROMPT}

Run 3 local generations (needs API keys):
  npm run golden:highway -- --runs 3

Audit a job workspace (local copy or Railway volume sync):
  npm run golden:highway -- --audit <jobId>

Audit exported Railway logs:
  npm run golden:highway -- --logs ./railway.log

Results ledger:
  storage/golden-path/highway-results.json

Step 2 done when consecutivePasses >= 3 in the ledger, or 3 Forge runs pass the checklist below.

Forge / Railway log checklist:
  ✅ factoryMinimal=on
  ✅ Phase 1.5 + Foundation stub preflight passed
  ✅ [Vite Build] succeeded
  ✅ Sandbox/build passed OR [DREAM JOB] Complete!
  ❌ No TS1117, no PREFLIGHT ERROR block, no Phase 2 exhausted
`);
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printHelp();
        return;
    }

    await fs.mkdir(opts.outDir, { recursive: true });

    if (opts.logsPath) {
        const text = await fs.readFile(path.join(process.cwd(), opts.logsPath), 'utf8');
        const audit = auditLogsText(text);
        audit.pass = audit.pass && !audit.failures.some((f) => f.id === 'preflight_block' || f.id === 'phase2_exhausted');
        if (!opts.json) printAudit(audit, { title: 'Log audit' });
        else console.log(JSON.stringify(audit, null, 2));
        const history = await appendResult(opts.outDir, { mode: 'logs', pass: audit.pass, audit });
        if (!opts.json) {
            console.log(`Ledger: ${path.join(opts.outDir, 'highway-results.json')}`);
            console.log(`Consecutive passes: ${history.consecutivePasses}/3 — step2GoalMet=${history.step2GoalMet}`);
        }
        process.exit(audit.pass ? 0 : 1);
    }

    if (opts.auditJobId) {
        const workspaceDir = await findExistingWorkspace(opts.auditJobId);
        if (!workspaceDir) {
            console.error(`No workspace found for job ${opts.auditJobId}. Checked gametok-maker-jobs under storage and GAMETOK_MAKER_ROOT.`);
            process.exit(1);
        }
        const audit = await auditJobWorkspace(workspaceDir);
        if (!opts.json) printAudit(audit);
        else console.log(JSON.stringify(audit, null, 2));
        const history = await appendResult(opts.outDir, { mode: 'audit', jobId: opts.auditJobId, pass: audit.pass, audit });
        if (!opts.json) {
            console.log(`Ledger: ${path.join(opts.outDir, 'highway-results.json')}`);
            console.log(`Consecutive passes: ${history.consecutivePasses}/3 — step2GoalMet=${history.step2GoalMet}`);
        }
        process.exit(audit.pass ? 0 : 1);
    }

    let consecutive = 0;
    for (let run = 1; run <= opts.runs; run += 1) {
        try {
            const result = await runOneGeneration(opts.prompt, opts.outDir);
            if (!opts.json) printAudit(result.audit, { title: `Run ${run}/${opts.runs}` });
            const history = await appendResult(opts.outDir, { mode: 'generate', run, ...result });
            consecutive = history.consecutivePasses;
            if (!result.pass) {
                if (!opts.json) console.log('Stopping early — fix failure before next run.');
                process.exit(1);
            }
        } catch (error) {
            console.error(`\n❌ Run ${run} failed: ${error.message}\n`);
            await appendResult(opts.outDir, { mode: 'generate', run, pass: false, error: error.message });
            process.exit(1);
        }
    }

    if (!opts.json) {
        console.log(`\n🛣️  ${opts.runs} run(s) complete. Consecutive passes: ${consecutive}/3`);
        if (consecutive >= 3) console.log('✅ Step 2 goal met (3 green runs in a row).\n');
        else console.log('⏳ Keep going — need 3 consecutive passes.\n');
    }
    process.exit(consecutive >= 3 ? 0 : 1);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
