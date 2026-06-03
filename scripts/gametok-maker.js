#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import pool, { initDB } from '../src/db.js';
import { listMakerTemplateContracts, selectMakerTemplateContract } from '../src/ai-engine/maker-templates.js';
import { buildMakerDebugProtocol } from '../src/ai-engine/maker-debug-protocol.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from '../src/ai-engine/maker-scaffolds.js';
import { buildMakerAssetContract, summarizeMakerAssetContract } from '../src/ai-engine/maker-asset-contracts.js';
import { buildMakerDesignBrief, summarizeMakerDesignBrief } from '../src/ai-engine/maker-design-brief.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
const defaultPromptPreviewLength = 240;

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

function validateGenerationEnv({ userId, jobId, dbBacked = false } = {}) {
    const missing = [];
    const needsDb = Boolean(jobId || dbBacked);
    if (needsDb && !hasDatabaseEnv()) missing.push('DATABASE_URL or PGHOST/PGDATABASE/PGUSER');
    if (!process.env.NVIDIA_API_KEY && !process.env.NIM_API_KEYS && !process.env.NVIDIA_NIM_API_KEYS) {
        missing.push('NVIDIA_API_KEY (or NIM_API_KEYS) for generated art');
    }
    if (dbBacked && !jobId && !userId && !process.env.GAMETOK_MAKER_USER_ID) missing.push('GAMETOK_MAKER_USER_ID or --user-id');
    return {
        ok: missing.length === 0,
        missing,
        values: {
            database: hasDatabaseEnv() ? 'configured' : needsDb ? 'missing' : 'not required',
            nvidia: process.env.NVIDIA_API_KEY ? 'configured' : 'missing',
            userId: (userId || process.env.GAMETOK_MAKER_USER_ID || jobId) ? 'configured' : dbBacked ? 'missing' : 'not required',
            makerRoot: process.env.GAMETOK_MAKER_OUT_DIR || defaultOutDir(),
        },
    };
}

function printEnvStatus(status) {
    console.log(chalk.blue.bold('\n🌍 Environment Status:'));
    console.log(`  Database:       ${status.values.database === 'configured' ? chalk.green('✔ configured') : chalk.red('✖ ' + status.values.database)}`);
    console.log(`  NVIDIA NIM key: ${status.values.nvidia === 'configured' ? chalk.green('✔ configured') : chalk.red('✖ missing')}`);
    console.log(`  Maker user:     ${status.values.userId === 'configured' ? chalk.green('✔ configured') : chalk.gray('not required')}`);
    console.log(`  Default output: ${chalk.cyan(status.values.makerRoot)}\n`);
    if (!status.ok) {
        console.log(chalk.red(`Missing required variables: ${status.missing.join(', ')}\n`));
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

async function finalizeDirectOutput(result, workspaceRoot) {
    const html = result?.html || await readFileIfExists(result?.artifactPath || '');
    if (!html || html.length < 500) {
        throw new Error('Maker completed without a playable HTML artifact.');
    }

    const safeTitle = slugify(result.title || result.jobId);
    const publicDir = path.join(workspaceRoot, 'exports', `${safeTitle}-${result.jobId.slice(0, 8)}`);
    const publicArtifactPath = path.join(publicDir, 'index.html');
    const resultPath = path.join(publicDir, 'result.json');
    const latestJsonPath = path.join(workspaceRoot, 'latest.json');
    const latestHtmlPath = path.join(workspaceRoot, 'latest.html');

    const manifest = {
        jobId: result.jobId,
        title: result.title,
        status: 'complete',
        buildMode: result.buildMode,
        template: result.templateContract?.templateId || null,
        workspace: result.workspace,
        artifactPath: result.artifactPath,
        publicArtifactPath,
        reportPath: result.reportPath,
        resultPath,
        latestHtmlPath,
        htmlBytes: Buffer.byteLength(html, 'utf8'),
        acceptance: result.acceptance || null,
        completedAt: new Date().toISOString(),
        runtime: 'direct-cli-file-agent',
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
    console.log(chalk.bold.magenta('\n🎮 GameTok Maker Templates\n'));
    for (const template of templates) {
        console.log(chalk.bold.cyan(`• ${template.templateId}`) + chalk.gray(` (${template.engine}, ${template.archetype})`));
        console.log(`    ${chalk.gray('Library:')}   ${template.recommendedLibrary}`);
        console.log(`    ${chalk.gray('Functions:')} ${template.requiredFunctions.join(', ')}`);
        console.log(`    ${chalk.gray('Controls:')}  ${template.controls.join('; ')}\n`);
    }
}

async function inspectPrompt(prompt, json = false) {
    const spinner = ora('Analyzing prompt and selecting template...').start();
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
    
    spinner.succeed('Analysis complete');
    
    if (json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log(chalk.bold.blue('\n🔍 Inspection Results:'));
        console.log(`  ${chalk.bold('Template:')}     ${chalk.cyan(template.templateId)} ${chalk.gray(`(${template.engine})`)}`);
        console.log(`  ${chalk.bold('Asset Slots:')}  ${chalk.yellow((assetContract.slots || []).length)}`);
        console.log(`  ${chalk.bold('Debug Checks:')} ${chalk.yellow((debugProtocol.checks || []).length)}`);
        console.log(`  ${chalk.bold('GDD Summary:')}  ${chalk.green(output.designBrief.chars + ' chars')}\n`);
    }
}

async function runNativeMaker({ prompt, userId, jobId, outDir, json }) {
    const workspaceRoot = path.resolve(outDir || defaultOutDir());
    const envStatus = validateGenerationEnv({ userId, jobId, dbBacked: true });
    if (!envStatus.ok) {
        throw new Error(`Generation environment is incomplete. Missing: ${envStatus.missing.join(', ')}`);
    }
    process.env.GAMETOK_MAKER_ROOT = workspaceRoot;
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    
    const spinner = ora('Initializing database connection...').start();
    await initDB();

    spinner.text = 'Creating job...';
    const job = jobId
        ? await getJob(jobId)
        : await createPendingJob(prompt, userId);

    spinner.text = 'Loading DreamStream engine...';
    const { executeDreamJob } = await import('../src/ai-engine/routes.js');
    const startedAt = Date.now();
    
    spinner.stop();
    if (!json) {
        console.log(chalk.bold.magenta('\n🚀 Starting GameTok Maker (Native DB Backend)'));
        console.log(`  ${chalk.gray('Job ID:')}    ${job.id}`);
        console.log(`  ${chalk.gray('Workspace:')} ${path.join(workspaceRoot, job.id)}`);
        console.log(`  ${chalk.gray('Prompt:')}    ${job.prompt.slice(0, defaultPromptPreviewLength)}${job.prompt.length > defaultPromptPreviewLength ? '...' : ''}\n`);
    }

    const manifest = await withStructuredJsonOutput(json, async () => {
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
        console.log(chalk.bold.green('\n✅ Generation Complete!'));
        console.log(`  ${chalk.bold('Title:')}     ${chalk.cyan(manifest.title || job.id)}`);
        console.log(`  ${chalk.bold('Status:')}    ${manifest.status} ${chalk.gray(`(mode: ${manifest.buildMode || 'unknown'}, template: ${manifest.template || 'unknown'})`)}`);
        console.log(`  ${chalk.bold('Artifact:')}  ${chalk.underline.blue(manifest.publicArtifactPath)}`);
        console.log(`  ${chalk.bold('Latest:')}    ${chalk.underline.blue(manifest.latestHtmlPath)}`);
        console.log(`  ${chalk.bold('Result:')}    ${chalk.underline.gray(manifest.resultPath)}`);
        console.log(`  ${chalk.bold('Report:')}    ${chalk.underline.gray(manifest.reportPath)}\n`);
    }
}

async function runDirectMaker({ prompt, outDir, json }) {
    const workspaceRoot = path.resolve(outDir || defaultOutDir());
    const envStatus = validateGenerationEnv({ dbBacked: false });
    if (!envStatus.ok) {
        throw new Error(`Generation environment is incomplete. Missing: ${envStatus.missing.join(', ')}`);
    }
    process.env.GAMETOK_MAKER_ROOT = workspaceRoot;
    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    const jobId = randomUUID();
    const spinner = ora('Loading DreamStream engine...').start();
    const { executeDreamJob } = await import('../src/ai-engine/routes.js');
    const startedAt = Date.now();
    
    spinner.stop();
    if (!json) {
        console.log(chalk.bold.magenta('\n🚀 Starting GameTok Maker (Direct CLI Mode)'));
        console.log(`  ${chalk.gray('Job ID:')}    ${jobId}`);
        console.log(`  ${chalk.gray('Workspace:')} ${path.join(workspaceRoot, jobId)}`);
        console.log(`  ${chalk.gray('Prompt:')}    ${prompt.slice(0, defaultPromptPreviewLength)}${prompt.length > defaultPromptPreviewLength ? '...' : ''}\n`);
    }

    const progressSpinner = ora('Generating game...').start();
    const manifest = await withStructuredJsonOutput(json, async () => {
        const result = await executeDreamJob(jobId, prompt, [], {
            persistToDb: false,
            onProgress: async ({ progress, phase, statusMessage }) => {
                if (!json) {
                    progressSpinner.text = chalk.cyan(`[${String(progress).padStart(3, ' ')}%] `) + chalk.bold(`${phase}:`) + ` ${statusMessage}`;
                }
            },
        });
        const finalized = await finalizeDirectOutput(result, workspaceRoot);
        finalized.durationMs = Date.now() - startedAt;
        return finalized;
    });

    progressSpinner.succeed('Game generation finished!');

    if (json) {
        console.log(JSON.stringify(manifest, null, 2));
    } else {
        console.log(chalk.bold.green('\n✅ Generation Complete!'));
        console.log(`  ${chalk.bold('Title:')}     ${chalk.cyan(manifest.title || jobId)}`);
        console.log(`  ${chalk.bold('Status:')}    ${manifest.status} ${chalk.gray(`(mode: ${manifest.buildMode || 'unknown'}, template: ${manifest.template || 'unknown'})`)}`);
        console.log(`  ${chalk.bold('Artifact:')}  ${chalk.underline.blue(manifest.publicArtifactPath)}`);
        console.log(`  ${chalk.bold('Latest:')}    ${chalk.underline.blue(manifest.latestHtmlPath)}`);
        console.log(`  ${chalk.bold('Result:')}    ${chalk.underline.gray(manifest.resultPath)}`);
        console.log(`  ${chalk.bold('Report:')}    ${chalk.underline.gray(manifest.reportPath)}\n`);
    }
}

const program = new Command();

program
  .name('gametok-maker')
  .description(chalk.bold.magenta('GameTok Maker CLI') + ' - AI Game Generation Tool')
  .version('2.0.0');

program
  .command('generate')
  .description('Run the native maker directly from the CLI and write artifacts')
  .requiredOption('-p, --prompt <text>', 'Prompt to generate')
  .option('--user-id <uuid>', 'ai_games owner. Defaults to GAMETOK_MAKER_USER_ID')
  .option('--out, --out-dir <dir>', 'Maker workspace root')
  .option('--json', 'Print machine-readable result JSON', false)
  .option('--db, --db-backed', 'Create/update an ai_games row instead of direct CLI output', false)
  .action(async (options) => {
      try {
          if (options.dbBacked || options.db) {
              await runNativeMaker({ ...options, dbBacked: true });
          } else {
              await runDirectMaker(options);
          }
      } catch (err) {
          console.error(chalk.red(`\n❌ Error: ${err.message}`));
          process.exit(1);
      } finally {
          await pool.end().catch(() => {});
      }
  });

program
  .command('run-job')
  .description('Re-run an existing ai_games job id through the native maker')
  .requiredOption('--job-id <uuid>', 'Existing ai_games id')
  .option('--out, --out-dir <dir>', 'Maker workspace root')
  .option('--json', 'Print machine-readable result JSON', false)
  .action(async (options) => {
      try {
          await runNativeMaker({ ...options, dbBacked: true });
      } catch (err) {
          console.error(chalk.red(`\n❌ Error: ${err.message}`));
          process.exit(1);
      } finally {
          await pool.end().catch(() => {});
      }
  });

program
  .command('inspect')
  .description('Classify a prompt and print template/debug/asset contracts')
  .requiredOption('-p, --prompt <text>', 'Prompt to inspect')
  .option('--json', 'Print machine-readable result JSON', false)
  .action(async (options) => {
      try {
          await inspectPrompt(options.prompt, options.json);
      } catch (err) {
          console.error(chalk.red(`\n❌ Error: ${err.message}`));
          process.exit(1);
      }
  });

program
  .command('templates')
  .description('List available maker templates')
  .option('--json', 'Print machine-readable result JSON', false)
  .action((options) => {
      printTemplates(options.json);
  });

program
  .command('env')
  .description('Validate required generation environment variables')
  .option('--json', 'Print machine-readable result JSON', false)
  .option('--force', 'Allow env command to exit 0 even when generation env is incomplete', false)
  .action((options) => {
      const status = validateGenerationEnv(options);
      if (options.json) console.log(JSON.stringify(status, null, 2));
      else printEnvStatus(status);
      if (!status.ok && !options.force) process.exit(1);
  });

program.parse();
