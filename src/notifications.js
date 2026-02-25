// Push Notifications Service - All 4 Types
const { Expo } = require('expo-server-sdk');
const db = require('./db');

const expo = new Expo();

// Send push notification to user(s)
async function sendPushNotification(userIds, title, body, data = {}) {
  try {
    // Get push tokens for users
    const tokens = await db.getPushTokens(userIds);
    if (!tokens || tokens.length === 0) {
      console.log('[Notifications] No push tokens found for users:', userIds);
      return;
    }

    // Create messages
    const messages = tokens
      .filter(token => Expo.isExpoPushToken(token))
      .map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
        badge: 1,
      }));

    if (messages.length === 0) {
      console.log('[Notifications] No valid Expo push tokens');
      return;
    }

    // Send in chunks
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('[Notifications] Error sending chunk:', error);
      }
    }

    console.log('[Notifications] Sent:', tickets.length, 'notifications');
    return tickets;
  } catch (error) {
    console.error('[Notifications] Send error:', error);
  }
}

// ============================================
// TYPE 1: SOCIAL NOTIFICATIONS
// ============================================

async function notifyLike(gameId, likedByUserId, gameOwnerId) {
  try {
    const likedByUser = await db.getUserById(likedByUserId);
    if (!likedByUser) return;

    await sendPushNotification(
      [gameOwnerId],
      likedByUser.displayName || likedByUser.username,
      'liked your game',
      { type: 'social', action: 'like', gameId, userId: likedByUserId }
    );
  } catch (error) {
    console.error('[Notifications] Like notification error:', error);
  }
}

async function notifyComment(gameId, commentedByUserId, gameOwnerId, commentText) {
  try {
    const commentedByUser = await db.getUserById(commentedByUserId);
    if (!commentedByUser) return;

    await sendPushNotification(
      [gameOwnerId],
      '💬 New Comment',
      `${commentedByUser.displayName || commentedByUser.username}: ${commentText.substring(0, 50)}${commentText.length > 50 ? '...' : ''}`,
      { type: 'social', action: 'comment', gameId, userId: commentedByUserId }
    );
  } catch (error) {
    console.error('[Notifications] Comment notification error:', error);
  }
}

async function notifyFollow(followerId, followedUserId) {
  try {
    const follower = await db.getUserById(followerId);
    if (!follower) return;

    // Check if it's a follow-back (they already follow the follower)
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    const followBackCheck = await pool.query(
      'SELECT * FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followedUserId, followerId]
    );
    
    const isFollowBack = followBackCheck.rows.length > 0;
    const action = isFollowBack ? 'started following you back' : 'just followed you';

    await sendPushNotification(
      [followedUserId],
      follower.displayName || follower.username,
      action,
      { type: 'social', action: 'follow', userId: followerId, isFollowBack }
    );
  } catch (error) {
    console.error('[Notifications] Follow notification error:', error);
  }
}
  } catch (error) {
    console.error('[Notifications] Follow notification error:', error);
  }
}

async function notifyMessage(senderId, recipientId, messagePreview) {
  try {
    const sender = await db.getUserById(senderId);
    if (!sender) return;

    await sendPushNotification(
      [recipientId],
      `💌 ${sender.displayName || sender.username}`,
      messagePreview.substring(0, 100),
      { type: 'message', userId: senderId }
    );
  } catch (error) {
    console.error('[Notifications] Message notification error:', error);
  }
}

async function notifyScoreBeaten(gameId, beatenByUserId, originalUserId, newScore) {
  try {
    const beatenByUser = await db.getUserById(beatenByUserId);
    if (!beatenByUser) return;

    const messages = [
      { title: '🏆 Score Beaten!', body: `${beatenByUser.displayName || beatenByUser.username} just beat your high score with ${newScore} points!` },
      { title: '😱 Oh No!', body: `${beatenByUser.displayName || beatenByUser.username} crushed your record: ${newScore} points` },
      { title: '🔥 Challenge Accepted?', body: `${beatenByUser.displayName || beatenByUser.username} scored ${newScore}. Can you beat it?` },
      { title: '⚡ New High Score', body: `${beatenByUser.displayName || beatenByUser.username} just took your #1 spot with ${newScore}!` },
      { title: '💪 Game On!', body: `${beatenByUser.displayName || beatenByUser.username} beat you: ${newScore} points. Your move!` },
    ];
    
    const message = messages[Math.floor(Math.random() * messages.length)];

    await sendPushNotification(
      [originalUserId],
      message.title,
      message.body,
      { type: 'social', action: 'score_beaten', gameId, userId: beatenByUserId }
    );
  } catch (error) {
    console.error('[Notifications] Score beaten notification error:', error);
  }
}

// ============================================
// TYPE 2: ENGAGEMENT NOTIFICATIONS
// ============================================

async function notifyNewGames(userIds, gameCount) {
  try {
    const messages = [
      { title: '🎮 New Games Added!', body: `${gameCount} fresh games just dropped. Check them out now!` },
      { title: '🔥 Hot Off the Press', body: `${gameCount} brand new games are waiting for you!` },
      { title: '✨ Fresh Content', body: `We just added ${gameCount} awesome games. Play now!` },
      { title: '🚀 New Arrivals', body: `${gameCount} new games just landed. Don't miss out!` },
      { title: '🎯 Game Update', body: `${gameCount} new games added today. Time to play!` },
    ];
    
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    await sendPushNotification(
      userIds,
      message.title,
      message.body,
      { type: 'engagement', action: 'new_games' }
    );
  } catch (error) {
    console.error('[Notifications] New games notification error:', error);
  }
}

async function notifyStreak(userId, streakDays) {
  try {
    const emojis = ['🔥', '💪', '⚡', '🌟', '🚀'];
    const emoji = emojis[Math.min(streakDays - 1, emojis.length - 1)];
    
    await sendPushNotification(
      [userId],
      `${emoji} ${streakDays}-Day Streak!`,
      `You're on fire! Don't break your streak today.`,
      { type: 'engagement', action: 'streak', days: streakDays }
    );
  } catch (error) {
    console.error('[Notifications] Streak notification error:', error);
  }
}

async function notifyLeaderboardPosition(userId, gameId, position) {
  try {
    const messages = {
      1: { title: '🥇 You\'re #1!', body: 'You\'re at the top of the leaderboard!' },
      2: { title: '🥈 You\'re #2!', body: 'So close to #1! Keep playing!' },
      3: { title: '🥉 You\'re #3!', body: 'You\'re in the top 3! Can you reach #1?' },
    };

    const message = messages[position] || {
      title: `🏆 You're #${position}!`,
      body: `You're climbing the leaderboard. Keep it up!`
    };

    await sendPushNotification(
      [userId],
      message.title,
      message.body,
      { type: 'engagement', action: 'leaderboard', gameId, position }
    );
  } catch (error) {
    console.error('[Notifications] Leaderboard notification error:', error);
  }
}

async function notifyDailyChallenge(userIds, challengeDescription) {
  try {
    await sendPushNotification(
      userIds,
      '🎯 Daily Challenge',
      challengeDescription,
      { type: 'engagement', action: 'daily_challenge' }
    );
  } catch (error) {
    console.error('[Notifications] Daily challenge notification error:', error);
  }
}

// ============================================
// TYPE 3: RE-ENGAGEMENT NOTIFICATIONS
// ============================================

async function notifyInactive(userId, daysInactive) {
  try {
    const messages = [
      { title: '😢 We miss you!', body: 'Come back and play your favorite games!' },
      { title: '🎮 Your games are waiting', body: 'It\'s been a while! Jump back in.' },
      { title: '👋 Hey stranger!', body: 'Your friends have been playing. Join them!' },
      { title: '🌟 New games added', body: 'Check out what you\'ve been missing!' },
      { title: '💔 Where did you go?', body: 'We saved your progress. Come back!' },
      { title: '🎯 Ready to play?', body: 'Your favorite games miss you!' },
      { title: '🔥 Don\'t lose your streak', body: 'Get back in the game before it\'s too late!' },
      { title: '⚡ Quick game?', body: 'Just 5 minutes. You know you want to!' },
    ];

    const message = messages[Math.floor(Math.random() * messages.length)];

    await sendPushNotification(
      [userId],
      message.title,
      message.body,
      { type: 're-engagement', action: 'inactive', days: daysInactive }
    );
  } catch (error) {
    console.error('[Notifications] Inactive notification error:', error);
  }
}

async function notifyDailyReward(userId, rewardAmount) {
  try {
    await sendPushNotification(
      [userId],
      '🎁 Daily Reward Ready!',
      `Claim your ${rewardAmount} coins now!`,
      { type: 're-engagement', action: 'daily_reward', amount: rewardAmount }
    );
  } catch (error) {
    console.error('[Notifications] Daily reward notification error:', error);
  }
}

async function notifyFriendsPlaying(userId, friendNames) {
  try {
    const friendList = friendNames.slice(0, 3).join(', ');
    const others = friendNames.length > 3 ? ` and ${friendNames.length - 3} others` : '';

    await sendPushNotification(
      [userId],
      '👥 Friends are playing!',
      `${friendList}${others} are online right now`,
      { type: 're-engagement', action: 'friends_playing' }
    );
  } catch (error) {
    console.error('[Notifications] Friends playing notification error:', error);
  }
}

// ============================================
// TYPE 4: FOMO NOTIFICATIONS
// ============================================

async function notifyLimitedTimeEvent(userIds, eventName, hoursLeft) {
  try {
    await sendPushNotification(
      userIds,
      `⏰ ${eventName} - ${hoursLeft}h left!`,
      `Don't miss out! This event ends soon.`,
      { type: 'fomo', action: 'limited_event', event: eventName, hoursLeft }
    );
  } catch (error) {
    console.error('[Notifications] Limited event notification error:', error);
  }
}

async function notifyDoubleXP(userIds, minutesLeft) {
  try {
    await sendPushNotification(
      userIds,
      '⚡ Double XP Active!',
      `Earn 2x XP for the next ${minutesLeft} minutes. Play now!`,
      { type: 'fomo', action: 'double_xp', minutesLeft }
    );
  } catch (error) {
    console.error('[Notifications] Double XP notification error:', error);
  }
}

async function notifyTrendingGame(userIds, gameName, playerCount) {
  try {
    await sendPushNotification(
      userIds,
      '🔥 Trending Now',
      `${playerCount}+ players are playing ${gameName} right now!`,
      { type: 'fomo', action: 'trending', gameName }
    );
  } catch (error) {
    console.error('[Notifications] Trending game notification error:', error);
  }
}

async function notifyFriendAchievement(userId, friendName, achievementName) {
  try {
    await sendPushNotification(
      [userId],
      '🏅 Friend Achievement',
      `${friendName} just unlocked "${achievementName}". Can you do it too?`,
      { type: 'fomo', action: 'friend_achievement', achievement: achievementName }
    );
  } catch (error) {
    console.error('[Notifications] Friend achievement notification error:', error);
  }
}

// ============================================
// SCHEDULED NOTIFICATIONS (Cron Jobs)
// ============================================

// Run daily at 9 AM to notify inactive users
async function sendDailyInactiveNotifications() {
  try {
    const inactiveUsers = await db.getInactiveUsers(3); // 3+ days inactive
    for (const user of inactiveUsers) {
      await notifyInactive(user.id, user.daysInactive);
      // Space out notifications
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('[Notifications] Daily inactive error:', error);
  }
}

// Run daily at 10 AM to notify about daily rewards
async function sendDailyRewardNotifications() {
  try {
    const users = await db.getUsersWithPendingRewards();
    for (const user of users) {
      await notifyDailyReward(user.id, user.rewardAmount);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('[Notifications] Daily reward error:', error);
  }
}

// Run every hour to check for friends playing
async function sendFriendsPlayingNotifications() {
  try {
    const users = await db.getUsersWithActiveFriends();
    for (const user of users) {
      await notifyFriendsPlaying(user.id, user.activeFriendNames);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('[Notifications] Friends playing error:', error);
  }
}

module.exports = {
  sendPushNotification,
  // Social
  notifyLike,
  notifyComment,
  notifyFollow,
  notifyMessage,
  notifyScoreBeaten,
  // Engagement
  notifyNewGames,
  notifyStreak,
  notifyLeaderboardPosition,
  notifyDailyChallenge,
  // Re-engagement
  notifyInactive,
  notifyDailyReward,
  notifyFriendsPlaying,
  // FOMO
  notifyLimitedTimeEvent,
  notifyDoubleXP,
  notifyTrendingGame,
  notifyFriendAchievement,
  // Scheduled
  sendDailyInactiveNotifications,
  sendDailyRewardNotifications,
  sendFriendsPlayingNotifications,
};
