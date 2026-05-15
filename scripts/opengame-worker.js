import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool, { initDB } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_ID = process.env.OPENGAME_WORKER_ID || `${process.env.RAILWAY_SERVICE_ID || 'local'}-${process.pid}`;
const POLL_MS = Math.max(1000, Number(process.env.OPENGAME_WORKER_POLL_MS || 5000));
const HEARTBEAT_MS = Math.max(10000, Number(process.env.OPENGAME_WORKER_HEARTBEAT_MS || 30000));
const JOB_TIMEOUT_MS = Math.max(5 * 60 * 1000, Number(process.env.OPENGAME_JOB_TIMEOUT_MS || 45 * 60 * 1000));
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const OPENGAME_CACHE_ROOT = process.env.OPENGAME_CACHE_ROOT || path.join(STORAGE_ROOT, 'opengame-runtime');
const OPENGAME_ROOT = process.env.OPENGAME_ROOT || path.join(OPENGAME_CACHE_ROOT, 'OpenGame');
const OPENGAME_REPO = process.env.OPENGAME_REPO || 'https://github.com/leigest519/OpenGame.git';
const OPENGAME_REF = process.env.OPENGAME_REF || '';
const OPENGAME_JOBS_ROOT = process.env.OPENGAME_JOBS_ROOT || path.join(STORAGE_ROOT, 'opengame-jobs');
const OPENGAME_PUBLIC_BASE = (process.env.OPENGAME_PUBLIC_BASE || '/opengame-games').replace(/\/+$/, '');
const R2_PREFIX = String(process.env.OPENGAME_R2_PREFIX || 'opengame-games').replace(/^\/+|\/+$/g, '');

let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = options.timeoutMs ? setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
    }, options.timeoutMs) : null;
    timer?.unref?.();

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr, code, signal });
      const error = new Error(`${command} ${args.join(' ')} failed with code=${code} signal=${signal}\n${stderr.slice(-4000)}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureOpenGameRuntime() {
  await fs.mkdir(OPENGAME_CACHE_ROOT, { recursive: true });
  if (!(await pathExists(path.join(OPENGAME_ROOT, 'package.json')))) {
    console.log(`[OpenGame Worker] Cloning OpenGame from ${OPENGAME_REPO}...`);
    await runCommand('git', ['clone', '--depth=1', OPENGAME_REPO, OPENGAME_ROOT], { timeoutMs: 10 * 60 * 1000 });
  }
  if (OPENGAME_REF) {
    await runCommand('git', ['fetch', '--depth=1', 'origin', OPENGAME_REF], { cwd: OPENGAME_ROOT, timeoutMs: 5 * 60 * 1000 });
    await runCommand('git', ['checkout', 'FETCH_HEAD'], { cwd: OPENGAME_ROOT, timeoutMs: 2 * 60 * 1000 });
  }
  if (!(await pathExists(path.join(OPENGAME_ROOT, 'node_modules')))) {
    console.log('[OpenGame Worker] Installing OpenGame dependencies...');
    await runCommand('npm', ['install'], { cwd: OPENGAME_ROOT, timeoutMs: 20 * 60 * 1000 });
  }
  if (!(await pathExists(path.join(OPENGAME_ROOT, 'dist', 'cli.js')))) {
    console.log('[OpenGame Worker] Building OpenGame CLI...');
    await runCommand('npm', ['run', 'build'], { cwd: OPENGAME_ROOT, timeoutMs: 20 * 60 * 1000 });
  }
}

async function ensureQueueSchema() {
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
  `);
}

async function claimJob() {
  const result = await pool.query(
    `WITH candidate AS (
       SELECT id
       FROM generation_jobs
       WHERE status = 'queued'
         AND kind = 'opengame'
         AND run_after <= NOW()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE generation_jobs job
     SET status = 'running',
         attempts = attempts + 1,
         progress = GREATEST(progress, 3),
         phase = 'starting',
         status_message = 'OpenGame worker started...',
         locked_by = $1,
         locked_at = NOW(),
         updated_at = NOW()
     FROM candidate
     WHERE job.id = candidate.id
     RETURNING job.*`,
    [WORKER_ID]
  );
  return result.rows[0] || null;
}

async function updateJob(jobId, progress, phase, message) {
  await pool.query(
    `UPDATE generation_jobs
     SET progress = GREATEST(progress, $2),
         phase = COALESCE($3, phase),
         status_message = COALESCE($4, status_message),
         updated_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [jobId, Math.max(0, Math.min(99, Number(progress) || 0)), phase || null, message || null]
  );
}

async function failJob(job, errorMessage) {
  const shouldRetry = Number(job.attempts || 0) < Number(job.max_attempts || 1);
  await pool.query(
    `UPDATE generation_jobs
     SET status = $2::varchar,
         phase = CASE WHEN $2::varchar = 'queued' THEN 'retrying' ELSE 'failed' END,
         status_message = $3,
         error = $3,
         locked_by = NULL,
         locked_at = NULL,
         run_after = CASE WHEN $2::varchar = 'queued' THEN NOW() + INTERVAL '30 seconds' ELSE run_after END,
         updated_at = NOW()
     WHERE id = $1`,
    [job.id, shouldRetry ? 'queued' : 'failed', errorMessage || 'OpenGame generation failed']
  );
}

async function completeJob(jobId) {
  await pool.query(
    `UPDATE generation_jobs
     SET status = 'complete',
         progress = 100,
         phase = 'complete',
         status_message = 'OpenGame build is ready.',
         locked_by = NULL,
         locked_at = NULL,
         error = NULL,
         updated_at = NOW(),
         completed_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
}

function hasR2Config() {
  return Boolean(process.env.R2_BUCKET_NAME && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

async function walkFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolute, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, absolute));
    }
  }
  return files;
}

async function uploadDirectoryToR2(dir, jobId) {
  const client = r2Client();
  const files = await walkFiles(dir);
  const publicBase = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
  for (const relative of files) {
    const key = `${R2_PREFIX}/${jobId}/${relative.split(path.sep).join('/')}`;
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: await fs.readFile(path.join(dir, relative)),
      ContentType: contentTypeFor(relative),
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return `${publicBase}/${R2_PREFIX}/${jobId}/index.html`;
}

async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const files = await walkFiles(src);
  for (const relative of files) {
    const target = path.join(dest, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(src, relative), target);
  }
}

async function publishArtifact(artifactDir, jobId) {
  if (hasR2Config()) {
    return uploadDirectoryToR2(artifactDir, jobId);
  }
  const dest = path.join(STORAGE_ROOT, 'opengame-games', jobId);
  await fs.rm(dest, { recursive: true, force: true });
  await copyDirectory(artifactDir, dest);
  return `${OPENGAME_PUBLIC_BASE}/${jobId}/index.html`;
}

async function findArtifactDir(jobDir) {
  const candidates = [
    path.join(jobDir, 'dist'),
    path.join(jobDir, 'build'),
    jobDir,
  ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'index.html'))) return candidate;
  }
  throw new Error('OpenGame finished but no index.html artifact was found.');
}

function buildIframeHtml(url, title) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>${String(title || 'OpenGame Build').replace(/[<>&"]/g, '')}</title>
  <style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;}
    iframe{border:0;width:100vw;height:100vh;display:block;background:#000;}
  </style>
</head>
<body>
  <iframe src="${url}" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}

async function maybeBuildProject(jobDir) {
  if (!(await pathExists(path.join(jobDir, 'package.json')))) return;
  if (!(await pathExists(path.join(jobDir, 'node_modules')))) {
    await runCommand('npm', ['install'], { cwd: jobDir, timeoutMs: 10 * 60 * 1000 });
  }
  const packageJson = JSON.parse(await fs.readFile(path.join(jobDir, 'package.json'), 'utf8'));
  if (packageJson.scripts?.build) {
    await runCommand('npm', ['run', 'build'], { cwd: jobDir, timeoutMs: 10 * 60 * 1000 });
  }
}

function progressFromOutput(text) {
  const lower = text.toLowerCase();
  if (lower.includes('generate_game_assets') || lower.includes('asset')) return [35, 'assets', 'Generating game assets...'];
  if (lower.includes('scaffold') || lower.includes('template')) return [20, 'scaffold', 'Scaffolding game project...'];
  if (lower.includes('debug') || lower.includes('error') || lower.includes('fix')) return [70, 'debug', 'Debugging generated game...'];
  if (lower.includes('npm run build') || lower.includes('build')) return [82, 'build', 'Building game artifact...'];
  return null;
}

async function runOpenGameJob(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const title = payload.title || 'OpenGame Build';
  const jobDir = path.join(OPENGAME_JOBS_ROOT, job.id);
  await fs.rm(jobDir, { recursive: true, force: true });
  await fs.mkdir(jobDir, { recursive: true });
  await updateJob(job.id, 8, 'preparing', 'Preparing OpenGame runtime...');
  await ensureOpenGameRuntime();

  const env = {
    ...process.env,
    GAME_TEMPLATES_DIR: process.env.GAME_TEMPLATES_DIR || path.join(OPENGAME_ROOT, 'agent-test', 'templates'),
    GAME_DOCS_DIR: process.env.GAME_DOCS_DIR || path.join(OPENGAME_ROOT, 'agent-test', 'docs'),
  };
  const cliPath = path.join(OPENGAME_ROOT, 'dist', 'cli.js');
  await updateJob(job.id, 14, 'opengame', 'OpenGame is designing the project...');

  const logPath = path.join(jobDir, 'opengame.log');
  const appendLog = async (text) => fs.appendFile(logPath, text).catch(() => {});
  await runCommand('node', [
    cliPath,
    '-p',
    job.prompt,
    '--yolo',
    '--output-format',
    'stream-json',
  ], {
    cwd: jobDir,
    env,
    timeoutMs: JOB_TIMEOUT_MS,
    onStdout: (text) => {
      process.stdout.write(text);
      void appendLog(text);
      const progress = progressFromOutput(text);
      if (progress) void updateJob(job.id, progress[0], progress[1], progress[2]);
    },
    onStderr: (text) => {
      process.stderr.write(text);
      void appendLog(text);
    },
  });

  await updateJob(job.id, 86, 'build', 'Building OpenGame artifact...');
  await maybeBuildProject(jobDir);
  const artifactDir = await findArtifactDir(jobDir);
  await updateJob(job.id, 92, 'publish', 'Publishing OpenGame artifact...');
  const playableUrl = await publishArtifact(artifactDir, job.id);
  const wrapperHtml = buildIframeHtml(playableUrl, title);
  await pool.query(
    `UPDATE ai_games
     SET title = $1,
         html_payload = $2,
         raw_code = $3,
         artist_code = $4,
         is_draft = true
     WHERE id = $5`,
    [
      title,
      wrapperHtml,
      JSON.stringify({ playableUrl, artifactDir: path.basename(artifactDir), engine: 'opengame' }, null, 2),
      await fs.readFile(logPath, 'utf8').catch(() => ''),
      job.id,
    ]
  );
  await completeJob(job.id);
}

async function handleJob(job) {
  console.log(`[OpenGame Worker] Claimed ${job.id} attempt ${job.attempts}/${job.max_attempts}`);
  const heartbeat = setInterval(() => {
    pool.query(
      `UPDATE generation_jobs SET locked_at = NOW(), updated_at = NOW() WHERE id = $1 AND locked_by = $2`,
      [job.id, WORKER_ID]
    ).catch((error) => console.warn(`[OpenGame Worker] heartbeat failed: ${error.message}`));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    await runOpenGameJob(job);
    console.log(`[OpenGame Worker] Complete ${job.id}`);
  } catch (error) {
    console.error(`[OpenGame Worker] Failed ${job.id}:`, error);
    await failJob(job, error.message || 'OpenGame generation failed');
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  console.log(`[OpenGame Worker] Starting ${WORKER_ID}`);
  await initDB();
  await ensureQueueSchema();
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });

  while (!stopping) {
    const job = await claimJob();
    if (job) {
      await handleJob(job);
      continue;
    }
    await sleep(POLL_MS);
  }
  await pool.end();
  console.log('[OpenGame Worker] Stopped');
}

main().catch((error) => {
  console.error('[OpenGame Worker] Fatal:', error);
  process.exit(1);
});
