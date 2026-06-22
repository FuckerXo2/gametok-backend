#!/usr/bin/env node
// Upload Kenney 3D GLB models to R2 under the `kenney3d/` prefix, keyed by catalog id.
//
// Reads kenney3d-catalog.json (the committed index) and pushes each model's GLB (from the local,
// uncommitted pack) to R2. Keys are deterministic: kenney3d/<id>.glb — so the materializer later
// derives the URL from the catalog id with no extra mapping. Idempotent: skips objects already there.
//
// Env (same as the backend / Railway): R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
//   R2_SECRET_ACCESS_KEY, optional R2_PUBLIC_URL. Pack path: arg[2] or KENNEY_PACK env.
//
// Usage:
//   node scripts/upload-kenney3d-r2.mjs                       # starter subset: Car Kit + Road Pack
//   node scripts/upload-kenney3d-r2.mjs --kits "Nature Kit,City Kit - Roads"
//   node scripts/upload-kenney3d-r2.mjs --all                 # everything (4,885 models)
//   node scripts/upload-kenney3d-r2.mjs --force               # re-upload even if present

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

const packDir = (args[0] && !args[0].startsWith('--') ? args[0] : null)
  || process.env.KENNEY_PACK
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '3D assets');
if (!fs.existsSync(packDir)) { console.error(`Pack dir not found: ${packDir}`); process.exit(1); }

const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'ai-engine', 'kenney3d-catalog.json'), 'utf8'));

const STARTER_KITS = ['Car Kit', 'Road Pack'];
const kitFilter = has('--all') ? null
  : (valOf('--kits') ? valOf('--kits').split(',').map((s) => s.trim()) : STARTER_KITS);
const force = has('--force');

const targets = catalog.models.filter((m) => !kitFilter || kitFilter.includes(m.kit));
if (targets.length === 0) { console.error('No models matched the kit filter.'); process.exit(1); }

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const Bucket = process.env.R2_BUCKET_NAME;
const publicBase = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');

async function exists(Key) {
  try { await client.send(new HeadObjectCommand({ Bucket, Key })); return true; } catch { return false; }
}

console.log(`[kenney3d-r2] uploading ${targets.length} models (${kitFilter ? kitFilter.join(', ') : 'ALL kits'}) to ${Bucket}/kenney3d/`);
let up = 0; let skipped = 0; let missing = 0;
for (const m of targets) {
  const Key = `kenney3d/${m.id}.glb`;
  const src = path.join(packDir, m.rel);
  if (!fs.existsSync(src)) { missing += 1; console.warn(`  ! missing in pack: ${m.rel}`); continue; }
  if (!force && await exists(Key)) { skipped += 1; continue; }
  await client.send(new PutObjectCommand({
    Bucket, Key,
    Body: fs.readFileSync(src),
    ContentType: 'model/gltf-binary',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  up += 1;
  if (up % 25 === 0) console.log(`  …${up} uploaded`);
}
console.log(`[kenney3d-r2] done: ${up} uploaded, ${skipped} already present, ${missing} missing.`);
console.log(`[kenney3d-r2] sample URL: ${publicBase}/kenney3d/${targets[0].id}.glb`);
