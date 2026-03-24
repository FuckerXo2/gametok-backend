import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from './db.js';

const router = express.Router();
// Mount Gemini API natively via the Railway dashboard environment variable
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

        const systemInstruction = `
You are a God-Tier Phaser 3 Game Developer architecting highly-addictive, "juicy" hyper-casual mobile games. 
The user will provide a prompt describing a 2D web game.

You MUST return a pure JSON object containing exactly two fields:
1. "title": A catchy, viral-sounding title for the game.
2. "code": Raw, brutally efficient, standalone Javascript code that fully initializes and runs a Phaser 3 game inside the DOM element 'phaser-game'.

=== CRITICAL PHASER 3 ARCHITECTURE RULES ===

1. CANVAS SETUP: 
   The code MUST create a Phaser config object and instantiate it: 'window.game = new Phaser.Game(config);'
   The config MUST strictly use: type: Phaser.AUTO, scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, parent: 'phaser-game', backgroundColor: '#0A0A0C'.
   
2. PHYSICS ENGINE:
   Enable Arcade Physics in the config MUST HAVE: physics: { default: 'arcade', arcade: { gravity: { y: 800 }, debug: false } }.
   
3. SCENE LIFECYCLE:
   Implement a Scene with preload(), create(), and update(time, delta) methods.
   Properly scope all structural objects (player, enemies, score) to 'this' so they update correctly.

4. GRAPHICS & ENTITIES (MANDATORY CONSTRAINT):
   Since you CANNOT load remote images, you MUST use Phaser Graphics (rectangles, circles, paths) OR High-Res Text GameObjects (Emojis) for absolutely every single entity!
   Example: this.add.text(x, y, '👾', { fontSize: '56px' }).setOrigin(0.5);

5. "THE JUICE" (MANDATORY GAME FEEL):
   Your game MUST feel incredibly addictive, polished, and satisfying instantly!
   - CAMERA SHAKE: Trigger 'this.cameras.main.shake(100, 0.02)' on major collisions, deaths, or giant points!
   - PARTICLES: Use 'this.add.particles' to emit wildly colored squares or circles when objects explode, bounce, or die.
   - TWEENS: Animate UI text or spawning enemies with 'this.tweens.add({ ... })' (e.g. scale pulsing).
   - NEON PALETTES: Strictly utilize gorgeous neon hex colors (#FF0055, #00E5FF, #FFD700, #B026FF) on lines/shapes.

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

export default router;
