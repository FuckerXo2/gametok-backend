// Main API server with PostgreSQL
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import os from 'os';
import { execSync } from 'child_process';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import fs from 'fs';
import path from 'path';

// Augment PATH for local binaries
const projectNodeBin = path.join(process.cwd(), 'node_modules', '.bin');
const localBin = path.join(os.homedir(), '.local', 'bin');
process.env.PATH = `/opt/homebrew/bin:${projectNodeBin}:${localBin}:${process.env.PATH || ''}`;

import { fileURLToPath } from 'url';
import { createServer } from 'http';
import pool, { initDB, runMigrations, runGamificationMigrations, runLeaderboardMigration, runDeletedGamesMigration, runCoinConfigMigration, runStoriesMigration } from './db.js';
import { runMultiplayerMigration } from './migrations/multiplayer-tables.js';
import { initializePkSocket } from './pk-socket.js';
import { initializeLobbySocket } from './lobby-socket.js';
import { initializeChatSocket } from './chat-socket.js';
import { initializePresenceSocket, presenceRouter } from './presence-socket.js';
import { initializeScoreLobbySocket, scoreLobbyRouter, ensureScoreLobbyColumn } from './score-lobby-socket.js';
import { initializeForgeSocket } from './forge-socket.js';
import aiRouter, { startGenerationQueueWorker, stopGenerationQueueWorker, startForgeAutoscaler, stopForgeAutoscaler } from './ai.js';
import openGameRouter from './opengame-router.js';
import assetsRouter from './assets-router.js';
import { postsPublicRouter, postsAdminRouter } from './posts-router.js';
import avatarRouter, { runAvatarMigration, avatarRecordOf, gameEntitlements, gameSales } from './avatar-router.js';
import tokbuxStoreRouter, { runTokbuxStoreMigration, revenueReport, checkPlayRefunds } from './tokbux-store.js';
import appConfigRouter, { runAppConfigMigration } from './app-config.js';
import blogImagesRouter from './blog-images-router.js';
import { seedPosts } from './seed-posts.js';
import { CATEGORIES, isValidCategory, normalizeCategories, setGameCategories, classifyGame } from './categories.js';
import { backfillGameCategories } from './scripts/backfill-game-categories.js';

import coverArtRouter from './cover-art-router.js';
import adminAssetsRouter from './ai-engine/asset-engine/admin/admin-assets-router.js';
import { captureGameScreenshot, autoCaptureGameThumbnail } from './screenshot-service.js';
import { handleGameUpload, handleGameUploadStart, handleGameUploadFinish, handleGameFilesStart, handleGameFilesFinish, MAX_ZIP_BYTES } from './game-uploads.js';
import { decidePlatform, platformSql } from './mobile-fit.js';
import { announceNewGames } from './new-game-push.js';
import { withCloudSave } from './cloud-save-tag.js';
import adminInsightsRouter from './admin-insights.js';
import { maybeSyncStoreStats } from './store-stats.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || (fs.existsSync('/app') ? '/app/storage' : path.join(__dirname, '../storage'));
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
// Keep the exact request bytes for signed endpoints (match results are HMAC'd over the body).
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/developer/matches/')) req.rawBody = buf; }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging for AI & Admin endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/ai') || req.path.startsWith('/api/admin')) {
    console.log(`🌐 [HTTP] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Render / Cloud Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});


/**
 * Every /api/admin/* route was reachable by anyone on the internet — including
 * ones that mutate the catalogue and ones that spend money per call (cover-art
 * regeneration, category backfill). This gates the whole prefix in one place
 * rather than per-route, so a new admin endpoint is protected by default
 * instead of by remembering.
 */
function adminKeyOk(req) {
  const required = process.env.ADMIN_KEY || process.env.ADMIN_SECRET;
  if (!required) return true;
  const provided = req.query.key || req.headers['x-admin-key'] || req.headers['x-admin-secret'];
  return provided === required;
}

/**
 * Gate administrative endpoints. In production, if ADMIN_SECRET or ADMIN_KEY is configured,
 * requests require ?key=, x-admin-key, or x-admin-secret.
 * The generation dashboard (/admin/generations) and feeds are unlocked via adminKeyOk.
 */
async function requireAdmin(req, res, next) {
  // Generation dashboard feeds (logs/stats) are read-only monitoring metrics
  if (req.path.startsWith('/generation-logs') || req.path.startsWith('/generation-stats')) {
    return next();
  }

  const secret = process.env.ADMIN_SECRET || process.env.ADMIN_KEY;
  if (process.env.NODE_ENV !== 'production' && !secret) return next();
  if (!secret) return next();

  const provided = req.headers['x-admin-secret'] || req.headers['x-admin-key'] || req.query.key;
  if (provided === secret) return next();

  // Or a signed-in account flagged users.is_admin (the admin site at games.gametok.co/admin).
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    try {
      const admin = await pool.query('SELECT 1 FROM users WHERE token = $1 AND is_admin = TRUE', [bearer]);
      if (admin.rowCount) return next();
    } catch (err) {
      console.error('[Admin] account check failed:', err.message);
    }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// Global Media & Assets Pool - Mounted BEFORE requireAdmin so team can upload and manage 3D assets/animations 24/7
app.use('/admin/assets', adminAssetsRouter);
app.use('/api/admin/assets', adminAssetsRouter);

// Registered before the admin routers and route definitions below so it covers
// all of them, including /api/admin/bots and /api/admin/covers.
app.use('/api/admin', requireAdmin);
app.use('/api/admin/insights', adminInsightsRouter);

// 🔥 NATIVE AI PIPELINE MOUNT 🔥
app.use('/api/ai', aiRouter);
app.use('/api/opengame', openGameRouter);

app.use('/api/assets', assetsRouter);
app.use('/api/posts', postsPublicRouter);
app.use('/api/avatar', avatarRouter);
app.use('/api/tokbux', tokbuxStoreRouter);
app.use('/api/app', appConfigRouter);
app.use('/api/admin/posts', postsAdminRouter);
app.use('/api/admin/blog/images', blogImagesRouter);
app.use('/api/admin/covers', coverArtRouter);

app.use('/api/presence', presenceRouter);
app.use('/api/score-lobbies', scoreLobbyRouter);
for (const uploadRoot of STATIC_UPLOAD_ROOTS) {
  app.use('/uploads', express.static(uploadRoot));
}
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

// Serve static thumbnails
app.use('/games/thumbnails', express.static(path.join(__dirname, '../public/thumbnails')));
for (const previewRoot of GAME_PREVIEW_ROOTS) {
  app.use('/game-previews', express.static(previewRoot));
}
app.use('/opengame-games', express.static(path.join(STORAGE_ROOT, 'opengame-games')));

// Serve 3D animation library
const ANIMATIONS_DIR = path.resolve(__dirname, '../../Mixamo Full Motion Pack for UE5 (GLB)');
if (fs.existsSync(ANIMATIONS_DIR)) {
  app.use('/animations', express.static(ANIMATIONS_DIR));
}

// Health check / API entry point
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'GameTOK API', version: '2.0.0' });
});

const hashPassword = (password) => crypto.createHash('sha256').update(password).digest('hex');
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ─── Google Sign-In verification ─────────────────────────────
// Every Google ID token (from the native mobile SDK or web GIS) carries an `aud`
// equal to the OAuth client id that requested it. We accept any of our own client
// ids. Override/extend via GOOGLE_CLIENT_IDS (comma-separated) on Railway.
const GOOGLE_CLIENT_IDS = (
  process.env.GOOGLE_CLIENT_IDS ||
  [
    '690098564284-9j4fj28fiqimjg8c20mn2vtjg6b70qr7.apps.googleusercontent.com', // iOS "web" client + web GIS
    '516560435127-l6db4akjqei5q57j764kgu3aoaedu45l.apps.googleusercontent.com', // Android "web" client
    '690098564284-704g6n4d0ur6audbsgqnd2tnkfranatc.apps.googleusercontent.com', // iOS native client
  ].join(',')
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const googleClient = new OAuth2Client();

// Verifies a Google ID token and returns { sub, email, emailVerified, name, picture }.
// Throws if the token is missing, malformed, expired, or not issued for one of our clients.
async function verifyGoogleIdToken(idToken) {
  if (!idToken) throw new Error('Missing Google ID token');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('Google token has no subject');
  return {
    sub: payload.sub,
    email: payload.email || null,
    emailVerified: payload.email_verified === true,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

// ─── Apple Sign-In verification ──────────────────────────────
// Apple identity tokens are RS256 JWTs signed with keys published at
// https://appleid.apple.com/auth/keys, issued by https://appleid.apple.com, with
// `aud` equal to the app's bundle id (native) or Services ID (web). Accept any of
// our own ids; override/extend via APPLE_CLIENT_IDS (comma-separated) on Railway.
const APPLE_CLIENT_IDS = (process.env.APPLE_CLIENT_IDS || 'com.olasubomi.gametok')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = new JwksClient({
  jwksUri: `${APPLE_ISSUER}/auth/keys`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
  rateLimit: true,
});

// Resolves the Apple public signing key for a given token `kid`.
function getAppleSigningKey(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// Verifies an Apple identity token and returns { sub, email, emailVerified }.
// Throws if the token is missing, malformed, expired, wrong issuer, or not issued
// for one of our client ids. Apple omits the user's name from the token (it only
// arrives client-side on first authorization), so name is handled by the caller.
function verifyAppleIdToken(identityToken) {
  return new Promise((resolve, reject) => {
    if (!identityToken) return reject(new Error('Missing Apple identity token'));
    jwt.verify(
      identityToken,
      getAppleSigningKey,
      { algorithms: ['RS256'], issuer: APPLE_ISSUER, audience: APPLE_CLIENT_IDS },
      (err, payload) => {
        if (err) return reject(err);
        if (!payload?.sub) return reject(new Error('Apple token has no subject'));
        // Apple sends email_verified as either a boolean or the string "true".
        const ev = payload.email_verified;
        resolve({
          sub: payload.sub,
          email: payload.email || null,
          emailVerified: ev === true || ev === 'true',
        });
      },
    );
  });
}

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

// ── Game-generation logs (persistent, survives Railway redeploys) ──────────────

// JSON feed of recent generations (success AND failure) for the dashboard.
app.get('/api/admin/generation-logs', async (req, res) => {
  try {
    try {
      await pool.query(`
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS spend_usd NUMERIC(8,4) DEFAULT 0;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS spend_breakdown JSONB DEFAULT '{}'::jsonb;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS dimension VARCHAR(8);
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS lane VARCHAR(64);
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS engine VARCHAR(32);
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS result_title TEXT;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
      `);
    } catch (_) {}

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const result = await pool.query(
      `SELECT j.id, j.user_id, j.status, j.prompt, j.error, j.phase, j.attempts,
              j.dimension, j.lane, j.engine, j.result_title, j.duration_ms,
              j.spend_usd, j.spend_breakdown,
              j.created_at, j.completed_at,
              u.username, u.display_name
         FROM generation_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.kind = 'dream'
           AND ($2::text IS NULL OR j.status = $2)
         ORDER BY j.created_at DESC
         LIMIT $1`,
      [limit, status],
    );
    res.json(result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.display_name || r.username || null,
      status: r.status,
      prompt: r.prompt,
      error: r.error,
      phase: r.phase,
      attempts: r.attempts,
      dimension: r.dimension,
      lane: r.lane,
      engine: r.engine,
      resultTitle: r.result_title,
      durationMs: r.duration_ms,
      spendUsd: r.spend_usd != null ? Number(r.spend_usd) : 0,
      spendBreakdown: r.spend_breakdown || null,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })));
  } catch (e) {
    console.error('[generation-logs] query failed:', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// True lifetime aggregates for the dashboard cards. The list feed above is
// capped (recent N rows), so counting rows client-side pegs "Total" at the
// fetch limit forever — these stats come straight from the full table.
app.get('/api/admin/generation-stats', async (req, res) => {
  try {
    try {
      await pool.query(`
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS spend_usd NUMERIC(8,4) DEFAULT 0;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS spend_breakdown JSONB DEFAULT '{}'::jsonb;
        ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
      `);
    } catch (_) {}

    const result = await pool.query(
      `SELECT
         count(*)::int                                                          AS total,
         count(*) FILTER (WHERE status = 'complete')::int                       AS succeeded,
         count(*) FILTER (WHERE status = 'failed')::int                         AS failed,
         count(*) FILTER (WHERE status IN ('running', 'queued'))::int           AS running,
         count(*) FILTER (WHERE status = 'canceled')::int                       AS canceled,
         avg(duration_ms) FILTER (WHERE status = 'complete'
                                  AND duration_ms IS NOT NULL)                  AS avg_build_ms,
         coalesce(sum(spend_usd), 0)::numeric(10,4)                            AS total_spend_usd,
         coalesce(avg(spend_usd) FILTER (WHERE status = 'complete' AND spend_usd > 0), 0)::numeric(10,4) AS avg_cost_per_game,
         coalesce(sum(spend_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0)::numeric(10,4) AS today_spend_usd
       FROM generation_jobs
       WHERE kind = 'dream'`,
    );
    const r = result.rows[0] || {};
    const succeeded = r.succeeded || 0;
    const failed = r.failed || 0;
    const finished = succeeded + failed;
    res.json({
      total: r.total || 0,
      succeeded,
      failed,
      running: r.running || 0,
      canceled: r.canceled || 0,
      successRate: finished ? Math.round((succeeded / finished) * 100) : 0,
      avgBuildMs: r.avg_build_ms != null ? Math.round(Number(r.avg_build_ms)) : null,
      totalSpendUsd: Number(r.total_spend_usd || 0),
      avgCostPerGame: Number(r.avg_cost_per_game || 0),
      todaySpendUsd: Number(r.today_spend_usd || 0),
    });
  } catch (e) {
    console.error('[generation-stats] query failed:', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// Full captured console log for one generation (fetched on demand when a row is
// expanded — kept out of the list feed because it can be ~1MB per job).
app.get('/api/admin/generation-logs/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.id, j.status, j.prompt, j.error, j.phase, j.attempts,
              j.dimension, j.lane, j.engine, j.result_title, j.duration_ms,
              j.spend_usd, j.spend_breakdown,
              j.created_at, j.completed_at, j.log,
              u.username, u.display_name
         FROM generation_jobs j
         LEFT JOIN users u ON u.id = j.user_id
        WHERE j.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    const r = result.rows[0];
    res.json({
      id: r.id, status: r.status, prompt: r.prompt, error: r.error, phase: r.phase,
      attempts: r.attempts, dimension: r.dimension, lane: r.lane, engine: r.engine,
      resultTitle: r.result_title, durationMs: r.duration_ms,
      spendUsd: r.spend_usd != null ? Number(r.spend_usd) : 0,
      spendBreakdown: r.spend_breakdown || null,
      createdAt: r.created_at, completedAt: r.completed_at,
      username: r.display_name || r.username || null,
      log: r.log || null,
    });
  } catch (e) {
    console.error('[generation-logs/:id] query failed:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Human-friendly dashboard page (data comes from the JSON feed above).
app.get('/admin/generations', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/generations.html'));
});

// Revenue: TokBux bought with real money (the page + its feed, behind requireAdmin like the rest of /api/admin)
app.get('/api/admin/revenue', async (req, res) => {
  try { checkPlayRefunds(); res.json(await revenueReport(req.query.days)); }
  catch (e) { console.error('[revenue] query failed:', e); res.status(500).json({ error: 'Server error' }); }
});
app.get('/admin/revenue', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/revenue.html'));
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

// Admin endpoint to regenerate all AI game thumbnails
app.post('/api/admin/regenerate-thumbnails', async (req, res) => {
  const { limit, dryRun, force } = req.body;

  try {
    // Import the regeneration logic
    const { generateAndApplyCover, deleteCoverAsset } = await import('./cover-art.js');

    // Get all AI-generated games that need new thumbnails
    // With force=true, regenerate ALL games regardless of current thumbnail URL
    // (use when R2 files have been deleted but DB still points to them)
    const query = `
      SELECT
        id as draft_id,
        title,
        prompt,
        thumbnail,
        category,
        subcategory,
        primary_tab,
        interaction_type,
        classification_tags,
        discovery_chips,
        game_url
      FROM ai_games
      WHERE is_draft = FALSE
        AND (html_payload != '' OR game_url IS NOT NULL)
        ${force ? '' : `AND (thumbnail IS NULL OR thumbnail = '' OR thumbnail NOT LIKE '%r2.dev/covers/%')`}
      ORDER BY created_at DESC
      ${limit ? `LIMIT ${limit}` : ''}
    `;

    const result = await pool.query(query);
    const games = result.rows;

    if (dryRun) {
      return res.json({ 
        success: true, 
        dryRun: true, 
        totalGames: games.length,
        message: `Would regenerate ${games.length} thumbnails`
      });
    }

    // Start regeneration in background
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    // Send immediate response
    res.json({ 
      success: true, 
      message: `Started regenerating ${games.length} thumbnails`,
      totalGames: games.length
    });

    // Process in small batches — Stable Horde's anonymous key gets low
    // priority and chokes under high concurrency.
    const REGEN_CONCURRENCY = 3;
    const processGame = async (game) => {
      try {
        if (!game.prompt) {
          skippedCount++;
          return;
        }

        const draftId = game.draft_id;
        const gameId = `gm-ai-${String(draftId).substring(0, 8)}`;

        // Delete old thumbnail if it exists
        if (game.thumbnail) {
          await deleteCoverAsset(game.thumbnail);
        }

        // Build classification object
        const classification = {
          category: game.category,
          subcategory: game.subcategory,
          primaryTab: game.primary_tab,
          interactionType: game.interaction_type,
          tags: Array.isArray(game.classification_tags) ? game.classification_tags : [],
          discoveryChips: Array.isArray(game.discovery_chips) ? game.discovery_chips : [],
        };

        // Generate new thumbnail
        const newThumbnailUrl = await generateAndApplyCover(pool, {
          draftId,
          gameId,
          title: game.title,
          prompt: game.prompt,
          classification
        });

        if (newThumbnailUrl) {
          successCount++;
          console.log(`[thumbnail-regen] ✅ ${game.title}: ${newThumbnailUrl}`);
        } else {
          failCount++;
          console.log(`[thumbnail-regen] ❌ ${game.title}: No URL returned`);
        }
      } catch (error) {
        failCount++;
        console.error(`[thumbnail-regen] ❌ ${game.title}:`, error.message);
      }
    };

    for (let i = 0; i < games.length; i += REGEN_CONCURRENCY) {
      const batch = games.slice(i, i + REGEN_CONCURRENCY);
      await Promise.all(batch.map(processGame));
    }

    console.log(`[thumbnail-regen] Complete: ${successCount} success, ${failCount} failed, ${skippedCount} skipped`);

  } catch (e) {
    console.error('Thumbnail regeneration error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to regenerate thumbnails: ' + e.message });
    }
  }
});

// Admin endpoint to check thumbnail status
// TEMP backfill — re-encodes oversized cover PNGs to right-sized JPEGs.
app.post('/api/admin/recompress-covers', async (req, res) => {
  const { limit } = req.body || {};
  try {
    const { recompressCoverByUrl } = await import('./cover-art.js');
    const { rows } = await pool.query(
      `SELECT DISTINCT thumbnail FROM games
        WHERE thumbnail LIKE '%/covers/%'
        ${limit ? `LIMIT ${parseInt(limit, 10)}` : ''}`
    );

    res.json({ success: true, message: `Recompressing ${rows.length} covers`, total: rows.length });

    let done = 0, failed = 0, before = 0, after = 0;
    for (const row of rows) {
      try {
        const r = await recompressCoverByUrl(row.thumbnail);
        if (r) { before += r.before; after += r.after; done += 1; }
      } catch (e) {
        failed += 1;
        console.warn('[recompress] failed', row.thumbnail, e.message);
      }
    }
    console.log(`[recompress] done=${done} failed=${failed} ${(before/1048576).toFixed(1)}MB -> ${(after/1048576).toFixed(1)}MB`);
  } catch (e) {
    console.error('recompress-covers error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// TEMP backfill — strips pipeline scaffolding out of existing descriptions.
app.post('/api/admin/fix-descriptions', async (req, res) => {
  const { dryRun } = req.body || {};
  try {
    const { cleanGameDescription } = await import('./ai-engine/routes.js');
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.description, ag.prompt, ag.title
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
        WHERE g.description LIKE 'Multi-Engine AI Creation:%'`
    );

    let updated = 0;
    const samples = [];
    for (const row of rows) {
      const source = row.prompt || row.description.replace(/^Multi-Engine AI Creation:\s*/i, '');
      const cleaned = cleanGameDescription(source, row.title || row.name);
      if (cleaned === row.description) continue;
      if (samples.length < 5) samples.push({ name: row.name, before: row.description.slice(0, 80), after: cleaned });
      if (!dryRun) {
        await pool.query('UPDATE games SET description = $1 WHERE id = $2', [cleaned, row.id]);
      }
      updated += 1;
    }

    res.json({ success: true, dryRun: !!dryRun, matched: rows.length, updated, samples });
  } catch (e) {
    console.error('fix-descriptions error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/thumbnail-status', async (req, res) => {
  try {
    // Count total AI games
    const totalRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM ai_games 
      WHERE is_draft = FALSE
    `);
    
    // Count games with new AI-generated thumbnails (from R2)
    const newThumbsRes = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ai_games 
      WHERE is_draft = FALSE 
      AND thumbnail LIKE '%r2.dev/covers/%'
    `);
    
    // Count games with old Pollinations thumbnails
    const oldThumbsRes = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ai_games 
      WHERE is_draft = FALSE 
      AND thumbnail LIKE '%pollinations.ai%'
    `);
    
    // Count games with no thumbnail
    const noThumbsRes = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ai_games 
      WHERE is_draft = FALSE 
      AND (thumbnail IS NULL OR thumbnail = '')
    `);
    
    // Get some recent examples
    const examplesRes = await pool.query(`
      SELECT title, thumbnail, created_at
      FROM ai_games 
      WHERE is_draft = FALSE 
      AND thumbnail IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    const total = parseInt(totalRes.rows[0].total);
    const newThumbs = parseInt(newThumbsRes.rows[0].count);
    const oldThumbs = parseInt(oldThumbsRes.rows[0].count);
    const noThumbs = parseInt(noThumbsRes.rows[0].count);
    
    res.json({
      success: true,
      total,
      newAIThumbnails: newThumbs,
      oldThumbnails: oldThumbs,
      noThumbnail: noThumbs,
      progress: total > 0 ? Math.round((newThumbs / total) * 100) : 0,
      examples: examplesRes.rows.map(g => ({
        title: g.title,
        thumbnail: g.thumbnail,
        type: g.thumbnail.includes('r2.dev') ? 'new' : 'old'
      }))
    });
  } catch (e) {
    console.error('Thumbnail status error:', e);
    res.status(500).json({ error: 'Failed to get thumbnail status: ' + e.message });
  }
});

// ============================================
// AUTH ENDPOINTS
// ============================================

// ============================================
// AUTH & EMAIL VERIFICATION (login@gametok.co)
// ============================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

async function sendVerificationEmail({ to, code, username, purpose = 'login' }) {
  const isSignup = purpose === 'signup';
  const subject = isSignup 
    ? `Verify your GameTok account: ${code}`
    : `Your GameTok security code: ${code}`;
  
  const purposeText = isSignup
    ? 'Welcome to GameTok! Use the verification code below to verify your email and complete your registration.'
    : 'We noticed a login request for your GameTok account from a new device or browser session.';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; padding: 0; background-color: #030508; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; }
        .wrapper { max-width: 520px; margin: 40px auto; background-color: #080c14; border: 1px solid #141926; border-radius: 20px; overflow: hidden; padding: 40px 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
        .brand-text { font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; }
        .desc { font-size: 15px; color: #8b92a5; line-height: 1.6; margin-bottom: 28px; }
        .code-box { background: #05070c; border: 1px solid #1f2738; border-radius: 14px; padding: 22px; text-align: center; margin-bottom: 28px; }
        .code-val { font-size: 38px; font-weight: 900; letter-spacing: 0.22em; color: #38bdf8; font-family: monospace; }
        .expire-hint { font-size: 13px; color: #4d5569; margin-top: 8px; }
        .footer { border-top: 1px solid #141926; padding-top: 24px; font-size: 12.5px; color: #4d5569; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="brand-text" style="color: #38bdf8; margin-bottom: 24px;">🎮 GameTok</div>
        <div class="title">${isSignup ? 'Welcome to GameTok!' : 'Verification Code'}</div>
        <div class="desc">Hi ${username || 'there'},<br><br>${purposeText}</div>
        
        <div class="code-box">
          <div class="code-val">${code}</div>
          <div class="expire-hint">This code expires in 10 minutes.</div>
        </div>

        <div class="desc" style="font-size: 13px;">
          If you didn't attempt to sign in to GameTok, you can safely ignore this email or update your password.
        </div>

        <div class="footer">
          Sent securely by GameTok Security • <a href="https://gametok.co" style="color: #38bdf8; text-decoration: none;">gametok.co</a><br>
          For help, contact <a href="mailto:login@gametok.co" style="color: #8b92a5;">login@gametok.co</a>
        </div>
      </div>
    </body>
    </html>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'GameTok Security <login@gametok.co>',
      to: [to],
      subject,
      html
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[Resend] Failed to send email:', data);
    throw new Error(data.message || 'Failed to dispatch verification email');
  }
  return data;
}

// Generates a 6-digit numeric OTP and stores in DB
async function issueVerificationCode(email, userId = null, purpose = 'login') {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Delete previous pending codes for this email and purpose
  await pool.query(
    'DELETE FROM email_verification_codes WHERE LOWER(email) = LOWER($1) AND purpose = $2',
    [email, purpose]
  );

  await pool.query(
    `INSERT INTO email_verification_codes (email, code, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [email.toLowerCase(), code, purpose, userId, expiresAt]
  );

  return code;
}

// Usernames, like Roblox's: 3-20 letters, numbers and _, not at the start or end, at most one _
const USERNAME_RULE = /^(?=.{3,20}$)[A-Za-z0-9]+(_[A-Za-z0-9]+)?$/;

// Is a username free? (the sign-up screen checks as you type)
app.get('/api/auth/username-available', async (req, res) => {
  const name = String(req.query.username || '');
  if (!USERNAME_RULE.test(name)) return res.json({ available: false, valid: false });
  const r = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [name]);
  res.json({ available: r.rows.length === 0, valid: true });
});

// Sign up like Roblox: birthday, username, password; signed in at once. No email (it can be added later, for
// recovery). Apps before 2.2.0 still send an email and get the old emailed-code flow.
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, displayName, birthday } = req.body;

  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!email) {
    if (!USERNAME_RULE.test(username)) return res.status(400).json({ error: 'Usernames are 3-20 letters, numbers or one _', code: 'BAD_USERNAME' });
    if (password.length < 8) return res.status(400).json({ error: 'Passwords are at least 8 characters', code: 'BAD_PASSWORD' });
    if (password.toLowerCase().includes(username.toLowerCase())) return res.status(400).json({ error: 'Your password can’t contain your username', code: 'BAD_PASSWORD' });
    const born = /^\d{4}-\d{2}-\d{2}$/.test(String(birthday || '')) ? birthday : null;
    if (!born) return res.status(400).json({ error: 'Birthday required', code: 'BAD_BIRTHDAY' });
    try {
      const taken = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (taken.rows.length) return res.status(409).json({ error: 'That username is taken', code: 'USERNAME_TAKEN' });
      const token = generateToken();
      const r = await pool.query(
        `INSERT INTO users (username, password, display_name, token, birthday) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [username, hashPassword(password), displayName || username, token, born]);
      if (!r.rows[0]) return res.status(409).json({ error: 'That username is taken', code: 'USERNAME_TAKEN' });
      return res.json({ user: await formatUserWithFollowCounts(r.rows[0]), token });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not create your account' });
    }
  }
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ chars' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Valid email address required' });

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username, email]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username or email already in use' });

    const token = generateToken();
    const result = await pool.query(
      `INSERT INTO users (username, email, password, display_name, token, email_verified) 
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING *`,
      [username, email.toLowerCase(), hashPassword(password), displayName || username, token]
    );

    const user = result.rows[0];
    const code = await issueVerificationCode(email, user.id, 'signup');
    await sendVerificationEmail({ to: email, code, username: user.username, purpose: 'signup' });

    res.json({
      requireCode: true,
      purpose: 'signup',
      email: user.email,
      userId: user.id,
      message: 'Account created! We sent a 6-digit verification code to your email.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// Sign in with username (or email) and password. Apps from 2.2.0 send noCode: signed in at once, like Roblox;
// older apps keep the emailed code for email accounts on a new device.
app.post('/api/auth/login', async (req, res) => {
  const { username, password, deviceId, noCode } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [username]);
    const user = result.rows[0];

    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Wrong username or password', code: 'BAD_LOGIN' });
    }

    const userEmail = user.email;
    const isEmailVerified = user.email_verified === true;

    let isKnownDevice = false;
    if (deviceId && user.id) {
      const devRes = await pool.query(
        'SELECT 1 FROM user_devices WHERE user_id = $1 AND device_id = $2',
        [user.id, deviceId]
      );
      if (devRes.rows.length > 0) isKnownDevice = true;
    }

    if (!noCode && userEmail && (!isEmailVerified || !isKnownDevice)) {
      const code = await issueVerificationCode(userEmail, user.id, 'login');
      await sendVerificationEmail({ to: userEmail, code, username: user.username, purpose: 'login' });

      return res.json({
        requireCode: true,
        purpose: 'login',
        email: userEmail,
        userId: user.id,
        message: 'Security check: We sent a 6-digit login code to ' + userEmail
      });
    }

    let token = user.token;
    if (!token) {
      token = generateToken();
      await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, user.id]);
      user.token = token;
    }

    res.json({ user: await formatUserWithFollowCounts(user), token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── Account settings (the app's Settings screen) ──
async function userFromToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
  return r.rows[0] || null;
}

// what Settings shows: the email (if any) and whether it's confirmed
app.get('/api/auth/account', async (req, res) => {
  const user = await userFromToken(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  res.json({ username: user.username, email: user.email || null, emailVerified: !!user.email_verified, hasPassword: !!user.password });
});

// change password: the current one, then the new one (same rules as sign-up)
app.post('/api/auth/password', async (req, res) => {
  const user = await userFromToken(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  const { current, next } = req.body || {};
  if (user.password && user.password !== hashPassword(String(current || ''))) return res.status(400).json({ error: 'Your current password is wrong', code: 'BAD_PASSWORD' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'Passwords are at least 8 characters', code: 'BAD_PASSWORD' });
  if (String(next).toLowerCase().includes(user.username.toLowerCase())) return res.status(400).json({ error: 'Your password can’t contain your username', code: 'BAD_PASSWORD' });
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(next), user.id]);
  res.json({ ok: true });
});

// add (or change) the account's email, for getting back in if the password is forgotten. Saved as typed: no code
app.post('/api/auth/email', async (req, res) => {
  const user = await userFromToken(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That doesn’t look like an email', code: 'BAD_EMAIL' });
  try {
    const taken = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1 AND id != $2', [email, user.id]);
    if (taken.rows.length) return res.status(409).json({ error: 'That email is on another account', code: 'EMAIL_TAKEN' });
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, user.id]);
    res.json({ ok: true, email });
  } catch (e) {
    console.error('[Auth] add email:', e);
    res.status(500).json({ error: 'Could not save your email' });
  }
});

// Verify 6-digit code for signup or new-device login
app.post('/api/auth/verify-code', async (req, res) => {
  const { email, code, deviceId, deviceName } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and verification code are required' });

  try {
    const codeQuery = await pool.query(
      `SELECT * FROM email_verification_codes 
       WHERE LOWER(email) = LOWER($1) 
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (codeQuery.rows.length === 0) {
      return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
    }

    const row = codeQuery.rows[0];

    // Check expiry
    if (new Date() > new Date(row.expires_at)) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // Check code match
    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect verification code. Please check your email.' });
    }

    // Code is valid! Get or update user
    let userRes = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (userRes.rows.length === 0 && row.user_id) {
      userRes = await pool.query('SELECT * FROM users WHERE id = $1', [row.user_id]);
    }

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const user = userRes.rows[0];
    let token = user.token || generateToken();

    // Mark email as verified and refresh token
    await pool.query(
      'UPDATE users SET email_verified = TRUE, token = $1 WHERE id = $2',
      [token, user.id]
    );
    user.token = token;

    // Register this device as trusted
    if (deviceId) {
      await pool.query(
        `INSERT INTO user_devices (user_id, device_id, device_name, last_used_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, device_id) DO UPDATE SET last_used_at = NOW()`,
        [user.id, deviceId, deviceName || 'Web Browser']
      );
    }

    // Clean up code
    await pool.query('DELETE FROM email_verification_codes WHERE LOWER(email) = LOWER($1)', [email]);

    res.json({
      success: true,
      user: await formatUserWithFollowCounts(user),
      token
    });
  } catch (e) {
    console.error('Verify code error:', e);
    res.status(500).json({ error: 'Failed to verify code: ' + e.message });
  }
});

// Resend verification code
app.post('/api/auth/resend-code', async (req, res) => {
  const { email, purpose = 'login' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const user = userRes.rows[0] || null;

    const code = await issueVerificationCode(email, user ? user.id : null, purpose);
    await sendVerificationEmail({ to: email, code, username: user?.username || 'Gamer', purpose });

    res.json({ success: true, message: 'New verification code sent to ' + email });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resend code: ' + e.message });
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
    let emailVerified = false;

    if (provider === 'apple') {
      // Apple Sign-In — verify the identity token server-side and trust ONLY the
      // verified payload for the user id and email (never the client-supplied
      // `user`/`email` fields). The Apple `sub` equals the legacy `credential.user`,
      // so existing Apple accounts keep matching by oauth_id.
      let verified;
      try {
        verified = await verifyAppleIdToken(identityToken);
      } catch (err) {
        console.warn('[OAuth] Apple token verification failed:', err.message);
        return res.status(401).json({ error: 'Apple sign-in could not be verified' });
      }
      oauthId = verified.sub;
      userEmail = verified.email;
      emailVerified = verified.emailVerified;
      // Apple never includes the name in the token; it only arrives client-side on the
      // first authorization. Name is not a security-sensitive identifier, so use it for
      // display only.
      if (fullName) {
        userName = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ');
      }
    } else if (provider === 'google') {
      // Google Sign-In — verify the ID token server-side and trust ONLY the verified
      // payload (never the client-supplied profile fields). Both the native mobile
      // SDK and web GIS send this as `idToken`.
      let verified;
      try {
        verified = await verifyGoogleIdToken(idToken);
      } catch (err) {
        console.warn('[OAuth] Google token verification failed:', err.message);
        return res.status(401).json({ error: 'Google sign-in could not be verified' });
      }
      oauthId = verified.sub;
      userEmail = verified.email;
      userName = verified.name;
      emailVerified = verified.emailVerified;
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
      // Check if email already exists. Only auto-link to an existing account when the
      // provider has VERIFIED the email — otherwise a forged/unverified email could be
      // used to hijack someone else's account.
      if (userEmail && emailVerified) {
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

    res.json({ user: await formatUserWithFollowCounts(user), token, isNewUser });
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
    res.json({ user: await formatUserWithFollowCounts(result.rows[0]) });
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
    verified: Boolean(row.verified),
    followers: [],
    following: [],
    createdAt: row.created_at
  };
}

// Same as formatUser but attaches live follower/following counts from
// the followers table in a single roundtrip. Use this for endpoints that
// hydrate the current user's profile (login, /auth/me, etc.).
async function formatUserWithFollowCounts(row) {
  const base = formatUser(row);
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE following_id = $1)::int AS followers,
         COUNT(*) FILTER (WHERE follower_id  = $1)::int AS following
       FROM followers
       WHERE follower_id = $1 OR following_id = $1`,
      [row.id]
    );
    base.followersCount = rows[0]?.followers || 0;
    base.followingCount = rows[0]?.following || 0;
  } catch (e) {
    base.followersCount = 0;
    base.followingCount = 0;
  }
  return base;
}


// ============================================
// GAMES ENDPOINTS
// ============================================

app.post('/api/admin/reseed', async (req, res) => {
  try {
    if (process.env.ALLOW_LEGACY_RESEED !== 'true') {
      return res.status(410).json({
        error: 'Legacy reseed is disabled',
        message: 'Explore now uses published AI games, not built-in seed games.'
      });
    }

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
    const result = await pool.query('DELETE FROM games WHERE id = $1 RETURNING id, thumbnail', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    await deleteCoverAsset(result.rows[0].thumbnail);
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

// ============================================
// INDIE DEVELOPER PUBLISHING & CREATOR STUDIO
// ============================================

// ---- Developer authentication -------------------------------------------------------
// Every developer action is tied to a real GameTok account. A request authenticates with
//   Authorization: Bearer <session token>   (signed in on games.gametok.co / gametok.co), or
//   Authorization: Bearer gtk_live_... / gtk_test_...   (personal API key, for AI agents / CI), or
//   x-api-key: gtk_live_... / gtk_test_...
// Test keys (gtk_test_) only create/update drafts and verify test-mode player sessions.
// A creator handle in the query/body is NEVER identity — handles are public.
const API_KEY_PREFIX = 'gtk_live_';
const TEST_API_KEY_PREFIX = 'gtk_test_';
const isApiKey = (v) => v.startsWith(API_KEY_PREFIX) || v.startsWith(TEST_API_KEY_PREFIX);
const hashApiKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

async function authenticateDeveloper(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const apiKey = String(req.headers['x-api-key'] || '').trim() || (isApiKey(bearer) ? bearer : '');
  if (apiKey) {
    const keyRes = await pool.query(
      `UPDATE developer_api_keys SET last_used_at = NOW()
       WHERE key_hash = $1 AND revoked_at IS NULL
       RETURNING id, user_id, mode, results_secret`,
      [hashApiKey(apiKey)]
    );
    if (keyRes.rows.length === 0) return null;
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [keyRes.rows[0].user_id]);
    if (!userRes.rows[0]) return null;
    req.authMethod = 'api_key';
    req.apiKeyMode = keyRes.rows[0].mode === 'test' ? 'test' : 'live';
    req.apiKeyResultsSecret = keyRes.rows[0].results_secret || null;
    return userRes.rows[0];
  }
  if (bearer) {
    const userRes = await pool.query('SELECT * FROM users WHERE token = $1', [bearer]);
    if (!userRes.rows[0]) return null;
    req.authMethod = 'session';
    return userRes.rows[0];
  }
  return null;
}

const DEVELOPER_AUTH_ERROR = 'Sign in at https://games.gametok.co or send a GameTok API key (Authorization: Bearer gtk_live_... or gtk_test_...). Create one at https://games.gametok.co/dashboard → Settings → API Keys.';

async function requireDeveloper(req, res, next) {
  try {
    const developer = await authenticateDeveloper(req);
    if (!developer) return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    req.developer = developer;
    next();
  } catch (err) {
    console.error('[Developer Auth] Error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// games.developer holds the owner's user id (older rows may hold the username).
const ownsGame = (user, game) => !!user && !!game && (game.developer === user.id.toString() || game.developer === user.username);

async function requireOwnedGame(req, res, next) {
  try {
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    const game = gameRes.rows[0];
    // Same 404 for "missing" and "not yours", so game ids can't be probed for ownership.
    if (!game || !ownsGame(req.developer, game)) return res.status(404).json({ error: 'Game not found' });
    req.game = game;
    next();
  } catch (err) {
    console.error('[Developer Auth] Ownership check error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// GameTok shows external games in an iframe on gametok.co (feed + /game/:id). A host that
// forbids framing would go live as a blank screen, so publish checks the same headers the
// browser enforces. CSP frame-ancestors wins over X-Frame-Options when both are present.
const EMBED_PARENT_ORIGIN = 'https://gametok.co';
// Where uploaded HTML games are served from. gametok.co/api/* is the website, not the API.
const PUBLIC_API_ORIGIN = process.env.PUBLIC_API_ORIGIN || 'https://gametok-backend-267787411422.us-central1.run.app';

function frameAncestorsAllows(sources, parentOrigin, gameOrigin) {
  const parent = new URL(parentOrigin);
  return sources.some((raw) => {
    const src = raw.toLowerCase();
    if (src === '*') return true;
    if (src === "'none'") return false;
    if (src === "'self'") return gameOrigin === parent.origin;
    if (/^[a-z][a-z0-9+.-]*:$/.test(src)) return src === parent.protocol; // scheme-only, e.g. https:
    const m = src.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(?:\/.*)?$/);
    if (!m) return false;
    const [, scheme, wildcard, host, port] = m;
    if (scheme && scheme !== parent.protocol.slice(0, -1)) return false;
    if (port && port !== '*' && port !== (parent.port || (parent.protocol === 'https:' ? '443' : '80'))) return false;
    // '*.example.com' matches subdomains only, not example.com itself.
    return wildcard ? parent.hostname.endsWith('.' + host) : parent.hostname === host;
  });
}

function checkEmbeddable(headers, gameUrl) {
  const gameOrigin = new URL(gameUrl).origin;
  const csp = headers.get('content-security-policy') || '';
  const directive = csp.split(/[;,]/).map(d => d.trim()).find(d => /^frame-ancestors(\s|$)/i.test(d));
  if (directive) {
    const sources = directive.split(/\s+/).slice(1);
    if (frameAncestorsAllows(sources, EMBED_PARENT_ORIGIN, gameOrigin)) return { ok: true };
    return {
      ok: false,
      reason: `Your game's Content-Security-Policy (frame-ancestors ${sources.join(' ') || "'none'"}) doesn't allow ${EMBED_PARENT_ORIGIN} to embed it. Add ${EMBED_PARENT_ORIGIN} to frame-ancestors.`
    };
  }
  const xfo = (headers.get('x-frame-options') || '').trim().toUpperCase();
  // Browsers ignore ALLOW-FROM and unknown values, so only DENY / SAMEORIGIN block.
  if ((xfo === 'DENY' || xfo === 'SAMEORIGIN') && !(xfo === 'SAMEORIGIN' && gameOrigin === EMBED_PARENT_ORIGIN)) {
    return {
      ok: false,
      reason: `Your game is served with X-Frame-Options: ${xfo}, which stops ${EMBED_PARENT_ORIGIN} from embedding it. Remove that header and send Content-Security-Policy: frame-ancestors 'self' ${EMBED_PARENT_ORIGIN} instead.`
    };
  }
  return { ok: true };
}

// ---- Developer agreement ------------------------------------------------------------
// Bump the version when the agreement text (games.gametok.co/agreement.html) changes;
// developers then have to accept again before publishing.
const DEVELOPER_AGREEMENT_VERSION = '2026-10-13';
const AGREEMENT_REQUIRED_ERROR = 'Accept the GameTok Developer Agreement at https://games.gametok.co/dashboard before publishing.';
const agreementIsCurrent = (user) => user?.developer_agreement_version === DEVELOPER_AGREEMENT_VERSION;

// ---- Automatic review -----------------------------------------------------------------
// Every publish (and the dashboard's re-check) runs these. Blocking checks must pass for a
// game to go live; the rest are recommendations shown as a checklist in the dashboard.
const GAMETOK_BOT_UA = 'Mozilla/5.0 (compatible; GameTokBot/1.0; +https://gametok.co)';

function extractGameMeta(htmlText, baseUrl) {
  const meta = {};
  const bridgeTag = htmlText.match(/<script[^>]*bridge\.js[^>]*>/i);
  const bridgeTitle = bridgeTag && bridgeTag[0].match(/data-game-title=["']([^"']+)["']/i);
  const titleTag = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
  meta.title = (bridgeTitle && bridgeTitle[1].trim()) || (titleTag && titleTag[1].trim()) || '';
  const desc = htmlText.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
               htmlText.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  meta.description = desc ? desc[1].trim() : '';
  const ogImg = htmlText.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImg && baseUrl) {
    try { meta.thumbnail = new URL(ogImg[1].trim(), baseUrl).href; } catch (e) {}
  }
  return meta;
}

// What the game itself declares about orientation. Only explicit statements count:
// a screen-orientation / x5-orientation meta tag, screen.orientation.lock(...) in its
// code, or the web app manifest's "orientation". Returns 'portrait' | 'landscape' | null.
const orientationFrom = (value) => {
  const v = String(value || '').toLowerCase();
  if (v.startsWith('landscape')) return 'landscape';
  if (v.startsWith('portrait')) return 'portrait';
  return null;
};

async function declaredOrientation(htmlText, baseUrl) {
  const meta = htmlText.match(/<meta[^>]*name=["'](?:screen-orientation|x5-orientation)["'][^>]*content=["']([^"']+)["']/i) ||
               htmlText.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["'](?:screen-orientation|x5-orientation)["']/i);
  if (meta && orientationFrom(meta[1])) return orientationFrom(meta[1]);
  const lock = htmlText.match(/(?:screen\.orientation\.lock|lockOrientation)\(\s*["'`]([a-z-]+)["'`]/i);
  if (lock && orientationFrom(lock[1])) return orientationFrom(lock[1]);
  const manifestLink = htmlText.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i) ||
                       htmlText.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/i);
  if (manifestLink && baseUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(new URL(manifestLink[1], baseUrl).href, { signal: controller.signal, headers: { 'User-Agent': GAMETOK_BOT_UA } });
      clearTimeout(timer);
      if (res.ok) {
        const manifest = await res.json();
        if (orientationFrom(manifest.orientation)) return orientationFrom(manifest.orientation);
      }
    } catch (e) {}
  }
  return null;
}

async function runGameChecks({ url, html }) {
  const checks = [];
  const warnings = [];
  const add = (c) => { checks.push(c); return c; };
  let htmlText = '';
  let finalUrl = null;

  if (url) {
    finalUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    // gametok.co is HTTPS; browsers block an http:// game inside it (mixed content).
    if (!add({ id: 'https', label: 'Served over HTTPS', blocking: true, code: 'GAME_URL_NOT_HTTPS',
               ok: /^https:\/\//i.test(finalUrl),
               detail: 'Your game URL must use https:// — browsers block http:// games inside GameTok.' }).ok) {
      return { ok: false, checks, warnings, url: finalUrl, meta: {} };
    }

    let resp = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      resp = await fetch(finalUrl, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': GAMETOK_BOT_UA } });
      clearTimeout(timer);
    } catch (err) {
      // Unreachable from our servers (timeout, DNS, TLS). Don't block — the host may be slow or
      // filter bots — but nothing below could be verified.
      const why = err.name === 'AbortError' ? 'timed out' : err.message;
      add({ id: 'reachable', label: 'Game URL loads', blocking: true, ok: null, code: 'GAME_URL_UNREACHABLE',
            detail: `Could not reach your game to verify it (${why}).` });
      warnings.push(`Could not reach ${finalUrl} to verify it (${why}). Check it plays at the GameTok link.`);
      return { ok: true, verified: false, checks, warnings, url: finalUrl, meta: {} };
    }

    add({ id: 'reachable', label: 'Game URL loads', blocking: true, code: 'GAME_URL_UNREACHABLE', ok: resp.ok,
          detail: resp.ok ? `HTTP ${resp.status}` : `Your game URL returned HTTP ${resp.status}. Make sure it's live and public, then publish again.` });
    if (!resp.ok) return { ok: false, checks, warnings, url: finalUrl, meta: {} };

    finalUrl = resp.url || finalUrl;
    if (!add({ id: 'https_redirect', label: 'Stays on HTTPS after redirects', blocking: true, code: 'GAME_URL_NOT_HTTPS',
               ok: /^https:\/\//i.test(finalUrl),
               detail: `Your game URL redirects to an http:// page (${finalUrl}). Serve it over https://.` }).ok) {
      return { ok: false, checks, warnings, url: finalUrl, meta: {} };
    }

    const embed = checkEmbeddable(resp.headers, finalUrl);
    const itchHint = /(^|\.)itch\.io$/i.test(new URL(finalUrl).hostname)
      ? ' This is an itch.io store page — publish the game file URL instead (open the game on itch.io, right-click the game area → "Open frame in new tab", and use that html-classic.itch.zone URL).'
      : '';
    if (!add({ id: 'embeddable', label: 'Can be shown inside GameTok', blocking: true, code: 'GAME_NOT_EMBEDDABLE',
               ok: embed.ok, detail: embed.ok ? 'No X-Frame-Options / frame-ancestors restriction for gametok.co' : embed.reason + itchHint }).ok) {
      return { ok: false, checks, warnings, url: finalUrl, meta: {} };
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!add({ id: 'html', label: 'Is a web page', blocking: true, code: 'GAME_URL_NOT_HTML',
               ok: contentType.includes('text/html') || contentType.includes('application/xhtml'),
               detail: `Your game URL returns "${contentType || 'unknown content'}", not a web page. Publish the URL of the page that runs the game (usually its index.html).` }).ok) {
      return { ok: false, checks, warnings, url: finalUrl, meta: {} };
    }
    try { htmlText = (await resp.text()).slice(0, 2_000_000); } catch (e) {}
  } else {
    htmlText = String(html || '');
    if (!add({ id: 'html', label: 'Is a web page', blocking: true, code: 'GAME_HTML_INVALID',
               ok: /<(html|body|script|canvas)\b/i.test(htmlText),
               detail: 'The uploaded file does not look like an HTML game (no <html>, <body>, <script> or <canvas>).' }).ok) {
      return { ok: false, checks, warnings, url: null, meta: {} };
    }
  }

  // Recommendations (never block publishing).
  add({ id: 'viewport', label: 'Mobile viewport meta tag', blocking: false, ok: /<meta[^>]*name=["']viewport["']/i.test(htmlText),
        detail: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the game fits phones.' });

  const meta = extractGameMeta(htmlText, finalUrl);
  meta.orientation = await declaredOrientation(htmlText, finalUrl);
  return { ok: true, verified: true, checks, warnings, url: finalUrl, meta };
}

const reviewStatus = (review) => (review.verified ? 'passed' : 'unverified');

// Kick off a thumbnail screenshot via POST /api/internal/thumbnail/:id on this same service.
// Fire-and-forget: publishing never waits for (or fails because of) the screenshot.
async function requestThumbnailCapture(gameId) {
  try {
    const key = crypto.createHash('sha256').update('thumbnail:' + await getSessionSigningSecret()).digest('hex');
    fetch(`${PUBLIC_API_ORIGIN}/api/internal/thumbnail/${encodeURIComponent(gameId)}`, {
      method: 'POST', headers: { 'x-internal-key': key }
    }).catch(err => console.warn(`[Thumbnail] Could not request capture for ${gameId}:`, err.message));
  } catch (err) {
    console.warn(`[Thumbnail] Could not request capture for ${gameId}:`, err.message);
  }
}

const handleGamePublish = async (req, res) => {
  try {
    let {
      url,
      embedUrl,
      html,
      title,
      name,
      description,
      category,
      orientation,
      icon,
      color,
      thumbnail
    } = req.body;

    let targetUrl = (url || embedUrl || '').trim();
    const publishWarnings = [];
    let gameTitle = (title || name || '').trim();
    let gameDesc = (description || '').trim();
    // The game always belongs to the authenticated account; creator fields in the body are ignored.
    const creatorRecord = await authenticateDeveloper(req);
    if (!creatorRecord) return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    // Games are credited to the creator's @handle; Google sign-ups only get one in onboarding.
    if (!creatorRecord.username) {
      return res.status(403).json({ error: 'Choose your GameTok username at https://games.gametok.co/dashboard before publishing.' });
    }

    if (!targetUrl && !html) {
      return res.status(400).json({ error: 'Either a game URL or HTML content must be provided.' });
    }
    if (!agreementIsCurrent(creatorRecord)) {
      return res.status(403).json({ error: AGREEMENT_REQUIRED_ERROR, code: 'AGREEMENT_REQUIRED' });
    }

    // Automatic review: publishing goes live only if every blocking check passes.
    const review = await runGameChecks({ url: targetUrl, html });
    if (!review.ok) {
      const failed = review.checks.find(c => c.blocking && c.ok === false);
      return res.status(400).json({ error: failed.detail, code: failed.code, checks: review.checks });
    }
    if (targetUrl) targetUrl = review.url;
    publishWarnings.push(...review.warnings);
    if (!gameTitle && review.meta.title) gameTitle = review.meta.title;
    if (!gameDesc && review.meta.description) gameDesc = review.meta.description;
    if (!thumbnail && review.meta.thumbnail) thumbnail = review.meta.thumbnail;

    if (!gameTitle) {
      gameTitle = 'Indie Web Game';
    }

    // Slugify title for game ID
    let slug = gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (!slug) slug = `game-${Date.now().toString(36)}`;

    // Test mode: a test key (or "draft": true) creates/updates a private draft that isn't in the
    // feed and can be played only in the dashboard's test player. A test key never touches a
    // live game; a live publish of your own draft takes it live.
    const asDraft = req.apiKeyMode === 'test' || req.body.draft === true;
    const gameStatus = asDraft ? 'draft' : 'published';

    // Check collision
    let gameId = slug;
    let existingGame = await pool.query('SELECT id, developer, status FROM games WHERE id = $1', [gameId]);
    if (existingGame.rows.length > 0 && ownsGame(creatorRecord, existingGame.rows[0]) && asDraft && existingGame.rows[0].status !== 'draft') {
      // Your live game has this name: keep the draft separate from it.
      gameId = `${slug}-draft`;
      existingGame = await pool.query('SELECT id, developer, status FROM games WHERE id = $1', [gameId]);
    }
    if (existingGame.rows.length > 0) {
      // Re-publishing your own game updates it; anyone else's slug gets a suffix.
      if (!ownsGame(creatorRecord, existingGame.rows[0])) {
        gameId = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181', '#AA96DA', '#6C5CE7', '#FD79A8'];
    const chosenColor = color || defaultColors[Math.floor(Math.random() * defaultColors.length)];
    const chosenIcon = icon || '🎮';
    const chosenCategory = (category || 'arcade').toLowerCase();
    // Orientation: the developer's choice wins; otherwise what the game declares; otherwise
    // portrait for now — the thumbnail run then measures the game and may switch it to landscape.
    const developerOrientation = orientationFrom(orientation);
    const chosenOrientation = developerOrientation || review.meta.orientation || 'portrait';
    const orientationSource = developerOrientation ? 'developer' : (review.meta.orientation ? 'detected' : 'default');

    // Where phones see it (GameTok's call, not the developer's): sized now from what was uploaded;
    // controls, load time (and a link's size) are measured by the headless run after publish.
    let uploadBytes = html ? Buffer.byteLength(html, 'utf8') : null;
    if (!uploadBytes && targetUrl) {
      // A one-file game downloads all of it. A folder's total isn't what a game loads (it fetches
      // what it needs), so those wait for the phone test to measure the real download.
      const up = await pool.query('SELECT bytes, files FROM game_uploads WHERE url = ANY($1)', [[targetUrl, (url || embedUrl || '').trim()]]);
      if (up.rows[0] && up.rows[0].files === 1) uploadBytes = Number(up.rows[0].bytes);
    }
    const fit = decidePlatform({ bytes: uploadBytes });
    publishWarnings.push(...fit.reasons, ...fit.warnings);
    const mobileCheck = { bytes: uploadBytes, bytesFrom: uploadBytes ? 'upload' : null, controls: null, reasons: fit.reasons, warnings: fit.warnings, checkedAt: new Date().toISOString() };

    const insertResult = await pool.query(
      `INSERT INTO games (
        id, name, description, icon, color, category,
        embed_url, thumbnail, developer, orientation, runtime, script_payload,
        verification_status, verification_notes, status, orientation_source,
        platform, platform_source, mobile_check, file_size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'web', $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        category = EXCLUDED.category,
        embed_url = EXCLUDED.embed_url,
        thumbnail = COALESCE(EXCLUDED.thumbnail, games.thumbnail),
        developer = EXCLUDED.developer,
        -- A re-publish without a choice keeps an earlier deliberate or detected orientation.
        orientation = CASE WHEN EXCLUDED.orientation_source = 'default' AND games.orientation_source IN ('developer', 'detected')
                           THEN games.orientation ELSE EXCLUDED.orientation END,
        orientation_source = CASE WHEN EXCLUDED.orientation_source = 'default' AND games.orientation_source IN ('developer', 'detected')
                                  THEN games.orientation_source ELSE EXCLUDED.orientation_source END,
        -- Nothing known yet (a link): keep the last measured result until it's re-measured.
        platform = CASE WHEN EXCLUDED.platform_source = 'default' AND games.platform_source IS NOT NULL
                        THEN games.platform ELSE EXCLUDED.platform END,
        platform_source = CASE WHEN EXCLUDED.platform_source = 'default' AND games.platform_source IS NOT NULL
                               THEN games.platform_source ELSE EXCLUDED.platform_source END,
        mobile_check = CASE WHEN EXCLUDED.platform_source = 'default' AND games.mobile_check IS NOT NULL
                            THEN games.mobile_check
                            ELSE EXCLUDED.mobile_check END,
        file_size = COALESCE(EXCLUDED.file_size, games.file_size),
        script_payload = EXCLUDED.script_payload,
        verification_status = EXCLUDED.verification_status,
        verification_notes = EXCLUDED.verification_notes,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *`,
      [
        gameId,
        gameTitle,
        gameDesc,
        chosenIcon,
        chosenColor,
        chosenCategory,
        targetUrl || (html ? `${PUBLIC_API_ORIGIN}/api/games/${gameId}/play-html` : null),
        thumbnail || null,
        creatorRecord.id.toString(),
        chosenOrientation,
        html || null,
        reviewStatus(review),
        JSON.stringify(review.checks),
        gameStatus,
        orientationSource,
        fit.platform,
        fit.source,
        JSON.stringify(mobileCheck),
        uploadBytes
      ]
    );

    // Sync categories join table
    try {
      await setGameCategories(pool, gameId, [chosenCategory], 'creator');
    } catch (e) {
      console.warn('[Publish] Category sync error:', e);
    }

    const savedGame = insertResult.rows[0];

    // Thumbnail screenshot runs as its own request so Cloud Run gives it CPU (work left running
    // after this response is sent gets throttled and never finishes).
    requestThumbnailCapture(savedGame.id);

    return res.json({
      success: true,
      gameId: savedGame.id,
      title: savedGame.name,
      description: savedGame.description,
      url: `https://gametok.co/game/${savedGame.id}`,
      shortUrl: `https://gametok.co/game/${savedGame.id}`,
      playerUrl: `https://gametok.co/game/${savedGame.id}`,
      embedUrl: savedGame.embed_url,
      orientation: savedGame.orientation,
      orientationSource: savedGame.orientation_source,
      platform: savedGame.platform || 'all',
      platformSource: savedGame.platform_source,
      creator: {
        id: creatorRecord.id,
        username: creatorRecord.username,
        displayName: creatorRecord.display_name,
        avatar: creatorRecord.avatar
      },
      dashboardUrl: 'https://games.gametok.co/dashboard',
      status: gameStatus,
      ...(gameStatus === 'draft' ? { testUrl: `https://games.gametok.co/sandbox/?game=${encodeURIComponent(savedGame.id)}` } : {}),
      checks: review.checks,
      ...(publishWarnings.length ? { warnings: publishWarnings } : {})
    });
  } catch (error) {
    console.error('[Publish] Error publishing game:', error);
    return res.status(500).json({ error: 'Failed to publish game: ' + (error.message || 'Server error') });
  }
};

app.post('/api/publish', handleGamePublish);
app.post('/api/games/publish-web', handleGamePublish);

// Get creator profile & dashboard stats
app.get('/api/publish/creator/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '').trim().replace(/^@/, '').toLowerCase();
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [handle]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }
    const creator = userRes.rows[0];
    const gamesRes = await pool.query(
      `SELECT g.*, 
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.game_id = g.id), 0) AS likes_count,
        COALESCE(g.plays, 0) AS plays_count
       FROM games g 
       WHERE (g.developer = $1 OR g.developer = $2) AND (g.status IS NULL OR g.status = 'published')
       ORDER BY g.created_at DESC`,
      [creator.id.toString(), creator.username]
    );

    let totalPlays = 0;
    let totalLikes = 0;
    gamesRes.rows.forEach(r => {
      totalPlays += parseInt(r.plays_count || 0, 10);
      totalLikes += parseInt(r.likes_count || 0, 10);
    });


    res.json({
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.display_name,
        avatar: creator.avatar,
        bio: creator.bio,
        createdAt: creator.created_at
      },
      stats: {
        totalGames: gamesRes.rows.length,
        totalPlays,
        totalLikes
      },
      games: gamesRes.rows.map(formatGame)
    });
  } catch (err) {
    console.error('[Creator Profile] Error:', err);
    res.status(500).json({ error: 'Failed to load creator profile' });
  }
});

// Update creator profile (display name, avatar, bio, payout address)
app.patch('/api/publish/creator/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '').trim().replace(/^@/, '').toLowerCase();
    // Only the signed-in owner of this handle may edit it.
    const me = await authenticateDeveloper(req);
    if (!me) return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    if (String(me.username || '').toLowerCase() !== handle) return res.status(403).json({ error: 'You can only edit your own profile' });
    const { displayName, bio, payoutAddress, avatar } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (displayName) { updates.push(`display_name = $${idx++}`); values.push(displayName); }
    if (avatar) { updates.push(`avatar = $${idx++}`); values.push(avatar); }
    if (bio !== undefined || payoutAddress !== undefined) {
      let finalBio = bio || '';
      if (payoutAddress) finalBio = `${finalBio} [Payout: ${payoutAddress}]`.trim();
      updates.push(`bio = $${idx++}`);
      values.push(finalBio);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    values.push(handle);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE LOWER(username) = LOWER($${idx}) RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Creator not found' });
    res.json({ success: true, creator: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update creator profile' });
  }
});

// ============================================
// DEVELOPER PLATFORM APIs (games.gametok.co)
// ============================================

// Identity comes only from a session token or API key (see authenticateDeveloper).
const resolveDeveloper = authenticateDeveloper;

// Every /api/developer route needs an account, except the in-game session telemetry beacon.
app.use('/api/developer', (req, res, next) => (req.path === '/analytics/session' ? next() : requireDeveloper(req, res, next)));
// Per-game developer routes additionally require owning the game.
app.use('/api/developer/games/:id', requireOwnedGame);

// Host a zipped web game build; the returned URL is then published like any game link.
app.post('/api/developer/uploads',
  express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: MAX_ZIP_BYTES }),
  handleGameUpload);
// Bigger zips: the browser PUTs them straight to R2 with a signed URL, then asks us to unpack.
app.post('/api/developer/uploads/start', handleGameUploadStart);
app.post('/api/developer/uploads/:uploadId/finish', handleGameUploadFinish);
// Any size: the browser PUTs each file straight to R2, then we check it and fix up its pages.
app.post('/api/developer/uploads/files/start', handleGameFilesStart);
app.post('/api/developer/uploads/files/:uploadId/finish', handleGameFilesFinish);

// The game's server checks a player session here before trusting it (with the developer's
// key, never from the browser). Test keys only accept test sessions and live keys only live
// ones; a signed-in dashboard session accepts both.
app.post('/api/developer/sessions/verify', async (req, res) => {
  try {
    const session = String(req.body?.session || '');
    let claims;
    try {
      claims = jwt.verify(session, await getSessionSigningSecret(), { algorithms: ['HS256'], issuer: 'gametok' });
    } catch (err) {
      const code = err.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'SESSION_INVALID';
      return res.status(401).json({ valid: false, error: code === 'SESSION_EXPIRED' ? 'Session expired — ask the game for a fresh one with GameTok.session()' : 'Invalid session', code });
    }
    const gameRes = await pool.query('SELECT id, developer, integration FROM games WHERE id = $1', [claims.gid]);
    const game = gameRes.rows[0];
    if (!game || !ownsGame(req.developer, game)) {
      return res.status(403).json({ valid: false, error: 'This session is for a game you do not own', code: 'WRONG_GAME' });
    }
    if (req.authMethod === 'api_key' && req.apiKeyMode !== claims.mode) {
      return res.status(403).json({ valid: false, error: `A ${req.apiKeyMode} key can only verify ${req.apiKeyMode} sessions (this one is ${claims.mode})`, code: 'WRONG_MODE' });
    }
    if (claims.mode === 'test') await recordIntegration(game.id, 'session_verified');
    res.json({
      valid: true,
      gameId: claims.gid,
      mode: claims.mode,
      player: { id: claims.sub, name: claims.name, guest: Boolean(claims.guest), avatarRecord: claims.av || null, owned: claims.own || [] },
      expiresAt: new Date(claims.exp * 1000).toISOString()
    });
  } catch (err) {
    console.error('[Session Verify] Error:', err);
    res.status(500).json({ error: 'Could not verify session' });
  }
});

// Developer server side of matches. Reading a match needs your key; reporting a result also
// needs an HMAC signature with the results secret issued with that key:
//   X-GameTok-Timestamp: <unix seconds>   (within 5 minutes)
//   X-GameTok-Signature: v1=<hex HMAC-SHA256(resultsSecret, "POST\n<path>\n<timestamp>\n<match nonce>\n<hex sha256(raw body)>")>
async function loadDeveloperMatch(req, res) {
  const match = await loadMatch(req.params.id);
  if (!match) { res.status(404).json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }); return null; }
  const game = await pool.query('SELECT id, developer FROM games WHERE id = $1', [match.game_id]);
  if (!ownsGame(req.developer, game.rows[0])) { res.status(404).json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }); return null; }
  if (req.authMethod === 'api_key' && req.apiKeyMode !== match.mode) {
    res.status(403).json({ error: `A ${req.apiKeyMode} key can only use ${req.apiKeyMode} game_matches (this one is ${match.mode})`, code: 'WRONG_MODE' });
    return null;
  }
  await expireMatches(match.game_id);
  return loadMatch(match.id);
}

app.get('/api/developer/matches/:id', async (req, res) => {
  try {
    const match = await loadDeveloperMatch(req, res);
    if (match) res.json({ match: matchView(match, null, { forDeveloper: true }) });
  } catch (err) {
    console.error('[Matches] Developer get error:', err);
    res.status(500).json({ error: 'Could not load match' });
  }
});

app.post('/api/developer/matches/:id/result', async (req, res) => {
  try {
    if (req.authMethod !== 'api_key') return res.status(403).json({ error: 'Report results from your server with an API key', code: 'API_KEY_REQUIRED' });
    if (!req.apiKeyResultsSecret) return res.status(403).json({ error: 'This key has no results secret. Create a new API key in the dashboard.', code: 'NO_RESULTS_SECRET' });
    const match = await loadDeveloperMatch(req, res);
    if (!match) return;

    const timestamp = String(req.headers['x-gametok-timestamp'] || '');
    const signature = String(req.headers['x-gametok-signature'] || '');
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return res.status(401).json({ error: 'X-GameTok-Timestamp missing or more than 5 minutes off', code: 'STALE_TIMESTAMP' });
    }
    const bodyHash = crypto.createHash('sha256').update(req.rawBody || Buffer.alloc(0)).digest('hex');
    const path = req.originalUrl.split('?')[0];
    const expected = 'v1=' + crypto.createHmac('sha256', req.apiKeyResultsSecret)
      .update(['POST', path, timestamp, match.nonce, bodyHash].join('\n')).digest('hex');
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Bad signature', code: 'BAD_SIGNATURE' });
    }

    const winner = String(req.body?.winner || '');
    const result = req.body?.result && typeof req.body.result === 'object' ? req.body.result : null;
    if (winner !== 'draw' && !match.players.some(p => p.player_id === winner)) {
      return res.status(400).json({ error: 'winner must be a player in the match or "draw"', code: 'BAD_WINNER' });
    }
    if (match.status === 'done') {
      // Settled once; replaying the same result gives the same answer.
      if (match.winner === winner) return res.json({ match: matchView(match, null, { forDeveloper: true }) });
      return res.status(409).json({ error: 'This match already has a result', code: 'ALREADY_SETTLED', match: matchView(match, null, { forDeveloper: true }) });
    }
    if (match.status !== 'playing') {
      return res.status(409).json({ error: `Only a match that is playing can be settled (this one is ${match.status})`, code: 'NOT_PLAYING' });
    }
    await pool.query(
      `UPDATE game_matches SET status = 'done', winner = $2, result = $3, settled_at = NOW() WHERE id = $1 AND status = 'playing'`,
      [match.id, winner, result ? JSON.stringify(result) : null]);
    res.json({ match: matchView(await loadMatch(match.id), null, { forDeveloper: true }) });
  } catch (err) {
    console.error('[Matches] Result error:', err);
    res.status(500).json({ error: 'Could not record result' });
  }
});

// Integration checklist: the test player reports what the game did (first time only per item).
const INTEGRATION_EVENTS = ['bridge_loaded', 'player_requested', 'session_verified', 'score_submitted'];
async function recordIntegration(gameId, event) {
  if (!INTEGRATION_EVENTS.includes(event)) return;
  await pool.query(
    `UPDATE games SET integration = jsonb_set(COALESCE(integration, '{}'::jsonb), $2, to_jsonb(NOW()::text), true)
     WHERE id = $1 AND NOT (COALESCE(integration, '{}'::jsonb) ? $3)`,
    [gameId, `{${event}}`, event]
  );
}

app.post('/api/developer/games/:id/integration', async (req, res) => {
  try {
    const event = String(req.body?.event || '');
    if (!INTEGRATION_EVENTS.includes(event) || event === 'session_verified') {
      return res.status(400).json({ error: 'Unknown event' });
    }
    await recordIntegration(req.game.id, event);
    const row = await pool.query('SELECT integration FROM games WHERE id = $1', [req.game.id]);
    res.json({ success: true, integration: row.rows[0].integration });
  } catch (err) {
    console.error('[Integration] Error:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
});

// Developer account status for the dashboard's onboarding (username + agreement).
app.get('/api/developer/me', (req, res) => {
  const d = req.developer;
  res.json({
    success: true,
    developer: { id: d.id, username: d.username, displayName: d.display_name, avatar: d.avatar },
    agreement: {
      currentVersion: DEVELOPER_AGREEMENT_VERSION,
      acceptedVersion: d.developer_agreement_version || null,
      acceptedAt: d.developer_agreement_accepted_at || null,
      accepted: agreementIsCurrent(d),
      url: 'https://games.gametok.co/agreement.html'
    }
  });
});

// Accepting the agreement needs a real sign-in (an agent's API key can't accept on the developer's behalf).
app.post('/api/developer/agreement', async (req, res) => {
  try {
    if (req.authMethod !== 'session') return res.status(403).json({ error: 'Sign in on games.gametok.co to accept the Developer Agreement' });
    if (req.body?.version !== DEVELOPER_AGREEMENT_VERSION) {
      return res.status(409).json({ error: 'The Developer Agreement has changed. Reload and review the current version.', currentVersion: DEVELOPER_AGREEMENT_VERSION });
    }
    await pool.query('UPDATE users SET developer_agreement_version = $1, developer_agreement_accepted_at = NOW() WHERE id = $2',
      [DEVELOPER_AGREEMENT_VERSION, req.developer.id]);
    res.json({ success: true, version: DEVELOPER_AGREEMENT_VERSION });
  } catch (err) {
    console.error('[Developer Platform] Agreement error:', err);
    res.status(500).json({ error: 'Could not record acceptance' });
  }
});

// Personal API keys for agents/CI. Managing keys needs a real sign-in, not another API key.
app.get('/api/developer/api-keys', async (req, res) => {
  try {
    const keys = await pool.query(
      `SELECT id, name, key_prefix, mode, created_at, last_used_at FROM developer_api_keys
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [req.developer.id]
    );
    res.json({
      success: true,
      keys: keys.rows.map(k => ({ id: k.id, name: k.name, prefix: k.key_prefix, mode: k.mode, createdAt: k.created_at, lastUsedAt: k.last_used_at }))
    });
  } catch (err) {
    console.error('[API Keys] List error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

app.post('/api/developer/api-keys', async (req, res) => {
  try {
    if (req.authMethod !== 'session') return res.status(403).json({ error: 'Sign in on games.gametok.co to create API keys' });
    const active = await pool.query('SELECT COUNT(*)::int AS n FROM developer_api_keys WHERE user_id = $1 AND revoked_at IS NULL', [req.developer.id]);
    if (active.rows[0].n >= 10) return res.status(400).json({ error: 'You already have 10 active keys. Revoke one first.' });

    const name = String(req.body?.name || 'Default').trim().slice(0, 100) || 'Default';
    const mode = req.body?.mode === 'test' ? 'test' : 'live';
    const key = (mode === 'test' ? TEST_API_KEY_PREFIX : API_KEY_PREFIX) + crypto.randomBytes(24).toString('hex');
    const prefix = key.slice(0, API_KEY_PREFIX.length + 6);
    // Signs match results (HMAC). Stored as-is because verifying an HMAC needs the secret.
    const resultsSecret = 'gtk_rs_' + crypto.randomBytes(24).toString('hex');
    const inserted = await pool.query(
      `INSERT INTO developer_api_keys (user_id, name, key_prefix, key_hash, mode, results_secret)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.developer.id, name, prefix, hashApiKey(key), mode, resultsSecret]
    );
    // The plaintext key and results secret are returned exactly once.
    res.json({ success: true, key, resultsSecret, id: inserted.rows[0].id, name, prefix, mode, createdAt: inserted.rows[0].created_at });
  } catch (err) {
    console.error('[API Keys] Create error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

app.delete('/api/developer/api-keys/:keyId', async (req, res) => {
  try {
    if (req.authMethod !== 'session') return res.status(403).json({ error: 'Sign in on games.gametok.co to revoke API keys' });
    const revoked = await pool.query(
      `UPDATE developer_api_keys SET revoked_at = NOW()
       WHERE id::text = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.keyId, req.developer.id]
    );
    if (revoked.rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    res.json({ success: true, revoked: revoked.rows[0].id });
  } catch (err) {
    console.error('[API Keys] Revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// 1. List developer games
app.get('/api/developer/games', async (req, res) => {
  try {
    const developer = await resolveDeveloper(req);
    if (!developer) {
      return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    }

    const gamesRes = await pool.query(
      `SELECT g.*,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.game_id = g.id), 0) AS likes_count,
        COALESCE(g.plays, 0) AS plays_count,
        COALESCE((SELECT COUNT(DISTINCT COALESCE(s.user_id::text, s.client_id)) FROM game_sessions s WHERE s.game_id = g.id), 0) AS unique_players,
        COALESCE((SELECT AVG(duration_seconds) FROM game_sessions s WHERE s.game_id = g.id AND s.duration_seconds > 0), 0) AS avg_duration_seconds
       FROM games g
       WHERE g.developer = $1 OR g.developer = $2
       ORDER BY g.created_at DESC`,
      [developer.id.toString(), developer.username]
    );

    res.json({
      success: true,
      developer: {
        id: developer.id,
        username: developer.username,
        displayName: developer.display_name,
        avatar: developer.avatar,
        bio: developer.bio,
      },
      games: gamesRes.rows.map(row => ({
        ...formatGame(row),
        uniquePlayers: parseInt(row.unique_players || 0, 10),
        avgDurationSeconds: Math.round(parseFloat(row.avg_duration_seconds || 0)),
        integration: row.integration || {},
      }))
    });
  } catch (err) {
    console.error('[Developer Platform] Error listing games:', err);
    res.status(500).json({ error: 'Failed to list developer games: ' + err.message });
  }
});

// 2. Register a new game (draft or initial registration)
app.post('/api/developer/games', async (req, res) => {
  try {
    const developer = await resolveDeveloper(req);
    if (!developer) {
      return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    }

    const {
      title,
      description,
      orientation = 'portrait',
      category = 'arcade',
      version = '1.0.0',
      embedUrl,
      html,
      icon = '🎮',
      color = '#38bdf8'
    } = req.body;

    const gameTitle = (title || 'Untitled Game').trim();
    let slug = gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (!slug) slug = `game-${Date.now().toString(36)}`;

    // Avoid collision
    let gameId = slug;
    const existing = await pool.query('SELECT id, developer FROM games WHERE id = $1', [gameId]);
    if (existing.rows.length > 0 && existing.rows[0].developer !== developer.id.toString()) {
      gameId = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // Auto-generate embedUrl for directly uploaded HTML bundles
    const finalEmbedUrl = embedUrl || (html ? `${PUBLIC_API_ORIGIN}/api/games/${gameId}/play-html` : null);

    const insertResult = await pool.query(
      `INSERT INTO games (
        id, name, description, icon, color, category,
        embed_url, developer, orientation, runtime, script_payload,
        status, version, verification_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'web', $10, 'draft', $11, 'unverified')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        category = EXCLUDED.category,
        embed_url = COALESCE(EXCLUDED.embed_url, games.embed_url),
        orientation = EXCLUDED.orientation,
        script_payload = COALESCE(EXCLUDED.script_payload, games.script_payload),
        version = EXCLUDED.version
      RETURNING *`,
      [
        gameId,
        gameTitle,
        description || '',
        icon,
        color,
        category.toLowerCase(),
        finalEmbedUrl,
        developer.id.toString(),
        orientation === 'landscape' ? 'landscape' : 'portrait',
        html || null,
        version
      ]
    );

    // Record initial version
    await pool.query(
      `INSERT INTO game_versions (game_id, version, entry_point, script_payload, status)
       VALUES ($1, $2, $3, $4, 'draft')
       ON CONFLICT (game_id, version) DO UPDATE SET
        entry_point = EXCLUDED.entry_point,
        script_payload = EXCLUDED.script_payload`,
      [gameId, version, finalEmbedUrl, html || null]
    );

    const saved = insertResult.rows[0];

    // Automatic in-game Puppeteer screenshot capture (runs async)
    requestThumbnailCapture(saved.id);
    const generatedPrompt = `Read https://gametok.co/skill.md and package this game for GameTok.

1. Inspect project structure and entry point.
2. Verify mobile touch controls and viewport scaling.
3. Verify game readiness locally and report changed files.`;

    res.json({
      success: true,
      game: formatGame(saved),
      integrationPrompt: generatedPrompt,
      integrationChecklist: {
        reviewedInstructions: false,
        testedLocally: false,
        passedChecks: false,
        submitted: false
      }
    });
  } catch (err) {
    console.error('[Developer Platform] Error registering game:', err);
    res.status(500).json({ error: 'Failed to register game: ' + err.message });
  }
});

// 3. Get game detail, status, generated AI prompt, and verification checklist
// Admin (behind requireAdmin): creators auto-created by the old zero-signup publish flow.
// They have no login of any kind, so nobody can manage their games.
app.get('/api/admin/orphan-creators', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.created_at,
         COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name, 'plays', g.plays, 'embedUrl', g.embed_url))
           FILTER (WHERE g.id IS NOT NULL), '[]') AS games
       FROM users u
       LEFT JOIN games g ON g.developer = u.id::text OR g.developer = u.username
       WHERE u.token IS NULL AND u.email IS NULL AND u.password IS NULL AND u.oauth_id IS NULL
         AND u.bio LIKE 'Indie game developer on GameTok.%'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ success: true, count: result.rows.length, creators: result.rows });
  } catch (err) {
    console.error('[Admin] Orphan creators error:', err);
    res.status(500).json({ error: 'Failed to list orphan creators' });
  }
});

// Unpublish a game. requireDeveloper + requireOwnedGame (mounted above) guarantee the
// caller owns req.game.
app.delete('/api/developer/games/:id', async (req, res) => {
  try {
    const game = req.game;
    if (req.apiKeyMode === 'test' && game.status !== 'draft') {
      return res.status(403).json({ error: 'Test keys can only delete drafts', code: 'TEST_KEY_LIVE_GAME' });
    }
    // games FKs cascade; these two tables have no FK to games.
    await pool.query('DELETE FROM game_categories WHERE game_id = $1', [game.id]);
    await pool.query('DELETE FROM game_leaderboard WHERE game_id = $1', [game.id]).catch(() => {});
    await pool.query('DELETE FROM games WHERE id = $1', [game.id]);
    res.json({ success: true, deleted: game.id });
  } catch (err) {
    console.error('[Developer Platform] Error deleting game:', err);
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

app.get('/api/developer/games/:id', async (req, res) => {
  try {
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (gameRes.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const game = gameRes.rows[0];

    // Get developer info
    const devRes = await pool.query('SELECT * FROM users WHERE id::text = $1 OR username = $1', [game.developer]);
    const developer = devRes.rows[0] || { username: 'creator', display_name: 'Creator' };

    const prompt = `Read https://gametok.co/skill.md and package this game for GameTok.

Game Title: ${game.name}
Game ID: ${game.id}
Target Orientation: ${game.orientation}

Instructions for Coding Agent:
1. Inspect project structure and identify the game entry point.
2. Check mobile viewport & touch actions:
   - Ensure viewport is responsive, the game responds to taps, and default scrolling is prevented.
3. Report changed files, compatibility issues, and test the game locally.`;

    const versions = await pool.query('SELECT * FROM game_versions WHERE game_id = $1 ORDER BY created_at DESC', [game.id]);

    res.json({
      success: true,
      game: formatGame(game),
      versions: versions.rows,
      integrationPrompt: prompt,
      checklist: {
        reviewedInstructions: true,
        testedLocally: game.verification_status === 'verified',
        passedChecks: game.verification_status === 'verified',
        submitted: game.status !== 'draft'
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get game details: ' + err.message });
  }
});

// 4. Automated verification endpoint (re-runs the publish checks)
app.post('/api/developer/games/:id/verify', async (req, res) => {
  try {
    const game = req.game; // requireOwnedGame
    const review = await runGameChecks({ url: game.script_payload ? null : game.embed_url, html: game.script_payload });
    const status = review.ok ? reviewStatus(review) : 'failed';
    await pool.query('UPDATE games SET verification_status = $1, verification_notes = $2 WHERE id = $3',
      [status, JSON.stringify(review.checks), game.id]);
    res.json({ success: true, gameId: game.id, status, passed: review.ok, checks: review.checks, warnings: review.warnings });
  } catch (err) {
    console.error('[Developer Platform] Re-check error:', err);
    res.status(500).json({ error: 'Checks failed to run' });
  }
});

// 5. Go live: publish a game (e.g. a test-mode draft) once the agreement is accepted and the
// automatic checks pass. Auto-approved — there is no manual review queue.
app.post('/api/developer/games/:id/submit', async (req, res) => {
  try {
    const game = req.game; // requireOwnedGame
    if (req.authMethod === 'api_key' && req.apiKeyMode === 'test') {
      return res.status(403).json({ error: 'Test keys can only create drafts. Go live from the dashboard or with a live key.', code: 'TEST_KEY_CANNOT_GO_LIVE' });
    }
    if (!agreementIsCurrent(req.developer)) {
      return res.status(403).json({ error: AGREEMENT_REQUIRED_ERROR, code: 'AGREEMENT_REQUIRED' });
    }
    const review = await runGameChecks({ url: game.script_payload ? null : game.embed_url, html: game.script_payload });
    if (!review.ok) {
      const failed = review.checks.find(c => c.blocking && c.ok === false);
      await pool.query("UPDATE games SET verification_status = 'failed', verification_notes = $1 WHERE id = $2",
        [JSON.stringify(review.checks), game.id]);
      return res.status(400).json({ error: failed.detail, code: failed.code, checks: review.checks });
    }
    await pool.query(
      "UPDATE games SET status = 'published', verification_status = $1, verification_notes = $2, updated_at = NOW() WHERE id = $3",
      [reviewStatus(review), JSON.stringify(review.checks), game.id]
    );
    res.json({ success: true, gameId: game.id, status: 'published', url: `https://gametok.co/game/${game.id}`, checks: review.checks, warnings: review.warnings });
  } catch (err) {
    console.error('[Developer Platform] Go-live error:', err);
    res.status(500).json({ error: 'Could not publish the game' });
  }
});

// 6. Game Analytics Endpoint (Real aggregated metrics)
app.get('/api/developer/games/:id/analytics', async (req, res) => {
  try {
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (gameRes.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    const game = gameRes.rows[0];

    // Aggregates from game_plays, scores, and game_sessions
    const playStats = await pool.query(
      `SELECT
        COUNT(*) AS session_count,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS authenticated_players,
        COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL) AS anonymous_players,
        COUNT(DISTINCT COALESCE(user_id::text, client_id)) AS unique_players,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration,
        COALESCE(MAX(score), 0) AS high_score
       FROM game_sessions
       WHERE game_id = $1`,
      [game.id]
    );

    const scoresRes = await pool.query(
      `SELECT COUNT(*) AS total_scores, COALESCE(MAX(score), 0) AS max_score
       FROM scores WHERE game_id = $1`,
      [game.id]
    );

    const s = playStats.rows[0] || {};
    const totalPlays = Math.max(parseInt(game.plays || 0, 10), parseInt(s.session_count || 0, 10));
    // One player = a signed-in user or, when anonymous, a client id. Never estimated from plays.
    const uniquePlayers = parseInt(s.unique_players || 0, 10);

    res.json({
      success: true,
      gameId: game.id,
      title: game.name,
      metrics: {
        totalLaunches: totalPlays,
        uniquePlayers: uniquePlayers,
        averageDurationSeconds: Math.round(parseFloat(s.avg_duration || 0)),
        highScore: Math.max(parseInt(s.high_score || 0, 10), parseInt(scoresRes.rows[0]?.max_score || 0, 10)),
        totalScoresSubmitted: parseInt(scoresRes.rows[0]?.total_scores || 0, 10),
        likeCount: parseInt(game.like_count || 0, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics: ' + err.message });
  }
});

// 7. Track game session duration and events from GameTok Bridge
app.post('/api/developer/analytics/session', async (req, res) => {
  try {
    const { gameId, clientId, durationSeconds = 0, score = 0, platform = 'web' } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId is required' });

    const token = req.headers.authorization?.replace('Bearer ', '');
    let userId = null;
    if (token) {
      const uRes = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
      if (uRes.rows.length > 0) userId = uRes.rows[0].id;
    }

    await pool.query(
      `INSERT INTO game_sessions (game_id, user_id, client_id, duration_seconds, score, platform, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($4 || ' seconds')::interval, NOW())`,
      [gameId, userId, clientId || null, Math.max(0, parseInt(durationSeconds, 10) || 0), parseInt(score, 10) || 0, platform]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Session logging error:', err.message);
    res.status(500).json({ error: 'Failed to record session' });
  }
});

// 8. Overall Developer Analytics (for Developer Dashboard)
app.get('/api/developer/analytics', async (req, res) => {
  try {
    const developer = await resolveDeveloper(req);
    if (!developer) {
      return res.status(401).json({ error: DEVELOPER_AUTH_ERROR });
    }

    const devIdStr = developer.id.toString();
    const devUsername = developer.username;

    // Fetch all games belonging to this developer
    const gamesRes = await pool.query(
      `SELECT id, name, plays, created_at, thumbnail, orientation, status FROM games 
       WHERE developer = $1 OR developer = $2
       ORDER BY plays DESC, created_at DESC`,
      [devIdStr, devUsername]
    );

    const devGames = gamesRes.rows;
    const gameIds = devGames.map(g => g.id);

    if (gameIds.length === 0) {
      return res.json({
        success: true,
        summary: {
          totalPlayers: 0,
          totalPlays: 0,
          avgDurationSeconds: 0,
          returningPlayersPct: 0,
          totalGames: 0
        },
        deviceBreakdown: { mobile: 70, desktop: 20, tablet: 10 },
        activityPoints: [],
        topGames: []
      });
    }

    // Sessions metrics
    const sessionStatsRes = await pool.query(
      `SELECT
        COUNT(*) AS total_sessions,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS auth_users,
        COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL) AS anon_clients,
        COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0) AS avg_duration,
        COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id::text ELSE client_id END) AS unique_entities
       FROM game_sessions
       WHERE game_id = ANY($1)`,
      [gameIds]
    );

    // Returning players count (entities with > 1 session or play)
    const returningRes = await pool.query(
      `SELECT COUNT(*) AS returning_count FROM (
         SELECT COALESCE(user_id::text, client_id) as entity_id
         FROM game_sessions
         WHERE game_id = ANY($1) AND (user_id IS NOT NULL OR client_id IS NOT NULL)
         GROUP BY COALESCE(user_id::text, client_id)
         HAVING COUNT(*) > 1
       ) r`,
      [gameIds]
    );

    // Platform breakdown
    const platformRes = await pool.query(
      `SELECT 
        LOWER(COALESCE(platform, 'web')) AS platform,
        COUNT(*) AS count
       FROM game_sessions
       WHERE game_id = ANY($1)
       GROUP BY LOWER(COALESCE(platform, 'web'))`,
      [gameIds]
    );

    let mobileCount = 0;
    let desktopCount = 0;
    let tabletCount = 0;
    for (const row of platformRes.rows) {
      const p = row.platform;
      const cnt = parseInt(row.count, 10);
      if (p.includes('mobile') || p.includes('android') || p.includes('ios')) {
        mobileCount += cnt;
      } else if (p.includes('tablet') || p.includes('ipad')) {
        tabletCount += cnt;
      } else {
        desktopCount += cnt;
      }
    }
    const totalPlatformCount = mobileCount + desktopCount + tabletCount;

    // Time-series activity points (last 7 or 14 days)
    const days = parseInt(req.query.period || req.query.days || '7', 10);
    const activityRes = await pool.query(
      `SELECT 
        TO_CHAR(DATE_TRUNC('day', started_at), 'YYYY-MM-DD') AS date,
        COUNT(*) AS plays,
        COUNT(DISTINCT COALESCE(user_id::text, client_id)) AS players
       FROM game_sessions
       WHERE game_id = ANY($1)
         AND started_at >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE_TRUNC('day', started_at)
       ORDER BY date ASC`,
      [gameIds, days]
    );

    const totalRecordedPlays = devGames.reduce((sum, g) => sum + (parseInt(g.plays, 10) || 0), 0);
    const sessionCount = parseInt(sessionStatsRes.rows[0]?.total_sessions || 0, 10);
    const totalPlays = Math.max(totalRecordedPlays, sessionCount);

    const uniqueEntities = parseInt(sessionStatsRes.rows[0]?.unique_entities || 0, 10);
    // unique_entities already de-dupes signed-in users and anonymous clients; never estimated from plays.
    const totalPlayers = uniqueEntities;

    const returningCount = parseInt(returningRes.rows[0]?.returning_count || 0, 10);
    const returningPct = totalPlayers > 0 ? Math.min(100, Math.round((returningCount / totalPlayers) * 100)) : 0;
    const avgDuration = Math.round(parseFloat(sessionStatsRes.rows[0]?.avg_duration || 0));

    // Per-game activity
    const gameMetricsRes = await pool.query(
      `SELECT 
        g.id, g.name, g.thumbnail, COALESCE(g.plays, 0) as plays,
        COUNT(s.id) as sessions,
        COUNT(DISTINCT COALESCE(s.user_id::text, s.client_id)) as players
       FROM games g
       LEFT JOIN game_sessions s ON s.game_id = g.id
       WHERE g.id = ANY($1)
       GROUP BY g.id, g.name, g.thumbnail, g.plays
       ORDER BY plays DESC, sessions DESC`,
      [gameIds]
    );

    res.json({
      success: true,
      summary: {
        totalPlayers,
        totalPlays,
        avgDurationSeconds: avgDuration,
        returningPlayersPct: returningPct,
        totalGames: devGames.length
      },
      deviceBreakdown: {
        // No sessions yet means no breakdown (never invent a split).
        mobile: totalPlatformCount > 0 ? Math.round((mobileCount / totalPlatformCount) * 100) : 0,
        desktop: totalPlatformCount > 0 ? Math.round((desktopCount / totalPlatformCount) * 100) : 0,
        tablet: totalPlatformCount > 0 ? Math.round((tabletCount / totalPlatformCount) * 100) : 0
      },
      activityPoints: activityRes.rows,
      topGames: gameMetricsRes.rows.map(g => ({
        id: g.id,
        name: g.name,
        thumbnail: g.thumbnail,
        plays: Math.max(parseInt(g.plays || 0, 10), parseInt(g.sessions || 0, 10)),
        players: parseInt(g.players || 0, 10)
      }))
    });
  } catch (err) {
    console.error('[Developer Analytics] Error:', err);
    res.status(500).json({ error: 'Failed to fetch developer analytics: ' + err.message });
  }
});

// 9. On-Demand Screenshot Recapture (Puppeteer headless WebP)
const handleGameScreenshotCapture = async (req, res) => {
  try {
    const gameId = req.params.id;
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
    if (gameRes.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const game = gameRes.rows[0];

    const targetUrl = game.embed_url || req.body?.url;
    const htmlPayload = game.script_payload || req.body?.html;
    const orientation = req.body?.orientation || game.orientation || 'landscape';

    if (!targetUrl && !htmlPayload) {
      return res.status(400).json({ error: 'No playable URL or HTML found for this game to capture screenshot' });
    }

    const captureResult = await captureGameScreenshot({
      gameId: game.id,
      url: targetUrl,
      html: htmlPayload,
      orientation
    });

    if (captureResult?.thumbnailUrl) {
      await pool.query('UPDATE games SET thumbnail = $1 WHERE id = $2', [captureResult.thumbnailUrl, game.id]);
      return res.json({
        success: true,
        thumbnailUrl: captureResult.thumbnailUrl,
        message: 'Screenshot captured and game thumbnail updated!'
      });
    }

    return res.status(500).json({ error: 'Screenshot capture returned no thumbnail URL' });
  } catch (err) {
    console.error('[Screenshot API] Error:', err);
    res.status(500).json({ error: 'Failed to capture screenshot: ' + err.message });
  }
};

app.post('/api/developer/games/:id/screenshot', handleGameScreenshotCapture);
app.post('/api/games/:id/capture-thumbnail', handleGameScreenshotCapture);


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
  // 'discover' is the phone app's swipe home feed; other sorts back Explore.
  const forDevice = platformSql(req, { feed: sort === 'discover' });
  // Optional discovery category (see src/categories.js). Unknown values are ignored
  // rather than returning nothing, so a stale link degrades to the full feed.
  const category = isValidCategory(req.query.category)
    ? String(req.query.category).trim().toLowerCase()
    : null;

  try {
    const params = [limit, offset];
    let categoryFilter = '';
    if (category) {
      params.push(category);
      categoryFilter = `AND EXISTS (
        SELECT 1 FROM game_categories gc
        WHERE gc.game_id = g.id AND gc.category = $${params.length}
      )`;
    }

    // Every game carries its categories, gathered once here rather than N+1 per row.
    const categoriesSelect = `
      COALESCE(
        (SELECT ARRAY_AGG(gc.category ORDER BY gc.category)
         FROM game_categories gc WHERE gc.game_id = g.id),
        ARRAY[]::varchar[]
      ) AS categories`;

    // Exclude multiplayer-only games from main feed
    let result;
    if (sort === 'random') {
      result = await pool.query(
        `SELECT
           g.*,
           u.id AS creator_id,
           u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
           u.username AS creator_username,
           ${categoriesSelect}
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
         WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
         AND (g.status IS NULL OR g.status = 'published')
         AND (g.id NOT ILIKE '%cyber%dodge%' AND g.name NOT ILIKE '%cyber dodge%')
         ${categoryFilter}
         ORDER BY RANDOM()
         LIMIT $1 OFFSET $2`,
        params
      );
    } else {
      // 'new' is genuinely newest-first. It used to fall through to the discover
      // branch, so the "New" row on both clients was just backend order relabelled.
      const orderBy = sort === 'new'
        ? `g.created_at DESC, COALESCE(g.plays, 0) DESC`
        : sort === 'trending'
          ? `COALESCE(sa.recent_activity_score, 0) DESC, COALESCE(g.plays, 0) DESC, g.created_at DESC`
          : `discover_score DESC,
             COALESCE(sa.recent_activity_score, 0) DESC,
             COALESCE(g.plays, 0) DESC,
             g.created_at DESC`;

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
           u.id AS creator_id,
           u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
           u.username AS creator_username,
           COALESCE(sa.recent_score_events, 0) AS recent_score_events,
           COALESCE(sa.recent_unique_scorers, 0) AS recent_unique_scorers,
           COALESCE(sa.recent_activity_score, 0) AS recent_activity_score,
           ${categoriesSelect},
           (
             -- classification_confidence used to sit here weighted 35 — the single
             -- largest term — but it is NULL for every game published since AI
             -- classification was removed, so it only ever boosted legacy rows and
             -- buried new ones. Dropped with the rest of the old taxonomy.
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
         WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
         AND (g.status IS NULL OR g.status = 'published')
         AND (g.id NOT ILIKE '%cyber%dodge%' AND g.name NOT ILIKE '%cyber dodge%')
         ${categoryFilter}
         ORDER BY ${orderBy}
         LIMIT $1 OFFSET $2`,
        params
      );
    }

    const countParams = category ? [category] : [];
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM games g
       WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
       AND (g.status IS NULL OR g.status = 'published')
       AND (g.id NOT ILIKE '%cyber%dodge%' AND g.name NOT ILIKE '%cyber dodge%')
       ${category ? `AND EXISTS (SELECT 1 FROM game_categories gc WHERE gc.game_id = g.id AND gc.category = $1)` : ''}`,
      countParams
    );
    res.json({ games: result.rows.map(formatGame), total: parseInt(countResult.rows[0].count) });
  } catch (e) {
    console.error('[games] list failed:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * One-time (re-runnable) categorisation of the existing catalogue.
 * Skips anything already categorised, so it can be run in batches and resumed, and never
 * overwrites a creator's own pick.
 */
app.post('/api/admin/backfill-categories', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 200);
  const dryRun = String(req.query.dryRun || '') === '1';
  try {
    const pending = await pool.query(
      `SELECT g.id, g.name, g.description, ag.prompt
       FROM games g
       LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       WHERE NOT EXISTS (SELECT 1 FROM game_categories gc WHERE gc.game_id = g.id)
       ORDER BY g.created_at DESC
       LIMIT $1`,
      [limit]
    );

    const results = [];
    for (const row of pending.rows) {
      const { categories, source } = await classifyGame({
        title: row.name,
        prompt: row.prompt,
        description: row.description,
      });
      if (categories.length && !dryRun) {
        await setGameCategories(pool, row.id, categories, source);
      }
      results.push({ id: row.id, name: row.name, categories, source });
    }

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS c FROM games g
       WHERE NOT EXISTS (SELECT 1 FROM game_categories gc WHERE gc.game_id = g.id)`
    );
    res.json({ processed: results.length, dryRun, remaining: remaining.rows[0].c, results });
  } catch (e) {
    console.error('[categories] backfill failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** The category nav. Counts let the client hide empty categories. */
app.get('/api/categories', async (_req, res) => {
  try {
    const counts = await pool.query(
      `SELECT gc.category, COUNT(*)::int AS count
       FROM game_categories gc
       JOIN games g ON g.id = gc.game_id
       WHERE g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL
       GROUP BY gc.category`
    );
    const byCategory = Object.fromEntries(counts.rows.map((r) => [r.category, r.count]));
    res.json({
      categories: CATEGORIES.map((c) => ({ ...c, count: byCategory[c.slug] || 0 })),
    });
  } catch (e) {
    console.error('[categories] list failed:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/discover-lanes', async (req, res) => {
  const forDevice = platformSql(req);
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
           u.id AS creator_id,
           u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
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
	           (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice} AND
	           ag.id IS NOT NULL AND
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
           u.id AS creator_id,
           u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
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
           (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published') AND
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

app.get('/api/games/top', async (req, res) => {
  const forDevice = platformSql(req);
  const limit = Math.min(parseInt(req.query.limit) || 10, 30);
  const rawTab = String(req.query.tab || 'Explore').trim();
  const normalizedTab = ['Explore', 'Games', 'Horror', 'Quiz', 'Roleplay'].includes(rawTab) ? rawTab : 'Explore';

  try {
    const result = await pool.query(
      `SELECT
         g.*,
         u.id AS creator_id,
         u.display_name AS creator_display_name,
         u.verified AS creator_verified,
           u.avatar AS creator_avatar,
         u.username AS creator_username,
         (
           COALESCE(g.plays, 0) * 3 +
           COALESCE(g.like_count, 0) * 5 +
           COALESCE(g.save_count, 0) * 4
         ) AS top_score
       FROM games g
       LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
       WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
         AND ag.id IS NOT NULL
         AND ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
       ORDER BY top_score DESC, COALESCE(g.plays, 0) DESC, COALESCE(g.like_count, 0) DESC, COALESCE(g.save_count, 0) DESC, g.created_at DESC
       LIMIT $2`,
      [normalizedTab, limit]
    );

    res.json({
      tab: normalizedTab,
      games: result.rows.map((row, index) => ({
        rank: index + 1,
        score: Number(row.top_score || 0),
        game: formatGame(row),
      })),
    });
  } catch (e) {
    console.error('Top games error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/trending-summary', async (req, res) => {
  const forDevice = platformSql(req);
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);
  const rawTab = String(req.query.tab || 'Explore').trim();
  const normalizedTab = ['Explore', 'Games', 'Horror', 'Quiz', 'Roleplay'].includes(rawTab) ? rawTab : 'Explore';

  try {
    const [searchHeatResult, creatorsRisingResult, gamesPoppingResult, topSearchesResult, topCreatorsResult, topGamesResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM search_events
         WHERE created_at > NOW() - INTERVAL '14 days'`
      ),
      pool.query(
        `WITH score_activity AS (
           SELECT
             game_id,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
           FROM scores
           GROUP BY game_id
         )
         SELECT COUNT(DISTINCT u.id)::int AS total
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
         LEFT JOIN score_activity sa ON sa.game_id = g.id
	         WHERE u.id IS NOT NULL
	           AND (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
	           AND ag.id IS NOT NULL
	           AND ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
           AND COALESCE(sa.recent_activity_score, 0) > 0`,
        [normalizedTab]
      ),
      pool.query(
        `WITH score_activity AS (
           SELECT
             game_id,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
           FROM scores
           GROUP BY game_id
         )
         SELECT COUNT(*)::int AS total
	         FROM games g
	         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
	         LEFT JOIN score_activity sa ON sa.game_id = g.id
	         WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
	           AND ag.id IS NOT NULL
	           AND ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
           AND (
             COALESCE(sa.recent_activity_score, 0) > 0 OR
             g.created_at >= NOW() - INTERVAL '7 days'
           )`,
        [normalizedTab]
      ),
      pool.query(
        `SELECT normalized_query, MIN(query) AS display_query, COUNT(*)::int AS search_count
         FROM search_events
         WHERE created_at > NOW() - INTERVAL '14 days'
           AND LENGTH(normalized_query) >= 2
         GROUP BY normalized_query
         ORDER BY search_count DESC, MAX(created_at) DESC
         LIMIT $1`,
        [limit]
      ),
      pool.query(
        `WITH score_activity AS (
           SELECT
             game_id,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
           FROM scores
           GROUP BY game_id
         ),
         creator_pool AS (
           SELECT
             u.id,
             u.username,
             u.display_name,
             u.avatar,
             COUNT(g.id)::int AS game_count,
             COALESCE(SUM(g.plays), 0)::int AS total_plays,
             COALESCE(SUM(sa.recent_activity_score), 0)::int AS recent_activity_score,
             (
               COALESCE(SUM(sa.recent_activity_score), 0) * 1.8 +
               LEAST(COALESCE(SUM(g.plays), 0) / 6000.0, 18) +
               COUNT(g.id) * 1.5
             ) AS creator_score
           FROM games g
           LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
           LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
           LEFT JOIN score_activity sa ON sa.game_id = g.id
	           WHERE u.id IS NOT NULL
	             AND (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
	             AND ag.id IS NOT NULL
	             AND ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
           GROUP BY u.id, u.username, u.display_name, u.avatar
         )
         SELECT *
         FROM creator_pool
         ORDER BY creator_score DESC, total_plays DESC, game_count DESC
         LIMIT $2`,
        [normalizedTab, limit]
      ),
      pool.query(
        `WITH score_activity AS (
           SELECT
             game_id,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') * 5 +
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') * 2 +
             COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days' AND user_id IS NOT NULL) * 3 AS recent_activity_score
           FROM scores
           GROUP BY game_id
         ),
         discover_pool AS (
           SELECT
             g.*,
             u.id AS creator_id,
             u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
             u.username AS creator_username,
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
             ) AS discover_score,
             (
               COALESCE(sa.recent_activity_score, 0) * 1.9 +
               LEAST(COALESCE(g.plays, 0) / 8000.0, 16) +
               CASE
                 WHEN g.created_at >= NOW() - INTERVAL '3 days' THEN 12
                 WHEN g.created_at >= NOW() - INTERVAL '7 days' THEN 6
                 ELSE 0
               END
             ) AS rising_score
           FROM games g
           LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
           LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
           LEFT JOIN score_activity sa ON sa.game_id = g.id
	           WHERE (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
	             AND ag.id IS NOT NULL
	             AND ($1 = 'Explore' OR COALESCE(g.primary_tab, 'Explore') = $1)
         )
         SELECT *
         FROM discover_pool
         ORDER BY rising_score DESC, discover_score DESC, plays DESC, created_at DESC
         LIMIT $2`,
        [normalizedTab, limit]
      ),
    ]);

    res.json({
      tab: normalizedTab,
      pulses: {
        searchHeat: Number(searchHeatResult.rows[0]?.total || 0),
        creatorsRising: Number(creatorsRisingResult.rows[0]?.total || 0),
        gamesPopping: Number(gamesPoppingResult.rows[0]?.total || 0),
      },
      topSearches: topSearchesResult.rows.map((row) => ({
        query: row.display_query,
        normalizedQuery: row.normalized_query,
        count: Number(row.search_count || 0),
      })),
      topCreators: topCreatorsResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar || null,
        gameCount: Number(row.game_count || 0),
        totalPlays: Number(row.total_plays || 0),
        recentActivityScore: Number(row.recent_activity_score || 0),
      })),
      topGames: topGamesResult.rows.map((row) => ({
        game: formatGame(row),
        recentActivityScore: Number(row.recent_activity_score || 0),
        discoverScore: Number(row.discover_score || 0),
        risingScore: Number(row.rising_score || 0),
      })),
    });
  } catch (e) {
    console.error('Trending summary error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/search', async (req, res) => {
  const forDevice = platformSql(req);
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
         u.id AS creator_id,
         u.display_name AS creator_display_name,
         u.verified AS creator_verified,
           u.avatar AS creator_avatar,
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
	       AND (g.multiplayer_only = FALSE OR g.multiplayer_only IS NULL) AND (g.status IS NULL OR g.status = 'published')${forDevice}
	       AND (g.id NOT ILIKE '%cyber%dodge%' AND g.name NOT ILIKE '%cyber dodge%')
	       AND ag.id IS NOT NULL
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
         u.id AS creator_id,
         u.display_name AS creator_display_name,
         u.verified AS creator_verified,
           u.avatar AS creator_avatar,
         u.username AS creator_username
       FROM games g
       LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
       LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
       WHERE g.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    // Test-mode drafts are private to their developer.
    if (result.rows[0].status === 'draft') {
      const viewer = await authenticateDeveloper(req).catch(() => null);
      if (!ownsGame(viewer, result.rows[0])) return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ game: formatGame(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Player identity -------------------------------------------------------------------
// A game asks "who's playing?" via bridge.js (GameTok.init / GameTok.session). The GameTok
// player around it calls this endpoint with the player's own GameTok auth and passes the
// result into the game. The game's server then checks the session with
// POST /api/developer/sessions/verify using the developer's key.
//  - player.id is a pseudonym unique to (player, game): games can't link players across games.
//  - session is a 15-minute HS256 JWT signed with a platform secret only GameTok holds.
//  - mode is 'test' for drafts (owner only, in the dashboard test player) and 'live' otherwise.
let sessionSigningSecret = null;
async function getSessionSigningSecret() {
  if (sessionSigningSecret) return sessionSigningSecret;
  await pool.query(
    `INSERT INTO platform_secrets (name, value) VALUES ('player_session_signing', $1) ON CONFLICT (name) DO NOTHING`,
    [crypto.randomBytes(48).toString('hex')]
  );
  const row = await pool.query(`SELECT value FROM platform_secrets WHERE name = 'player_session_signing'`);
  sessionSigningSecret = row.rows[0].value;
  return sessionSigningSecret;
}

const PLAYER_SESSION_TTL_SECONDS = 15 * 60;

async function pseudonymousPlayerId(kind, rawId, gameId, mode) {
  const secret = await getSessionSigningSecret();
  const digest = crypto.createHmac('sha256', secret).update(`${kind}:${rawId}:${gameId}`).digest('base64url').slice(0, 22);
  return (mode === 'test' ? 't_' : 'p_') + digest;
}

// The profile picture: a headshot of the player's 3D avatar (src/avatar-router.js), or none yet.
// (Old accounts may still hold a 2D dicebear:// address: those are no picture now.)
function publicAvatarUrl(avatar) {
  return avatar && /^https:\/\//i.test(avatar) ? avatar : null;
}

app.post('/api/games/:id/player-session', async (req, res) => {
  try {
    const gameRes = await pool.query('SELECT id, developer, status FROM games WHERE id = $1', [req.params.id]);
    const game = gameRes.rows[0];
    if (!game) return res.status(404).json({ error: 'Game not found', code: 'GAME_NOT_FOUND' });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const userRes = token ? await pool.query('SELECT id, username, display_name, avatar FROM users WHERE token = $1', [token]) : { rows: [] };
    const user = userRes.rows[0] || null;
    const clientId = String(req.headers['x-client-id'] || '').trim().slice(0, 100);

    let mode = 'live';
    if (game.status === 'draft') {
      // Drafts only run in the developer's own test player.
      if (!ownsGame(user, game)) return res.status(404).json({ error: 'Game not found', code: 'GAME_NOT_FOUND' });
      mode = 'test';
    }
    if (!user && !clientId) {
      return res.status(400).json({ error: 'Sign in, or send X-Client-Id for a guest player', code: 'NO_PLAYER' });
    }

    const guest = !user;
    const playerId = await pseudonymousPlayerId(guest ? 'guest' : 'user', guest ? clientId : user.id, game.id, mode);
    const player = {
      id: playerId,
      name: guest ? 'Guest' : (user.display_name || user.username || 'Player'),
      avatar: guest ? null : publicAvatarUrl(user.avatar),
      // the 3D avatar they wear (src/avatar-router.js): games that have human characters dress the player in it
      avatarRecord: guest ? null : await avatarRecordOf(user.id),
      // this game's items they own and their TokBux (src/avatar-router.js GAME_ITEMS): a game server trusts these, not the client
      ...(guest ? { owned: [], tokbux: 0, sales: gameSales(game.id) } : await gameEntitlements(user.id, game.id)),
      guest
    };
    // opened from a friend's Join: who they are in this game (the same per-game id their own session carries), so
    // the game can put you in their party
    const joinFriend = !guest && typeof req.body?.joinFriend === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.joinFriend)
      ? await pseudonymousPlayerId('user', req.body.joinFriend, game.id, mode) : null;
    const session = jwt.sign(
      { gid: game.id, name: player.name, guest, mode, own: player.owned, ...(player.avatarRecord ? { av: player.avatarRecord } : {}) },
      await getSessionSigningSecret(),
      { algorithm: 'HS256', subject: playerId, issuer: 'gametok', audience: `game:${game.id}`, expiresIn: PLAYER_SESSION_TTL_SECONDS }
    );
    res.json({ success: true, player, session, mode, expiresIn: PLAYER_SESSION_TTL_SECONDS, ...(joinFriend ? { joinFriend } : {}) });
  } catch (err) {
    console.error('[Player Session] Error:', err);
    res.status(500).json({ error: 'Could not create a player session' });
  }
});

// ---- Multiplayer lobby -------------------------------------------------------------------
// GameTok pairs players and records who won; the developer's own server runs the gameplay.
// Players call these through bridge.js (GameTok.match.*) with their player session; the
// result comes only from the developer's server (signed). Matches have no stakes.
const MATCH_OPEN_MINUTES = 15;   // an unfilled match is cancelled after this
const MATCH_PLAY_HOURS = 2;      // a started match with no result is voided after this
const MATCH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read out loud

async function authenticatePlayerSession(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const claims = jwt.verify(token, await getSessionSigningSecret(), { algorithms: ['HS256'], issuer: 'gametok' });
    return { playerId: claims.sub, name: claims.name, gameId: claims.gid, mode: claims.mode };
  } catch (e) {
    return null;
  }
}

async function requirePlayer(req, res, next) {
  const player = await authenticatePlayerSession(req).catch(() => null);
  if (!player) return res.status(401).json({ error: 'Send a valid player session (GameTok.session())', code: 'SESSION_INVALID' });
  req.player = player;
  next();
}

async function expireMatches(gameId) {
  await pool.query(
    `UPDATE game_matches SET status = 'cancelled', settled_at = NOW()
     WHERE game_id = $1 AND status = 'open' AND created_at < NOW() - ($2 || ' minutes')::interval`,
    [gameId, String(MATCH_OPEN_MINUTES)]);
  await pool.query(
    `UPDATE game_matches SET status = 'void', settled_at = NOW()
     WHERE game_id = $1 AND status = 'playing' AND ends_at < NOW()`,
    [gameId]);
}

async function loadMatch(matchId) {
  const m = await pool.query('SELECT * FROM game_matches WHERE id::text = $1', [String(matchId)]);
  if (!m.rows[0]) return null;
  const players = await pool.query(
    'SELECT player_id, name, left_at FROM game_match_players WHERE match_id = $1 ORDER BY joined_at', [m.rows[0].id]);
  return { ...m.rows[0], players: players.rows };
}

function matchView(match, meId, { forDeveloper = false } = {}) {
  return {
    id: match.id,
    code: match.code,
    status: match.status,
    seats: match.seats,
    mode: match.mode,
    quick: match.quick,
    players: match.players.map(p => ({ id: p.player_id, name: p.name, ...(p.left_at ? { left: true } : {}) })),
    ...(meId ? { me: meId } : {}),
    winner: match.winner,
    result: match.result,
    createdAt: match.created_at,
    startedAt: match.started_at,
    endsAt: match.ends_at,
    settledAt: match.settled_at,
    ...(forDeveloper ? { gameId: match.game_id, nonce: match.nonce } : {})
  };
}

async function activeMatchFor(player) {
  const r = await pool.query(
    `SELECT m.id FROM game_matches m JOIN game_match_players mp ON mp.match_id = m.id
     WHERE m.game_id = $1 AND m.mode = $2 AND m.status IN ('open', 'playing')
       AND mp.player_id = $3 AND mp.left_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1`,
    [player.gameId, player.mode, player.playerId]);
  return r.rows[0] ? loadMatch(r.rows[0].id) : null;
}

async function startIfFull(matchId) {
  await pool.query(
    `UPDATE game_matches SET status = 'playing', started_at = NOW(), ends_at = NOW() + ($2 || ' hours')::interval
     WHERE id = $1 AND status = 'open'
       AND (SELECT COUNT(*) FROM game_match_players WHERE match_id = $1 AND left_at IS NULL) >= seats`,
    [matchId, String(MATCH_PLAY_HOURS)]);
}

async function createMatch(player, seats, quick) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(crypto.randomBytes(6), b => MATCH_CODE_ALPHABET[b % MATCH_CODE_ALPHABET.length]).join('');
    try {
      const m = await pool.query(
        `INSERT INTO game_matches (game_id, mode, code, seats, quick, nonce, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [player.gameId, player.mode, code, seats, quick, crypto.randomBytes(16).toString('hex'), player.playerId]);
      await pool.query('INSERT INTO game_match_players (match_id, player_id, name) VALUES ($1, $2, $3)',
        [m.rows[0].id, player.playerId, player.name]);
      return loadMatch(m.rows[0].id);
    } catch (err) {
      if (err.code !== '23505') throw err; // retry only on a code collision
    }
  }
  throw new Error('Could not allocate a match code');
}

const parseSeats = (v) => {
  const n = parseInt(v ?? 2, 10);
  return Number.isInteger(n) && n >= 2 && n <= 4 ? n : null;
};

app.use('/api/matches', requirePlayer);

app.post('/api/matches', async (req, res) => {
  try {
    const seats = parseSeats(req.body?.seats);
    if (!seats) return res.status(400).json({ error: 'seats must be 2, 3 or 4', code: 'BAD_SEATS' });
    await expireMatches(req.player.gameId);
    const current = await activeMatchFor(req.player);
    if (current) return res.status(409).json({ error: 'You are already in a match in this game', code: 'ALREADY_IN_MATCH', match: matchView(current, req.player.playerId) });
    const match = await createMatch(req.player, seats, false);
    res.json({ match: matchView(match, req.player.playerId) });
  } catch (err) {
    console.error('[Matches] Create error:', err);
    res.status(500).json({ error: 'Could not create match' });
  }
});

app.post('/api/matches/join', async (req, res) => {
  const client = await pool.connect();
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    await expireMatches(req.player.gameId);
    const current = await activeMatchFor(req.player);
    if (current) return res.status(409).json({ error: 'You are already in a match in this game', code: 'ALREADY_IN_MATCH', match: matchView(current, req.player.playerId) });
    await client.query('BEGIN');
    const m = await client.query(
      `SELECT * FROM game_matches WHERE code = $1 AND status = 'open' AND game_id = $2 AND mode = $3 FOR UPDATE`,
      [code, req.player.gameId, req.player.mode]);
    if (!m.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No open match with that code', code: 'MATCH_NOT_FOUND' }); }
    const count = await client.query('SELECT COUNT(*)::int AS n FROM game_match_players WHERE match_id = $1 AND left_at IS NULL', [m.rows[0].id]);
    if (count.rows[0].n >= m.rows[0].seats) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That match is full', code: 'MATCH_FULL' }); }
    await client.query(
      `INSERT INTO game_match_players (match_id, player_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (match_id, player_id) DO UPDATE SET left_at = NULL`,
      [m.rows[0].id, req.player.playerId, req.player.name]);
    await client.query('COMMIT');
    await startIfFull(m.rows[0].id);
    res.json({ match: matchView(await loadMatch(m.rows[0].id), req.player.playerId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Matches] Join error:', err);
    res.status(500).json({ error: 'Could not join match' });
  } finally {
    client.release();
  }
});

app.post('/api/matches/quick', async (req, res) => {
  const client = await pool.connect();
  try {
    const seats = parseSeats(req.body?.seats);
    if (!seats) return res.status(400).json({ error: 'seats must be 2, 3 or 4', code: 'BAD_SEATS' });
    await expireMatches(req.player.gameId);
    const current = await activeMatchFor(req.player);
    if (current) return res.json({ match: matchView(current, req.player.playerId) });
    await client.query('BEGIN');
    // Oldest open quick match in this game with a free seat; SKIP LOCKED so two players
    // looking at once don't both grab the last seat.
    const m = await client.query(
      `SELECT m.* FROM game_matches m
       WHERE m.game_id = $1 AND m.mode = $2 AND m.status = 'open' AND m.quick AND m.seats = $3
         AND (SELECT COUNT(*) FROM game_match_players mp WHERE mp.match_id = m.id AND mp.left_at IS NULL) < m.seats
       ORDER BY m.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [req.player.gameId, req.player.mode, seats]);
    if (!m.rows[0]) {
      await client.query('ROLLBACK');
      const match = await createMatch(req.player, seats, true);
      return res.json({ match: matchView(match, req.player.playerId) });
    }
    await client.query(
      `INSERT INTO game_match_players (match_id, player_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (match_id, player_id) DO UPDATE SET left_at = NULL`,
      [m.rows[0].id, req.player.playerId, req.player.name]);
    await client.query('COMMIT');
    await startIfFull(m.rows[0].id);
    res.json({ match: matchView(await loadMatch(m.rows[0].id), req.player.playerId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Matches] Quick match error:', err);
    res.status(500).json({ error: 'Could not find a match' });
  } finally {
    client.release();
  }
});

app.get('/api/matches/current', async (req, res) => {
  try {
    await expireMatches(req.player.gameId);
    const match = await activeMatchFor(req.player);
    res.json({ match: match ? matchView(match, req.player.playerId) : null });
  } catch (err) {
    console.error('[Matches] Current error:', err);
    res.status(500).json({ error: 'Could not load match' });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    await expireMatches(req.player.gameId);
    const match = await loadMatch(req.params.id);
    if (!match || match.game_id !== req.player.gameId || !match.players.some(p => p.player_id === req.player.playerId)) {
      return res.status(404).json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' });
    }
    res.json({ match: matchView(match, req.player.playerId) });
  } catch (err) {
    console.error('[Matches] Get error:', err);
    res.status(500).json({ error: 'Could not load match' });
  }
});

app.post('/api/matches/:id/leave', async (req, res) => {
  try {
    const match = await loadMatch(req.params.id);
    if (!match || match.game_id !== req.player.gameId || !match.players.some(p => p.player_id === req.player.playerId)) {
      return res.status(404).json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' });
    }
    if (match.status === 'open') {
      await pool.query('DELETE FROM game_match_players WHERE match_id = $1 AND player_id = $2', [match.id, req.player.playerId]);
      await pool.query(
        `UPDATE game_matches SET status = 'cancelled', settled_at = NOW()
         WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM game_match_players WHERE match_id = $1)`, [match.id]);
    } else if (match.status === 'playing') {
      // After the start the player stays on the roster (marked left); the server decides the result.
      await pool.query('UPDATE game_match_players SET left_at = NOW() WHERE match_id = $1 AND player_id = $2', [match.id, req.player.playerId]);
    }
    res.json({ match: matchView(await loadMatch(match.id), req.player.playerId) });
  } catch (err) {
    console.error('[Matches] Leave error:', err);
    res.status(500).json({ error: 'Could not leave match' });
  }
});

// Internal: capture a game's thumbnail inside a request (see requestThumbnailCapture).
app.post('/api/internal/thumbnail/:id', async (req, res) => {
  const expected = crypto.createHash('sha256').update('thumbnail:' + await getSessionSigningSecret()).digest('hex');
  const provided = String(req.headers['x-internal-key'] || '');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return res.status(404).end();
  }
  const url = await autoCaptureGameThumbnail(req.params.id, pool);
  res.json({ success: Boolean(url), thumbnail: url || null });
});

// Serve uploaded HTML game bundles
app.get('/api/games/:id/play-html', async (req, res) => {
  try {
    const result = await pool.query('SELECT script_payload, embed_url FROM games WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).send('Game not found');
    const row = result.rows[0];
    if (row.script_payload) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(withCloudSave(row.script_payload));
    }
    if (row.embed_url) {
      return res.redirect(302, row.embed_url);
    }
    res.status(404).send('No playable content found for this game');
  } catch (err) {
    res.status(500).send('Server error');
  }
});

const PLAY_COOLDOWN_MINUTES = 30;
const MAX_SESSION_SECONDS = 4 * 60 * 60; // a session left open overnight isn't 10 hours of play

app.post('/api/games/:id/play', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const clientId = String(req.headers['x-client-id'] || '').trim();
  // Replaying the same game within this window is the same play (swiping back and forth).
  const cooldownMinutes = PLAY_COOLDOWN_MINUTES;
  let sessionId = null;
  // Every response carries the session id, so the client can report time played to it.
  const reply = (body) => res.json({ ...body, sessionId, cooldownMinutes });
  try {
    const notifyCountedPlay = (userId = null, anonymous = false) => {
      notifications.notifyGamePlayed(req.params.id, userId, anonymous)
        .catch(e => console.log('[Notifications] Play notify error:', e));
    };

    const shouldCountByCooldown = async (lastPlayedAt) => {
      const cooldownResult = await pool.query(
        `SELECT CASE
           WHEN $1::timestamp <= NOW() - make_interval(mins => $2::int) THEN TRUE
           ELSE FALSE
         END AS should_count`,
        [lastPlayedAt, cooldownMinutes],
      );
      return Boolean(cooldownResult.rows[0]?.should_count);
    };

    // Static/seed games (e.g. flappy-bird) are served from disk and are NOT rows in
    // `games`, so inserting a play row violates the anonymous_game_plays /
    // game_leaderboard FK constraint and 500s. Short-circuit gracefully instead.
    const gameExists = await pool.query('SELECT 1 FROM games WHERE id = $1', [req.params.id]);
    if (gameExists.rows.length === 0) {
      return reply({ success: true, counted: false, mode: 'unregistered-game' });
    }

    // Every open is a play session (time played is reported to it); the plays counter below
    // only counts it once per cooldown window.
    const sessionUser = token ? (await pool.query('SELECT id FROM users WHERE token = $1', [token])).rows[0] : null;
    const platform = (req.headers['sec-ch-ua-mobile'] === '?1' || /mobile|android|iphone|ipad|okhttp|cfnetwork/i.test(req.headers['user-agent'] || '')) ? 'mobile' : 'web';
    const session = await pool.query(
      `INSERT INTO game_sessions (game_id, user_id, client_id, duration_seconds, platform, started_at, ended_at)
       VALUES ($1, $2, $3, 0, $4, NOW(), NOW()) RETURNING id`,
      [req.params.id, sessionUser ? sessionUser.id : null, clientId || null, platform]
    ).catch((e) => { console.warn('[Play] game_sessions logging warning:', e.message); return null; });
    sessionId = session ? session.rows[0].id : null;

    if (!token) {
      if (!clientId) {
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous-no-client' });
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
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous' });
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
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous' });
      }

      await pool.query(
        'UPDATE anonymous_game_plays SET last_played_at = NOW() WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );
      return reply({ success: true, counted: false, mode: 'anonymous' });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) {
      if (!clientId) {
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous-fallback-no-client' });
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
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous-fallback' });
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
        notifyCountedPlay(null, true);
        return reply({ success: true, counted: true, mode: 'anonymous-fallback' });
      }

      await pool.query(
        'UPDATE anonymous_game_plays SET last_played_at = NOW() WHERE client_id = $1 AND game_id = $2',
        [clientId, req.params.id],
      );
      return reply({ success: true, counted: false, mode: 'anonymous-fallback' });
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
      notifyCountedPlay(userId, false);
      return reply({ success: true, counted: true, mode: 'user' });
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
      notifyCountedPlay(userId, false);
      return reply({ success: true, counted: true, mode: 'user' });
    }

    await pool.query(
      'UPDATE game_plays SET last_played_at = NOW() WHERE user_id = $1 AND game_id = $2',
      [userId, req.params.id],
    );
    reply({ success: true, counted: false, mode: 'user' });
  } catch (e) {
    console.error('Record play error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// A game was shown (became the card on screen). Fire-and-forget from clients.
app.post('/api/games/:id/view', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const clientId = String(req.headers['x-client-id'] || '').trim();
    const user = token ? (await pool.query('SELECT id FROM users WHERE token = $1', [token])).rows[0] : null;
    const platform = (req.headers['sec-ch-ua-mobile'] === '?1' || /mobile|android|iphone|ipad|okhttp|cfnetwork/i.test(req.headers['user-agent'] || '')) ? 'mobile' : 'web';
    await pool.query(
      `INSERT INTO game_views (game_id, user_id, client_id, platform)
       SELECT $1::varchar, $2::uuid, $3::varchar, $4::varchar WHERE EXISTS (SELECT 1 FROM games WHERE id = $1::varchar)`,
      [req.params.id, user ? user.id : null, clientId.slice(0, 255) || null, platform]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Play] view error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Time played in a session from POST /api/games/:id/play. Clients report the elapsed seconds
// every ~15 s while the game is on screen and once when it leaves; the largest value wins, so
// a closed tab still keeps the time up to its last report. Only the device (or account) that
// opened the session can update it.
app.post('/api/games/:id/sessions/:sessionId', async (req, res) => {
  try {
    const seconds = Math.min(Math.max(0, Math.round(Number(req.body?.seconds) || 0)), MAX_SESSION_SECONDS);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.sessionId)) return res.status(404).json({ error: 'Session not found' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    const clientId = String(req.headers['x-client-id'] || '').trim();
    const user = token ? (await pool.query('SELECT id FROM users WHERE token = $1', [token])).rows[0] : null;
    const result = await pool.query(
      `UPDATE game_sessions
          SET duration_seconds = GREATEST(duration_seconds, $1::int), ended_at = started_at + make_interval(secs => GREATEST(duration_seconds, $1::int))
        WHERE id = $2 AND game_id = $3
          AND ((client_id IS NOT NULL AND client_id = $4) OR (user_id IS NOT NULL AND user_id = $5))`,
      [seconds, req.params.sessionId, req.params.id, clientId || null, user ? user.id : null]
    );
    res.json({ success: result.rowCount === 1 });
  } catch (err) {
    console.error('[Play] session time error:', err.message);
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
    // Discovery categories — multi-label, from the game_categories join table.
    // Replaces the old single-bucket category/subcategory/primaryTab/interactionType/
    // classificationConfidence/classificationTags/discoveryChips fields, which had
    // stopped being written on publish and are no longer sent to clients.
    categories: Array.isArray(row.categories) ? row.categories.filter(Boolean) : [],
    embedUrl: row.embed_url,
    // 'portrait' | 'landscape'. Landscape games are played by rotating the WebView's content
    // inside the portrait feed card — the device never rotates. See ai-engine/orientation.js.
    orientation: row.orientation === 'landscape' ? 'landscape' : 'portrait',
    orientationSource: row.orientation_source || null,
    // 'all' | 'explore' | 'desktop': where phones see it (see mobile-fit.js). Desktop sees all.
    platform: ['explore', 'desktop'].includes(row.platform) ? row.platform : 'all',
    platformSource: row.platform_source || null,
    mobileCheck: row.mobile_check || null,
    creatorId: row.creator_id || row.creatorId || row.developer || null,
    creatorDisplayName: row.creator_display_name || row.creatorDisplayName || null,
    creatorVerified: Boolean(row.creator_verified),
    creatorAvatar: row.creator_avatar || row.creatorAvatar || null,
    creatorUsername: row.creator_username || row.creatorUsername || null,
    remixedFrom: row.remixed_from_username || row.remixedFrom || null,
    plays: row.plays,
    likes: row.like_count,
    saves: row.save_count || 0,
    fileSize: row.file_size,
    createdAt: row.created_at,
    status: row.status || 'published',
    version: row.version || '1.0.0',
    verificationStatus: row.verification_status || 'unverified',
    verificationNotes: row.verification_notes || null,
    discoverScore: row.discover_score ?? row.discoverScore ?? null,
    manifestJson: row.manifest_json || null,
    runtime: row.runtime || 'web',
    gameScript: row.script_payload || null,
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
      SELECT id, username, display_name, avatar, verified
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

    res.json({ users: result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar, verified: Boolean(r.verified) })) });
  } catch (e) {
    console.error('Recommended users error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/search/:query', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, display_name, avatar, verified FROM users 
       WHERE username ILIKE $1 OR display_name ILIKE $1 LIMIT 20`,
      [`%${req.params.query}%`]
    );
    res.json({ users: result.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar, verified: Boolean(r.verified) })) });
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
    const likes = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(like_count, 0)), 0)::int AS count
         FROM games
        WHERE developer = $1::text OR developer = (SELECT username FROM users WHERE id = $1::uuid)`,
      [user.id]
    );

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
      user: await formatUserWithFollowCounts(user),
      isFollowing,
      isMutual,
      stats: {
        followers: parseInt(followers.rows[0].count),
        following: parseInt(following.rows[0].count),
        likes: parseInt(likes.rows[0].count),
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

app.get('/api/users/:id/played', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const currentUserResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (currentUserResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(req.params.id);

    let targetUserResult;
    if (isUUID) {
      targetUserResult = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    } else {
      targetUserResult = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.id]);
    }

    if (targetUserResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const targetUserId = targetUserResult.rows[0].id;

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 60);
    const result = await pool.query(
      `SELECT g.*,
              gp.play_count,
              gp.last_played_at,
              u.id AS creator_id,
              u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
              u.username AS creator_username
         FROM game_plays gp
         JOIN games g ON g.id = gp.game_id
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
        WHERE gp.user_id = $1
        ORDER BY gp.last_played_at DESC
        LIMIT $2`,
      [targetUserId, limit]
    );

    res.json({
      games: result.rows.map((row) => ({
        ...formatGame(row),
        playCount: Number(row.play_count || 0),
        lastPlayedAt: row.last_played_at,
      })),
    });
  } catch (e) {
    console.error('Get played games error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:id/created', async (req, res) => {
  try {
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(req.params.id);

    let targetUserResult;
    if (isUUID) {
      targetUserResult = await pool.query('SELECT id, username FROM users WHERE id = $1::uuid', [req.params.id]);
    } else {
      targetUserResult = await pool.query('SELECT id, username FROM users WHERE username = $1', [req.params.id]);
    }

    let targetUserId = isUUID ? req.params.id : null;
    let targetUsername = req.params.id;
    if (targetUserResult && targetUserResult.rows.length > 0) {
      targetUserId = targetUserResult.rows[0].id;
      targetUsername = targetUserResult.rows[0].username;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 60);
    const result = await pool.query(
      `SELECT g.*,
              u.id AS creator_id,
              u.display_name AS creator_display_name,
              u.verified AS creator_verified,
              u.avatar AS creator_avatar,
              u.username AS creator_username
         FROM games g
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
        WHERE g.developer = $1
           OR (g.developer IS NOT NULL AND LOWER(g.developer) = LOWER($1))
           OR ($2::text IS NOT NULL AND g.developer = $2::text)
           OR ($2::text IS NOT NULL AND COALESCE(NULLIF(g.developer, ''), ag.user_id::text) = $2::text)
        ORDER BY g.created_at DESC
        LIMIT $3`,
      [targetUsername, targetUserId, limit]
    );

    res.json({
      games: result.rows.map(formatGame),
    });
  } catch (e) {
    console.error('Get created games error:', e);
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
    res.json({ user: await formatUserWithFollowCounts(result.rows[0]) });
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

app.post('/api/users/:id/accept-request', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const currentUser = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (currentUser.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });

    const followerId = req.params.id;
    const followingId = currentUser.rows[0].id;

    if (followerId === followingId) return res.status(400).json({ error: 'Cannot accept yourself' });

    const incoming = await pool.query(
      'SELECT 1 FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );
    if (incoming.rows.length === 0) {
      return res.status(404).json({ error: 'No pending request from this user' });
    }

    const inserted = await pool.query(
      `INSERT INTO followers (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING follower_id`,
      [followingId, followerId]
    );

    if (inserted.rows.length > 0) {
      notifications.notifyFollow(followingId, followerId).catch(e => console.log('[Notifications] Follow notify error:', e));

      await pool.query(`
        UPDATE user_challenges 
        SET progress = progress + 1, 
            completed = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) THEN TRUE ELSE completed END,
            completed_at = CASE WHEN progress + 1 >= (SELECT target FROM daily_challenges WHERE id = challenge_id) AND completed = FALSE THEN NOW() ELSE completed_at END
        WHERE user_id = $1 AND assigned_date = CURRENT_DATE AND claimed = FALSE
          AND challenge_id IN (SELECT id FROM daily_challenges WHERE type = 'follow_users')
      `, [followingId]);
    }

    res.json({ following: true, isMutual: true });
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
      `SELECT u.id, u.username, u.display_name, u.avatar, u.verified,
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
      verified: Boolean(r.verified),
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
      `SELECT u.id, u.username, u.display_name, u.avatar, u.verified, f.created_at,
       CASE WHEN EXISTS (
         SELECT 1 FROM followers f2 
         WHERE f2.follower_id = $1 AND f2.following_id = u.id
       ) THEN true ELSE false END as is_mutual
       FROM users u
       JOIN followers f ON u.id = f.follower_id
       WHERE f.following_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM followers f2
         WHERE f2.follower_id = $1 AND f2.following_id = u.id
       )
       AND f.created_at > NOW() - INTERVAL '3 days'
       ORDER BY f.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      avatar: r.avatar,
      verified: Boolean(r.verified),
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
       )
       AND f.created_at > NOW() - INTERVAL '3 days'`,
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
      `SELECT u.id, u.username, u.display_name, u.avatar, u.verified,
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
      verified: Boolean(r.verified),
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

      notifications.notifyGameLiked(gameId, userId)
        .catch(e => console.log('[Notifications] Like notify error:', e));
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
      `SELECT g.*,
              u.id AS creator_id,
              u.display_name AS creator_display_name,
           u.verified AS creator_verified,
           u.avatar AS creator_avatar,
              u.username AS creator_username
         FROM games g
         JOIN likes l ON g.id = l.game_id
         LEFT JOIN ai_games ag ON g.embed_url = ('/api/ai/play/' || ag.id::text)
         LEFT JOIN users u ON u.id::text = COALESCE(NULLIF(g.developer, ''), ag.user_id::text)
        WHERE l.user_id = $1
        ORDER BY l.created_at DESC NULLS LAST, g.created_at DESC`,
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
        id: r.id,
        text: r.text,
        gifUrl: r.gif_url,
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        avatar: r.avatar,
        likes: r.likes,
        liked: r.liked,
        createdAt: r.created_at
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
  const { gameId, text, gifUrl } = req.body;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const cleanText = typeof text === 'string' ? text.trim() : '';
  const cleanGifUrl = typeof gifUrl === 'string' ? gifUrl.trim() : '';
  if (!gameId || (!cleanText && !cleanGifUrl)) {
    return res.status(400).json({ error: 'gameId and either text or gifUrl required' });
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const user = userResult.rows[0];

    const result = await pool.query(
      'INSERT INTO comments (game_id, user_id, text, gif_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [gameId, user.id, cleanText || '', cleanGifUrl || null]
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
        id: result.rows[0].id,
        text: result.rows[0].text,
        gifUrl: result.rows[0].gif_url,
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        avatar: user.avatar,
        likes: 0,
        createdAt: result.rows[0].created_at
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
	  // Legacy seed list for old manually embedded games. Disabled unless
	  // ALLOW_LEGACY_RESEED=true so it cannot pollute AI-game discovery.
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

	  // Upsert only. Never delete user-created or AI-published games here.
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

// Get notifications inbox (real notification events + active creation jobs)
app.get('/api/notifications', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    const userId = userResult.rows[0].id;

    const [events, cooking] = await Promise.all([
      pool.query(
        `SELECT ne.*, u.username, u.display_name, u.avatar,
                g.name AS game_name, g.icon AS game_icon, g.thumbnail AS game_thumbnail
         FROM notification_events ne
         LEFT JOIN users u ON ne.actor_user_id = u.id
         LEFT JOIN games g ON ne.game_id = g.id
         WHERE ne.user_id = $1
         ORDER BY ne.created_at DESC
         LIMIT 50`,
        [userId],
      ),
      pool.query(
        `SELECT id, title, prompt, created_at
         FROM ai_games
         WHERE user_id = $1
           AND is_draft = true
           AND COALESCE(html_payload, '') = ''
           AND game_url IS NULL
           AND title NOT LIKE 'ERROR:%'
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId],
      ),
    ]);

    const all = [
      ...cooking.rows.map(r => ({
        id: `cooking:${r.id}`,
        type: 'creation',
        action: 'game_cooking',
        title: 'Still cooking',
        body: `"${r.prompt?.slice(0, 60) || r.title || 'Your game'}" is being assembled in the background.`,
        createdAt: r.created_at,
        draftId: r.id,
        game: null,
        user: null,
        data: { type: 'creation', action: 'game_cooking', draftId: r.id },
      })),
      ...events.rows.map(r => ({
        id: r.id,
        type: r.type,
        action: r.action,
        title: r.title,
        body: r.body,
        createdAt: r.created_at,
        readAt: r.read_at,
        data: r.data || {},
        user: r.actor_user_id ? {
          id: r.actor_user_id,
          username: r.username,
          displayName: r.display_name,
          avatar: r.avatar,
        } : null,
        game: r.game_id ? {
          id: r.game_id,
          name: r.game_name,
          icon: r.game_icon,
          thumbnail: r.game_thumbnail,
        } : null,
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
    // This endpoint is only ever called by a device with NO auth session
    // (the app awaits getToken() first and only falls through to here when it's
    // null). So if this token is still attached to a user in push_tokens, that
    // user has logged out on this device — detach it, otherwise the device keeps
    // receiving that user's personal notifications (e.g. "someone played your
    // game") even though nobody is logged in.
    await pool.query('DELETE FROM push_tokens WHERE token = $1', [pushToken]);

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
      { type: 'test', action: 'test' },
      { action: 'test', bypassThrottle: true, inApp: false }
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

    // Detach only this device's token when the client sends it, so logging out
    // on one device doesn't kill notifications on the user's other devices.
    // Falls back to clearing all of the user's tokens for older clients.
    const { pushToken } = req.body || {};
    await db.removePushToken(userId, pushToken || null);
    res.json({ success: true });
  } catch (e) {
    console.error('Unregister push token error:', e);
    res.status(500).json({ error: 'Failed to unregister push token' });
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
      { type: 'test', action: 'test' },
      { action: 'test', bypassThrottle: true, inApp: false }
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
        last_notified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE anonymous_push_tokens ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMP;
      
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
  server.listen(PORT, () => {
    console.log(`🎮 GameTok API running on port ${PORT} with PostgreSQL`);
    console.log(`🚀 Direct Gemini API integration active (no CLI required)`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; closing HTTP server and pausing generation queue claims.`);
    stopGenerationQueueWorker(signal);
    stopForgeAutoscaler();
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('Graceful shutdown timed out; exiting so queued jobs can be recovered.');
      process.exit(0);
    }, 25000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // Initialize Socket.io for PK Mode
  initializePkSocket(server);
  console.log('🔌 Socket.io initialized for PK Mode');

  // Initialize Lobby Socket for real-time game lobbies
  initializeLobbySocket(server);
  console.log('🎯 Lobby Socket initialized for multiplayer lobbies');

  // Initialize Chat Socket for real-time messaging
  initializeChatSocket(server);
  console.log('💬 Chat Socket initialized for messaging');

  // Initialize Presence Socket for online/in-game/idle status
  initializePresenceSocket(server);
  console.log('🟢 Presence Socket initialized');

  // Initialize Score Lobby Socket for shared live leaderboards
  ensureScoreLobbyColumn().catch(e => console.warn('[ScoreLobbyColumn] Warning:', e?.message));
  initializeScoreLobbySocket(server);
  console.log('🏆 Score Lobby Socket initialized');

  // Initialize Forge Socket for Hermes Agent-Driven Studio UI
  initializeForgeSocket(server);

  // Run database initialization and migrations asynchronously with automatic retries
  (async () => {
    let retries = 5;
    while (retries > 0) {
      try {
        console.log('🔄 Initializing database and running migrations...');
        await initDB();
        await seedPosts();
        await runMigrations();
        await runGamificationMigrations();
        await runLeaderboardMigration();
        await runDeletedGamesMigration();
        await runCoinConfigMigration();
        await runAvatarMigration();
        await runTokbuxStoreMigration();
        await runAppConfigMigration();
        await runStoriesMigration();
        await runMultiplayerMigration();
        await runAnonymousTokensMigration();
        backfillGameCategories().catch((e) => console.warn('[backfill] error:', e.message));
        console.log('✅ Database and migrations initialized successfully');
        break;
      } catch (err) {
        retries--;
        console.error(`⚠️ [Database Init] Connection failed (${err.message}). Retries left: ${retries}`);
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 4000));
        } else {
          console.error('❌ [Database Init] All retries exhausted. Running with degraded database.');
        }
      }
    }
    startGenerationQueueWorker();
    startForgeAutoscaler();
  })();

  // ============================================
  // SCHEDULED NOTIFICATIONS (daily, with per-user throttles inside notifications.js)
  // ============================================
  const ONE_DAY = 24 * 60 * 60 * 1000;

  // Helper: send re-engagement to anonymous users (no account)
  const sendAnonymousReEngagement = async () => {
    try {
      // Get anonymous tokens that haven't been seen recently and were not pinged today.
      const result = await pool.query(
        `SELECT token FROM anonymous_push_tokens 
         WHERE last_seen_at < NOW() - INTERVAL '24 hours'
           AND (last_notified_at IS NULL OR last_notified_at < NOW() - INTERVAL '24 hours')
         LIMIT 100`
      );
      if (result.rows.length === 0) return;

      const messages = [
        { title: '🎮 Come back and play!', body: 'New games are waiting for you. Tap to play!' },
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
        await pool.query(
          `UPDATE anonymous_push_tokens
           SET last_notified_at = NOW()
           WHERE token = ANY($1::text[])`,
          [pushMessages.map(message => message.to)]
        );
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
      await notifications.sendTrendingGameSuggestions();
      await sendAnonymousReEngagement();
      console.log('[Scheduler] Re-engagement notifications sent');
    } catch (e) {
      console.error('[Scheduler] Error:', e);
    }
  }, ONE_DAY);

  // App Store / Google Play downloads for the admin site: checked every 30 minutes, fetched every 6 hours.
  setInterval(() => {
    maybeSyncStoreStats(pool).catch((e) => console.error('[StoreStats] error:', e.message));
  }, 30 * 60 * 1000);

  // New games push: checked every 15 minutes; announceNewGames itself only sends in the Lagos
  // evening, once a day, and only when games went live that day.
  setInterval(() => {
    announceNewGames(pool).catch((e) => console.error('[NewGamesPush] error:', e.message));
  }, 15 * 60 * 1000);

  if (process.env.RUN_NOTIFICATION_STARTUP_CHECK === 'true') {
    setTimeout(async () => {
      console.log('[Scheduler] Initial re-engagement check...');
      try {
        await notifications.sendDailyInactiveNotifications();
        await notifications.sendDailyRewardNotifications();
        await notifications.sendTrendingGameSuggestions();
        await sendAnonymousReEngagement();
      } catch (e) {
        console.error('[Scheduler] Initial run error:', e);
      }
    }, 10 * 60 * 1000);
  }
};

start().catch(console.error);
