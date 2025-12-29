// Main API server
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple password hashing (use bcrypt in production)
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Generate auth token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// ============================================
// AUTH ENDPOINTS
// ============================================

// POST /api/auth/signup - Create account
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, displayName } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  await db.read();
  
  // Check if username taken
  if (db.data.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  
  // Check if email taken (if provided)
  if (email && db.data.users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  
  const token = generateToken();
  
  const user = {
    id: uuidv4(),
    username,
    email: email || null,
    password: hashPassword(password),
    displayName: displayName || username,
    avatar: null,
    bio: '',
    followers: [],
    following: [],
    totalScore: 0,
    gamesPlayed: 0,
    token,
    createdAt: new Date().toISOString()
  };
  
  db.data.users.push(user);
  await db.write();
  
  // Don't send password back
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

// POST /api/auth/login - Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  await db.read();
  
  const user = db.data.users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );
  
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  
  // Generate new token
  user.token = generateToken();
  await db.write();
  
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, token: user.token });
});

// GET /api/auth/me - Get current user from token
app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  await db.read();
  const user = db.data.users.find(u => u.token === token);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// POST /api/auth/logout - Logout (invalidate token)
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (token) {
    await db.read();
    const user = db.data.users.find(u => u.token === token);
    if (user) {
      user.token = null;
      await db.write();
    }
  }
  
  res.json({ success: true });
});

// ============================================
// GAMES ENDPOINTS
// ============================================

// GET /api/games - Get games for the feed
app.get('/api/games', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  
  await db.read();
  
  // Shuffle and paginate
  const shuffled = [...db.data.games].sort(() => Math.random() - 0.5);
  const games = shuffled.slice(offset, offset + limit);
  
  res.json({ games, total: db.data.games.length });
});

// GET /api/games/:id - Get a specific game
app.get('/api/games/:id', async (req, res) => {
  await db.read();
  const game = db.data.games.find(g => g.id === req.params.id);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  res.json({ game });
});

// POST /api/games - Add a new game
app.post('/api/games', async (req, res) => {
  const { name, description, icon, color, game_url, thumbnail_url } = req.body;
  
  if (!name || !game_url) {
    return res.status(400).json({ error: 'Name and game_url are required' });
  }
  
  const game = {
    id: uuidv4(),
    name,
    description: description || '',
    icon: icon || '🎮',
    color: color || '#667eea',
    game_url,
    thumbnail_url: thumbnail_url || null,
    play_count: 0,
    like_count: 0,
    created_at: new Date().toISOString()
  };
  
  db.data.games.push(game);
  await db.write();
  
  res.json({ game, message: 'Game added successfully' });
});

// POST /api/games/:id/play - Record a play
app.post('/api/games/:id/play', async (req, res) => {
  await db.read();
  const game = db.data.games.find(g => g.id === req.params.id);
  
  if (game) {
    game.play_count = (game.play_count || 0) + 1;
    await db.write();
  }
  
  res.json({ success: true });
});

// DELETE /api/games/:id - Delete a game
app.delete('/api/games/:id', async (req, res) => {
  await db.read();
  const index = db.data.games.findIndex(g => g.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  db.data.games.splice(index, 1);
  await db.write();
  
  res.json({ success: true, message: 'Game deleted' });
});

// ============================================
// USERS ENDPOINTS
// ============================================

// GET /api/users/:id - Get user profile
app.get('/api/users/:id', async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.params.id || u.username === req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Calculate stats
  const userScores = db.data.scores.filter(s => s.userId === user.id);
  
  const stats = {
    followers: user.followers?.length || 0,
    following: user.following?.length || 0,
    gamesPlayed: user.gamesPlayed || 0,
    totalScore: user.totalScore || 0,
    bestScore: userScores.length > 0 ? Math.max(...userScores.map(s => s.score)) : 0
  };
  
  // Get recent scores
  const recentScores = userScores
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map(s => {
      const game = db.data.games.find(g => g.id === s.gameId);
      return {
        ...s,
        gameName: game?.name || 'Unknown',
        gameIcon: game?.icon || '🎮'
      };
    });
  
  const { password: _, token: __, ...safeUser } = user;
  res.json({ user: safeUser, stats, recentScores });
});

// PUT /api/users/:id - Update profile
app.put('/api/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { displayName, bio, avatar } = req.body;
  
  await db.read();
  
  const user = db.data.users.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Check authorization
  if (user.token !== token) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  if (displayName) user.displayName = displayName;
  if (bio !== undefined) user.bio = bio;
  if (avatar) user.avatar = avatar;
  
  await db.write();
  
  const { password: _, token: __, ...safeUser } = user;
  res.json({ user: safeUser });
});

// POST /api/users/:id/follow - Follow/unfollow user
app.post('/api/users/:id/follow', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const currentUser = db.data.users.find(u => u.token === token);
  const targetUser = db.data.users.find(u => u.id === req.params.id);
  
  if (!currentUser) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (currentUser.id === targetUser.id) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }
  
  // Initialize arrays if needed
  if (!currentUser.following) currentUser.following = [];
  if (!targetUser.followers) targetUser.followers = [];
  
  const isFollowing = currentUser.following.includes(targetUser.id);
  
  if (isFollowing) {
    // Unfollow
    currentUser.following = currentUser.following.filter(id => id !== targetUser.id);
    targetUser.followers = targetUser.followers.filter(id => id !== currentUser.id);
  } else {
    // Follow
    currentUser.following.push(targetUser.id);
    targetUser.followers.push(currentUser.id);
  }
  
  await db.write();
  
  res.json({ 
    following: !isFollowing,
    followersCount: targetUser.followers.length
  });
});

// GET /api/users/:id/followers - Get user's followers
app.get('/api/users/:id/followers', async (req, res) => {
  await db.read();
  
  const user = db.data.users.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const followers = (user.followers || []).map(id => {
    const follower = db.data.users.find(u => u.id === id);
    if (!follower) return null;
    return {
      id: follower.id,
      username: follower.username,
      displayName: follower.displayName,
      avatar: follower.avatar
    };
  }).filter(Boolean);
  
  res.json({ followers });
});

// GET /api/users/:id/following - Get who user follows
app.get('/api/users/:id/following', async (req, res) => {
  await db.read();
  
  const user = db.data.users.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const following = (user.following || []).map(id => {
    const followed = db.data.users.find(u => u.id === id);
    if (!followed) return null;
    return {
      id: followed.id,
      username: followed.username,
      displayName: followed.displayName,
      avatar: followed.avatar
    };
  }).filter(Boolean);
  
  res.json({ following });
});

// GET /api/users/search/:query - Search users
app.get('/api/users/search/:query', async (req, res) => {
  const query = req.params.query.toLowerCase();
  
  await db.read();
  
  const users = db.data.users
    .filter(u => 
      u.username.toLowerCase().includes(query) || 
      u.displayName?.toLowerCase().includes(query)
    )
    .slice(0, 20)
    .map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      followers: u.followers?.length || 0
    }));
  
  res.json({ users });
});

// ============================================
// SCORES ENDPOINTS
// ============================================

// POST /api/scores - Submit a score
app.post('/api/scores', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId, score } = req.body;
  
  if (!gameId || score === undefined) {
    return res.status(400).json({ error: 'gameId and score are required' });
  }
  
  await db.read();
  
  let userId = null;
  if (token) {
    const user = db.data.users.find(u => u.token === token);
    if (user) {
      userId = user.id;
      // Update user stats
      user.totalScore = (user.totalScore || 0) + score;
      user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    }
  }
  
  const scoreEntry = {
    id: uuidv4(),
    userId,
    gameId,
    score,
    createdAt: new Date().toISOString()
  };
  
  db.data.scores.push(scoreEntry);
  await db.write();
  
  // Check if it's a high score
  const gameScores = db.data.scores.filter(s => s.gameId === gameId);
  const rank = gameScores.filter(s => s.score > score).length + 1;
  const isHighScore = userId && rank <= 10;
  
  res.json({ 
    success: true, 
    score: scoreEntry,
    rank,
    isHighScore
  });
});

// GET /api/scores/leaderboard/:gameId - Get leaderboard
app.get('/api/scores/leaderboard/:gameId', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const type = req.query.type || 'global'; // global, friends
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  await db.read();
  
  let scores = db.data.scores.filter(s => s.gameId === req.params.gameId);
  
  // Friends leaderboard
  if (type === 'friends' && token) {
    const currentUser = db.data.users.find(u => u.token === token);
    if (currentUser) {
      const friendIds = [...(currentUser.following || []), currentUser.id];
      scores = scores.filter(s => friendIds.includes(s.userId));
    }
  }
  
  // Get best score per user
  const bestScores = {};
  scores.forEach(s => {
    if (!s.userId) return;
    if (!bestScores[s.userId] || s.score > bestScores[s.userId].score) {
      bestScores[s.userId] = s;
    }
  });
  
  const leaderboard = Object.values(bestScores)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s, index) => {
      const user = db.data.users.find(u => u.id === s.userId);
      return {
        rank: index + 1,
        score: s.score,
        username: user?.username || 'Anonymous',
        displayName: user?.displayName || 'Anonymous',
        avatar: user?.avatar,
        userId: s.userId,
        createdAt: s.createdAt
      };
    });
  
  res.json({ leaderboard });
});

// GET /api/scores/user/:userId - Get user's scores
app.get('/api/scores/user/:userId', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  
  await db.read();
  
  const scores = db.data.scores
    .filter(s => s.userId === req.params.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(s => {
      const game = db.data.games.find(g => g.id === s.gameId);
      return {
        ...s,
        gameName: game?.name || 'Unknown',
        gameIcon: game?.icon || '🎮'
      };
    });
  
  res.json({ scores });
});

// ============================================
// LIKES ENDPOINTS
// ============================================

// POST /api/likes - Like/unlike a game (toggle)
app.post('/api/likes', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId } = req.body;
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const existingIndex = db.data.likes.findIndex(
    l => l.userId === user.id && l.gameId === gameId
  );
  
  const game = db.data.games.find(g => g.id === gameId);
  
  if (existingIndex >= 0) {
    // Unlike
    db.data.likes.splice(existingIndex, 1);
    if (game) game.likeCount = Math.max(0, (game.likeCount || 0) - 1);
    await db.write();
    res.json({ success: true, liked: false, likeCount: game?.likeCount || 0 });
  } else {
    // Like
    db.data.likes.push({
      id: uuidv4(),
      userId: user.id,
      gameId,
      createdAt: new Date().toISOString()
    });
    if (game) game.likeCount = (game.likeCount || 0) + 1;
    await db.write();
    res.json({ success: true, liked: true, likeCount: game?.likeCount || 0 });
  }
});

// GET /api/likes/user/:userId - Get user's liked games
app.get('/api/likes/user/:userId', async (req, res) => {
  await db.read();
  
  const userLikes = db.data.likes.filter(l => l.userId === req.params.userId);
  const likedGames = userLikes.map(l => {
    return db.data.games.find(g => g.id === l.gameId);
  }).filter(Boolean);
  
  res.json({ games: likedGames });
});

// ============================================
// FEED / ACTIVITY ENDPOINTS
// ============================================

// GET /api/feed/activity - Get activity feed (friends' scores)
app.get('/api/feed/activity', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const limit = parseInt(req.query.limit) || 20;
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const friendIds = user.following || [];
  
  // Get recent scores from friends
  const activity = db.data.scores
    .filter(s => friendIds.includes(s.userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(s => {
      const scoreUser = db.data.users.find(u => u.id === s.userId);
      const game = db.data.games.find(g => g.id === s.gameId);
      return {
        type: 'score',
        id: s.id,
        user: {
          id: scoreUser?.id,
          username: scoreUser?.username,
          displayName: scoreUser?.displayName,
          avatar: scoreUser?.avatar
        },
        game: {
          id: game?.id,
          name: game?.name,
          icon: game?.icon
        },
        score: s.score,
        createdAt: s.createdAt
      };
    });
  
  res.json({ activity });
});

// ============================================
// SEED DATA
// ============================================

const seedDatabase = async () => {
  await db.read();
  
  if (db.data.games.length === 0) {
    console.log('🌱 Seeding database with test games...');
    
    // Games will be loaded from hosted URLs
    // For now, using placeholder - replace with your actual hosted URLs
    const testGames = [
      {
        id: 'stack-ball',
        name: 'Stack Ball',
        description: 'Hold to smash through platforms 🔥',
        icon: '🎱',
        color: '#667eea',
        game_url: 'HOSTED_URL/stack-ball/',
        thumbnail_url: null,
        play_count: 0,
        like_count: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'helix-jump',
        name: 'Helix Jump',
        description: 'Rotate and drop through gaps',
        icon: '🌀',
        color: '#FFD93D',
        game_url: 'HOSTED_URL/helix-jump/',
        thumbnail_url: null,
        play_count: 0,
        like_count: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'gravity-flip',
        name: 'Gravity Flip',
        description: 'Tap to flip gravity, dodge obstacles',
        icon: '🔄',
        color: '#6C5CE7',
        game_url: 'HOSTED_URL/gravity-flip/',
        thumbnail_url: null,
        play_count: 0,
        like_count: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'color-match',
        name: 'Color Match',
        description: 'Match colors fast! Speed increases',
        icon: '🎨',
        color: '#E17055',
        game_url: 'HOSTED_URL/color-match/',
        thumbnail_url: null,
        play_count: 0,
        like_count: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'orbit',
        name: 'Orbit',
        description: 'Tap to switch direction, collect stars',
        icon: '🌙',
        color: '#0984E3',
        game_url: 'HOSTED_URL/orbit/',
        thumbnail_url: null,
        play_count: 0,
        like_count: 0,
        created_at: new Date().toISOString()
      }
    ];
    
    db.data.games = testGames;
    await db.write();
    
    console.log(`✅ Seeded ${testGames.length} games`);
  }
};

// ============================================
// START SERVER
// ============================================

await seedDatabase();

app.listen(PORT, () => {
  console.log(`
  🎮 GameTok API running on http://localhost:${PORT}
  
  Endpoints:
  ──────────────────────────────────────────
  AUTH
    POST   /api/auth/signup         Create account
    POST   /api/auth/login          Login
    GET    /api/auth/me             Get current user
    POST   /api/auth/logout         Logout
  
  USERS
    GET    /api/users/:id           Get profile
    PUT    /api/users/:id           Update profile
    POST   /api/users/:id/follow    Follow/unfollow
    GET    /api/users/:id/followers Get followers
    GET    /api/users/:id/following Get following
    GET    /api/users/search/:query Search users
  
  GAMES
    GET    /api/games               Get feed
    GET    /api/games/:id           Get game
    POST   /api/games               Add game
    POST   /api/games/:id/play      Record play
  
  SCORES
    POST   /api/scores              Submit score
    GET    /api/scores/leaderboard/:gameId
    GET    /api/scores/user/:userId
  
  LIKES
    POST   /api/likes               Like/unlike
    GET    /api/likes/user/:userId  User's likes
  
  FEED
    GET    /api/feed/activity       Friends activity
  ──────────────────────────────────────────
  `);
});
