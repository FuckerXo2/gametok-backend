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

    const token = generateToken();
    await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
    user.token = token;
    
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
    const token = generateToken();

    if (result.rows.length > 0) {
      // Existing user - update token
      user = result.rows[0];
      await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
    } else {
      // Check if email already exists
      if (userEmail) {
        result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [userEmail]);
        if (result.rows.length > 0) {
          // Link OAuth to existing account
          user = result.rows[0];
          await pool.query(
            'UPDATE users SET oauth_provider = $1, oauth_id = $2, token = $3 WHERE id = $4',
            [provider, oauthId, token, user.id]
          );
        }
      }

      if (!user) {
        // Create new user - mark as new so frontend shows onboarding
        isNewUser = true;
        const username = userEmail 
          ? userEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000)
          : `user${Date.now()}`;
        
        result = await pool.query(
          `INSERT INTO users (username, email, display_name, oauth_provider, oauth_id, token) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [username, userEmail, userName || username, provider, oauthId, token]
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
  const { count = 100, category, portraitOnly = false, maxSizeMB = 0, company, requireDeveloper = true } = req.body;
  
  try {
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
            game.company || null
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
      "SELECT id, file_size FROM games WHERE file_size > $1",
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
    
    // Delete large games
    for (const game of largeGames.rows) {
      console.log('Deleting large game: ' + game.id + ' - ' + (game.file_size / 1024 / 1024).toFixed(1) + 'MB');
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
      "SELECT id FROM games WHERE id LIKE 'gm-%' AND (developer IS NULL OR developer = '')"
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

// Add a new game
app.post('/api/admin/games', async (req, res) => {
  try {
    const { id, name, description, icon, color, category, embedUrl, thumbnail } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    const result = await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category, embed_url, thumbnail) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       ON CONFLICT (id) DO UPDATE SET 
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         color = EXCLUDED.color,
         category = EXCLUDED.category,
         embed_url = EXCLUDED.embed_url,
         thumbnail = EXCLUDED.thumbnail
       RETURNING *`,
      [id, name, description || '', icon || '🎮', color || '#FF6B6B', category || 'arcade', embedUrl || null, thumbnail || null]
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

function formatGame(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    thumbnail: row.thumbnail,
    category: row.category,
    embedUrl: row.embed_url,
    plays: row.plays,
    likes: row.like_count,
    saves: row.save_count || 0,
    fileSize: row.file_size,
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

    let following = false;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM followers WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
      following = false;
    } else {
      await pool.query('INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)', [followerId, followingId]);
      following = true;
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

app.get('/api/users/:id/followers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar FROM users u
       JOIN followers f ON u.id = f.follower_id
       WHERE f.following_id = $1`,
      [req.params.id]
    );
    res.json(result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar })));
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
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar FROM users u
       JOIN followers f ON u.id = f.following_id
       WHERE f.follower_id = $1`,
      [req.params.id]
    );
    res.json(result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar })));
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
      res.json({ liked: true, likeCount: newLikeCount });
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
        gameShare
      };
    }));

    const otherUser = await pool.query('SELECT id, username, display_name, avatar FROM users WHERE id = $1', [otherUserId]);

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
      }
    }

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, text, read_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [convId, userId, messageText, [userId]]
    );
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);

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
      `SELECT s.*, u.username, u.display_name, u.avatar, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail, g.color as game_color
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
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail, color: r.game_color },
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
      `SELECT s.*, u.username, u.display_name, u.avatar, g.name as game_name, g.icon as game_icon, g.thumbnail as game_thumbnail, g.color as game_color
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
        game: { id: r.game_id, name: r.game_name, icon: r.game_icon, thumbnail: r.game_thumbnail, color: r.game_color },
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
    { id: 'gm-test-game', name: 'Stack Run', description: 'Smash through platforms!', icon: '🔴', color: '#FF6B6B', category: 'arcade', 
      embedUrl: 'https://html5.gamemonetize.co/rex0qifhxf6n3jluvsgqkr84t7rp9260/' },
    { id: 'gm-phone-evolution', name: 'Phone Evolution', description: 'Evolve your phone!', icon: '📱', color: '#4CAF50', category: 'casual', 
      embedUrl: 'https://html5.gamemonetize.co/v1phpjsgnw87qulbci0gzlxzxxvla41t/' },
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
// START SERVER
// ============================================

const start = async () => {
  await initDB();
  // Don't auto-seed on startup - use admin panel to manage games
  // await seedGames();
  
  server.listen(PORT, () => {
    console.log(`🎮 GameTok API running on port ${PORT} with PostgreSQL`);
  });
};

start().catch(console.error);
