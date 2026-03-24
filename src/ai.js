import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from './db.js';

const router = express.Router();
// Mount Gemini API using existing env pipeline
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const systemInstruction = `
You are an expert Phaser 3 Game Developer. 
The user will provide a prompt describing a 2D web game.
You must return a JSON object with two fields:
1. "title": A catchy dramatic title.
2. "code": Raw, completely self-contained Javascript code that initializes a Phaser 3 game inside the DOM element with id 'phaser-game'.

--- PHASER 3 ARCHITECTURE RULES ---
- The code MUST create a Phaser config object and instantiate: 'window.game = new Phaser.Game(config);'
- The config should use Phaser.AUTO, width: window.innerWidth, height: window.innerHeight, parent: 'phaser-game'.
- Enable Arcade Physics: physics: { default: 'arcade', arcade: { gravity: { y: 300 }, debug: false } }.
- Implement a Scene with preload(), create(), and update() methods.
- ASSETS: Since you cannot load remote images securely, you MUST use Phaser Graphics (rectangles, circles, lines) OR use Text GameObjects (Emojis) for entities!
- Make the game juicy! Add particle emitters, tweens, colors, and camera shake if appropriate. 
- AUDIO: You have access to a global procedural sound API! You MUST call 'window.playSound(type)' where type is 'jump', 'coin', 'explosion', or 'shoot' when the player acts or collides!
- Ensure pointer/touch input is cleanly implemented using 'this.input.on'.
- Write incredibly robust object collision. Use physics Groups for enemies.
- DO NOT wrap the code in markdown blocks. Just raw text in the JSON field.
`;

        const result = await model.generateContent([systemInstruction, "User Prompt: " + prompt]);
        const responseText = result.response.text();
        const json = JSON.parse(responseText);

        // Ram Injection compiler: Bundle Phaser CDN + Procedural Audio + Generated Logic
        const previewHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <style>
        body { margin: 0; padding: 0; background: #000; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh; touch-action: none; }
        canvas { display: block; touch-action: none; outline: none; }
    </style>
</head>
<body>
    <div id="phaser-game"></div>
    <script>
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

        try {
            \${json.code}
        } catch(e) {
            document.body.innerHTML = '<div style="color:#00e5ff; font-family:sans-serif; text-align:center; padding:20px;"><h3>Engine Render Failure</h3><p>' + e.message + '</p></div>';
        }
    </script>
</body>
</html>`;

        // POSTGRES DRAFT INSERTION
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, json.title, previewHtml, json.code, true]
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

export default router;
