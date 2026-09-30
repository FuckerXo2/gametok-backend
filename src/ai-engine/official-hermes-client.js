import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { callGeminiFlashJson } from './gemini-client.js';

let cachedHermesBin = null;

/**
 * Locate official Nous Research Hermes Agent binary on the system
 */
export function getHermesBinaryPath() {
    if (cachedHermesBin) return cachedHermesBin;

    const candidates = [
        path.join(os.homedir(), '.local', 'bin', 'hermes'),
        path.join(os.homedir(), '.hermes', 'hermes-agent', 'bin', 'hermes'),
        path.join(os.homedir(), '.hermes', 'bin', 'hermes'),
        '/usr/local/bin/hermes',
        'hermes',
    ];

    for (const bin of candidates) {
        try {
            if (bin === 'hermes' || fs.existsSync(bin)) {
                cachedHermesBin = bin;
                return bin;
            }
        } catch (_) {}
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
    const hermesBin = getHermesBinaryPath();
    const model = options.model || process.env.HERMES_MODEL || 'gemini-3.8-flash';
    const provider = options.provider || process.env.HERMES_PROVIDER || 'gemini';

    if (!hermesBin) {
        console.warn('⚠️ [Hermes Bridge] Official hermes CLI not found in PATH, using direct AI engine execution.');
        return null;
    }

    const args = [
        '-z', prompt,
        '--yolo',
        '--provider', provider,
        '-m', model,
    ];

    if (options.skills) {
        args.push('--skills', options.skills);
    }

    console.log(`☤ [Hermes Agent] Executing official Nous Hermes Agent (${model})...`);

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
            PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        };

        execFile(hermesBin, args, { env, timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.warn(`⚠️ [Hermes Agent] CLI execution error: ${error.message} (${stderr?.slice(0, 200)})`);
                return resolve(null); // Fallback to direct client
            }

            const output = (stdout || '').trim();
            resolve(output);
        });
    });
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

    // 3. Outermost object { ... }
    const startObj = content.indexOf('{');
    const endObj = content.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
        try {
            return JSON.parse(content.slice(startObj, endObj + 1));
        } catch (_) {}
    }

    // 4. Outermost array [ ... ]
    const startArr = content.indexOf('[');
    const endArr = content.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
        try {
            return JSON.parse(content.slice(startArr, endArr + 1));
        } catch (_) {}
    }

    return null;
}
