/**
 * Multiplayer Tables Migration
 * 
 * Creates tables for:
 * - Multiplayer matches (1v1 and 2v2)
 * - Match participants
 * - Game challenges (friend invites)
 * - Matchmaking queue
 */

import pool from '../src/db.js';

export const runMultiplayerMigration = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Multiplayer matches table
      CREATE TABLE IF NOT EXISTS multiplayer_matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id VARCHAR(100) NOT NULL,
        match_type VARCHAR(10) NOT NULL CHECK (match_type IN ('1v1', '2v2')),
        status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
        winner_team INTEGER, -- 1 or 2 (NULL if draw or cancelled)
        created_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );

      -- Match participants table
      CREATE TABLE IF NOT EXISTS match_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        team INTEGER NOT NULL CHECK (team IN (1, 2)),
        score INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'joined' CHECK (status IN ('joined', 'ready', 'playing', 'disconnected', 'finished')),
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP,
        UNIQUE(match_id, user_id)
      );

      -- Game challenges table (friend invites)
      CREATE TABLE IF NOT EXISTS game_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100),
        match_type VARCHAR(10) NOT NULL CHECK (match_type IN ('1v1', '2v2')),
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
        match_id UUID REFERENCES multiplayer_matches(id) ON DELETE SET NULL,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '10 minutes'),
        responded_at TIMESTAMP
      );

      -- Matchmaking queue table
      CREATE TABLE IF NOT EXISTS matchmaking_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        match_type VARCHAR(10) NOT NULL CHECK (match_type IN ('1v1', '2v2')),
        status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled')),
        preferences JSONB DEFAULT '{}', -- game preferences, skill level, etc.
        joined_at TIMESTAMP DEFAULT NOW(),
        matched_at TIMESTAMP,
        UNIQUE(user_id, match_type, status)
      );

      -- Match history view helper
      CREATE TABLE IF NOT EXISTS match_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        opponent_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) NOT NULL,
        match_type VARCHAR(10) NOT NULL,
        result VARCHAR(10) CHECK (result IN ('win', 'loss', 'draw')),
        user_score INTEGER DEFAULT 0,
        opponent_score INTEGER DEFAULT 0,
        coins_earned INTEGER DEFAULT 0,
        xp_earned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(match_id, user_id)
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_multiplayer_matches_status ON multiplayer_matches(status);
      CREATE INDEX IF NOT EXISTS idx_multiplayer_matches_game ON multiplayer_matches(game_id);
      CREATE INDEX IF NOT EXISTS idx_match_participants_match ON match_participants(match_id);
      CREATE INDEX IF NOT EXISTS idx_match_participants_user ON match_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_challenges_to_user ON game_challenges(to_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_game_challenges_from_user ON game_challenges(from_user_id);
      CREATE INDEX IF NOT EXISTS idx_game_challenges_expires ON game_challenges(expires_at) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_type_status ON matchmaking_queue(match_type, status);
      CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_user ON match_results(user_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results(match_id);
    `);

    console.log('✅ Multiplayer tables created successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Multiplayer migration error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMultiplayerMigration()
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
