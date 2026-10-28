// The AI game maker was removed (2026-10-28). All that's left: playing the few AI-made games already published
// (their games.embed_url is /api/ai/play/<id>).
import express from 'express';
import pool from './db.js';

const router = express.Router();

const GT_PAUSE_SNIPPET = `<script>(function(){var paused=false;var queue=[];var originalRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=function(cb){if(paused){queue.push(cb);return -1;}return originalRAF(cb);};function setAudioMuted(m){document.querySelectorAll('audio,video').forEach(function(el){el.muted=m;if(m&&!el.paused)el.pause();});}window.addEventListener('message',function(e){if(!e.data||typeof e.data!=='object')return;if(e.data.type==='gt-pause'){paused=true;setAudioMuted(true);}if(e.data.type==='gt-resume'){if(!paused)return;paused=false;setAudioMuted(false);var q=queue.slice();queue.length=0;q.forEach(function(cb){try{originalRAF(cb);}catch(_){}});}});})();</script>`;

router.get('/play/:targetId', async (req, res) => {
    try {
        const game = await pool.query("SELECT html_payload, game_url FROM ai_games WHERE id::text LIKE $1 LIMIT 1", [req.params.targetId + '%']);
        if (game.rows.length === 0) return res.status(404).send("AI Game Block Missing / Erased");
        
        const row = game.rows[0];
        if (row.game_url) {
            return res.redirect(302, row.game_url);
        }

        res.setHeader('Content-Type', 'text/html');
        let html = row.html_payload;
        if (html.includes('<head>')) html = html.replace('<head>', '<head>' + GT_PAUSE_SNIPPET);
        else if (html.includes('<body>')) html = html.replace('<body>', '<body>' + GT_PAUSE_SNIPPET);
        else html = GT_PAUSE_SNIPPET + html;
        res.send(html);
    } catch(e) { res.status(500).send("Database extraction failed"); }
});

export default router;
