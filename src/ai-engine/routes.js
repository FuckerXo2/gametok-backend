import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from '../db.js';
import { getDynamicAssetCatalog } from './rag.js';
import { buildOmniEnginePrompt } from './prompt.js';
import { compileGameHTML } from './compiler.js';

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

        // 1. RAG Dynamic Asset Retrieval
        const dynamicAssetCatalog = await getDynamicAssetCatalog(prompt);

        // 2. Build Omni-Engine Prompt with Rezona Live Config features
        const systemInstruction = buildOmniEnginePrompt(dynamicAssetCatalog);
        
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview", generationConfig: { responseMimeType: "application/json" }});
        const result = await model.generateContent([systemInstruction, "User Prompt: " + prompt]);
        const responseText = result.response.text();
        const json = JSON.parse(responseText);
        
        if (json.code.includes('\`\`\`')) {
            json.code = json.code.replace(/\`\`\`(?:javascript|js)*\n?/gi, '').replace(/\`\`\`/g, '');
        }

        // 3. Compile HTML Payload
        const previewHtml = compileGameHTML(json);

        // 4. Save to Database
        const dbRes = await pool.query(
            `INSERT INTO ai_games (user_id, prompt, title, html_payload, raw_code, is_draft)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [userId, prompt, json.title, previewHtml, json.code, true]
        );

        res.json({ 
            success: true, 
            draftId: dbRes.rows[0].id, 
            title: json.title, 
            configParams: json.config, // Exposed to frontend for UI Sliders!
            htmlPreview: previewHtml 
        });
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
        const globalId = \`gm-ai-\${req.params.draftId.substring(0, 8)}\`;
        await pool.query(
            \`INSERT INTO games (id, name, description, icon, color, category, developer, embed_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING\`,
            [globalId, publishRes.rows[0].title, "Multi-Engine AI Creation: " + publishRes.rows[0].prompt, "✨", "#00E5FF", "ai-remix", userResult.rows[0].id, \`/api/ai/play/\${req.params.draftId}\`]
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
        await pool.query(\`CREATE TABLE IF NOT EXISTS asset_vectors (id SERIAL PRIMARY KEY, name TEXT, url TEXT, type TEXT, tags TEXT, vector JSONB);\`);
        await pool.query(\`TRUNCATE TABLE asset_vectors;\`);
        const FOLDERS = [
            { type: 'sprite', ext: '.png', path: 'public/assets/sprites' },
            { type: 'background', ext: '.png', path: 'public/assets/skies' },
            { type: 'particle', ext: '.png', path: 'public/assets/particles' }
        ];
        for (const folder of FOLDERS) {
            const response = await fetch(\`https://api.github.com/repos/phaserjs/examples/contents/\${folder.path}\`, { headers: { 'User-Agent': 'DreamStream-Asset-Scraper' } });
            if (!response.ok) continue;
            const rawFiles = await response.json();
            const pngFiles = rawFiles.filter(f => f.type === 'file' && f.name.endsWith('.png')).slice(0, 100);
            for (let i = 0; i < pngFiles.length; i++) {
                const filename = pngFiles[i].name;
                const cleanTags = \`\${folder.type} \${filename.replace(/\\.(png|jpg|jpeg)$/, '').replace(/[_-]/g, ' ').replace(/[0-9]/g, '')}\`.trim();
                const result = await embedModel.embedContent(cleanTags);
                const assetUrl = \`https://labs.phaser.io/assets/\${folder.path.split('public/assets/')[1]}/\${filename}\`;
                await pool.query(\`INSERT INTO asset_vectors (name, url, type, tags, vector) VALUES ($1, $2, $3, $4, $5)\`, [filename, assetUrl, folder.type, cleanTags, JSON.stringify(result.embedding.values)]);
            }
        }
    } catch (e) { console.error(e); }
});

export default router;
