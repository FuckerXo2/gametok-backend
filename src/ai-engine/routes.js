import express from 'express';
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
            // === ZERO-SHOT TEMPLATE INJECTION ENGINE ===
            let templateCode = "";
            const pt = prompt.toLowerCase();
            if (pt.match(/match|candy|bejeweled|puzzle|swap|grid/i)) {
                templateCode = fs.readFileSync(path.join(__dirname, '../templates/match3.js'), 'utf8');
                console.log("=> Injecting FLAWLESS Match-3 Template");
            } else if (pt.match(/shoot|space|ship|laser|bullet/i)) {
                templateCode = fs.readFileSync(path.join(__dirname, '../templates/shooter.js'), 'utf8');
                console.log("=> Injecting FLAWLESS Shooter Template");
            } else if (pt.match(/run|runner|flappy|jump|dash/i)) {
                templateCode = fs.readFileSync(path.join(__dirname, '../templates/runner.js'), 'utf8');
                console.log("=> Injecting FLAWLESS Runner Template");
            }

            // === ART DIRECTOR AGENT (POLLINATIONS.AI PIPELINE) ===
            console.log("🎨 Art Director Agent: Generating High-Res Assets...");
            const fetchImage = async (imgPrompt) => {
                try {
                    const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(imgPrompt) + "?width=512&height=512&nologo=true&seed=" + Math.floor(Math.random()*100000);
                    const imgRes = await fetch(url);
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    return "data:image/jpeg;base64," + base64;
                } catch(e) { console.error("Art failed:", e); return null; }
            };

            const [bgBase64, spriteBase64] = await Promise.all([
                fetchImage(prompt + ", beautiful 2d mobile game background environment, vertical layout, digital art, no text"),
                fetchImage(prompt + ", single isolated game character sprite, solid black background, vector art style, centered")
            ]);
            console.log("🎨 Art Director Agent: Base64 Payloads Secured.");

            // Build Omni-Engine Prompt with injected Gold Standard Template and Art Assets
            const systemInstruction = buildOmniEnginePrompt(templateCode, bgBase64, spriteBase64);
            
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview", generationConfig: { responseMimeType: "application/json" }});
            
            // === PUPPETEER AUTO-HEALING SANDBOX LOOP ===
            let currentPrompt = [systemInstruction, "User Prompt: " + prompt];
            let finalJson = null;
            let previewHtml = "";
            let generatedSuccessfully = false;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const result = await model.generateContent(currentPrompt);
                    const responseText = result.response.text();
                    
                    let parsedJson;
                    try {
                        parsedJson = JSON.parse(responseText);
                    } catch (e) {
                         const match = responseText.match(/\{[\s\S]*\}/);
                         if (match) parsedJson = JSON.parse(match[0]);
                         else throw new Error("Failed to parse AI JSON response.");
                    }
                    
                    if (parsedJson.code && parsedJson.code.includes('```')) {
                        parsedJson.code = parsedJson.code.replace(/```(?:javascript|js)*\n?/gi, '').replace(/```/g, '');
                    }

                    previewHtml = compileGameHTML(parsedJson, bgBase64, spriteBase64);

                    // 🛑 SANDBOX VERIFICATION
                    const testResult = await verifyGame(previewHtml);
                    
                    if (testResult.success) {
                        finalJson = parsedJson;
                        generatedSuccessfully = true;
                        break; // Flawless payload, exit loop
                    } else {
                        console.log(`❌ Sandbox Crash on Attempt ${attempt}. Orchestrating Auto-Heal...`);
                        currentPrompt = [
                            systemInstruction,
                            "User Prompt: " + prompt,
                            "PREVIOUS GENERATED JSON:",
                            JSON.stringify(parsedJson),
                            "CRASH ERROR IN BROWSER SANDBOX: " + testResult.error,
                            "You MUST fix the Javascript error above. Return the exact same JSON format, but with the 'code' string fully repaired so it does not crash."
                        ];
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
                configParams: finalJson.config, 
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
