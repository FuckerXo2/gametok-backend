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
const DEFAULT_NIM_TOOL_MODEL = 'qwen/qwen3-coder-480b-a35b-instruct';
const OPENGAME_CONTINUE_ATTEMPTS = Math.max(0, Number(process.env.OPENGAME_CONTINUE_ATTEMPTS || 2));
const DEFAULT_OPENGAME_CORE_TOOLS = [
  'read_file',
  'read_many_files',
  'write_file',
  'edit',
  'list_directory',
  'glob',
  'grep_search',
  'run_shell_command',
  'generate_gdd',
  'generate_game_assets',
  'generate_tilemap',
].join(',');

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
      const safeArgs = redactCommandArgs(args);
      const error = new Error(`${command} ${safeArgs.join(' ')} failed with code=${code} signal=${signal}\n${stderr.slice(-4000)}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

function redactCommandArgs(args) {
  const sensitiveFlags = new Set([
    '--openai-api-key',
    '--api-key',
    '--key',
    '--token',
  ]);
  return args.map((arg, index) => {
    const previous = args[index - 1];
    if (sensitiveFlags.has(previous)) return '[redacted-api-key]';
    if (typeof arg === 'string' && /^(nvapi-|sk-|fal-)/i.test(arg)) return '[redacted-api-key]';
    return arg;
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
    await installOpenGameRuntime();
  }
  if (OPENGAME_REF && await pathExists(path.join(OPENGAME_ROOT, '.git'))) {
    await runCommand('git', ['fetch', '--depth=1', 'origin', OPENGAME_REF], { cwd: OPENGAME_ROOT, timeoutMs: 5 * 60 * 1000 });
    await runCommand('git', ['checkout', 'FETCH_HEAD'], { cwd: OPENGAME_ROOT, timeoutMs: 2 * 60 * 1000 });
  }
  const patched = await patchOpenGameRuntime();
  if (!(await pathExists(path.join(OPENGAME_ROOT, 'node_modules')))) {
    console.log('[OpenGame Worker] Installing OpenGame dependencies...');
    await runCommand('npm', ['install'], { cwd: OPENGAME_ROOT, timeoutMs: 20 * 60 * 1000 });
  }
  if (patched || !(await pathExists(path.join(OPENGAME_ROOT, 'dist', 'cli.js')))) {
    console.log('[OpenGame Worker] Building OpenGame CLI...');
    await runCommand('npm', ['run', 'build'], { cwd: OPENGAME_ROOT, timeoutMs: 20 * 60 * 1000 });
  }
}

function parseGitHubRepo(repoUrl) {
  const match = String(repoUrl).match(/github\.com[:/]+([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function installOpenGameRuntime() {
  console.log(`[OpenGame Worker] Cloning OpenGame from ${OPENGAME_REPO}...`);
  try {
    await runCommand('git', ['clone', '--depth=1', OPENGAME_REPO, OPENGAME_ROOT], { timeoutMs: 10 * 60 * 1000 });
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.message && !error.message.includes('spawn git ENOENT')) {
      throw error;
    }
    console.warn('[OpenGame Worker] git is not available; falling back to GitHub tarball download.');
  }

  const parsed = parseGitHubRepo(OPENGAME_REPO);
  if (!parsed) {
    throw new Error(`Cannot download OpenGame tarball for non-GitHub repo: ${OPENGAME_REPO}`);
  }

  const ref = OPENGAME_REF || 'main';
  const tarballUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/tar.gz/${encodeURIComponent(ref)}`;
  const tmpDir = path.join(OPENGAME_CACHE_ROOT, `download-${Date.now()}`);
  const archivePath = path.join(tmpDir, 'opengame.tar.gz');
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`OpenGame tarball download failed: ${response.status} ${await response.text()}`);
  }
  await fs.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await runCommand('tar', ['-xzf', archivePath, '-C', tmpDir], { timeoutMs: 5 * 60 * 1000 });

  const entries = await fs.readdir(tmpDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name !== path.basename(OPENGAME_ROOT));
  if (!extracted) {
    throw new Error('OpenGame tarball extracted without a source directory.');
  }

  await fs.rm(OPENGAME_ROOT, { recursive: true, force: true });
  await copyDirectory(path.join(tmpDir, extracted.name), OPENGAME_ROOT);
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  console.log('[OpenGame Worker] Installed OpenGame from GitHub tarball.');
}

async function patchOpenGameRuntime() {
  let changed = false;
  changed = (await patchFalImageService()) || changed;
  changed = (await patchNvidiaOpenAICompatTextMessages()) || changed;
  changed = (await patchImageEditModelEnv()) || changed;
  changed = (await patchDisableVideoByDefault()) || changed;
  if (changed) {
    console.log('[OpenGame Worker] Applied GameTok OpenGame runtime patches.');
  }
  return changed;
}

async function patchFile(relativePath, transform) {
  const filePath = path.join(OPENGAME_ROOT, relativePath);
  const before = await fs.readFile(filePath, 'utf8');
  const after = transform(before);
  if (after === before) return false;
  await fs.writeFile(filePath, after);
  return true;
}

async function patchFalImageService() {
  return patchFile('packages/core/src/services/assetImageService.ts', (source) => {
    if (source.includes('GameTok Fal image adapter')) return source;

    let next = source.replace(
      `    const url = \`\${this.config.baseUrl}/images/generations\`;
    const normalizedSize = size.replace('*', 'x');

    const payload = {`,
      `    const url = \`\${this.config.baseUrl}/images/generations\`;
    const normalizedSize = size.replace('*', 'x');

    if (this.isFalRun()) {
      return this.generateFalImage(prompt, normalizedSize);
    }

    const payload = {`,
    );

    next = next.replace(
      `  async editImage(
    referenceImageUrl: string,
    prompt: string,
    _previousFrameUrl?: string | null,
  ): Promise<string> {
    // The OpenAI image-edit endpoint only takes a single reference image`,
      `  async editImage(
    referenceImageUrl: string,
    prompt: string,
    _previousFrameUrl?: string | null,
  ): Promise<string> {
    if (this.isFalRun()) {
      return this.editFalImage(referenceImageUrl, prompt, _previousFrameUrl);
    }

    // The OpenAI image-edit endpoint only takes a single reference image`,
    );

    const falMethods = `

  // GameTok Fal image adapter. OpenGame's generic OpenAI-compat image service
  // assumes /images/generations and does not perform real image-conditioned
  // edits. Fal model endpoints use /<model-id> and return images[] URLs, so
  // translate here while keeping the upstream provider contract intact.
  private isFalRun(): boolean {
    return this.config.baseUrl.includes('fal.run') || this.config.baseUrl.includes('fal.ai');
  }

  private falEndpoint(modelName: string): string {
    const base = this.config.baseUrl.replace(/\\/+$/g, '');
    const model = modelName.replace(/^https?:\\/\\/[^/]+\\/?/i, '').replace(/^\\/+|\\/+$/g, '');
    return \`\${base}/\${model}\`;
  }

  private falImageSize(size: string): string | { width: number; height: number } {
    const [width, height] = size.split('x').map((value) => Number(value));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
    return 'square_hd';
  }

  private extractFalImageUrl(data: unknown): string | undefined {
    const record = data as {
      images?: Array<{ url?: string }>;
      image?: { url?: string } | string;
      url?: string;
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const imageUrl = record.images?.[0]?.url;
    if (imageUrl) return imageUrl;
    if (typeof record.image === 'string') return record.image;
    if (record.image && typeof record.image === 'object' && 'url' in record.image && record.image.url) {
      return record.image.url;
    }
    if (record.url) return record.url;
    const item = record.data?.[0];
    if (item?.url) return item.url;
    if (item?.b64_json) return \`data:image/png;base64,\${item.b64_json}\`;
    return undefined;
  }

  private async postFalImage(modelName: string, payload: Record<string, unknown>): Promise<string> {
    const response = await this.fetchWithRetry(this.falEndpoint(modelName), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Key \${this.config.apiKey}\`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(\`Fal image API failed: \${response.status} - \${errorBody}\`);
    }

    const data = await response.json();
    const imageUrl = this.extractFalImageUrl(data);
    if (!imageUrl) {
      throw new Error('Fal image API returned no image URL');
    }
    return imageUrl;
  }

  private async generateFalImage(prompt: string, size: string): Promise<string> {
    this.log(\`Generating image via Fal: \${prompt.substring(0, 50)}...\`);
    return this.postFalImage(this.config.modelNameGeneration, {
      prompt,
      image_size: this.falImageSize(size),
      num_images: 1,
      enable_safety_checker: true,
    });
  }

  private async editFalImage(
    referenceImageUrl: string,
    prompt: string,
    previousFrameUrl?: string | null,
  ): Promise<string> {
    this.log('Editing image via Fal I2I...');
    const editModel =
      process.env.OPENGAME_IMAGE_EDIT_MODEL ||
      process.env.FAL_IMAGE_EDIT_MODEL ||
      this.config.modelNameEditing ||
      this.config.modelNameGeneration;
    return this.postFalImage(editModel, {
      prompt,
      image_url: referenceImageUrl,
      image_urls: previousFrameUrl ? [referenceImageUrl, previousFrameUrl] : [referenceImageUrl],
      num_images: 1,
      enable_safety_checker: true,
    });
  }
`;

    return next.replace(
      `}\n\n// ============== Image Service Interface ==============`,
      `${falMethods}\n}\n\n// ============== Image Service Interface ==============`,
    );
  });
}

async function patchNvidiaOpenAICompatTextMessages() {
  return patchFile('packages/core/src/core/openaiContentGenerator/provider/default.ts', (source) => {
    if (source.includes('GameTok NVIDIA NIM compatibility')) return source;

    let next = source.replace(
      `    // Default provider doesn't need special enhancements, just pass through all parameters
    return {
      ...request, // Preserve all original parameters including sampling params
    };`,
      `    // GameTok NVIDIA NIM compatibility: NVIDIA's OpenAI-compatible chat
    // endpoint rejects text-only content arrays from the upstream Gemini->OpenAI
    // converter with "unhashable type: 'dict'". For NIM only, flatten those
    // messages back to plain strings while preserving true multimodal payloads.
    const normalizedRequest = this.normalizeTextOnlyMessageContent(request);
    return {
      ...normalizedRequest, // Preserve all original parameters including sampling params
    };`,
    );

    const helper = `

  private normalizeTextOnlyMessageContent(
    request: OpenAI.Chat.ChatCompletionCreateParams,
  ): OpenAI.Chat.ChatCompletionCreateParams {
    const baseUrl = String(this.contentGeneratorConfig.baseUrl || '');
    if (!baseUrl.includes('integrate.api.nvidia.com')) {
      return request;
    }

    return {
      ...request,
      messages: request.messages.map((message) => {
        const content = (message as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          return message;
        }

        const onlyText = content.every((part) => {
          return (
            part &&
            typeof part === 'object' &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string'
          );
        });

        if (!onlyText) {
          return message;
        }

        return {
          ...message,
          content: content.map((part) => (part as { text: string }).text).join(''),
        } as OpenAI.Chat.ChatCompletionMessageParam;
      }),
    };
  }
`;

    next = next.replace(
      `  getDefaultGenerationConfig(): GenerateContentConfig {`,
      `${helper}\n  getDefaultGenerationConfig(): GenerateContentConfig {`,
    );

    return next;
  });
}

async function patchImageEditModelEnv() {
  return patchFile('packages/core/src/services/assetModelRouter.ts', (source) => {
    if (source.includes('process.env.OPENGAME_IMAGE_EDIT_MODEL')) return source;
    return source.replace(
      `      modelNameEditing:
        IMAGE_EDIT_DEFAULTS[this.imageConfig.provider] ??
        this.imageConfig.model,`,
      `      modelNameEditing:
        process.env.OPENGAME_IMAGE_EDIT_MODEL ??
        process.env.FAL_IMAGE_EDIT_MODEL ??
        IMAGE_EDIT_DEFAULTS[this.imageConfig.provider] ??
        this.imageConfig.model,`,
    );
  });
}

async function patchDisableVideoByDefault() {
  return patchFile('packages/core/src/tools/generate-assets.ts', (source) => {
    let next = source;
    if (!next.includes('GameTok default: I2I frames')) {
      next = next.replace(
      `    const useI2V = req.useI2V !== false; // Default: true (use I2V unless explicitly disabled)`,
      `    const useI2V = process.env.OPENGAME_VIDEO_ENABLED === 'true' && req.useI2V !== false; // GameTok default: I2I frames, video only by explicit opt-in`,
      );
    }
    if (!next.includes('GameTok default: no video-for-audio')) {
      next = next.replace(
        `    if (ffmpegAvailable) {`,
        `    if (ffmpegAvailable && process.env.OPENGAME_VIDEO_ENABLED === 'true') { // GameTok default: no video-for-audio spend unless explicitly enabled`,
      );
    }
    return next;
  });
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
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cache') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolute, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, absolute));
    }
  }
  return files;
}

async function listGeneratedFiles(dir, limit = 120) {
  const files = await walkFiles(dir).catch(() => []);
  return files
    .filter((file) => !file.split(path.sep).some((part) => part === 'node_modules' || part === '.git' || part === '.cache'))
    .sort()
    .slice(0, limit);
}

async function hasPartialOpenGameFiles(jobDir) {
  const files = await listGeneratedFiles(jobDir, 20);
  return files.some((file) => {
    const normalized = file.split(path.sep).join('/');
    if (normalized === 'opengame.log') return false;
    if (normalized.startsWith('openai-logs/')) return false;
    return /\.(html|js|mjs|css|json|ts|tsx|jsx|png|jpg|jpeg|webp|svg|wav|mp3|ogg)$/i.test(normalized);
  });
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

async function findArtifactDir(jobDir, logPath) {
  const candidates = [
    path.join(jobDir, 'dist'),
    path.join(jobDir, 'build'),
    jobDir,
  ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'index.html'))) return candidate;
  }

  const files = await walkFiles(jobDir).catch(() => []);
  const indexFiles = files.filter((file) => path.basename(file).toLowerCase() === 'index.html');
  if (indexFiles.length > 0) {
    const preferred = indexFiles.find((file) => file.split(path.sep).includes('dist'))
      || indexFiles.find((file) => file.split(path.sep).includes('build'))
      || indexFiles[0];
    return path.dirname(path.join(jobDir, preferred));
  }

  const visibleFiles = await listGeneratedFiles(jobDir, 80);
  const logTail = logPath
    ? (await fs.readFile(logPath, 'utf8').catch(() => '')).slice(-3500)
    : '';
  const fileHint = visibleFiles.length ? ` Files produced: ${visibleFiles.join(', ')}` : ' No files were produced in the job directory.';
  const logHint = logTail ? ` Log tail: ${logTail}` : '';
  throw new Error(`OpenGame finished but no index.html artifact was found.${fileHint}${logHint}`);
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

async function findAnyArtifactDir(jobDir, projectRoot, logPath) {
  return findArtifactDir(projectRoot, logPath).catch(async (error) => {
    if (projectRoot !== jobDir) {
      return findArtifactDir(jobDir, logPath);
    }
    throw error;
  });
}

async function findProjectRoot(jobDir) {
  if (await pathExists(path.join(jobDir, 'package.json'))) return jobDir;

  const entries = await fs.readdir(jobDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cache') continue;
    const candidate = path.join(jobDir, entry.name);
    if (await pathExists(path.join(candidate, 'package.json'))) return candidate;
  }

  return jobDir;
}

function progressFromOutput(text) {
  const lower = text.toLowerCase();
  if (lower.includes('generate_game_assets') || lower.includes('asset')) return [35, 'assets', 'Generating game assets...'];
  if (lower.includes('scaffold') || lower.includes('template')) return [20, 'scaffold', 'Scaffolding game project...'];
  if (lower.includes('debug') || lower.includes('error') || lower.includes('fix')) return [70, 'debug', 'Debugging generated game...'];
  if (lower.includes('npm run build') || lower.includes('build')) return [82, 'build', 'Building game artifact...'];
  return null;
}

function buildOpenGameCliArgs({ cliPath, prompt, env, openAiLogDir, coreTools }) {
  return [
    cliPath,
    prompt,
    '--approval-mode',
    'yolo',
    '--core-tools',
    coreTools,
    '--auth-type',
    'openai',
    '--model',
    env.OPENGAME_REASONING_MODEL,
    '--openai-api-key',
    env.OPENGAME_REASONING_API_KEY,
    '--openai-base-url',
    env.OPENGAME_REASONING_BASE_URL,
    '--channel',
    'CI',
    '--openai-logging',
    '--openai-logging-dir',
    openAiLogDir,
  ];
}

async function runOpenGameCli({ job, jobDir, env, cliArgs, logPath, appendLog }) {
  await appendLog(`[gametok-worker] node ${cliArgs.map((arg) => arg === env.OPENGAME_REASONING_API_KEY ? '[redacted-api-key]' : arg).join(' ')}\n`);
  await runCommand('node', cliArgs, {
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
}

function buildContinuationPrompt(originalPrompt, errorMessage) {
  return `Continue and polish this existing OpenGame project in the current directory. The previous generation was interrupted by a provider/runtime error, but any files already written are available here. Do not restart from scratch unless the files are unusable.

Finish the game requested by the user:
${originalPrompt}

Recovery requirements:
- Inspect the existing files first.
- Complete missing HTML/CSS/JS/assets needed for a polished playable mobile web game.
- If the project only has placeholder CSS/canvas shapes, improve it before finishing.
- Use generate_game_assets for proper game assets when the project needs sprites, backgrounds, terrain art, explosions, HUD icons, or UI art. Do not rely on flat placeholder rectangles/circles unless the asset tool is unavailable.
- Wire generated assets into the game through an asset manifest or direct asset paths.
- Fix syntax/runtime issues.
- Ensure the project leaves a playable index.html artifact in this directory, dist, or build.
- Keep controls large and mobile-friendly.

Previous error:
${String(errorMessage || 'generation interrupted').slice(0, 1200)}`;
}

function buildOpenGameEnv() {
  const requestedReasoningModel = process.env.OPENGAME_REASONING_MODEL || process.env.OPENAI_MODEL || 'moonshotai/kimi-k2.6';
  const toolCapableReasoningModel =
    /kimi/i.test(requestedReasoningModel)
      ? (process.env.OPENGAME_TOOL_MODEL || DEFAULT_NIM_TOOL_MODEL)
      : requestedReasoningModel;

  const env = {
    ...process.env,
    GAME_TEMPLATES_DIR: process.env.GAME_TEMPLATES_DIR || path.join(OPENGAME_ROOT, 'agent-test', 'templates'),
    GAME_DOCS_DIR: process.env.GAME_DOCS_DIR || path.join(OPENGAME_ROOT, 'agent-test', 'docs'),
    OPENGAME_REASONING_PROVIDER: process.env.OPENGAME_REASONING_PROVIDER || 'openai-compat',
    OPENGAME_REASONING_API_KEY: process.env.OPENGAME_REASONING_API_KEY || process.env.OPENAI_API_KEY || '',
    OPENGAME_REASONING_BASE_URL: process.env.OPENGAME_REASONING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    OPENGAME_REASONING_MODEL: toolCapableReasoningModel,
    OPENGAME_REQUESTED_REASONING_MODEL: requestedReasoningModel,
    OPENGAME_VIDEO_ENABLED: process.env.OPENGAME_VIDEO_ENABLED || 'false',
  };

  const falKey = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
  if (falKey && !process.env.OPENGAME_IMAGE_API_KEY) {
    env.OPENGAME_IMAGE_PROVIDER = process.env.OPENGAME_IMAGE_PROVIDER || 'openai-compat';
    env.OPENGAME_IMAGE_API_KEY = falKey;
    env.OPENGAME_IMAGE_BASE_URL = process.env.OPENGAME_IMAGE_BASE_URL || 'https://fal.run';
    env.OPENGAME_IMAGE_MODEL = process.env.OPENGAME_IMAGE_MODEL || process.env.FAL_IMAGE_MODEL || 'fal-ai/qwen-image';
    env.OPENGAME_IMAGE_EDIT_MODEL = process.env.OPENGAME_IMAGE_EDIT_MODEL || process.env.FAL_IMAGE_EDIT_MODEL || 'fal-ai/qwen-image-edit';
  }

  return env;
}

async function runOpenGameJob(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const title = payload.title || 'OpenGame Build';
  const jobDir = path.join(OPENGAME_JOBS_ROOT, job.id);
  await fs.rm(jobDir, { recursive: true, force: true });
  await fs.mkdir(jobDir, { recursive: true });
  await updateJob(job.id, 8, 'preparing', 'Preparing OpenGame runtime...');
  await ensureOpenGameRuntime();

  const env = buildOpenGameEnv();
  if (env.OPENGAME_REQUESTED_REASONING_MODEL !== env.OPENGAME_REASONING_MODEL) {
    console.warn(
      `[OpenGame Worker] Requested reasoning model ${env.OPENGAME_REQUESTED_REASONING_MODEL} is not tool-compatible for OpenGame; using ${env.OPENGAME_REASONING_MODEL}.`
    );
  }
  console.log(
    `[OpenGame Worker] Providers: reasoning=${env.OPENGAME_REASONING_PROVIDER}:${env.OPENGAME_REASONING_MODEL} image=${env.OPENGAME_IMAGE_PROVIDER || 'unconfigured'}:${env.OPENGAME_IMAGE_MODEL || 'unconfigured'} edit=${env.OPENGAME_IMAGE_EDIT_MODEL || 'default'} videoEnabled=${env.OPENGAME_VIDEO_ENABLED}`
  );
  const cliPath = path.join(OPENGAME_ROOT, 'dist', 'cli.js');
  await updateJob(job.id, 14, 'opengame', 'OpenGame is designing the project...');

  const logPath = path.join(jobDir, 'opengame.log');
  const openAiLogDir = path.join(jobDir, 'openai-logs');
  const appendLog = async (text) => fs.appendFile(logPath, text).catch(() => {});
  const coreTools = process.env.OPENGAME_CORE_TOOLS || DEFAULT_OPENGAME_CORE_TOOLS;
  const cliArgs = buildOpenGameCliArgs({
    cliPath,
    prompt: job.prompt,
    env,
    openAiLogDir,
    coreTools,
  });
  let cliError = null;
  try {
    await runOpenGameCli({ job, jobDir, env, cliArgs, logPath, appendLog });
  } catch (error) {
    cliError = error;
    console.warn(`[OpenGame Worker] CLI exited before clean completion for ${job.id}: ${error.message}`);
  }

  for (let attempt = 1; cliError && attempt <= OPENGAME_CONTINUE_ATTEMPTS; attempt += 1) {
    if (!(await hasPartialOpenGameFiles(jobDir))) break;

    await updateJob(job.id, 74, 'recover', `Provider interrupted. Continuing and polishing build automatically (${attempt}/${OPENGAME_CONTINUE_ATTEMPTS})...`);
    await appendLog(`\n[gametok-worker] continuation ${attempt}/${OPENGAME_CONTINUE_ATTEMPTS} after error: ${cliError.message}\n`);
    const continueLogDir = path.join(jobDir, `openai-logs-continue-${attempt}`);
    const continueArgs = buildOpenGameCliArgs({
      cliPath,
      prompt: buildContinuationPrompt(job.prompt, cliError.message),
      env,
      openAiLogDir: continueLogDir,
      coreTools,
    });
    try {
      await runOpenGameCli({ job, jobDir, env, cliArgs: continueArgs, logPath, appendLog });
      cliError = null;
    } catch (error) {
      cliError = error;
      console.warn(`[OpenGame Worker] Continuation ${attempt} failed for ${job.id}: ${error.message}`);
    }
  }

  await updateJob(job.id, 86, 'build', 'Building OpenGame artifact...');
  const projectRoot = await findProjectRoot(jobDir);
  await maybeBuildProject(projectRoot).catch(async (buildError) => {
    if (!cliError) throw buildError;
    const artifactDir = await findAnyArtifactDir(jobDir, projectRoot, logPath).catch(() => null);
    if (!artifactDir) throw buildError;
    console.warn(`[OpenGame Worker] Build command failed after artifact was produced for ${job.id}: ${buildError.message}`);
  });
  const artifactDir = await findAnyArtifactDir(jobDir, projectRoot, logPath).catch((artifactError) => {
    if (cliError) {
      artifactError.message = `${cliError.message}\n${artifactError.message}`;
    }
    throw artifactError;
  });
  const rawLog = await fs.readFile(logPath, 'utf8').catch(() => '');
  if (cliError) {
    console.warn(`[OpenGame Worker] Continuing ${job.id} with produced artifact despite CLI error.`);
  } else if (/\bAPI Error\b|Internal server error|unhashable type/i.test(rawLog)) {
    throw new Error(`OpenGame provider failed before creating files. ${rawLog.slice(-4000)}`);
  }
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
