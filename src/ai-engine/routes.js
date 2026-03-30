import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pool from '../db.js';
import { buildOmniEnginePrompt } from './prompt.js';
import { compileGameHTML } from './compiler.js';
import { verifyGame } from './sandbox.js';

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
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        
        // === STEP 1: PLANNER AGENT (CLAUDE 3.5 HAIKU) ===
        console.log("🧭 Planner Agent: Classifying prompt & building asset manifest...");
        const plannerSystemPrompt = `You are a game design planner for a Canvas2D mobile game engine. Given a user's game idea, you must:
1. Rewrite the casual prompt into a detailed, technical game design brief covering mechanics, controls, scoring, and visual style.
2. Create an asset manifest for the AI image generator.

ASSET RULES:
- SMART ART DIRECTOR: If the prompt involves living things, physical objects, locations, or organic characters (no matter how weird), you MUST generate 2 to 5 image assets. If the prompt is strictly a retro geometric game or simple physics (Pong, Tetris, bouncing lines), you MAY return an empty array [] for pure Canvas rendering.
- 2D ENFORCEMENT: ALL requested images MUST strictly be 2D video game assets. You must append phrases like "2D flat vector game art, clean illustration, strictly 2D" or "2D 16-bit pixel art" to EVERY image prompt so the AI absolutely never creates mismatched 3D or photorealistic images.
- ISOLATED SPRITES: Character/object sprites MUST request a "solid black background, isolated centered subject" so the engine can extract them.
- BACKGROUNDS: MUST request "vertical mobile game background, 2D art" (512x768).`;

        let enhancedPrompt = prompt;
        let manifest;
        
        try {
            const plannerRes = await anthropic.messages.create({
                model: "claude-3-5-haiku-20241022",
                max_tokens: 2000,
                system: plannerSystemPrompt,
                messages: [{ role: "user", content: `User prompt: "${prompt}"` }],
                tools: [{
                    name: "plan_game",
                    description: "Classify game type, rewrite prompt, and create asset manifest.",
                    input_schema: {
                        type: "object",
                        properties: {
                            technicalPrompt: { type: "string" },
                            mechanics: { type: "string" },
                            assets: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        key: { type: "string" },
                                        prompt: { type: "string" },
                                        width: { type: "integer" },
                                        height: { type: "integer" }
                                    },
                                    required: ["key", "prompt", "width", "height"]
                                }
                            }
                        },
                        required: ["technicalPrompt", "mechanics", "assets"]
                    }
                }],
                tool_choice: { type: "tool", name: "plan_game" }
            });
            
            const toolBlock = plannerRes.content.find(c => c.type === 'tool_use');
            const plannerJson = toolBlock ? toolBlock.input : JSON.parse(extractJson(plannerRes.content[0].text));
            enhancedPrompt = plannerJson.technicalPrompt || prompt;
            manifest = { mechanics: plannerJson.mechanics || enhancedPrompt, assets: plannerJson.assets || [] };
        } catch(e) {
            console.error("Planner failed, falling back", e.message);
            manifest = { mechanics: prompt, assets: [] }; // Fallback to 0 assets to avoid hang on error
        }

        // === STEP 2: ART DIRECTOR (AI HORDE) ===
        console.log(`🎨 Fetching ${manifest.assets.length} Assets...`);
        const fetchImage = async (assetObj) => {
            try {
                const safePrompt = encodeURIComponent(assetObj.prompt);
                const w = assetObj.width || 512;
                const h = assetObj.height || 512;
                const seed = Math.floor(Math.random() * 1000000);
                const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
                
                const imgRes = await fetch(url);
                if (!imgRes.ok) return null;
                
                const arrayBuffer = await imgRes.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');
                return "data:image/jpeg;base64," + base64;
            } catch(e) { return null; }
        };

        const assetPromises = manifest.assets.map(a => fetchImage(a));
        const base64Results = await Promise.all(assetPromises);
        let assetMap = {};
        manifest.assets.forEach((a, i) => { if (base64Results[i]) assetMap[a.key] = base64Results[i]; });

        // === STEP 3: CODER AGENT (CLAUDE OPUS) ===
        const systemInstruction = buildOmniEnginePrompt(assetMap, manifest);
        let messages = [{ role: "user", content: "CREATE THIS GAME:\n" + prompt }];
        
        console.log(`🤖 Coder Agent Generating Game Logic...`);
        const codeRes = await anthropic.messages.create({
            model: "claude-opus-4-6", // Retaining user's Opus model alias
            max_tokens: 8192,
            system: systemInstruction,
            messages: messages
        });
        
        const responseText = codeRes.content[0].text;
        const codeMatch = responseText.match(/```(?:javascript|js)*\n([\s\S]*?)```/i);
        let rawCode = codeMatch ? codeMatch[1].trim() : responseText.trim();
        if (rawCode.includes('\`\`\`')) {
            rawCode = rawCode.replace(/\`\`\`(?:javascript|js)*\n?/gi, '').replace(/\`\`\`/g, '');
        }

        if (!rawCode || rawCode.length < 50) {
            throw new Error("AI failed to output a complete javascript block.");
        }

        const parsedJson = {
            title: "DreamStream Game",
            engine: "canvas2d",
            settings: {},
            code: rawCode
        };

        const previewHtml = compileGameHTML(parsedJson, assetMap);

        // Test in sandbox and capture screenshot
        console.log(`📸 Taking screenshot for job ${jobId}...`);
        const sandboxRes = await verifyGame(previewHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // Update Job as COMPLETE
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [parsedJson.title || "DreamStream Game", previewHtml, rawCode, finalScreenshot, jobId]
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
                content: `You are a master game developer. Below is the existing HTML5 Canvas Javascript code for a game:\n\n\`\`\`javascript\n${oldCode}\n\`\`\`\n\nApply the following modifications/instructions requested by the user: "${instructions}".\n\nReturn the ENTIRE updated JavaScript code inside a single \`\`\`javascript block. Do not truncate or omit any unchanged parts. Preserve the existing variable structures.` 
            }
        ];

        const codeRes = await anthropic.messages.create({
            model: "claude-opus-4-6",
            max_tokens: 8192,
            system: systemInstruction,
            messages: messages
        });
        
        const responseText = codeRes.content[0].text;
        const codeMatch = responseText.match(/```(?:javascript|js)*\n([\s\S]*?)```/i);
        let rawCode = codeMatch ? codeMatch[1].trim() : responseText.trim();
        if (rawCode.includes('\`\`\`')) {
            rawCode = rawCode.replace(/\`\`\`(?:javascript|js)*\n?/gi, '').replace(/\`\`\`/g, '');
        }

        if (!rawCode || rawCode.length < 50) {
            throw new Error("AI failed to output a complete javascript block during edit.");
        }

        const parsedJson = {
            title: parentDraft.title.startsWith("Remix of") ? parentDraft.title : "Remix of " + parentDraft.title,
            engine: "canvas2d",
            settings: {},
            code: rawCode
        };

        const previewHtml = compileGameHTML(parsedJson, assetMap);

        // Test in sandbox and capture screenshot
        console.log(`📸 Taking screenshot for edit job ${newJobId}...`);
        const sandboxRes = await verifyGame(previewHtml);
        const finalScreenshot = sandboxRes.screenshot || null;

        // Update Job as COMPLETE
        await pool.query(
            `UPDATE ai_games SET title = $1, html_payload = $2, raw_code = $3, thumbnail = $4 WHERE id = $5`,
            [parsedJson.title, previewHtml, rawCode, finalScreenshot, newJobId]
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
        
        console.log(`🖼️ Fetching blazing fast image from Pollinations: ${prompt}`);
        const imgRes = await fetch(url);
        
        if (!imgRes.ok) {
            return res.status(500).json({ error: "Failed to generate image. Try again." });
        }
        
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return res.json({ success: true, base64: "data:image/jpeg;base64," + base64 });
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

export default router;
