import express from 'express';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { buildLabsSoloPrototype, buildPhase1_Quantize, buildPhase1B_Scaffold, buildPhase2_BuildPrototype, buildPhase2_EditGame, buildPhase2B_Engineer, buildPhase2C_Critic, buildPhase2D_ArtistRevision, buildPhase2E_EngineerRevision, buildPhase2F_Integrator, buildPhase3_Repair, buildSharedScaffoldShell, postProcessRawHtml, buildPhase2A_Artist, compileMultiAgentGame } from './promptRegistry.js';
import { normalizeDreamSpec } from './spec-normalizer.js';
import { verifyGame } from './sandbox.js';
import { setAssetBaseUrl } from './asset-dictionary.js';

function extractJson(text) {
    let jsonStart = text.indexOf('{');
    if (text.includes('</thinking>')) {
        const postThinkingStart = text.indexOf('{', text.indexOf('</thinking>'));
        if (postThinkingStart !== -1) {
            jsonStart = postThinkingStart;
        }
    }
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd >= jsonStart) {
        return text.substring(jsonStart, jsonEnd + 1);
    }
    return text;
}

const router = express.Router();

const DREAM_MODELS = {
    spec: "meta/llama-3.3-70b-instruct",
    premiumBuilder: process.env.DREAMSTREAM_MAIN_MODEL || "claude-opus-4-6",
    artist: "qwen/qwen3.5-397b-a17b",
    engineer: "qwen/qwen3-coder-480b-a35b-instruct",
    labsArtist: "qwen/qwen3-coder-480b-a35b-instruct",
    labsEngineer: "qwen/qwen3.6-plus:free",
};

const OPUS_MAX_TOKENS = Number(process.env.DREAMSTREAM_OPUS_MAX_TOKENS || 32000);
const OPUS_MAX_CONTINUATIONS = Number(process.env.DREAMSTREAM_OPUS_MAX_CONTINUATIONS || 2);

const JOB_TITLES = {
    dreamPending: 'Pending Dream...',
    remixPending: 'Pending Remix...',
    labsPending: '🧪 Labs: Cooking...',
};

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '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',
});

const claudeClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// OpenRouter is only used by the experimental Labs route.
const openRouterClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://gametok.app',
        'X-Title': 'DreamStream Game Engine',
    },
});

const pendingJobBoots = new Map();

function rememberPendingBoot(jobId, update) {
    pendingJobBoots.set(jobId, {
        createdAt: Date.now(),
        ...pendingJobBoots.get(jobId),
        ...update,
    });
}

function forgetPendingBoot(jobId) {
    pendingJobBoots.delete(jobId);
}

setInterval(() => {
    const cutoff = Date.now() - (15 * 60 * 1000);
    for (const [jobId, state] of pendingJobBoots.entries()) {
        if ((state?.createdAt || 0) < cutoff) {
            pendingJobBoots.delete(jobId);
        }
    }
}, 60 * 1000).unref?.();

async function callAI(systemPrompt, userPrompt, maxTokens = 2000, temperature = 0.3) {
    const res = await nvidiaClient.chat.completions.create({
        model: DREAM_MODELS.spec,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature
    });
    if (!res || !res.choices || !res.choices[0]) {
        throw new Error("API Provider Error (Phase 1): " + (res?.error?.message || JSON.stringify(res)));
    }
    const raw = res.choices[0].message.content;
    return JSON.parse(extractJson(raw));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableProviderError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return Boolean(
        error?.status >= 500 ||
        message.includes('timed out') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('connection error') ||
        message.includes('overloaded') ||
        message.includes('rate limit')
    );
}

async function withNvidiaRetries(task, { label, maxAttempts = 3, baseDelayMs = 1500 }) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`🔁 [${label}] Retry ${attempt}/${maxAttempts}...`);
            }
            return await task();
        } catch (error) {
            lastError = error;
            if (!isRetryableProviderError(error) || attempt === maxAttempts) {
                throw error;
            }
            const waitMs = baseDelayMs * attempt;
            console.warn(`⚠️ [${label}] Provider hiccup: ${error?.message || error}. Retrying in ${waitMs}ms...`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

async function withClaudeRetries(task, { label, maxAttempts = 2, baseDelayMs = 1500 }) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`🔁 [${label}] Retry ${attempt}/${maxAttempts}...`);
            }
            return await task();
        } catch (error) {
            lastError = error;
            if (!isRetryableProviderError(error) || attempt === maxAttempts) {
                throw error;
            }
            const waitMs = baseDelayMs * attempt;
            console.warn(`⚠️ [${label}] Provider hiccup: ${error?.message || error}. Retrying in ${waitMs}ms...`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

function extractAnthropicText(response) {
    if (!Array.isArray(response?.content)) {
        return '';
    }
    return response.content
        .filter((block) => block?.type === 'text')
        .map((block) => block.text || '')
        .join('')
        .trim();
}

function hasClosedHtmlDocument(html) {
    return html.toLowerCase().includes('</html>');
}

function cleanClaudeContinuation(text) {
    let output = stripMarkdownFences(text, 'html');
    output = output.replace(/^\s*<!doctype html[^>]*>\s*/i, '');
    output = output.replace(/^\s*<html[^>]*>\s*/i, '');
    return output.trimStart();
}

function buildClaudeContinuationPrompt(partialHtml) {
    const suffix = partialHtml.slice(-4000);
    return [
        'You were generating a single complete HTML game document and your previous response was cut off.',
        'Continue from EXACTLY where the HTML stopped.',
        'Output ONLY the missing continuation text.',
        'Do NOT restart the document.',
        'Do NOT repeat earlier code.',
        'Do NOT explain anything.',
        '',
        'The current partial HTML ends with this exact suffix:',
        '```html',
        suffix,
        '```',
        '',
        'Continue with only the remaining characters needed to finish the same HTML document.'
    ].join('\n');
}

async function requestClaudeMessage(userPrompt, { label }) {
    const response = await withClaudeRetries(
        () => claudeClient.messages.create({
            model: DREAM_MODELS.premiumBuilder,
            max_tokens: OPUS_MAX_TOKENS,
            thinking: { type: 'adaptive' },
            messages: [{ role: 'user', content: userPrompt }],
        }),
        { label, maxAttempts: 2, baseDelayMs: 2000 }
    );

    return {
        text: extractAnthropicText(response),
        stopReason: response?.stop_reason || null,
    };
}

async function generateCompleteHtmlWithClaude(initialPrompt, { label }) {
    let { text, stopReason } = await requestClaudeMessage(initialPrompt, { label });
    let html = normalizeHtmlDocument(text);
    console.log(`🧾 [${label}] stop_reason=${stopReason || 'unknown'} chars=${html.length}`);

    let continuationCount = 0;
    while (!hasClosedHtmlDocument(html) && continuationCount < OPUS_MAX_CONTINUATIONS) {
        continuationCount += 1;
        console.warn(`⚠️ [${label}] Output truncated or incomplete. Requesting continuation ${continuationCount}/${OPUS_MAX_CONTINUATIONS}...`);
        const continuationPrompt = buildClaudeContinuationPrompt(html);
        const continuation = await requestClaudeMessage(continuationPrompt, { label: `${label} Continue` });
        const continuationText = cleanClaudeContinuation(continuation.text);
        console.log(`🧾 [${label} Continue] stop_reason=${continuation.stopReason || 'unknown'} chars=${continuationText.length}`);
        if (!continuationText) {
            break;
        }
        html += continuationText;
    }

    return html;
}

function extractInlineScripts(html) {
    const scripts = [];
    const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        if (/src\s*=/.test(match[1] || '')) {
            continue;
        }
        scripts.push(match[2] || '');
    }
    return scripts;
}

function validateJavaScriptSyntax(source, label) {
    try {
        new vm.Script(source, { filename: label });
    } catch (error) {
        throw new Error(`${label} syntax error: ${error.message}`);
    }
}

function validateGeneratedBuild(artistCode, engineHtml, compiledHtml) {
    if (engineHtml.includes('TODO_ENGINE')) {
        throw new Error('engine-html validation error: scaffold TODO markers were left in the final output');
    }
    validateJavaScriptSyntax(artistCode, 'artist-code.js');
    const engineScripts = extractInlineScripts(engineHtml);
    engineScripts.forEach((script, index) => validateJavaScriptSyntax(script, `engine-inline-${index + 1}.js`));
    const compiledScripts = extractInlineScripts(compiledHtml);
    compiledScripts.forEach((script, index) => validateJavaScriptSyntax(script, `compiled-inline-${index + 1}.js`));
}

function parseRepairSections(aiOutput, fallbackArtistCode, fallbackEngineHtml) {
    const artistMarker = '===ARTIST_CODE===';
    const engineMarker = '===ENGINE_CODE===';
    if (!aiOutput.includes(artistMarker) || !aiOutput.includes(engineMarker)) {
        return {
            artistCode: fallbackArtistCode,
            engineHtml: normalizeHtmlDocument(aiOutput || fallbackEngineHtml)
        };
    }

    const artistCode = stripMarkdownFences(aiOutput.split(artistMarker)[1]?.split(engineMarker)[0]?.trim() || fallbackArtistCode);
    const engineHtml = normalizeHtmlDocument(aiOutput.split(engineMarker)[1]?.trim() || fallbackEngineHtml);
    return { artistCode, engineHtml };
}

async function runScaffoldedCollaboration({ specSheet, scaffold, scaffoldShell }) {
    const artistPrompt = buildPhase2A_Artist(specSheet, scaffold);

    console.log(`🎨 Phase 2A: Qwen 3.5 on NIM sketching the RenderEngine...`);
    const rawArtistCode = await streamNvidiaText({
        model: DREAM_MODELS.artist,
        systemPrompt: "You are an elite procedural HTML5 Canvas Artist.",
        userPrompt: artistPrompt,
        maxTokens: 4000,
        temperature: 0.5,
        retryLabel: 'Phase 2A Artist'
    });
    let currentArtistCode = stripMarkdownFences(rawArtistCode);

    const enginePrompt = buildPhase2B_Engineer(specSheet, currentArtistCode, scaffold, scaffoldShell);

    console.log(`⚙️ Phase 2B: Qwen 3 Coder on NIM writing gameplay HTML...`);
    let rawEngineHtml = await streamNvidiaText({
        model: DREAM_MODELS.engineer,
        systemPrompt: "You are an elite HTML5 Game Engineer.",
        userPrompt: enginePrompt,
        maxTokens: 8000,
        temperature: 0.2,
        retryLabel: 'Phase 2B Engineer'
    });
    rawEngineHtml = normalizeHtmlDocument(rawEngineHtml);

    console.log(`🧪 Phase 2C: Collaboration critic reviewing drafts...`);
    const criticPrompt = buildPhase2C_Critic(specSheet, scaffold, scaffoldShell, currentArtistCode, rawEngineHtml);
    const criticNotes = await callAI(criticPrompt.system, criticPrompt.user, 1200, 0.2);

    if (criticNotes?.shouldRevise) {
        console.log(`🔁 Phase 2D: Applying critic feedback to artist draft...`);
        const artistRevisionPrompt = buildPhase2D_ArtistRevision(specSheet, scaffold, currentArtistCode, criticNotes);
        currentArtistCode = stripMarkdownFences(await streamNvidiaText({
            model: DREAM_MODELS.artist,
            systemPrompt: "You are an elite procedural HTML5 Canvas Artist revising your work after teammate feedback.",
            userPrompt: artistRevisionPrompt,
            maxTokens: 4500,
            temperature: 0.35,
            retryLabel: 'Phase 2D Artist Revision'
        }));

        console.log(`🔁 Phase 2E: Applying critic feedback to engineer draft...`);
        const engineerRevisionPrompt = buildPhase2E_EngineerRevision(specSheet, scaffold, scaffoldShell, currentArtistCode, rawEngineHtml, criticNotes);
        rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
            model: DREAM_MODELS.engineer,
            systemPrompt: "You are an elite HTML5 Game Engineer revising your build after teammate feedback.",
            userPrompt: engineerRevisionPrompt,
            maxTokens: 9000,
            temperature: 0.15,
            retryLabel: 'Phase 2E Engineer Revision'
        }));
    }

    console.log(`🧠 Phase 2F: Intelligent integrator reconciling artist + engineer...`);
    const integratorPrompt = buildPhase2F_Integrator(specSheet, scaffold, scaffoldShell, currentArtistCode, rawEngineHtml, criticNotes);
    const integratedOutput = await streamNvidiaText({
        model: DREAM_MODELS.engineer,
        systemPrompt: "You are an elite integration architect producing a coherent final artist+engine pair.",
        userPrompt: integratorPrompt,
        maxTokens: 12000,
        temperature: 0.12,
        retryLabel: 'Phase 2F Integrator'
    });
    const integratedSections = parseRepairSections(integratedOutput, currentArtistCode, rawEngineHtml);
    currentArtistCode = stripMarkdownFences(integratedSections.artistCode);
    rawEngineHtml = normalizeHtmlDocument(integratedSections.engineHtml);

    console.log(`✅ Multi-Agent Generated: Artist (${currentArtistCode.length} chars) | Engine (${rawEngineHtml.length} chars)`);
    return {
        artistCode: currentArtistCode,
        engineHtml: rawEngineHtml,
        criticNotes,
    };
}

async function streamNvidiaText({ model, systemPrompt, userPrompt, maxTokens, temperature, retryLabel }) {
    return withNvidiaRetries(async () => {
        const stream = await nvidiaClient.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: maxTokens,
            temperature,
            stream: true
        });

        let output = "";
        for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
                output += chunk.choices[0].delta.content;
            }
        }

        return output;
    }, {
        label: retryLabel || model,
        maxAttempts: 3,
        baseDelayMs: 1500
    });
}

function stripMarkdownFences(text, languageHint = '') {
    const openingFence = languageHint
        ? new RegExp(`^\\s*\\\`\\\`\\\`${languageHint}\\n?`, 'i')
        : /^\s*```[a-z]*\n?/i;
    return text.replace(openingFence, '').replace(/\n?```\s*$/i, '').trim();
}

function normalizeHtmlDocument(rawHtml) {
    let html = stripMarkdownFences(rawHtml, 'html');
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
        const htmlStart = html.indexOf('<!');
        if (htmlStart > 0) {
            html = html.substring(htmlStart);
        } else {
            const fallbackHtmlStart = html.toLowerCase().indexOf('<html');
            if (fallbackHtmlStart > 0) {
                html = html.substring(fallbackHtmlStart);
            }
        }
    }
    return html;
}

function extractHtmlTitle(html) {
    const match = html.match(/<title>(.*?)<\/title>/i);
    return match?.[1]?.trim() || null;
}

function withTimeout(promise, ms, label) {
    let timeoutId;
    return Promise.race([
        promise.finally(() => clearTimeout(timeoutId)),
        new Promise((_, reject) => {
            const error = new Error(`${label} timed out.`);
            error.statusCode = 503;
            timeoutId = setTimeout(() => reject(error), ms);
        })
    ]);
}

async function markJobError(jobId, fallbackMessage, err) {
    await pool.query(
        `UPDATE ai_games SET title = $1 WHERE id = $2`,
        ['ERROR: ' + (err?.message || fallbackMessage), jobId]
    );
}

async function createPendingJob(userId, prompt, title, jobId = randomUUID()) {
    const startedAt = Date.now();
    const dbRes = await withTimeout(pool.query(
        `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [jobId, userId, prompt, title, '', '', true]
    ), 12000, 'Dream job creation');
    console.log(`⏱️ [AI DB] Pending job row created in ${Date.now() - startedAt}ms`);
    return dbRes.rows[0].id;
}

function queuePendingJobBootstrap({ jobId, userId, prompt, title, logLabel, run }) {
    rememberPendingBoot(jobId, { status: 'pending' });

    setImmediate(() => {
        void (async () => {
            try {
                console.log(`🚀 [${logLabel}] Bootstrapping pending job ${jobId}`);
                await createPendingJob(userId, prompt, title, jobId);
                forgetPendingBoot(jobId);
                await run(jobId, prompt);
            } catch (error) {
                console.error(`❌ [${logLabel}] Bootstrap failed for ${jobId}:`, error);
                rememberPendingBoot(jobId, {
                    status: 'error',
                    error: error?.message || 'Job bootstrap failed',
                });
            }
        })();
    });
}

async function getUserIdFromToken(token, invalidMessage = 'Expired session') {
    if (!token) {
        return null;
    }

    const startedAt = Date.now();
    const userResult = await withTimeout(
        pool.query('SELECT id FROM users WHERE token = $1', [token]),
        12000,
        'Auth lookup'
    );
    console.log(`⏱️ [AI AUTH] Token lookup completed in ${Date.now() - startedAt}ms`);
    if (userResult.rows.length === 0) {
        const error = new Error(invalidMessage);
        error.statusCode = 401;
        throw error;
    }

    return userResult.rows[0].id;
}

// ═══════════════════════════════════════════════════════════
// DREAMSTREAM MAIN PIPELINE
// Phase 1: Llama 3.3 on NIM extracts a playable spec
// Phase 2: Claude Opus builds the entire game in one pass
// Phase 3: Puppeteer verifies the result before save
// ═══════════════════════════════════════════════════════════
async function executeDreamJob(jobId, prompt) {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY is not configured for main DreamStream.');
        }

        console.log(`🧠 [DREAM JOB] Started DreamStream Opus pipeline for job: ${jobId}`);

        // ── PHASE 1: SPEC EXTRACTION ──
        console.log(`📋 Phase 1/3: Llama 3.3 70B Instruct on NIM extracting a playable game spec...`);
        const phase1 = buildPhase1_Quantize(prompt);
        const rawSpecSheet = await callAI(phase1.system, phase1.user, 1500, 0.5);
        const specSheet = normalizeDreamSpec(rawSpecSheet, prompt);
        console.log(`✅ Phase 1 complete: "${specSheet.title}" (${specSheet.genre}, ${specSheet.visualStyle}) [lane=${specSheet.runtimeLane}]`);

        // ── PHASE 2: SINGLE-AGENT PREMIUM BUILD ──
        console.log(`🔨 Phase 2/3: Claude Opus building the complete game in one pass...`);
        const buildPrompt = buildPhase2_BuildPrototype(specSheet);
        let rawGameHtml = await generateCompleteHtmlWithClaude(buildPrompt, { label: 'Phase 2 Opus Build' });

        if (!rawGameHtml) {
            throw new Error('Claude returned empty game output.');
        }
        if (!hasClosedHtmlDocument(rawGameHtml)) {
            throw new Error('Claude output is missing </html> and appears truncated.');
        }

        console.log(`✅ Phase 2 complete: Claude generated ${rawGameHtml.length} chars of game code`);

        // ── POST-PROCESS: Inject Juice + Audio engines ──
        let finalHtml = postProcessRawHtml(rawGameHtml);
        let finalScreenshot = null;

        // ── PHASE 3/3: QA SANDBOX AUTO-HEALING LOOP ──
        let maxRetries = 2;
        let p3Success = false;
        
        while (maxRetries > 0 && !p3Success) {
            console.log(`📸 [Attempt ${3 - maxRetries}/2] Verifying game in sandbox...`);
            let sandboxRes;
            try {
                sandboxRes = await verifyGame(finalHtml);
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }
            finalScreenshot = sandboxRes.screenshot || null;

            if (!sandboxRes.success && sandboxRes.crashes && sandboxRes.crashes.length > 0) {
                console.log(`⚠️ Sandbox CRASH DETECTED. Asking Claude to repair... (${sandboxRes.crashes[0]})`);
                const repairInstructions = [
                    `The sandbox crashed with these errors:`,
                    sandboxRes.crashes.join('\n'),
                    '',
                    'Repair the game so it boots and remains playable on mobile.',
                    'Return the COMPLETE corrected HTML file only.',
                    'Do not explain anything.',
                ].join('\n');
                const repairPrompt = buildPhase2_EditGame(rawGameHtml, repairInstructions);
                rawGameHtml = await generateCompleteHtmlWithClaude(repairPrompt, { label: 'Phase 3 Opus Repair' });
                if (!hasClosedHtmlDocument(rawGameHtml)) {
                    throw new Error('Claude repair output is missing </html> and appears truncated.');
                }
                finalHtml = postProcessRawHtml(rawGameHtml);
                maxRetries--;
            } else {
                console.log(`✅ Sandbox: Zero Crashes Detected. Game is stable!`);
                p3Success = true;
            }
        }

        if (!p3Success) {
            throw new Error('Sandbox verification failed after 2 Claude repair attempts.');
        }

        // ── SAVE TO DB ──
        const finalTitle = extractHtmlTitle(rawGameHtml) || specSheet.title || 'DreamStream Game';
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, artist_code = $4, thumbnail = $5 WHERE id = $6`,
            [finalTitle, finalHtml, rawGameHtml, null, finalScreenshot, jobId]
        );
        console.log(`✅ [DREAM JOB] Complete! "${finalTitle}" saved for job ${jobId}`);

    } catch (err) {
        console.error("❌ [DREAM JOB] Error:", err);
        await markJobError(jobId, "DreamStream generation failed", err);
    }
}


async function executeEditJob(newJobId, parentDraftId, instructions) {
    try {
        console.log(`🚀 [EDIT JOB] Starting edit job ${newJobId} based on parent ${parentDraftId}`);
        
        // 1. Fetch parent draft with all context
        const parentRes = await pool.query('SELECT raw_code, html_payload, artist_code, title, edit_history FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");
        
        const parentDraft = parentRes.rows[0];
        const artistCode = parentDraft.artist_code || '';
        const engineCode = parentDraft.raw_code || parentDraft.html_payload;
        const editHistory = parentDraft.edit_history || [];
        
        if (!engineCode || engineCode.length < 100) {
            throw new Error(`Parent draft has no usable code!`);
        }
        
        console.log(`📊 [EDIT JOB] Parent "${parentDraft.title}" — engine: ${engineCode.length} chars, artist: ${artistCode.length} chars, history: ${editHistory.length} past edits`);

        // 2. Build conversation messages WITH MEMORY
        const messages = [];
        
        // System message: establish the AI's role and the current code
        let systemContent = `You are an expert HTML5 game developer. You built this game and are now modifying it based on user feedback.`;
        
        if (artistCode) {
            systemContent += `\n\nThe game has TWO code sections:\n\n===ARTIST CODE (Canvas drawing functions)===\n${artistCode}\n\n===ENGINE CODE (Game HTML with physics, inputs, game loop)===\n${engineCode}`;
            systemContent += `\n\nWhen responding, you MUST output BOTH sections using these exact markers:\n===ARTIST_CODE===\n(complete artist JavaScript)\n===ENGINE_CODE===\n(complete engine HTML starting with <!DOCTYPE html>)\n\nOutput BOTH sections every time. If you only changed one, copy the other unchanged. NEVER abbreviate or use "...".`;
        } else {
            systemContent += `\n\nCurrent game code:\n${engineCode}`;
            systemContent += `\n\nOutput the COMPLETE modified HTML file. Start with <!DOCTYPE html>, end with </html>. NEVER abbreviate.`;
        }
        
        messages.push({ role: "system", content: systemContent });
        
        // Replay past edit history as conversation turns so the AI remembers
        for (const pastEdit of editHistory) {
            messages.push({ role: "user", content: pastEdit });
            messages.push({ role: "assistant", content: "(Applied successfully)" });
        }
        
        // Current edit instruction
        messages.push({ role: "user", content: instructions });
        
        console.log(`🤖 [EDIT JOB] Sending ${messages.length} messages to NVIDIA NIM (${editHistory.length} past edits + new instruction)...`);
        
        const aiStream = await nvidiaClient.chat.completions.create({
            model: DREAM_MODELS.engineer,
            messages: messages,
            max_tokens: 16000,
            temperature: 0.3,
            stream: true
        });

        let aiOutput = "";
        for await (const chunk of aiStream) {
            if (chunk.choices[0]?.delta?.content) {
                aiOutput += chunk.choices[0].delta.content;
            }
        }
        
        console.log(`✅ [EDIT JOB] AI returned ${aiOutput.length} chars (Streaming completed)`);

        // 3. Parse the response — extract artist and engine sections
        let editedArtistCode = artistCode; // default: unchanged
        let editedEngineHtml;
        
        if (artistCode && aiOutput.includes('===ARTIST_CODE===') && aiOutput.includes('===ENGINE_CODE===')) {
            // Structured response — parse both sections
            const artistMatch = aiOutput.split('===ARTIST_CODE===')[1]?.split('===ENGINE_CODE===')[0]?.trim();
            const engineMatch = aiOutput.split('===ENGINE_CODE===')[1]?.trim();
            
            if (artistMatch) editedArtistCode = stripMarkdownFences(artistMatch);
            if (engineMatch) editedEngineHtml = stripMarkdownFences(engineMatch);
        } else {
            // Flat response — treat entire output as engine HTML (legacy or no markers)
            editedEngineHtml = aiOutput;
        }
        
        if (!editedEngineHtml) {
            throw new Error('Could not parse engine code from AI response');
        }
        
        // Strip markdown fences from engine HTML
        editedEngineHtml = normalizeHtmlDocument(editedEngineHtml);
        
        if (!editedEngineHtml.includes('</html>')) {
            throw new Error('AI output is missing </html> — likely truncated.');
        }

        // 4. Re-compile: merge artist code with edited engine code
        let compiledHtml;
        if (editedArtistCode) {
            compiledHtml = compileMultiAgentGame(editedArtistCode, editedEngineHtml);
        } else {
            compiledHtml = editedEngineHtml;
        }

        // Post-process with Juice + Audio
        const finalHtml = postProcessRawHtml(compiledHtml);
        const finalTitle = parentDraft.title.replace(/^Remix of /i, '');

        // Screenshot
        console.log(`📸 Taking screenshot for edit job ${newJobId}...`);
        const sandboxRes = await verifyGame(finalHtml);
        if (!sandboxRes.success && sandboxRes.crashes?.length) {
            throw new Error(`Edited game failed sandbox verification: ${sandboxRes.crashes[0]}`);
        }
        const finalScreenshot = sandboxRes.screenshot || null;

        // 5. Save with updated edit history (memory for next edit)
        const newHistory = [...editHistory, instructions];
        
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, artist_code = $4, thumbnail = $5, edit_history = $6 WHERE id = $7`,
            [finalTitle, finalHtml, editedEngineHtml, editedArtistCode, finalScreenshot, JSON.stringify(newHistory), newJobId]
        );
        console.log(`✅ [EDIT JOB] Edit complete for job ${newJobId} (history now has ${newHistory.length} edits)`);

    } catch (err) {
        console.error("❌ [EDIT JOB] Error:", err);
        await markJobError(newJobId, "DreamStream edit failed", err);
    }
}

router.post('/generate-asset', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({error: "prompt required"});
        
        console.log(`🎨 Manual Asset Request: "${prompt}"`);
        const finalPrompt = `${prompt}, 2d casual mobile game asset graphic, vibrant, flat vector style, simple clean background`;
        const safePrompt = encodeURIComponent(finalPrompt);
        const seed = Math.floor(Math.random() * 1000000);
        const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=512&height=512&nologo=true&seed=${seed}`;
        
        console.log(`🖼️ Tracking blazing fast AI image from Pollinations: ${prompt}`);
        
        // Let's verify it works
        const imgRes = await fetch(url);
        if (!imgRes.ok) {
            return res.status(500).json({ error: "Failed to generate AI image. Try again." });
        }
        
        // Push directly to the global community pool dynamically so it shares everywhere
        const ASSETS_JSON_PATH = path.join(process.cwd(), 'public/uploads/community-assets.json');
        let communityAssets = [];
        if (fs.existsSync(ASSETS_JSON_PATH)) {
            try { communityAssets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, 'utf-8')); } catch (e) {}
        }
        
        communityAssets.unshift({
            id: `ai-${Date.now()}-${seed}`,
            type: 'image',
            url: url,
            thumb: url,
            title: `AI Generated: ${prompt}`,
            label: prompt,
            instruction: `Use this AI generated asset image: ${url}`
        });
        
        fs.writeFileSync(ASSETS_JSON_PATH, JSON.stringify(communityAssets, null, 2));

        // Return the pure remote URL instead of base64
        return res.json({ success: true, imageUrl: url });
    } catch(e) {
        console.error("Asset Gen Error:", e);
        res.status(500).json({ error: "System Error" });
    }
});

router.post('/dream', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets
        console.log(`🧠 [DREAM ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        queuePendingJobBootstrap({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.dreamPending,
            logLabel: 'DREAM ROUTE',
            run: executeDreamJob,
        });

        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("OUTER GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "System Error" });
    }
});

router.post('/edit', async (req, res) => {
    try {
        const { draftId, instructions, newAsset } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');

        if (!draftId || !instructions) return res.status(400).json({ error: "draftId and instructions are required" });
        console.log(`🧠 [EDIT ROUTE] Creating remix job for User[${userId}] -> Draft: ${draftId}, Inst: "${instructions}"`);

        const newJobId = randomUUID();
        queuePendingJobBootstrap({
            jobId: newJobId,
            userId,
            prompt: instructions,
            title: JOB_TITLES.remixPending,
            logLabel: 'EDIT ROUTE',
            run: async (jobId) => executeEditJob(jobId, draftId, instructions),
        });

        res.json({ success: true, jobId: newJobId });

    } catch (outerError) {
        console.error("OUTER EDIT ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "System Error" });
    }
});

router.get('/dream/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await pool.query('SELECT title, html_payload, raw_code FROM ai_games WHERE id = $1', [jobId]);
        if (result.rows.length === 0) {
            const pendingBoot = pendingJobBoots.get(jobId);
            if (pendingBoot?.status === 'error') {
                return res.json({ status: 'error', error: pendingBoot.error || 'Job startup failed' });
            }
            if (pendingBoot) {
                return res.json({ status: 'pending' });
            }
            return res.status(404).json({ error: 'Job not found' });
        }
        
        const row = result.rows[0];
        
        // If html_payload is still empty, check if it's a hard error or just pending
        if (!row.html_payload || row.html_payload === '') {
            if (row.title && row.title.startsWith('ERROR:')) {
                return res.json({ status: 'error', error: row.title.replace('ERROR: ', '') });
            }
            return res.json({ status: 'pending' });
        }
        
        // Done! Return the payload (even if it's an errorHtml payload, let the webview render it)
        return res.json({
            success: true,
            status: 'complete',
            draftId: jobId,
            title: row.title,
            htmlPreview: row.html_payload
        });

    } catch(e) { 
        res.status(500).json({ error: e.message }); 
    }
});

router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const drafts = await pool.query("SELECT id, title, prompt, thumbnail, created_at FROM ai_games WHERE user_id = $1 AND is_draft = true AND html_payload != '' ORDER BY created_at DESC", [userId]);
        res.json({ drafts: drafts.rows });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userId = await getUserIdFromToken(token, 'Invalid token');
        const draft = await pool.query("SELECT id, title, prompt, html_payload, created_at FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userId]);
        if (draft.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json({ draft: draft.rows[0] });
    } catch(e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.post('/publish/:draftId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Unauthorized');
        const publishRes = await pool.query("UPDATE ai_games SET is_draft = false WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.draftId, userId]);
        if (publishRes.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        const globalId = `gm-ai-${req.params.draftId.substring(0, 8)}`;
        await pool.query(
            `INSERT INTO games (id, name, description, icon, color, category, developer, embed_url, thumbnail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
            [globalId, publishRes.rows[0].title, "Multi-Engine AI Creation: " + publishRes.rows[0].prompt, "✨", "#00E5FF", "ai-remix", userId, `/api/ai/play/${req.params.draftId}`, publishRes.rows[0].thumbnail]
        );
        res.json({ success: true, gameId: globalId });
    } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

router.get('/play/:targetId', async (req, res) => {
    try {
        const game = await pool.query("SELECT html_payload FROM ai_games WHERE id::text LIKE $1 LIMIT 1", [req.params.targetId + '%']);
        if (game.rows.length === 0) return res.status(404).send("AI Game Block Missing / Erased");
        res.setHeader('Content-Type', 'text/html');
        res.send(game.rows[0].html_payload);
    } catch(e) { res.status(500).send("Database extraction failed"); }
});

// === TEMPLATES ===
router.get('/templates', async (req, res) => {
    try {
        const templates = await pool.query(
            "SELECT id, title, prompt, thumbnail, created_at FROM ai_games WHERE is_template = true AND html_payload != '' ORDER BY created_at DESC"
        );
        res.json({ templates: templates.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/templates/:id', async (req, res) => {
    try {
        const tpl = await pool.query(
            "SELECT id, title, prompt, html_payload, thumbnail, created_at FROM ai_games WHERE id = $1 AND is_template = true",
            [req.params.id]
        );
        if (tpl.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ template: tpl.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/set-template', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required' });
        const result = await pool.query(
            "UPDATE ai_games SET is_template = true WHERE LOWER(title) LIKE LOWER($1) RETURNING id, title",
            [`%${title}%`]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'No matching draft found' });
        res.json({ success: true, updated: result.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/rebuild-assets', async (req, res) => {
    res.json({ status: "bg-process-started", msg: "Scraping Omni-Engine assets into Postgres Vector DB..." });
    // ...
});

router.get('/admin/backfill-thumbnails', async (req, res) => {
    try {
        res.json({ status: "bg-process-started", msg: "Taking screenshots of all AI games in the background. Check your Railway logs for progress." });
        
        // Spawn the backfill script dynamically in the background so it doesn't block the request
        const { exec } = await import('child_process');
        exec('node scripts/backfill-thumbnails.js', (err, stdout, stderr) => {
            if (err) console.error("Backfill failed:", err);
            if (stdout) console.log("Backfill Log:", stdout);
            if (stderr) console.error("Backfill Error:", stderr);
        });
    } catch(e) {
        console.error("Backfill Trigger Error:", e);
    }
});

// ========================================================
// 🧪 LABS: Experimental alternate provider path
// ========================================================


async function executeLabsDreamJob(jobId, prompt) {
    try {
        console.log(`🧪 [LABS JOB] Started Qwen solo Labs pipeline for job: ${jobId}`);
        const soloPrompt = buildLabsSoloPrototype(prompt);
        let rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
            model: DREAM_MODELS.engineer,
            systemPrompt: "You are an elite solo HTML5 game creator building the full game yourself.",
            userPrompt: soloPrompt,
            maxTokens: 12000,
            temperature: 0.25,
            retryLabel: 'Labs Solo Generation'
        }));

        let finalHtml = postProcessRawHtml(rawEngineHtml);
        let finalScreenshot = null;
        let maxRetries = 2;
        let stable = false;

        while (maxRetries >= 0 && !stable) {
            console.log(`🧪 [LABS JOB] Verifying solo build...`);
            let sandboxRes;
            try {
                validateGeneratedBuild('', rawEngineHtml, rawEngineHtml);
                sandboxRes = await verifyGame(finalHtml);
            } catch (validationError) {
                sandboxRes = {
                    success: false,
                    crashes: [validationError.message || String(validationError)],
                    screenshot: null
                };
            }

            finalScreenshot = sandboxRes.screenshot || null;
            if (sandboxRes.success || !sandboxRes.crashes?.length) {
                stable = true;
                break;
            }

            if (maxRetries === 0) {
                throw new Error(`Labs solo game failed verification: ${sandboxRes.crashes[0]}`);
            }

            console.log(`⚠️ [LABS JOB] Solo build crashed. Repairing... (${sandboxRes.crashes[0]})`);
            const repairPrompt = `The mobile HTML5 game below failed verification.
FATAL ERROR: ${sandboxRes.crashes[0]}

You must rewrite the FULL HTML document so it boots and remains playable.
Keep the same game fantasy, but prioritize a working game over ambition.

BROKEN HTML:
\`\`\`html
${rawEngineHtml}
\`\`\`

Output ONLY the complete fixed HTML document.`;

            rawEngineHtml = normalizeHtmlDocument(await streamNvidiaText({
                model: DREAM_MODELS.engineer,
                systemPrompt: "You are an elite HTML5 game debugger repairing a single-file mobile game.",
                userPrompt: repairPrompt,
                maxTokens: 12000,
                temperature: 0.1,
                retryLabel: 'Labs Solo Repair'
            }));
            finalHtml = postProcessRawHtml(rawEngineHtml);
            maxRetries--;
        }

        const gameTitle = "🧪 " + (extractHtmlTitle(rawEngineHtml) || 'Qwen Solo Labs');

        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [gameTitle, finalHtml, rawEngineHtml, finalScreenshot, jobId]
        );
        console.log(`✅ [LABS JOB] Complete! "${gameTitle}" saved for job ${jobId}`);

    } catch (err) {
        console.error("❌ [LABS JOB] Error:", err);
        await markJobError(jobId, "Labs generation failed", err);
    }
}

router.post('/dream-labs', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userId = await getUserIdFromToken(token, 'Expired session');

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets
        console.log(`🧪 [LABS ROUTE] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        const jobId = randomUUID();
        queuePendingJobBootstrap({
            jobId,
            userId,
            prompt,
            title: JOB_TITLES.labsPending,
            logLabel: 'LABS ROUTE',
            run: executeLabsDreamJob,
        });

        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("LABS GENERATION ERROR:", outerError);
        res.status(outerError.statusCode || 500).json({ error: outerError.message || "Labs System Error" });
    }
});

export default router;
