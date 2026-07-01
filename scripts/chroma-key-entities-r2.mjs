#!/usr/bin/env node
// Chroma-key opaque ENTITY sprites (character/enemy/projectile/item) to transparent, and re-upload
// them to R2 over the same key. Some Kenney packs ship opaque sprites with a flat baked background
// (e.g. Monochrome RPG Tileset, Voxel Pack) — they render as a solid colored box around the sprite.
// Tiles are left alone (they're meant to be opaque). Flood-fill-from-edges removes ONLY a uniform
// border background, so interior same-colored pixels are never touched.
//
// Usage:
//   node scripts/chroma-key-entities-r2.mjs --dry-run           # process locally to ./tmp-keyed, no upload
//   railway run node scripts/chroma-key-entities-r2.mjs         # key + upload (overwrites R2 keys)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const bundleDir = process.env.KENNEY_PACK || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3');
const catalogDir = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'pack-index.json'), 'utf8'));
const ROLES = new Set(['character', 'enemy', 'projectile']); // real free-standing entities (not props/tiles/doors miscat'd as items)
const TRNS = Buffer.from('tRNS');

function isOpaquePng(abs) {
  try {
    const b = fs.readFileSync(abs);
    if (b.length < 26) return false;
    const c = b[25];
    if (c === 4 || c === 6) return false;
    if (c === 0 || c === 2) return true;
    if (c === 3) return !b.includes(TRNS);
    return true;
  } catch { return false; }
}

// Remove a uniform edge-connected background; never touches interior pixels of the same color.
async function chromaKey(inputPath, { tol = 28 } = {}) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const at = (x, y) => (y * W + x) * 4;
  const px = (x, y) => [data[at(x, y)], data[at(x, y) + 1], data[at(x, y) + 2], data[at(x, y) + 3]];
  const match = (a, b) => a[3] > 8 && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => px(x, y));
  if (!corners.every((c) => match(c, corners[0]))) return null; // no uniform bg → leave it alone
  const bg = corners[0];
  const visited = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y++) stack.push([0, y], [W - 1, y]);
  let cleared = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (visited[p] || !match(px(x, y), bg)) continue;
    visited[p] = 1; data[at(x, y) + 3] = 0; cleared++;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  if (cleared === 0) return null;
  // Erase-guard: if almost nothing visible remains, this was a solid shape wrongly treated as all
  // background (e.g. a plain door/block). Never ship an invisible sprite.
  let remaining = 0;
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] > 8) remaining += 1;
  if (remaining < Math.max(12, Math.floor(0.04 * W * H))) return null;
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

const targets = [];
for (const p of index.packs) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(catalogDir, 'packs', `${p.packId}.json`), 'utf8')); } catch { continue; }
  for (const s of m.sprites || []) {
    if (!ROLES.has(s.category) || s.ext === 'svg') continue;
    const abs = path.join(bundleDir, s.rel);
    if (fs.existsSync(abs) && isOpaquePng(abs)) targets.push({ ...s, abs });
  }
}
console.log(`[chroma] ${targets.length} opaque entity sprites to process (dryRun=${dryRun})`);

let client = null, Bucket = null;
if (!dryRun) {
  for (const v of ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
    if (!process.env[v]) { console.error(`Missing env ${v} — run via 'railway run'.`); process.exit(1); }
  client = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  Bucket = process.env.R2_BUCKET_NAME;
}
const outDir = path.join(repoRoot, 'tmp-keyed');
if (dryRun) fs.mkdirSync(outDir, { recursive: true });

let keyed = 0, skipped = 0, uploaded = 0;
for (const s of targets) {
  const buf = await chromaKey(s.abs).catch(() => null);
  if (!buf) { skipped += 1; continue; }
  keyed += 1;
  if (dryRun) { fs.writeFileSync(path.join(outDir, `${s.id.replace(/\//g, '__')}.png`), buf); continue; }
  const Key = `kenney2d/${s.id}.${s.ext}`;
  await client.send(new PutObjectCommand({ Bucket, Key, Body: buf, ContentType: 'image/png',
    CacheControl: 'public, max-age=3600' })); // not immutable — allow reprocessed sprites to propagate
  uploaded += 1;
  if (uploaded % 25 === 0) console.log(`  …${uploaded} uploaded`);
}
console.log(`[chroma] done: ${keyed} keyed, ${skipped} skipped (no uniform bg)${dryRun ? ` → ${outDir}` : `, ${uploaded} uploaded`}`);
