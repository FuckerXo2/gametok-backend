import { execFile, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { callGeminiFlashJson } from './gemini-client.js';

import { uploadBufferToR2 } from './openai-image-client.js';

let cachedHermesBin = null;

/**
 * Locate official Nous Research Hermes Agent binary on the system
 */
export function getHermesBinaryPath() {
    if (cachedHermesBin && fs.existsSync(cachedHermesBin)) return cachedHermesBin;

    const candidates = [
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
        const which = execSync('which hermes 2>/dev/null', { encoding: 'utf-8' }).trim();
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

    console.log('📦 [Hermes Installer] Official Nous Research Hermes Agent CLI not found on disk. Installing now...');
    try {
        execSync('curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser --skip-computer-use', {
            stdio: 'inherit',
            timeout: 240000,
            env: { ...process.env, PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}` }
        });
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
 * Execute official Nous Research Hermes Agent in one-shot mode (-z)
 * Returns the final text response from Hermes
 *
 * @param {string} prompt
 * @param {object} options
 */
export async function executeHermesAgent(prompt, options = {}) {
    let hermesBin = getHermesBinaryPath() || ensureHermesInstalled();
    const model = options.model || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    const provider = options.provider || process.env.HERMES_PROVIDER || 'gemini';

    if (!hermesBin) {
        throw new Error('Official hermes CLI not found in PATH and automated installation failed');
    }

    const args = [
        '-z', prompt,
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

    console.log(`☤ [Hermes Agent] Executing official Nous Hermes Agent (${model}${options.toolsets ? `, toolsets: ${options.toolsets}` : ''})...`);

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
            PATH: `/opt/homebrew/bin:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        };

        execFile(hermesBin, args, { env, timeout: 180000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`⚠️ [Hermes Agent] CLI execution error: ${error.message} (${stderr?.slice(0, 300)})`);
                return reject(new Error(`Hermes Agent execution failed: ${error.message}`));
            }

            const output = (stdout || '').trim();
            resolve(output);
        });
    });
}

/**
 * Scan Hermes cache directory for images generated during this session
 */
export function getHermesGeneratedImagesSince(timestamp) {
    const cacheDir = path.join(os.homedir(), '.hermes', 'cache', 'images');
    if (!fs.existsSync(cacheDir)) return [];
    try {
        const files = fs.readdirSync(cacheDir)
            .map(file => {
                const fullPath = path.join(cacheDir, file);
                const stat = fs.statSync(fullPath);
                return { path: fullPath, mtime: stat.mtimeMs };
            })
            .filter(f => f.mtime >= timestamp)
            .sort((a, b) => a.mtime - b.mtime);
        return files.map(f => f.path);
    } catch (_) {
        return [];
    }
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
