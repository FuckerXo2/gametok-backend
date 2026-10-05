import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { callGeminiFlashJson } from './gemini-client.js';
import { recordGeminiUsage } from './token-tracker.js';

import { uploadBufferToR2 } from './openai-image-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedAgyBin = null;

// ─── Session Management ─────────────────────────────────────────────
// agy has native --continue / --conversation <id> support.
// We keep lightweight in-memory tracking so the generation loop can
// reuse sessions for smart retries without re-sending full context.

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

// ─── Binary Discovery ────────────────────────────────────────────────

/**
 * Locate Antigravity CLI (agy) binary on the system
 */
export function getHermesBinaryPath() {
    if (cachedAgyBin && fs.existsSync(cachedAgyBin)) return cachedAgyBin;

    const candidates = [
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
        '/usr/bin/agy',
        path.join(os.homedir(), '.local', 'bin', 'agy'),
    ];

    for (const bin of candidates) {
        if (fs.existsSync(bin)) {
            cachedAgyBin = bin;
            return bin;
        }
    }

    // Fallback: which
    try {
        const which = execSync('which agy 2>/dev/null', { encoding: 'utf-8', env: process.env }).trim();
        if (which && fs.existsSync(which)) {
            cachedAgyBin = which;
            return which;
        }
    } catch (_) {}

    return null;
}

/**
 * Auto-install Antigravity CLI if missing
 */
export function ensureHermesInstalled() {
    let bin = getHermesBinaryPath();
    if (bin) return bin;

    console.log('📦 [AGY Installer] Antigravity CLI not found. Installing now...');
    try {
        execSync('curl -fsSL https://antigravity.google/cli/install.sh | bash', {
            stdio: 'inherit',
            timeout: 120000,
            env: process.env,
        });

        bin = getHermesBinaryPath();
        if (bin) {
            console.log(`✅ [AGY Installer] Successfully installed Antigravity CLI at: ${bin}`);
            return bin;
        }
    } catch (e) {
        console.error('❌ [AGY Installer] Automated installation failed:', e.message);
    }
    return null;
}

/**
 * Resolve AGY config directory
 */
export function getHermesHomePath() {
    const candidates = [
        process.env.GEMINI_HOME,
        path.join(os.homedir(), '.gemini'),
    ].filter(Boolean);

    for (const dir of candidates) {
        if (fs.existsSync(dir)) return dir;
    }
    return path.join(os.homedir(), '.gemini');
}

/**
 * Ensure agy configuration is set up for headless API key auth.
 * agy requires modelProvider: 'gemini' in settings.json to use GEMINI_API_KEY
 * without attempting browser OAuth.
 */
export function ensureHermesConfig() {
    const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const settingsFile = path.join(settingsDir, 'settings.json');
    try {
        if (!fs.existsSync(settingsFile)) {
            fs.mkdirSync(settingsDir, { recursive: true });
            fs.writeFileSync(settingsFile, JSON.stringify({ modelProvider: 'gemini' }));
            console.log(`⚙️ [AGY Config] Created headless settings at ${settingsFile}`);
        }
    } catch (_) {}
}

// ─── Core Agent Execution ────────────────────────────────────────────

/**
 * Spawn agy in non-interactive print mode and capture output.
 *
 * @param {string} prompt - The prompt to send
 * @param {object} [options]
 * @param {string} [options.model] - Gemini model name
 * @param {string} [options.sessionId] - Session ID for multi-turn
 * @param {string} [options.reasoning] - Reasoning effort (unused by agy, kept for API compat)
 * @param {string} [options.toolsets] - Hermes toolsets (unused by agy — agy has all tools built in)
 * @param {string} [options.conversationId] - agy conversation ID for --continue
 */
async function _spawnAgentProcess(prompt, options = {}) {
    ensureHermesConfig();
    let agyBin = getHermesBinaryPath() || ensureHermesInstalled();
    const model = options.model || process.env.AGY_MODEL || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    const sessionId = options.sessionId || null;

    if (!agyBin) {
        throw new Error('Antigravity CLI (agy) not found in PATH and automated installation failed');
    }

    // Build conversation context for multi-turn
    let fullPrompt = prompt;
    if (sessionId) {
        const history = getSessionHistory(sessionId);
        if (history.length > 0) {
            const historyText = history.map(turn => `[${turn.role.toUpperCase()} TURN]:\n${turn.content}`).join('\n\n');
            fullPrompt = `[CONTINUOUS AGENT SESSION HISTORY]:\n${historyText}\n\n[USER ACTION / NEXT TURN]:\n${prompt}`;
        }
    }

    const reasoningEffort = options.reasoning || 'low';
    const args = [
        '-p', fullPrompt,
        '--model', model,
        '--effort', reasoningEffort,
        '--dangerously-skip-permissions',
    ];

    console.log(`🚀 [AGY Agent] Launching (${model}, effort: ${reasoningEffort}${sessionId ? `, session: ${sessionId}` : ''})...`);

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
            AGY_MODEL: model,
            PATH: `${path.dirname(agyBin)}:/opt/homebrew/bin:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        };

        const child = spawn(agyBin, args, { env });
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
                if (trimmed) console.log(`🚀 [AGY]: ${trimmed}`);
            }
        });

        child.stderr.on('data', (chunk) => {
            const str = chunk.toString();
            stderr += str;
            const lines = str.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.log(`🚀 [AGY Trace]: ${trimmed}`);
            }
        });

        child.on('close', (code) => {
            const output = stdout.trim();
            if (code !== 0 && !output) {
                console.error(`⚠️ [AGY Agent] Process exited with code ${code} (${stderr.slice(0, 300)})`);
                return reject(new Error(`AGY Agent execution failed with code ${code}: ${stderr.slice(0, 200)}`));
            }

            // Check if output is a known failure / abort warning
            const isAbortedOrError = /Response Stopped|No visible answer was produced|Repetition Detected|Output Limit Reached|output-token limit|agent failed:/i.test(output);

            if (isAbortedOrError) {
                const preview = output.slice(0, 300).replace(/\n/g, ' ');
                console.error(`⚠️ [AGY Agent] Response aborted or failed (${preview})`);
                if (sessionId) {
                    clearSessionHistory(sessionId);
                }
                return reject(new Error(`AGY generation aborted: ${preview}`));
            }

            if (sessionId && output) {
                appendSessionTurn(sessionId, 'user', prompt);
                appendSessionTurn(sessionId, 'assistant', output);

                // Estimate token usage from text lengths
                const promptTokens = Math.round(fullPrompt.length / 3.8);
                const completionTokens = Math.round(output.length / 3.8);
                recordGeminiUsage(sessionId, { promptTokens, completionTokens, model });
            }
            resolve(output);
        });

        child.on('error', (err) => {
            console.error(`⚠️ [AGY Agent] Spawn error:`, err.message);
            reject(err);
        });
    });
}

export async function executeHermesAgent(prompt, options = {}) {
    const requestedModel = options.model || process.env.AGY_MODEL || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    try {
        return await _spawnAgentProcess(prompt, { ...options, model: requestedModel });
    } catch (err) {
        if (requestedModel === 'gemini-3.8-flash' && !options.model) {
            console.warn(`⚠️ [AGY Agent] Primary model gemini-3.8-flash failed (${err.message}), retrying with gemini-3.7-flash...`);
            try {
                return await _spawnAgentProcess(prompt, { ...options, model: 'gemini-3.7-flash' });
            } catch (err37) {
                console.warn(`⚠️ [AGY Agent] Model gemini-3.7-flash also failed (${err37.message}), retrying with gemini-3.6-flash...`);
                return await _spawnAgentProcess(prompt, { ...options, model: 'gemini-3.6-flash' });
            }
        }
        throw err;
    }
}

// ─── Image Utilities (generic, not CLI-specific) ─────────────────────

/**
 * Scan cache directory for images generated during a session
 */
export function getHermesGeneratedImagesSince(timestamp) {
    const homeDir = getHermesHomePath();
    const candidateDirs = [
        path.join(homeDir, 'cache', 'images'),
        path.join(homeDir, 'antigravity', 'cache', 'images'),
        path.join(os.homedir(), '.gemini', 'cache', 'images'),
        path.join(process.cwd(), '.gemini', 'cache', 'images'),
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
        console.error(`⚠️ [AGY Bridge] Failed to upload local image to R2:`, err.message);
        return null;
    }
}

// ─── Output Parsers (generic, work with any CLI) ─────────────────────

/**
 * Clean and parse JSON from agent response
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
 */
export function extractScriptWithMetadata(rawText, defaultOrientation = 'portrait') {
    if (!rawText) return null;
    let content = rawText.trim();

    // 1. If wrapped in markdown code fence (```html ... ``` or ```javascript ... ``` or ```js ... ``` or ``` ... ```), extract inner code
    const fenceMatch = content.match(/```(?:html|javascript|js)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        content = fenceMatch[1].trim();
    }

    // 2. Extract header directives (supports // @key, <!-- @key, and <title> tags)
    let title = 'Untitled GameTok Game';
    let orientation = defaultOrientation;
    let controls = null;
    let thumbnailPrompt = '';

    const titleMatch = content.match(/(?:\/\/|<!--)\s*@title:\s*([^>\n\r]+?)(?:\s*-->)?$/m);
    if (titleMatch) {
        title = titleMatch[1].trim();
    } else {
        const htmlTitleMatch = content.match(/<title>([^<]+)<\/title>/i);
        if (htmlTitleMatch) title = htmlTitleMatch[1].trim();
    }

    const orientMatch = content.match(/(?:\/\/|<!--)\s*@orientation:\s*([a-zA-Z]+)(?:\s*-->)?$/m);
    if (orientMatch) orientation = orientMatch[1].trim().toLowerCase();

    const thumbMatch = content.match(/(?:\/\/|<!--)\s*@thumbnail:\s*([^>\n\r]+?)(?:\s*-->)?$/m);
    if (thumbMatch) thumbnailPrompt = thumbMatch[1].trim();

    const controlsMatch = content.match(/(?:\/\/|<!--)\s*@controls:\s*(\{.+?\})(?:\s*-->)?$/m);
    if (controlsMatch) {
        try {
            controls = JSON.parse(controlsMatch[1].trim());
        } catch (_) {}
    }

    // 3. Fallback: If agent returned a legacy JSON object { title, gameScript }
    if (!titleMatch && content.startsWith('{') && content.endsWith('}')) {
        try {
            const parsed = JSON.parse(content);
            if (parsed.gameScript || parsed.code || parsed.html) {
                return {
                    title: parsed.title || title,
                    orientation: parsed.orientation || orientation,
                    controls: parsed.controls || controls,
                    thumbnailPrompt: parsed.thumbnailPrompt || thumbnailPrompt,
                    gameScript: parsed.gameScript || parsed.code || parsed.html
                };
            }
        } catch (_) {
            const scriptRegexMatch = content.match(/"(?:gameScript|code|html)"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"\w+"|\s*})/);
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

    // 4. Return game code with metadata
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
