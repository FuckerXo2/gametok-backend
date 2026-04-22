// PostgreSQL Database Connection
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

// Initialize database tables
export const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        display_name VARCHAR(100),
        avatar TEXT,
        bio TEXT DEFAULT '',
        total_score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        token VARCHAR(255),
        oauth_provider VARCHAR(20),
        oauth_id VARCHAR(255),
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS followers (
        follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id)
      );

      CREATE TABLE IF NOT EXISTS games (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(10),
        color VARCHAR(20),
        thumbnail TEXT,
        preview_video_url TEXT,
        category VARCHAR(50),
        subcategory VARCHAR(64),
        primary_tab VARCHAR(32),
        interaction_type VARCHAR(64),
        classification_confidence REAL,
        classification_tags JSONB DEFAULT '[]'::jsonb,
        discovery_chips JSONB DEFAULT '[]'::jsonb,
        embed_url TEXT,
        plays INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        save_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_plays (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        play_count INTEGER DEFAULT 1,
        first_played_at TIMESTAMP DEFAULT NOW(),
        last_played_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS anonymous_game_plays (
        client_id VARCHAR(255) NOT NULL,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        play_count INTEGER DEFAULT 1,
        first_played_at TIMESTAMP DEFAULT NOW(),
        last_played_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (client_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS likes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        participant1_id UUID REFERENCES users(id) ON DELETE CASCADE,
        participant2_id UUID REFERENCES users(id) ON DELETE CASCADE,
        streak INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        read_by UUID[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS comment_likes (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, comment_id)
      );

      -- User reports table for flagging objectionable content
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(100) NOT NULL,
        details TEXT,
        content_type VARCHAR(50), -- 'profile', 'message', 'comment'
        content_id UUID,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'actioned', 'dismissed'
        created_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP
      );

      -- Blocked users table
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      );
      
      -- Scan progress table for tracking game size scans
      CREATE TABLE IF NOT EXISTS scan_progress (
        id INTEGER PRIMARY KEY DEFAULT 1,
        is_scanning BOOLEAN DEFAULT FALSE,
        scanned_games INTEGER DEFAULT 0,
        total_games INTEGER DEFAULT 0,
        current_game VARCHAR(255),
        started_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW(),
        CHECK (id = 1)
      );
      
      -- Saved games table (separate from likes)
      CREATE TABLE IF NOT EXISTS saved_games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS push_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        device_type VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, token)
      );

      CREATE TABLE IF NOT EXISTS ai_games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        title VARCHAR(255),
        html_payload TEXT NOT NULL,
        raw_code TEXT NOT NULL,
        artist_code TEXT,
        thumbnail TEXT,
        preview_video_url TEXT,
        category VARCHAR(50),
        subcategory VARCHAR(64),
        primary_tab VARCHAR(32),
        interaction_type VARCHAR(64),
        classification_confidence REAL,
        classification_tags JSONB DEFAULT '[]'::jsonb,
        discovery_chips JSONB DEFAULT '[]'::jsonb,
        edit_history JSONB DEFAULT '[]'::jsonb,
        is_draft BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id);
      CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_plays_game ON game_plays(game_id);
      CREATE INDEX IF NOT EXISTS idx_game_plays_user ON game_plays(user_id);
      CREATE INDEX IF NOT EXISTS idx_anonymous_game_plays_game ON anonymous_game_plays(game_id);
      CREATE INDEX IF NOT EXISTS idx_anonymous_game_plays_client ON anonymous_game_plays(client_id);
      CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
      CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_blocked_users ON blocked_users(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_saved_games_user ON saved_games(user_id);
      CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_ai_games_user ON ai_games(user_id);
      
      -- Insert initial scan progress row
      INSERT INTO scan_progress (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      
      -- Add OAuth columns if they don't exist (migration)
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'oauth_provider') THEN
          ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(20);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'oauth_id') THEN
          ALTER TABLE users ADD COLUMN oauth_id VARCHAR(255);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verified') THEN
          ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'embed_url') THEN
          ALTER TABLE games ADD COLUMN embed_url TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'file_size') THEN
          ALTER TABLE games ADD COLUMN file_size INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'save_count') THEN
          ALTER TABLE games ADD COLUMN save_count INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'developer') THEN
          ALTER TABLE games ADD COLUMN developer VARCHAR(255);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'multiplayer_only') THEN
          ALTER TABLE games ADD COLUMN multiplayer_only BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'preview_video_url') THEN
          ALTER TABLE games ADD COLUMN preview_video_url TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'primary_tab') THEN
          ALTER TABLE games ADD COLUMN primary_tab VARCHAR(32);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'subcategory') THEN
          ALTER TABLE games ADD COLUMN subcategory VARCHAR(64);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'interaction_type') THEN
          ALTER TABLE games ADD COLUMN interaction_type VARCHAR(64);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'classification_confidence') THEN
          ALTER TABLE games ADD COLUMN classification_confidence REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'classification_tags') THEN
          ALTER TABLE games ADD COLUMN classification_tags JSONB DEFAULT '[]'::jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'discovery_chips') THEN
          ALTER TABLE games ADD COLUMN discovery_chips JSONB DEFAULT '[]'::jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'thumbnail') THEN
          ALTER TABLE ai_games ADD COLUMN thumbnail TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'preview_video_url') THEN
          ALTER TABLE ai_games ADD COLUMN preview_video_url TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'category') THEN
          ALTER TABLE ai_games ADD COLUMN category VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'subcategory') THEN
          ALTER TABLE ai_games ADD COLUMN subcategory VARCHAR(64);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'primary_tab') THEN
          ALTER TABLE ai_games ADD COLUMN primary_tab VARCHAR(32);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'interaction_type') THEN
          ALTER TABLE ai_games ADD COLUMN interaction_type VARCHAR(64);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'classification_confidence') THEN
          ALTER TABLE ai_games ADD COLUMN classification_confidence REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'classification_tags') THEN
          ALTER TABLE ai_games ADD COLUMN classification_tags JSONB DEFAULT '[]'::jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'discovery_chips') THEN
          ALTER TABLE ai_games ADD COLUMN discovery_chips JSONB DEFAULT '[]'::jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'is_template') THEN
          ALTER TABLE ai_games ADD COLUMN is_template BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'artist_code') THEN
          ALTER TABLE ai_games ADD COLUMN artist_code TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_games' AND column_name = 'edit_history') THEN
          ALTER TABLE ai_games ADD COLUMN edit_history JSONB DEFAULT '[]'::jsonb;
        END IF;
        -- Make password nullable for OAuth users
        ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
        -- Make username nullable for OAuth users (they pick it during onboarding)
        ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);
    console.log('✅ Database tables initialized');
  } finally {
    client.release();
  }
};

export default pool;

// Run additional migrations for game_progress table
export const runMigrations = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) REFERENCES games(id) ON DELETE CASCADE,
        storage_data JSONB DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_game_progress_user_game ON game_progress(user_id, game_id);
    `);
    console.log('✅ Game progress table ready');
  } catch (e) {
    console.log('Game progress migration:', e.message);
  } finally {
    client.release();
  }
};

// Gamification tables
export const runGamificationMigrations = async () => {
  const client = await pool.connect();
  try {
    // Gamification system removed
    console.log('✅ Gamification tables skipped (system removed)');

    // Seed some aspirational rewards
    const rewardCount = await client.query('SELECT COUNT(*) FROM rewards');
    if (parseInt(rewardCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO rewards (name, description, cost, category, stock) VALUES
        ('Custom Username Color', 'Stand out with a colored username', 500, 'cosmetic', NULL),
        ('Profile Badge: OG', 'Show you were here early', 1000, 'badge', NULL),
        ('Profile Badge: VIP', 'Exclusive VIP status badge', 5000, 'badge', NULL),
        ('Ad-Free Hour', 'Play without ads for 1 hour', 200, 'boost', NULL),
        ('2x Points Boost (1 day)', 'Double points for 24 hours', 1000, 'boost', NULL),
        ('$5 Gift Card', 'Amazon/Apple/Google gift card', 50000, 'giftcard', 10),
        ('$10 Gift Card', 'Amazon/Apple/Google gift card', 90000, 'giftcard', 5),
        ('$25 Gift Card', 'Amazon/Apple/Google gift card', 200000, 'giftcard', 2),
        ('GameTOK Merch', 'Exclusive GameTOK t-shirt', 75000, 'merch', 20),
        ('Early Access', 'Get new games before everyone else', 10000, 'perk', NULL)
      `);
      console.log('✅ Default rewards seeded');
    }

  } catch (e) {
    console.log('Gamification migration error:', e.message);
  } finally {
    client.release();
  }
};

// Coin economy config
export const runCoinConfigMigration = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS coin_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        coins_per_usd INTEGER DEFAULT 5667,
        earn_rate_per_second DECIMAL(10,4) DEFAULT 0.2,
        min_withdrawal_usd DECIMAL(10,2) DEFAULT 10.00,
        withdrawal_fee_percent INTEGER DEFAULT 15,
        payouts_enabled BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      );
      
      -- Insert or force update to correct rate
      INSERT INTO coin_config (id, coins_per_usd) VALUES (1, 5667) 
      ON CONFLICT (id) DO UPDATE SET coins_per_usd = 5667;
    `);
    console.log('✅ Coin config table ready');
  } catch (e) {
    console.log('Coin config migration error:', e.message);
  } finally {
    client.release();
  }
};

// Deleted games tracking - prevents re-importing games that were deleted
export const runDeletedGamesMigration = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS deleted_games (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255),
        reason VARCHAR(100),
        deleted_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_deleted_games_reason ON deleted_games(reason);
    `);
    console.log('✅ Deleted games tracking table ready');
  } catch (e) {
    console.log('Deleted games migration error:', e.message);
  } finally {
    client.release();
  }
};

// Game leaderboard table - tracks points per user per game
export const runLeaderboardMigration = async () => {
  const client = await pool.connect();
  try {
    // First check if table exists and has the FK constraint issue
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'game_leaderboard'
      );
    `);

    if (tableCheck.rows[0].exists) {
      // Try to drop the FK constraint if it exists
      try {
        await client.query(`
          ALTER TABLE game_leaderboard DROP CONSTRAINT IF EXISTS game_leaderboard_game_id_fkey;
        `);
        console.log('✅ Dropped FK constraint on game_leaderboard');
      } catch (e) {
        console.log('No FK constraint to drop or already dropped');
      }
    } else {
      // Create the table fresh without FK on game_id
      await client.query(`
        CREATE TABLE game_leaderboard (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          game_id VARCHAR(100) NOT NULL,
          points INTEGER DEFAULT 0,
          play_time INTEGER DEFAULT 0,
          last_played TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, game_id)
        );
        
        CREATE INDEX idx_game_leaderboard_game ON game_leaderboard(game_id);
        CREATE INDEX idx_game_leaderboard_points ON game_leaderboard(game_id, points DESC);
        CREATE INDEX idx_game_leaderboard_user ON game_leaderboard(user_id);
      `);
      console.log('✅ Created game_leaderboard table');
    }

    console.log('✅ Game leaderboard table ready');
  } catch (e) {
    console.log('Leaderboard migration error:', e.message);
  } finally {
    client.release();
  }
};

// Stories table - 24h expiring stories
export const runStoriesMigration = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        media_url TEXT NOT NULL,
        media_type VARCHAR(20) DEFAULT 'image',
        caption TEXT,
        views INTEGER DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS story_views (
        story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
        viewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (story_id, viewer_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id);
      CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
      CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views(story_id);
    `);
    console.log('✅ Stories tables ready');
  } catch (e) {
    console.log('Stories migration error:', e.message);
  } finally {
    client.release();
  }
};


// ============================================
// PUSH NOTIFICATIONS / UTILS
// ============================================

export const getUserById = async (userId) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT id, username, display_name as "displayName", avatar FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
};

export const savePushToken = async (userId, token, deviceType = 'mobile') => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO push_tokens (user_id, token, device_type, last_used_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, token) 
       DO UPDATE SET last_used_at = NOW()`,
      [userId, token, deviceType]
    );
    return { success: true };
  } finally {
    client.release();
  }
};

export const removePushToken = async (userId, token = null) => {
  const client = await pool.connect();
  try {
    if (token) {
      // Remove specific token
      await client.query(
        'DELETE FROM push_tokens WHERE user_id = $1 AND token = $2',
        [userId, token]
      );
    } else {
      // Remove all tokens for user (logout)
      await client.query(
        'DELETE FROM push_tokens WHERE user_id = $1',
        [userId]
      );
    }
    return { success: true };
  } finally {
    client.release();
  }
};

export const getPushTokens = async (userIds) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT DISTINCT token FROM push_tokens WHERE user_id = ANY($1::uuid[])',
      [userIds]
    );
    return result.rows.map(row => row.token);
  } finally {
    client.release();
  }
};

export const getInactiveUsers = async (hoursInactive = 2) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT u.id, u.username, u.display_name,
              EXTRACT(HOUR FROM NOW() - COALESCE(MAX(s.created_at), u.created_at)) as hours_inactive
       FROM users u
       LEFT JOIN scores s ON u.id = s.user_id
       WHERE u.id IN (SELECT DISTINCT user_id FROM push_tokens)
       GROUP BY u.id
       HAVING COALESCE(MAX(s.created_at), u.created_at) < NOW() - INTERVAL '${hoursInactive} hours'`,
      []
    );
    return result.rows;
  } finally {
    client.release();
  }
};

// Get ALL users who have push tokens registered (for blast notifications)
export const getAllUsersWithTokens = async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT u.id, u.username, u.display_name
       FROM users u
       INNER JOIN push_tokens pt ON u.id = pt.user_id`
    );
    return result.rows;
  } finally {
    client.release();
  }
};

export const getUsersWithPendingRewards = async () => {
  const client = await pool.connect();
  try {
    // Users who haven't claimed today's reward
    const result = await client.query(
      `SELECT u.id, u.username, 100 as reward_amount
       FROM users u
       WHERE u.id IN (SELECT DISTINCT user_id FROM push_tokens)
         AND NOT EXISTS (
           SELECT 1 FROM points_transactions pt
           WHERE pt.user_id = u.id
             AND pt.type = 'daily_reward'
             AND pt.created_at::date = CURRENT_DATE
         )
       LIMIT 1000`,
      []
    );
    return result.rows;
  } finally {
    client.release();
  }
};

export const getUsersWithActiveFriends = async () => {
  const client = await pool.connect();
  try {
    // Users whose friends played in the last hour
    const result = await client.query(
      `SELECT u.id, u.username,
              ARRAY_AGG(DISTINCT fu.display_name) as active_friend_names
       FROM users u
       INNER JOIN followers f ON u.id = f.follower_id
       INNER JOIN users fu ON f.following_id = fu.id
       INNER JOIN scores s ON fu.id = s.user_id
       WHERE u.id IN (SELECT DISTINCT user_id FROM push_tokens)
         AND s.created_at > NOW() - INTERVAL '1 hour'
       GROUP BY u.id
       HAVING COUNT(DISTINCT fu.id) > 0
       LIMIT 100`,
      []
    );
    return result.rows;
  } finally {
    client.release();
  }
};
