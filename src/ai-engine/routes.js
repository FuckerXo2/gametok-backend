import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pool from '../db.js';
import { getDynamicAssetCatalog } from './rag.js';
import { buildOmniEnginePrompt } from './prompt.js';
import { compileGameHTML } from './compiler.js';
import { verifyGame } from './sandbox.js';

const router = express.Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/dream', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        console.log(`🧠 [PEAK ARCHITECTURE] Orchestrator solving for User[${userId}] -> Concept: "${prompt}"`);

        // Write headers immediately to start response and bypass initial proxy timeouts
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked'
        });

        // Send a whitespace heartbeat every 15 seconds to keep the Railway connection alive
        const heartbeat = setInterval(() => {
            res.write(' ');
        }, 15000);

        try {
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            
            // === STEP 1: ROUTER AGENT (CLAUDE 3.5 HAIKU) ===
            console.log("🧭 Router Agent: Classifying prompt...");
            const routerPrompt = `You are a game design classifier. Given a user's game idea:
1. Pick the BEST matching template: "match3", "shooter", "runner", or "none" (if it doesn't fit any).
2. Rewrite the casual prompt into a detailed, technical game design brief.

Return pure JSON: {"template": "match3"|"shooter"|"runner"|"none", "technicalPrompt": "...detailed rewrite..."}
User prompt: "${prompt.replace(/"/g, '\\"')}"`;

            let templateCode = "";
            let enhancedPrompt = prompt;
            
            try {
                const routerRes = await anthropic.messages.create({
                    model: "claude-3-5-haiku-20241022",
                    max_tokens: 1000,
                    messages: [{ role: "user", content: routerPrompt }]
                });
                
                const txt = routerRes.content[0].text;
                const match = txt.match(/\{[\s\S]*\}/);
                const routerJson = JSON.parse(match ? match[0] : txt);
                console.log("🧭 Router Agent Decision: template=" + routerJson.template);
                
                enhancedPrompt = routerJson.technicalPrompt || prompt;
                
                const templateMap = {
                    "match3": '../templates/match3.js',
                    "shooter": '../templates/shooter.js',
                    "runner": '../templates/runner.js'
                };
                
                if (routerJson.template && templateMap[routerJson.template]) {
                    templateCode = fs.readFileSync(path.join(__dirname, templateMap[routerJson.template]), 'utf8');
                    console.log("=> Injecting FLAWLESS " + routerJson.template + " Template");
                }
            } catch(e) {
                console.error("Router failed, falling back to regex", e.message);
                const pt = prompt.toLowerCase();
                if (pt.match(/match|candy|bejeweled/i)) templateCode = fs.readFileSync(path.join(__dirname, '../templates/match3.js'), 'utf8');
                else if (pt.match(/shoot|space/i)) templateCode = fs.readFileSync(path.join(__dirname, '../templates/shooter.js'), 'utf8');
                else if (pt.match(/run|flappy/i)) templateCode = fs.readFileSync(path.join(__dirname, '../templates/runner.js'), 'utf8');
            }

            // === STEP 2: DIRECTOR AGENT (CLAUDE 3.5 SONNET) ===
            console.log("🎬 Director Agent: Building Asset Manifest...");
            const directorPrompt = `You are a Game Art Director. Based on this technical brief, create an asset manifest.
Output pure JSON matching this schema:
{
    "mechanics": "Summary of mechanics and visual style...",
    "assets": [
        { "key": "bg", "prompt": "background image, vertical layout, digital art", "width": 512, "height": 768 },
        { "key": "player", "prompt": "isolated character sprite, solid black background", "width": 512, "height": 512 }
    ]
}
RULES: 
- Provide AT LEAST 2 assets, MAXIMUM 5 assets.
- Character sprites MUST have a solid black background.
- Backgrounds MUST be vertical layout (512x768).

User Brief: "${enhancedPrompt.replace(/"/g, '\\"')}"`;

            let manifest;
            try {
                const dirRes = await anthropic.messages.create({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: 1500,
                    messages: [{ role: "user", content: directorPrompt }]
                });
                const txt = dirRes.content[0].text;
                const match = txt.match(/\{[\s\S]*\}/);
                manifest = JSON.parse(match ? match[0] : txt);
            } catch(e) {
                console.error("Director failed, falling back", e.message);
                manifest = {
                    mechanics: enhancedPrompt,
                    assets: [
                        { key: 'bg', prompt: prompt + " background, vertical mobile", width: 512, height: 768 },
                        { key: 'player', prompt: prompt + " sprite, isolated, solid black background", width: 512, height: 512 }
                    ]
                };
            }

            // === STEP 3: ART DIRECTOR (AI HORDE) ===
            console.log(`🎨 Art Director: Fetching ${manifest.assets.length} Assets in Parallel layer...`);
            
            const fetchImage = async (assetObj) => {
                try {
                    const submitRes = await fetch("https://aihorde.net/api/v2/generate/async", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': '0000000000' },
                        body: JSON.stringify({
                            prompt: assetObj.prompt,
                            params: { width: assetObj.width, height: assetObj.height, steps: 20 },
                            nsfw: false, censor_nsfw: true, r2: true
                        })
                    });
                    if (!submitRes.ok) return null;
                    const submitData = await submitRes.json();
                    const jobId = submitData.id;
                    if (!jobId) return null;

                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 3000));
                        const checkRes = await fetch("https://aihorde.net/api/v2/generate/check/" + jobId);
                        const checkData = await checkRes.json();
                        if (checkData.done) break;
                    }

                    const statusRes = await fetch("https://aihorde.net/api/v2/generate/status/" + jobId);
                    const statusData = await statusRes.json();
                    if (statusData.generations && statusData.generations.length > 0) {
                        const imgUrl = statusData.generations[0].img;
                        const imgRes = await fetch(imgUrl);
                        if (!imgRes.ok) return null;
                        const arrayBuffer = await imgRes.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        return "data:image/webp;base64," + base64;
                    }
                    return null;
                } catch(e) { console.error("Art Error:", e.message); return null; }
            };

            const assetPromises = manifest.assets.map(a => fetchImage(a));
            const base64Results = await Promise.all(assetPromises);
            
            let assetMap = {};
            manifest.assets.forEach((a, i) => {
                if (base64Results[i]) assetMap[a.key] = base64Results[i];
            });
            console.log("🎨 Loaded Assets:", Object.keys(assetMap).join(', '));

            // === STEP 4: CODER AGENT (CLAUDE 3.5 SONNET) ===
            const systemInstruction = buildOmniEnginePrompt(templateCode, assetMap, manifest);
            
            let messages = [
                { role: "user", content: systemInstruction + "\n\nCREATE THIS GAME:\n" + prompt }
            ];
            
            let finalJson = null;
            let previewHtml = "";
            let generatedSuccessfully = false;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`🤖 Coder Agent (Claude 3.5): Generating Game Logic (Attempt ${attempt})...`);
                    const codeRes = await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 8192,
                        messages: messages
                    });
                    
                    const responseText = codeRes.content[0].text;
                    
                    if (messages.length > 1) messages.pop(); 
                    
                    let parsedJson;
                    try {
                        const match = responseText.match(/\{[\s\S]*\}/);
                        parsedJson = JSON.parse(match ? match[0] : responseText);
                    } catch (e) { throw new Error("Failed to parse Claude JSON response. Raw output: " + responseText.substring(0, 100)); }
                    
                    if (parsedJson.code && parsedJson.code.includes('```')) {
                        parsedJson.code = parsedJson.code.replace(/```(?:javascript|js)*\n?/gi, '').replace(/```/g, '');
                    }

                    previewHtml = compileGameHTML(parsedJson, assetMap);

                    const testResult = await verifyGame(previewHtml);
                    
                    if (testResult.success) {
                        finalJson = parsedJson;
                        generatedSuccessfully = true;
                        break;
                    } else {
                        console.log(`❌ Sandbox Crash on Attempt ${attempt}. Orchestrating Auto-Heal...`);
                        messages.push({
                            role: "assistant",
                            content: responseText
                        });
                        messages.push({
                            role: "user",
                            content: "YOUR PREVIOUS CODE CRASHED THE BROWSER. \n\nERROR: " + testResult.error + "\n\nFix the JS error above and return the exact same JSON format with repaired code."
                        });
                    }
                } catch (apiErr) {
                    console.error(`⚠️ Attempt ${attempt}/3 failed:`, apiErr.message);
                    if (attempt === 3) throw apiErr;
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }

            if (!generatedSuccessfully || !finalJson) {
                throw new Error("Engine failed to resolve crash state after 3 Auto-Heal cycles.");
            }

            // 4. Save to Database
            const dbRes = await pool.query(
                `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [userId, prompt, finalJson.title, previewHtml, finalJson.code, true]
            );

            clearInterval(heartbeat);
            res.write(JSON.stringify({ 
                success: true, 
                draftId: dbRes.rows[0].id, 
                title: finalJson.title, 
                configParams: finalJson.settings, 
                htmlPreview: previewHtml 
            }));
            res.end();
        } catch (error) {
            clearInterval(heartbeat);
            console.error("AI GENERATION ERROR:", error);
            res.write(JSON.stringify({ error: "AI Orchestrator Error: " + (error.message || String(error)) }));
            res.end();
        }
    } catch (outerError) {
        console.error("OUTER GENERATION ERROR:", outerError);
        if (!res.headersSent) {
            res.status(500).json({ error: "System Error" });
        } else {
            res.write(JSON.stringify({ error: "System Error" }));
            res.end();
        }
    }
});

router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
        const drafts = await pool.query("SELECT id, title, prompt, created_at FROM ai_games WHERE user_id = $1 AND is_draft = true ORDER BY created_at DESC", [userResult.rows[0].id]);
        res.json({ drafts: drafts.rows });
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
            `INSERT INTO games (id, name, description, icon, color, category, developer, embed_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [globalId, publishRes.rows[0].title, "Multi-Engine AI Creation: " + publishRes.rows[0].prompt, "✨", "#00E5FF", "ai-remix", userResult.rows[0].id, `/api/ai/play/${req.params.draftId}`]
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

router.post('/admin/rebuild-assets', async (req, res) => {
    res.json({ status: "bg-process-started", msg: "Scraping Omni-Engine assets into Postgres Vector DB..." });
    try {
        const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        await pool.query(`CREATE TABLE IF NOT EXISTS asset_vectors (id SERIAL PRIMARY KEY, name TEXT, url TEXT, type TEXT, tags TEXT, vector JSONB);`);
        await pool.query(`TRUNCATE TABLE asset_vectors;`);
        const FOLDERS = [
            { type: 'sprite', ext: '.png', path: 'public/assets/sprites' },
            { type: 'background', ext: '.png', path: 'public/assets/skies' },
            { type: 'particle', ext: '.png', path: 'public/assets/particles' }
        ];
        for (const folder of FOLDERS) {
            const response = await fetch(`https://api.github.com/repos/phaserjs/examples/contents/${folder.path}`, { headers: { 'User-Agent': 'DreamStream-Asset-Scraper' } });
            if (!response.ok) continue;
            const rawFiles = await response.json();
            const pngFiles = rawFiles.filter(f => f.type === 'file' && f.name.endsWith('.png')).slice(0, 100);
            for (let i = 0; i < pngFiles.length; i++) {
                const filename = pngFiles[i].name;
                const cleanTags = `${folder.type} ${filename.replace(/\.(png|jpg|jpeg)$/, '').replace(/[_-]/g, ' ').replace(/[0-9]/g, '')}`.trim();
                const result = await embedModel.embedContent(cleanTags);
                const assetUrl = `https://labs.phaser.io/assets/${folder.path.split('public/assets/')[1]}/${filename}`;
                await pool.query(`INSERT INTO asset_vectors (name, url, type, tags, vector) VALUES ($1, $2, $3, $4, $5)`, [filename, assetUrl, folder.type, cleanTags, JSON.stringify(result.embedding.values)]);
            }
        }
    } catch (e) { console.error(e); }
});

export default router;
