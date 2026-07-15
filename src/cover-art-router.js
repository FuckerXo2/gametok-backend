/**
 * Admin endpoints for AI cover-art generation.
 *
 *   GET  /api/admin/covers/status           — counts of games with/without rich covers
 *   POST /api/admin/covers/regenerate/:id   — regenerate cover for a single game (id = ai_games.id or games.id)
 *   POST /api/admin/covers/backfill         — backfill missing/screenshot covers (body: { limit, onlyMissing })
 */

import express from 'express';
import pool from './db.js';
import { generateAndApplyCover, enqueueCoverGeneration } from './cover-art.js';

const router = express.Router();

function isCoverArtUrl(url) {
    return typeof url === 'string' && url.startsWith('/uploads/covers/');
}

router.get('/status', async (req, res) => {
    try {
        const total = await pool.query("SELECT COUNT(*)::int AS c FROM ai_games WHERE is_draft = FALSE AND (html_payload != '' OR game_url IS NOT NULL)");
        const withCover = await pool.query("SELECT COUNT(*)::int AS c FROM ai_games WHERE is_draft = FALSE AND (html_payload != '' OR game_url IS NOT NULL) AND thumbnail LIKE '/uploads/covers/%'");
        const withScreenshot = await pool.query("SELECT COUNT(*)::int AS c FROM ai_games WHERE is_draft = FALSE AND (html_payload != '' OR game_url IS NOT NULL) AND (thumbnail IS NULL OR thumbnail = '' OR thumbnail NOT LIKE '/uploads/covers/%')");
        res.json({
            ok: true,
            total: total.rows[0].c,
            with_cover_art: withCover.rows[0].c,
            without_cover_art: withScreenshot.rows[0].c,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/regenerate/:id', async (req, res) => {
    try {
        const { id } = req.params;

        let draftRow;
        const direct = await pool.query(
            `SELECT id AS draft_id, title, prompt, thumbnail, category, subcategory, primary_tab, interaction_type, classification_tags, discovery_chips
             FROM ai_games WHERE id = $1`,
            [id]
        );
        if (direct.rows.length > 0) {
            draftRow = direct.rows[0];
        } else {
            const fromGame = await pool.query(
                `SELECT ag.id AS draft_id, ag.title, ag.prompt, ag.thumbnail, ag.category, ag.subcategory, ag.primary_tab, ag.interaction_type, ag.classification_tags, ag.discovery_chips
                 FROM ai_games ag
                 WHERE ('gm-ai-' || substring(ag.id::text, 1, 8)) = $1
                 LIMIT 1`,
                [id]
            );
            if (fromGame.rows.length === 0) {
                return res.status(404).json({ ok: false, error: 'Game not found' });
            }
            draftRow = fromGame.rows[0];
        }

        const draftId = draftRow.draft_id;
        const gameId = `gm-ai-${String(draftId).substring(0, 8)}`;

        const classification = {
            category: draftRow.category,
            subcategory: draftRow.subcategory,
            primaryTab: draftRow.primary_tab,
            interactionType: draftRow.interaction_type,
            tags: Array.isArray(draftRow.classification_tags) ? draftRow.classification_tags : [],
            discoveryChips: Array.isArray(draftRow.discovery_chips) ? draftRow.discovery_chips : [],
        };

        const url = await generateAndApplyCover(pool, {
            draftId,
            gameId,
            title: draftRow.title,
            prompt: draftRow.prompt,
            classification,
        });

        res.json({ ok: true, draftId, gameId, cover_url: url });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/backfill', async (req, res) => {
    try {
        const limit = Math.min(Number(req.body?.limit) || 25, 200);
        const onlyMissing = req.body?.onlyMissing !== false;

        const where = onlyMissing
            ? "WHERE is_draft = FALSE AND (html_payload != '' OR game_url IS NOT NULL) AND (thumbnail IS NULL OR thumbnail = '' OR thumbnail NOT LIKE '/uploads/covers/%')"
            : "WHERE is_draft = FALSE AND (html_payload != '' OR game_url IS NOT NULL)";

        const rows = await pool.query(
            `SELECT id AS draft_id, title, prompt, category, subcategory, primary_tab, interaction_type, classification_tags, discovery_chips
             FROM ai_games
             ${where}
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
        );

        let queued = 0;
        for (const row of rows.rows) {
            enqueueCoverGeneration(pool, {
                draftId: row.draft_id,
                gameId: `gm-ai-${String(row.draft_id).substring(0, 8)}`,
                title: row.title,
                prompt: row.prompt,
                classification: {
                    category: row.category,
                    subcategory: row.subcategory,
                    primaryTab: row.primary_tab,
                    interactionType: row.interaction_type,
                    tags: Array.isArray(row.classification_tags) ? row.classification_tags : [],
                    discoveryChips: Array.isArray(row.discovery_chips) ? row.discovery_chips : [],
                },
            });
            queued += 1;
        }

        res.json({
            ok: true,
            queued,
            note: 'Cover generation runs in the background. Poll /status to track progress.',
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
