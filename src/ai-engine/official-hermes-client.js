import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { callGeminiFlashJson } from './gemini-client.js';

import { uploadBufferToR2 } from './openai-image-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedHermesBin = null;

const sessionConversationCache = new Map();

/**
 * Retrieve continuous multi-turn conversation history for a session
 */
export function getSessionHistory(sessionId) {
    if (!sessionId) return [];
    return sessionConversationCache.get(sessionId) || [];
}

/**
 * Record a turn in the continuous session
 */
export function appendSessionTurn(sessionId, role, content) {
    if (!sessionId || !content) return;
    const history = getSessionHistory(sessionId);
    history.push({ role, content, timestamp: Date.now() });
    sessionConversationCache.set(sessionId, history);
}

/**
 * Clear a session
 */
export function clearSessionHistory(sessionId) {
    if (sessionId) sessionConversationCache.delete(sessionId);
}

/**
 * Locate official Nous Research Hermes Agent binary on the system
 */
export function getHermesBinaryPath() {
    if (cachedHermesBin && fs.existsSync(cachedHermesBin)) return cachedHermesBin;

    const projectRoot = process.cwd();
    const candidates = [
        path.join(projectRoot, '.hermes', 'hermes-agent', '.hermes', 'bin', 'hermes'),
        path.join(projectRoot, '.hermes', 'bin', 'hermes'),
        path.join(projectRoot, 'node_modules', '.bin', 'hermes'),
        path.join(__dirname, '../../.hermes', 'hermes-agent', '.hermes', 'bin', 'hermes'),
        path.join(__dirname, '../../node_modules', '.bin', 'hermes'),
        '/opt/render/.local/bin/hermes',
        '/opt/render/.hermes/hermes-agent/.hermes/bin/hermes',
        '/opt/render/.hermes/bin/hermes',
        path.join(os.homedir(), '.local', 'bin', 'hermes'),
        path.join(os.homedir(), '.hermes', 'hermes-agent', '.hermes', 'bin', 'hermes'),
        path.join(os.homedir(), '.hermes', 'hermes-agent', 'bin', 'hermes'),
        path.join(os.homedir(), '.hermes', 'bin', 'hermes'),
        '/usr/local/bin/hermes',
        '/usr/bin/hermes',
    ];

    for (const bin of candidates) {
        try {
            if (fs.existsSync(bin)) {
                cachedHermesBin = bin;
                return bin;
            }
        } catch (_) {}
    }

    try {
        const which = execSync('which hermes 2>/dev/null', { encoding: 'utf-8', env: process.env }).trim();
        if (which && fs.existsSync(which)) {
            cachedHermesBin = which;
            return which;
        }
    } catch (_) {}

    return null;
}

/**
 * Auto-install official Nous Research Hermes Agent CLI if missing
 */
export function ensureHermesInstalled() {
    let bin = getHermesBinaryPath();
    if (bin) return bin;

    const projectRoot = process.cwd();
    const hermesHome = path.join(projectRoot, '.hermes');
    const hermesDir = path.join(hermesHome, 'hermes-agent');

    console.log('📦 [Hermes Installer] Official Nous Research Hermes Agent CLI not found on disk. Installing now...');
    try {
        execSync(`export UV_PYTHON_DOWNLOADS=manual; export HERMES_HOME="${hermesHome}"; curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser --skip-computer-use --hermes-home "${hermesHome}" --dir "${hermesDir}"`, {
            stdio: 'inherit',
            timeout: 240000,
            env: {
                ...process.env,
                UV_PYTHON_DOWNLOADS: 'manual',
                HERMES_HOME: hermesHome,
                PATH: `${path.join(hermesDir, '.hermes', 'bin')}:${path.join(projectRoot, 'node_modules', '.bin')}:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
            }
        });
        try {
            const symlinkTarget = path.join(projectRoot, 'node_modules', '.bin', 'hermes');
            const builtBin = path.join(hermesDir, '.hermes', 'bin', 'hermes');
            if (fs.existsSync(builtBin)) {
                fs.mkdirSync(path.dirname(symlinkTarget), { recursive: true });
                fs.symlinkSync(builtBin, symlinkTarget);
            }
        } catch (_) {}

        bin = getHermesBinaryPath();
        if (bin) {
            console.log(`✅ [Hermes Installer] Successfully installed Hermes Agent at: ${bin}`);
            return bin;
        }
    } catch (e) {
        console.error('❌ [Hermes Installer] Automated installation failed:', e.message);
    }
    return null;
}

/**
 * Execute official Nous Research Hermes Agent with live stdout streaming and session continuity
 *
 * @param {string} prompt
 * @param {object} options
 */
async function _spawnHermesProcess(prompt, options = {}) {
    let hermesBin = getHermesBinaryPath() || ensureHermesInstalled();
    const model = options.model || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    const provider = options.provider || process.env.HERMES_PROVIDER || 'gemini';
    const sessionId = options.sessionId || null;

    if (!hermesBin) {
        throw new Error('Official hermes CLI not found in PATH and automated installation failed');
    }

    let fullPrompt = prompt;
    if (sessionId) {
        const history = getSessionHistory(sessionId);
        if (history.length > 0) {
            const historyText = history.map(turn => `[${turn.role.toUpperCase()} TURN]:\n${turn.content}`).join('\n\n');
            fullPrompt = `[CONTINUOUS AGENT SESSION HISTORY]:\n${historyText}\n\n[USER ACTION / NEXT TURN]:\n${prompt}`;
        }
    }

    const args = [
        '-z', fullPrompt,
        '--yolo',
        '--provider', provider,
        '-m', model,
    ];

    if (options.toolsets) {
        args.push('-t', options.toolsets);
    }

    if (options.skills) {
        args.push('--skills', options.skills);
    }

    console.log(`☤ [Hermes Agent] Launching live session (${model}${options.toolsets ? `, toolsets: ${options.toolsets}` : ''}${sessionId ? `, session: ${sessionId}` : ''})...`);

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            BLENDER_MCP_HOST: process.env.BLENDER_MCP_HOST || '127.0.0.1',
            BLENDER_MCP_PORT: process.env.BLENDER_MCP_PORT || '9876',
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
            PATH: `${path.dirname(hermesBin)}:/opt/homebrew/bin:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        };

        const child = spawn(hermesBin, args, { env });
        let stdout = '';
        let stderr = '';

        try {
            child.stdin.end();
        } catch (_) {}

        child.stdout.on('data', (chunk) => {
            const str = chunk.toString();
            stdout += str;
            const lines = str.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.log(`☤ [Hermes]: ${trimmed}`);
            }
        });

        child.stderr.on('data', (chunk) => {
            const str = chunk.toString();
            stderr += str;
            const lines = str.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.log(`☤ [Hermes Trace]: ${trimmed}`);
            }
        });

        child.on('close', (code) => {
            const output = stdout.trim();
            if (code !== 0 && !output) {
                console.error(`⚠️ [Hermes Agent] CLI process exited with code ${code} (${stderr.slice(0, 300)})`);
                return reject(new Error(`Hermes Agent execution failed with code ${code}: ${stderr.slice(0, 200)}`));
            }
            if (sessionId && output) {
                appendSessionTurn(sessionId, 'user', prompt);
                appendSessionTurn(sessionId, 'assistant', output);
            }
            resolve(output);
        });

        child.on('error', (err) => {
            console.error(`⚠️ [Hermes Agent] Spawn error:`, err.message);
            reject(err);
        });
    });
}

export async function executeHermesAgent(prompt, options = {}) {
    const requestedModel = options.model || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    try {
        return await _spawnHermesProcess(prompt, { ...options, model: requestedModel });
    } catch (err) {
        if (requestedModel === 'gemini-3.8-flash' && !options.model) {
            console.warn(`⚠️ [Hermes Agent] Primary model gemini-3.8-flash failed (${err.message}), retrying with gemini-3.7-flash...`);
            try {
                return await _spawnHermesProcess(prompt, { ...options, model: 'gemini-3.7-flash' });
            } catch (err37) {
                console.warn(`⚠️ [Hermes Agent] Model gemini-3.7-flash also failed (${err37.message}), retrying with gemini-3.6-flash...`);
                return await _spawnHermesProcess(prompt, { ...options, model: 'gemini-3.6-flash' });
            }
        }
        throw err;
    }
}

/**
 * Scan Hermes cache directory for images generated during this session
 */
export function getHermesGeneratedImagesSince(timestamp) {
    const candidateDirs = [
        path.join(os.homedir(), '.hermes', 'cache', 'images'),
        path.join(process.cwd(), '.hermes', 'cache', 'images'),
        process.env.HERMES_HOME ? path.join(process.env.HERMES_HOME, 'cache', 'images') : null,
        '/opt/render/project/src/.hermes/cache/images',
    ].filter(Boolean);

    const foundFiles = [];
    for (const cacheDir of candidateDirs) {
        if (!fs.existsSync(cacheDir)) continue;
        try {
            const files = fs.readdirSync(cacheDir)
                .map(file => {
                    const fullPath = path.join(cacheDir, file);
                    const stat = fs.statSync(fullPath);
                    return { path: fullPath, mtime: stat.mtimeMs };
                })
                .filter(f => f.mtime >= timestamp);
            foundFiles.push(...files);
        } catch (_) {}
    }

    foundFiles.sort((a, b) => a.mtime - b.mtime);
    return Array.from(new Set(foundFiles.map(f => f.path)));
}

/**
 * Upload a locally generated image file to Cloudflare R2
 */
export async function uploadLocalImageFileToR2(filePath, prefix = 'visual-directions') {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        const buffer = fs.readFileSync(filePath);
        return await uploadBufferToR2(buffer, prefix, 'image/png');
    } catch (err) {
        console.error(`⚠️ [Hermes Bridge] Failed to upload local image to R2:`, err.message);
        return null;
    }
}

/**
 * Clean and parse JSON from Hermes response
 */
export function extractJsonFromHermes(rawText) {
    if (!rawText) return null;
    let content = rawText.trim();

    // 1. Strip markdown code fences
    if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*/i, '');
        content = content.replace(/\s*```\s*$/i, '');
        content = content.trim();
    }

    // 2. Direct JSON.parse
    try {
        return JSON.parse(content);
    } catch (_) {}

    // 3. Strip trailing commas before closing braces/brackets (common LLM JSON quirk)
    const sanitized = content.replace(/,\s*([\]}])/g, '$1');
    try {
        return JSON.parse(sanitized);
    } catch (_) {}

    // 4. Outermost object { ... }
    const startObj = sanitized.indexOf('{');
    const endObj = sanitized.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
        try {
            return JSON.parse(sanitized.slice(startObj, endObj + 1));
        } catch (_) {}
    }

    // 5. Outermost array [ ... ]
    const startArr = sanitized.indexOf('[');
    const endArr = sanitized.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
        try {
            return JSON.parse(sanitized.slice(startArr, endArr + 1));
        } catch (_) {}
    }

    return null;
}

/**
 * Clean and extract pure JavaScript game code and embedded header directives (@title, @controls, etc.)
 * Eliminates the JSON escaping anti-pattern completely.
 */
export function extractScriptWithMetadata(rawText, defaultOrientation = 'portrait') {
    if (!rawText) return null;
    let content = rawText.trim();

    // 1. If wrapped in markdown code fence (```javascript ... ``` or ```js ... ``` or ``` ... ```), extract inner code
    const fenceMatch = content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        content = fenceMatch[1].trim();
    }

    // 2. Extract header directives
    let title = 'Untitled GameTok Game';
    let orientation = defaultOrientation;
    let controls = null;
    let thumbnailPrompt = '';

    const titleMatch = content.match(/^\/\/\s*@title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    const orientMatch = content.match(/^\/\/\s*@orientation:\s*(.+)$/m);
    if (orientMatch) orientation = orientMatch[1].trim().toLowerCase();

    const thumbMatch = content.match(/^\/\/\s*@thumbnail:\s*(.+)$/m);
    if (thumbMatch) thumbnailPrompt = thumbMatch[1].trim();

    const controlsMatch = content.match(/^\/\/\s*@controls:\s*(\{.*\})$/m);
    if (controlsMatch) {
        try {
            controls = JSON.parse(controlsMatch[1].trim());
        } catch (_) {}
    }

    // 3. Fallback: If Hermes still returned a legacy JSON object { title, gameScript }
    if (!titleMatch && content.startsWith('{') && content.endsWith('}')) {
        try {
            const parsed = JSON.parse(content);
            if (parsed.gameScript || parsed.code) {
                return {
                    title: parsed.title || title,
                    orientation: parsed.orientation || orientation,
                    controls: parsed.controls || controls,
                    thumbnailPrompt: parsed.thumbnailPrompt || thumbnailPrompt,
                    gameScript: parsed.gameScript || parsed.code
                };
            }
        } catch (_) {
            const scriptRegexMatch = content.match(/"gameScript"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"\w+"|\s*})/);
            if (scriptRegexMatch) {
                return {
                    title,
                    orientation,
                    controls,
                    thumbnailPrompt,
                    gameScript: scriptRegexMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
                };
            }
        }
    }

    // 4. Return pure JavaScript with metadata
    if (content.length > 20) {
        return {
            title,
            orientation,
            controls,
            thumbnailPrompt,
            gameScript: content
        };
    }

    return null;
}
