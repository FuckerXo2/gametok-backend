// Main API server
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import db from './database.js';
import { initMultiplayer } from './multiplayer.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for both Express and Socket.io
const server = createServer(app);

// Initialize multiplayer WebSocket server
const io = initMultiplayer(server, db);

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

// DELETE /api/auth/delete-account - Delete user account
app.delete('/api/auth/delete-account', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const userIndex = db.data.users.findIndex(u => u.token === token);
  if (userIndex === -1) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const user = db.data.users[userIndex];
  const userId = user.id;
  
  // Remove user
  db.data.users.splice(userIndex, 1);
  
  // Remove user's scores
  db.data.scores = db.data.scores.filter(s => s.userId !== userId);
  
  // Remove user's likes
  db.data.likes = db.data.likes.filter(l => l.userId !== userId);
  
  // Remove user's comments
  if (db.data.comments) {
    db.data.comments = db.data.comments.filter(c => c.userId !== userId);
  }
  
  // Remove user's messages
  if (db.data.messages) {
    db.data.messages = db.data.messages.filter(m => m.senderId !== userId);
  }
  
  // Remove user's conversations
  if (db.data.conversations) {
    db.data.conversations = db.data.conversations.filter(
      c => !c.participants.includes(userId)
    );
  }
  
  // Remove user from followers/following lists
  db.data.users.forEach(u => {
    if (u.followers) u.followers = u.followers.filter(id => id !== userId);
    if (u.following) u.following = u.following.filter(id => id !== userId);
  });
  
  await db.write();
  
  res.json({ success: true, message: 'Account deleted' });
});

// ============================================
// GAMES ENDPOINTS
// ============================================

// POST /api/admin/reseed - Force reseed games (admin only)
app.post('/api/admin/reseed', async (req, res) => {
  try {
    await seedDatabase(true);
    await db.read();
    res.json({ success: true, message: 'Database reseeded', gamesCount: db.data.games.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reseed' });
  }
});

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
  const { id, name, description, icon, color, thumbnail, category } = req.body;
  
  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }
  
  await db.read();
  
  // Check if game ID already exists
  if (db.data.games.find(g => g.id === id)) {
    return res.status(400).json({ error: 'Game with this ID already exists' });
  }
  
  const game = {
    id,
    name,
    description: description || '',
    icon: icon || 'G',
    color: color || '#667eea',
    thumbnail: thumbnail || null,
    category: category || 'arcade',
    plays: 0,
    likes: 0,
    createdAt: new Date().toISOString()
  };
  
  db.data.games.push(game);
  await db.write();
  
  res.json({ game, message: 'Game added successfully' });
});

// PUT /api/games/:id - Update a game
app.put('/api/games/:id', async (req, res) => {
  const { name, description, icon, color, thumbnail, category } = req.body;
  
  await db.read();
  const game = db.data.games.find(g => g.id === req.params.id);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (name) game.name = name;
  if (description !== undefined) game.description = description;
  if (icon) game.icon = icon;
  if (color) game.color = color;
  if (thumbnail !== undefined) game.thumbnail = thumbnail;
  if (category) game.category = category;
  
  await db.write();
  
  res.json({ game, message: 'Game updated successfully' });
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
// MESSAGES / CHAT ENDPOINTS
// ============================================

// GET /api/conversations - Get user's conversations
app.get('/api/conversations', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  // Get conversations where user is a participant
  const conversations = (db.data.conversations || [])
    .filter(c => c.participants.includes(user.id))
    .map(c => {
      const otherUserId = c.participants.find(p => p !== user.id);
      const otherUser = db.data.users.find(u => u.id === otherUserId);
      const lastMessage = (db.data.messages || [])
        .filter(m => m.conversationId === c.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      
      return {
        id: c.id,
        user: {
          id: otherUser?.id,
          username: otherUser?.username,
          displayName: otherUser?.displayName,
          avatar: otherUser?.avatar
        },
        lastMessage: lastMessage ? {
          text: lastMessage.text,
          createdAt: lastMessage.createdAt,
          isRead: lastMessage.readBy?.includes(user.id) || lastMessage.senderId === user.id
        } : null,
        streak: c.streak || 0,
        updatedAt: c.updatedAt
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  res.json({ conversations });
});

// GET /api/conversations/:userId - Get or create conversation with user
app.get('/api/conversations/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const otherUser = db.data.users.find(u => u.id === req.params.userId);
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Find existing conversation
  let conversation = (db.data.conversations || []).find(c => 
    c.participants.includes(user.id) && c.participants.includes(otherUser.id)
  );
  
  // Create if doesn't exist
  if (!conversation) {
    conversation = {
      id: uuidv4(),
      participants: [user.id, otherUser.id],
      streak: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!db.data.conversations) db.data.conversations = [];
    db.data.conversations.push(conversation);
    await db.write();
  }
  
  // Get messages
  const messages = (db.data.messages || [])
    .filter(m => m.conversationId === conversation.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(m => ({
      id: m.id,
      text: m.text,
      senderId: m.senderId,
      isMe: m.senderId === user.id,
      createdAt: m.createdAt
    }));
  
  res.json({
    conversation: {
      id: conversation.id,
      user: {
        id: otherUser.id,
        username: otherUser.username,
        displayName: otherUser.displayName,
        avatar: otherUser.avatar
      },
      streak: conversation.streak
    },
    messages
  });
});

// POST /api/messages - Send a message
app.post('/api/messages', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { conversationId, recipientId, text } = req.body;
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!text || (!conversationId && !recipientId)) {
    return res.status(400).json({ error: 'text and (conversationId or recipientId) required' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  let conversation;
  
  if (conversationId) {
    conversation = (db.data.conversations || []).find(c => c.id === conversationId);
  } else {
    // Find or create conversation with recipient
    conversation = (db.data.conversations || []).find(c => 
      c.participants.includes(user.id) && c.participants.includes(recipientId)
    );
    
    if (!conversation) {
      conversation = {
        id: uuidv4(),
        participants: [user.id, recipientId],
        streak: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (!db.data.conversations) db.data.conversations = [];
      db.data.conversations.push(conversation);
    }
  }
  
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  const message = {
    id: uuidv4(),
    conversationId: conversation.id,
    senderId: user.id,
    text,
    readBy: [user.id],
    createdAt: new Date().toISOString()
  };
  
  if (!db.data.messages) db.data.messages = [];
  db.data.messages.push(message);
  
  // Update conversation timestamp
  conversation.updatedAt = new Date().toISOString();
  
  await db.write();
  
  res.json({
    message: {
      id: message.id,
      text: message.text,
      senderId: message.senderId,
      isMe: true,
      createdAt: message.createdAt
    }
  });
});

// POST /api/messages/:id/read - Mark message as read
app.post('/api/messages/:id/read', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const message = (db.data.messages || []).find(m => m.id === req.params.id);
  if (message && !message.readBy.includes(user.id)) {
    message.readBy.push(user.id);
    await db.write();
  }
  
  res.json({ success: true });
});

// ============================================
// COMMENTS ENDPOINTS
// ============================================

// GET /api/comments/:gameId - Get comments for a game
app.get('/api/comments/:gameId', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  
  await db.read();
  
  const comments = (db.data.comments || [])
    .filter(c => c.gameId === req.params.gameId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(c => {
      const user = db.data.users.find(u => u.id === c.userId);
      return {
        id: c.id,
        text: c.text,
        userId: c.userId,
        username: user?.username || 'Unknown',
        displayName: user?.displayName || user?.username || 'Unknown',
        avatar: user?.avatar || '😊',
        likes: c.likes || 0,
        createdAt: c.createdAt
      };
    });
  
  res.json({ comments, total: comments.length });
});

// POST /api/comments - Add a comment
app.post('/api/comments', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId, text } = req.body;
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!gameId || !text || !text.trim()) {
    return res.status(400).json({ error: 'gameId and text are required' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const comment = {
    id: uuidv4(),
    gameId,
    userId: user.id,
    text: text.trim(),
    likes: 0,
    createdAt: new Date().toISOString()
  };
  
  if (!db.data.comments) db.data.comments = [];
  db.data.comments.push(comment);
  await db.write();
  
  res.json({
    comment: {
      id: comment.id,
      text: comment.text,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || '😊',
      likes: 0,
      createdAt: comment.createdAt
    }
  });
});

// DELETE /api/comments/:id - Delete a comment
app.delete('/api/comments/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  await db.read();
  
  const user = db.data.users.find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const commentIndex = (db.data.comments || []).findIndex(c => c.id === req.params.id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: 'Comment not found' });
  }
  
  const comment = db.data.comments[commentIndex];
  if (comment.userId !== user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  db.data.comments.splice(commentIndex, 1);
  await db.write();
  
  res.json({ success: true });
});

// ============================================
// SEED DATA
// ============================================

const seedDatabase = async (force = false) => {
  await db.read();
  
  const allGames = [
    // Arcade
    { id: 'pacman', name: 'Pac-Man', description: 'Eat dots, avoid ghosts! Classic arcade action 👻', icon: '🟡', color: '#FFFF00', category: 'arcade' },
    { id: 'tetris', name: 'Tetris', description: 'Stack falling blocks! Clear lines to score.', icon: '🧱', color: '#00d4ff', category: 'puzzle' },
    { id: '2048', name: '2048', description: 'Swipe to merge tiles! Reach 2048 to win.', icon: '🔢', color: '#edc22e', category: 'puzzle' },
    { id: 'flappy-bird', name: 'Flappy Bird', description: 'Tap to flap! Avoid the pipes.', icon: '🐦', color: '#70c5ce', category: 'casual' },
    { id: 'fruit-slicer', name: 'Fruit Slicer', description: 'Swipe to slice fruits! Avoid bombs 💣', icon: '🍉', color: '#ff6b6b', category: 'action' },
    { id: 'piano-tiles', name: 'Piano Tiles', description: 'Tap the black tiles! Dont miss or tap white.', icon: '🎹', color: '#1a1a2e', category: 'arcade' },
    { id: 'breakout', name: 'Breakout', description: 'Classic brick breaker! Drag paddle, destroy all bricks.', icon: '🧱', color: '#e74c3c', category: 'arcade' },
    { id: 'crossy-road', name: 'Crossy Road', description: 'Tap to hop! Cross roads and rivers safely.', icon: '🐔', color: '#8bc34a', category: 'casual' },
    { id: 'snake-io', name: 'Snake.io', description: 'Grow your snake! Eat orbs and avoid others.', icon: '🐍', color: '#00d4ff', category: 'arcade' },
    { id: 'doodle-jump', name: 'Doodle Jump', description: 'Jump up platforms! Tilt or drag to move.', icon: '🐸', color: '#8bc34a', category: 'casual' },
    { id: 'geometry-dash', name: 'Geometry Dash', description: 'Tap to jump! Avoid spikes and obstacles.', icon: '⬛', color: '#00d4ff', category: 'action' },
    { id: 'endless-runner', name: 'Endless Runner', description: 'Swipe to jump and slide! Collect coins!', icon: '🏃', color: '#ff6b6b', category: 'action' },
    
    // Strategy/Puzzle
    { id: 'tic-tac-toe', name: 'Tic Tac Toe', description: 'Classic X and O! Play against AI or friends.', icon: '⭕', color: '#9b59b6', category: 'strategy' },
    { id: 'connect4', name: 'Connect 4', description: 'Drop discs to connect four in a row!', icon: '🔴', color: '#e74c3c', category: 'strategy' },
    { id: 'chess', name: 'Chess', description: 'The ultimate strategy game. Checkmate to win!', icon: '♟️', color: '#2c3e50', category: 'strategy' },
    { id: 'memory-match', name: 'Memory Match', description: 'Flip cards and find matching pairs!', icon: '🃏', color: '#9b59b6', category: 'puzzle' },
    
    // Action/Reflex
    { id: 'whack-a-mole', name: 'Whack-a-Mole', description: 'Tap the moles before they hide!', icon: '🐹', color: '#8b4513', category: 'action' },
    { id: 'aim-trainer', name: 'Aim Trainer', description: 'Test your reflexes! Tap targets fast.', icon: '🎯', color: '#e74c3c', category: 'action' },
    { id: 'reaction-time', name: 'Reaction Time', description: 'How fast can you react? Test yourself!', icon: '⚡', color: '#f1c40f', category: 'action' },
    { id: 'color-match', name: 'Color Match', description: 'Tap the color that matches the word!', icon: '🎨', color: '#f39c12', category: 'puzzle' },
    { id: 'tap-tap-dash', name: 'Tap Tap Dash', description: 'Tap to turn! Stay on the path.', icon: '👆', color: '#3498db', category: 'action' },
    { id: 'number-tap', name: 'Number Tap', description: 'Tap numbers in order! How fast can you go?', icon: '🔢', color: '#1abc9c', category: 'puzzle' },
    { id: 'bubble-pop', name: 'Bubble Pop', description: 'Pop bubbles before they escape!', icon: '🫧', color: '#00bcd4', category: 'casual' },
    { id: 'simon-says', name: 'Simon Says', description: 'Remember the pattern! Repeat the sequence.', icon: '🔴', color: '#e91e63', category: 'puzzle' },
    
    // Sports
    { id: 'basketball', name: 'Basketball', description: 'Swipe to shoot hoops! Build your streak.', icon: '🏀', color: '#f39c12', category: 'sports' },
    { id: 'golf-putt', name: 'Golf Putt', description: 'Drag to aim and putt! Complete 9 holes.', icon: '⛳', color: '#2ecc71', category: 'sports' },
    { id: 'pong', name: 'Pong', description: 'Classic paddle game! Drag to move, beat the AI.', icon: '🏓', color: '#00d4ff', category: 'retro' },
    { id: 'ball-bounce', name: 'Ball Bounce', description: 'Tap to bounce on colorful platforms!', icon: '🏀', color: '#ff5722', category: 'casual' },
    
    // Retro/Space
    { id: 'asteroids', name: 'Asteroids', description: 'Blast asteroids in space! Classic arcade.', icon: '☄️', color: '#2c3e50', category: 'retro' },
    { id: 'space-invaders', name: 'Space Invaders', description: 'Defend Earth from alien invasion!', icon: '👾', color: '#1a1a2e', category: 'retro' },
    { id: 'missile-game', name: 'Missile Command', description: 'Protect cities from incoming missiles!', icon: '🚀', color: '#c0392b', category: 'retro' },
    
    // Racing
    { id: 'hexgl', name: 'HexGL', description: 'Futuristic racing at insane speeds!', icon: '🏎️', color: '#00d4ff', category: 'racing' },
    { id: 'racer', name: 'Racer', description: 'Dodge traffic on the highway!', icon: '🚗', color: '#e74c3c', category: 'racing' },
    
    // Misc
    { id: 'rock-paper-scissors', name: 'Rock Paper Scissors', description: 'Classic hand game! Best of 3 wins.', icon: '✊', color: '#9b59b6', category: 'casual' },
    { id: 'clumsy-bird', name: 'Clumsy Bird', description: 'Another flappy adventure! Tap to fly.', icon: '🐤', color: '#f1c40f', category: 'casual' },
    { id: 'hextris', name: 'Hextris', description: 'Hexagonal Tetris! Rotate and match colors.', icon: '⬡', color: '#9b59b6', category: 'puzzle' },
    { id: 'tower-game', name: 'Tower Stack', description: 'Stack blocks to build the tallest tower!', icon: '🏗️', color: '#3498db', category: 'casual' },
    { id: 'run3', name: 'Run 3', description: 'Run through space tunnels! Avoid holes.', icon: '🏃', color: '#2c3e50', category: 'action' },
  ];
  
  if (force || db.data.games.length === 0 || db.data.games.length < allGames.length) {
    console.log('🌱 Seeding database with games...');
    
    db.data.games = allGames.map(g => ({
      ...g,
      plays: 0,
      likes: 0,
      createdAt: new Date().toISOString()
    }));
    
    await db.write();
    console.log(`✅ Seeded ${allGames.length} games`);
  }
};

// ============================================
// START SERVER
// ============================================

await seedDatabase();

server.listen(PORT, () => {
  console.log(`
  🎮 GameTok API running on http://localhost:${PORT}
  🔌 WebSocket multiplayer server active
  
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
  
  MESSAGES
    GET    /api/conversations       Get conversations
    GET    /api/conversations/:userId Get/create chat
    POST   /api/messages            Send message
    POST   /api/messages/:id/read   Mark as read

  MULTIPLAYER (WebSocket)
    auth                            Authenticate socket
    room:create                     Create game room
    room:join                       Join room by code
    room:leave                      Leave current room
    room:ready                      Toggle ready status
    game:move                       Make a move
    matchmaking:find                Find random opponent
    invite:send                     Invite friend to game
  ──────────────────────────────────────────
  `);
});
