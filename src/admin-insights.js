// Numbers for the admin site (games.gametok.co/admin). Mounted under /api/admin, so requireAdmin
// guards every route (the admin key, or a signed-in account with users.is_admin).
//
// Definitions used throughout:
//   person    = an account, or a device for someone without one (a guest who later signs up
//               counts as two). Accounts flagged users.is_internal (team, studio, test) are left
//               out unless ?internal=1.
//   active    = played a game or had one on screen that day (Lagos time)
//   new       = active for the first time ever that day
//   retention = of the people new on a day, the share active again exactly N days later
//   plays     = games opened and played; the per-game counter counts a replay within 30 min once
//   owner     = games.developer holds the owner's user id, or on older rows their username
//
// History: game_sessions (every play) starts 11 Oct 2026; before that only each person's first
// and last play of each game is known (game_plays / anonymous_game_plays), so returning days
// before then are undercounted. game_views starts 14 Oct 2026.
import express from 'express';
import pool from './db.js';

const router = express.Router();
const clampDays = (v, def = 30) => Math.min(Math.max(parseInt(v, 10) || def, 1), 365);
const clampInt = (v, def, max) => Math.min(Math.max(parseInt(v, 10) || def, 0), max);
// Timestamps are stored as UTC without a zone; this is the Lagos calendar day.
const lagosDay = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos')::date`;
const LAGOS_TODAY = `(NOW() AT TIME ZONE 'Africa/Lagos')::date`;

// (who, day, game_id) for every bit of activity we have. $1 = include internal accounts.
const ACTIVITY = `
  internal AS (SELECT id FROM users WHERE is_internal AND NOT $1::boolean),
  activity AS (
    SELECT COALESCE('u:' || s.user_id, 'd:' || s.client_id) AS who, ${lagosDay('s.started_at')} AS day, s.game_id
      FROM game_sessions s
     WHERE (s.user_id IS NOT NULL OR s.client_id IS NOT NULL) AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT id FROM internal))
    UNION ALL
    SELECT COALESCE('u:' || v.user_id, 'd:' || v.client_id), ${lagosDay('v.created_at')}, v.game_id
      FROM game_views v
     WHERE (v.user_id IS NOT NULL OR v.client_id IS NOT NULL) AND (v.user_id IS NULL OR v.user_id NOT IN (SELECT id FROM internal))
    UNION ALL
    SELECT 'u:' || p.user_id, ${lagosDay('t.at')}, p.game_id
      FROM game_plays p CROSS JOIN LATERAL (VALUES (p.first_played_at), (p.last_played_at)) AS t(at)
     WHERE t.at IS NOT NULL AND p.user_id NOT IN (SELECT id FROM internal)
    UNION ALL
    SELECT 'd:' || a.client_id, ${lagosDay('t.at')}, a.game_id
      FROM anonymous_game_plays a CROSS JOIN LATERAL (VALUES (a.first_played_at), (a.last_played_at)) AS t(at)
     WHERE t.at IS NOT NULL
  ),
  days AS (SELECT DISTINCT who, day FROM activity),
  firsts AS (SELECT who, MIN(day) AS first_day FROM days GROUP BY who)`;

// Days are returned as 'YYYY-MM-DD' text: a pg DATE becomes a JS Date at local midnight, which
// shifts a day when converted to UTC.
const num = (v) => (v === null || v === undefined ? null : Number(v));

router.get('/overview', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const internal = req.query.internal === '1';

    const head = (await pool.query(`WITH ${ACTIVITY}
      SELECT
        (SELECT COUNT(DISTINCT who) FROM days WHERE day = ${LAGOS_TODAY}) AS active_today,
        (SELECT COUNT(DISTINCT who) FROM days WHERE day > ${LAGOS_TODAY} - 7) AS active_week,
        (SELECT COUNT(DISTINCT who) FROM days WHERE day > ${LAGOS_TODAY} - 30) AS active_month,
        (SELECT COUNT(*) FROM firsts WHERE first_day = ${LAGOS_TODAY}) AS new_today,
        (SELECT COUNT(*) FROM firsts WHERE first_day > ${LAGOS_TODAY} - 7) AS new_week,
        (SELECT COUNT(*) FROM firsts) AS people_ever`, [internal])).rows[0];

    // Daily active people, split new / returning, for the chart.
    const series = (await pool.query(`WITH ${ACTIVITY},
      cal AS (SELECT generate_series(${LAGOS_TODAY} - ($2::int - 1), ${LAGOS_TODAY}, '1 day')::date AS day)
      SELECT to_char(cal.day, 'YYYY-MM-DD') AS day,
        COUNT(DISTINCT d.who) AS active,
        COUNT(DISTINCT d.who) FILTER (WHERE f.first_day = cal.day) AS new
        FROM cal LEFT JOIN days d ON d.day = cal.day LEFT JOIN firsts f ON f.who = d.who
       GROUP BY cal.day ORDER BY cal.day`, [internal, days])).rows.map((r) => ({
      day: r.day, active: +r.active, new: +r.new, returning: +r.active - +r.new,
    }));

    // Retention by the day people first came: of those new on day D, how many were back on D+1, D+7, D+30.
    const cohorts = (await pool.query(`WITH ${ACTIVITY}
      SELECT to_char(f.first_day, 'YYYY-MM-DD') AS day, COUNT(*) AS size,
        CASE WHEN f.first_day + 1 <= ${LAGOS_TODAY} THEN COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.who = f.who AND d.day = f.first_day + 1)) END AS d1,
        CASE WHEN f.first_day + 7 <= ${LAGOS_TODAY} THEN COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.who = f.who AND d.day = f.first_day + 7)) END AS d7,
        CASE WHEN f.first_day + 30 <= ${LAGOS_TODAY} THEN COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.who = f.who AND d.day = f.first_day + 30)) END AS d30,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM days d WHERE d.who = f.who AND d.day > f.first_day)) AS ever_back
        FROM firsts f
       WHERE f.first_day > ${LAGOS_TODAY} - 60
       GROUP BY f.first_day ORDER BY f.first_day DESC`, [internal])).rows.map((r) => ({
      day: r.day, size: +r.size, d1: num(r.d1), d7: num(r.d7), d30: num(r.d30), everBack: +r.ever_back,
    }));
    // Headline retention: every cohort from the last 30 days that is old enough to be measured.
    const rate = (key) => {
      const ripe = cohorts.filter((c) => c[key] !== null && Date.parse(c.day) > Date.now() - 31 * 864e5);
      const size = ripe.reduce((n, c) => n + c.size, 0);
      return size ? { pct: ripe.reduce((n, c) => n + c[key], 0) / size, people: size } : null;
    };

    // Time and plays per person per day, from play sessions (time played only exists from 14 Oct 2026).
    const per = (await pool.query(`WITH ${ACTIVITY},
      s AS (SELECT COALESCE('u:' || user_id, 'd:' || client_id) AS who, ${lagosDay('started_at')} AS day, duration_seconds
              FROM game_sessions
             WHERE (user_id IS NOT NULL OR client_id IS NOT NULL) AND (user_id IS NULL OR user_id NOT IN (SELECT id FROM internal)))
      SELECT
        (SELECT COUNT(*)::float / NULLIF(COUNT(DISTINCT (who, day)), 0) FROM s WHERE day > ${LAGOS_TODAY} - 7) AS plays_per_visit,
        (SELECT SUM(duration_seconds)::float / NULLIF(COUNT(DISTINCT (who, day)), 0) FROM s WHERE day > ${LAGOS_TODAY} - 7 AND duration_seconds > 0) AS seconds_per_person_day,
        (SELECT COUNT(*) FROM s WHERE duration_seconds > 0) AS timed_sessions`, [internal])).rows[0];

    const totals = (await pool.query(`SELECT
        (SELECT COALESCE(SUM(plays), 0) FROM games) AS plays_all_time,
        (SELECT COUNT(*) FROM game_sessions WHERE ${lagosDay('started_at')} = ${LAGOS_TODAY}) AS plays_today,
        (SELECT COUNT(*) FROM users WHERE ($1::boolean OR NOT is_internal)) AS accounts,
        (SELECT COUNT(*) FROM users WHERE ($1::boolean OR NOT is_internal) AND ${lagosDay('created_at')} = ${LAGOS_TODAY}) AS signups_today,
        (SELECT COUNT(*) FROM users WHERE ($1::boolean OR NOT is_internal) AND created_at >= NOW() - INTERVAL '7 days') AS signups_week,
        (SELECT COUNT(*) FROM users WHERE is_internal) AS internal_accounts,
        (SELECT COUNT(*) FROM games WHERE status IS NULL OR status = 'published') AS live_games,
        (SELECT COUNT(*) FROM (SELECT token FROM push_tokens UNION SELECT token FROM anonymous_push_tokens) t) AS push_devices`, [internal])).rows[0];

    res.json({
      days, internal,
      active: { today: +head.active_today, week: +head.active_week, month: +head.active_month },
      newPeople: { today: +head.new_today, week: +head.new_week, ever: +head.people_ever },
      retention: { d1: rate('d1'), d7: rate('d7'), d30: rate('d30') },
      perPerson: {
        playsPerVisit: num(per.plays_per_visit),
        secondsPerDay: num(per.seconds_per_person_day),
        timedSessions: +per.timed_sessions,
      },
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])),
      series, cohorts,
    });
  } catch (err) {
    console.error('[AdminInsights] overview:', err.message);
    res.status(500).json({ error: 'Could not load overview' });
  }
});

// Per game for the range: people, how many came back to it on another day, plays, time.
router.get('/games', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const internal = req.query.internal === '1';
    const r = await pool.query(`WITH ${ACTIVITY},
      g_days AS (SELECT DISTINCT game_id, who, day FROM activity WHERE day > ${LAGOS_TODAY} - $2::int),
      g_people AS (SELECT game_id, who, COUNT(*) AS n_days FROM g_days GROUP BY game_id, who),
      g_stats AS (SELECT game_id, COUNT(*) AS people, COUNT(*) FILTER (WHERE n_days > 1) AS came_back FROM g_people GROUP BY game_id)
      SELECT g.id, g.name, g.status, g.thumbnail, g.created_at, g.platform, g.plays AS plays_all_time,
             u.username AS creator,
             COALESCE(st.people, 0) AS people, COALESCE(st.came_back, 0) AS came_back,
             (SELECT COUNT(*) FROM game_sessions s WHERE s.game_id = g.id AND s.started_at >= NOW() - make_interval(days => $2::int)) AS plays,
             (SELECT ROUND(AVG(duration_seconds)) FROM game_sessions s WHERE s.game_id = g.id AND s.duration_seconds > 0 AND s.started_at >= NOW() - make_interval(days => $2::int)) AS avg_play_seconds,
             (SELECT MAX(started_at) FROM game_sessions s WHERE s.game_id = g.id) AS last_played_at
        FROM games g
        LEFT JOIN users u ON u.id::text = g.developer OR (u.username IS NOT NULL AND u.username = g.developer)
        LEFT JOIN g_stats st ON st.game_id = g.id
       ORDER BY people DESC, g.plays DESC NULLS LAST`, [internal, days]);
    res.json({ days, games: r.rows.map((g) => ({
      ...g, people: +g.people, came_back: +g.came_back, plays: +g.plays, plays_all_time: +g.plays_all_time || 0,
      avg_play_seconds: num(g.avg_play_seconds),
    })) });
  } catch (err) {
    console.error('[AdminInsights] games:', err.message);
    res.status(500).json({ error: 'Could not load games' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const internal = req.query.internal === '1';
    const limit = clampInt(req.query.limit, 50, 200);
    const offset = clampInt(req.query.offset, 0, 100000);
    // $1 = include internal; the search term is the parameter at searchParam.
    const filter = (searchParam) => `WHERE ($1::boolean OR NOT u.is_internal)${q ? ` AND (u.username ILIKE $${searchParam} OR u.email ILIKE $${searchParam} OR u.display_name ILIKE $${searchParam})` : ''}`;
    const params = [internal, limit, offset];
    if (q) params.push(`%${q}%`);
    const r = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.email, u.avatar, u.oauth_provider, u.created_at, u.is_internal,
             u.developer_agreement_accepted_at IS NOT NULL AS developer,
             COALESCE((SELECT SUM(play_count) FROM game_plays p WHERE p.user_id = u.id), 0) AS plays,
             (SELECT COUNT(DISTINCT game_id) FROM game_plays p WHERE p.user_id = u.id) AS games_played,
             (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions s WHERE s.user_id = u.id) AS seconds_played,
             GREATEST((SELECT MAX(last_played_at) FROM game_plays p WHERE p.user_id = u.id), (SELECT MAX(started_at) FROM game_sessions s WHERE s.user_id = u.id)) AS last_played_at,
             (SELECT COUNT(*) FROM games g WHERE g.developer = u.id::text OR g.developer = u.username) AS games_published,
             EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id) AS push_enabled
        FROM users u ${filter(4)}
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT $2 OFFSET $3`, params);
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM users u ${filter(2)}`, q ? [internal, `%${q}%`] : [internal])).rows[0].n;
    res.json({ total, users: r.rows.map((u) => ({ ...u, plays: +u.plays, games_played: +u.games_played, seconds_played: +u.seconds_played, games_published: +u.games_published })) });
  } catch (err) {
    console.error('[AdminInsights] users:', err.message);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'User not found' });
    const user = (await pool.query(`SELECT id, username, display_name, email, avatar, oauth_provider, created_at, developer_agreement_accepted_at, is_internal FROM users WHERE id = $1`, [req.params.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const games = (await pool.query(`
      SELECT p.game_id, g.name, p.play_count AS plays, p.first_played_at, p.last_played_at,
             (SELECT COALESCE(SUM(duration_seconds), 0) FROM game_sessions s WHERE s.user_id = p.user_id AND s.game_id = p.game_id)::int AS seconds_played
        FROM game_plays p LEFT JOIN games g ON g.id = p.game_id
       WHERE p.user_id = $1 ORDER BY p.last_played_at DESC NULLS LAST LIMIT 100`, [req.params.id])).rows;
    const published = (await pool.query(`SELECT id, name, status, created_at FROM games WHERE developer = $1 OR developer = $2 ORDER BY created_at DESC`, [req.params.id, user.username || ''])).rows;
    const searches = (await pool.query(`SELECT query, created_at FROM search_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]).catch(() => ({ rows: [] }))).rows;
    res.json({ user, games, published, searches });
  } catch (err) {
    console.error('[AdminInsights] user:', err.message);
    res.status(500).json({ error: 'Could not load user' });
  }
});

// Newest first: sign-ups, plays, games published. Internal accounts' rows are left out unless ?internal=1.
router.get('/activity', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 60, 200);
    const internal = req.query.internal === '1';
    const r = await pool.query(`
      (SELECT 'signup' AS kind, u.created_at AS at, u.id::text AS user_id, COALESCE(u.username, u.display_name, u.email) AS who, NULL AS game_id, NULL AS game, u.oauth_provider AS detail, NULL::int AS seconds
         FROM users u WHERE $2::boolean OR NOT u.is_internal ORDER BY u.created_at DESC NULLS LAST LIMIT $1)
      UNION ALL
      (SELECT 'play', s.started_at, s.user_id::text, COALESCE(u.username, CASE WHEN s.client_id IS NOT NULL THEN 'guest ' || RIGHT(s.client_id, 5) END), s.game_id, g.name, s.platform, s.duration_seconds
         FROM game_sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN games g ON g.id = s.game_id
        WHERE $2::boolean OR u.id IS NULL OR NOT u.is_internal
        ORDER BY s.started_at DESC LIMIT $1)
      UNION ALL
      (SELECT 'publish', g.created_at, g.developer, u.username, g.id, g.name, g.status, NULL
         FROM games g LEFT JOIN users u ON u.id::text = g.developer OR (u.username IS NOT NULL AND u.username = g.developer)
        ORDER BY g.created_at DESC LIMIT $1)
      ORDER BY at DESC NULLS LAST LIMIT $1`, [limit, internal]);
    res.json({ events: r.rows });
  } catch (err) {
    console.error('[AdminInsights] activity:', err.message);
    res.status(500).json({ error: 'Could not load activity' });
  }
});

export default router;
