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
