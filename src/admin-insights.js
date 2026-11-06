// Numbers for the admin dashboard (gametok.co/admin). Mounted under /api/admin, so requireAdmin
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
import { storeConfig, syncStoreStats } from './store-stats.js';
import { getPresenceSummary } from './presence-socket.js';

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
        (SELECT COUNT(DISTINCT who) FROM days WHERE day = ${LAGOS_TODAY} AND who LIKE 'u:%') AS signed_in_today,
        (SELECT COUNT(DISTINCT who) FROM days WHERE day > ${LAGOS_TODAY} - 7 AND who LIKE 'u:%') AS signed_in_week,
        (SELECT COUNT(DISTINCT who) FROM days WHERE day > ${LAGOS_TODAY} - 30 AND who LIKE 'u:%') AS signed_in_month,
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
      // Of those, people signed in to an account (the rest are guests, counted per device).
      signedIn: { today: +head.signed_in_today, week: +head.signed_in_week, month: +head.signed_in_month },
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
             (SELECT MAX(started_at) FROM game_sessions s WHERE s.game_id = g.id) AS last_played_at,
             (SELECT COUNT(*) FROM game_views v WHERE v.game_id = g.id AND v.created_at >= NOW() - make_interval(days => $2::int)) AS views,
             (SELECT COUNT(*) FROM game_sessions s WHERE s.game_id = g.id AND s.platform = 'mobile' AND s.started_at >= NOW() - make_interval(days => $2::int)) AS mobile_plays,
             g.like_count, g.save_count
        FROM games g
        LEFT JOIN users u ON u.id::text = g.developer OR (u.username IS NOT NULL AND u.username = g.developer)
        LEFT JOIN g_stats st ON st.game_id = g.id
       ORDER BY people DESC, g.plays DESC NULLS LAST`, [internal, days]);
    res.json({ days, games: r.rows.map((g) => ({
      ...g, people: +g.people, came_back: +g.came_back, plays: +g.plays, plays_all_time: +g.plays_all_time || 0,
      views: +g.views, mobile_plays: +g.mobile_plays, like_count: +g.like_count || 0, save_count: +g.save_count || 0,
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

// App downloads per store (from app_store_daily, filled by src/store-stats.js).
router.get('/app-stores', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const cfg = storeConfig();
    const sum = await pool.query(`SELECT store,
        COALESCE(SUM(downloads), 0) AS all_time,
        COALESCE(SUM(downloads) FILTER (WHERE day > CURRENT_DATE - 7), 0) AS week,
        COALESCE(SUM(downloads) FILTER (WHERE day > CURRENT_DATE - 30), 0) AS month,
        to_char(MAX(day), 'YYYY-MM-DD') AS latest_day,
        (ARRAY_AGG(active_devices ORDER BY day DESC) FILTER (WHERE active_devices IS NOT NULL))[1] AS active_devices,
        MAX(updated_at) AS fetched_at
      FROM app_store_daily GROUP BY store`);
    const series = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, store, downloads FROM app_store_daily
      WHERE day > CURRENT_DATE - $1::int ORDER BY day`, [days]);
    const byStore = Object.fromEntries(sum.rows.map((r) => [r.store, {
      allTime: +r.all_time, week: +r.week, month: +r.month, activeDevices: num(r.active_devices),
      latestDay: r.latest_day, fetchedAt: r.fetched_at,
    }]));
    res.json({
      connected: { apple: Boolean(cfg.apple), google: Boolean(cfg.google) },
      stores: byStore,
      series: series.rows.map((r) => ({ day: r.day, store: r.store, downloads: +r.downloads })),
    });
  } catch (err) {
    console.error('[AdminInsights] app-stores:', err.message);
    res.status(500).json({ error: 'Could not load app store numbers' });
  }
});

// Fetch from the stores now (the schedule only runs every 6 hours).
router.post('/app-stores/refresh', async (req, res) => {
  try {
    res.json(await syncStoreStats(pool));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Everything below feeds one tab each of the dashboard ----
const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;
// One count per Lagos day for the last $days days, zero-filled. `from` is "<table> <alias>", col the timestamp.
const daily = (from, col, days, where = 'TRUE') => rows(`
  WITH cal AS (SELECT generate_series(${LAGOS_TODAY} - ($1::int - 1), ${LAGOS_TODAY}, '1 day')::date AS day)
  SELECT to_char(cal.day, 'YYYY-MM-DD') AS day, COUNT(t.at)::int AS n
    FROM cal LEFT JOIN (SELECT ${lagosDay(col)} AS day, ${col} AS at FROM ${from} WHERE ${where}) t ON t.day = cal.day
   GROUP BY cal.day ORDER BY cal.day`, [days]);

// How people arrive and how they play: sign-ups, phone or computer, how long, what time of day.
router.get('/audience', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const internal = req.query.internal === '1';
    const notInternal = internal ? 'TRUE' : `(s.user_id IS NULL OR s.user_id NOT IN (SELECT id FROM users WHERE is_internal))`;
    const [signups, providers, platforms, lengths, hours] = await Promise.all([
      daily('users u', 'u.created_at', days, internal ? 'TRUE' : 'NOT u.is_internal'),
      rows(`SELECT COALESCE(oauth_provider, 'email') AS provider, COUNT(*)::int AS n FROM users WHERE $1::boolean OR NOT is_internal GROUP BY 1 ORDER BY 2 DESC`, [internal]),
      rows(`WITH cal AS (SELECT generate_series(${LAGOS_TODAY} - ($1::int - 1), ${LAGOS_TODAY}, '1 day')::date AS day)
        SELECT to_char(cal.day, 'YYYY-MM-DD') AS day,
               COUNT(s.id) FILTER (WHERE s.platform = 'mobile')::int AS phone,
               COUNT(s.id) FILTER (WHERE s.platform IS DISTINCT FROM 'mobile')::int AS computer
          FROM cal LEFT JOIN game_sessions s ON ${lagosDay('s.started_at')} = cal.day AND ${notInternal}
         GROUP BY cal.day ORDER BY cal.day`, [days]),
      rows(`SELECT CASE WHEN duration_seconds < 30 THEN 0 WHEN duration_seconds < 120 THEN 1 WHEN duration_seconds < 600 THEN 2 WHEN duration_seconds < 1800 THEN 3 ELSE 4 END AS bucket, COUNT(*)::int AS n
              FROM game_sessions s WHERE duration_seconds > 0 AND started_at >= NOW() - make_interval(days => $1::int) AND ${notInternal} GROUP BY 1 ORDER BY 1`, [days]),
      rows(`SELECT EXTRACT(HOUR FROM (s.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos')::int AS hour, COUNT(*)::int AS n
              FROM game_sessions s WHERE started_at >= NOW() - make_interval(days => $1::int) AND ${notInternal} GROUP BY 1 ORDER BY 1`, [days]),
    ]);
    res.json({ days, signups, providers, platforms, lengths, hours });
  } catch (err) {
    console.error('[AdminInsights] audience:', err.message);
    res.status(500).json({ error: 'Could not load audience' });
  }
});

// TokBux after it's bought: what it was given or spent on, and what people own. (Dollars: /api/admin/revenue.)
router.get('/economy', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const [reasons, items, owned, balances] = await Promise.all([
      rows(`SELECT reason, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::int AS tokbux FROM tokbux_ledger WHERE created_at >= NOW() - make_interval(days => $1::int) GROUP BY 1 ORDER BY ABS(SUM(amount)) DESC`, [days]),
      rows(`SELECT item_id, COUNT(*)::int AS n, COALESCE(-SUM(amount), 0)::int AS tokbux FROM tokbux_ledger WHERE item_id IS NOT NULL AND amount < 0 AND created_at >= NOW() - make_interval(days => $1::int) GROUP BY 1 ORDER BY 3 DESC LIMIT 20`, [days]),
      rows(`SELECT item, COUNT(*)::int AS n FROM avatar_profiles, unnest(owned) AS item GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
      rows(`SELECT COUNT(*)::int AS profiles, COALESCE(SUM(tokbux), 0)::bigint AS held, COUNT(*) FILTER (WHERE cardinality(owned) > 0)::int AS with_items FROM avatar_profiles`),
    ]);
    res.json({ days, reasons, items, owned, balances: { ...balances[0], held: Number(balances[0].held) } });
  } catch (err) {
    console.error('[AdminInsights] economy:', err.message);
    res.status(500).json({ error: 'Could not load economy' });
  }
});

// Right now: who's connected to the app, and each game on the multiplayer server. The hub keeps rooms in
// memory only and sleeps when empty, so this is asked for only while the tab is open, and cached a little.
const HUB = process.env.GAMETOK_ONLINE_URL || 'https://gametok-online-267787411422.europe-west2.run.app';
const hubGet = async (path) => {
  const r = await fetch(HUB + path, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
let hubCache = { at: 0, value: null };
async function hubStats() {
  if (hubCache.value && Date.now() - hubCache.at < 20000) return hubCache.value;
  const [squad, squid, sfc, nrfc] = await Promise.allSettled([hubGet('/squad/health'), hubGet('/squid/health'), hubGet('/sfc/health'), hubGet('/nrfc/status')]);
  const game = (name, r) => (r.status === 'fulfilled' ? { name, up: true, players: r.value.players || 0, rooms: r.value.rooms || 0 } : { name, up: false });
  const value = {
    games: [
      game('Squid Play', squid),
      game('Supreme Fight Club', sfc),
      nrfc.status === 'fulfilled'
        ? { name: 'No Rules FC', up: true, rooms: nrfc.value.length, players: nrfc.value.reduce((n, r) => n + (r.players || 0), 0) }
        : { name: 'No Rules FC', up: false },
    ],
    squads: squad.status === 'fulfilled' ? { up: true, players: squad.value.players || 0, squads: squad.value.squads || 0 } : { up: false },
  };
  hubCache = { at: Date.now(), value };
  return value;
}
router.get('/live', async (req, res) => {
  try {
    const [hub, recent, lastGames, matches] = await Promise.all([
      hubStats(),
      rows(`SELECT COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '1 hour')::int AS hour, COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '1 day')::int AS day, COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '7 days')::int AS week FROM presence_last`),
      rows(`SELECT p.last_game AS game_id, COALESCE(g.name, p.last_game) AS name, COUNT(*)::int AS n FROM presence_last p LEFT JOIN games g ON g.id = p.last_game WHERE p.last_game IS NOT NULL AND p.last_seen > NOW() - INTERVAL '7 days' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
      rows(`SELECT COALESCE(g.name, m.game_id) AS name, m.mode, m.status, COUNT(*)::int AS n FROM game_matches m LEFT JOIN games g ON g.id = m.game_id GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 20`),
    ]);
    res.json({ app: getPresenceSummary(), hub, seen: recent[0], lastGames, matches });
  } catch (err) {
    console.error('[AdminInsights] live:', err.message);
    res.status(500).json({ error: 'Could not load live numbers' });
  }
});

router.get('/social', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const SOURCES = { follows: ['followers f', 'f.created_at'], messages: ['messages m', 'm.created_at'], comments: ['comments c', 'c.created_at'], likes: ['likes l', 'l.created_at'], saves: ['saved_games s', 's.created_at'], stories: ['stories t', 't.created_at'] };
    const keys = Object.keys(SOURCES);
    const series = await Promise.all(keys.map((k) => daily(SOURCES[k][0], SOURCES[k][1], days)));
    const totals = (await rows(`SELECT (SELECT COUNT(*) FROM followers)::int AS follows, (SELECT COUNT(*) FROM messages)::int AS messages,
        (SELECT COUNT(*) FROM conversations)::int AS conversations, (SELECT COUNT(*) FROM comments)::int AS comments, (SELECT COUNT(*) FROM likes)::int AS likes,
        (SELECT COUNT(*) FROM saved_games)::int AS saves, (SELECT COUNT(*) FROM stories)::int AS stories, (SELECT COUNT(*) FROM story_views)::int AS story_views,
        (SELECT COUNT(*) FROM blocked_users)::int AS blocks, (SELECT COUNT(*) FROM reports)::int AS reports,
        (SELECT COUNT(*) FROM reports WHERE status IS NULL OR status = 'pending')::int AS reports_open`))[0];
    const out = series[0].map((d, i) => Object.fromEntries([['day', d.day], ...keys.map((k, j) => [k, series[j][i].n])]));
    res.json({ days, totals, series: out });
  } catch (err) {
    console.error('[AdminInsights] social:', err.message);
    res.status(500).json({ error: 'Could not load social' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const [byAction, sent, devices] = await Promise.all([
      rows(`SELECT type, action, COUNT(*)::int AS made, COUNT(push_sent_at)::int AS pushed, COUNT(read_at)::int AS opened FROM notification_events WHERE created_at >= NOW() - make_interval(days => $1::int) GROUP BY 1, 2 ORDER BY 3 DESC`, [days]),
      daily('notification_events n', 'n.push_sent_at', days, 'n.push_sent_at IS NOT NULL'),
      rows(`SELECT (SELECT COUNT(DISTINCT token) FROM push_tokens)::int AS accounts, (SELECT COUNT(DISTINCT token) FROM anonymous_push_tokens)::int AS guests`),
    ]);
    res.json({ days, byAction, sent, devices: devices[0] });
  } catch (err) {
    console.error('[AdminInsights] notifications:', err.message);
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const days = clampDays(req.query.days);
    const [top, series, total] = await Promise.all([
      rows(`SELECT normalized_query AS query, COUNT(*)::int AS n, COUNT(DISTINCT COALESCE(user_id::text, client_id))::int AS people FROM search_events WHERE created_at >= NOW() - make_interval(days => $1::int) GROUP BY 1 ORDER BY 2 DESC LIMIT 50`, [days]),
      daily('search_events e', 'e.created_at', days),
      rows(`SELECT COUNT(*)::int AS n, MAX(created_at) AS last FROM search_events`),
    ]);
    res.json({ days, top, series, total: total[0] });
  } catch (err) {
    console.error('[AdminInsights] search:', err.message);
    res.status(500).json({ error: 'Could not load search' });
  }
});

// Developers publishing through the API, the catalogue, and the background jobs.
router.get('/platform', async (req, res) => {
  try {
    const [head, statuses, keys, uploads, removed, jobs] = await Promise.all([
      rows(`SELECT (SELECT COUNT(*) FROM users WHERE developer_agreement_accepted_at IS NOT NULL)::int AS developers,
          (SELECT COUNT(*) FROM developer_api_keys WHERE revoked_at IS NULL)::int AS keys,
          (SELECT COUNT(*) FROM game_uploads)::int AS uploads, (SELECT COALESCE(SUM(bytes), 0) FROM game_uploads)::bigint AS upload_bytes,
          (SELECT COUNT(*) FROM game_versions)::int AS versions, (SELECT COUNT(*) FROM deleted_games)::int AS removed`),
      rows(`SELECT COALESCE(status, 'published') AS status, COUNT(*)::int AS n FROM games GROUP BY 1 ORDER BY 2 DESC`),
      rows(`SELECT k.name, k.key_prefix, k.mode, k.created_at, k.last_used_at, k.revoked_at, u.username FROM developer_api_keys k LEFT JOIN users u ON u.id = k.user_id ORDER BY k.last_used_at DESC NULLS LAST LIMIT 30`),
      rows(`SELECT g.url, g.bytes::bigint AS bytes, g.files, g.created_at, u.username FROM game_uploads g LEFT JOIN users u ON u.id::text = g.developer_id ORDER BY g.created_at DESC LIMIT 20`),
      rows(`SELECT id, name, reason, deleted_at FROM deleted_games ORDER BY deleted_at DESC LIMIT 20`),
      rows(`SELECT name, last_run_at FROM scheduled_job_runs ORDER BY last_run_at DESC`),
    ]);
    res.json({ ...head[0], upload_bytes: Number(head[0].upload_bytes), statuses, apiKeys: keys, uploadList: uploads.map((u) => ({ ...u, bytes: Number(u.bytes) })), removedList: removed, jobs });
  } catch (err) {
    console.error('[AdminInsights] platform:', err.message);
    res.status(500).json({ error: 'Could not load platform' });
  }
});

// Every place GameTok records something, how much it holds and when it last got a row. An empty or stale
// source means nothing is being measured there, which is otherwise invisible.
const SOURCES = [
  ['Players', 'game_sessions', 'started_at', 'Every game played: who, how long, score, phone or computer'],
  ['Players', 'game_views', 'created_at', 'A game shown to someone'],
  ['Players', 'game_plays', 'last_played_at', 'Each account × game: first and last play, play count'],
  ['Players', 'anonymous_game_plays', 'last_played_at', 'The same for guests, per device'],
  ['Players', 'game_progress', 'updated_at', 'Cloud saves'],
  ['Players', 'scores', 'created_at', 'High scores'],
  ['Players', 'search_events', 'created_at', 'What people search for'],
  ['Accounts', 'users', 'created_at', 'Accounts, how they signed up'],
  ['Accounts', 'user_devices', 'last_used_at', 'Trusted devices at sign-in'],
  ['Accounts', 'presence_last', 'last_seen', 'When each account was last on, and the last game'],
  ['Money', 'tokbux_purchases', 'created_at', 'Real-money purchases (Apple, Google)'],
  ['Money', 'tokbux_ledger', 'created_at', 'Every TokBux added or spent'],
  ['Money', 'avatar_profiles', 'updated_at', 'Avatars, balances, items owned'],
  ['Stores', 'app_store_daily', 'day', 'Downloads per store per day'],
  ['Multiplayer', 'game_matches', 'created_at', 'Matches through the developer match API'],
  ['Multiplayer', 'game_match_players', 'joined_at', 'Players in those matches'],
  ['Social', 'followers', 'created_at', 'Follows'],
  ['Social', 'messages', 'created_at', 'Chat messages'],
  ['Social', 'conversations', 'updated_at', 'Chats'],
  ['Social', 'comments', 'created_at', 'Comments on games'],
  ['Social', 'likes', 'created_at', 'Game likes'],
  ['Social', 'saved_games', 'created_at', 'Saved games'],
  ['Social', 'stories', 'created_at', 'Stories posted'],
  ['Social', 'story_views', 'viewed_at', 'Stories seen'],
  ['Social', 'reports', 'created_at', 'People and content reported'],
  ['Social', 'blocked_users', 'created_at', 'Blocks'],
  ['Notifications', 'notification_events', 'created_at', 'Every notification made, pushed, read'],
  ['Notifications', 'push_tokens', 'last_used_at', 'Phones with an account that accept notifications'],
  ['Notifications', 'anonymous_push_tokens', 'last_seen_at', 'Guest phones that accept notifications'],
  ['Platform', 'games', 'created_at', 'The catalogue'],
  ['Platform', 'deleted_games', 'deleted_at', 'Games removed, and why'],
  ['Platform', 'developer_api_keys', 'last_used_at', 'Developer keys'],
  ['Platform', 'game_uploads', 'created_at', 'Builds uploaded by developers'],
  ['Platform', 'game_versions', 'created_at', 'Game versions'],
  ['Platform', 'scheduled_job_runs', 'last_run_at', 'Background jobs'],
  ['Platform', 'posts', 'created_at', 'Blog posts'],
];
router.get('/sources', async (req, res) => {
  try {
    const out = await Promise.all(SOURCES.map(async ([group, table, col, what]) => {
      const [r] = await rows(`SELECT COUNT(*)::int AS n, MIN(${col}) AS first, MAX(${col}) AS last, COUNT(*) FILTER (WHERE ${col} >= NOW() - INTERVAL '7 days')::int AS week FROM ${table}`);
      return { group, table, what, rows: r.n, first: r.first, last: r.last, week: r.week };
    }));
    const hub = await hubStats().catch(() => null);
    res.json({
      database: out,
      live: [
        { name: 'App connections', what: 'Who is in the app right now (backend memory)', up: true },
        { name: 'GameTok online', what: 'Rooms and players per game, squads (memory only, nothing is kept)', up: Boolean(hub && hub.squads.up) },
      ],
      stores: storeConfig() ? { apple: Boolean(storeConfig().apple), google: Boolean(storeConfig().google) } : {},
    });
  } catch (err) {
    console.error('[AdminInsights] sources:', err.message);
    res.status(500).json({ error: 'Could not load sources' });
  }
});

export default router;
