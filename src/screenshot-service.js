import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const THUMBNAIL_DIR = path.join(__dirname, '../public/thumbnails');

if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

// Optional Cloudflare R2 Client setup
let r2Client = null;
if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Capture an authentic in-game screenshot from an external URL or HTML payload.
 * Runs in headless Chromium via Puppeteer.
 */
// Measure which way the game is drawn, in a portrait phone-sized viewport. Uses the largest
// <canvas>: its own pixel size if set (a fixed 1280x720 game is landscape however it's scaled),
// else its on-screen size. A game that fills the portrait viewport comes out portrait.
// Returns 'portrait' | 'landscape' | null (no canvas / square-ish: inconclusive).
async function measureOrientation(page) {
  return page.evaluate(() => {
    const viewportArea = window.innerWidth * window.innerHeight;
    let best = null;
    for (const el of document.querySelectorAll('canvas')) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > (best ? best.area : 0)) best = { area, w: r.width, h: r.height, iw: el.width, ih: el.height };
    }
    if (!best || best.area < viewportArea * 0.1) return null;
    const ratio = best.iw > 0 && best.ih > 0 ? best.iw / best.ih : best.w / best.h;
    if (ratio >= 1.25) return 'landscape';
    if (ratio <= 0.85) return 'portrait';
    return null;
  });
}

export async function captureGameScreenshot({ gameId, url, html, orientation = 'landscape', detectOrientation = false }) {
  if (!url && !html) {
    throw new Error('Either url or html is required for screenshot capture');
  }

  let browser = null;
  try {
    console.log(`[Screenshot Engine] Launching Chromium for game: ${gameId}...`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--window-size=1280,720'
      ]
    });

    const page = await browser.newPage();
    // When detecting, start upright like a phone in the feed.
    const isPortrait = detectOrientation || orientation === 'portrait';
    await page.setViewport({
      width: isPortrait ? 400 : 720,
      height: isPortrait ? 720 : 420,
      deviceScaleFactor: 1
    });

    // Mute audio to avoid audio context noise during automated capture
    await page.evaluateOnNewDocument(() => {
      try {
        window.AudioContext = class extends (window.AudioContext || window.webkitAudioContext) {
          constructor() { super(); this.suspend(); }
        };
      } catch (e) {}
    });

    if (url) {
      console.log(`[Screenshot Engine] Navigating to URL: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    } else {
      console.log(`[Screenshot Engine] Rendering HTML payload for: ${gameId}`);
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    }

    // Give Canvas / WebGL game loop 2.5 seconds to draw authentic graphics
    await new Promise((resolve) => setTimeout(resolve, 2500));

    let detectedOrientation = null;
    if (detectOrientation) {
      detectedOrientation = await measureOrientation(page).catch(() => null);
      if (detectedOrientation === 'landscape') {
        // Re-frame the thumbnail the way players will see it.
        await page.setViewport({ width: 720, height: 420, deviceScaleFactor: 1 });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // Capture WebP buffer
    const buffer = await page.screenshot({
      type: 'webp',
      quality: 75
    });

    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeId}.webp`;
    const localFilePath = path.join(THUMBNAIL_DIR, filename);

    // Save locally to public/thumbnails/
    fs.writeFileSync(localFilePath, buffer);
    console.log(`[Screenshot Engine] Saved local screenshot to: ${localFilePath}`);

    // Served by this backend's /games/thumbnails static route (gametok.co itself doesn't serve it).
    // Cloud Run disks are ephemeral, so this local URL is only a fallback for when R2 isn't configured.
    const apiBase = process.env.PUBLIC_API_URL || 'https://gametok-backend-267787411422.us-central1.run.app';
    let publicUrl = `${apiBase}/games/thumbnails/${filename}`;

    // Upload to Cloudflare R2 if available
    if (r2Client && process.env.R2_BUCKET_NAME) {
      try {
        const key = `thumbnails/${filename}`;
        await r2Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000'
        }));
        const publicDomain = process.env.R2_PUBLIC_DOMAIN || 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';
        publicUrl = `${publicDomain}/${key}`;
        console.log(`[Screenshot Engine] Uploaded to R2: ${publicUrl}`);
      } catch (uploadErr) {
        console.warn('[Screenshot Engine] R2 upload failed, using local URL:', uploadErr.message);
      }
    }

    return {
      success: true,
      thumbnailUrl: publicUrl,
      localFilePath,
      detectedOrientation
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Capture screenshot for a database game row and update games.thumbnail
 */
export async function autoCaptureGameThumbnail(gameId, pool) {
  try {
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
    if (gameRes.rows.length === 0) {
      throw new Error(`Game not found: ${gameId}`);
    }
    const game = gameRes.rows[0];
    const targetUrl = game.embed_url;
    const htmlPayload = game.script_payload;
    const orientation = game.orientation || 'portrait';
    // Measure only games published without a choice ('default'). Older games (no source recorded)
    // keep whatever orientation they already have.
    const detectOrientation = game.orientation_source === 'default';

    if (!targetUrl && !htmlPayload) {
      console.warn(`[Screenshot Engine] No embed_url or script_payload for game: ${gameId}`);
      return null;
    }

    const result = await captureGameScreenshot({
      gameId: game.id,
      url: targetUrl,
      html: htmlPayload,
      orientation,
      detectOrientation
    });

    if (detectOrientation && result && result.detectedOrientation) {
      await pool.query(
        `UPDATE games SET orientation = $1, orientation_source = 'detected'
         WHERE id = $2 AND orientation_source = 'default'`,
        [result.detectedOrientation, game.id]);
      console.log(`[Screenshot Engine] Detected ${result.detectedOrientation} for ${game.id}`);
    }

    if (result && result.thumbnailUrl) {
      await pool.query('UPDATE games SET thumbnail = $1 WHERE id = $2', [result.thumbnailUrl, game.id]);
      console.log(`[Screenshot Engine] ✓ Updated thumbnail for "${game.name}" (${game.id}) -> ${result.thumbnailUrl}`);
      return result.thumbnailUrl;
    }
  } catch (err) {
    console.warn(`[Screenshot Engine] Failed capturing screenshot for ${gameId}:`, err.message);
    return null;
  }
}
