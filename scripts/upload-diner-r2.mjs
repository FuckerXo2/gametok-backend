#!/usr/bin/env node
// Upload (or locally stage) the sliced 50s Diner assets to R2 under the `diner/` prefix, keyed
// exactly as diner-catalog.json expects. Mirrors scripts/upload-kenney2d-r2.mjs.
//
// Env for R2 upload: R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
//
// Usage:
//   node scripts/upload-diner-r2.mjs --all                                  # upload all 135
//   node scripts/upload-diner-r2.mjs --local ./storage/kenney2d-cdn/assets  # local stage, no creds

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SLICED_ROOT = path.resolve(repoRoot, '..', '50s_Diner', 'sliced');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'ai-engine', 'diner-catalog.json'), 'utf8'));
const localDir = valOf('--local');
const force = has('--force');

if (!has('--all') && !localDir) { console.error('Specify --all or --local <dir>.'); process.exit(1); }
const targets = catalog.assets;

const keyOf = (a) => a.url.replace(R2_BASE, '');           // diner/<furniture|walltiles>/<file>.png
const srcOf = (a) => path.join(SLICED_ROOT, a.localPath);

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
  console.log(`[diner-local] staged ${copied} files under ${localDir} (${missing} missing).`);
  process.exit(0);
}

for (const v of ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) { console.error(`Missing env ${v}. Set the R2_* vars and retry (or use --local <dir>).`); process.exit(1); }
}
const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

let uploaded = 0, skipped = 0, missing = 0, failed = 0;
for (const a of targets) {
  const src = srcOf(a);
  if (!fs.existsSync(src)) { missing += 1; continue; }
  const key = 'assets/' + keyOf(a);
  if (!force) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
      skipped += 1;
      continue;
    } catch { /* not present, upload it */ }
  }
  try {
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: fs.readFileSync(src), ContentType: 'image/png',
    }));
    uploaded += 1;
  } catch (err) {
    console.error(`✗ ${key}: ${err.message}`);
    failed += 1;
  }
}
console.log(`✅ diner upload: ${uploaded} uploaded, ${skipped} already present, ${missing} missing locally, ${failed} failed`);
