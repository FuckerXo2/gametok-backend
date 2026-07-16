import { spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { maskNvidiaKey, nextNvidiaImageApiKey, nextNvidiaTextApiKey } from './nvidia-key-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VENDORED_OPENGAME_ROOT = path.join(REPO_ROOT, 'vendor', 'opengame');
const DEFAULT_OPENGAME_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_OPENGAME_MODELS = [
    'qwen/qwen3-coder-480b-a35b-instruct',
    'z-ai/glm-5.1',
    'moonshotai/kimi-k2.7',
    'deepseek-ai/deepseek-v4-pro',
];

export function shouldUseRealOpenGameRuntime(env = process.env) {
    return true;
}

export function resolveRealOpenGameRoot(env = process.env) {
    const configured = String(env.OPENGAME_ROOT || '').trim();
    if (configured) return configured;
    return VENDORED_OPENGAME_ROOT;
}

function resolveOpenGameCli(root) {
    return path.join(root, 'dist', 'cli.js');
}

async function pathExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function copyTemplateProject(openGameRoot, projectRoot) {
    const templateRoot = path.join(openGameRoot, 'agent-test', 'templates', 'core');
    if (!(await pathExists(templateRoot))) return false;
    await fs.promises.cp(templateRoot, projectRoot, {
        recursive: true,
        force: true,
        errorOnExist: false,
    });
    return true;
}

async function linkBackendNodeModules(projectRoot) {
    const source = path.join(REPO_ROOT, 'node_modules');
    const target = path.join(projectRoot, 'node_modules');
    if (!(await pathExists(source)) || await pathExists(target)) return false;
    try {
        await fs.promises.symlink(source, target, 'dir');
        return true;
    } catch {
        return false;
    }
}

function buildOpenGamePrompt(prompt) {
    return [
        'Build the complete playable mobile HTML5 game now in this existing OpenGame Vite/Phaser project.',
        'Do not answer with a plan or explanation. Use your available OpenGame tools and file editing tools immediately.',
        'Edit the project files, generate any needed assets through OpenGame tools, run the build, and stop only when dist/index.html exists.',
        'The result must be self-contained, portrait-mobile friendly, visible on first frame, and playable immediately.',
        '',
        'Game request:',
        prompt,
    ].join('\n');
}

function createOpenGameEnv({ apiKey, model, baseUrl, env = process.env }) {
    const imageKey = env.OPENGAME_IMAGE_API_KEY || env.NVIDIA_IMAGE_API_KEY || nextNvidiaImageApiKey(env) || env.NVIDIA_API_KEY || '';
    const openGameEnv = {
        ...env,
        CI: '1',
        NO_COLOR: '1',
        OPENGAME_DISABLE_TELEMETRY: '1',
        OPENAI_API_KEY: env.OPENGAME_OPENAI_API_KEY || env.OPENAI_API_KEY || apiKey,
        OPENAI_BASE_URL: env.OPENGAME_OPENAI_BASE_URL || env.OPENAI_BASE_URL || baseUrl,
        OPENAI_MODEL: env.OPENGAME_OPENAI_MODEL || env.OPENAI_MODEL || model,
        OPENGAME_REASONING_PROVIDER: env.OPENGAME_REASONING_PROVIDER || 'openai-compat',
        OPENGAME_REASONING_API_KEY: env.OPENGAME_REASONING_API_KEY || env.OPENGAME_OPENAI_API_KEY || apiKey,
        OPENGAME_REASONING_BASE_URL: env.OPENGAME_REASONING_BASE_URL || env.OPENGAME_OPENAI_BASE_URL || baseUrl,
        OPENGAME_REASONING_MODEL: env.OPENGAME_REASONING_MODEL || env.OPENGAME_OPENAI_MODEL || model,
    };

    if (imageKey && env.OPENGAME_ENABLE_IMAGE_PROVIDER !== 'false') {
        openGameEnv.OPENGAME_IMAGE_PROVIDER = env.OPENGAME_IMAGE_PROVIDER || 'openai-compat';
        openGameEnv.OPENGAME_IMAGE_API_KEY = imageKey;
        openGameEnv.OPENGAME_IMAGE_BASE_URL = env.OPENGAME_IMAGE_BASE_URL || env.OPENGAME_OPENAI_BASE_URL || baseUrl;
        openGameEnv.OPENGAME_IMAGE_MODEL = env.OPENGAME_IMAGE_MODEL || 'black-forest-labs/flux.1-schnell';
    }

    return openGameEnv;
}

function getOpenGameModelCandidates(env = process.env) {
    const explicitList = env.OPENGAME_OPENAI_MODELS || env.OPENGAME_MODEL_FALLBACKS;
    const configuredList = explicitList
        ? String(explicitList).split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    const singleConfigured = [
        env.OPENGAME_OPENAI_MODEL,
        env.OPENAI_MODEL,
    ]
        .filter(Boolean)
        .map((value) => value.trim())
        .filter(Boolean);

    if (configuredList.length > 0) {
        return [...new Set([...configuredList, ...singleConfigured, ...DEFAULT_OPENGAME_MODELS])];
    }
    return [...new Set([...DEFAULT_OPENGAME_MODELS, ...singleConfigured])];
}

function extractOpenGameStreamFailure(stdout = '', stderr = '') {
    const raw = `${stdout}\n${stderr}`;
    const directApiError = raw.match(/\[API Error:[^\n]+/i);
    if (directApiError) return directApiError[0];

    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
            const event = JSON.parse(trimmed);
            const resultText = typeof event.result === 'string' ? event.result : '';
            const messageText = Array.isArray(event.message?.content)
                ? event.message.content
                    .map((part) => typeof part?.text === 'string' ? part.text : '')
                    .filter(Boolean)
                    .join('\n')
                : '';
            const combined = `${resultText}\n${messageText}`;
            const apiError = combined.match(/\[API Error:[^\n]+/i);
            if (apiError) return apiError[0];
            if (event.type === 'result' && event.is_error) {
                return resultText || 'OpenGame returned an error result.';
            }
        } catch {
            // Ignore non-JSON progress lines.
        }
    }

    return null;
}

async function snapshotProjectSources(projectRoot) {
    const skipDirs = new Set(['node_modules', 'dist', '.git', '.qwen', '.opengame']);
    const files = [];

    async function walk(dir) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (skipDirs.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            const relPath = path.relative(projectRoot, fullPath);
            const content = await fs.promises.readFile(fullPath);
            files.push(`${relPath}:${createHash('sha256').update(content).digest('hex')}`);
        }
    }

    await walk(projectRoot);
    return files.sort().join('\n');
}

function spawnWithLogs(command, args, { cwd, env, timeoutMs, logPrefix }) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
        }, timeoutMs);
        timer.unref?.();

        const onData = (chunk, isErr) => {
            const text = chunk.toString();
            if (isErr) stderr += text;
            else stdout += text;
            for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                const stream = isErr ? console.warn : console.log;
                stream(`${logPrefix} ${line.slice(0, 1000)}`);
            }
        };

        child.stdout.on('data', (chunk) => onData(chunk, false));
        child.stderr.on('data', (chunk) => onData(chunk, true));
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr, code, signal });
                return;
            }
            const reason = killedByTimeout
                ? `${command} timed out after ${Math.round(timeoutMs / 1000)}s`
                : `${command} exited with code ${code}${signal ? ` signal ${signal}` : ''}`;
            const error = new Error(reason);
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
        });
    });
}

async function ensureDistHtml(projectRoot, env, timeoutMs) {
    const distIndex = path.join(projectRoot, 'dist', 'index.html');
    if (await pathExists(distIndex)) return distIndex;
    const packageJson = path.join(projectRoot, 'package.json');
    if (!(await pathExists(packageJson))) return null;
    await spawnWithLogs('npm', ['run', 'build'], {
        cwd: projectRoot,
        env,
        timeoutMs,
        logPrefix: '[Real OpenGame Build]',
    });
    return (await pathExists(distIndex)) ? distIndex : null;
}

export async function runRealOpenGameBuild({
    jobId,
    prompt,
    workspace,
    env = process.env,
    shouldCancel = async () => {},
}) {
    const openGameRoot = resolveRealOpenGameRoot(env);
    const cliPath = resolveOpenGameCli(openGameRoot);
    if (!(await pathExists(cliPath))) {
        throw new Error(`Real OpenGame runtime not found at ${cliPath}. Set OPENGAME_ROOT or include vendor/opengame.`);
    }

    const apiKey = env.OPENGAME_OPENAI_API_KEY || env.OPENAI_API_KEY || nextNvidiaTextApiKey(env);
    const baseUrl = env.OPENGAME_OPENAI_BASE_URL || env.OPENAI_BASE_URL || DEFAULT_OPENGAME_BASE_URL;
    const modelCandidates = getOpenGameModelCandidates(env);
    if (!apiKey) {
        throw new Error('No OpenGame-compatible text key configured. Set OPENGAME_OPENAI_API_KEY, OPENAI_API_KEY, or NVIDIA text keys.');
    }
    const timeoutMs = Math.max(120000, Number(env.OPENGAME_RUN_TIMEOUT_MS || 1200000));
    const buildTimeoutMs = Math.max(60000, Number(env.OPENGAME_BUILD_TIMEOUT_MS || 240000));
    const errors = [];

    for (const model of modelCandidates) {
        const projectRoot = path.join(workspace, 'real-opengame-project');
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
        await fs.promises.mkdir(projectRoot, { recursive: true });
        const seededTemplate = await copyTemplateProject(openGameRoot, projectRoot);
        const linkedNodeModules = await linkBackendNodeModules(projectRoot);
        const beforeSnapshot = await snapshotProjectSources(projectRoot);
        const openGameEnv = createOpenGameEnv({ apiKey, model, baseUrl, env });

        await fs.promises.writeFile(
            path.join(workspace, 'real-opengame-run.json'),
            JSON.stringify({
                jobId,
                openGameRoot,
                cliPath,
                projectRoot,
                seededTemplate,
                linkedNodeModules,
                model,
                modelCandidates,
                baseUrl,
                key: maskNvidiaKey(apiKey),
                startedAt: new Date().toISOString(),
            }, null, 2),
            'utf8'
        );

        try {
            console.log(`[Real OpenGame] Starting ${jobId} with ${model} via ${baseUrl} key=${maskNvidiaKey(apiKey)}`);
            await shouldCancel();
            const run = await spawnWithLogs(process.execPath, [
                cliPath,
                '--auth-type',
                'openai',
                '--model',
                model,
                '--approval-mode',
                'yolo',
                '--channel',
                'CI',
                '--max-session-turns',
                String(Number(env.OPENGAME_MAX_SESSION_TURNS || 40)),
                buildOpenGamePrompt(prompt),
            ], {
                cwd: projectRoot,
                env: openGameEnv,
                timeoutMs,
                logPrefix: '[Real OpenGame]',
            });
            await shouldCancel();

            const streamFailure = extractOpenGameStreamFailure(run.stdout, run.stderr);
            if (streamFailure) {
                throw new Error(streamFailure);
            }

            const afterSnapshot = await snapshotProjectSources(projectRoot);
            if (afterSnapshot === beforeSnapshot) {
                throw new Error('OpenGame completed without changing the starter project; refusing to save the seed template.');
            }

            const htmlPath = await ensureDistHtml(projectRoot, openGameEnv, buildTimeoutMs);
            if (!htmlPath) {
                throw new Error('Real OpenGame finished without dist/index.html.');
            }
            const html = await fs.promises.readFile(htmlPath, 'utf8');
            return {
                html,
                rawHtml: html,
                projectRoot,
                distIndex: htmlPath,
                buildMode: 'real-opengame-cli',
                openGameRoot,
                model,
            };
        } catch (error) {
            errors.push(`${model}: ${error?.message || error}`);
            console.warn(`[Real OpenGame] ${model} failed: ${error?.message || error}`);
        }
    }

    throw new Error(`Real OpenGame failed on all configured models. ${errors.join(' | ')}`);
}
