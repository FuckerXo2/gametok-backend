#!/usr/bin/env node
// Upload (or locally stage) Kenney 2D sprites to R2 under the `kenney2d/` prefix, keyed exactly as
// kenney2d-catalog.json expects. Mirrors scripts/upload-kenney3d-r2.mjs.
//
// Env for R2 upload: R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
//
// Usage:
//   node scripts/upload-kenney2d-r2.mjs --theme racing            # only racing-themed assets
//   node scripts/upload-kenney2d-r2.mjs --all                     # everything (~36k)
//   node scripts/upload-kenney2d-r2.mjs --theme racing --local ./storage/kenney2d-cdn/assets
//                                                                 # copy into local dir, no R2/creds
//   node scripts/upload-kenney2d-r2.mjs --all --force             # re-upload even if present

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PACK_ROOT = process.env.KENNEY2D_ROOT
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '2D assets');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json'), 'utf8'));
const themeFilter = valOf('--theme');
const localDir = valOf('--local');
const force = has('--force');

let targets = catalog.assets;
if (!has('--all') && themeFilter) targets = targets.filter((a) => (a.theme || []).includes(themeFilter));
if (!has('--all') && !themeFilter && !localDir) { console.error('Specify --theme <t>, --all, or --local <dir>.'); process.exit(1); }
if (targets.length === 0) { console.error('No assets matched.'); process.exit(1); }

const keyOf = (a) => a.url.replace(R2_BASE, '');            // kenney2d/<pack>/<...>.png
const srcOf = (a) => path.join(PACK_ROOT, a.localPath);

// ── LOCAL STAGE MODE (no creds): copy files into <dir>/<key> for a local CDN server ──
if (localDir) {
  let copied = 0, missing = 0;
  for (const a of targets) {
    const src = srcOf(a);
    if (!fs.existsSync(src)) { missing += 1; continue; }
    const dest = path.join(localDir, keyOf(a));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied += 1;
  }
  console.log(`[kenney2d-local] staged ${copied} files under ${localDir} (${missing} missing). Serve that dir's parent so /assets/kenney2d/... resolves.`);
  process.exit(0);
}

// ── R2 UPLOAD MODE ──
for (const v of ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) { console.error(`Missing env ${v}. Set the R2_* vars and retry (or use --local <dir>).`); process.exit(1); }
}
const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const Bucket = process.env.R2_BUCKET_NAME;
async function exists(Key) { try { await client.send(new HeadObjectCommand({ Bucket, Key })); return true; } catch { return false; } }

const CONCURRENCY = Number(valOf('--concurrency')) || 50; // parallel workers; overlaps the R2 round-trips
console.log(`[kenney2d-r2] uploading ${targets.length} sprites (${themeFilter || 'ALL'}) to ${Bucket}/kenney2d/ with ${CONCURRENCY} workers`);
let up = 0, skipped = 0, missing = 0, done = 0;
async function handle(a) {
  const Key = `assets/${keyOf(a)}`;           // bucket layout mirrors phaser: assets/<...>
  const src = srcOf(a);
  if (!fs.existsSync(src)) { missing += 1; return; }
  if (!force && await exists(Key)) { skipped += 1; return; }
  await client.send(new PutObjectCommand({
    Bucket, Key, Body: fs.readFileSync(src),
    ContentType: 'image/png', CacheControl: 'public, max-age=31536000, immutable',
  }));
  up += 1;
}
// Fixed pool of workers pulling from a shared cursor — keeps CONCURRENCY requests in flight.
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const a = targets[cursor++];
    try { await handle(a); } catch (e) { console.warn(`  ! ${keyOf(a)}: ${e.message}`); }
    if (++done % 500 === 0) console.log(`  …${done}/${targets.length} processed (${up} up, ${skipped} present)`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`[kenney2d-r2] done: ${up} uploaded, ${skipped} present, ${missing} missing.`);
console.log(`[kenney2d-r2] sample URL: ${targets[0].url}`);
