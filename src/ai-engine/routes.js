import express from 'express';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pool from '../db.js';
import { buildPhase1_Quantize, buildPhase2B_Engineer, buildPhase2_EditGame, postProcessRawHtml, buildPhase2A_Artist, compileMultiAgentGame } from './promptRegistry.js';
import { compileGameHTML } from './compiler.js';
import { verifyGame } from './sandbox.js';
import { searchAssets, setAssetBaseUrl } from './asset-dictionary.js';

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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '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',
});

// Claude Sonnet 4.6 — Premium code generation
const claude = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// OpenRouter Client (Qwen 3.6)
const openRouterClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://gametok.app',
        'X-Title': 'DreamStream Game Engine',
    },
});

// ═══════════════════════════════════════════════════════════
// ASSET RESOLVER (shared across all job types)
// ═══════════════════════════════════════════════════════════
async function resolveAsset(key, assetDef) {
    let type = "ai";
    let value = assetDef;
    if (typeof assetDef === "object" && assetDef !== null) {
        type = assetDef.type || "ai";
        value = assetDef.value || "";
    }

    if (type === "emoji") {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text y="80" font-size="80">${value}</text></svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    if (type === "kenney") {
        const dictResults = await searchAssets(value, 1);
        if (dictResults.length > 0) return dictResults[0].url;
    }

    // Fallback emoji for the role
    const fallbackEmoji = { HERO: "🦸‍♂️", ENEMY: "👾", BACKGROUND: "", WEAPON: "⚔️", COLLECTIBLE: "💎", OBSTACLE: "🧱" }[key] || "📦";
    const errSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text y="80" font-size="80">${fallbackEmoji}</text></svg>`;
    const fallbackUrl = fallbackEmoji ? `data:image/svg+xml;utf8,${encodeURIComponent(errSvg)}` : "";

    // AI generation via Pollinations (last resort)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const imgPrompt = `2D game asset, clean vector style, flat colors, isolated on transparent background: ${value}`;
        const imgRes = await fetch("https://image.pollinations.ai/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: imgPrompt,
                width: 512, height: 512,
                model: "flux",
                seed: Math.floor(Math.random() * 1000000)
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!imgRes.ok) return fallbackUrl;
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return "data:image/jpeg;base64," + base64;
    } catch (e) {
        console.log(`⚠️ Fallback emoji for ${key} (Pollinations failed)`);
        return fallbackUrl;
    }
}

async function callAI(systemPrompt, userPrompt, maxTokens = 2000, temperature = 0.3) {
    const res = await nvidiaClient.chat.completions.create({
        model: "google/gemma-4-31b-it", // NIM's state-of-the-art Gemma 4 31B model
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

// ═══════════════════════════════════════════════════════════
// CLAUDE RAW CODE GENERATION PIPELINE
// Phase 1: QUANTIZE  — Gemma extracts game spec (FREE)
// Phase 2: BUILD     — Claude writes full game code (PREMIUM)
// Phase 3: VERIFY    — Puppeteer sandbox validates
// ═══════════════════════════════════════════════════════════
async function executeDreamJob(jobId, prompt, userId) {
    try {
        console.log(`🧠 [DREAM JOB] Started Claude pipeline for job: ${jobId}`);

        // ── PHASE 1: QUANTIZE (Nemotron-4-340B — RAG Engine) ──
        console.log(`📋 Phase 1/2: Advanced Nemotron Game Designer analyzing prompt...`);
        const phase1 = buildPhase1_Quantize(prompt);
        const specSheet = await callAI(phase1.system, phase1.user, 1500, 0.5);
        console.log(`✅ Phase 1 complete: "${specSheet.title}" (${specSheet.genre}, ${specSheet.visualStyle})`);
        // ── PHASE 2: MULTI-CLOUD AGENT SYNTHESIS (STRICT SEQUENTIAL FOR EXTREME RELIABILITY) ──
        console.log(`🔨 Phase 2: Sequential Multi-Agent Synthesis (Artist translates first, then Engineer builds around it)...`);
        
        const artistPrompt = buildPhase2A_Artist(specSheet);

        // 1. Artist runs First on NVIDIA NIM
        console.log(`🎨 Artist-Coder (NVIDIA Qwen 3) sketching SVGs (Streaming to bypass proxy timeout)...`);
        const artistStream = await nvidiaClient.chat.completions.create({
            model: "qwen/qwen3-coder-480b-a35b-instruct",
            messages: [{ role: "system", content: "You are an elite procedural HTML5 Canvas Artist." }, { role: "user", content: artistPrompt }],
            max_tokens: 4000,
            temperature: 0.5,
            stream: true
        });

        let rawArtistCode = "";
        for await (const chunk of artistStream) {
            if (chunk.choices[0]?.delta?.content) {
                rawArtistCode += chunk.choices[0].delta.content;
            }
        }
        
        let cleanSvgCode = rawArtistCode.replace(/^```[a-z]*\n/gi, '').replace(/\n```$/g, '').trim();

        // 2. Engineer builds Physics specifically tuned to the Artist's SVGs on OpenRouter
        const enginePrompt = buildPhase2B_Engineer(specSheet, cleanSvgCode);

        console.log(`⚙️ Engine-Coder (OpenRouter Qwen 3.6 Plus) writing physics (Streaming)...`);
        const engineStream = await openRouterClient.chat.completions.create({
            model: "qwen/qwen3.6-plus:free",
            messages: [{ role: "system", content: "You are an elite HTML5 Game Engineer." }, { role: "user", content: enginePrompt }],
            max_tokens: 8000,
            temperature: 0.2,
            stream: true
        });

        let rawEngineHtml = "";
        for await (const chunk of engineStream) {
            if (chunk.choices[0]?.delta?.content) {
                rawEngineHtml += chunk.choices[0].delta.content;
            }
        }

        console.log(`✅ Multi-Agent Generated: Artist (${cleanSvgCode.length} chars) | Engine (${rawEngineHtml.length} chars)`);

        rawEngineHtml = rawEngineHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        if (!rawEngineHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = rawEngineHtml.indexOf('<!');
            if (htmlStart > 0) rawEngineHtml = rawEngineHtml.substring(htmlStart);
        }

        // ── COMPILE MULTI-AGENT CODE ──
        let rawGameHtml = compileMultiAgentGame(cleanSvgCode, rawEngineHtml);

        // ── POST-PROCESS: Inject Juice + Audio engines ──
        const finalHtml = postProcessRawHtml(rawGameHtml);

        // ── VERIFY IN SANDBOX ──
        console.log(`📸 Verifying game in sandbox...`);
        const sandboxRes = await verifyGame(finalHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // ── SAVE TO DB ──
        // Store artist_code and raw_code (engine HTML only) SEPARATELY
        // so edits only need to touch the small engine part
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, artist_code = $4, thumbnail = $5 WHERE id = $6`,
            [specSheet.title || 'DreamStream Game', finalHtml, rawEngineHtml, cleanSvgCode, finalScreenshot, jobId]
        );
        console.log(`✅ [DREAM JOB] Complete! "${specSheet.title}" saved for job ${jobId}`);

    } catch (err) {
        console.error("❌ [DREAM JOB] Error:", err);
        await pool.query(
            `UPDATE ai_games SET title = $1 WHERE id = $2`,
            ['ERROR: ' + (err.message || "Claude generation failed"), jobId]
        );
    }
}


async function executeEditJob(newJobId, parentDraftId, instructions, userId, newAsset) {
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
        
        console.log(`🤖 [EDIT JOB] Sending ${messages.length} messages to AI (${editHistory.length} past edits + new instruction)...`);
        
        const aiStream = await openRouterClient.chat.completions.create({
            model: "qwen/qwen3.6-plus:free",
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
            
            if (artistMatch) editedArtistCode = artistMatch.replace(/^```[a-z]*\n?/gi, '').replace(/\n?```$/g, '').trim();
            if (engineMatch) editedEngineHtml = engineMatch.replace(/^```[a-z]*\n?/gi, '').replace(/\n?```$/g, '').trim();
        } else {
            // Flat response — treat entire output as engine HTML (legacy or no markers)
            editedEngineHtml = aiOutput;
        }
        
        if (!editedEngineHtml) {
            throw new Error('Could not parse engine code from AI response');
        }
        
        // Strip markdown fences from engine HTML
        editedEngineHtml = editedEngineHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        if (!editedEngineHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = editedEngineHtml.indexOf('<!');
            if (htmlStart > 0) editedEngineHtml = editedEngineHtml.substring(htmlStart);
        }
        
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
        await pool.query(
            `UPDATE ai_games SET title = $1 WHERE id = $2`,
            ['ERROR: ' + (err.message || "Engine Edit Error"), newJobId]
        );
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
        
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets
        console.log(`🧠 [PEAK ARCHITECTURE - POLLING] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        // 1. Immediately create a blank draft entry in DB (html_payload="", raw_code="")
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, 'Pending Dream...', '', '', true]
        );
        const jobId = dbRes.rows[0].id;

        // 2. Offload work to background process (do NOT await it)
        executeDreamJob(jobId, prompt, userId);

        // 3. Guarantee immediate return to user before 100s proxy timeout
        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("OUTER GENERATION ERROR:", outerError);
        res.status(500).json({ error: "System Error" });
    }
});

router.post('/edit', async (req, res) => {
    try {
        const { draftId, instructions, newAsset } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!draftId || !instructions) return res.status(400).json({ error: "draftId and instructions are required" });
        console.log(`🧠 [PEAK ARCHITECTURE - EDIT] Creating remix job for User[${userId}] -> Draft: ${draftId}, Inst: "${instructions}"`);

        // 1. Immediately create a blank draft entry in DB to store the NEW remixed version
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, instructions, 'Pending Remix...', '', '', true]
        );
        const newJobId = dbRes.rows[0].id;

        // 2. Offload work to background process (do NOT await it)
        executeEditJob(newJobId, draftId, instructions, userId, newAsset);

        // 3. Guarantee immediate return to user before timeout
        // We reuse the same long-polling status endpoint, just feeding it the NEW jobId.
        res.json({ success: true, jobId: newJobId });

    } catch (outerError) {
        console.error("OUTER EDIT ERROR:", outerError);
        res.status(500).json({ error: "System Error" });
    }
});

router.get('/dream/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await pool.query('SELECT title, html_payload, raw_code FROM ai_games WHERE id = $1', [jobId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        
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
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
        const drafts = await pool.query("SELECT id, title, prompt, thumbnail, created_at FROM ai_games WHERE user_id = $1 AND is_draft = true AND html_payload != '' ORDER BY created_at DESC", [userResult.rows[0].id]);
        res.json({ drafts: drafts.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/drafts/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
        const draft = await pool.query("SELECT id, title, prompt, html_payload, created_at FROM ai_games WHERE id = $1 AND user_id = $2 AND is_draft = true", [req.params.id, userResult.rows[0].id]);
        if (draft.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json({ draft: draft.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/publish/:draftId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
        const publishRes = await pool.query("UPDATE ai_games SET is_draft = false WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.draftId, userResult.rows[0].id]);
        if (publishRes.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        const globalId = `gm-ai-${req.params.draftId.substring(0, 8)}`;
        await pool.query(
            `INSERT INTO games (id, name, description, icon, color, category, developer, embed_url, thumbnail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
            [globalId, publishRes.rows[0].title, "Multi-Engine AI Creation: " + publishRes.rows[0].prompt, "✨", "#00E5FF", "ai-remix", userResult.rows[0].id, `/api/ai/play/${req.params.draftId}`, publishRes.rows[0].thumbnail]
        );
        res.json({ success: true, gameId: globalId });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
// 🧪 LABS: GEMMA 4 EXPERIMENTAL ENGINE (NVIDIA NIM)
// ========================================================


async function executeLabsDreamJob(jobId, prompt, userId) {
    // Labs now uses the same Claude pipeline as Dream
    try {
        console.log(`🧪 [LABS JOB] Started Claude pipeline for job: ${jobId}`);

        // Phase 1: Quantize (Nemotron + RAG)
        const phase1 = buildPhase1_Quantize(prompt);
        const specSheet = await callAI(phase1.system, phase1.user, 1500, 0.5);
        console.log(`✅ Labs Phase 1: "${specSheet.title}"`);
        
        // ── ARTIST-CODER PROTOCOL ──
        console.log(`🎨 Artist-Coder: Utilizing full procedural code generation...`);

        // ── PHASE 2: MULTI-CLOUD AGENT SYNTHESIS (SEQUENTIAL) ──
        console.log(`🔨 Labs Phase 2: Sequential Multi-Cloud Synthesis...`);
        
        const artistPrompt = buildPhase2A_Artist(specSheet);

        console.log(`🎨 Labs Artist-Coder (NVIDIA Qwen 3 480B) sketching SVGs...`);
        const artistRes = await nvidiaClient.chat.completions.create({
            model: "qwen/qwen3-coder-480b-a35b-instruct",
            messages: [{ role: "system", content: "You are an elite procedural HTML5 Canvas Artist." }, { role: "user", content: artistPrompt }],
            max_tokens: 4000,
            temperature: 0.5
        });

        if (!artistRes || !artistRes.choices || !artistRes.choices[0]) {
            throw new Error("NVIDIA NIM Labs Error (Artist): " + (artistRes?.error?.message || JSON.stringify(artistRes)));
        }
        let rawArtistCode = artistRes.choices[0].message.content;
        let cleanSvgCode = rawArtistCode.replace(/^```[a-z]*\n/gi, '').replace(/\n```$/g, '').trim();

        const enginePrompt = buildPhase2B_Engineer(specSheet, cleanSvgCode);

        console.log(`⚙️ Labs Engine-Coder (OpenRouter Qwen 3.6 Plus) writing physics...`);
        const engineRes = await openRouterClient.chat.completions.create({
            model: "qwen/qwen3.6-plus:free",
            messages: [{ role: "system", content: "You are an elite HTML5 Game Engineer." }, { role: "user", content: enginePrompt }],
            max_tokens: 8000,
            temperature: 0.2
        });
        if (!engineRes || !engineRes.choices || !engineRes.choices[0]) {
            throw new Error("OpenRouter Labs Error (Logic): " + (engineRes?.error?.message || JSON.stringify(engineRes)));
        }

        let rawEngineHtml = engineRes.choices[0].message.content;

        rawEngineHtml = rawEngineHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        if (!rawEngineHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = rawEngineHtml.indexOf('<!');
            if (htmlStart > 0) rawEngineHtml = rawEngineHtml.substring(htmlStart);
        }

        let rawGameHtml = compileMultiAgentGame(cleanSvgCode, rawEngineHtml);

        const finalHtml = postProcessRawHtml(rawGameHtml);
        const sandboxRes = await verifyGame(finalHtml);
        const finalScreenshot = sandboxRes.screenshot || null;
        const gameTitle = "🧪 " + (specSheet.title || "Labs Game");

        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [gameTitle, finalHtml, rawGameHtml, finalScreenshot, jobId]
        );
        console.log(`✅ [LABS JOB] Complete! "${gameTitle}" saved for job ${jobId}`);

    } catch (err) {
        console.error("❌ [LABS JOB] Error:", err);
        await pool.query(
            `UPDATE ai_games SET title = $1 WHERE id = $2`,
            ['ERROR: ' + (err.message || "Claude Labs Error"), jobId]
        );
    }
}

router.post('/dream-labs', async (req, res) => {
    try {
        const { prompt } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        setAssetBaseUrl(req); // Set correct base URL for Kenney assets
        console.log(`🧪 [LABS - GEMMA 4] Creating job for User[${userId}] -> Concept: "${prompt}"`);

        // 1. Create blank draft entry in DB
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, '🧪 Labs: Cooking...', '', '', true]
        );
        const jobId = dbRes.rows[0].id;

        // 2. Offload to background (same pattern as main engine)
        executeLabsDreamJob(jobId, prompt, userId);

        // 3. Immediate return
        res.json({ success: true, jobId: jobId });

    } catch (outerError) {
        console.error("LABS GENERATION ERROR:", outerError);
        res.status(500).json({ error: "Labs System Error" });
    }
});

export default router;
