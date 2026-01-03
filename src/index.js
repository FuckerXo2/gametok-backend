// Main API server with PostgreSQL
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { createServer } from 'http';
import pool, { initDB } from './db.js';
import { initMultiplayer } from './multiplayer.js';

const app = express();
const PORT = process.env.PORT || 3000;

const server = createServer(app);
const io = initMultiplayer(server, null); // We'll update multiplayer later

app.use(cors());
app.use(express.json());

const hashPassword = (password) => crypto.createHash('sha256').update(password).digest('hex');
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ============================================
// AUTH ENDPOINTS
// ============================================

app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, displayName } = req.body;
  
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ chars' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username taken' });

    const token = generateToken();
    const result = await pool.query(
      `INSERT INTO users (username, email, password, display_name, token) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [username, email || null, hashPassword(password), displayName || username, token]
    );
    
    const user = result.rows[0];
    res.json({ user: formatUser(user), token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = result.rows[0];
    
    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken();
    await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
    user.token = token;
    
    res.json({ user: formatUser(user), token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: formatUser(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await pool.query('UPDATE users SET token = NULL WHERE token = $1', [token]);
  }
  res.json({ success: true });
});

app.delete('/api/auth/delete-account', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await pool.query('DELETE FROM users WHERE token = $1 RETURNING id', [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper to format user for response
function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    totalScore: row.total_score,
    gamesPlayed: row.games_played,
    followers: [],
    following: [],
    createdAt: row.created_at
  };
}


// ============================================
// GAMES ENDPOINTS
// ============================================

app.post('/api/admin/reseed', async (req, res) => {
  try {
    await seedGames();
    const result = await pool.query('SELECT COUNT(*) FROM games');
    res.json({ success: true, gamesCount: parseInt(result.rows[0].count) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reseed' });
  }
});

// Delete a game from database
app.delete('/api/admin/games/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM games WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ success: true, deleted: req.params.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

app.get('/api/games', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query('SELECT * FROM games ORDER BY RANDOM() LIMIT $1 OFFSET $2', [limit, offset]);
    const countResult = await pool.query('SELECT COUNT(*) FROM games');
    res.json({ games: result.rows.map(formatGame), total: parseInt(countResult.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    res.json({ game: formatGame(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/:id/play', async (req, res) => {
  try {
    await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

function formatGame(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    thumbnail: row.thumbnail,
    category: row.category,
    plays: row.plays,
    likes: row.like_count,
    createdAt: row.created_at
  };
}


// ============================================
// USERS ENDPOINTS
// ============================================

app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 OR username = $1', 
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = result.rows[0];
    const followers = await pool.query('SELECT COUNT(*) FROM followers WHERE following_id = $1', [user.id]);
    const following = await pool.query('SELECT COUNT(*) FROM followers WHERE follower_id = $1', [user.id]);
    
    res.json({
      user: formatUser(user),
      stats: {
        followers: parseInt(followers.rows[0].count),
        following: parseInt(following.rows[0].count),
        gamesPlayed: user.games_played,
        totalScore: user.total_score
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { displayName, bio, avatar } = req.body;

  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1 AND token = $2', [req.params.id, token]);
    if (userCheck.rows.length === 0) return res.status(403).json({ error: 'Not authorized' });

    const result = await pool.query(
      `UPDATE users SET 
        display_name = COALESCE($1, display_name),
        bio = COALESCE($2, bio),
        avatar = COALESCE($3, avatar)
       WHERE id = $4 RETURNING *`,
      [displayName, bio, avatar, req.params.id]
    );
    res.json({ user: formatUser(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/:id/follow', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const currentUser = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (currentUser.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    
    const followerId = currentUser.rows[0].id;
    const followingId = req.params.id;
    
    if (followerId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existing = await pool.query(
      'SELECT * FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
      res.json({ following: false });
    } else {
      await pool.query('INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)', [followerId, followingId]);
      res.json({ following: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/search/:query', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, display_name, avatar FROM users 
       WHERE username ILIKE $1 OR display_name ILIKE $1 LIMIT 20`,
      [`%${req.params.query}%`]
    );
    res.json({ users: result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar })) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// SCORES ENDPOINTS
// ============================================

app.post('/api/scores', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId, score } = req.body;
  if (!gameId || score === undefined) return res.status(400).json({ error: 'gameId and score required' });

  try {
    let userId = null;
    if (token) {
      const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
        await pool.query(
          'UPDATE users SET total_score = total_score + $1, games_played = games_played + 1 WHERE id = $2',
          [score, userId]
        );
      }
    }

    const result = await pool.query(
      'INSERT INTO scores (user_id, game_id, score) VALUES ($1, $2, $3) RETURNING *',
      [userId, gameId, score]
    );
    res.json({ success: true, score: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/scores/leaderboard/:gameId', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (s.user_id) s.*, u.username, u.display_name, u.avatar
       FROM scores s JOIN users u ON s.user_id = u.id
       WHERE s.game_id = $1 AND s.user_id IS NOT NULL
       ORDER BY s.user_id, s.score DESC`,
      [req.params.gameId]
    );
    
    const sorted = result.rows.sort((a, b) => b.score - a.score).slice(0, limit);
    const leaderboard = sorted.map((r, i) => ({
      rank: i + 1,
      score: r.score,
      username: r.username,
      displayName: r.display_name,
      avatar: r.avatar,
      userId: r.user_id
    }));
    
    res.json({ leaderboard });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// LIKES ENDPOINTS
// ============================================

app.post('/api/likes', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!gameId) return res.status(400).json({ error: 'gameId required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const existing = await pool.query('SELECT * FROM likes WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
    
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
      await pool.query('UPDATE games SET like_count = like_count - 1 WHERE id = $1', [gameId]);
      res.json({ liked: false });
    } else {
      await pool.query('INSERT INTO likes (user_id, game_id) VALUES ($1, $2)', [userId, gameId]);
      await pool.query('UPDATE games SET like_count = like_count + 1 WHERE id = $1', [gameId]);
      res.json({ liked: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/likes/user/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.* FROM games g JOIN likes l ON g.id = l.game_id WHERE l.user_id = $1`,
      [req.params.userId]
    );
    res.json({ games: result.rows.map(formatGame) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// MESSAGES ENDPOINTS
// ============================================

app.get('/api/conversations', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT c.*, 
        CASE WHEN c.participant1_id = $1 THEN c.participant2_id ELSE c.participant1_id END as other_user_id
       FROM conversations c 
       WHERE c.participant1_id = $1 OR c.participant2_id = $1
       ORDER BY c.updated_at DESC`,
      [userId]
    );

    const conversations = await Promise.all(result.rows.map(async (c) => {
      const otherUser = await pool.query('SELECT id, username, display_name, avatar FROM users WHERE id = $1', [c.other_user_id]);
      return {
        id: c.id,
        user: otherUser.rows[0] ? { id: otherUser.rows[0].id, username: otherUser.rows[0].username, displayName: otherUser.rows[0].display_name, avatar: otherUser.rows[0].avatar } : null,
        streak: c.streak,
        updatedAt: c.updated_at
      };
    }));

    res.json({ conversations });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/conversations/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;
    const otherUserId = req.params.userId;

    let conv = await pool.query(
      `SELECT * FROM conversations WHERE 
       (participant1_id = $1 AND participant2_id = $2) OR (participant1_id = $2 AND participant2_id = $1)`,
      [userId, otherUserId]
    );

    if (conv.rows.length === 0) {
      conv = await pool.query(
        'INSERT INTO conversations (participant1_id, participant2_id) VALUES ($1, $2) RETURNING *',
        [userId, otherUserId]
      );
    }

    const messages = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conv.rows[0].id]
    );

    const otherUser = await pool.query('SELECT id, username, display_name, avatar FROM users WHERE id = $1', [otherUserId]);

    res.json({
      conversation: { id: conv.rows[0].id, user: otherUser.rows[0], streak: conv.rows[0].streak },
      messages: messages.rows.map(m => ({ id: m.id, text: m.text, senderId: m.sender_id, isMe: m.sender_id === userId, createdAt: m.created_at }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { conversationId, recipientId, text } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    let convId = conversationId;
    if (!convId && recipientId) {
      let conv = await pool.query(
        `SELECT id FROM conversations WHERE 
         (participant1_id = $1 AND participant2_id = $2) OR (participant1_id = $2 AND participant2_id = $1)`,
        [userId, recipientId]
      );
      if (conv.rows.length === 0) {
        conv = await pool.query('INSERT INTO conversations (participant1_id, participant2_id) VALUES ($1, $2) RETURNING id', [userId, recipientId]);
      }
      convId = conv.rows[0].id;
    }

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, text, read_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [convId, userId, text, [userId]]
    );
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);

    res.json({ message: { id: result.rows[0].id, text: result.rows[0].text, senderId: userId, isMe: true, createdAt: result.rows[0].created_at } });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// COMMENTS ENDPOINTS
// ============================================

app.get('/api/comments/:gameId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.username, u.display_name, u.avatar FROM comments c
       JOIN users u ON c.user_id = u.id WHERE c.game_id = $1
       ORDER BY c.created_at DESC LIMIT 50`,
      [req.params.gameId]
    );
    res.json({
      comments: result.rows.map(r => ({
        id: r.id, text: r.text, userId: r.user_id, username: r.username,
        displayName: r.display_name, avatar: r.avatar, likes: r.likes, createdAt: r.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/comments', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId, text } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!gameId || !text) return res.status(400).json({ error: 'gameId and text required' });

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const user = userResult.rows[0];

    const result = await pool.query(
      'INSERT INTO comments (game_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [gameId, user.id, text.trim()]
    );
    res.json({
      comment: {
        id: result.rows[0].id, text: result.rows[0].text, userId: user.id,
        username: user.username, displayName: user.display_name, avatar: user.avatar,
        likes: 0, createdAt: result.rows[0].created_at
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/comments/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    await pool.query('DELETE FROM comments WHERE id = $1 AND user_id = $2', [req.params.id, userResult.rows[0].id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// FEED ENDPOINTS
// ============================================

app.get('/api/feed/activity', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT s.*, u.username, u.display_name, u.avatar, g.name as game_name, g.icon as game_icon
       FROM scores s
       JOIN users u ON s.user_id = u.id
       JOIN games g ON s.game_id = g.id
       WHERE s.user_id IN (SELECT following_id FROM followers WHERE follower_id = $1)
       ORDER BY s.created_at DESC LIMIT 20`,
      [userId]
    );

    res.json({
      activity: result.rows.map(r => ({
        type: 'score', id: r.id,
        user: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon },
        score: r.score, createdAt: r.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// SEED GAMES
// ============================================

const seedGames = async () => {
  const games = [
    // Puzzle
    { id: '2048', name: '2048', description: 'Swipe to merge tiles!', icon: '🔢', color: '#edc22e', category: 'puzzle' },
    { id: '2048-v2', name: '2048 Classic', description: 'Original 2048!', icon: '🔢', color: '#edc22e', category: 'puzzle' },
    { id: 'tetris', name: 'Tetris', description: 'Stack falling blocks!', icon: '🧱', color: '#00d4ff', category: 'puzzle' },
    { id: 'hextris', name: 'Hextris', description: 'Hexagonal Tetris!', icon: '⬡', color: '#9b59b6', category: 'puzzle' },
    { id: 'hextris-v2', name: 'Hextris Pro', description: 'Advanced hex puzzle!', icon: '⬡', color: '#8e44ad', category: 'puzzle' },
    { id: 'memory-match', name: 'Memory Match', description: 'Find matching pairs!', icon: '🃏', color: '#9b59b6', category: 'puzzle' },
    { id: 'block-blast', name: 'Block Blast', description: 'Blast blocks!', icon: '🟦', color: '#3498db', category: 'puzzle' },
    { id: 'color-match', name: 'Color Match', description: 'Match colors!', icon: '🎨', color: '#f39c12', category: 'puzzle' },
    { id: 'simon-says', name: 'Simon Says', description: 'Remember pattern!', icon: '🔴', color: '#e91e63', category: 'puzzle' },
    { id: 'number-tap', name: 'Number Tap', description: 'Tap in order!', icon: '🔢', color: '#1abc9c', category: 'puzzle' },
    
    // Arcade
    { id: 'pacman', name: 'Pac-Man', description: 'Eat dots, avoid ghosts!', icon: '🟡', color: '#FFFF00', category: 'arcade' },
    { id: 'breakout', name: 'Breakout', description: 'Break the bricks!', icon: '🧱', color: '#e74c3c', category: 'arcade' },
    { id: 'snake-io', name: 'Snake.io', description: 'Grow your snake!', icon: '🐍', color: '#00d4ff', category: 'arcade' },
    { id: 'piano-tiles', name: 'Piano Tiles', description: 'Tap black tiles!', icon: '🎹', color: '#1a1a2e', category: 'arcade' },
    { id: 'tower-blocks-3d', name: 'Tower Blocks 3D', description: '3D block stacking!', icon: '🧱', color: '#3498db', category: 'arcade' },
    { id: 'stack-tower-3d', name: 'Stack Tower 3D', description: '3D tower builder!', icon: '🏗️', color: '#9b59b6', category: 'arcade' },
    
    // Casual
    { id: 'flappy-bird', name: 'Flappy Bird', description: 'Tap to flap!', icon: '🐦', color: '#70c5ce', category: 'casual' },
    { id: 'doodle-jump', name: 'Doodle Jump', description: 'Jump up!', icon: '🐸', color: '#8bc34a', category: 'casual' },
    { id: 'crossy-road', name: 'Crossy Road', description: 'Cross safely!', icon: '🐔', color: '#8bc34a', category: 'casual' },
    { id: 'bubble-pop', name: 'Bubble Pop', description: 'Pop bubbles!', icon: '🫧', color: '#00bcd4', category: 'casual' },
    { id: 'ball-bounce', name: 'Ball Bounce', description: 'Bounce!', icon: '🏀', color: '#ff5722', category: 'casual' },
    { id: 'tower-game', name: 'Tower Stack', description: 'Stack blocks!', icon: '🏗️', color: '#3498db', category: 'casual' },
    { id: 'towermaster', name: 'Tower Master', description: 'Build towers!', icon: '🗼', color: '#f39c12', category: 'casual' },
    { id: 'rock-paper-scissors', name: 'Rock Paper Scissors', description: 'Classic game!', icon: '✊', color: '#9b59b6', category: 'casual' },
    
    // Action
    { id: 'fruit-slicer', name: 'Fruit Slicer', description: 'Swipe to slice!', icon: '🍉', color: '#ff6b6b', category: 'action' },
    { id: 'geometry-dash', name: 'Geometry Dash', description: 'Tap to jump!', icon: '⬛', color: '#00d4ff', category: 'action' },
    { id: 'whack-a-mole', name: 'Whack-a-Mole', description: 'Tap the moles!', icon: '🐹', color: '#8b4513', category: 'action' },
    { id: 'aim-trainer', name: 'Aim Trainer', description: 'Test reflexes!', icon: '🎯', color: '#e74c3c', category: 'action' },
    { id: 'tap-tap-dash', name: 'Tap Tap Dash', description: 'Tap to turn!', icon: '👆', color: '#3498db', category: 'action' },
    { id: 'tap-tap-blue', name: 'Tap Tap Blue', description: 'Tap blue only!', icon: '🔵', color: '#3498db', category: 'action' },
    
    // Sports
    { id: 'basketball', name: 'Basketball', description: 'Shoot hoops!', icon: '🏀', color: '#f39c12', category: 'sports' },
    { id: 'basketball-3d', name: 'Basketball 3D', description: 'Swipe to shoot hoops!', icon: '🏀', color: '#ff6600', category: 'sports' },
    
    // Strategy
    { id: 'connect4', name: 'Connect 4', description: 'Connect four in a row!', icon: '🔴', color: '#e74c3c', category: 'strategy' },
    { id: 'tic-tac-toe', name: 'Tic Tac Toe', description: 'X and O!', icon: '⭕', color: '#9b59b6', category: 'strategy' },
    { id: 'chess', name: 'Chess', description: 'Strategy game!', icon: '♟️', color: '#2c3e50', category: 'strategy' },
    
    // Retro
    { id: 'pong', name: 'Pong', description: 'Classic paddle!', icon: '🏓', color: '#00d4ff', category: 'retro' },
    { id: 'asteroids', name: 'Asteroids', description: 'Blast asteroids!', icon: '☄️', color: '#2c3e50', category: 'retro' },
    { id: 'space-invaders', name: 'Space Invaders', description: 'Defend Earth!', icon: '👾', color: '#1a1a2e', category: 'retro' },
    
    // Racing
    { id: 'racer', name: 'Racer', description: 'Dodge traffic!', icon: '🚗', color: '#e74c3c', category: 'racing' },
  ];

  for (const g of games) {
    await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name, g.description, g.icon, g.color, g.category]
    );
  }
};

// ============================================
// START SERVER
// ============================================

const start = async () => {
  await initDB();
  await seedGames();
  
  server.listen(PORT, () => {
    console.log(`🎮 GameTok API running on port ${PORT} with PostgreSQL`);
  });
};

start().catch(console.error);
