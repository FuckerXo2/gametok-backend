#!/usr/bin/env node
import { randomUUID } from 'crypto';
import pool from '../src/db.js';
import { selectMakerTemplateContract } from '../src/ai-engine/maker-templates.js';
import { buildMakerDebugProtocol } from '../src/ai-engine/maker-debug-protocol.js';
import { loadMakerTemplateScaffold, summarizeMakerTemplateScaffold } from '../src/ai-engine/maker-scaffolds.js';
import { buildMakerAssetContract, summarizeMakerAssetContract } from '../src/ai-engine/maker-asset-contracts.js';

function readArg(name, fallback = null) {
    const index = process.argv.indexOf(name);
    if (index === -1) return fallback;
    return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function usage() {
    console.log([
        'GameTok Maker CLI',
        '',
        'Commands:',
        '  inspect --prompt "..."',
        '      Print the selected native template and debug protocol.',
        '',
        '  run-job --job-id <uuid>',
        '      Run the native maker for an existing ai_games pending job.',
        '',
        '  run-prompt --prompt "..." --user-id <uuid>',
        '      Create a local pending job row and run the native maker immediately.',
        '',
    ].join('\n'));
}

async function getJob(jobId) {
    const result = await pool.query('SELECT id, prompt, user_id FROM ai_games WHERE id = $1', [jobId]);
    if (result.rows.length === 0) {
        throw new Error(`No ai_games row found for job ${jobId}`);
    }
    return result.rows[0];
}

async function createPendingJob(prompt, userId = null) {
    const jobId = randomUUID();
    const ownerId = userId || process.env.GAMETOK_MAKER_USER_ID;
    if (!ownerId) {
        throw new Error('run-prompt requires --user-id or GAMETOK_MAKER_USER_ID so the ai_games row has a real owner.');
    }
    await pool.query(
        `INSERT INTO ai_games (id, user_id, title, prompt, html_payload, raw_code, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())`,
        [jobId, ownerId, 'Pending Dream...', prompt, '<html><body>Pending...</body></html>', '']
    );
    return { id: jobId, prompt, user_id: ownerId };
}

async function main() {
    const command = process.argv[2];
    if (!command || hasFlag('--help') || hasFlag('-h')) {
        usage();
        return;
    }

    if (command === 'inspect') {
        const prompt = readArg('--prompt', process.argv.slice(3).join(' '));
        if (!prompt) throw new Error('inspect requires --prompt');
        const template = selectMakerTemplateContract({}, prompt);
        const assetContract = buildMakerAssetContract(template, {});
        const debugProtocol = buildMakerDebugProtocol(template, null);
        const scaffold = await loadMakerTemplateScaffold(template.templateId);
        console.log(JSON.stringify({
            template,
            assetContract: summarizeMakerAssetContract(assetContract),
            debugProtocol,
            scaffold: summarizeMakerTemplateScaffold(scaffold),
        }, null, 2));
        return;
    }

    if (command === 'run-job') {
        const jobId = readArg('--job-id');
        if (!jobId) throw new Error('run-job requires --job-id');
        const job = await getJob(jobId);
        const { executeDreamJob } = await import('../src/ai-engine/routes.js');
        console.log(`[GameTok Maker CLI] Running job ${job.id}`);
        await executeDreamJob(job.id, job.prompt, []);
        return;
    }

    if (command === 'run-prompt') {
        const prompt = readArg('--prompt');
        if (!prompt) throw new Error('run-prompt requires --prompt');
        const userId = readArg('--user-id');
        const job = await createPendingJob(prompt, userId);
        const { executeDreamJob } = await import('../src/ai-engine/routes.js');
        console.log(`[GameTok Maker CLI] Created and running job ${job.id}`);
        await executeDreamJob(job.id, job.prompt, []);
        return;
    }

    throw new Error(`Unknown command: ${command}`);
}

main()
    .catch((error) => {
        console.error(`[GameTok Maker CLI] ${error.stack || error.message || error}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
