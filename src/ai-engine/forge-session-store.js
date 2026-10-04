import pool from '../db.js';

export const forgeSessionsCache = new Map();

/**
 * Persist or update a forge session in memory and PostgreSQL.
 */
export async function saveForgeSession(sessionId, data) {
    if (!sessionId) return;
    const existing = forgeSessionsCache.get(sessionId) || {};
    const updated = { ...existing, ...data, updatedAt: Date.now() };

    if (Array.isArray(updated.visualDirections) && updated.visualDirections.length >= 4 && updated.visualDirections.every(d => Boolean(d?.imageUrl))) {
        updated.isDirectionsReady = true;
    }
    if (Array.isArray(updated.perspectives) && updated.perspectives.length >= 4 && updated.perspectives.every(p => Boolean(p?.imageUrl))) {
        updated.isPerspectivesReady = true;
    }
    forgeSessionsCache.set(sessionId, updated);

    try {
        await pool.query(`
            INSERT INTO forge_sessions (id, user_id, prompt, game_title, journey_view, visual_directions, selected_direction, perspectives, selected_perspective, step, phase, status_message, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, NOW())
            ON CONFLICT (id) DO UPDATE SET
                journey_view = EXCLUDED.journey_view,
                visual_directions = COALESCE(EXCLUDED.visual_directions, forge_sessions.visual_directions),
                selected_direction = COALESCE(EXCLUDED.selected_direction, forge_sessions.selected_direction),
                perspectives = COALESCE(EXCLUDED.perspectives, forge_sessions.perspectives),
                selected_perspective = COALESCE(EXCLUDED.selected_perspective, forge_sessions.selected_perspective),
                step = COALESCE(EXCLUDED.step, forge_sessions.step),
                phase = COALESCE(EXCLUDED.phase, forge_sessions.phase),
                status_message = COALESCE(EXCLUDED.status_message, forge_sessions.status_message),
                updated_at = NOW();
        `, [
            sessionId,
            updated.userId || null,
            updated.prompt || null,
            updated.gameTitle || null,
            updated.journeyView || 'understanding',
            JSON.stringify(updated.visualDirections || []),
            updated.selectedDirection ? JSON.stringify(updated.selectedDirection) : null,
            JSON.stringify(updated.perspectives || []),
            updated.selectedPerspective ? JSON.stringify(updated.selectedPerspective) : null,
            typeof updated.step === 'number' ? updated.step : 0,
            updated.phase || null,
            updated.statusMessage || null,
        ]);
    } catch (e) {
        console.warn('[Forge Sessions DB] Write error:', e.message);
    }
}

/**
 * Retrieve a forge session from memory cache or database.
 */
export async function getForgeSession(sessionId) {
    if (!sessionId) return null;
    if (forgeSessionsCache.has(sessionId)) {
        return forgeSessionsCache.get(sessionId);
    }
    try {
        const result = await pool.query('SELECT * FROM forge_sessions WHERE id = $1', [sessionId]);
        if (result.rows.length > 0) {
            const row = result.rows[0];
            const visualDirs = Array.isArray(row.visual_directions) ? row.visual_directions : [];
            const perspectives = Array.isArray(row.perspectives) ? row.perspectives : [];
            const isDirectionsReady = visualDirs.length >= 4 && visualDirs.every(d => Boolean(d?.imageUrl));
            const isPerspectivesReady = perspectives.length >= 4 && perspectives.every(p => Boolean(p?.imageUrl));

            const session = {
                sessionId: row.id,
                userId: row.user_id,
                prompt: row.prompt,
                gameTitle: row.game_title,
                journeyView: row.journey_view,
                visualDirections: visualDirs,
                selectedDirection: row.selected_direction,
                perspectives: perspectives,
                selectedPerspective: row.selected_perspective,
                isDirectionsReady,
                isPerspectivesReady,
                step: row.step ?? 0,
                phase: row.phase || null,
                statusMessage: row.status_message || null,
                updatedAt: new Date(row.updated_at).getTime(),
            };
            forgeSessionsCache.set(sessionId, session);
            return session;
        }
    } catch (e) {
        console.warn('[Forge Sessions DB] Read error:', e.message);
    }
    return null;
}
