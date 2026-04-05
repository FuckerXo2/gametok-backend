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
import { buildPhase1_Quantize, buildPhase2_BuildPrototype, buildPhase2_EditGame, postProcessRawHtml } from './promptRegistry.js';
import { compileGameHTML } from './compiler.js';
import { verifyGame } from './sandbox.js';
import { searchAssets } from './asset-dictionary.js';

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
        const dictResults = searchAssets(value, 1);
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

// Helper to call the AI and parse JSON response
async function callAI(systemPrompt, userPrompt, maxTokens = 2000, temperature = 0.3) {
    const res = await nvidiaClient.chat.completions.create({
        model: "google/gemma-4-31b-it",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature
    });
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

        // ── PHASE 1: QUANTIZE (Gemma — FREE) ──
        console.log(`📋 Phase 1/2: Game Designer analyzing prompt...`);
        const phase1 = buildPhase1_Quantize(prompt);
        const specSheet = await callAI(phase1.system, phase1.user, 1500, 0.5);
        console.log(`✅ Phase 1 complete: "${specSheet.title}" (${specSheet.genre}, ${specSheet.visualStyle})`);

        // ── TEMPORARY TEST: QWEN 3.6 VIA OPENROUTER ──
        console.log(`🔨 Phase 2/2: Qwen 3.6 OpenRouter building full game... (TESTING)`);
        const buildPrompt = buildPhase2_BuildPrototype(specSheet);
        
        const qwenRes = await openRouterClient.chat.completions.create({
            model: "qwen/qwen3.6-plus-preview:free",
            messages: [
                { role: "system", content: "You are an expert game developer." },
                { role: "user", content: buildPrompt }
            ],
            max_tokens: 8000,
            temperature: 0.3
        });
        
        let rawGameHtml = qwenRes.choices[0].message.content;
        console.log(`✅ Qwen generated ${rawGameHtml.length} chars of game code`);

        // Strip markdown code fences if Claude wrapped it
        rawGameHtml = rawGameHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        
        // Ensure it starts with doctype
        if (!rawGameHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = rawGameHtml.indexOf('<!');
            if (htmlStart > 0) rawGameHtml = rawGameHtml.substring(htmlStart);
        }

        // ── POST-PROCESS: Inject Juice + Audio engines ──
        const finalHtml = postProcessRawHtml(rawGameHtml);

        // ── VERIFY IN SANDBOX ──
        console.log(`📸 Verifying game in sandbox...`);
        const sandboxRes = await verifyGame(finalHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // ── SAVE TO DB ──
        const rawCode = rawGameHtml; // Store the raw Claude output for editing

        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [specSheet.title || 'DreamStream Game', finalHtml, rawCode, finalScreenshot, jobId]
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
        console.log(`🚀 [EDIT JOB] Starting Claude edit job ${newJobId} based on parent ${parentDraftId}`);
        
        // 1. Fetch parent draft
        const parentRes = await pool.query('SELECT raw_code, html_payload, title FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");
        
        const parentDraft = parentRes.rows[0];
        const existingCode = parentDraft.raw_code || parentDraft.html_payload;
        
        // 2. Qwen modifies the existing game code
        console.log(`🤖 Qwen editing game...`);
        const editPrompt = buildPhase2_EditGame(existingCode, instructions);
        
        const qwenRes = await openRouterClient.chat.completions.create({
            model: "qwen/qwen3.6-plus-preview:free",
            messages: [
                { role: "system", content: "You are an expert game developer." },
                { role: "user", content: editPrompt }
            ],
            max_tokens: 8000,
            temperature: 0.3
        });
        
        let rawGameHtml = qwenRes.choices[0].message.content;
        console.log(`✅ Qwen edited: ${rawGameHtml.length} chars`);

        // Strip markdown fences
        rawGameHtml = rawGameHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        if (!rawGameHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = rawGameHtml.indexOf('<!');
            if (htmlStart > 0) rawGameHtml = rawGameHtml.substring(htmlStart);
        }

        // Post-process with Juice + Audio
        const finalHtml = postProcessRawHtml(rawGameHtml);
        const finalTitle = parentDraft.title.startsWith("Remix of") ? parentDraft.title : "Remix of " + parentDraft.title;

        // Screenshot
        console.log(`📸 Taking screenshot for edit job ${newJobId}...`);
        const sandboxRes = await verifyGame(finalHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [finalTitle, finalHtml, rawGameHtml, finalScreenshot, newJobId]
        );
        console.log(`✅ [EDIT JOB] Finished! Saved to DB for job ${newJobId}`);

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
        
        // If background worker failed, it saved 'ERROR: ...' in the title
        if (row.title && row.title.startsWith('ERROR:')) {
            return res.json({ status: 'error', error: row.title.replace('ERROR: ', '') });
        }
        
        // If html_payload is still empty, the background worker is still running
        if (!row.html_payload || row.html_payload === '') {
            return res.json({ status: 'pending' });
        }
        
        // Done! Return the payload
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

        // Phase 1: Quantize (Gemma — FREE)
        const phase1 = buildPhase1_Quantize(prompt);
        const specSheet = await callAI(phase1.system, phase1.user, 1500, 0.5);
        console.log(`✅ Labs Phase 1: "${specSheet.title}"`);

        // Phase 2: Build (Qwen)
        console.log(`🔨 Labs: Qwen 3.6 building game...`);
        const buildPrompt = buildPhase2_BuildPrototype(specSheet);
        const qwenRes = await openRouterClient.chat.completions.create({
            model: 'qwen/qwen3.6-plus-preview:free',
            max_tokens: 8000,
            temperature: 0.3,
            messages: [
                { role: "system", content: "You are an expert game developer." },
                { role: "user", content: buildPrompt }
            ]
        });

        let rawGameHtml = qwenRes.choices[0].message.content;
        rawGameHtml = rawGameHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
        if (!rawGameHtml.trim().toLowerCase().startsWith('<!doctype')) {
            const htmlStart = rawGameHtml.indexOf('<!');
            if (htmlStart > 0) rawGameHtml = rawGameHtml.substring(htmlStart);
        }

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
