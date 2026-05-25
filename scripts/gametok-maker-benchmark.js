#!/usr/bin/env node
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import pool from '../src/db.js';
import { selectMakerTemplateContract } from '../src/ai-engine/maker-templates.js';
import { buildMakerDebugProtocol } from '../src/ai-engine/maker-debug-protocol.js';
import { buildMakerAssetContract, summarizeMakerAssetContract } from '../src/ai-engine/maker-asset-contracts.js';
import { buildMakerDesignBrief, summarizeMakerDesignBrief } from '../src/ai-engine/maker-design-brief.js';
import {
    filterMakerBenchmarkSuite,
    getMakerBenchmarkSuite,
    summarizeMakerBenchmark,
} from '../src/ai-engine/maker-benchmark-suite.js';
import { scoreMakerBenchmarkResult } from '../src/ai-engine/maker-benchmark-results.js';

function readArg(name, fallback = null) {
    const index = process.argv.indexOf(name);
    if (index === -1) return fallback;
    return process.argv[index + 1] || fallback;
}

function readRepeatedArg(name) {
    const values = [];
    for (let index = 0; index < process.argv.length; index += 1) {
        if (process.argv[index] === name && process.argv[index + 1]) {
            values.push(process.argv[index + 1]);
        }
    }
    return values;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function usage() {
    console.log([
        'GameTok Maker Benchmark CLI',
        '',
        'Commands:',
        '  list',
        '      List the native maker benchmark suite.',
        '',
        '  inspect [--id <benchmark-id>] [--template <template-id>] [--difficulty core|breadth] [--limit N]',
        '      Print selected template, asset, design, and debug contracts without running AI.',
        '',
        '  run --user-id <uuid> [--id <benchmark-id>] [--template <template-id>] [--difficulty core|breadth] [--limit N] [--dry-run]',
        '      Enqueue selected benchmark prompts into the normal generation_jobs queue.',
        '',
        '  collect [--job-id <uuid>] [--id <benchmark-id>] [--limit N]',
        '      Collect stored benchmark results from generation_jobs payloads.',
        '',
        '  score [--job-id <uuid>] [--id <benchmark-id>] [--limit N]',
        '      Print compact benchmark scores from stored results.',
        '',
        '  report [--job-id <uuid>] [--id <benchmark-id>] [--limit N]',
        '      Print aggregate pass/watch/weak/fail counts and recurring blockers.',
        '',
    ].join('\n'));
}

function selectBenchmarks() {
    return filterMakerBenchmarkSuite({
        ids: readRepeatedArg('--id'),
        templates: readRepeatedArg('--template'),
        difficulty: readArg('--difficulty'),
        limit: readArg('--limit'),
    });
}

function storageRoot() {
    if (process.env.ASSET_STORAGE_ROOT) return process.env.ASSET_STORAGE_ROOT;
    return fs.existsSync('/app') ? '/app/storage' : path.resolve(process.cwd(), 'storage');
}

async function ensureGenerationQueueSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS generation_jobs (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(32) NOT NULL DEFAULT 'dream',
            status VARCHAR(32) NOT NULL DEFAULT 'queued',
            prompt TEXT NOT NULL,
            payload JSONB DEFAULT '{}'::jsonb,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 2,
            progress INTEGER NOT NULL DEFAULT 0,
            phase VARCHAR(64) DEFAULT 'queued',
            status_message TEXT,
            locked_by TEXT,
            locked_at TIMESTAMP,
            run_after TIMESTAMP DEFAULT NOW(),
            error TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP,
            canceled_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_claim ON generation_jobs(status, run_after, created_at);
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_created ON generation_jobs(user_id, created_at DESC);
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS phase VARCHAR(64) DEFAULT 'queued';
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS status_message TEXT;
    `);
}

function benchmarkPrompt(benchmark) {
    return [
        benchmark.prompt,
        '',
        `Title: ${benchmark.title}`,
        `Benchmark ID: ${benchmark.id}`,
        `Expected template: ${benchmark.templateId}`,
        'Acceptance checks:',
        ...benchmark.acceptance.map((item) => `- ${item}`),
    ].join('\n');
}

async function enqueueBenchmarkJob(benchmark, userId) {
    const jobId = randomUUID();
    const prompt = benchmarkPrompt(benchmark);
    const payload = {
        benchmark: {
            id: benchmark.id,
            title: benchmark.title,
            templateId: benchmark.templateId,
            difficulty: benchmark.difficulty,
            acceptance: benchmark.acceptance,
            liveProbeExpectations: benchmark.liveProbeExpectations || [],
        },
        source: 'gametok-maker-benchmark',
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6, true)
             ON CONFLICT (id) DO UPDATE
             SET title = EXCLUDED.title,
                 html_payload = '',
                 raw_code = '',
                 prompt = EXCLUDED.prompt,
                 is_draft = true`,
            [jobId, userId, prompt, benchmark.title, '', '']
        );
        await client.query(
            `INSERT INTO generation_jobs (id, user_id, kind, status, prompt, payload, max_attempts, progress, phase, status_message)
             VALUES ($1, $2, 'dream', 'queued', $3, $4::jsonb, $5, 0, 'queued', 'Waiting for benchmark forge worker...')
             ON CONFLICT (id) DO UPDATE
             SET status = 'queued',
                 prompt = EXCLUDED.prompt,
                 payload = EXCLUDED.payload,
                 max_attempts = EXCLUDED.max_attempts,
                 progress = 0,
                 phase = 'queued',
                 status_message = 'Waiting for benchmark forge worker...',
                 run_after = NOW(),
                 error = NULL,
                 updated_at = NOW(),
                 completed_at = NULL,
                 canceled_at = NULL`,
            [
                jobId,
                userId,
                prompt,
                JSON.stringify(payload),
                Number(process.env.MAKER_BENCHMARK_MAX_ATTEMPTS || 1),
            ]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    return { jobId, benchmark: summarizeMakerBenchmark(benchmark) };
}

async function writeManifest(results) {
    const dir = path.join(storageRoot(), 'gametok-maker-benchmarks');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fsp.writeFile(file, JSON.stringify({
        createdAt: new Date().toISOString(),
        results,
    }, null, 2));
    return file;
}

async function inspectBenchmarks(benchmarks) {
    const inspections = benchmarks.map((benchmark) => {
        const template = selectMakerTemplateContract({}, benchmark.prompt);
        const assetContract = buildMakerAssetContract(template, {});
        const debugProtocol = buildMakerDebugProtocol(template, null, assetContract);
        const designBrief = buildMakerDesignBrief({
            qualityIntent: {},
            prompt: benchmark.prompt,
            templateContract: template,
            assetContract,
        });
        return {
            benchmark: summarizeMakerBenchmark(benchmark),
            selectedTemplate: {
                templateId: template.templateId,
                label: template.label,
                confidence: template.confidence,
                reason: template.reason,
            },
            designBrief: summarizeMakerDesignBrief(designBrief),
            assetContract: summarizeMakerAssetContract(assetContract),
            debugProtocol,
        };
    });
    console.log(JSON.stringify(inspections, null, 2));
}

async function collectBenchmarkResults() {
    const jobId = readArg('--job-id');
    const benchmarkIds = readRepeatedArg('--id');
    const limit = Number(readArg('--limit', 25));
    const params = [];
    const filters = [
        "payload ? 'benchmark'",
    ];

    if (jobId) {
        params.push(jobId);
        filters.push(`id = $${params.length}`);
    }
    if (benchmarkIds.length > 0) {
        params.push(benchmarkIds);
        filters.push(`payload #>> '{benchmark,id}' = ANY($${params.length}::text[])`);
    }
    params.push(Number.isFinite(limit) && limit > 0 ? limit : 25);

    const result = await pool.query(
        `SELECT id, user_id, status, phase, error, created_at, updated_at, completed_at, payload
         FROM generation_jobs
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
    );

    return result.rows.map((row) => {
        const payload = row.payload || {};
        const benchmarkResult = payload.benchmarkResult || null;
        return {
            jobId: row.id,
            userId: row.user_id,
            status: row.status,
            phase: row.phase,
            error: row.error,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at,
            benchmark: payload.benchmark || null,
            result: benchmarkResult,
            score: benchmarkResult ? scoreMakerBenchmarkResult(benchmarkResult) : null,
        };
    });
}

function compactBenchmarkScore(row) {
    const score = row.score || row.result?.score || null;
    return {
        jobId: row.jobId,
        status: row.status,
        benchmarkId: row.benchmark?.id || row.result?.benchmark?.id || null,
        title: row.benchmark?.title || row.result?.benchmark?.title || null,
        templateId: row.benchmark?.templateId || row.result?.benchmark?.templateId || null,
        score: score?.score ?? null,
        grade: score?.grade || null,
        blockers: score?.blockers || [],
    };
}

function benchmarkReport(rows) {
    const compact = rows.map(compactBenchmarkScore);
    const gradeCounts = compact.reduce((acc, row) => {
        const grade = row.grade || 'unknown';
        acc[grade] = (acc[grade] || 0) + 1;
        return acc;
    }, {});
    const byTemplate = {};
    const blockers = new Map();
    for (const row of compact) {
        const templateId = row.templateId || 'unknown';
        byTemplate[templateId] = byTemplate[templateId] || { total: 0, pass: 0, watch: 0, weak: 0, fail: 0, unknown: 0 };
        byTemplate[templateId].total += 1;
        byTemplate[templateId][row.grade || 'unknown'] = (byTemplate[templateId][row.grade || 'unknown'] || 0) + 1;
        for (const blocker of row.blockers || []) {
            const normalized = String(blocker || '').replace(/\s+/g, ' ').slice(0, 180);
            if (!normalized) continue;
            blockers.set(normalized, (blockers.get(normalized) || 0) + 1);
        }
    }
    return {
        total: compact.length,
        gradeCounts,
        passRate: compact.length ? Number((((gradeCounts.pass || 0) / compact.length) * 100).toFixed(1)) : 0,
        byTemplate,
        recurringBlockers: Array.from(blockers.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([message, count]) => ({ count, message })),
        scores: compact,
    };
}

async function main() {
    const command = process.argv[2];
    if (!command || hasFlag('--help') || hasFlag('-h')) {
        usage();
        return;
    }

    if (command === 'list') {
        console.log(JSON.stringify(getMakerBenchmarkSuite().map(summarizeMakerBenchmark), null, 2));
        return;
    }

    if (command === 'inspect') {
        const benchmarks = selectBenchmarks();
        if (benchmarks.length === 0) throw new Error('No benchmarks matched the requested filters.');
        await inspectBenchmarks(benchmarks);
        return;
    }

    if (command === 'run') {
        const benchmarks = selectBenchmarks();
        if (benchmarks.length === 0) throw new Error('No benchmarks matched the requested filters.');

        if (hasFlag('--dry-run')) {
            console.log(JSON.stringify(benchmarks.map(summarizeMakerBenchmark), null, 2));
            return;
        }

        const userId = readArg('--user-id') || process.env.GAMETOK_MAKER_BENCHMARK_USER_ID;
        if (!userId) {
            throw new Error('run requires --user-id or GAMETOK_MAKER_BENCHMARK_USER_ID.');
        }

        await ensureGenerationQueueSchema();
        const results = [];
        for (const benchmark of benchmarks) {
            results.push(await enqueueBenchmarkJob(benchmark, userId));
        }
        const manifestPath = await writeManifest(results);
        console.log(JSON.stringify({
            enqueued: results.length,
            manifestPath,
            results,
        }, null, 2));
        return;
    }

    if (command === 'collect') {
        const results = await collectBenchmarkResults();
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    if (command === 'score') {
        const results = await collectBenchmarkResults();
        console.log(JSON.stringify(results.map(compactBenchmarkScore), null, 2));
        return;
    }

    if (command === 'report') {
        const results = await collectBenchmarkResults();
        console.log(JSON.stringify(benchmarkReport(results), null, 2));
        return;
    }

    throw new Error(`Unknown command: ${command}`);
}

main()
    .catch((error) => {
        console.error(`[GameTok Maker Benchmark] ${error.stack || error.message || error}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
