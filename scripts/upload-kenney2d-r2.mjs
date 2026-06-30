#!/usr/bin/env node
// Upload Kenney 2D sprites to R2 under the `kenney2d/` prefix, keyed by catalog id.
//
// Reads the committed split catalog (kenney2d/pack-index.json + packs/<pack>.json) and pushes each
// sprite's PNG/SVG (from the local, uncommitted bundle) to R2. Keys are deterministic:
// kenney2d/<id>.<ext> — so the materializer derives the URL from the catalog id with no extra mapping.
// Idempotent: skips objects already present unless --force.
//
// Env (same as the backend / Railway): R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
//   R2_SECRET_ACCESS_KEY, optional R2_PUBLIC_URL. Bundle path: arg[0] or KENNEY_PACK env.
//
// Usage:
//   node scripts/upload-kenney2d-r2.mjs                              # starter subset (a few key packs)
//   node scripts/upload-kenney2d-r2.mjs --packs "Topdown Shooter,UI Pack"
//   node scripts/upload-kenney2d-r2.mjs --all                        # everything (~28.8k sprites, ~354MB)
//   node scripts/upload-kenney2d-r2.mjs --force                      # re-upload even if present

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

for (const v of ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) { console.error(`Missing env ${v}. Set the R2_* vars (same as the backend) and retry.`); process.exit(1); }
}

const bundleDir = (args[0] && !args[0].startsWith('--') ? args[0] : null)
  || process.env.KENNEY_PACK
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3');
if (!fs.existsSync(bundleDir)) { console.error(`Bundle dir not found: ${bundleDir}`); process.exit(1); }

const catalogDir = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'pack-index.json'), 'utf8'));

const STARTER_PACKS = ['Topdown Shooter', 'Toon Characters', 'UI Pack'];
const packFilter = has('--all') ? null
  : (valOf('--packs') ? valOf('--packs').split(',').map((s) => s.trim()) : STARTER_PACKS);
const force = has('--force');

// Gather sprites from the per-pack manifests for the selected packs.
const targets = [];
for (const p of index.packs) {
  if (packFilter && !packFilter.includes(p.pack)) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(catalogDir, 'packs', `${p.packId}.json`), 'utf8'));
  for (const s of manifest.sprites) targets.push(s);
}
if (targets.length === 0) { console.error('No sprites matched the pack filter.'); process.exit(1); }

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const Bucket = process.env.R2_BUCKET_NAME;
const publicBase = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
const contentType = (ext) => (ext === 'svg' ? 'image/svg+xml' : 'image/png');

async function exists(Key) {
  try { await client.send(new HeadObjectCommand({ Bucket, Key })); return true; } catch { return false; }
}

console.log(`[kenney2d-r2] uploading ${targets.length} sprites (${packFilter ? packFilter.join(', ') : 'ALL packs'}) to ${Bucket}/kenney2d/`);
let up = 0; let skipped = 0; let missing = 0;
for (const s of targets) {
  const Key = `kenney2d/${s.id}.${s.ext}`;
  const src = path.join(bundleDir, s.rel);
  if (!fs.existsSync(src)) { missing += 1; if (missing <= 10) console.warn(`  ! missing in bundle: ${s.rel}`); continue; }
  if (!force && await exists(Key)) { skipped += 1; continue; }
  await client.send(new PutObjectCommand({
    Bucket, Key,
    Body: fs.readFileSync(src),
    ContentType: contentType(s.ext),
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  up += 1;
  if (up % 100 === 0) console.log(`  …${up} uploaded`);
}
console.log(`[kenney2d-r2] done: ${up} uploaded, ${skipped} already present, ${missing} missing.`);
console.log(`[kenney2d-r2] sample URL: ${publicBase}/kenney2d/${targets[0].id}.${targets[0].ext}`);
