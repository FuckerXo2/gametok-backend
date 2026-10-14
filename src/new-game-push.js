// "New games" push: at most once a day, in the evening in Lagos, only when games actually went
// live in the last 24 hours (and can be played on phones). Tapping it opens the newest game.
// Every server instance runs the check; claiming the day's slot in the database means only one
// of them sends it.
import { Expo } from 'expo-server-sdk';

const expo = new Expo();
const LAGOS_UTC_OFFSET_HOURS = 1;
const SEND_FROM_HOUR = 18; // Lagos time; evenings are when people play
const SEND_UNTIL_HOUR = 22;

export async function announceNewGames(pool, { now = new Date(), force = false } = {}) {
  const lagosHour = (now.getUTCHours() + LAGOS_UTC_OFFSET_HOURS) % 24;
  if (!force && (lagosHour < SEND_FROM_HOUR || lagosHour >= SEND_UNTIL_HOUR)) return { sent: 0, reason: 'outside evening window' };

  // Claim today's slot: only one instance gets a row back, at most once every 20 hours.
  const claim = await pool.query(
    `INSERT INTO scheduled_job_runs (name, last_run_at) VALUES ('new_games_push', NOW())
     ON CONFLICT (name) DO UPDATE SET last_run_at = NOW()
       WHERE scheduled_job_runs.last_run_at < NOW() - INTERVAL '20 hours'
     RETURNING name`
  );
  if (!claim.rowCount) return { sent: 0, reason: 'already ran today' };

  // Games that went live in the last day and haven't been announced; claimed in the same
  // statement so a game is never announced twice.
  const games = await pool.query(
    `UPDATE games SET announced_at = NOW()
      WHERE id IN (
        SELECT id FROM games
         WHERE (status IS NULL OR status = 'published')
           AND announced_at IS NULL
           AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '24 hours'
           AND (platform IS NULL OR platform = 'all')
           AND (multiplayer_only = FALSE OR multiplayer_only IS NULL))
      RETURNING id, name, created_at`
  );
  if (!games.rowCount) return { sent: 0, reason: 'no new games' };
  const newest = [...games.rows].sort((a, b) => b.created_at - a.created_at);
  const [first, second] = newest;
  const title = newest.length === 1 ? 'New on GameTok 🎮' : `${newest.length} new games on GameTok 🎮`;
  const body = newest.length === 1
    ? `${first.name} just dropped. Tap to play.`
    : newest.length === 2
      ? `${first.name} and ${second.name}. Tap to play.`
      : `${first.name}, ${second.name} and more. Tap to play.`;

  const tokens = await pool.query(
    `SELECT token FROM push_tokens UNION SELECT token FROM anonymous_push_tokens`
  );
  const messages = tokens.rows
    .map((r) => r.token)
    .filter((t) => Expo.isExpoPushToken(t))
    .map((to) => ({ to, sound: 'default', title, body, data: { type: 'game', gameId: first.id, action: 'new_games' } }));

  let sent = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
      sent += chunk.length;
    } catch (err) {
      console.error('[NewGamesPush] send error:', err.message);
    }
  }
  console.log(`[NewGamesPush] Announced ${newest.length} game(s) to ${sent} device(s): ${newest.map((g) => g.id).join(', ')}`);
  return { sent, games: newest.map((g) => g.id) };
}
