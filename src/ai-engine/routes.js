import express from 'express';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pool from '../db.js';
import { buildOmniEnginePrompt, injectTemplate } from './prompt.js';
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

// Background Worker to keep Railway from timing out
async function executeDreamJob(jobId, prompt, userId) {
    try {
        console.log(`🧠 [BACKGROUND JOB] Started Dream... Job: ${jobId}`);

        // === TEMPLATE ROUTER & MODDER AGENT ===
        const systemInstruction = buildOmniEnginePrompt({}, { mechanics: prompt });
        
        console.log(`🤖 AI Modder: Selecting Template & Config...`);
        const res = await nvidiaClient.chat.completions.create({
            model: "google/gemma-4-31b-it",
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: "CREATE THIS GAME:\n" + prompt }
            ],
            max_tokens: 2000,
            temperature: 0.2
        });
        
        const rawOutput = res.choices[0].message.content;
        const aiJsonStr = extractJson(rawOutput);
        const aiJson = JSON.parse(aiJsonStr);
        
        console.log(`✅ Selected Template: ${aiJson.selectedTemplateId}`);

        // === ASSET GENERATION ===
        let assetMap = {};
        if (aiJson.neededAssets && Object.keys(aiJson.neededAssets).length > 0) {
            console.log(`🎨 Resolving ${Object.keys(aiJson.neededAssets).length} Assets...`);
            const resolveAsset = async (key, assetDef) => {
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
                    // Fallthrough to AI if Kenney fails
                }

                const fallbackEmoji = { HERO: "🦸‍♂️", ENEMY: "👾", BACKGROUND: "", WEAPON: "⚔️", COLLECTIBLE: "💎", OBSTACLE: "🧱" }[key] || "📦";
                const errSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text y="80" font-size="80">${fallbackEmoji}</text></svg>`;
                const fallbackUrl = fallbackEmoji ? `data:image/svg+xml;utf8,${encodeURIComponent(errSvg)}` : "";

                // AI generation via Pollinations
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 12000);
                    const imgPrompt = `2D game asset, clean vector style, flat colors, isolated on solid black background: ${value}`;
                    const imgRes = await fetch("https://image.pollinations.ai/", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: imgPrompt,
                            width: 512,
                            height: 512,
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
                } catch(e) { 
                    console.log(`Fallback for ${key} triggered due to Pollinations failing.`);
                    return fallbackUrl; 
                }
            };
            
            const keys = Object.keys(aiJson.neededAssets);
            const fallbackResults = await Promise.all(keys.map(k => resolveAsset(k, aiJson.neededAssets[k])));
            keys.forEach((k, i) => { if (fallbackResults[i]) assetMap[k] = fallbackResults[i]; });
        }

        // === TEMPLATE INJECTION ===
        console.log(`🔧 Injecting JSON config into template...`);
        const previewHtml = injectTemplate(aiJson.selectedTemplateId, aiJson.config, assetMap);

        // Test in sandbox and capture screenshot
        console.log(`📸 Taking screenshot for job ${jobId}...`);
        const sandboxRes = await verifyGame(previewHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        const rawCode = JSON.stringify(aiJson, null, 2);

        // Update Job as COMPLETE
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [aiJson.config.GAMEOVER_TITLE || "DreamStream Game", previewHtml, rawCode, finalScreenshot, jobId]
        );
        console.log(`✅ [BACKGROUND JOB] Finished! Saved to DB for job ${jobId}`);

    } catch (err) {
        console.error("❌ [BACKGROUND JOB] Error:", err);
        // Save Error string to title so frontend can detect it
        await pool.query(
            `UPDATE ai_games SET title = $1 WHERE id = $2`,
            ['ERROR: ' + (err.message || "Engine Generation Error"), jobId]
        );
    }
}

async function executeEditJob(newJobId, parentDraftId, instructions, userId, newAsset) {
    try {
        console.log(`🚀 [EDIT JOB] Starting remix job ${newJobId} based on parent ${parentDraftId}`);
        // 1. Fetch parent draft
        const parentRes = await pool.query('SELECT raw_code, html_payload, title FROM ai_games WHERE id = $1', [parentDraftId]);
        if (parentRes.rows.length === 0) throw new Error("Parent draft not found.");
        
        const parentDraft = parentRes.rows[0];
        const oldCode = parentDraft.raw_code;
        
        // Extract existing assets if any so we don't lose the images
        let assetMap = {};
        const assetMatch = parentDraft.html_payload.match(/window\.EXTERNAL_ASSETS\s*=\s*(\{.*?\});/);
        if (assetMatch) {
            try { assetMap = JSON.parse(assetMatch[1]); } catch(e){}
        }
        
        // Inject the newly generated user asset into the context
        if (newAsset && newAsset.key && newAsset.base64) {
            assetMap[newAsset.key] = newAsset.base64;
            console.log(`Injecting new custom asset: ${newAsset.key}`);
        }

        // 2. Call Claude Coder directly to modify the code
        console.log(`🤖 Coder Agent Editing Game Logic...`);
        const systemInstruction = buildOmniEnginePrompt(assetMap, {}); // Reuse standard engine limits
        
        let messages = [
            { 
                role: "user", 
                content: `You are an AI game configurator. Below is the existing JSON configuration of the game:\n\n${oldCode}\n\nApply the following modifications/instructions requested by the user: "${instructions}".\n\nReturn the ENTIRE updated JSON object.` 
            }
        ];

        const stream = await nvidiaClient.chat.completions.create({
            model: "google/gemma-4-31b-it",
            messages: [
                { role: "system", content: systemInstruction },
                ...messages
            ],
            max_tokens: 8192,
            temperature: 0.7,
            stream: true,
        });
        
        let responseText = "";
        for await (const chunk of stream) {
            responseText += chunk.choices[0]?.delta?.content || "";
        }
        
        const aiJsonStr = extractJson(responseText);
        const aiJson = JSON.parse(aiJsonStr);
        const rawCode = JSON.stringify(aiJson, null, 2);
        const previewHtml = injectTemplate(aiJson.selectedTemplateId, aiJson.config, assetMap);
        const finalTitle = parentDraft.title.startsWith("Remix of") ? parentDraft.title : "Remix of " + parentDraft.title;

        // Test in sandbox and capture screenshot
        console.log(`📸 Taking screenshot for edit job ${newJobId}...`);
        const sandboxRes = await verifyGame(previewHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // Update Job as COMPLETE
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [finalTitle, previewHtml, rawCode, finalScreenshot, newJobId]
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


const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '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',
});

async function executeLabsDreamJob(jobId, prompt, userId) {
    try {
        console.log(`🧪 [LABS JOB] Started Gemma 4 Dream... Job: ${jobId}`);
        
        
        // === STEP 1: PLANNER AGENT (GEMMA 4 31B) ===
        console.log("🧭 Labs Planner Agent: Classifying prompt & building asset manifest using Gemma 4...");
        const plannerSystemPrompt = `You are a game design planner for a Canvas2D mobile game engine. Given a user's game idea, you must:
1. Rewrite the casual prompt into a detailed, technical game design brief covering mechanics, controls, scoring, and visual style.
2. Create an asset manifest for the AI image generator.

ASSET RULES:
- SMART ART DIRECTOR: If the prompt involves living things, physical objects, locations, or organic characters (no matter how weird), you MUST generate 2 to 5 image assets. If the prompt is strictly a retro geometric game or simple physics (Pong, Tetris, bouncing lines), you MAY return an empty array [] for pure Canvas rendering.
- 2D ENFORCEMENT: ALL requested images MUST strictly be 2D video game assets. You must append phrases like "2D flat vector game art, clean illustration, strictly 2D" or "2D 16-bit pixel art" to EVERY image prompt so the AI absolutely never creates mismatched 3D or photorealistic images.
- ISOLATED SPRITES: Character/object sprites MUST request a "solid black background, isolated centered subject" so the engine can extract them.
- BACKGROUNDS: MUST request "vertical mobile game background, 2D art" (512x768).

OUTPUT FORMAT:
You MUST output a raw JSON object and nothing else. Ensure properties matching: { "technicalPrompt": "...", "mechanics": "...", "assets": [ { "key": "uniqueId", "prompt": "...", "width": 512, "height": 512 } ] }`;

        let enhancedPrompt = prompt;
        let manifest;
        
        try {
            const plannerRes = await nvidiaClient.chat.completions.create({
                model: "google/gemma-4-31b-it",
                messages: [
                    { role: "system", content: plannerSystemPrompt },
                    { role: "user", content: `User prompt: "${prompt}"\n\nReturn pure JSON.` }
                ],
                max_tokens: 3000,
                temperature: 0.5
            });
            
            const rawOutput = plannerRes.choices[0].message.content;
            console.log(`🧭 Planner output size: ${rawOutput.length} chars`);
            const plannerJson = JSON.parse(extractJson(rawOutput));
            
            enhancedPrompt = plannerJson.technicalPrompt || prompt;
            manifest = { mechanics: plannerJson.mechanics || enhancedPrompt, assets: plannerJson.assets || [] };
        } catch(e) {
            console.error("Labs Planner failed, falling back", e.message);
            manifest = { mechanics: prompt, assets: [] }; // Fallback
        }


        // === STEP 2: ART DIRECTOR (Dictionary Search → Pollinations Fallback) ===
        console.log(`🎨 Labs resolving ${manifest.assets.length} Assets via Dictionary + Fallback...`);
        let assetMap = {};
        const unresolvedAssets = [];

        for (const assetObj of manifest.assets) {
            const dictResults = searchAssets(assetObj.prompt || assetObj.key, 1);
            if (dictResults.length > 0) {
                assetMap[assetObj.key] = dictResults[0].url;
                console.log(`📚 Dictionary hit: '${assetObj.key}' → ${dictResults[0].label}`);
            } else {
                unresolvedAssets.push(assetObj);
            }
        }

        if (unresolvedAssets.length > 0) {
            console.log(`🎨 ${unresolvedAssets.length} unresolved, falling back to Pollinations...`);
            const fetchImage = async (assetObj) => {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 12000);
                    const imgRes = await fetch("https://image.pollinations.ai/", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: assetObj.prompt,
                            width: assetObj.width || 512,
                            height: assetObj.height || 512,
                            model: "flux",
                            seed: Math.floor(Math.random() * 1000000)
                        }),
                        signal: controller.signal
                    });
                    clearTimeout(timeout);
                    if (!imgRes.ok) return null;
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    return "data:image/jpeg;base64," + base64;
                } catch(e) { return null; }
            };
            const fallbackResults = await Promise.all(unresolvedAssets.map(a => fetchImage(a)));
            unresolvedAssets.forEach((a, i) => { if (fallbackResults[i]) assetMap[a.key] = fallbackResults[i]; });
        } else {
            console.log(`✅ All ${manifest.assets.length} assets resolved from dictionary!`);
        }

        // === STEP 3: CODER AGENT (GEMMA 4) ===
        const systemInstruction = buildOmniEnginePrompt(assetMap, manifest);
        
        console.log(`🧪 Gemma 4 31B Generating Game Logic with manifest...`);
        const stream = await nvidiaClient.chat.completions.create({
            model: "google/gemma-4-31b-it",
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: "CREATE THIS GAME:\n" + enhancedPrompt }
            ],
            max_tokens: 8192,
            temperature: 0.7,
            top_p: 0.95,
            stream: true,
        });
        
        let responseText = "";
        for await (const chunk of stream) {
            responseText += chunk.choices[0]?.delta?.content || "";
        }
        console.log(`🧪 Gemma 4 response length: ${responseText.length} chars`);

        const aiJsonStr = extractJson(responseText);
        const aiJson = JSON.parse(aiJsonStr);
        const rawCode = JSON.stringify(aiJson, null, 2);
        const previewHtml = injectTemplate(aiJson.selectedTemplateId, aiJson.config, assetMap);
        const finalTitle = "🧪 " + (aiJson.config.GAMEOVER_TITLE || "Labs Game");

        // Test in sandbox and capture screenshot
        console.log(`📸 Taking screenshot for Labs job ${jobId}...`);
        const sandboxRes = await verifyGame(previewHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // Update Job as COMPLETE
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [finalTitle, previewHtml, rawCode, finalScreenshot, jobId]
        );
        console.log(`✅ [LABS JOB] Gemma 4 finished! Saved to DB for job ${jobId}`);

    } catch (err) {
        console.error("❌ [LABS JOB] Gemma 4 Error:", err);
        await pool.query(
            `UPDATE ai_games SET title = $1 WHERE id = $2`,
            ['ERROR: ' + (err.message || "Gemma 4 Labs Error"), jobId]
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
