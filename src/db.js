// PostgreSQL Database Connection
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
export const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
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
        category VARCHAR(50),
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

      CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id);
      CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
      CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_blocked_users ON blocked_users(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_saved_games_user ON saved_games(user_id);
      
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
        -- Make password nullable for OAuth users
        ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
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
    await client.query(`
      -- User points and currency
      CREATE TABLE IF NOT EXISTS user_points (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER DEFAULT 0,
        lifetime_earned INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- User streaks (daily login)
      CREATE TABLE IF NOT EXISTS user_streaks (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        last_claim_date DATE,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- User levels and XP
      CREATE TABLE IF NOT EXISTS user_levels (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Points transaction history
      CREATE TABLE IF NOT EXISTS points_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Daily challenges (rotating)
      CREATE TABLE IF NOT EXISTS daily_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50) NOT NULL,
        target INTEGER NOT NULL,
        reward_points INTEGER NOT NULL,
        reward_xp INTEGER DEFAULT 0,
        icon VARCHAR(50),
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- User challenge progress
      CREATE TABLE IF NOT EXISTS user_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        challenge_id UUID REFERENCES daily_challenges(id) ON DELETE CASCADE,
        progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        claimed BOOLEAN DEFAULT FALSE,
        assigned_date DATE DEFAULT CURRENT_DATE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, challenge_id, assigned_date)
      );
      
      -- Rewards shop items
      CREATE TABLE IF NOT EXISTS rewards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        image_url TEXT,
        cost INTEGER NOT NULL,
        category VARCHAR(50),
        stock INTEGER,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- User claimed rewards
      CREATE TABLE IF NOT EXISTS user_rewards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reward_id UUID REFERENCES rewards(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        claimed_at TIMESTAMP DEFAULT NOW(),
        fulfilled_at TIMESTAMP
      );
      
      -- Achievements/Badges
      CREATE TABLE IF NOT EXISTS achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(50),
        type VARCHAR(50) NOT NULL,
        threshold INTEGER NOT NULL,
        reward_points INTEGER DEFAULT 0,
        reward_xp INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- User unlocked achievements
      CREATE TABLE IF NOT EXISTS user_achievements (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE,
        unlocked_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, achievement_id)
      );
      
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_points_transactions_user ON points_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_points_transactions_type ON points_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_user_challenges_user ON user_challenges(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_challenges_date ON user_challenges(assigned_date);
      CREATE INDEX IF NOT EXISTS idx_user_rewards_user ON user_rewards(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
    `);
    console.log('✅ Gamification tables ready');
    
    // Seed default challenges if none exist
    const challengeCount = await client.query('SELECT COUNT(*) FROM daily_challenges');
    if (parseInt(challengeCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO daily_challenges (title, description, type, target, reward_points, reward_xp, icon) VALUES
        ('Game Explorer', 'Play 3 different games', 'play_games', 3, 50, 25, '🎮'),
        ('Dedicated Gamer', 'Play games for 10 minutes', 'play_time', 10, 75, 40, '⏱️'),
        ('Social Butterfly', 'Like 5 games', 'like_games', 5, 30, 15, '❤️'),
        ('Bookworm', 'Save 2 games to your collection', 'save_games', 2, 40, 20, '📚'),
        ('Chatterbox', 'Leave 3 comments', 'post_comments', 3, 60, 30, '💬'),
        ('High Scorer', 'Beat your high score in any game', 'beat_highscore', 1, 100, 50, '🏆'),
        ('Marathon Runner', 'Play games for 30 minutes', 'play_time', 30, 150, 75, '🏃'),
        ('Game Hopper', 'Play 5 different games', 'play_games', 5, 80, 40, '🦘'),
        ('Friendly Face', 'Follow 2 new players', 'follow_users', 2, 50, 25, '👋'),
        ('Sharing is Caring', 'Share a game with friends', 'share_game', 1, 40, 20, '📤')
      `);
      console.log('✅ Default challenges seeded');
    }
    
    // Seed default achievements if none exist
    const achievementCount = await client.query('SELECT COUNT(*) FROM achievements');
    if (parseInt(achievementCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO achievements (name, description, icon, type, threshold, reward_points, reward_xp) VALUES
        ('First Steps', 'Play your first game', '👶', 'games_played', 1, 10, 5),
        ('Getting Started', 'Play 10 games', '🎮', 'games_played', 10, 50, 25),
        ('Gamer', 'Play 50 games', '🕹️', 'games_played', 50, 200, 100),
        ('Hardcore Gamer', 'Play 100 games', '🔥', 'games_played', 100, 500, 250),
        ('Legend', 'Play 500 games', '👑', 'games_played', 500, 2000, 1000),
        ('On Fire', 'Reach a 7-day streak', '🔥', 'streak', 7, 100, 50),
        ('Unstoppable', 'Reach a 30-day streak', '💪', 'streak', 30, 500, 250),
        ('Dedicated', 'Reach a 100-day streak', '⭐', 'streak', 100, 2000, 1000),
        ('Rising Star', 'Reach level 5', '⭐', 'level', 5, 100, 50),
        ('Pro Player', 'Reach level 10', '🌟', 'level', 10, 300, 150),
        ('Elite', 'Reach level 25', '💎', 'level', 25, 1000, 500),
        ('Master', 'Reach level 50', '🏆', 'level', 50, 5000, 2500),
        ('Collector', 'Save 10 games', '📚', 'saves', 10, 50, 25),
        ('Curator', 'Save 50 games', '🗃️', 'saves', 50, 200, 100),
        ('Social Star', 'Get 100 followers', '⭐', 'followers', 100, 500, 250),
        ('Influencer', 'Get 1000 followers', '🌟', 'followers', 1000, 2000, 1000),
        ('Generous', 'Like 100 games', '❤️', 'likes_given', 100, 100, 50),
        ('Supporter', 'Like 500 games', '💖', 'likes_given', 500, 500, 250),
        ('Wealthy', 'Earn 10,000 lifetime points', '💰', 'lifetime_points', 10000, 500, 250),
        ('Rich', 'Earn 100,000 lifetime points', '💎', 'lifetime_points', 100000, 5000, 2500)
      `);
      console.log('✅ Default achievements seeded');
    }
    
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

// Game leaderboard table - tracks points per user per game
export const runLeaderboardMigration = async () => {
  const client = await pool.connect();
  try {
    // Drop the old table if it has FK constraint issues
    await client.query(`
      DROP TABLE IF EXISTS game_leaderboard CASCADE;
    `);
    
    // Create without FK on game_id since games might not be in the games table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_leaderboard (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id VARCHAR(100) NOT NULL,
        points INTEGER DEFAULT 0,
        play_time INTEGER DEFAULT 0,
        last_played TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_game_leaderboard_game ON game_leaderboard(game_id);
      CREATE INDEX IF NOT EXISTS idx_game_leaderboard_points ON game_leaderboard(game_id, points DESC);
      CREATE INDEX IF NOT EXISTS idx_game_leaderboard_user ON game_leaderboard(user_id);
    `);
    console.log('✅ Game leaderboard table ready');
  } catch (e) {
    console.log('Leaderboard migration error:', e.message);
  } finally {
    client.release();
  }
};
