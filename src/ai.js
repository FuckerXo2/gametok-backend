import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from './db.js';
import { ASSET_CATALOG } from './assets.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0; let normA = 0; let normB = 0;
    for(let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const router = express.Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

router.post('/dream', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        console.log(`🧠 MULTI-ENGINE AI Orchestrator solving for User[${userId}] -> Concept: "${prompt}"`);

        // ============================================
        // 🚀 PHASE 1: DYNAMIC ASSET RAG
        // ============================================
        let dynamicAssetCatalog = {};
        try {
            const promptEmbedResult = await embedModel.embedContent(prompt);
            const promptVector = promptEmbedResult.embedding.values;

            const { rows } = await pool.query('SELECT name, url, type, tags, vector FROM asset_vectors');
            if (rows.length > 0) {
                const scoredAssets = rows.map(row => {
                    const vec = typeof row.vector === 'string' ? JSON.parse(row.vector) : row.vector; 
                    return { name: row.name, url: row.url, type: row.type, score: cosineSimilarity(promptVector, vec) };
                });
                scoredAssets.sort((a, b) => b.score - a.score);
                const topAssets = scoredAssets.slice(0, 20);
                
                dynamicAssetCatalog = {
                    characters_and_items: topAssets.filter(t => t.type === 'sprite').map(a => ({ name: a.name, url: a.url })),
                    backgrounds: topAssets.filter(t => t.type === 'background').map(a => ({ name: a.name, url: a.url })),
                    particles: topAssets.filter(t => t.type === 'particle').map(a => ({ name: a.name, url: a.url }))
                };
            } else {
                dynamicAssetCatalog = ASSET_CATALOG;
            }
        } catch (e) {
            dynamicAssetCatalog = ASSET_CATALOG;
        }

        // ============================================
        // 🚀 PHASE 2: OMNI-ENGINE SYSTEM PROMPT
        // ============================================
        const systemInstruction = `
You are a God-Tier Master Game Architect. 
Your job is to read the user's game prompt and select the absolute best engine for their request, then write the game.

You MUST return a pure JSON object containing exactly THREE fields:
1. "title": A viral title.
2. "engine": The strictly lowercase string name of the engine you choose. Must be exactly "threejs" or "vanilla".
3. "code": Raw Javascript code executing the game flawlessly within the chosen architecture.

=== ENGINE SELECTION HEURISTICS ===
- Select "threejs" IF: The user wants 3D, perspective cameras, Temple Run, Mario Kart, DOOM (using 2D Sprite Billboards), or deep z-axis spatial movement.
- Select "vanilla" IF: The user wants a 2D Platformer, endless runner, puzzle game, trivia, UI-based text adventure, match-3, Flappy Bird or drawing toy. 

=== CODING ARCHITECTURE RULES per ENGINE ===

--- IF "threejs" ---
- You have global access to THREE. Write raw scene, camera, renderer logic. Bind to 'three-container'.
- For assets, load the provided dictionary 2D URLs as THREE.Sprite materials to simulate DOOM/Retro 3D.
- Create an animate() loop with requestAnimationFrame.

--- IF "vanilla" ---
- Use raw HTML5 Canvas or raw DOM Manipulation inside a global 'game-container' div.
- If drawing images, use: let i = new Image(); i.crossOrigin="anonymous"; i.src="url".
- Write an endless requestAnimationFrame loop computing custom physics logically and natively.

[VERIFIED ASSET DICTIONARY]: ${JSON.stringify(dynamicAssetCatalog, null, 2)}

[GLOBAL AUDIO API]: 
You ALWAYS have window.playSound('jump' | 'coin' | 'explosion' | 'shoot'). Use it heavily!

=== CRITICAL MOBILE & TOUCH CONSTRAINTS ===
- You are building for a MOBILE APP WebView. There is NO keyboard and NO browser refresh button!
- ALL controls MUST use Touch/Pointer events (e.g. window.addEventListener('pointerdown', ...)). If it's a runner, a tap makes them jump or dodge. 
- If the player dies, you MUST build an on-screen "TAP TO PLAY AGAIN" text and manually reset the game variables inside your Javascript loop when tapped! NEVER use location.reload() or tell the user to 'refresh the page' or 'Press R'.

DO NOT wrap your JSON in markdown blocks. Return the pure stringified JSON.
Ensure you always draw floors/grounds so characters don't fall infinitely.
`;
        
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview", generationConfig: { responseMimeType: "application/json" }});
        const result = await model.generateContent([systemInstruction, "User Prompt: " + prompt]);
        const responseText = result.response.text();
        const json = JSON.parse(responseText);
        
        let cleanCode = json.code;
        if(cleanCode.includes('```')) {
            cleanCode = cleanCode.replace(/```(?:javascript|js)*\n?/gi, '').replace(/```/g, '');
        }

        // ============================================
        // 🚀 PHASE 3: DYNAMIC ENGINE HTML INJECTION
        // ============================================
        let engineImports = '';
        let domContainers = '';
        
        if (json.engine === 'threejs') {
            engineImports = `
                <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
                <script>
                    const _originalLoad = THREE.TextureLoader.prototype.load;
                    THREE.TextureLoader.prototype.load = function(url, onLoad, onProgress, onError) {
                        this.setCrossOrigin('anonymous');
                        return _originalLoad.call(this, url, onLoad, onProgress, onError);
                    };
                </script>
            `;
            domContainers = '<div id="three-container" style="width:100vw; height:100vh; display:block;"></div>';
        } else {
            // Vanilla
            domContainers = '<div id="game-container" style="width:100vw; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#1a1a2e;"></div>';
        }

        const previewHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    ${engineImports}
    <style>
        body { margin: 0; padding: 0; background: #000; overflow: hidden; touch-action: none; font-family: sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
        #error-overlay { display: none; position: absolute; z-index: 9999; background: rgba(20,0,0,0.9); color: #ff3366; padding: 20px; width: 100%; height: 100%; box-sizing: border-box; font-family: monospace; overflow-y: auto; text-align: left; }
    </style>
</head>
<body>
    <div id="error-overlay"></div>
    ${domContainers}
    
    <script>
        window.onerror = function(msg, source, lineno, colno, error) {
            var overlay = document.getElementById('error-overlay');
            if (msg === 'Script error.') msg = 'WebGL CORS Blocked or Texture Loader Crash. Check image origins.';
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>" + "${json.engine}".toUpperCase() + " Engine Crash</h3><p>" + msg + "</p><p>Line: " + lineno + "</p><hr>";
            return true;
        };

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.playSound = function(type) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            if(type === 'jump') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1); gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
            else if (type === 'coin') { osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.05); gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
            else if (type === 'explosion') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.2); gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3); osc.start(); osc.stop(audioCtx.currentTime + 0.3); }
            else if (type === 'shoot') { osc.type = 'square'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1); gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
        };
    </script>
    <script>
// RAW GENERATED [${json.engine.toUpperCase()}] ARCHITECTURE LOGIC
${cleanCode}
    </script>
</body>
</html>`;

        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, json.title, previewHtml, cleanCode, true]
        );
        res.json({ success: true, draftId: dbRes.rows[0].id, title: json.title, htmlPreview: previewHtml });
    } catch (error) {
        console.error("AI GENERATION ERROR:", error);
        res.status(500).json({ error: "AI Orchestrator Error: " + (error.message || String(error)) });
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
    // Asset scraping remains unchanged so it provides universal 2D images usable by all APIs
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
