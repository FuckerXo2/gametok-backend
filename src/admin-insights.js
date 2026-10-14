// Read-only numbers for the admin site (games.gametok.co/admin): players, sign-ups, views, plays,
// time played, games, developers and a live activity feed. Mounted under /api/admin, so
// requireAdmin guards every route (the admin key, or a signed-in account with users.is_admin).
//
// Definitions used throughout:
//   player  = a distinct person who played: an account (user_id) or, without one, a device (client_id)
//   view    = a game shown on screen (game_views)
//   session = a game opened and played (game_sessions); duration_seconds is time played
//   plays   = the per-game counter, which counts a replay within 30 minutes once
//   owner   = games.developer holds the owner's user id, or on older rows their username
import express from 'express';
import pool from './db.js';

const router = express.Router();
const PLAYER = `COALESCE(user_id::text, 'device:' || client_id)`;
const clampDays = (v, def = 30) => Math.min(Math.max(parseInt(v, 10) || def, 1), 365);
const clampInt = (v, def, max) => Math.min(Math.max(parseInt(v, 10) || def, 0), max);

router.get('/overview', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const windows = [['today', `date_trunc('day', NOW() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'`], ['d7', `NOW() - INTERVAL '7 days'`], ['d30', `NOW() - INTERVAL '30 days'`]];
    const kpis = {};
    for (const [key, since] of windows) {
      const r = await pool.query(`SELECT
          (SELECT COUNT(DISTINCT ${PLAYER}) FROM game_sessions WHERE started_at >= ${since}) AS players,
          (SELECT COUNT(*) FROM game_sessions WHERE started_at >= ${since}) AS sessions,
          (SELECT COUNT(*) FROM game_views WHERE created_at >= ${since}) AS views,
          (SELECT COUNT(DISTINCT ${PLAYER}) FROM game_views WHERE created_at >= ${since}) AS viewers,
          (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions WHERE started_at >= ${since}) AS seconds_played,
          (SELECT ROUND(AVG(duration_seconds)) FROM game_sessions WHERE started_at >= ${since} AND duration_seconds > 0) AS avg_session_seconds,
          (SELECT COUNT(*) FROM users WHERE created_at >= ${since}) AS signups,
          (SELECT COUNT(*) FROM games WHERE (status IS NULL OR status = 'published') AND created_at >= ${since}) AS games_published`);
      kpis[key] = Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, v === null ? null : Number(v)]));
    }
    const totals = (await pool.query(`SELECT
        (SELECT COUNT(*) FROM users) AS accounts,
        (SELECT COUNT(*) FROM games WHERE status IS NULL OR status = 'published') AS live_games,
        (SELECT COUNT(*) FROM games WHERE status = 'draft') AS drafts,
        (SELECT COUNT(*) FROM users WHERE developer_agreement_accepted_at IS NOT NULL) AS developers,
        (SELECT COUNT(*) FROM (SELECT token FROM push_tokens UNION SELECT token FROM anonymous_push_tokens) t) AS push_devices,
        (SELECT COALESCE(SUM(plays), 0) FROM games) AS plays_counter`)).rows[0];
    // One row per Lagos day: views, sessions, players, time played, sign-ups.
    const series = (await pool.query(`
      WITH d AS (SELECT generate_series((NOW() AT TIME ZONE 'Africa/Lagos')::date - ($1::int - 1), (NOW() AT TIME ZONE 'Africa/Lagos')::date, '1 day')::date AS day)
      SELECT d.day,
        (SELECT COUNT(*) FROM game_views v WHERE (v.created_at AT TIME ZONE 'Africa/Lagos')::date = d.day) AS views,
        (SELECT COUNT(*) FROM game_sessions s WHERE (s.started_at AT TIME ZONE 'Africa/Lagos')::date = d.day) AS sessions,
        (SELECT COUNT(DISTINCT ${PLAYER}) FROM game_sessions s WHERE (s.started_at AT TIME ZONE 'Africa/Lagos')::date = d.day) AS players,
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions s WHERE (s.started_at AT TIME ZONE 'Africa/Lagos')::date = d.day) AS seconds_played,
        (SELECT COUNT(*) FROM users u WHERE (u.created_at AT TIME ZONE 'Africa/Lagos')::date = d.day) AS signups
      FROM d ORDER BY d.day`, [days])).rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10), views: +r.views, sessions: +r.sessions, players: +r.players, secondsPlayed: +r.seconds_played, signups: +r.signups,
    }));
    res.json({ kpis, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])), series, days });
  } catch (err) {
    console.error('[AdminInsights] overview:', err.message);
    res.status(500).json({ error: 'Could not load overview' });
  }
});

router.get('/games', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const r = await pool.query(`
      SELECT g.id, g.name, g.status, g.thumbnail, g.created_at, g.platform, g.orientation, g.plays, g.like_count, g.save_count,
             u.username AS creator,
             (SELECT COUNT(*) FROM game_views v WHERE v.game_id = g.id AND v.created_at >= NOW() - make_interval(days => $1)) AS views,
             (SELECT COUNT(*) FROM game_sessions s WHERE s.game_id = g.id AND s.started_at >= NOW() - make_interval(days => $1)) AS sessions,
             (SELECT COUNT(DISTINCT ${PLAYER}) FROM game_sessions s WHERE s.game_id = g.id AND s.started_at >= NOW() - make_interval(days => $1)) AS players,
             (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions s WHERE s.game_id = g.id AND s.started_at >= NOW() - make_interval(days => $1)) AS seconds_played,
             (SELECT ROUND(AVG(duration_seconds)) FROM game_sessions s WHERE s.game_id = g.id AND s.duration_seconds > 0 AND s.started_at >= NOW() - make_interval(days => $1)) AS avg_session_seconds,
             (SELECT MAX(started_at) FROM game_sessions s WHERE s.game_id = g.id) AS last_played_at
        FROM games g
        LEFT JOIN users u ON u.id::text = g.developer OR (u.username IS NOT NULL AND u.username = g.developer)
       ORDER BY sessions DESC, g.created_at DESC`, [days]);
    res.json({ days, games: r.rows.map((g) => ({
      ...g, views: +g.views, sessions: +g.sessions, players: +g.players, seconds_played: +g.seconds_played,
      avg_session_seconds: g.avg_session_seconds === null ? null : +g.avg_session_seconds,
    })) });
  } catch (err) {
    console.error('[AdminInsights] games:', err.message);
    res.status(500).json({ error: 'Could not load games' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = clampInt(req.query.limit, 50, 200);
    const offset = clampInt(req.query.offset, 0, 100000);
    const params = [limit, offset];
    // Search matches username, email or display name; $n is the search parameter's position.
    const search = (n) => (q ? `WHERE u.username ILIKE $${n} OR u.email ILIKE $${n} OR u.display_name ILIKE $${n}` : '');
    if (q) params.push(`%${q}%`);
    const where = search(3);
    const r = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.email, u.avatar, u.oauth_provider, u.created_at,
             u.developer_agreement_accepted_at IS NOT NULL AS developer,
             (SELECT COUNT(*) FROM game_sessions s WHERE s.user_id = u.id) AS sessions,
             (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions s WHERE s.user_id = u.id) AS seconds_played,
             (SELECT COUNT(DISTINCT game_id) FROM game_sessions s WHERE s.user_id = u.id) AS games_played,
             (SELECT MAX(started_at) FROM game_sessions s WHERE s.user_id = u.id) AS last_played_at,
             (SELECT COUNT(*) FROM games g WHERE g.developer = u.id::text OR g.developer = u.username) AS games_published,
             EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id) AS push_enabled
        FROM users u ${where}
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`, params);
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM users u ${search(1)}`, q ? [`%${q}%`] : [])).rows[0].n;
    res.json({ total, users: r.rows.map((u) => ({ ...u, sessions: +u.sessions, seconds_played: +u.seconds_played, games_played: +u.games_played, games_published: +u.games_published })) });
  } catch (err) {
    console.error('[AdminInsights] users:', err.message);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'User not found' });
    const user = (await pool.query(`SELECT id, username, display_name, email, avatar, oauth_provider, created_at, developer_agreement_accepted_at FROM users WHERE id = $1`, [req.params.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const games = (await pool.query(`
      SELECT s.game_id, g.name, COUNT(*)::int AS sessions, COALESCE(SUM(s.duration_seconds), 0)::int AS seconds_played, MAX(s.started_at) AS last_played_at
        FROM game_sessions s LEFT JOIN games g ON g.id = s.game_id
       WHERE s.user_id = $1 GROUP BY s.game_id, g.name ORDER BY last_played_at DESC LIMIT 100`, [req.params.id])).rows;
    const published = (await pool.query(`SELECT id, name, status, created_at FROM games WHERE developer = $1 OR developer = $2 ORDER BY created_at DESC`, [req.params.id, user.username || ''])).rows;
    const searches = (await pool.query(`SELECT query, created_at FROM search_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]).catch(() => ({ rows: [] }))).rows;
    res.json({ user, games, published, searches });
  } catch (err) {
    console.error('[AdminInsights] user:', err.message);
    res.status(500).json({ error: 'Could not load user' });
  }
});

// Newest first: sign-ups, play sessions, games published or updated.
router.get('/activity', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 60, 200);
    const r = await pool.query(`
      (SELECT 'signup' AS kind, u.created_at AS at, u.id::text AS user_id, COALESCE(u.username, u.display_name, u.email) AS who, NULL AS game_id, NULL AS game, u.oauth_provider AS detail, NULL::int AS seconds
         FROM users u ORDER BY u.created_at DESC NULLS LAST LIMIT $1)
      UNION ALL
      (SELECT 'play', s.started_at, s.user_id::text, COALESCE(u.username, CASE WHEN s.client_id IS NOT NULL THEN 'guest ' || RIGHT(s.client_id, 5) END), s.game_id, g.name, s.platform, s.duration_seconds
         FROM game_sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN games g ON g.id = s.game_id
         ORDER BY s.started_at DESC LIMIT $1)
      UNION ALL
      (SELECT 'publish', g.created_at, g.developer, u.username, g.id, g.name, g.status, NULL
         FROM games g LEFT JOIN users u ON u.id::text = g.developer OR (u.username IS NOT NULL AND u.username = g.developer) ORDER BY g.created_at DESC LIMIT $1)
      ORDER BY at DESC NULLS LAST LIMIT $1`, [limit]);
    res.json({ events: r.rows });
  } catch (err) {
    console.error('[AdminInsights] activity:', err.message);
    res.status(500).json({ error: 'Could not load activity' });
  }
});

export default router;
