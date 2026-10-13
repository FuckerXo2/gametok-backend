import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { decidePlatform } from './mobile-fit.js';

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

// Which inputs the game listens for. Recorded from addEventListener and on* handlers in every
// frame, so it sees what the game's own code (and its engine) registers.
const TOUCH_EVENTS = ['touchstart', 'touchend', 'touchmove', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click'];
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];
function recordInputListeners() {
  const seen = (window.__gtInputs = new Set());
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    try { seen.add(String(type).toLowerCase()); } catch (e) {}
    return add.call(this, type, ...rest);
  };
}
async function collectInputs(page) {
  const all = new Set();
  for (const frame of page.frames()) {
    const types = await frame.evaluate((names) => {
      const out = [...(window.__gtInputs || [])];
      const targets = [window, document, document.body, ...document.querySelectorAll('canvas')];
      for (const t of targets) for (const n of names) if (t && typeof t['on' + n] === 'function') out.push(n);
      return out;
    }, [...TOUCH_EVENTS, ...KEY_EVENTS]).catch(() => []);
    types.forEach((t) => all.add(t));
  }
  const inputs = [...all].filter((t) => TOUCH_EVENTS.includes(t) || KEY_EVENTS.includes(t)).sort();
  const controls = inputs.some((t) => TOUCH_EVENTS.includes(t)) ? 'touch'
    : inputs.some((t) => KEY_EVENTS.includes(t)) ? 'keyboard' : 'none';
  return { inputs, controls };
}

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
        // Keep cross-origin game iframes in this process so their downloads are counted.
        '--disable-features=site-per-process',
        '--window-size=1280,720'
      ]
    });

    const page = await browser.newPage();
    // When detecting, start upright like a phone in the feed.
    const isPortrait = detectOrientation || orientation === 'portrait';
    // Load it the way a phone does, so games that switch to touch controls on phones show it.
    await page.setUserAgent(PHONE_UA);
    await page.setViewport({
      width: isPortrait ? 400 : 720,
      height: isPortrait ? 720 : 420,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    await page.evaluateOnNewDocument(recordInputListeners);
    // setContent writes into the current blank page, which no "new document" hook reaches.
    await page.evaluate(recordInputListeners);
    let downloadBytes = html ? Buffer.byteLength(html, 'utf8') : 0;
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.loadingFinished', (e) => { downloadBytes += e.encodedDataLength || 0; });

    // Mute audio to avoid audio context noise during automated capture
    await page.evaluateOnNewDocument(() => {
      try {
        window.AudioContext = class extends (window.AudioContext || window.webkitAudioContext) {
          constructor() { super(); this.suspend(); }
        };
      } catch (e) {}
    });

    // Load time = until the game stops downloading. A game still loading at the timeout is
    // measured as the timeout and captured as it is, not dropped.
    const loadStart = Date.now();
    let loadMs;
    try {
      if (url) {
        console.log(`[Screenshot Engine] Navigating to URL: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
      } else {
        console.log(`[Screenshot Engine] Rendering HTML payload for: ${gameId}`);
        await page.setContent(html, { waitUntil: 'networkidle2', timeout: 25000 });
      }
      loadMs = Date.now() - loadStart;
    } catch (err) {
      if (err.name !== 'TimeoutError') throw err;
      loadMs = Date.now() - loadStart;
      console.warn(`[Screenshot Engine] ${gameId} still loading after ${loadMs} ms; capturing anyway`);
    }

    // Give Canvas / WebGL game loop 2.5 seconds to draw authentic graphics
    await new Promise((resolve) => setTimeout(resolve, 2500));

    let detectedOrientation = null;
    if (detectOrientation) {
      detectedOrientation = await measureOrientation(page).catch(() => null);
      if (detectedOrientation === 'landscape') {
        // Re-frame the thumbnail the way players will see it.
        await page.setViewport({ width: 720, height: 420, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // Capture WebP buffer
    const buffer = await page.screenshot({
      type: 'webp',
      quality: 75
    });

    // After the screenshot: tap once (past a "tap to start" screen) and let it load what follows.
    let fit = null;
    try {
      const vp = page.viewport();
      await page.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      fit = { bytes: downloadBytes, loadMs, ...(await collectInputs(page)) };
    } catch (e) {
      console.warn(`[Screenshot Engine] Mobile check failed for ${gameId}:`, e.message);
    }

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
      detectedOrientation,
      fit
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

    if (result && result.fit) {
      // Measured download wins over the uploaded size: it's what a phone actually fetches.
      const prev = game.mobile_check || {};
      const bytes = result.fit.bytes > 0 ? result.fit.bytes : (prev.bytes || null);
      const decision = decidePlatform({ choice: prev.choice || null, bytes, controls: result.fit.controls, loadMs: result.fit.loadMs });
      const check = {
        ...prev,
        bytes,
        bytesFrom: result.fit.bytes > 0 ? 'measured' : prev.bytesFrom || null,
        controls: result.fit.controls,
        loadMs: result.fit.loadMs,
        inputs: result.fit.inputs,
        reasons: decision.reasons,
        warnings: decision.warnings,
        checkedAt: new Date().toISOString()
      };
      await pool.query(
        'UPDATE games SET platform = $1, platform_source = $2, mobile_check = $3, file_size = COALESCE($4, file_size) WHERE id = $5',
        [decision.platform, decision.source, JSON.stringify(check), bytes ? Math.round(bytes) : null, game.id]);
      console.log(`[Screenshot Engine] ${game.id}: ${decision.platform} (${result.fit.controls}, ${bytes || '?'} bytes)`);
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
