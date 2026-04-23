// Push + in-app notification service.
// Everything routes through notifyUser so we can cap, dedupe, and avoid blast storms.
import { Expo } from 'expo-server-sdk';
import pool from './db.js';
import * as db from './db.js';

const expo = new Expo();

const DEFAULT_DAILY_LIMIT = Number(process.env.NOTIFICATION_DAILY_LIMIT || 8);
const DEFAULT_MIN_GAP_MINUTES = Number(process.env.NOTIFICATION_MIN_GAP_MINUTES || 10);

const RULES = {
  message: { dailyLimit: 30, minGapMinutes: 1, cooldownMinutes: 1 },
  follow: { dailyLimit: 12, minGapMinutes: 4, cooldownMinutes: 60 },
  game_liked: { dailyLimit: 12, minGapMinutes: 6, cooldownMinutes: 20 },
  game_played: { dailyLimit: 10, minGapMinutes: 10, cooldownMinutes: 240 },
  game_ready: { dailyLimit: 20, minGapMinutes: 0, cooldownMinutes: 0, priority: 'high' },
  trending: { dailyLimit: 3, minGapMinutes: 90, cooldownMinutes: 720 },
  reengagement: { dailyLimit: 1, minGapMinutes: 240, cooldownMinutes: 1440 },
  reward: { dailyLimit: 1, minGapMinutes: 240, cooldownMinutes: 1440 },
  test: { dailyLimit: 99, minGapMinutes: 0, cooldownMinutes: 0, bypassThrottle: true },
};

function compactName(user) {
  return user?.displayName || user?.username || 'Someone';
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function mergeRules(action, overrides = {}) {
  return {
    dailyLimit: DEFAULT_DAILY_LIMIT,
    minGapMinutes: DEFAULT_MIN_GAP_MINUTES,
    cooldownMinutes: 60,
    priority: 'normal',
    inApp: true,
    ...RULES[action],
    ...overrides,
  };
}

async function getNotificationDecision(userId, dedupeKey, rules) {
  if (rules.bypassThrottle) return { ok: true };

  const dailyLimit = Number(rules.dailyLimit ?? DEFAULT_DAILY_LIMIT);
  const minGapMinutes = Number(rules.minGapMinutes ?? DEFAULT_MIN_GAP_MINUTES);
  const cooldownMinutes = Number(rules.cooldownMinutes ?? 60);

  if (dedupeKey && cooldownMinutes > 0) {
    const recentSame = await pool.query(
      `SELECT id FROM notification_events
       WHERE user_id = $1
         AND dedupe_key = $2
         AND created_at > NOW() - ($3::text || ' minutes')::interval
       LIMIT 1`,
      [userId, dedupeKey, cooldownMinutes],
    );
    if (recentSame.rows.length > 0) return { ok: false, reason: 'dedupe_cooldown' };
  }

  if (minGapMinutes > 0 && rules.priority !== 'high') {
    const recentAny = await pool.query(
      `SELECT id FROM notification_events
       WHERE user_id = $1
         AND push_sent_at IS NOT NULL
         AND push_sent_at > NOW() - ($2::text || ' minutes')::interval
       LIMIT 1`,
      [userId, minGapMinutes],
    );
    if (recentAny.rows.length > 0) return { ok: false, reason: 'min_gap' };
  }

  if (dailyLimit > 0) {
    const today = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notification_events
       WHERE user_id = $1
         AND push_sent_at IS NOT NULL
         AND push_sent_at > NOW() - INTERVAL '24 hours'`,
      [userId],
    );
    if (Number(today.rows[0]?.count || 0) >= dailyLimit) return { ok: false, reason: 'daily_limit' };
  }

  return { ok: true };
}

async function insertNotificationEvent(userId, payload, pushSentAt = null) {
  await pool.query(
    `INSERT INTO notification_events
       (user_id, actor_user_id, game_id, type, action, title, body, data, dedupe_key, push_sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      userId,
      payload.actorUserId || null,
      payload.gameId || null,
      payload.type || 'system',
      payload.action || 'notification',
      payload.title,
      payload.body,
      JSON.stringify(payload.data || {}),
      payload.dedupeKey || null,
      pushSentAt,
    ],
  );
}

async function sendExpoPushToUsers(userIds, title, body, data = {}) {
  const tokens = await db.getPushTokens(userIds);
  if (!tokens || tokens.length === 0) {
    console.log('[Notifications] No push tokens found for users:', userIds);
    return [];
  }

  const messages = tokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data,
      badge: 1,
      channelId: 'default',
    }));

  if (messages.length === 0) {
    console.log('[Notifications] No valid Expo push tokens');
    return [];
  }

  const tickets = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('[Notifications] Error sending chunk:', error);
    }
  }

  console.log('[Notifications] Sent:', tickets.length, 'push tickets');
  return tickets;
}

async function notifyUser(userId, payload, ruleOverrides = {}) {
  if (!userId || !payload?.title || !payload?.body) return { sent: false, reason: 'invalid_payload' };

  const rules = mergeRules(payload.action, ruleOverrides);
  const decision = await getNotificationDecision(userId, payload.dedupeKey, rules);
  if (!decision.ok) {
    if (rules.inApp === true && ruleOverrides.persistWhenThrottled === true) {
      await insertNotificationEvent(userId, payload, null);
    }
    console.log('[Notifications] Throttled:', { userId, action: payload.action, reason: decision.reason });
    return { sent: false, reason: decision.reason };
  }

  let tickets = [];
  try {
    tickets = await sendExpoPushToUsers([userId], payload.title, payload.body, payload.data || {});
  } finally {
    if (rules.inApp !== false) {
      await insertNotificationEvent(userId, payload, tickets.length > 0 ? new Date() : null);
    }
  }

  return { sent: tickets.length > 0, tickets };
}

// Kept for old callers, but now protected by the same governor.
async function sendPushNotification(userIds, title, body, data = {}, options = {}) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const results = [];
  for (const userId of ids) {
    const action = options.action || data.action || data.type || 'notification';
    results.push(await notifyUser(userId, {
      type: data.type || options.type || 'system',
      action,
      title,
      body,
      data,
      dedupeKey: options.dedupeKey || `${action}:${JSON.stringify(data).slice(0, 160)}`,
      actorUserId: options.actorUserId || data.userId || null,
      gameId: options.gameId || data.gameId || null,
    }, options));
  }
  return results;
}

async function getGameWithOwner(gameId) {
  const result = await pool.query(
    `SELECT g.id, g.name, g.thumbnail, g.plays, g.like_count,
            ag.user_id AS owner_id
     FROM games g
     LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
     WHERE g.id = $1`,
    [gameId],
  );
  return result.rows[0] || null;
}

async function notifyGameLiked(gameId, likedByUserId) {
  try {
    const [actor, game] = await Promise.all([
      db.getUserById(likedByUserId),
      getGameWithOwner(gameId),
    ]);
    if (!actor || !game?.owner_id || game.owner_id === likedByUserId) return;

    const lines = [
      `${compactName(actor)} tapped heart on "${game.name}". tiny shrine behavior.`,
      `${compactName(actor)} liked "${game.name}". the algorithm heard that.`,
      `${compactName(actor)} just gave "${game.name}" a little electricity.`,
    ];

    await notifyUser(game.owner_id, {
      type: 'social',
      action: 'game_liked',
      title: 'Your game got liked',
      body: pick(lines),
      actorUserId: likedByUserId,
      gameId,
      data: { type: 'social', action: 'game_liked', gameId, userId: likedByUserId },
      dedupeKey: `game_liked:${gameId}:${likedByUserId}`,
    }, { cooldownMinutes: 10080, minGapMinutes: 4 });
  } catch (error) {
    console.error('[Notifications] Game like notification error:', error);
  }
}

async function notifyGamePlayed(gameId, playedByUserId = null, anonymous = false) {
  try {
    const [actor, game] = await Promise.all([
      playedByUserId ? db.getUserById(playedByUserId) : Promise.resolve(null),
      getGameWithOwner(gameId),
    ]);
    if (!game?.owner_id || game.owner_id === playedByUserId) return;

    const subject = actor ? compactName(actor) : 'Someone';
    const lines = anonymous
      ? [
          `"${game.name}" just pulled in a quiet visitor.`,
          `Someone wandered into "${game.name}". mysterious little traffic.`,
          `"${game.name}" got played. no name, just footprints.`,
        ]
      : [
          `${subject} just played "${game.name}". your world is moving.`,
          `${subject} entered "${game.name}" and left the lights on.`,
          `${subject} checked out "${game.name}". tiny audience forming.`,
        ];

    await notifyUser(game.owner_id, {
      type: 'social',
      action: 'game_played',
      title: 'Someone played your game',
      body: pick(lines),
      actorUserId: playedByUserId,
      gameId,
      data: { type: 'social', action: 'game_played', gameId, userId: playedByUserId, anonymous },
      dedupeKey: `game_played:${gameId}`,
    });
  } catch (error) {
    console.error('[Notifications] Game play notification error:', error);
  }
}

async function notifyGameReady(userId, draftId, title) {
  try {
    await notifyUser(userId, {
      type: 'creation',
      action: 'game_ready',
      title: 'Your game finished cooking',
      body: `"${title || 'Your game'}" is out of the forge. Come inspect the chaos.`,
      gameId: null,
      data: { type: 'creation', action: 'game_ready', draftId },
      dedupeKey: `game_ready:${draftId}`,
    }, { priority: 'high', minGapMinutes: 0 });
  } catch (error) {
    console.error('[Notifications] Game ready notification error:', error);
  }
}

async function notifyTrendingGame(userIds, gameName, playerCount, gameId = null) {
  const lines = [
    `"${gameName}" is doing numbers right now. suspiciously playable.`,
    `${playerCount}+ people found "${gameName}" before you did.`,
    `"${gameName}" has that weird pull today. go see why.`,
  ];
  return sendPushNotification(
    userIds,
    'Trending game spotted',
    pick(lines),
    { type: 'fomo', action: 'trending', gameName, gameId },
    { action: 'trending', gameId, dedupeKey: `trending:${gameId || gameName}` },
  );
}

async function sendTrendingGameSuggestions() {
  try {
    const gameRes = await pool.query(
      `SELECT g.id, g.name, g.plays, ag.user_id AS owner_id
       FROM games g
       JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       WHERE COALESCE(g.plays, 0) > 0
       ORDER BY COALESCE(g.plays, 0) DESC, g.created_at DESC
       LIMIT 1`,
    );
    const game = gameRes.rows[0];
    if (!game) return;

    const users = await db.getAllUsersWithTokens();
    const recipients = users
      .map((user) => user.id)
      .filter((id) => id && id !== game.owner_id)
      .slice(0, 250);

    if (recipients.length === 0) return;
    await notifyTrendingGame(recipients, game.name, Math.max(Number(game.plays || 0), 1), game.id);
  } catch (error) {
    console.error('[Notifications] Trending suggestions error:', error);
  }
}

async function notifyLike(gameId, likedByUserId, gameOwnerId) {
  if (gameOwnerId) {
    const actor = await db.getUserById(likedByUserId);
    return notifyUser(gameOwnerId, {
      type: 'social',
      action: 'game_liked',
      title: 'Your game got liked',
      body: `${compactName(actor)} liked your game.`,
      actorUserId: likedByUserId,
      gameId,
      data: { type: 'social', action: 'game_liked', gameId, userId: likedByUserId },
      dedupeKey: `game_liked:${gameId}:${likedByUserId}`,
    }, { cooldownMinutes: 10080 });
  }
  return notifyGameLiked(gameId, likedByUserId);
}

async function notifyComment(gameId, commentedByUserId, gameOwnerId, commentText) {
  const actor = await db.getUserById(commentedByUserId);
  if (!actor || !gameOwnerId || gameOwnerId === commentedByUserId) return;
  return notifyUser(gameOwnerId, {
    type: 'social',
    action: 'comment',
    title: 'New comment',
    body: `${compactName(actor)}: ${String(commentText || '').slice(0, 70)}`,
    actorUserId: commentedByUserId,
    gameId,
    data: { type: 'social', action: 'comment', gameId, userId: commentedByUserId },
    dedupeKey: `comment:${gameId}:${commentedByUserId}:${String(commentText || '').slice(0, 40)}`,
  }, { dailyLimit: 12, minGapMinutes: 4, cooldownMinutes: 30 });
}

async function notifyFollow(followerId, followedUserId) {
  try {
    const follower = await db.getUserById(followerId);
    if (!follower || followerId === followedUserId) return;

    await notifyUser(followedUserId, {
      type: 'social',
      action: 'follow',
      title: compactName(follower),
      body: 'started following you',
      actorUserId: followerId,
      data: { type: 'social', action: 'follow', userId: followerId },
      dedupeKey: `follow:${followerId}:${followedUserId}`,
    });
  } catch (error) {
    console.error('[Notifications] Follow notification error:', error);
  }
}

async function notifyMessage(senderId, recipientId, messagePreview) {
  try {
    const sender = await db.getUserById(senderId);
    if (!sender || senderId === recipientId) return;

    await notifyUser(recipientId, {
      type: 'message',
      action: 'message',
      title: compactName(sender),
      body: String(messagePreview || '').slice(0, 100),
      actorUserId: senderId,
      data: { type: 'message', userId: senderId, avatar: sender.avatar },
      dedupeKey: `message:${senderId}:${recipientId}`,
    });
  } catch (error) {
    console.error('[Notifications] Message notification error:', error);
  }
}

async function notifyScoreBeaten(gameId, beatenByUserId, originalUserId, newScore) {
  const actor = await db.getUserById(beatenByUserId);
  if (!actor || beatenByUserId === originalUserId) return;
  return notifyUser(originalUserId, {
    type: 'social',
    action: 'score_beaten',
    title: 'Score got sniped',
    body: `${compactName(actor)} beat your score with ${newScore}.`,
    actorUserId: beatenByUserId,
    gameId,
    data: { type: 'social', action: 'score_beaten', gameId, userId: beatenByUserId },
    dedupeKey: `score_beaten:${gameId}:${originalUserId}`,
  }, { dailyLimit: 8, cooldownMinutes: 120 });
}

async function notifyNewGames(userIds, gameCount) {
  return sendPushNotification(
    userIds,
    'Fresh games dropped',
    `${gameCount} new worlds just appeared. browse carefully.`,
    { type: 'engagement', action: 'new_games' },
    { action: 'trending', dedupeKey: `new_games:${new Date().toISOString().slice(0, 10)}` },
  );
}

async function notifyStreak(userId, streakDays) {
  return notifyUser(userId, {
    type: 'engagement',
    action: 'streak',
    title: `${streakDays}-day streak`,
    body: `Still alive. keep the streak weird.`,
    data: { type: 'engagement', action: 'streak', days: streakDays },
    dedupeKey: `streak:${userId}:${new Date().toISOString().slice(0, 10)}`,
  }, { dailyLimit: 1, cooldownMinutes: 1440 });
}

async function notifyLeaderboardPosition(userId, gameId, position) {
  return notifyUser(userId, {
    type: 'engagement',
    action: 'leaderboard',
    title: `You're #${position}`,
    body: 'The board noticed you. defend the spot.',
    gameId,
    data: { type: 'engagement', action: 'leaderboard', gameId, position },
    dedupeKey: `leaderboard:${gameId}:${userId}:${position}`,
  }, { dailyLimit: 4, cooldownMinutes: 360 });
}

async function notifyDailyChallenge(userIds, challengeDescription) {
  return sendPushNotification(
    userIds,
    'Daily challenge',
    challengeDescription,
    { type: 'engagement', action: 'daily_challenge' },
    { action: 'reengagement', dedupeKey: `daily_challenge:${new Date().toISOString().slice(0, 10)}` },
  );
}

async function notifyInactive(userId, hoursInactive) {
  const lines = [
    'A few strange games appeared while you were gone.',
    'Your feed got weirder. come inspect it.',
    'There is new playable nonsense waiting for you.',
  ];
  return notifyUser(userId, {
    type: 're-engagement',
    action: 'reengagement',
    title: 'GameTok shifted a little',
    body: pick(lines),
    data: { type: 're-engagement', action: 'inactive', hours: hoursInactive },
    dedupeKey: `inactive:${userId}`,
  });
}

async function notifyDailyReward(userId, rewardAmount) {
  return notifyUser(userId, {
    type: 're-engagement',
    action: 'reward',
    title: 'Reward waiting',
    body: `${rewardAmount} coins are sitting there looking unemployed.`,
    data: { type: 're-engagement', action: 'daily_reward', amount: rewardAmount },
    dedupeKey: `daily_reward:${userId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

async function notifyFriendsPlaying(userId, friendNames) {
  const friendList = (friendNames || []).slice(0, 3).join(', ');
  return notifyUser(userId, {
    type: 're-engagement',
    action: 'reengagement',
    title: 'Friends are active',
    body: `${friendList || 'Someone you follow'} is playing right now.`,
    data: { type: 're-engagement', action: 'friends_playing' },
    dedupeKey: `friends_playing:${userId}`,
  }, { cooldownMinutes: 360, dailyLimit: 2 });
}

async function notifyLimitedTimeEvent(userIds, eventName, hoursLeft) {
  return sendPushNotification(
    userIds,
    eventName,
    `${hoursLeft}h left. if you blink, it leaves.`,
    { type: 'fomo', action: 'limited_event', event: eventName, hoursLeft },
    { action: 'trending', dedupeKey: `event:${eventName}` },
  );
}

async function notifyDoubleXP(userIds, minutesLeft) {
  return sendPushNotification(
    userIds,
    'Double XP is live',
    `${minutesLeft} minutes of boosted chaos.`,
    { type: 'fomo', action: 'double_xp', minutesLeft },
    { action: 'trending', dedupeKey: `double_xp:${new Date().toISOString().slice(0, 10)}` },
  );
}

async function notifyFriendAchievement(userId, friendName, achievementName) {
  return notifyUser(userId, {
    type: 'fomo',
    action: 'friend_achievement',
    title: `${friendName} unlocked something`,
    body: `"${achievementName}". your move.`,
    data: { type: 'fomo', action: 'friend_achievement', achievement: achievementName },
    dedupeKey: `friend_achievement:${userId}:${friendName}:${achievementName}`,
  }, { dailyLimit: 3, cooldownMinutes: 360 });
}

async function sendDailyInactiveNotifications() {
  try {
    const inactiveUsers = await db.getInactiveUsers(24);
    console.log(`[Notifications] Found ${inactiveUsers.length} inactive users to ping`);
    for (const user of inactiveUsers) {
      await notifyInactive(user.id, user.hours_inactive || 24);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (error) {
    console.error('[Notifications] Re-engagement error:', error);
  }
}

async function sendDailyRewardNotifications() {
  try {
    const users = await db.getUsersWithPendingRewards();
    for (const user of users) {
      await notifyDailyReward(user.id, user.reward_amount || user.rewardAmount || 100);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error('[Notifications] Daily reward error:', error);
  }
}

async function sendFriendsPlayingNotifications() {
  try {
    const users = await db.getUsersWithActiveFriends();
    for (const user of users) {
      await notifyFriendsPlaying(user.id, user.active_friend_names || user.activeFriendNames || []);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error('[Notifications] Friends playing error:', error);
  }
}

export {
  sendPushNotification,
  notifyUser,
  notifyLike,
  notifyGameLiked,
  notifyGamePlayed,
  notifyComment,
  notifyFollow,
  notifyMessage,
  notifyScoreBeaten,
  notifyGameReady,
  notifyNewGames,
  notifyStreak,
  notifyLeaderboardPosition,
  notifyDailyChallenge,
  notifyInactive,
  notifyDailyReward,
  notifyFriendsPlaying,
  notifyLimitedTimeEvent,
  notifyDoubleXP,
  notifyTrendingGame,
  sendTrendingGameSuggestions,
  notifyFriendAchievement,
  sendDailyInactiveNotifications,
  sendDailyRewardNotifications,
  sendFriendsPlayingNotifications,
};
