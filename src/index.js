// Main API server with PostgreSQL
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import pool, { initDB, runMigrations, runGamificationMigrations, runLeaderboardMigration, runDeletedGamesMigration, runCoinConfigMigration, runStoriesMigration } from './db.js';
import { runMultiplayerMigration } from './migrations/multiplayer-tables.js';
import { initializePkSocket } from './pk-socket.js';
import { initializeLobbySocket } from './lobby-socket.js';
import { initializeChatSocket } from './chat-socket.js';
import aiRouter from './ai.js';
import assetsRouter from './assets-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const SEKAI_TEMPLATE_ROOT_CANDIDATES = [
  path.resolve(__dirname, '../public/sekai-templates'),
  path.resolve(__dirname, '../../sekai-templates'),
];
const SEKAI_TEMPLATES_ROOT = SEKAI_TEMPLATE_ROOT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const STATIC_UPLOAD_ROOTS = [
  path.join(__dirname, '../public/uploads'),
  STORAGE_ROOT,
];
const GAME_PREVIEW_ROOTS = [
  path.join(__dirname, '../public/game-previews'),
  path.join(STORAGE_ROOT, 'game-previews'),
];

const app = express();
const PORT = process.env.PORT || 3000;

const server = createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔥 NATIVE AI PIPELINE MOUNT 🔥
app.use('/api/ai', aiRouter);

// Global Media & Assets Pool
app.use('/api/assets', assetsRouter);
for (const uploadRoot of STATIC_UPLOAD_ROOTS) {
  app.use('/uploads', express.static(uploadRoot));
}
if (SEKAI_TEMPLATES_ROOT) {
  app.use('/sekai-templates', express.static(SEKAI_TEMPLATES_ROOT));
}

// Serve static thumbnails
app.use('/games/thumbnails', express.static(path.join(__dirname, '../public/thumbnails')));
for (const previewRoot of GAME_PREVIEW_ROOTS) {
  app.use('/game-previews', express.static(previewRoot));
}

// Landing page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GameTOK - Swipe. Play. Compete.</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%); min-height: 100vh; color: #fff; }
        .container { max-width: 600px; margin: 0 auto; padding: 60px 24px; text-align: center; }
        .logo { width: 120px; height: 120px; background: linear-gradient(135deg, #FF6B6B, #FF8E53, #FFC107); border-radius: 28px; margin: 0 auto 32px; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 800; box-shadow: 0 20px 60px rgba(255, 142, 83, 0.3); }
        h1 { font-size: 42px; font-weight: 800; margin-bottom: 16px; background: linear-gradient(135deg, #FF6B6B, #FF8E53, #FFC107); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .tagline { font-size: 20px; color: #888; margin-bottom: 48px; }
        .features { text-align: left; margin-bottom: 48px; }
        .feature { display: flex; align-items: center; padding: 16px 0; border-bottom: 1px solid #222; }
        .feature-icon { font-size: 28px; margin-right: 16px; }
        .feature-text h3 { font-size: 16px; margin-bottom: 4px; }
        .feature-text p { font-size: 14px; color: #666; }
        .support { background: #111; border-radius: 16px; padding: 32px; margin-top: 32px; }
        .support h2 { font-size: 20px; margin-bottom: 16px; }
        .support p { color: #888; font-size: 14px; margin-bottom: 16px; }
        .support a { color: #FF8E53; text-decoration: none; }
        .footer { margin-top: 48px; color: #444; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">G</div>
        <h1>GameTOK</h1>
        <p class="tagline">Swipe. Play. Compete.</p>
        <div class="features">
            <div class="feature"><span class="feature-icon">👆</span><div class="feature-text"><h3>Swipe to Discover</h3><p>Find your next favorite game with a simple swipe</p></div></div>
            <div class="feature"><span class="feature-icon">🎮</span><div class="feature-text"><h3>Instant Play</h3><p>No downloads, no waiting. Just tap and play</p></div></div>
            <div class="feature"><span class="feature-icon">🏆</span><div class="feature-text"><h3>Compete & Climb</h3><p>Challenge friends and top the leaderboards</p></div></div>
            <div class="feature"><span class="feature-icon">🔥</span><div class="feature-text"><h3>New Games Weekly</h3><p>Fresh content added regularly</p></div></div>
        </div>
        <div class="support" id="support">
            <h2>Need Help?</h2>
            <p>For support, bug reports, or feedback:</p>
            <p><a href="mailto:gametokapp@gmail.com">gametokapp@gmail.com</a></p>
        </div>
        <div class="footer"><p>© 2026 GameTOK. All rights reserved.</p></div>
    </div>
</body>
</html>`);
});

const hashPassword = (password) => crypto.createHash('sha256').update(password).digest('hex');
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ============================================
// REMOTE CONFIG - Change app behavior without updates
// ============================================
const APP_CONFIG = {
  adFrequency: 3,           // Show ad every X games scrolled
  minAppVersion: '1.0.0',   // Minimum supported version
  maintenanceMode: false,   // Kill switch for the app
  featuredGameId: null,     // Pin a game to top of feed
};

app.get('/api/config', (req, res) => {
  res.json(APP_CONFIG);
});

// Admin endpoint to update config
app.patch('/api/admin/config', (req, res) => {
  const { adFrequency, minAppVersion, maintenanceMode, featuredGameId } = req.body;
  if (adFrequency !== undefined) APP_CONFIG.adFrequency = adFrequency;
  if (minAppVersion !== undefined) APP_CONFIG.minAppVersion = minAppVersion;
  if (maintenanceMode !== undefined) APP_CONFIG.maintenanceMode = maintenanceMode;
  if (featuredGameId !== undefined) APP_CONFIG.featuredGameId = featuredGameId;
  res.json({ success: true, config: APP_CONFIG });
});

// Admin endpoint to assign random 3D avatars to all users
app.post('/api/admin/assign-avatars', async (req, res) => {
  const AVATAR_IDS = [
    'default_3d',
    'light_curly', 'light_straight', 'light_buzz', 'light_wavy', 'light_ponytail', 'light_spiky',
    'medium_curly', 'medium_braids', 'medium_fade', 'medium_wavy', 'medium_bun', 'medium_short',
    'medDark_afro',
  ];
  const BG_COLOR = '%23F5D558'; // URL-encoded #F5D558

  try {
    const result = await pool.query('SELECT id, username, avatar FROM users');
    const users = result.rows;
    let updated = 0;

    for (const user of users) {
      const randomId = AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
      const avatarUrl = `avatar-creator://${randomId}?bg=${BG_COLOR}`;
      await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatarUrl, user.id]);
      updated++;
    }

    res.json({ success: true, updated, totalUsers: users.length, avatarOptions: AVATAR_IDS.length });
  } catch (e) {
    console.error('Assign avatars error:', e);
    res.status(500).json({ error: 'Failed to assign avatars: ' + e.message });
  }
});

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
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [username]);
    const user = result.rows[0];

    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let token = user.token;
    if (!token) {
      token = generateToken();
      await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
      user.token = token;
    }

    res.json({ user: formatUser(user), token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// OAuth endpoint for Apple/Google Sign-In
app.post('/api/auth/oauth', async (req, res) => {
  const { provider, identityToken, idToken, email, fullName, user: oauthUser } = req.body;

  if (!provider) return res.status(400).json({ error: 'Provider required' });

  try {
    let userEmail = email;
    let userName = null;
    let oauthId = null;

    if (provider === 'apple') {
      // Apple Sign-In
      oauthId = oauthUser; // Apple user ID
      if (fullName) {
        userName = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ');
      }
    } else if (provider === 'google') {
      // Google Sign-In
      oauthId = oauthUser?.id;
      userEmail = oauthUser?.email;
      userName = oauthUser?.name;
    }

    if (!oauthId) return res.status(400).json({ error: 'Invalid OAuth data' });

    // Check if user exists with this OAuth ID
    let result = await pool.query(
      'SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2',
      [provider, oauthId]
    );

    let user;
    let isNewUser = false;
    let token = null;

    if (result.rows.length > 0) {
      // Existing user - reuse existing token or generate new if null
      user = result.rows[0];
      token = user.token;
      if (!token) {
        token = generateToken();
        await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
      }
    } else {
      // Check if email already exists
      if (userEmail) {
        result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [userEmail]);
        if (result.rows.length > 0) {
          // Link OAuth to existing account
          user = result.rows[0];
          token = user.token;
          if (!token) {
            token = generateToken();
          }
          await pool.query(
            'UPDATE users SET oauth_provider = $1, oauth_id = $2, token = $3 WHERE id = $4',
            [provider, oauthId, token, user.id]
          );
        }
      }

      if (!user) {
        // Create new user WITHOUT username - they must choose one in onboarding
        isNewUser = true;
        token = generateToken();

        result = await pool.query(
          `INSERT INTO users (username, email, display_name, oauth_provider, oauth_id, token) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [null, userEmail, userName, provider, oauthId, token]
        );
        user = result.rows[0];
      }
    }

    res.json({ user: formatUser(user), token, isNewUser });
  } catch (e) {
    console.error('OAuth error:', e);
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

// Helper function to get file size from URL via HEAD request
async function getFileSizeFromUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      return parseInt(contentLength, 10);
    }
    return null; // Unknown size
  } catch (e) {
    return null; // Failed to get size
  }
}

// Bulk import games from GameMonetize
app.post('/api/admin/import-gamemonetize', async (req, res) => {
  const { count = 100, category, portraitOnly = false, maxSizeMB = 0, company, requireDeveloper = false } = req.body;

  try {
    // Get list of previously deleted games to skip
    const deletedGamesResult = await pool.query('SELECT id FROM deleted_games');
    const deletedGameIds = new Set(deletedGamesResult.rows.map(r => r.id));
    console.log(`Found ${deletedGameIds.size} previously deleted games to skip`);

    // GameMonetize's category filter doesn't work reliably, so we fetch more and filter ourselves
    const fetchCount = (category || portraitOnly) ? Math.min(count * 20, 5000) : Math.min(count, 5000);
    let feedUrl = `https://gamemonetize.com/feed.php?format=0&type=mobile&num=${fetchCount}`;

    // Add company filter if specified (developer filter)
    if (company) {
      feedUrl += `&company=${encodeURIComponent(company)}`;
    }

    console.log(`Fetching games from: ${feedUrl}`);

    // Fetch games from GameMonetize
    const response = await fetch(feedUrl);
    let games = await response.json();

    if (!Array.isArray(games) || games.length === 0) {
      return res.status(400).json({ error: 'No games found from GameMonetize' });
    }

    // Filter out previously deleted games FIRST
    let skippedDeleted = 0;
    const beforeDeletedFilter = games.length;
    games = games.filter(g => {
      const gameId = `gm-${g.id}`;
      if (deletedGameIds.has(gameId)) {
        skippedDeleted++;
        return false;
      }
      return true;
    });
    console.log(`After deleted filter: ${games.length} games (${skippedDeleted} were previously deleted)`);

    // Filter out games without a developer if requireDeveloper is true
    let skippedNoDeveloper = 0;
    if (requireDeveloper) {
      const beforeCount = games.length;
      games = games.filter(g => g.company && g.company.trim() !== '');
      skippedNoDeveloper = beforeCount - games.length;
      console.log(`After developer filter: ${games.length} games (${skippedNoDeveloper} had no developer)`);
    }

    // Filter by category if specified (case-insensitive)
    if (category) {
      const categoryLower = category.toLowerCase();
      games = games.filter(g => g.category && g.category.toLowerCase() === categoryLower);
    }

    // Filter portrait-only games (height > width) for vertical phone screens
    if (portraitOnly) {
      games = games.filter(g => {
        const width = parseInt(g.width) || 800;
        const height = parseInt(g.height) || 600;
        return height > width; // Portrait = taller than wide
      });
      console.log(`After portrait filter: ${games.length} games`);
    }

    games = games.slice(0, count); // Limit to requested count

    if (games.length === 0) {
      return res.status(400).json({ error: 'No games found matching filters (most games have no developer listed)' });
    }

    // Filter by size if maxSizeMB is specified
    const maxSizeBytes = maxSizeMB > 0 ? maxSizeMB * 1024 * 1024 : 0;
    let skippedForSize = 0;

    if (maxSizeBytes > 0) {
      console.log(`Checking game sizes (max ${maxSizeMB}MB)... This may take a while.`);
      const filteredGames = [];

      for (const game of games) {
        if (game.url) {
          const size = await getFileSizeFromUrl(game.url);
          if (size === null) {
            // Unknown size - include it (can't verify)
            filteredGames.push(game);
          } else if (size <= maxSizeBytes) {
            filteredGames.push(game);
          } else {
            skippedForSize++;
            console.log(`Skipped ${game.title}: ${(size / 1024 / 1024).toFixed(1)}MB > ${maxSizeMB}MB`);
          }
        } else {
          filteredGames.push(game);
        }
      }

      games = filteredGames;
      console.log(`After size filter: ${games.length} games (${skippedForSize} skipped for being too large)`);
    }

    if (games.length === 0) {
      return res.status(400).json({ error: `No games found under ${maxSizeMB}MB (${skippedForSize} were too large)` });
    }

    console.log(`Found ${games.length} games, importing...`);

    let imported = 0;
    let skipped = 0;

    for (const game of games) {
      try {
        // Generate a unique ID from GameMonetize ID
        const gameId = `gm-${game.id}`;

        // Map category to emoji icon
        const categoryIcons = {
          'Arcade': '🕹️',
          'Puzzle': '🧩',
          'Racing': '🏎️',
          'Sports': '⚽',
          'Action': '💥',
          'Adventure': '🗺️',
          'Strategy': '♟️',
          'Hypercasual': '🎯',
          'Girls': '👗',
          'Boys': '🎮',
          'Shooting': '🔫',
          'Multiplayer': '👥',
        };

        const icon = categoryIcons[game.category] || '🎮';

        // Generate a color based on category
        const categoryColors = {
          'Arcade': '#FF6B6B',
          'Puzzle': '#4ECDC4',
          'Racing': '#FFE66D',
          'Sports': '#95E1D3',
          'Action': '#F38181',
          'Adventure': '#AA96DA',
          'Strategy': '#6C5CE7',
          'Hypercasual': '#FD79A8',
          'Girls': '#FF85A2',
          'Boys': '#74B9FF',
          'Shooting': '#E17055',
          'Multiplayer': '#00B894',
        };

        const color = categoryColors[game.category] || '#FF6B6B';

        await pool.query(
          `INSERT INTO games (id, name, description, icon, color, category, embed_url, thumbnail, developer) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           ON CONFLICT (id) DO NOTHING`,
          [
            gameId,
            game.title,
            game.description || '',
            icon,
            color,
            (game.category || 'arcade').toLowerCase(),
            game.url,
            game.thumb,
            company || game.company || null  // Use the filter company if specified, otherwise API company
          ]
        );
        imported++;
      } catch (e) {
        skipped++;
      }
    }

    const totalResult = await pool.query('SELECT COUNT(*) FROM games');

    res.json({
      success: true,
      imported,
      skipped,
      skippedForSize: skippedForSize || 0,
      skippedNoDeveloper: skippedNoDeveloper || 0,
      skippedDeleted: skippedDeleted || 0,
      totalGames: parseInt(totalResult.rows[0].count)
    });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Failed to import games: ' + e.message });
  }
});


// Delete all large GameMonetize games (uses stored file_size from app reports)
app.post('/api/admin/delete-large-games', async (req, res) => {
  const { maxSizeMB = 10 } = req.body;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  try {
    // Find games with known file_size that exceed the limit
    const largeGames = await pool.query(
      "SELECT id, name, file_size FROM games WHERE file_size > $1",
      [maxSizeBytes]
    );

    // Also get count of games with unknown size
    const unknownSizeCount = await pool.query(
      "SELECT COUNT(*) FROM games WHERE file_size IS NULL AND id LIKE 'gm-%'"
    );

    if (largeGames.rows.length === 0) {
      const totalResult = await pool.query('SELECT COUNT(*) FROM games');
      return res.json({
        success: true,
        deleted: 0,
        remaining: parseInt(totalResult.rows[0].count),
        unknownSize: parseInt(unknownSizeCount.rows[0].count),
        message: 'No games found over ' + maxSizeMB + 'MB. ' + unknownSizeCount.rows[0].count + ' games have unknown size (need to be loaded in app first).'
      });
    }

    // Delete large games and track them
    for (const game of largeGames.rows) {
      console.log('Deleting large game: ' + game.id + ' - ' + (game.file_size / 1024 / 1024).toFixed(1) + 'MB');
      // Track in deleted_games so we don't re-import
      await pool.query(
        'INSERT INTO deleted_games (id, name, reason) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [game.id, game.name, 'too_large']
      );
      await pool.query('DELETE FROM games WHERE id = $1', [game.id]);
    }

    const totalResult = await pool.query('SELECT COUNT(*) FROM games');

    res.json({
      success: true,
      deleted: largeGames.rows.length,
      remaining: parseInt(totalResult.rows[0].count),
      unknownSize: parseInt(unknownSizeCount.rows[0].count)
    });
  } catch (e) {
    console.error('Delete large games error:', e);
    res.status(500).json({ error: 'Failed to delete large games: ' + e.message });
  }
});

// Delete all GameMonetize games without a known developer
app.post('/api/admin/delete-no-developer', async (req, res) => {
  try {
    // Find GameMonetize games without a developer
    const noDeveloperGames = await pool.query(
      "SELECT id, name FROM games WHERE id LIKE 'gm-%' AND (developer IS NULL OR developer = '')"
    );

    if (noDeveloperGames.rows.length === 0) {
      const totalResult = await pool.query('SELECT COUNT(*) FROM games');
      return res.json({
        success: true,
        deleted: 0,
        remaining: parseInt(totalResult.rows[0].count),
        message: 'No games found without a developer'
      });
    }

    // Track deleted games so we don't re-import them
    for (const game of noDeveloperGames.rows) {
      await pool.query(
        'INSERT INTO deleted_games (id, name, reason) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [game.id, game.name, 'no_developer']
      );
    }

    // Delete games without developer
    const deleteResult = await pool.query(
      "DELETE FROM games WHERE id LIKE 'gm-%' AND (developer IS NULL OR developer = '')"
    );

    const totalResult = await pool.query('SELECT COUNT(*) FROM games');

    res.json({
      success: true,
      deleted: noDeveloperGames.rows.length,
      remaining: parseInt(totalResult.rows[0].count)
    });
  } catch (e) {
    console.error('Delete no-developer games error:', e);
    res.status(500).json({ error: 'Failed to delete games: ' + e.message });
  }
});

// Delete all games by a specific developer
app.post('/api/admin/delete-by-developer', async (req, res) => {
  const { developer } = req.body;

  if (!developer) {
    return res.status(400).json({ error: 'Developer name is required' });
  }

  try {
    // Find games by this developer (case-insensitive)
    const games = await pool.query(
      "SELECT id, name FROM games WHERE LOWER(developer) = LOWER($1)",
      [developer]
    );

    if (games.rows.length === 0) {
      const totalResult = await pool.query('SELECT COUNT(*) FROM games');
      return res.json({
        success: true,
        deleted: 0,
        remaining: parseInt(totalResult.rows[0].count),
        message: `No games found from developer "${developer}"`
      });
    }

    // Track deleted games so we don't re-import them
    for (const game of games.rows) {
      await pool.query(
        'INSERT INTO deleted_games (id, name, reason) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [game.id, game.name, `bad_developer:${developer}`]
      );
    }

    // Delete games by developer
    await pool.query(
      "DELETE FROM games WHERE LOWER(developer) = LOWER($1)",
      [developer]
    );

    const totalResult = await pool.query('SELECT COUNT(*) FROM games');

    res.json({
      success: true,
      deleted: games.rows.length,
      remaining: parseInt(totalResult.rows[0].count)
    });
  } catch (e) {
    console.error('Delete by developer error:', e);
    res.status(500).json({ error: 'Failed to delete games: ' + e.message });
  }
});

// Get list of deleted games (for admin panel)
app.get('/api/admin/deleted-games', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, reason, deleted_at FROM deleted_games ORDER BY deleted_at DESC LIMIT 500'
    );

    // Group by reason
    const byReason = {};
    for (const game of result.rows) {
      const reason = game.reason || 'unknown';
      if (!byReason[reason]) byReason[reason] = 0;
      byReason[reason]++;
    }

    res.json({
      total: result.rows.length,
      byReason,
      games: result.rows
    });
  } catch (e) {
    console.error('Get deleted games error:', e);
    res.status(500).json({ error: 'Failed to get deleted games: ' + e.message });
  }
});

// Clear deleted games list (allows re-importing)
app.post('/api/admin/clear-deleted-games', async (req, res) => {
  const { reason } = req.body; // Optional: only clear specific reason

  try {
    let result;
    if (reason) {
      result = await pool.query('DELETE FROM deleted_games WHERE reason = $1', [reason]);
    } else {
      result = await pool.query('DELETE FROM deleted_games');
    }

    res.json({
      success: true,
      cleared: result.rowCount,
      message: reason ? `Cleared ${result.rowCount} games with reason "${reason}"` : `Cleared all ${result.rowCount} deleted games`
    });
  } catch (e) {
    console.error('Clear deleted games error:', e);
    res.status(500).json({ error: 'Failed to clear deleted games: ' + e.message });
  }
});

// Fix multiplayer_only flag for Loops games (games with loops_ prefix)
app.post('/api/admin/fix-multiplayer-games', async (req, res) => {
  try {
    // Set multiplayer_only = TRUE for all games with loops_ prefix
    const result = await pool.query(
      "UPDATE games SET multiplayer_only = TRUE WHERE id LIKE 'loops_%' AND (multiplayer_only IS NULL OR multiplayer_only = FALSE)"
    );

    // Get count of multiplayer games
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM games WHERE multiplayer_only = TRUE"
    );

    // Get list of affected games
    const gamesResult = await pool.query(
      "SELECT id, name FROM games WHERE id LIKE 'loops_%'"
    );

    res.json({
      success: true,
      updated: result.rowCount,
      totalMultiplayerGames: parseInt(countResult.rows[0].count),
      games: gamesResult.rows
    });
  } catch (e) {
    console.error('Fix multiplayer games error:', e);
    res.status(500).json({ error: 'Failed to fix multiplayer games: ' + e.message });
  }
});

// Get coin economy config
app.get('/api/admin/coin-config', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM coin_config WHERE id = 1');
    const config = result.rows[0] || {
      coins_per_usd: 5667,
      earn_rate_per_second: 0.2,
      min_withdrawal_usd: 10,
      withdrawal_fee_percent: 15,
      payouts_enabled: false
    };

    res.json({
      coinsPerUsd: config.coins_per_usd,
      earnRatePerSecond: parseFloat(config.earn_rate_per_second),
      minWithdrawalUsd: parseFloat(config.min_withdrawal_usd),
      withdrawalFeePercent: config.withdrawal_fee_percent,
      payoutsEnabled: config.payouts_enabled,
      // Calculated values
      coinsPerHour: parseFloat(config.earn_rate_per_second) * 3600,
      usdPerHour: (parseFloat(config.earn_rate_per_second) * 3600) / config.coins_per_usd
    });
  } catch (e) {
    console.error('Get coin config error:', e);
    res.status(500).json({ error: 'Failed to get coin config' });
  }
});

// Update coin economy config
app.post('/api/admin/coin-config', async (req, res) => {
  const { coinsPerUsd, earnRatePerSecond, minWithdrawalUsd, withdrawalFeePercent, payoutsEnabled } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (coinsPerUsd !== undefined) {
      updates.push(`coins_per_usd = $${paramIndex++}`);
      values.push(coinsPerUsd);
    }
    if (earnRatePerSecond !== undefined) {
      updates.push(`earn_rate_per_second = $${paramIndex++}`);
      values.push(earnRatePerSecond);
    }
    if (minWithdrawalUsd !== undefined) {
      updates.push(`min_withdrawal_usd = $${paramIndex++}`);
      values.push(minWithdrawalUsd);
    }
    if (withdrawalFeePercent !== undefined) {
      updates.push(`withdrawal_fee_percent = $${paramIndex++}`);
      values.push(withdrawalFeePercent);
    }
    if (payoutsEnabled !== undefined) {
      updates.push(`payouts_enabled = $${paramIndex++}`);
      values.push(payoutsEnabled);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');

    await pool.query(
      `UPDATE coin_config SET ${updates.join(', ')} WHERE id = 1`,
      values
    );

    // Return updated config
    const result = await pool.query('SELECT * FROM coin_config WHERE id = 1');
    const config = result.rows[0];

    res.json({
      success: true,
      config: {
        coinsPerUsd: config.coins_per_usd,
        earnRatePerSecond: parseFloat(config.earn_rate_per_second),
        minWithdrawalUsd: parseFloat(config.min_withdrawal_usd),
        withdrawalFeePercent: config.withdrawal_fee_percent,
        payoutsEnabled: config.payouts_enabled
      }
    });
  } catch (e) {
    console.error('Update coin config error:', e);
    res.status(500).json({ error: 'Failed to update coin config' });
  }
});

// Trigger GitHub Action to scan game sizes
app.post('/api/admin/trigger-size-scan', async (req, res) => {
  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = 'FuckerXo2/gametok-backend';

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    // Ensure scan_progress row exists
    await pool.query('INSERT INTO scan_progress (id) VALUES (1) ON CONFLICT (id) DO NOTHING');

    // Reset progress in database
    await pool.query(
      `UPDATE scan_progress SET 
        is_scanning = TRUE,
        scanned_games = 0,
        total_games = 0,
        current_game = NULL,
        started_at = NOW(),
        updated_at = NOW()
       WHERE id = 1`
    );

    // Trigger the workflow
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scan-game-sizes.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );

    if (response.status === 204) {
      res.json({ success: true, message: 'Game size scan triggered successfully' });
    } else {
      const error = await response.text();
      await pool.query('UPDATE scan_progress SET is_scanning = FALSE WHERE id = 1');
      res.status(500).json({ error: 'Failed to trigger scan: ' + error });
    }
  } catch (e) {
    console.error('Trigger scan error:', e);
    try {
      await pool.query('UPDATE scan_progress SET is_scanning = FALSE WHERE id = 1');
    } catch (e2) {
      console.error('Failed to update scan progress:', e2);
    }
    res.status(500).json({ error: 'Failed to trigger scan: ' + e.message });
  }
});

// Reset scan status AND cancel GitHub workflow
app.post('/api/admin/reset-scan', async (req, res) => {
  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = 'FuckerXo2/gametok-backend';

    let workflowCancelled = false;

    // Try to cancel any running GitHub workflow
    if (GITHUB_TOKEN) {
      try {
        // Get the latest running workflow
        const runsResponse = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scan-game-sizes.yml/runs?status=in_progress&per_page=5`,
          {
            headers: {
              'Authorization': `Bearer ${GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github+json',
            }
          }
        );

        if (runsResponse.ok) {
          const runsData = await runsResponse.json();

          // Cancel all in-progress runs
          for (const run of (runsData.workflow_runs || [])) {
            console.log(`Cancelling workflow run ${run.id}...`);
            const cancelResponse = await fetch(
              `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${run.id}/cancel`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${GITHUB_TOKEN}`,
                  'Accept': 'application/vnd.github+json',
                }
              }
            );
            if (cancelResponse.status === 202) {
              workflowCancelled = true;
              console.log(`Workflow run ${run.id} cancelled`);
            }
          }

          // Also check for queued runs
          const queuedResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scan-game-sizes.yml/runs?status=queued&per_page=5`,
            {
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
              }
            }
          );

          if (queuedResponse.ok) {
            const queuedData = await queuedResponse.json();
            for (const run of (queuedData.workflow_runs || [])) {
              console.log(`Cancelling queued workflow run ${run.id}...`);
              await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${run.id}/cancel`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                  }
                }
              );
            }
          }
        }
      } catch (ghError) {
        console.error('Failed to cancel GitHub workflow:', ghError);
      }
    }

    // Reset database status
    await pool.query(`
      UPDATE scan_progress SET 
        is_scanning = FALSE, 
        scanned_games = 0, 
        total_games = 0, 
        current_game = NULL,
        updated_at = NOW() 
      WHERE id = 1
    `);

    res.json({
      success: true,
      message: workflowCancelled ? 'Scan cancelled and status reset' : 'Scan status reset (no running workflow found)',
      workflowCancelled
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reset scan: ' + e.message });
  }
});

// Check GitHub Action workflow status
app.get('/api/admin/scan-status', async (req, res) => {
  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = 'FuckerXo2/gametok-backend';

    if (!GITHUB_TOKEN) {
      return res.json({ status: 'unknown', error: 'GitHub token not configured' });
    }

    // Get scan progress from database
    const progressResult = await pool.query('SELECT * FROM scan_progress WHERE id = 1');
    const progress = progressResult.rows[0] || { is_scanning: false, scanned_games: 0, total_games: 0, current_game: null };

    // Get latest workflow runs for scan-game-sizes.yml
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scan-game-sizes.yml/runs?per_page=1`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
        }
      }
    );

    if (!response.ok) {
      return res.json({
        status: 'unknown',
        error: 'Failed to fetch workflow status',
        scannedGames: progress.scanned_games,
        totalGames: progress.total_games,
        currentGame: progress.current_game
      });
    }

    const data = await response.json();

    if (!data.workflow_runs || data.workflow_runs.length === 0) {
      return res.json({
        status: 'none',
        message: 'No workflow runs found',
        scannedGames: progress.scanned_games,
        totalGames: progress.total_games,
        currentGame: progress.current_game
      });
    }

    const latestRun = data.workflow_runs[0];

    // Map GitHub status to our status
    let status = 'unknown';
    if (latestRun.status === 'queued' || latestRun.status === 'in_progress') {
      status = 'in_progress';
    } else if (latestRun.status === 'completed') {
      status = latestRun.conclusion === 'success' ? 'completed' : 'failed';
      // Mark scan as complete in database
      if (progress.is_scanning) {
        await pool.query('UPDATE scan_progress SET is_scanning = FALSE, updated_at = NOW() WHERE id = 1');
      }
    }

    res.json({
      status,
      runId: latestRun.id,
      createdAt: latestRun.created_at,
      updatedAt: latestRun.updated_at,
      conclusion: latestRun.conclusion,
      htmlUrl: latestRun.html_url,
      scannedGames: progress.scanned_games,
      totalGames: progress.total_games,
      currentGame: progress.current_game
    });
  } catch (e) {
    console.error('Check scan status error:', e);
    res.json({ status: 'unknown', error: e.message });
  }
});

// Delete all landscape GameMonetize games (re-fetch from API to check dimensions)
app.post('/api/admin/delete-landscape-games', async (req, res) => {
  try {
    // Get all GameMonetize games from our database
    const dbGames = await pool.query("SELECT id FROM games WHERE id LIKE 'gm-%'");
    const gmIds = dbGames.rows.map(r => r.id.replace('gm-', ''));

    if (gmIds.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No GameMonetize games found' });
    }

    // Fetch game data from GameMonetize to get dimensions
    const feedUrl = `https://gamemonetize.com/feed.php?format=0&type=mobile&num=5000`;
    const response = await fetch(feedUrl);
    const allGames = await response.json();

    // Create a map of game ID -> dimensions
    const gameMap = {};
    for (const game of allGames) {
      gameMap[game.id] = {
        width: parseInt(game.width) || 800,
        height: parseInt(game.height) || 600
      };
    }

    // Find landscape games (width >= height)
    const landscapeIds = [];
    for (const gmId of gmIds) {
      const dims = gameMap[gmId];
      if (dims && dims.width >= dims.height) {
        landscapeIds.push(`gm-${gmId}`);
      }
    }

    if (landscapeIds.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No landscape games found' });
    }

    // Delete landscape games
    const placeholders = landscapeIds.map((_, i) => `$${i + 1}`).join(',');
    await pool.query(`DELETE FROM games WHERE id IN (${placeholders})`, landscapeIds);

    const totalResult = await pool.query('SELECT COUNT(*) FROM games');

    res.json({
      success: true,
      deleted: landscapeIds.length,
      remaining: parseInt(totalResult.rows[0].count)
    });
  } catch (e) {
    console.error('Delete landscape error:', e);
    res.status(500).json({ error: 'Failed to delete landscape games: ' + e.message });
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

// Delete all external games (games with embed_url)
app.delete('/api/admin/games-external/bulk', async (req, res) => {
  try {
    // First get count and list
    const countResult = await pool.query('SELECT COUNT(*) as count FROM games WHERE embed_url IS NOT NULL');
    const listResult = await pool.query('SELECT id, name, embed_url FROM games WHERE embed_url IS NOT NULL ORDER BY name');
    
    // Delete all external games
    const deleteResult = await pool.query('DELETE FROM games WHERE embed_url IS NOT NULL RETURNING id, name');
    
    res.json({ 
      success: true, 
      deleted: deleteResult.rows.length,
      games: deleteResult.rows,
      message: `Deleted ${deleteResult.rows.length} external games`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete external games' });
  }
});

// Add a new game
app.post('/api/admin/games', async (req, res) => {
  try {
    const { id, name, description, icon, color, category, embedUrl, thumbnail, multiplayerOnly } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    const result = await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category, embed_url, thumbnail, multiplayer_only) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       ON CONFLICT (id) DO UPDATE SET 
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         color = EXCLUDED.color,
         category = EXCLUDED.category,
         embed_url = EXCLUDED.embed_url,
         thumbnail = EXCLUDED.thumbnail,
         multiplayer_only = EXCLUDED.multiplayer_only
       RETURNING *`,
      [id, name, description || '', icon || '🎮', color || '#FF6B6B', category || 'arcade', embedUrl || null, thumbnail || null, multiplayerOnly || false]
    );
    res.json({ success: true, game: formatGame(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add game' });
  }
});

// Update a game
app.patch('/api/admin/games/:id', async (req, res) => {
  try {
    const { name, description, icon, color, category, embedUrl, thumbnail, enabled } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (icon !== undefined) { updates.push(`icon = $${idx++}`); values.push(icon); }
    if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }
    if (category !== undefined) { updates.push(`category = $${idx++}`); values.push(category); }
    if (embedUrl !== undefined) { updates.push(`embed_url = $${idx++}`); values.push(embedUrl); }
    if (thumbnail !== undefined) { updates.push(`thumbnail = $${idx++}`); values.push(thumbnail); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE games SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ success: true, game: formatGame(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update game' });
  }
});

// Get all games for admin (not randomized)
app.get('/api/admin/games', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games ORDER BY created_at DESC');
    res.json({ games: result.rows.map(formatGame) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/games', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = String(req.query.sort || 'discover').toLowerCase();

  try {
    // Exclude multiplayer-only games from main feed
    let result;
    if (sort === 'random') {
      result = await pool.query(
        'SELECT * FROM games WHERE multiplayer_only = FALSE OR multiplayer_only IS NULL ORDER BY RANDOM() LIMIT $1 OFFSET $2',
        [limit, offset]
      );
    } else {
      result = await pool.query(
        `WITH score_activity AS (
           SELECT
             game_id,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') AS recent_score_events,
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) AS recent_unique_scorers,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
           FROM scores
           GROUP BY game_id
         )
         SELECT
           g.*,
           u.display_name AS creator_display_name,
           u.username AS creator_username,
           COALESCE(sa.recent_score_events, 0) AS recent_score_events,
           COALESCE(sa.recent_unique_scorers, 0) AS recent_unique_scorers,
           COALESCE(sa.recent_activity_score, 0) AS recent_activity_score,
           (
             COALESCE(g.classification_confidence, 0) * 35 +
             LEAST(COALESCE(g.plays, 0) / 4000.0, 28) +
             COALESCE(sa.recent_activity_score, 0) +
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 14
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 8
               WHEN g.created_at >= NOW() - INTERVAL '21 days' THEN 4
               ELSE 0
             END
           ) AS discover_score
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
         LEFT JOIN score_activity sa ON sa.game_id = g.id
         WHERE g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL
         ORDER BY
           discover_score DESC,
           COALESCE(sa.recent_activity_score, 0) DESC,
           COALESCE(g.plays, 0) DESC,
           g.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }
    const countResult = await pool.query('SELECT COUNT(*) FROM games WHERE multiplayer_only = FALSE OR multiplayer_only IS NULL');
    res.json({ games: result.rows.map(formatGame), total: parseInt(countResult.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/discover-lanes', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 24);
  const rawTab = String(req.query.tab || 'Explore').trim();
  const normalizedTab = ['Explore', 'Games', 'Horror', 'Quiz', 'Roleplay'].includes(rawTab) ? rawTab : 'Explore';

  try {
    const result = await pool.query(
      `WITH score_activity AS (
         SELECT
           game_id,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') AS recent_score_events,
           COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) AS recent_unique_scorers,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
           COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
         FROM scores
         GROUP BY game_id
       ),
       discover_pool AS (
         SELECT
           g.*,
           u.display_name AS creator_display_name,
           u.username AS creator_username,
           COALESCE(sa.recent_score_events, 0) AS recent_score_events,
           COALESCE(sa.recent_unique_scorers, 0) AS recent_unique_scorers,
           COALESCE(sa.recent_activity_score, 0) AS recent_activity_score,
           EXTRACT(EPOCH FROM (NOW() - g.created_at)) / 3600.0 AS age_hours,
           (
             COALESCE(g.classification_confidence, 0) * 35 +
             LEAST(COALESCE(g.plays, 0) / 4000.0, 28) +
             COALESCE(sa.recent_activity_score, 0) +
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 14
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 8
               WHEN g.created_at >= NOW() - INTERVAL '21 days' THEN 4
               ELSE 0
             END
           ) AS discover_score,
           (
             COALESCE(sa.recent_activity_score, 0) * 1.9 +
             LEAST(COALESCE(g.plays, 0) / 8000.0, 16) +
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 12
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 6
               ELSE 0
             END
           ) AS rising_score,
           (
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '24 hours' THEN 24
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 18
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 10
               WHEN g.created_at >= NOW() - INTERVAL '21 days' THEN 4
               ELSE 0
             END +
             COALESCE(sa.recent_activity_score, 0) * 0.9 +
             COALESCE(g.classification_confidence, 0) * 10
           ) AS fresh_score,
           (
             COALESCE(g.classification_confidence, 0) * 18 +
             LEAST(COALESCE(g.plays, 0) / 5000.0, 22) +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '7 days' THEN 8
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 4
               ELSE 0
             END
           ) AS evergreen_score,
           (
             COALESCE(g.classification_confidence, 0) * 22 +
             LEAST(COALESCE(g.plays, 0) / 14000.0, 10) +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '7 days' THEN 12
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 6
               ELSE 0
             END +
             GREATEST(0, 12 - LEAST(COALESCE(sa.recent_activity_score, 0), 12))
           ) AS sleeper_score,
           (
             COALESCE(g.classification_confidence, 0) * 30 +
             LEAST(COALESCE(g.plays, 0) / 7000.0, 16) +
             COALESCE(sa.recent_activity_score, 0) * 0.7 +
             CASE
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Roleplay' THEN 6
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Horror' THEN 4
               ELSE 0
             END +
             CASE
               WHEN COALESCE(g.subcategory, '') IN ('romance', 'fantasy', 'immersive_world', 'school_drama', 'psychological', 'creative_tool', 'experimental', 'geography', 'trivia', 'anime') THEN 8
               ELSE 0
             END
           ) AS featured_score,
           (
             COALESCE(g.classification_confidence, 0) * 26 +
             LEAST(COALESCE(g.plays, 0) / 9000.0, 14) +
             CASE
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Roleplay' THEN 12
               ELSE 0
             END +
             CASE
               WHEN COALESCE(g.subcategory, '') IN ('immersive_world', 'fantasy', 'school_drama', 'romance', 'boyfriend', 'girlfriend') THEN 16
               ELSE 0
             END +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 6
               ELSE 0
             END
           ) AS worldbuilding_score
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
         LEFT JOIN score_activity sa ON sa.game_id = g.id
         WHERE
           (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND
           ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (ORDER BY rising_score DESC, discover_score DESC, plays DESC, created_at DESC) AS rising_rank,
           ROW_NUMBER() OVER (ORDER BY fresh_score DESC, discover_score DESC, plays DESC, created_at DESC) AS fresh_rank,
           ROW_NUMBER() OVER (ORDER BY sleeper_score DESC, evergreen_score DESC, discover_score DESC, created_at DESC) AS sleeper_rank,
           ROW_NUMBER() OVER (ORDER BY evergreen_score DESC, discover_score DESC, plays DESC, created_at DESC) AS evergreen_rank,
           ROW_NUMBER() OVER (ORDER BY featured_score DESC, discover_score DESC, plays DESC, created_at DESC) AS featured_rank,
           ROW_NUMBER() OVER (ORDER BY worldbuilding_score DESC, evergreen_score DESC, discover_score DESC, plays DESC, created_at DESC) AS worldbuilding_rank
         FROM discover_pool
       )
       SELECT
         *,
         CASE
           WHEN rising_rank <= $2 THEN 'rising'
           WHEN fresh_rank <= $2 THEN 'fresh'
           WHEN sleeper_rank <= $2 THEN 'sleepers'
           WHEN evergreen_rank <= $2 THEN 'evergreen'
           WHEN featured_rank <= $2 THEN 'featured'
           WHEN worldbuilding_rank <= $2 THEN 'worldbuilding'
           ELSE NULL
         END AS lane_bucket
       FROM ranked
       WHERE
         rising_rank <= $2 OR
         fresh_rank <= $2 OR
         sleeper_rank <= $2 OR
         evergreen_rank <= $2 OR
         featured_rank <= $2 OR
         worldbuilding_rank <= $2`,
      [normalizedTab, limit],
    );

    const lanes = {
      rising: [],
      fresh: [],
      sleepers: [],
      evergreen: [],
      featured: [],
      worldbuilding: [],
    };
    const usedByLane = {
      rising: new Set(),
      fresh: new Set(),
      sleepers: new Set(),
      evergreen: new Set(),
      featured: new Set(),
      worldbuilding: new Set(),
    };

    const rows = result.rows;

    const pushLaneGames = (laneName, rankField) => {
      rows
        .filter((row) => row[rankField] <= limit)
        .sort((a, b) => a[rankField] - b[rankField])
        .forEach((row) => {
          if (lanes[laneName].length >= limit) return;
          if (usedByLane[laneName].has(row.id)) return;
          usedByLane[laneName].add(row.id);
          lanes[laneName].push(formatGame(row));
        });
    };

    pushLaneGames('rising', 'rising_rank');
    pushLaneGames('fresh', 'fresh_rank');
    pushLaneGames('sleepers', 'sleeper_rank');
    pushLaneGames('evergreen', 'evergreen_rank');
    pushLaneGames('featured', 'featured_rank');
    pushLaneGames('worldbuilding', 'worldbuilding_rank');

    res.json({
      tab: normalizedTab,
      lanes,
    });
  } catch (e) {
    console.error('Discover lanes error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/discover-debug', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const rawTab = String(req.query.tab || 'Explore').trim();
  const normalizedTab = ['Explore', 'Games', 'Horror', 'Quiz', 'Roleplay'].includes(rawTab) ? rawTab : 'Explore';

  try {
    const result = await pool.query(
      `WITH score_activity AS (
         SELECT
           game_id,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') AS recent_score_events,
           COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) AS recent_unique_scorers,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
           COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
         FROM scores
         GROUP BY game_id
       ),
       discover_pool AS (
         SELECT
           g.*,
           u.display_name AS creator_display_name,
           u.username AS creator_username,
           COALESCE(sa.recent_score_events, 0) AS recent_score_events,
           COALESCE(sa.recent_unique_scorers, 0) AS recent_unique_scorers,
           COALESCE(sa.recent_activity_score, 0) AS recent_activity_score,
           EXTRACT(EPOCH FROM (NOW() - g.created_at)) / 3600.0 AS age_hours,
           (
             COALESCE(g.classification_confidence, 0) * 35 +
             LEAST(COALESCE(g.plays, 0) / 4000.0, 28) +
             COALESCE(sa.recent_activity_score, 0) +
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 14
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 8
               WHEN g.created_at >= NOW() - INTERVAL '21 days' THEN 4
               ELSE 0
             END
           ) AS discover_score,
           (
             COALESCE(sa.recent_activity_score, 0) * 1.9 +
             LEAST(COALESCE(g.plays, 0) / 8000.0, 16) +
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 12
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 6
               ELSE 0
             END
           ) AS rising_score,
           (
             CASE
               WHEN g.created_at >= NOW() - INTERVAL '24 hours' THEN 24
               WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 18
               WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 10
               WHEN g.created_at >= NOW() - INTERVAL '21 days' THEN 4
               ELSE 0
             END +
             COALESCE(sa.recent_activity_score, 0) * 0.9 +
             COALESCE(g.classification_confidence, 0) * 10
           ) AS fresh_score,
           (
             COALESCE(g.classification_confidence, 0) * 18 +
             LEAST(COALESCE(g.plays, 0) / 5000.0, 22) +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '7 days' THEN 8
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 4
               ELSE 0
             END
           ) AS evergreen_score,
           (
             COALESCE(g.classification_confidence, 0) * 22 +
             LEAST(COALESCE(g.plays, 0) / 14000.0, 10) +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '7 days' THEN 12
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 6
               ELSE 0
             END +
             GREATEST(0, 12 - LEAST(COALESCE(sa.recent_activity_score, 0), 12))
           ) AS sleeper_score,
           (
             COALESCE(g.classification_confidence, 0) * 30 +
             LEAST(COALESCE(g.plays, 0) / 7000.0, 16) +
             COALESCE(sa.recent_activity_score, 0) * 0.7 +
             CASE
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Roleplay' THEN 6
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Horror' THEN 4
               ELSE 0
             END +
             CASE
               WHEN COALESCE(g.subcategory, '') IN ('romance', 'fantasy', 'immersive_world', 'school_drama', 'psychological', 'creative_tool', 'experimental', 'geography', 'trivia', 'anime') THEN 8
               ELSE 0
             END
           ) AS featured_score,
           (
             COALESCE(g.classification_confidence, 0) * 26 +
             LEAST(COALESCE(g.plays, 0) / 9000.0, 14) +
             CASE
               WHEN COALESCE(g.primary_tab, 'Explore') = 'Roleplay' THEN 12
               ELSE 0
             END +
             CASE
               WHEN COALESCE(g.subcategory, '') IN ('immersive_world', 'fantasy', 'school_drama', 'romance', 'boyfriend', 'girlfriend') THEN 16
               ELSE 0
             END +
             CASE
               WHEN g.created_at <= NOW() - INTERVAL '3 days' THEN 6
               ELSE 0
             END
           ) AS worldbuilding_score
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
         LEFT JOIN score_activity sa ON sa.game_id = g.id
         WHERE
           (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND
           ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (ORDER BY discover_score DESC, plays DESC, created_at DESC) AS discover_rank,
           ROW_NUMBER() OVER (ORDER BY rising_score DESC, discover_score DESC, plays DESC, created_at DESC) AS rising_rank,
           ROW_NUMBER() OVER (ORDER BY fresh_score DESC, discover_score DESC, plays DESC, created_at DESC) AS fresh_rank,
           ROW_NUMBER() OVER (ORDER BY sleeper_score DESC, evergreen_score DESC, discover_score DESC, created_at DESC) AS sleeper_rank,
           ROW_NUMBER() OVER (ORDER BY evergreen_score DESC, discover_score DESC, plays DESC, created_at DESC) AS evergreen_rank,
           ROW_NUMBER() OVER (ORDER BY featured_score DESC, discover_score DESC, plays DESC, created_at DESC) AS featured_rank,
           ROW_NUMBER() OVER (ORDER BY worldbuilding_score DESC, evergreen_score DESC, discover_score DESC, plays DESC, created_at DESC) AS worldbuilding_rank
         FROM discover_pool
       )
       SELECT * FROM ranked
       ORDER BY discover_rank ASC
       LIMIT $2`,
      [normalizedTab, limit],
    );

    const games = result.rows.map((row) => {
      const laneMemberships = [];
      if (row.rising_rank <= limit) laneMemberships.push('rising');
      if (row.fresh_rank <= limit) laneMemberships.push('fresh');
      if (row.sleeper_rank <= limit) laneMemberships.push('sleepers');
      if (row.evergreen_rank <= limit) laneMemberships.push('evergreen');
      if (row.featured_rank <= limit) laneMemberships.push('featured');
      if (row.worldbuilding_rank <= limit) laneMemberships.push('worldbuilding');

      return {
        game: formatGame(row),
        scores: {
          discover: Number(row.discover_score || 0),
          rising: Number(row.rising_score || 0),
          fresh: Number(row.fresh_score || 0),
          sleepers: Number(row.sleeper_score || 0),
          evergreen: Number(row.evergreen_score || 0),
          featured: Number(row.featured_score || 0),
          worldbuilding: Number(row.worldbuilding_score || 0),
        },
        ranks: {
          discover: row.discover_rank,
          rising: row.rising_rank,
          fresh: row.fresh_rank,
          sleepers: row.sleeper_rank,
          evergreen: row.evergreen_rank,
          featured: row.featured_rank,
          worldbuilding: row.worldbuilding_rank,
        },
        laneMemberships,
        signals: {
          primaryTab: row.primary_tab || 'Explore',
          category: row.category || null,
          subcategory: row.subcategory || null,
          interactionType: row.interaction_type || null,
          classificationConfidence: row.classification_confidence ?? null,
          recentScoreEvents: row.recent_score_events ?? 0,
          recentUniqueScorers: row.recent_unique_scorers ?? 0,
          recentActivityScore: row.recent_activity_score ?? 0,
          plays: row.plays ?? 0,
          ageHours: Number(row.age_hours || 0),
        },
      };
    });

    res.json({
      tab: normalizedTab,
      count: games.length,
      games,
    });
  } catch (e) {
    console.error('Discover debug error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search games - searches full database
const normalizeSearchQuery = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

app.post('/api/search/track', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const clientId = String(req.headers['x-client-id'] || '').trim() || null;
  const query = String(req.body?.query || '');
  const source = String(req.body?.source || 'explore').trim() || 'explore';
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery || normalizedQuery.length < 2) {
    return res.json({ success: true, tracked: false });
  }

  try {
    let userId = null;
    if (token) {
      const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      userId = userResult.rows[0]?.id || null;
    }

    await pool.query(
      `INSERT INTO search_events (user_id, client_id, query, normalized_query, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, clientId, query.trim(), normalizedQuery, source]
    );

    res.json({ success: true, tracked: true });
  } catch (e) {
    console.error('Track search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/search/trending', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 30);

  try {
    const result = await pool.query(
      `SELECT normalized_query, MIN(query) AS display_query, COUNT(*)::int AS search_count
       FROM search_events
       WHERE created_at > NOW() - INTERVAL '14 days'
         AND LENGTH(normalized_query) >= 2
       GROUP BY normalized_query
       ORDER BY search_count DESC, MAX(created_at) DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      topics: result.rows.map((row) => ({
        query: row.display_query,
        normalizedQuery: row.normalized_query,
        count: row.search_count,
      })),
    });
  } catch (e) {
    console.error('Trending search topics error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/search', async (req, res) => {
  const query = req.query.q || '';
  const limit = parseInt(req.query.limit) || 50;

  if (!query || query.length < 2) {
    return res.json({ games: [], total: 0 });
  }

  try {
    const searchPattern = `%${query.toLowerCase()}%`;
    const result = await pool.query(
      `SELECT
         g.*,
         u.display_name AS creator_display_name,
         u.username AS creator_username
       FROM games g
       LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
       WHERE (
         LOWER(g.name) LIKE $1 OR
         LOWER(COALESCE(g.category, '')) LIKE $1 OR
         LOWER(COALESCE(g.subcategory, '')) LIKE $1 OR
         LOWER(COALESCE(g.primary_tab, '')) LIKE $1 OR
         LOWER(COALESCE(g.description, '')) LIKE $1 OR
         LOWER(COALESCE(u.username, '')) LIKE $1 OR
         LOWER(COALESCE(u.display_name, '')) LIKE $1
       )
       AND (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL)
       ORDER BY 
         CASE
           WHEN LOWER(g.name) LIKE $2 THEN 0
           WHEN LOWER(COALESCE(u.username, '')) LIKE $2 THEN 1
           WHEN LOWER(COALESCE(u.display_name, '')) LIKE $2 THEN 2
           WHEN LOWER(COALESCE(g.subcategory, '')) LIKE $2 THEN 3
           ELSE 4
         END,
         g.plays DESC
       LIMIT $3`,
      [searchPattern, `${query.toLowerCase()}%`, limit]
    );
    res.json({ games: result.rows.map(formatGame), total: result.rows.length });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get multiplayer games only (for Connect screen)
app.get('/api/games/multiplayer', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query(
      'SELECT * FROM games WHERE multiplayer_only = TRUE ORDER BY plays DESC, name ASC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM games WHERE multiplayer_only = TRUE');
    res.json({ games: result.rows.map(formatGame), total: parseInt(countResult.rows[0].count) });
  } catch (e) {
    console.error('Get multiplayer games error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         g.*,
         u.display_name AS creator_display_name,
         u.username AS creator_username
       FROM games g
       LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
       WHERE g.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    res.json({ game: formatGame(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/:id/play', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const clientId = String(req.headers['x-client-id'] || '').trim();
  const cooldownHours = 6;
  try {
    const shouldCountByCooldown = async (lastPlayedAt) => {
      const cooldownResult = await pool.query(
        `SELECT CASE
           WHEN $1::timestamp <= NOW() - INTERVAL '6 hours' THEN TRUE
           ELSE FALSE
         END AS should_count`,
        [lastPlayedAt],
      );
      return Boolean(cooldownResult.rows[0]?.should_count);
    };

    if (!token) {
      if (!clientId) {
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous-no-client' });
      }

      const existingAnonymousPlay = await pool.query(
        'SELECT play_count, last_played_at FROM anonymous_game_plays WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );

      if (existingAnonymousPlay.rows.length === 0) {
        await pool.query(
          `INSERT INTO anonymous_game_plays (client_id, game_id, play_count, first_played_at, last_played_at)
           VALUES ($1, $2, 1, NOW(), NOW())`,
          [clientId, req.params.id],
        );
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous', cooldownHours });
      }

      const shouldCount = await shouldCountByCooldown(existingAnonymousPlay.rows[0].last_played_at);
      if (shouldCount) {
        await pool.query(
          `UPDATE anonymous_game_plays
           SET play_count = COALESCE(play_count, 0) + 1,
               last_played_at = NOW()
           WHERE client_id = $1 AND game_id = $2`,
          [clientId, req.params.id],
        );
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous', cooldownHours });
      }

      await pool.query(
        'UPDATE anonymous_game_plays SET last_played_at = NOW() WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );
      return res.json({ success: true, counted: false, mode: 'anonymous', cooldownHours });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) {
      if (!clientId) {
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous-fallback-no-client' });
      }

      const existingAnonymousPlay = await pool.query(
        'SELECT play_count, last_played_at FROM anonymous_game_plays WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );

      if (existingAnonymousPlay.rows.length === 0) {
        await pool.query(
          `INSERT INTO anonymous_game_plays (client_id, game_id, play_count, first_played_at, last_played_at)
           VALUES ($1, $2, 1, NOW(), NOW())`,
          [clientId, req.params.id],
        );
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous-fallback', cooldownHours });
      }

      const shouldCount = await shouldCountByCooldown(existingAnonymousPlay.rows[0].last_played_at);
      if (shouldCount) {
        await pool.query(
          `UPDATE anonymous_game_plays
           SET play_count = COALESCE(play_count, 0) + 1,
               last_played_at = NOW()
           WHERE client_id = $1 AND game_id = $2`,
          [clientId, req.params.id],
        );
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        return res.json({ success: true, counted: true, mode: 'anonymous-fallback', cooldownHours });
      }

      await pool.query(
        'UPDATE anonymous_game_plays SET last_played_at = NOW() WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );
      return res.json({ success: true, counted: false, mode: 'anonymous-fallback', cooldownHours });
    }

    const userId = userResult.rows[0].id;
    const existingPlay = await pool.query(
      'SELECT play_count, last_played_at FROM game_plays WHERE user_id = $1 AND game_id = $2',
      [userId, req.params.id],
    );

    if (existingPlay.rows.length === 0) {
      await pool.query(
        `INSERT INTO game_plays (user_id, game_id, play_count, first_played_at, last_played_at)
         VALUES ($1, $2, 1, NOW(), NOW())`,
        [userId, req.params.id],
      );
      await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
      await pool.query('UPDATE users SET games_played = COALESCE(games_played, 0) + 1 WHERE id = $1', [userId]);
      return res.json({ success: true, counted: true, mode: 'user', cooldownHours });
    }

    const shouldCount = await shouldCountByCooldown(existingPlay.rows[0].last_played_at);

    if (shouldCount) {
      await pool.query(
        `UPDATE game_plays
         SET play_count = COALESCE(play_count, 0) + 1,
             last_played_at = NOW()
         WHERE user_id = $1 AND game_id = $2`,
        [userId, req.params.id],
      );
      await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
      await pool.query('UPDATE users SET games_played = COALESCE(games_played, 0) + 1 WHERE id = $1', [userId]);
      return res.json({ success: true, counted: true, mode: 'user', cooldownHours });
    }

    await pool.query(
      'UPDATE game_plays SET last_played_at = NOW() WHERE user_id = $1 AND game_id = $2',
      [userId, req.params.id],
    );
    res.json({ success: true, counted: false, mode: 'user', cooldownHours });
  } catch (e) {
    console.error('Record play error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Report game file size (called from app when game loads OR from scanner)
app.post('/api/games/:id/size', async (req, res) => {
  const { sizeBytes, gameName, totalGames } = req.body;
  if (!sizeBytes || typeof sizeBytes !== 'number') {
    return res.status(400).json({ error: 'sizeBytes required' });
  }

  try {
    await pool.query('UPDATE games SET file_size = $1 WHERE id = $2', [sizeBytes, req.params.id]);

    // Update scan progress if this is from the scanner
    if (totalGames) {
      await pool.query(
        `UPDATE scan_progress SET 
          scanned_games = scanned_games + 1,
          total_games = $1,
          current_game = $2,
          updated_at = NOW()
         WHERE id = 1`,
        [totalGames, gameName || req.params.id]
      );
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// GAME PROGRESS / CLOUD SAVES
// ============================================

// Get game progress for a user
app.get('/api/games/:gameId/progress', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT storage_data FROM game_progress WHERE user_id = $1 AND game_id = $2',
      [userId, req.params.gameId]
    );

    if (result.rows.length === 0) {
      return res.json({ storageData: {} });
    }

    res.json({ storageData: result.rows[0].storage_data || {} });
  } catch (e) {
    console.error('Get game progress error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save game progress for a user
app.post('/api/games/:gameId/progress', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { storageData } = req.body;
  if (!storageData || typeof storageData !== 'object') {
    return res.status(400).json({ error: 'storageData object required' });
  }

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    const userId = userResult.rows[0].id;

    // Upsert the progress
    await pool.query(`
      INSERT INTO game_progress (user_id, game_id, storage_data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, game_id) 
      DO UPDATE SET storage_data = $3, updated_at = NOW()
    `, [userId, req.params.gameId, JSON.stringify(storageData)]);

    res.json({ success: true });
  } catch (e) {
    console.error('Save game progress error:', e);
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
    previewVideoUrl: row.preview_video_url || row.previewVideoUrl || null,
    category: row.category,
    subcategory: row.subcategory || null,
    primaryTab: row.primary_tab || row.primaryTab || null,
    interactionType: row.interaction_type || row.interactionType || null,
    classificationConfidence: row.classification_confidence ?? row.classificationConfidence ?? null,
    classificationTags: Array.isArray(row.classification_tags) ? row.classification_tags : (row.classificationTags || []),
    discoveryChips: Array.isArray(row.discovery_chips) ? row.discovery_chips : (row.discoveryChips || []),
    embedUrl: row.embed_url,
    creatorDisplayName: row.creator_display_name || row.creatorDisplayName || null,
    creatorUsername: row.creator_username || row.creatorUsername || null,
    plays: row.plays,
    likes: row.like_count,
    saves: row.save_count || 0,
    fileSize: row.file_size,
    createdAt: row.created_at,
    recentScoreEvents: row.recent_score_events ?? row.recentScoreEvents ?? 0,
    recentUniqueScorers: row.recent_unique_scorers ?? row.recentUniqueScorers ?? 0,
    recentActivityScore: row.recent_activity_score ?? row.recentActivityScore ?? 0,
    discoverScore: row.discover_score ?? row.discoverScore ?? null
  };
}


// ============================================
// USERS ENDPOINTS
// ============================================

// Get list of blocked users
app.get('/api/users/blocked', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar, b.created_at as blocked_at
       FROM users u
       JOIN blocked_users b ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );

    res.json({
      blockedUsers: result.rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        avatar: r.avatar,
        blockedAt: r.blocked_at
      }))
    });
  } catch (e) {
    console.error('Get blocked users error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/recommended', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    let currentUserId = null;
    if (token) {
      const uResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (uResult.rows.length > 0) currentUserId = uResult.rows[0].id;
    }

    let query = `
      SELECT id, username, display_name, avatar 
      FROM users 
      WHERE username IS NOT NULL
    `;
    const params = [];

    if (currentUserId) {
      query += ` AND id != $1 AND id NOT IN (SELECT following_id FROM followers WHERE follower_id = $1) `;
      params.push(currentUserId);
    }

    query += ` ORDER BY RANDOM() LIMIT 50`;

    const result = await pool.query(query, params);

    res.json({ users: result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar })) });
  } catch (e) {
    console.error('Recommended users error:', e);
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

app.get('/api/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(req.params.id);
    let result;
    if (isUUID) {
      result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    } else {
      result = await pool.query('SELECT * FROM users WHERE username = $1', [req.params.id]);
    }

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    const followers = await pool.query('SELECT COUNT(*) FROM followers WHERE following_id = $1', [user.id]);
    const following = await pool.query('SELECT COUNT(*) FROM followers WHERE follower_id = $1', [user.id]);

    // Check if the requesting user follows this profile
    let isFollowing = false;
    let isMutual = false;
    if (token) {
      const currentUserResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (currentUserResult.rows.length > 0) {
        const currentUserId = currentUserResult.rows[0].id;
        const followCheck = await pool.query(
          'SELECT 1 FROM followers WHERE follower_id = $1 AND following_id = $2',
          [currentUserId, user.id]
        );
        isFollowing = followCheck.rows.length > 0;

        if (isFollowing) {
          const mutualCheck = await pool.query(
            'SELECT 1 FROM followers WHERE follower_id = $1 AND following_id = $2',
            [user.id, currentUserId]
          );
          isMutual = mutualCheck.rows.length > 0;
        }
      }
    }

    // Get gamification data (level + streak)
    let levelData = { level: 1, xp: 0 };
    let streakData = { current_streak: 0 };
    try {
      const levelResult = await pool.query('SELECT level, xp FROM user_levels WHERE user_id = $1', [user.id]);
      if (levelResult.rows.length > 0) levelData = levelResult.rows[0];
      const streakResult = await pool.query('SELECT current_streak FROM user_streaks WHERE user_id = $1', [user.id]);
      if (streakResult.rows.length > 0) streakData = streakResult.rows[0];
    } catch (e) {
      // Tables might not exist yet for this user, use defaults
    }

    res.json({
      user: formatUser(user),
      isFollowing,
      isMutual,
      stats: {
        followers: parseInt(followers.rows[0].count),
        following: parseInt(following.rows[0].count),
        gamesPlayed: user.games_played,
        totalScore: user.total_score,
        level: levelData.level,
        xp: levelData.xp,
        streak: streakData.current_streak
      }
    });
  } catch (e) {
    console.error('Get user error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { displayName, bio, avatar, username } = req.body;

  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1 AND token = $2', [req.params.id, token]);
    if (userCheck.rows.length === 0) return res.status(403).json({ error: 'Not authorized' });

    // Validate if changing username
    if (username !== undefined) {
      if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
      // Check if taken by someone else
      const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username, req.params.id]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'Username taken' });
    }

    const result = await pool.query(
      `UPDATE users SET 
        display_name = COALESCE($1, display_name),
        bio = COALESCE($2, bio),
        avatar = COALESCE($3, avatar),
        username = COALESCE($4, username)
       WHERE id = $5 RETURNING *`,
      [displayName, bio, avatar, username, req.params.id]
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

    let following = false;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
      following = false;
    } else {
      await pool.query('INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)', [followerId, followingId]);
      following = true;

      // Send follow notification
      notifications.notifyFollow(followerId, followingId).catch(e => console.log('[Notifications] Follow notify error:', e));

      // Update challenge progress for follow_users
      await pool.query(`
        UPDATE user_challenges 
        SET progress = progress + 1, 
            completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
            completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
        WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
          AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'follow_users')
      `, [followerId]);
    }

    // Check if they follow us back (mutual)
    const theyFollowUs = await pool.query(
      'SELECT * FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followingId, followerId]
    );
    const isMutual = following && theyFollowUs.rows.length > 0;

    res.json({ following, isMutual });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:id/followers', async (req, res) => {
  try {
    // Get the current user from token to check if they follow these users
    const token = req.headers.authorization?.replace('Bearer ', '');
    let currentUserId = null;
    if (token) {
      const currentUserResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (currentUserResult.rows.length > 0) {
        currentUserId = currentUserResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar,
       CASE WHEN EXISTS (
         SELECT 1 FROM followers f2 
         WHERE f2.follower_id = $2 AND f2.following_id = u.id
       ) THEN true ELSE false END as is_following
       FROM users u
       JOIN followers f ON u.id = f.follower_id
       WHERE f.following_id = $1`,
      [req.params.id, currentUserId || req.params.id]
    );
    res.json(result.rows.map(r => ({ 
      id: r.id, 
      username: r.username, 
      displayName: r.display_name, 
      avatar: r.avatar,
      isFollowing: r.is_following
    })));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get pending friend requests (people who follow you but you don't follow back)
app.get('/api/users/:id/pending-requests', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar, f.created_at,
       CASE WHEN EXISTS (
         SELECT 1 FROM followers f2 
         WHERE f2.follower_id = $1 AND f2.following_id = u.id
       ) THEN true ELSE false END as is_mutual
       FROM users u
       JOIN followers f ON u.id = f.follower_id
       WHERE f.following_id = $1
       AND f.created_at > NOW() - INTERVAL '3 days'
       ORDER BY f.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      avatar: r.avatar,
      isMutual: r.is_mutual,
      createdAt: r.created_at
    })));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get count of pending (not yet mutual) requests - for badge
app.get('/api/users/:id/pending-count', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM followers f
       WHERE f.following_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM followers f2 
         WHERE f2.follower_id = $1 AND f2.following_id = f.follower_id
       )`,
      [req.params.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:id/following', async (req, res) => {
  try {
    // Get the current user from token to check if they follow these users
    const token = req.headers.authorization?.replace('Bearer ', '');
    let currentUserId = null;
    if (token) {
      const currentUserResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (currentUserResult.rows.length > 0) {
        currentUserId = currentUserResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar,
       CASE WHEN EXISTS (
         SELECT 1 FROM followers f2 
         WHERE f2.follower_id = $2 AND f2.following_id = u.id
       ) THEN true ELSE false END as is_following
       FROM users u
       JOIN followers f ON u.id = f.following_id
       WHERE f.follower_id = $1`,
      [req.params.id, currentUserId || req.params.id]
    );
    res.json(result.rows.map(r => ({ 
      id: r.id, 
      username: r.username, 
      displayName: r.display_name, 
      avatar: r.avatar,
      isFollowing: r.is_following
    })));
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

    let newLikeCount;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
      const result = await pool.query('UPDATE games SET like_count = like_count - 1 WHERE id = $1 RETURNING like_count', [gameId]);
      newLikeCount = result.rows[0]?.like_count || 0;
      res.json({ liked: false, likeCount: newLikeCount });
    } else {
      await pool.query('INSERT INTO likes (user_id, game_id) VALUES ($1, $2)', [userId, gameId]);
      const result = await pool.query('UPDATE games SET like_count = like_count + 1 WHERE id = $1 RETURNING like_count', [gameId]);
      newLikeCount = result.rows[0]?.like_count || 0;

      // Update challenge progress for like_games
      await pool.query(`
        UPDATE user_challenges 
        SET progress = progress + 1, 
            completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
            completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
        WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
          AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'like_games')
      `, [userId]);

      res.json({ liked: true, likeCount: newLikeCount });

      // Like notifications removed — games don't have owners to notify
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Check which games the current user has liked (batch)
app.post('/api/likes/check', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameIds } = req.body;

  if (!gameIds || !Array.isArray(gameIds)) {
    return res.status(400).json({ error: 'gameIds array required' });
  }

  try {
    // If not authenticated, return empty (no likes)
    if (!token) {
      return res.json({ likedGameIds: [] });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) {
      return res.json({ likedGameIds: [] });
    }

    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT game_id FROM likes WHERE user_id = $1 AND game_id = ANY($2)',
      [userId, gameIds]
    );

    res.json({ likedGameIds: result.rows.map(r => r.game_id) });
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
// SAVED GAMES ENDPOINTS
// ============================================

// Save/unsave a game (toggle bookmark)
app.post('/api/saved-games', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameId } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!gameId) return res.status(400).json({ error: 'gameId required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const existing = await pool.query('SELECT * FROM saved_games WHERE user_id = $1 AND game_id = $2', [userId, gameId]);

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM saved_games WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
      await pool.query('UPDATE games SET save_count = GREATEST(0, save_count - 1) WHERE id = $1', [gameId]);
      const countResult = await pool.query('SELECT save_count FROM games WHERE id = $1', [gameId]);
      res.json({ saved: false, saveCount: countResult.rows[0]?.save_count || 0 });
    } else {
      await pool.query('INSERT INTO saved_games (user_id, game_id) VALUES ($1, $2)', [userId, gameId]);
      await pool.query('UPDATE games SET save_count = save_count + 1 WHERE id = $1', [gameId]);
      const countResult = await pool.query('SELECT save_count FROM games WHERE id = $1', [gameId]);

      // Update challenge progress for save_games
      await pool.query(`
        UPDATE user_challenges 
        SET progress = progress + 1, 
            completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
            completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
        WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
          AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'save_games')
      `, [userId]);

      res.json({ saved: true, saveCount: countResult.rows[0]?.save_count || 0 });
    }
  } catch (e) {
    console.error('Save game error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check which games the current user has saved (batch)
app.post('/api/saved-games/check', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { gameIds } = req.body;

  if (!gameIds || !Array.isArray(gameIds)) {
    return res.status(400).json({ error: 'gameIds array required' });
  }

  try {
    if (!token) {
      return res.json({ savedGameIds: [] });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) {
      return res.json({ savedGameIds: [] });
    }

    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT game_id FROM saved_games WHERE user_id = $1 AND game_id = ANY($2)',
      [userId, gameIds]
    );

    res.json({ savedGameIds: result.rows.map(r => r.game_id) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all saved games for a user
app.get('/api/saved-games/user/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, s.created_at as saved_at FROM games g 
       JOIN saved_games s ON g.id = s.game_id 
       WHERE s.user_id = $1 
       ORDER BY s.created_at DESC`,
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
      
      // Get last message for this conversation
      const lastMsgResult = await pool.query(
        `SELECT id, text, created_at, sender_id, read_by
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [c.id]
      );
      
      const lastMsg = lastMsgResult.rows[0];
      let lastMessage = null;
      
      if (lastMsg) {
        const isFromMe = lastMsg.sender_id === userId;
        const readByArray = lastMsg.read_by || [];
        const isRead = readByArray.includes(c.other_user_id);
        
        // Check for game share in text
        const gameMatch = lastMsg.text?.match(/\[(?:GAME|CHALLENGE):([^\]]+)\]/);
        let gameShare = null;
        
        if (gameMatch) {
          const gameResult = await pool.query('SELECT id, name, thumbnail, color FROM games WHERE id = $1', [gameMatch[1]]);
          if (gameResult.rows[0]) {
            gameShare = {
              id: gameResult.rows[0].id,
              name: gameResult.rows[0].name,
              thumbnail: gameResult.rows[0].thumbnail,
              color: gameResult.rows[0].color
            };
          }
        }
        
        lastMessage = {
          id: lastMsg.id,
          text: lastMsg.text,
          createdAt: lastMsg.created_at,
          isFromMe,
          isRead, // true if the other person has read it (for sent messages)
          isUnread: !isFromMe && !readByArray.includes(userId), // true if I haven't read it yet
          gameShare
        };
      }
      
      return {
        id: c.id,
        user: otherUser.rows[0] ? { id: otherUser.rows[0].id, username: otherUser.rows[0].username, displayName: otherUser.rows[0].display_name, avatar: otherUser.rows[0].avatar } : null,
        streak: c.streak,
        updatedAt: c.updated_at,
        lastMessage
      };
    }));

    res.json({ conversations });
  } catch (e) {
    console.error('Get conversations error:', e);
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

    // Parse game shares and challenges, fetch game data
    const messagesWithGameData = await Promise.all(messages.rows.map(async (m) => {
      const gameMatch = m.text?.match(/\[GAME:([^\]]+)\]/);
      const challengeMatch = m.text?.match(/\[CHALLENGE:([^\]]+)\]/);
      let gameShare = null;

      const gameId = challengeMatch ? challengeMatch[1] : (gameMatch ? gameMatch[1] : null);
      const isChallenge = !!challengeMatch;

      if (gameId) {
        const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        if (gameResult.rows.length > 0) {
          const game = gameResult.rows[0];

          // Get challenger info
          const challengerResult = await pool.query('SELECT username FROM users WHERE id = $1', [m.sender_id]);
          const challengerName = challengerResult.rows[0]?.username;

          gameShare = {
            id: game.id,
            name: game.name,
            icon: game.icon,
            color: game.color,
            thumbnail: game.thumbnail,
            description: game.description,
            isChallenge: isChallenge,
            challengerId: isChallenge ? m.sender_id : null,
            challengerName: isChallenge ? challengerName : null,
            challengerScore: null, // TODO: fetch from scores table
            challengeStatus: isChallenge ? 'pending' : null,
          };
        }
      }

      return {
        id: m.id,
        text: m.text,
        senderId: m.sender_id,
        isMe: m.sender_id === userId,
        createdAt: m.created_at,
        isRead: m.read_by ? m.read_by.includes(otherUserId) : false,
        gameShare
      };
    }));

    const otherUser = await pool.query('SELECT id, username, display_name, avatar FROM users WHERE id = $1', [otherUserId]);

    // Mark all messages from the other user as read
    await pool.query(
      `UPDATE messages SET read_by = array_append(read_by, $1) 
       WHERE conversation_id = $2 AND sender_id = $3 AND NOT ($1 = ANY(read_by))`,
      [userId, conv.rows[0].id, otherUserId]
    );

    res.json({
      conversation: { id: conv.rows[0].id, user: otherUser.rows[0], streak: conv.rows[0].streak },
      messages: messagesWithGameData
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { conversationId, recipientId, text, gameShare } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!text && !gameShare) return res.status(400).json({ error: 'text or gameShare required' });

  try {
    const userResult = await pool.query('SELECT id, username FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;
    const username = userResult.rows[0].username;

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

    // If it's a game share, fetch game data and include it
    let messageText = text || '';
    let gameData = null;

    if (gameShare?.gameId) {
      const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameShare.gameId]);
      if (gameResult.rows.length > 0) {
        const game = gameResult.rows[0];
        const isChallenge = gameShare.isChallenge || false;
        gameData = {
          id: game.id,
          name: game.name,
          icon: game.icon,
          color: game.color,
          thumbnail: game.thumbnail,
          description: game.description,
          isChallenge: isChallenge,
          challengerId: isChallenge ? userId : null,
          challengerName: isChallenge ? username : null,
          challengerScore: null,
          challengeStatus: isChallenge ? 'pending' : null,
        };
        // Store game share marker in text for backwards compatibility
        const prefix = isChallenge ? '[CHALLENGE:' : '[GAME:';
        messageText = `${prefix}${game.id}] ${messageText || (isChallenge ? `${username} challenged you to ${game.name}!` : `Check out ${game.name}!`)}`;

        // Update challenge progress for share_game
        await pool.query(`
          UPDATE user_challenges 
          SET progress = progress + 1, 
              completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
              completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
          WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
            AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'share_game')
        `, [userId]);
      }
    }

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, text, read_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [convId, userId, messageText, [userId]]
    );
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);

    // Send message notification to recipient
    if (convId) {
      console.log('[Messages] Attempting to send notification for convId:', convId);
      const convResult = await pool.query('SELECT participant1_id, participant2_id FROM conversations WHERE id = $1', [convId]);
      if (convResult.rows.length > 0) {
        const conv = convResult.rows[0];
        const recipId = conv.participant1_id === userId ? conv.participant2_id : conv.participant1_id;
        const preview = (text || gameData?.name || 'Sent a message').substring(0, 50);
        console.log('[Messages] Sending notification to recipId:', recipId, 'preview:', preview);
        notifications.notifyMessage(userId, recipId, preview).catch(e => console.log('[Notifications] Message notify error:', e));
      } else {
        console.log('[Messages] No conversation found for convId:', convId);
      }
    } else {
      console.log('[Messages] No convId, skipping notification');
    }

    res.json({
      message: {
        id: result.rows[0].id,
        text: result.rows[0].text,
        senderId: userId,
        isMe: true,
        createdAt: result.rows[0].created_at,
        gameShare: gameData
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// COMMENTS ENDPOINTS
// ============================================

app.get('/api/comments/:gameId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;

  // Get current user if authenticated
  if (token) {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length > 0) userId = userResult.rows[0].id;
  }

  try {
    // Get comments, excluding blocked users
    let query = `
      SELECT c.*, u.username, u.display_name, u.avatar,
        ${userId ? `EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $2) as liked` : 'false as liked'}
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.game_id = $1
      ${userId ? `AND c.user_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $2)` : ''}
      ORDER BY c.created_at DESC LIMIT 50
    `;

    const result = await pool.query(query, userId ? [req.params.gameId, userId] : [req.params.gameId]);

    res.json({
      comments: result.rows.map(r => ({
        id: r.id, text: r.text, userId: r.user_id, username: r.username,
        displayName: r.display_name, avatarUrl: r.avatar, likes: r.likes,
        liked: r.liked, createdAt: r.created_at
      })),
      total: result.rows.length
    });
  } catch (e) {
    console.error('Get comments error:', e);
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

    // Update challenge progress for post_comments
    await pool.query(`
      UPDATE user_challenges 
      SET progress = progress + 1, 
          completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
          completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
      WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
        AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'post_comments')
    `, [user.id]);

    res.json({
      comment: {
        id: result.rows[0].id, text: result.rows[0].text, userId: user.id,
        username: user.username, displayName: user.display_name, avatar: user.avatar,
        likes: 0, createdAt: result.rows[0].created_at
      }
    });

    // Notify all other users who commented on this game (like Instagram thread notifications)
    pool.query(
      'SELECT DISTINCT user_id FROM comments WHERE game_id = $1 AND user_id != $2',
      [gameId, user.id]
    ).then(commentersResult => {
      const otherCommenters = commentersResult.rows.map(r => r.user_id);
      if (otherCommenters.length > 0) {
        const displayName = user.display_name || user.username;
        notifications.sendPushNotification(
          otherCommenters,
          '💬 New Comment',
          `${displayName}: ${text.trim().substring(0, 50)}${text.trim().length > 50 ? '...' : ''}`,
          { type: 'social', action: 'comment', gameId, userId: user.id }
        ).catch(e => console.log('[Notifications] Comment notify error:', e));
      }
    }).catch(e => console.log('[Notifications] Comment query error:', e));
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

// Like/unlike a comment
app.post('/api/comments/:id/like', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;
    const commentId = req.params.id;

    // Check if already liked
    const existing = await pool.query(
      'SELECT 1 FROM comment_likes WHERE user_id = $1 AND comment_id = $2',
      [userId, commentId]
    );

    if (existing.rows.length > 0) {
      // Unlike
      await pool.query('DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2', [userId, commentId]);
      await pool.query('UPDATE comments SET likes = likes - 1 WHERE id = $1', [commentId]);
      res.json({ liked: false });
    } else {
      // Like
      await pool.query('INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)', [userId, commentId]);
      await pool.query('UPDATE comments SET likes = likes + 1 WHERE id = $1', [commentId]);
      res.json({ liked: true });
    }
  } catch (e) {
    console.error('Comment like error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Report a user or content
app.post('/api/report', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { userId, reason, details, contentType, contentId } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'userId and reason required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const reporterId = userResult.rows[0].id;

    // Can't report yourself
    if (reporterId === userId) return res.status(400).json({ error: 'Cannot report yourself' });

    await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, reason, details, content_type, content_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [reporterId, userId, reason, details || null, contentType || null, contentId || null]
    );

    res.json({ success: true, message: 'Report submitted' });
  } catch (e) {
    console.error('Report error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Block a user
app.post('/api/block', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const blockerId = userResult.rows[0].id;

    // Can't block yourself
    if (blockerId === userId) return res.status(400).json({ error: 'Cannot block yourself' });

    await pool.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, userId]
    );

    // Also unfollow each other
    await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [blockerId, userId]);
    await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [userId, blockerId]);

    res.json({ success: true, message: 'User blocked' });
  } catch (e) {
    console.error('Block error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Unblock a user
app.delete('/api/block/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    await pool.query(
      'DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
      [userResult.rows[0].id, req.params.userId]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get blocked users list
app.get('/api/blocked', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar FROM blocked_users b
       JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = $1`,
      [userResult.rows[0].id]
    );

    res.json({ blockedUsers: result.rows });
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
      `SELECT s.*, u.username, u.display_name, u.avatar, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail, g.preview_video_url as game_preview_video_url, g.color as game_color
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
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail, previewVideoUrl: r.game_preview_video_url, color: r.game_color },
        score: r.score, createdAt: r.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Global activity - recent scores from anyone (for when you have no friends)
app.get('/api/feed/global', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  try {
    // Get current user ID to exclude them
    let excludeUserId = null;
    if (token) {
      const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (userResult.rows.length > 0) {
        excludeUserId = userResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `SELECT s.*, u.username, u.display_name, u.avatar, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail, g.preview_video_url as game_preview_video_url, g.color as game_color
       FROM scores s
       JOIN users u ON s.user_id = u.id
       JOIN games g ON s.game_id = g.id
       WHERE s.user_id IS NOT NULL ${excludeUserId ? 'AND s.user_id != $1' : ''}
       ORDER BY s.created_at DESC LIMIT 20`,
      excludeUserId ? [excludeUserId] : []
    );

    res.json({
      activity: result.rows.map(r => ({
        type: 'score', id: r.id,
        user: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail, previewVideoUrl: r.game_preview_video_url, color: r.game_color },
        score: r.score, createdAt: r.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ============================================
// REPORT & BLOCK ENDPOINTS (Apple Guideline 1.2)
// ============================================

// Report a user for objectionable content
app.post('/api/users/:id/report', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { reason, details, contentType, contentId } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  if (!reason) return res.status(400).json({ error: 'Reason required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const reporterId = userResult.rows[0].id;
    const reportedUserId = req.params.id;

    if (reporterId === reportedUserId) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    // Check if user exists
    const targetUser = await pool.query('SELECT id FROM users WHERE id = $1', [reportedUserId]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create report
    const result = await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, reason, details, content_type, content_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [reporterId, reportedUserId, reason, details || null, contentType || null, contentId || null]
    );

    res.json({ success: true, reportId: result.rows[0].id });
  } catch (e) {
    console.error('Report error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Block a user
app.post('/api/users/:id/block', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const blockerId = userResult.rows[0].id;
    const blockedId = req.params.id;

    if (blockerId === blockedId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Check if user exists
    const targetUser = await pool.query('SELECT id FROM users WHERE id = $1', [blockedId]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Block user (upsert to avoid duplicates)
    await pool.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, blockedId]
    );

    // Also unfollow them both ways
    await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [blockerId, blockedId]);
    await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [blockedId, blockerId]);

    res.json({ success: true, blocked: true });
  } catch (e) {
    console.error('Block error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Unblock a user
app.delete('/api/users/:id/block', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const blockerId = userResult.rows[0].id;
    const blockedId = req.params.id;

    await pool.query(
      'DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
      [blockerId, blockedId]
    );

    res.json({ success: true, blocked: false });
  } catch (e) {
    console.error('Unblock error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if a user is blocked
app.get('/api/users/:id/blocked', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;
    const targetId = req.params.id;

    const result = await pool.query(
      'SELECT 1 FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
      [userId, targetId]
    );

    res.json({ blocked: result.rows.length > 0 });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all pending reports
app.get('/api/admin/reports', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, 
        reporter.username as reporter_username,
        reported.username as reported_username
       FROM reports r
       JOIN users reporter ON r.reporter_id = reporter.id
       JOIN users reported ON r.reported_user_id = reported.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at DESC`
    );
    res.json({ reports: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Action a report
app.patch('/api/admin/reports/:id', async (req, res) => {
  const { status } = req.body; // 'reviewed', 'actioned', 'dismissed'
  if (!['reviewed', 'actioned', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const result = await pool.query(
      `UPDATE reports SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true, report: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// GAMIFICATION ENDPOINTS
// ============================================

// XP required for each level (exponential curve)
const XP_PER_LEVEL = (level) => Math.floor(100 * Math.pow(1.5, level - 1));

// Calculate level from XP
const calculateLevel = (xp) => {
  let level = 1;
  let totalXpNeeded = 0;
  while (totalXpNeeded + XP_PER_LEVEL(level) <= xp) {
    totalXpNeeded += XP_PER_LEVEL(level);
    level++;
  }
  return { level, currentXp: xp - totalXpNeeded, xpForNextLevel: XP_PER_LEVEL(level) };
};

// Streak multiplier based on streak length
const getStreakMultiplier = (streak) => {
  if (streak >= 365) return 10;
  if (streak >= 100) return 5;
  if (streak >= 30) return 3;
  if (streak >= 7) return 2;
  if (streak >= 3) return 1.5;
  return 1;
};

// Daily login bonus based on streak
const getDailyBonus = (streak) => {
  const baseBonus = 50;
  const multiplier = getStreakMultiplier(streak);
  return Math.floor(baseBonus * multiplier);
};

// Helper to ensure user has gamification records
const ensureUserGamification = async (userId) => {
  await pool.query('INSERT INTO user_points (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  await pool.query('INSERT INTO user_streaks (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  await pool.query('INSERT INTO user_levels (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
};

// Helper to award points and XP
const awardPoints = async (userId, amount, type, description, metadata = {}) => {
  await ensureUserGamification(userId);

  // Add points
  await pool.query(`
    UPDATE user_points 
    SET balance = balance + $1, lifetime_earned = lifetime_earned + $1, updated_at = NOW()
    WHERE user_id = $2
  `, [amount, userId]);

  // Log transaction
  await pool.query(`
    INSERT INTO points_transactions (user_id, amount, type, description, metadata)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, amount, type, description, JSON.stringify(metadata)]);

  return amount;
};

const awardXP = async (userId, amount) => {
  await ensureUserGamification(userId);

  // Add XP
  const result = await pool.query(`
    UPDATE user_levels 
    SET xp = xp + $1, updated_at = NOW()
    WHERE user_id = $2
    RETURNING xp
  `, [amount, userId]);

  const newXp = result.rows[0].xp;
  const { level } = calculateLevel(newXp);

  // Update level if changed
  await pool.query(`
    UPDATE user_levels SET level = $1 WHERE user_id = $2 AND level != $1
  `, [level, userId]);

  return { xp: newXp, level };
};

// Check and unlock achievements
const checkAchievements = async (userId) => {
  const unlocked = [];

  // Get user stats
  const userResult = await pool.query('SELECT games_played FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];

  const pointsResult = await pool.query('SELECT lifetime_earned FROM user_points WHERE user_id = $1', [userId]);
  const points = pointsResult.rows[0] || { lifetime_earned: 0 };

  const streakResult = await pool.query('SELECT current_streak, longest_streak FROM user_streaks WHERE user_id = $1', [userId]);
  const streak = streakResult.rows[0] || { current_streak: 0, longest_streak: 0 };

  const levelResult = await pool.query('SELECT level FROM user_levels WHERE user_id = $1', [userId]);
  const levelData = levelResult.rows[0] || { level: 1 };

  const savesResult = await pool.query('SELECT COUNT(*) FROM saved_games WHERE user_id = $1', [userId]);
  const saves = parseInt(savesResult.rows[0].count);

  const followersResult = await pool.query('SELECT COUNT(*) FROM followers WHERE following_id = $1', [userId]);
  const followers = parseInt(followersResult.rows[0].count);

  const likesGivenResult = await pool.query('SELECT COUNT(*) FROM likes WHERE user_id = $1', [userId]);
  const likesGiven = parseInt(likesGivenResult.rows[0].count);

  // Get all achievements user hasn't unlocked yet
  const achievements = await pool.query(`
    SELECT a.* FROM achievements a
    WHERE a.id NOT IN (SELECT achievement_id FROM user_achievements WHERE user_id = $1)
  `, [userId]);

  for (const achievement of achievements.rows) {
    let shouldUnlock = false;

    switch (achievement.type) {
      case 'games_played':
        shouldUnlock = user.games_played >= achievement.threshold;
        break;
      case 'streak':
        shouldUnlock = Math.max(streak.current_streak, streak.longest_streak) >= achievement.threshold;
        break;
      case 'level':
        shouldUnlock = levelData.level >= achievement.threshold;
        break;
      case 'saves':
        shouldUnlock = saves >= achievement.threshold;
        break;
      case 'followers':
        shouldUnlock = followers >= achievement.threshold;
        break;
      case 'likes_given':
        shouldUnlock = likesGiven >= achievement.threshold;
        break;
      case 'lifetime_points':
        shouldUnlock = points.lifetime_earned >= achievement.threshold;
        break;
    }

    if (shouldUnlock) {
      await pool.query(`
        INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [userId, achievement.id]);

      // Award achievement rewards
      if (achievement.reward_points > 0) {
        await awardPoints(userId, achievement.reward_points, 'achievement', `Unlocked: ${achievement.name}`);
      }
      if (achievement.reward_xp > 0) {
        await awardXP(userId, achievement.reward_xp);
      }

      unlocked.push(achievement);
    }
  }

  return unlocked;
};

// ============================================
// GAMIFICATION SYSTEM REMOVED
// ============================================
// All gamification endpoints (points, rewards, achievements, challenges) have been removed

// ============================================
// SEED GAMES
// ============================================

const seedGames = async () => {
  // This is the SINGLE SOURCE OF TRUTH for games
  // Games not in this list will be DELETED from the database
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
    { id: 'breakout', name: 'Breakout', description: 'Break the bricks!', icon: '🧱', color: '#e74c3c', category: 'arcade' },
    { id: 'snake-io', name: 'Snake.io', description: 'Grow your snake!', icon: '🐍', color: '#00d4ff', category: 'arcade' },
    { id: 'piano-tiles', name: 'Piano Tiles', description: 'Tap black tiles!', icon: '🎹', color: '#1a1a2e', category: 'arcade' },
    { id: 'tower-blocks-3d', name: 'Tower Blocks 3D', description: '3D block stacking!', icon: '🧱', color: '#3498db', category: 'arcade' },

    // Casual
    { id: 'flappy-bird', name: 'Flappy Bird', description: 'Tap to flap!', icon: '🐦', color: '#70c5ce', category: 'casual' },
    { id: 'doodle-jump', name: 'Doodle Jump', description: 'Jump up!', icon: '🐸', color: '#8bc34a', category: 'casual' },
    { id: 'crossy-road', name: 'Crossy Road', description: 'Cross safely!', icon: '🐔', color: '#8bc34a', category: 'casual' },
    { id: 'bubble-pop', name: 'Bubble Pop', description: 'Pop bubbles!', icon: '🫧', color: '#00bcd4', category: 'casual' },
    { id: 'ball-bounce', name: 'Ball Bounce', description: 'Bounce!', icon: '🏀', color: '#ff5722', category: 'casual' },
    { id: 'towermaster', name: 'Tower Master', description: 'Build towers!', icon: '🗼', color: '#f39c12', category: 'casual' },
    { id: 'rock-paper-scissors', name: 'Rock Paper Scissors', description: 'Classic game!', icon: '✊', color: '#9b59b6', category: 'casual' },

    // Action
    { id: 'fruit-slicer', name: 'Fruit Slicer', description: 'Swipe to slice!', icon: '🍉', color: '#ff6b6b', category: 'action' },
    { id: 'geometry-dash', name: 'Geometry Dash', description: 'Tap to jump!', icon: '⬛', color: '#00d4ff', category: 'action' },
    { id: 'whack-a-mole', name: 'Whack-a-Mole', description: 'Tap the moles!', icon: '🐹', color: '#8b4513', category: 'action' },
    { id: 'aim-trainer', name: 'Aim Trainer', description: 'Test reflexes!', icon: '🎯', color: '#e74c3c', category: 'action' },
    { id: 'tap-tap-dash', name: 'Tap Tap Dash', description: 'Tap to turn!', icon: '👆', color: '#3498db', category: 'action' },

    // Sports
    { id: 'basketball', name: 'Basketball', description: 'Shoot hoops!', icon: '🏀', color: '#f39c12', category: 'sports' },
    { id: 'basketball-3d', name: 'Basketball 3D', description: 'Swipe to shoot hoops!', icon: '🏀', color: '#ff6600', category: 'sports' },

    // Strategy
    { id: 'connect4', name: 'Connect 4', description: 'Connect four in a row!', icon: '🔴', color: '#e74c3c', category: 'strategy' },
    { id: 'tic-tac-toe', name: 'Tic Tac Toe', description: 'X and O!', icon: '⭕', color: '#9b59b6', category: 'strategy' },

    // Retro
    { id: 'pong', name: 'Pong', description: 'Classic paddle!', icon: '🏓', color: '#00d4ff', category: 'retro' },

    // Action - Tomb of the Mask levels (self-hosted)
    { id: 'tomb-of-mask-1', name: 'Tomb of the Mask', description: 'Swipe to escape!', icon: '💀', color: '#1a1a2e', category: 'action' },
    { id: 'tomb-of-mask-2', name: 'Tomb of the Mask', description: 'Swipe to escape!', icon: '💀', color: '#1a1a2e', category: 'action' },
    { id: 'tomb-of-mask-3', name: 'Tomb of the Mask', description: 'Swipe to escape!', icon: '💀', color: '#1a1a2e', category: 'action' },
    { id: 'tomb-of-mask-4', name: 'Tomb of the Mask', description: 'Swipe to escape!', icon: '💀', color: '#1a1a2e', category: 'action' },

    // GameMonetize Embeds (these actually work!)
    {
      id: 'gm-test-game', name: 'Stack Run', description: 'Smash through platforms!', icon: '🔴', color: '#FF6B6B', category: 'arcade',
      embedUrl: 'https://html5.gamemonetize.co/rex0qifhxf6n3jluvsgqkr84t7rp9260/'
    },
    {
      id: 'gm-phone-evolution', name: 'Phone Evolution', description: 'Evolve your phone!', icon: '📱', color: '#4CAF50', category: 'casual',
      embedUrl: 'https://html5.gamemonetize.co/v1phpjsgnw87qulbci0gzlxzxxvla41t/'
    },
  ];

  // First, delete any games NOT in our list
  const gameIds = games.map(g => g.id);
  await pool.query(
    `DELETE FROM games WHERE id != ALL($1::text[])`,
    [gameIds]
  );

  // Then upsert all games (insert or update)
  for (const g of games) {
    await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category, embed_url) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (id) DO UPDATE SET 
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         color = EXCLUDED.color,
         category = EXCLUDED.category,
         embed_url = EXCLUDED.embed_url`,
      [g.id, g.name, g.description, g.icon, g.color, g.category, g.embedUrl || null]
    );
  }

  console.log(`[Seed] Synced ${games.length} games (removed games not in list)`);
};

// ============================================
// STORIES ENDPOINTS
// ============================================

// Get stories from users you follow (and your own)
app.get('/api/stories', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    // Get stories from people you follow + your own, not expired
    const result = await pool.query(`
      SELECT s.*, u.username, u.display_name, u.avatar,
             EXISTS(SELECT 1 FROM story_views WHERE story_id = s.id AND viewer_id = $1) as viewed
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE s.expires_at > NOW()
        AND (s.user_id = $1 OR s.user_id IN (SELECT following_id FROM followers WHERE follower_id = $1))
      ORDER BY 
        CASE WHEN s.user_id = $1 THEN 0 ELSE 1 END,
        s.created_at DESC
    `, [userId]);

    // Group by user
    const storiesByUser = {};
    result.rows.forEach(story => {
      if (!storiesByUser[story.user_id]) {
        storiesByUser[story.user_id] = {
          user: {
            id: story.user_id,
            username: story.username,
            displayName: story.display_name,
            avatar: story.avatar,
          },
          stories: [],
          hasUnviewed: false,
        };
      }
      storiesByUser[story.user_id].stories.push({
        id: story.id,
        mediaUrl: story.media_url,
        mediaType: story.media_type,
        caption: story.caption,
        views: story.views,
        viewed: story.viewed,
        createdAt: story.created_at,
        expiresAt: story.expires_at,
      });
      if (!story.viewed) {
        storiesByUser[story.user_id].hasUnviewed = true;
      }
    });

    res.json({ stories: Object.values(storiesByUser) });
  } catch (e) {
    console.error('Get stories error:', e);
    res.status(500).json({ error: 'Failed to get stories' });
  }
});

// Create a story
app.post('/api/stories', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { mediaUrl, mediaType = 'image', caption } = req.body;
  if (!mediaUrl) return res.status(400).json({ error: 'Media URL required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    // Stories expire after 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO stories (user_id, media_url, media_type, caption, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, mediaUrl, mediaType, caption, expiresAt]
    );

    res.json({ story: result.rows[0] });
  } catch (e) {
    console.error('Create story error:', e);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// View a story (mark as viewed)
app.post('/api/stories/:storyId/view', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { storyId } = req.params;

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const viewerId = userResult.rows[0].id;

    // Record view
    await pool.query(
      `INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [storyId, viewerId]
    );

    // Increment view count
    await pool.query(
      `UPDATE stories SET views = views + 1 WHERE id = $1`,
      [storyId]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('View story error:', e);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// Delete a story (own only)
app.delete('/api/stories/:storyId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { storyId } = req.params;

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id`,
      [storyId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found or not yours' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Delete story error:', e);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// ============================================
// PUSH NOTIFICATIONS
// ============================================

import * as notifications from './notifications.js';
import * as db from './db.js';

// Get notifications inbox (likes, follows, comments on your stuff)
app.get('/api/notifications', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    // Get likes on your games (scores)
    const likes = await pool.query(
      `SELECT l.created_at, u.id as user_id, u.username, u.display_name, u.avatar,
              g.id as game_id, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail
       FROM likes l
       JOIN users u ON l.user_id = u.id
       JOIN games g ON l.game_id = g.id
       WHERE l.game_id IN (SELECT DISTINCT game_id FROM scores WHERE user_id = $1)
         AND l.user_id != $1
       ORDER BY l.created_at DESC LIMIT 20`,
      [userId]
    );

    // Get new followers
    const follows = await pool.query(
      `SELECT f.created_at, u.id as user_id, u.username, u.display_name, u.avatar
       FROM followers f
       JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC LIMIT 20`,
      [userId]
    );

    // Get comments on your games
    const comments = await pool.query(
      `SELECT c.created_at, c.text, u.id as user_id, u.username, u.display_name, u.avatar,
              g.id as game_id, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail
       FROM comments c
       JOIN users u ON c.user_id = u.id
       JOIN games g ON c.game_id = g.id
       WHERE c.game_id IN (SELECT DISTINCT game_id FROM scores WHERE user_id = $1)
         AND c.user_id != $1
       ORDER BY c.created_at DESC LIMIT 20`,
      [userId]
    );

    // Combine and sort by time
    const all = [
      ...likes.rows.map(r => ({
        type: 'like', createdAt: r.created_at,
        user: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail },
      })),
      ...follows.rows.map(r => ({
        type: 'follow', createdAt: r.created_at,
        user: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
      })),
      ...comments.rows.map(r => ({
        type: 'comment', createdAt: r.created_at, text: r.text,
        user: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail },
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);

    res.json({ notifications: all });
  } catch (e) {
    console.error('Notifications inbox error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register push token (authenticated users)
app.post('/api/notifications/register', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).json({ error: 'Push token required' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    await db.savePushToken(userId, pushToken);

    // If this token was previously anonymous, remove it from anonymous table
    await pool.query('DELETE FROM anonymous_push_tokens WHERE token = $1', [pushToken]);

    res.json({ success: true });
  } catch (e) {
    console.error('Register push token error:', e);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

// Register push token for anonymous/non-authenticated users
// This lets us send re-engagement notifications to users who haven't signed up
app.post('/api/notifications/register-anonymous', async (req, res) => {
  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).json({ error: 'Push token required' });

  try {
    // Check if this token is already linked to a real user
    const existingUser = await pool.query('SELECT id FROM push_tokens WHERE token = $1', [pushToken]);
    if (existingUser.rows.length > 0) {
      // Already registered as authenticated user, no need to save anonymously
      return res.json({ success: true, status: 'already_registered' });
    }

    // Save to anonymous tokens table
    await pool.query(
      `INSERT INTO anonymous_push_tokens (token, last_seen_at)
       VALUES ($1, NOW())
       ON CONFLICT (token) DO UPDATE SET last_seen_at = NOW()`,
      [pushToken]
    );

    res.json({ success: true, status: 'anonymous_registered' });
  } catch (e) {
    console.error('Register anonymous push token error:', e);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

// Debug: Check push tokens in DB
app.get('/api/notifications/debug', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, token, created_at FROM push_tokens ORDER BY created_at DESC LIMIT 20');
    res.json({
      totalTokens: result.rows.length,
      tokens: result.rows.map(r => ({
        userId: r.user_id,
        token: r.token.substring(0, 30) + '...',
        createdAt: r.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test: Send a test push notification to yourself
app.post('/api/notifications/test', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id, username FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const user = userResult.rows[0];

    await notifications.sendPushNotification(
      [user.id],
      '🎮 GameTok',
      'Push notifications are working! 🔔',
      { type: 'test' }
    );
    res.json({ success: true, message: `Test notification sent to ${user.username}` });
  } catch (e) {
    console.error('Test notification error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Unregister push token
app.post('/api/notifications/unregister', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    await db.removePushToken(userId);
    res.json({ success: true });
  } catch (e) {
    console.error('Unregister push token error:', e);
    res.status(500).json({ error: 'Failed to unregister push token' });
  }
});

// Test notification (for debugging)
app.post('/api/notifications/test', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    await notifications.sendPushNotification(
      [userId],
      '🎮 Test Notification',
      'If you see this, push notifications are working!',
      { type: 'test' }
    );

    res.json({ success: true, message: 'Test notification sent' });
  } catch (e) {
    console.error('Test notification error:', e);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Admin: blast test notification to ALL registered devices
app.post('/api/admin/test-push', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT user_id FROM push_tokens');
    const userIds = result.rows.map(r => r.user_id);
    if (userIds.length === 0) return res.json({ success: false, message: 'No push tokens registered' });

    await notifications.sendPushNotification(
      userIds,
      '🎮 GameTOK',
      'Push notifications are working! 🔔🎉',
      { type: 'test' }
    );

    res.json({ success: true, message: `Test sent to ${userIds.length} users` });
  } catch (e) {
    console.error('Admin test push error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// MULTIPLAYER ENDPOINTS
// ============================================

import * as multiplayer from './multiplayer.js';

// Authentication middleware for multiplayer endpoints
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = result.rows[0];
    next();
  } catch (e) {
    console.error('Auth middleware error:', e);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Matchmaking
app.post('/api/multiplayer/queue/join', requireAuth, multiplayer.joinQueue);
app.delete('/api/multiplayer/queue/leave', requireAuth, multiplayer.leaveQueue);
app.get('/api/multiplayer/queue/status', requireAuth, multiplayer.getQueueStatus);

// Matches
app.get('/api/multiplayer/matches/active', requireAuth, multiplayer.getActiveMatches);
app.get('/api/multiplayer/matches/:matchId', requireAuth, multiplayer.getMatch);
app.post('/api/multiplayer/matches/:matchId/game', requireAuth, multiplayer.setMatchGame);
app.post('/api/multiplayer/matches/:matchId/score', requireAuth, multiplayer.updateScore);
app.post('/api/multiplayer/matches/:matchId/complete', requireAuth, multiplayer.completeMatch);
app.get('/api/multiplayer/matches/history', requireAuth, multiplayer.getMatchHistory);

// Challenges
app.post('/api/multiplayer/challenges/send', requireAuth, multiplayer.sendChallenge);
app.post('/api/multiplayer/challenges/:challengeId/accept', requireAuth, multiplayer.acceptChallenge);
app.post('/api/multiplayer/challenges/:challengeId/decline', requireAuth, multiplayer.declineChallenge);
app.get('/api/multiplayer/challenges/received', requireAuth, multiplayer.getReceivedChallenges);

// ============================================
// ANONYMOUS PUSH TOKENS MIGRATION
// ============================================

const runAnonymousTokensMigration = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS anonymous_push_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token TEXT NOT NULL UNIQUE,
        last_seen_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_anonymous_push_tokens_token ON anonymous_push_tokens(token);
    `);
    console.log('✅ Anonymous push tokens table ready');
  } catch (e) {
    console.log('Anonymous tokens migration error:', e.message);
  }
};

// ============================================
// START SERVER
// ============================================

const start = async () => {
  await initDB();
  await runMigrations();
  await runGamificationMigrations();
  await runLeaderboardMigration();
  await runDeletedGamesMigration();
  await runCoinConfigMigration();
  await runStoriesMigration();
  await runMultiplayerMigration();
  await runAnonymousTokensMigration();

  server.listen(PORT, () => {
    console.log(`🎮 GameTok API running on port ${PORT} with PostgreSQL`);
  });

  // Initialize Socket.io for PK Mode
  initializePkSocket(server);
  console.log('🔌 Socket.io initialized for PK Mode');

  // Initialize Lobby Socket for real-time game lobbies
  initializeLobbySocket(server);
  console.log('🎯 Lobby Socket initialized for multiplayer lobbies');

  // Initialize Chat Socket for real-time messaging
  initializeChatSocket(server);
  console.log('💬 Chat Socket initialized for messaging');

  // ============================================
  // SCHEDULED NOTIFICATIONS (every 2 hours)
  // ============================================
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  // Helper: send re-engagement to anonymous users (no account)
  const sendAnonymousReEngagement = async () => {
    try {
      // Get anonymous tokens that haven't been seen in 24+ hours
      const result = await pool.query(
        `SELECT token FROM anonymous_push_tokens 
         WHERE last_seen_at < NOW() - INTERVAL '24 hours'
         LIMIT 100`
      );
      if (result.rows.length === 0) return;

      const messages = [
        { title: '🎮 Come back and play!', body: 'New games are waiting for you. Tap to play!' },
        { title: '🔥 You\'re missing out!', body: 'Your friends are playing right now. Join them!' },
        { title: '🎯 Quick game?', body: 'Just 5 minutes. You know you want to!' },
        { title: '✨ New games just dropped!', body: 'Check out the latest games on GameTOK!' },
        { title: '🏆 Can you beat the top score?', body: 'Challenge yourself. Tap to play!' },
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];

      const expo = new (await import('expo-server-sdk')).Expo();
      const pushMessages = result.rows
        .filter(r => expo.constructor.isExpoPushToken(r.token))
        .map(r => ({
          to: r.token,
          sound: 'default',
          title: msg.title,
          body: msg.body,
          data: { type: 're-engagement', action: 'anonymous_inactive' },
          badge: 1,
        }));

      if (pushMessages.length > 0) {
        const chunks = expo.chunkPushNotifications(pushMessages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }
        console.log(`[Scheduler] Sent re-engagement to ${pushMessages.length} anonymous users`);
      }
    } catch (e) {
      console.error('[Scheduler] Anonymous re-engagement error:', e);
    }
  };

  setInterval(async () => {
    console.log('[Scheduler] Running re-engagement notifications...');
    try {
      await notifications.sendDailyInactiveNotifications();
      await notifications.sendDailyRewardNotifications();
      await sendAnonymousReEngagement();
      console.log('[Scheduler] Re-engagement notifications sent');
    } catch (e) {
      console.error('[Scheduler] Error:', e);
    }
  }, TWO_HOURS);

  // Run once on startup after a 30s delay (let server settle)
  setTimeout(async () => {
    console.log('[Scheduler] Initial re-engagement check...');
    try {
      await notifications.sendDailyInactiveNotifications();
      await notifications.sendDailyRewardNotifications();
      await sendAnonymousReEngagement();
    } catch (e) {
      console.error('[Scheduler] Initial run error:', e);
    }
  }, 30000);
};

start().catch(console.error);
