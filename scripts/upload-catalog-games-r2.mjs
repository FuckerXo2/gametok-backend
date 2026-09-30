#!/usr/bin/env node
/**
 * Upload all catalog game folders from gametok-games/ to R2.
 * Usage:
 *   node scripts/upload-catalog-games-r2.mjs
 *   node scripts/upload-catalog-games-r2.mjs --game whack-a-mole
 *   node scripts/upload-catalog-games-r2.mjs --force
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = process.env.GAMES_ROOT || path.resolve(__dirname, '../../../gametok-games');
const BUCKET = process.env.R2_BUCKET_NAME;
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const FORCE = has('--force');
const DRY_RUN = has('--dry-run');
const SINGLE_GAME = valOf('--game');

const CATALOG_GAMES = [
  'tower-blocks-3d','flappy-bird','fruit-slicer','tetris','snake-io',
  'doodle-jump','piano-tiles','crossy-road','geometry-dash','tap-tap-dash',
  'towermaster','ball-bounce','2048','block-blast','color-match',
  'simon-says','memory-match','bubble-pop','whack-a-mole','breakout',
  'pong','tic-tac-toe','connect4','rock-paper-scissors','number-tap',
];
const GAMES_TO_UPLOAD = SINGLE_GAME ? [SINGLE_GAME] : CATALOG_GAMES;

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
    '.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml',
    '.webp':'image/webp','.mp3':'audio/mpeg','.ogg':'audio/ogg',
    '.wav':'audio/wav','.mp4':'video/mp4','.woff':'font/woff',
    '.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon',
    '.txt':'text/plain','.md':'text/markdown',
  };
  return map[ext] || 'application/octet-stream';
}

function collectFiles(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full, base));
    else results.push({ full, rel: path.relative(base, full) });
  }
  return results;
}

if (!DRY_RUN) {
  for (const v of ['R2_BUCKET_NAME','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) {
    if (!process.env[v]) { console.error(`Missing env: ${v}`); process.exit(1); }
  }
}

const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
const client = DRY_RUN ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

let totalUploaded = 0, totalSkipped = 0, totalMissing = 0, totalFailed = 0;

for (const gameId of GAMES_TO_UPLOAD) {
  const gameDir = path.join(GAMES_ROOT, gameId);
  if (!fs.existsSync(gameDir)) {
    console.log(`⚠️  [${gameId}] not found locally — skipping`);
    totalMissing++; continue;
  }
  const files = collectFiles(gameDir);
  console.log(`\n📦 [${gameId}] — ${files.length} files`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const { full, rel } of files) {
    const r2Key = `${gameId}/${rel}`;
    const contentType = mimeType(full);
    if (DRY_RUN) { console.log(`  [dry] ${r2Key}`); uploaded++; continue; }
    if (!FORCE) {
      try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key })); process.stdout.write('.'); skipped++; continue; }
      catch {}
    }
    try {
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: fs.readFileSync(full), ContentType: contentType }));
      process.stdout.write('↑'); uploaded++;
    } catch (err) { console.error(`\n  ✗ ${r2Key}: ${err.message}`); failed++; }
  }
  console.log(`\n  ✓ uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
  totalUploaded += uploaded; totalSkipped += skipped; totalFailed += failed;
}

console.log(`\n🎉 Done! uploaded=${totalUploaded} already_present=${totalSkipped} missing_locally=${totalMissing} failed=${totalFailed}`);
