import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import pg from 'pg';
import puppeteer from 'puppeteer';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const publicPreviewDir = path.join(repoRoot, 'public/game-previews');
const tmpRoot = process.env.PREVIEW_CAPTURE_TMP || '/tmp/gametok-preview-capture';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL || 'https://gametok-backend-production.up.railway.app').replace(/\/$/, '');
const limit = Number(process.env.PREVIEW_CAPTURE_LIMIT || 20);
const seconds = Number(process.env.PREVIEW_CAPTURE_SECONDS || 4);
const fps = Number(process.env.PREVIEW_CAPTURE_FPS || 6);
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function assertFfmpegAvailable() {
  const result = spawnSync(ffmpegBin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error('ffmpeg is not available. Install ffmpeg or set FFMPEG_PATH before running preview video capture.');
  }
}

async function ensurePreviewColumns(client) {
  await client.query(`
    ALTER TABLE ai_games ADD COLUMN IF NOT EXISTS preview_video_url TEXT;
    ALTER TABLE games ADD COLUMN IF NOT EXISTS preview_video_url TEXT;
  `);
}

async function captureFrames(page, frameDir) {
  const frameCount = Math.max(1, Math.round(seconds * fps));
  const frameDelay = Math.max(1, Math.round(1000 / fps));

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (frame > 0) {
      await new Promise((resolve) => setTimeout(resolve, frameDelay));
    }

    // Nudge simple interactive games so static first frames still show a bit of life.
    if (frame === Math.floor(frameCount / 3)) {
      try {
        await page.mouse.move(200, 360);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(230, 420, { steps: 8 });
        await page.mouse.up({ button: 'left' });
      } catch {
        // Interaction is best-effort; capture should continue.
      }
    }

    const filename = path.join(frameDir, `frame_${String(frame).padStart(4, '0')}.png`);
    await page.screenshot({ path: filename, type: 'png' });
  }
}

function encodeMp4(frameDir, outputPath) {
  const result = spawnSync(
    ffmpegBin,
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(frameDir, 'frame_%04d.png'),
      '-vf',
      'scale=390:-2:flags=lanczos',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'ffmpeg failed to encode preview video');
  }
}

async function main() {
  assertFfmpegAvailable();
  await fs.mkdir(publicPreviewDir, { recursive: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  const client = await pool.connect();
  let browser = null;

  try {
    await ensurePreviewColumns(client);

    const drafts = await client.query(
      `
        SELECT id, title, html_payload
        FROM ai_games
        WHERE html_payload IS NOT NULL
          AND html_payload != ''
          AND (preview_video_url IS NULL OR preview_video_url = '')
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    console.log(`Found ${drafts.rowCount} generated games needing preview videos.`);
    if (drafts.rowCount === 0) return;

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-gl=swiftshader',
        '--use-angle=swiftshader-webgl',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--ignore-certificate-errors',
      ],
    });

    for (let index = 0; index < drafts.rows.length; index += 1) {
      const draft = drafts.rows[index];
      const safeId = String(draft.id).replace(/[^a-z0-9-]/gi, '');
      const frameDir = path.join(tmpRoot, safeId);
      const outputPath = path.join(publicPreviewDir, `${safeId}.mp4`);
      const previewUrl = `${publicBaseUrl}/game-previews/${safeId}.mp4`;
      let page = null;

      console.log(`[${index + 1}/${drafts.rowCount}] Capturing preview: ${draft.title || 'Untitled'} (${draft.id})`);

      try {
        await fs.rm(frameDir, { recursive: true, force: true });
        await fs.mkdir(frameDir, { recursive: true });

        page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent(draft.html_payload, { waitUntil: 'load', timeout: 15000 });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await captureFrames(page, frameDir);
        encodeMp4(frameDir, outputPath);

        await client.query(
          `
            UPDATE ai_games
            SET preview_video_url = $1
            WHERE id = $2
          `,
          [previewUrl, draft.id],
        );

        await client.query(
          `
            UPDATE games
            SET preview_video_url = $1
            WHERE embed_url = $2
          `,
          [previewUrl, `/api/ai/play/${draft.id}`],
        );

        console.log(`✅ Preview saved: ${previewUrl}`);
      } catch (error) {
        console.error(`❌ Preview failed for ${draft.id}:`, error.message);
      } finally {
        if (page) await page.close().catch(() => {});
        await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Preview video backfill failed:', error);
  process.exit(1);
});
