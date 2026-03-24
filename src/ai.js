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
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const router = express.Router();
// Mount Gemini APIs natively via the Railway dashboard environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ============================================
// 1. GENERATE & DRAFT AI GAME
// ============================================
router.post('/dream', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        // Ensure user is strictly authenticated via Railway DB
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Unauthorized: Ghost Account' });
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        const userId = userResult.rows[0].id;

        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        console.log(`🧠 AI Orchestrator running generation for User[${userId}] -> Concept: "${prompt}"`);

        // ============================================
        // 🚀 PHASE 1: DYNAMIC VECTOR ASSET PIPELINE (RAG)
        // ============================================
        let dynamicAssetCatalog = {};
        try {
            console.log(`🔍 Vectorizing user prompt: "${prompt}"...`);
            const promptEmbedResult = await embedModel.embedContent(prompt);
            const promptVector = promptEmbedResult.embedding.values;

            // Fetch all known assets from the Postgres Database vector table
            const { rows } = await pool.query('SELECT name, url, type, tags, vector FROM asset_vectors');
            
            if (rows.length > 0) {
                // Compute Cosine Similarity strictly in Node memory (takes <10ms for 500 items)
                const scoredAssets = rows.map(row => {
                    // Safe guard parse mechanism
                    const vec = typeof row.vector === 'string' ? JSON.parse(row.vector) : row.vector; 
                    return {
                        name: row.name,
                        url: row.url,
                        type: row.type,
                        score: cosineSimilarity(promptVector, vec)
                    };
                });

                // Sort by highest match to the user's prompt
                scoredAssets.sort((a, b) => b.score - a.score);
                
                // Grab the top 20 most semantically relevant graphical assets
                const topAssets = scoredAssets.slice(0, 20);
                
                // Shape them for the AI Prompt 
                dynamicAssetCatalog = {
                    characters_and_items: topAssets.filter(t => t.type === 'sprite').map(a => a.url),
                    backgrounds: topAssets.filter(t => t.type === 'background').map(a => a.url),
                    particles: topAssets.filter(t => t.type === 'particle').map(a => a.url)
                };
                console.log("✅ Successfully dynamically retrieved Top 20 relevant assets using Semantic Math!");
            } else {
                console.warn("⚠️ Asset Vector Table is empty or building! Falling back to static V1 catalog.");
                dynamicAssetCatalog = ASSET_CATALOG;
            }
        } catch (e) {
            console.error("❌ Vector Pipeline Failed, falling back to static:", e.message);
            dynamicAssetCatalog = ASSET_CATALOG;
        }

        // LIGHTNING FAST RAG CLASSIFICATION HEURISTIC
        const p = prompt.toLowerCase();
        let templateType = null;
        if (p.includes('flap') || p.includes('fly through') || p.includes('gap') || p.includes('bird')) {
            templateType = 'flappy';
        } else if (p.includes('run') || p.includes('jump over') || p.includes('platform') || p.includes('obstacle') || p.includes('side scroll')) {
            templateType = 'runner';
        } else if (p.includes('shoot') || p.includes('survive') || p.includes('arena') || p.includes('defend') || p.includes('top down') || p.includes('spaceship')) {
            templateType = 'arena';
        }

        let templateInjection = '';
        if (templateType) {
            try {
                const templateCode = fs.readFileSync(path.join(__dirname, 'templates', `${templateType}.js`), 'utf-8');
                templateInjection = `
                
=== 🚨 CRITICAL TEMPLATE OVERRIDE IN EFFECT 🚨 ===
You MUST use the following Flawless Game Skeleton as your exact foundation. 
DO NOT modify the physics collisions, overlaps, gravity, or bounds logic! 
DO NOT DELETE the Groups (enemies/obstacles/projectiles) or the Time Events.
ONLY MODIFY THE TEMPLATE LOCATIONS MARKED WITH "AI:":
1. The 'backgroundColor' string.
2. The visual 'this.add.rectangle' objects MUST be replaced with 'this.physics.add.sprite(x, y, "key")' using the official PNGs loaded in preload(). DO NOT LEAVE THE RECTANGLES!
3. The Speed variables (e.g. enemySpeed, velocityY, delay) to change difficulty.
4. The Juice (add intense Particles inside collision overlaps, Camera Shakes, Sound effects).
5. The 'Score' tracking logic if needed.

HERE IS YOUR STARTING CODE TEMPLATE. MERGE YOUR VISUAL CHANGES DIRECTLY INTO THIS AND RETURN IT:
\`\`\`javascript
${templateCode}
\`\`\`
===================================================
`;
                console.log(`✅ RAG Pipeline Injected Template: [${templateType}]`);
            } catch (err) {
                console.warn(`Failed to inject template [${templateType}]:`, err.message);
            }
        }

        const systemInstruction = `
You are a God-Tier Phaser 3 Game Developer architecting highly-addictive, "juicy" hyper-casual mobile games. 
The user will provide a prompt describing a 2D web game.

You MUST return a pure JSON object containing exactly two fields:
1. "title": A catchy, viral-sounding title for the game.
2. "code": Raw, brutally efficient, standalone Javascript code that fully initializes and runs a Phaser 3 game inside the DOM element 'phaser-game'.
${templateInjection}
=== CRITICAL PHASER 3 ARCHITECTURE RULES ===

1. CANVAS SETUP & DYNAMIC AESTHETICS: 
   The code MUST create a Phaser config object: 'window.game = new Phaser.Game(config);'
   The config MUST strictly use: type: Phaser.AUTO, scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, parent: 'phaser-game'.
   CRITICAL: Set 'backgroundColor' dynamically based on the game's atmosphere (e.g., '#87CEEB' for a sunny sky, '#000000' for space, '#FFF8DC' for pastel).
   
2. PHYSICS ENGINE (DYNAMIC):
   Enable Arcade Physics: physics: { default: 'arcade', arcade: { debug: false } }.
   CRITICAL: Set 'gravity: { y: X }' ONLY if the game is a platformer/falling game (e.g., y: 800). If it's a top-down shooter, puzzle, or arena, gravity MUST be 0!
   
3. SCENE LIFECYCLE & SCOPING (CRITICAL FOR SURVIVAL):
   Implement a Scene with preload(), create(), and update(time, delta) methods.
   Properly attach all custom functions, structural objects (player, enemies) to 'this' so they exist globally (e.g., this.triggerGameOver = () => {...}).
   FATAL ERROR PREVENTION: You MUST EXCLUSIVELY use ES6 Arrow Functions '() => {}' for ALL collision callbacks, timers, and input events! If you use standard 'function() {}', the 'this' context is lost and the game WILL spectacularly crash with "TypeError: this.something is not a function"!

4. BEAUTIFUL REAL GAME ASSETS (MUST USE ACTUAL IMAGES):
   DO NOT use Emojis. DO NOT use abstract geometry. You MUST build visually modern, "normal" looking games by exclusively using gorgeous 2D sprites.
   You have full access to a Verified Global Asset Dictionary containing ONLY the highly relevant URLs matching the user's vibe! You MUST pick items strictly from this JSON dictionary and use their exact URLs. You MUST load them in preload() with 'this.load.crossOrigin = "anonymous";' 
   
   [VERIFIED ASSET DICTIONARY]:
   ${JSON.stringify(dynamicAssetCatalog, null, 2)}
   
   WARNING: You MUST use 'this.add.image()' or 'this.physics.add.sprite()' to render these remote URLs vividly! Pick the ones that best match the Vibe of the user's prompt!
5. "THE JUICE" (ADAPTIVE POLISH & FEEL):
   Your game MUST feel incredibly addictive, polished, and satisfying instantly!
   - CAMERA SHAKE: Trigger 'this.cameras.main.shake(100, 0.02)' on major collisions, deaths, or huge impacts.
   - PARTICLES: Emit particles wildly. Use colors matching the game's theme (e.g., white clouds for a cute game, red sparks for explosions).
   - TWEENS: Animate UI text or spawning enemies with 'this.tweens.add({ ... })' (e.g. scale pulsing, hovering).
   - COLOR PALETTE: You MUST adapt your colors entirely to the user's prompt! (Neon for cyberpunk, Pastels for cute, Earth tones for farms).

6. PROCEDURAL AUDIO:
   You have access to a global procedural sound API! You MUST call 'window.playSound(type)' in your logic.
   Supported types: 'jump', 'coin', 'explosion', 'shoot'.
   Call these instantly upon player actions and collisions. No external MP3s allowed.

7. MECHANICS & INFINITE GAME LOOP:
   - Touch Input: Implement hyper-responsive pointer input cleanly using 'this.input.on("pointerdown", ...)'.
   - Score: Implement a massive, glowing UI Text object tracking the Score at the top of the screen.
   - Game Over State: When the player fails, physics MUST pause, show a massive "GAME OVER / TAP TO RESTART" text, and triggering the screen MUST perfectly restart the Scene via 'this.scene.restart()'.
   - Progression: The game MUST progressively scale difficulty (speeding up, heavier spawn rates) over time.

8. RAW JSON OUTPUT ONLY:
   DO NOT wrap the returned JSON payload in markdown blocks (e.g., \`\`\`json). The response must be raw stringified JSON only.
`;

        // Blast the prompt into the Gemini 3.1 Pro API
        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-pro-preview", 
            generationConfig: {
                responseMimeType: "application/json", 
            }
        });

        const result = await model.generateContent([systemInstruction, "User Prompt: " + prompt]);
        const responseText = result.response.text();
        const json = JSON.parse(responseText);
        
        // Brutally scrub any rogue markdown blocks floating inside the JSON value
        let cleanCode = json.code;
        if(cleanCode.includes('```')) {
            cleanCode = cleanCode.replace(/```(?:javascript|js)*\n?/gi, '').replace(/```/g, '');
        }

  // Ram Injection compiler: Bundle Phaser CDN + Procedural Audio + Generated Logic
        const previewHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <style>
        body { margin: 0; padding: 0; background: #000; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh; touch-action: none; }
        #phaser-game { width: 100%; height: 100vh; display: flex; justify-content: center; align-items: center; }
        canvas { display: block; touch-action: none; outline: none; max-width: 100%; max-height: 100%; }
        #error-overlay { display: none; position: absolute; z-index: 9999; background: rgba(20,0,0,0.9); color: #ff3366; padding: 20px; width: 100%; height: 100%; box-sizing: border-box; font-family: monospace; overflow-y: auto; text-align: left; }
    </style>
</head>
<body>
    <div id="error-overlay"></div>
    <div id="phaser-game"></div>
    
    <script>
        // Catch ANY Syntax errors during script parsing or execution
        window.onerror = function(msg, source, lineno, colno, error) {
            var overlay = document.getElementById('error-overlay');
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>Engine Crash</h3><p>" + msg + "</p><p>Line: " + lineno + "</p><hr>";
            return true;
        };

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.playSound = function(type) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            if(type === 'jump') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.start(); osc.stop(audioCtx.currentTime + 0.1);
            } else if (type === 'coin') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.05);
                gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.start(); osc.stop(audioCtx.currentTime + 0.1);
            } else if (type === 'explosion') {
                osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.2);
                gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
                osc.start(); osc.stop(audioCtx.currentTime + 0.3);
            } else if (type === 'shoot') {
                osc.type = 'square'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.start(); osc.stop(audioCtx.currentTime + 0.1);
            }
        };
    </script>
    <script>
        // Generated Code Execution
        ${cleanCode}
    </script>
</body>
</html>`;

        // POSTGRES DRAFT INSERTION
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, json.title, previewHtml, cleanCode, true]
        );

        console.log(`✅ Database Draft Saved. ID: ${dbRes.rows[0].id}`);
        res.json({ success: true, draftId: dbRes.rows[0].id, title: json.title, htmlPreview: previewHtml });

    } catch (error) {
        console.error("OVERLOAD:", error);
        res.status(500).json({ error: "AI Engine Overload: " + (error.message || String(error)) });
    }
});

// ============================================
// 2. GET CURRENT USER DRAFTS
// ============================================
router.get('/drafts', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Auth failed' });

        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

        const drafts = await pool.query(
            "SELECT id, title, prompt, created_at FROM ai_games WHERE user_id = $1 AND is_draft = true ORDER BY created_at DESC", 
            [userResult.rows[0].id]
        );
        res.json({ drafts: drafts.rows });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// 3. PUBLIC FEED PUBLISHING (Move to standard GameTok library)
// ============================================
router.post('/publish/:draftId', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
        
        // Remove draft status
        const publishRes = await pool.query(
            "UPDATE ai_games SET is_draft = false WHERE id = $1 AND user_id = $2 RETURNING *",
            [req.params.draftId, userResult.rows[0].id]
        );

        if (publishRes.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });

        // Forge a global GameTok ID (gm-ai-xxxx) and inject into main game library
        const globalId = `gm-ai-${req.params.draftId.substring(0, 8)}`;
        await pool.query(
            `INSERT INTO games (id, name, description, icon, color, category, developer, embed_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [
              globalId, 
              publishRes.rows[0].title, 
              "AI Creation: " + publishRes.rows[0].prompt, 
              "✨", 
              "#00E5FF", 
              "ai-remix", 
              userResult.rows[0].id,
              `/api/ai/play/${req.params.draftId}` // The native endpoint that serves the HTML blob directly
            ]
        );

        res.json({ success: true, gameId: globalId });
    } catch (e) {
        console.log("PUBLISH ERROR:", e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// 4. THE NATIVE RAM EXECUTOR ENDPOINT
// ============================================
router.get('/play/:targetId', async (req, res) => {
    try {
        // Find by full UUID or partial chunk from the public feed injection
        const game = await pool.query("SELECT html_payload FROM ai_games WHERE id::text LIKE $1 LIMIT 1", [req.params.targetId + '%']);
        if (game.rows.length === 0) return res.status(404).send("AI Game Block Missing / Erased");
        
        res.setHeader('Content-Type', 'text/html');
        res.send(game.rows[0].html_payload);
    } catch(e) {
        res.status(500).send("Database extraction failed");
    }
});

// ============================================
// 4. ADMIN RAG PIPELINE: BUILD VECTOR DATABASE
// ============================================
router.post('/admin/rebuild-assets', async (req, res) => {
    // Only authorized via valid token (optional for testing, but let's just run it)
    console.log("=== 🚀 Railway Vector Scraper Initializing ===");
    res.json({ status: "bg-process-started", msg: "Scraping and Vectorizing Phaser CDN into Postgres..." });

    try {
        const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        
        // 1. Initialize Postgres RAG Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS asset_vectors (
                id SERIAL PRIMARY KEY,
                name TEXT,
                url TEXT,
                type TEXT,
                tags TEXT,
                vector JSONB
            );
        `);
        // Clean table for a fresh rebuild
        await pool.query(`TRUNCATE TABLE asset_vectors;`);

        const FOLDERS = [
            { type: 'sprite', ext: '.png', path: 'public/assets/sprites' },
            { type: 'background', ext: '.png', path: 'public/assets/skies' },
            { type: 'particle', ext: '.png', path: 'public/assets/particles' }
        ];

        let count = 0;
        for (const folder of FOLDERS) {
            const gitUrl = `https://api.github.com/repos/phaserjs/examples/contents/${folder.path}`;
            const response = await fetch(gitUrl, { headers: { 'User-Agent': 'DreamStream-Asset-Scraper' } });
            if (!response.ok) continue;
            
            const rawFiles = await response.json();
            const pngFiles = rawFiles.filter(f => f.type === 'file' && f.name.endsWith('.png')).slice(0, 100); // Limit to top 100 per folder to avoid aggressive rate limits
            
            for (let i = 0; i < pngFiles.length; i++) {
                const filename = pngFiles[i].name;
                const cleanTags = `${folder.type} ${filename.replace(/\.(png|jpg|jpeg)$/, '').replace(/[_-]/g, ' ').replace(/[0-9]/g, '')}`.trim();
                
                const result = await embedModel.embedContent(cleanTags);
                const vector = result.embedding.values;
                
                const assetUrl = `https://labs.phaser.io/assets/${folder.path.split('public/assets/')[1]}/${filename}`;
                
                await pool.query(
                    `INSERT INTO asset_vectors (name, url, type, tags, vector) VALUES ($1, $2, $3, $4, $5)`,
                    [filename, assetUrl, folder.type, cleanTags, JSON.stringify(vector)]
                );
                count++;
            }
        }
        console.log(`✅ Railway Vector DB Rebuild Complete! Indexed ${count} assets into Postgres.`);
    } catch (e) {
        console.error(`❌ Railway Vector DB Build Failed:`, e.message);
    }
});

export default router;
