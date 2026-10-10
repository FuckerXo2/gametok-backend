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
export async function captureGameScreenshot({ gameId, url, html, orientation = 'landscape' }) {
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
    const isPortrait = orientation === 'portrait';
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

    const apiBase = process.env.PUBLIC_API_URL || 'https://gametok.co';
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
      localFilePath
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
    const orientation = game.orientation || 'landscape';

    if (!targetUrl && !htmlPayload) {
      console.warn(`[Screenshot Engine] No embed_url or script_payload for game: ${gameId}`);
      return null;
    }

    const result = await captureGameScreenshot({
      gameId: game.id,
      url: targetUrl,
      html: htmlPayload,
      orientation
    });

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
