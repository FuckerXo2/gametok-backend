/**
 * Multiplayer API Endpoints
 * 
 * Handles:
 * - Matchmaking queue
 * - Match creation and management
 * - Game challenges
 * - Match results and history
 */

import pool from './db.js';

// ============================================
// MATCHMAKING QUEUE
// ============================================

/**
 * Join matchmaking queue
 */
export const joinQueue = async (req, res) => {
  const { matchType } = req.body; // '1v1' or '2v2'
  const userId = req.user.id;

  if (!['1v1', '2v2'].includes(matchType)) {
    return res.status(400).json({ error: 'Invalid match type' });
  }

  const client = await pool.connect();
  try {
    // Check if user is already in queue
    const existing = await client.query(
      `SELECT id FROM matchmaking_queue 
       WHERE user_id = $1 AND status = 'waiting'`,
      [userId]
    );

    if (existing.rows.length > 0) {
      return res.json({ 
        queueId: existing.rows[0].id,
        alreadyInQueue: true,
        estimatedWait: 15 
      });
    }

    // Add to queue
    const result = await client.query(
      `INSERT INTO matchmaking_queue (user_id, match_type)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, matchType]
    );

    // Try to find a match immediately
    const match = await findMatch(client, userId, matchType);

    if (match) {
      return res.json({
        queueId: result.rows[0].id,
        matchFound: true,
        matchId: match.matchId,
        opponent: match.opponent
      });
    }

    res.json({
      queueId: result.rows[0].id,
      estimatedWait: 15,
      matchFound: false
    });
  } catch (error) {
    console.error('Join queue error:', error);
    res.status(500).json({ error: 'Failed to join queue' });
  } finally {
    client.release();
  }
};

/**
 * Leave matchmaking queue
 */
export const leaveQueue = async (req, res) => {
  const { queueId } = req.body;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE matchmaking_queue 
       SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status = 'waiting'`,
      [queueId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Leave queue error:', error);
    res.status(500).json({ error: 'Failed to leave queue' });
  } finally {
    client.release();
  }
};

/**
 * Check queue status
 */
export const getQueueStatus = async (req, res) => {
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT q.id, q.match_type, q.status, q.joined_at,
              m.id as match_id
       FROM matchmaking_queue q
       LEFT JOIN match_participants mp ON mp.user_id = q.user_id
       LEFT JOIN multiplayer_matches m ON m.id = mp.match_id AND m.status IN ('waiting', 'active')
       WHERE q.user_id = $1 AND q.status = 'waiting'
       ORDER BY q.joined_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ inQueue: false });
    }

    const queue = result.rows[0];
    
    if (queue.match_id) {
      // Match found!
      return res.json({
        inQueue: true,
        matchFound: true,
        matchId: queue.match_id
      });
    }

    res.json({
      inQueue: true,
      queueId: queue.id,
      matchType: queue.match_type,
      waitTime: Math.floor((Date.now() - new Date(queue.joined_at).getTime()) / 1000)
    });
  } catch (error) {
    console.error('Queue status error:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  } finally {
    client.release();
  }
};

/**
 * Find a match for a user in queue
 */
async function findMatch(client, userId, matchType) {
  // Find another user waiting in queue
  const opponent = await client.query(
    `SELECT q.user_id, u.username, u.display_name, u.avatar
     FROM matchmaking_queue q
     JOIN users u ON u.id = q.user_id
     WHERE q.match_type = $1 
       AND q.status = 'waiting'
       AND q.user_id != $2
     ORDER BY q.joined_at ASC
     LIMIT 1`,
    [matchType, userId]
  );

  if (opponent.rows.length === 0) {
    return null;
  }

  const opponentData = opponent.rows[0];

  // Create match
  const match = await client.query(
    `INSERT INTO multiplayer_matches (match_type, status)
     VALUES ($1, 'waiting')
     RETURNING id`,
    [matchType]
  );

  const matchId = match.rows[0].id;

  // Add both players to match
  await client.query(
    `INSERT INTO match_participants (match_id, user_id, team)
     VALUES ($1, $2, 1), ($1, $3, 2)`,
    [matchId, userId, opponentData.user_id]
  );

  // Update queue status
  await client.query(
    `UPDATE matchmaking_queue
     SET status = 'matched', matched_at = NOW()
     WHERE user_id IN ($1, $2) AND status = 'waiting'`,
    [userId, opponentData.user_id]
  );

  return {
    matchId,
    opponent: {
      id: opponentData.user_id,
      username: opponentData.username,
      displayName: opponentData.display_name,
      avatar: opponentData.avatar
    }
  };
}

// ============================================
// MATCHES
// ============================================

/**
 * Get active matches for user
 */
export const getActiveMatches = async (req, res) => {
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT m.id, m.game_id, m.match_type, m.status, m.created_at,
              json_agg(json_build_object(
                'userId', u.id,
                'username', u.username,
                'displayName', u.display_name,
                'avatar', u.avatar,
                'team', mp.team,
                'score', mp.score
              )) as participants
       FROM multiplayer_matches m
       JOIN match_participants mp ON mp.match_id = m.id
       JOIN users u ON u.id = mp.user_id
       WHERE m.id IN (
         SELECT match_id FROM match_participants WHERE user_id = $1
       )
       AND m.status IN ('waiting', 'active')
       GROUP BY m.id
       ORDER BY m.created_at DESC`,
      [userId]
    );

    res.json({ matches: result.rows });
  } catch (error) {
    console.error('Get active matches error:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  } finally {
    client.release();
  }
};

/**
 * Get match details
 */
export const getMatch = async (req, res) => {
  const { matchId } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT m.id, m.game_id, m.match_type, m.status, m.winner_team,
              m.created_at, m.started_at, m.ended_at,
              json_agg(json_build_object(
                'userId', u.id,
                'username', u.username,
                'displayName', u.display_name,
                'avatar', u.avatar,
                'team', mp.team,
                'score', mp.score,
                'status', mp.status
              )) as participants
       FROM multiplayer_matches m
       JOIN match_participants mp ON mp.match_id = m.id
       JOIN users u ON u.id = mp.user_id
       WHERE m.id = $1
       GROUP BY m.id`,
      [matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Check if user is in this match
    const match = result.rows[0];
    const isParticipant = match.participants.some(p => p.userId === userId);
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ match });
  } catch (error) {
    console.error('Get match error:', error);
    res.status(500).json({ error: 'Failed to get match' });
  } finally {
    client.release();
  }
};

/**
 * Set game for match (after match found, players choose game)
 */
export const setMatchGame = async (req, res) => {
  const { matchId } = req.params;
  const { gameId } = req.body;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    // Verify user is in match
    const participant = await client.query(
      `SELECT id FROM match_participants 
       WHERE match_id = $1 AND user_id = $2`,
      [matchId, userId]
    );

    if (participant.rows.length === 0) {
      return res.status(403).json({ error: 'Not in this match' });
    }

    // Update match with game
    await client.query(
      `UPDATE multiplayer_matches
       SET game_id = $1, status = 'active', started_at = NOW()
       WHERE id = $2 AND status = 'waiting'`,
      [gameId, matchId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Set match game error:', error);
    res.status(500).json({ error: 'Failed to set game' });
  } finally {
    client.release();
  }
};

/**
 * Update player score in match
 */
export const updateScore = async (req, res) => {
  const { matchId } = req.params;
  const { score } = req.body;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE match_participants
       SET score = $1, status = 'playing'
       WHERE match_id = $2 AND user_id = $3`,
      [score, matchId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update score error:', error);
    res.status(500).json({ error: 'Failed to update score' });
  } finally {
    client.release();
  }
};

/**
 * Complete match and determine winner
 */
export const completeMatch = async (req, res) => {
  const { matchId } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get match participants and scores
    const participants = await client.query(
      `SELECT mp.user_id, mp.team, mp.score, m.game_id, m.match_type
       FROM match_participants mp
       JOIN multiplayer_matches m ON m.id = mp.match_id
       WHERE mp.match_id = $1`,
      [matchId]
    );

    if (participants.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Match not found' });
    }

    // Calculate team scores
    const team1Score = participants.rows
      .filter(p => p.team === 1)
      .reduce((sum, p) => sum + p.score, 0);
    
    const team2Score = participants.rows
      .filter(p => p.team === 2)
      .reduce((sum, p) => sum + p.score, 0);

    const winnerTeam = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null;

    // Update match status
    await client.query(
      `UPDATE multiplayer_matches
       SET status = 'completed', ended_at = NOW(), winner_team = $1
       WHERE id = $2`,
      [winnerTeam, matchId]
    );

    // Create match results for each player
    const gameId = participants.rows[0].game_id;
    const matchType = participants.rows[0].match_type;

    for (const player of participants.rows) {
      const opponent = participants.rows.find(p => p.user_id !== player.user_id);
      const result = winnerTeam === null ? 'draw' : 
                     player.team === winnerTeam ? 'win' : 'loss';
      
      const coinsEarned = result === 'win' ? 100 : result === 'draw' ? 50 : 25;
      const xpEarned = result === 'win' ? 50 : result === 'draw' ? 25 : 10;

      await client.query(
        `INSERT INTO match_results 
         (match_id, user_id, opponent_id, game_id, match_type, result, 
          user_score, opponent_score, coins_earned, xp_earned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [matchId, player.user_id, opponent?.user_id, gameId, matchType, result,
         player.score, opponent?.score || 0, coinsEarned, xpEarned]
      );

      // Award coins and XP
      await client.query(
        `INSERT INTO user_points (user_id, balance, lifetime_earned)
         VALUES ($1, $2, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET balance = user_points.balance + $2,
             lifetime_earned = user_points.lifetime_earned + $2`,
        [player.user_id, coinsEarned]
      );

      await client.query(
        `INSERT INTO user_levels (user_id, xp)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET xp = user_levels.xp + $2`,
        [player.user_id, xpEarned]
      );
    }

    await client.query('COMMIT');

    res.json({ 
      success: true,
      winnerTeam,
      team1Score,
      team2Score
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Complete match error:', error);
    res.status(500).json({ error: 'Failed to complete match' });
  } finally {
    client.release();
  }
};

/**
 * Get match history for user
 */
export const getMatchHistory = async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 20;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT mr.*, 
              u.username as opponent_username,
              u.display_name as opponent_display_name,
              u.avatar as opponent_avatar,
              g.name as game_name,
              g.thumbnail as game_thumbnail
       FROM match_results mr
       LEFT JOIN users u ON u.id = mr.opponent_id
       LEFT JOIN games g ON g.id = mr.game_id
       WHERE mr.user_id = $1
       ORDER BY mr.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ history: result.rows });
  } catch (error) {
    console.error('Get match history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  } finally {
    client.release();
  }
};

// ============================================
// GAME CHALLENGES
// ============================================

/**
 * Send challenge to friend
 */
export const sendChallenge = async (req, res) => {
  const { toUserId, gameId, matchType, message } = req.body;
  const fromUserId = req.user.id;

  if (!['1v1', '2v2'].includes(matchType)) {
    return res.status(400).json({ error: 'Invalid match type' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO game_challenges (from_user_id, to_user_id, game_id, match_type, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [fromUserId, toUserId, gameId, matchType, message]
    );

    res.json({ 
      success: true,
      challengeId: result.rows[0].id
    });
  } catch (error) {
    console.error('Send challenge error:', error);
    res.status(500).json({ error: 'Failed to send challenge' });
  } finally {
    client.release();
  }
};

/**
 * Accept challenge
 */
export const acceptChallenge = async (req, res) => {
  const { challengeId } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get challenge
    const challenge = await client.query(
      `SELECT * FROM game_challenges
       WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
      [challengeId, userId]
    );

    if (challenge.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Challenge not found or expired' });
    }

    const { from_user_id, game_id, match_type } = challenge.rows[0];

    // Create match
    const match = await client.query(
      `INSERT INTO multiplayer_matches (game_id, match_type, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      [game_id, match_type]
    );

    const matchId = match.rows[0].id;

    // Add participants
    await client.query(
      `INSERT INTO match_participants (match_id, user_id, team)
       VALUES ($1, $2, 1), ($1, $3, 2)`,
      [matchId, from_user_id, userId]
    );

    // Update challenge
    await client.query(
      `UPDATE game_challenges
       SET status = 'accepted', match_id = $1, responded_at = NOW()
       WHERE id = $2`,
      [matchId, challengeId]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true,
      matchId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Accept challenge error:', error);
    res.status(500).json({ error: 'Failed to accept challenge' });
  } finally {
    client.release();
  }
};

/**
 * Decline challenge
 */
export const declineChallenge = async (req, res) => {
  const { challengeId } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE game_challenges
       SET status = 'declined', responded_at = NOW()
       WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
      [challengeId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Decline challenge error:', error);
    res.status(500).json({ error: 'Failed to decline challenge' });
  } finally {
    client.release();
  }
};

/**
 * Get received challenges
 */
export const getReceivedChallenges = async (req, res) => {
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT c.*,
              u.username as from_username,
              u.display_name as from_display_name,
              u.avatar as from_avatar,
              g.name as game_name,
              g.thumbnail as game_thumbnail
       FROM game_challenges c
       JOIN users u ON u.id = c.from_user_id
       LEFT JOIN games g ON g.id = c.game_id
       WHERE c.to_user_id = $1 
         AND c.status = 'pending'
         AND c.expires_at > NOW()
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({ challenges: result.rows });
  } catch (error) {
    console.error('Get challenges error:', error);
    res.status(500).json({ error: 'Failed to get challenges' });
  } finally {
    client.release();
  }
};

// ============================================
// CLEANUP TASKS
// ============================================

/**
 * Expire old challenges (run periodically)
 */
export const expireOldChallenges = async () => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE game_challenges
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`
    );
  } catch (error) {
    console.error('Expire challenges error:', error);
  } finally {
    client.release();
  }
};

/**
 * Cancel abandoned matches (run periodically)
 */
export const cancelAbandonedMatches = async () => {
  const client = await pool.connect();
  try {
    // Cancel matches that have been waiting for more than 5 minutes
    await client.query(
      `UPDATE multiplayer_matches
       SET status = 'cancelled'
       WHERE status = 'waiting' 
         AND created_at < NOW() - INTERVAL '5 minutes'`
    );
  } catch (error) {
    console.error('Cancel matches error:', error);
  } finally {
    client.release();
  }
};
