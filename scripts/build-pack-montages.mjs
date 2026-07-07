#!/usr/bin/env node
// Generalized version of build-iso-nature-montages.mjs: contact-sheet the UNIQUE visual items in any
// Kenney 2D pack (exact-byte dedupe — collapses literal duplicate tiles like blank/padding slices,
// keeps every visually distinct sprite/frame) so a vision model can name each in a handful of reads.
//
// Usage: node scripts/build-pack-montages.mjs --pack "Roguelike City Pack" [--cols 8] [--rows 8] [--cell 90]

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PACK_ROOT = process.env.KENNEY2D_ROOT
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '2D assets');

const args = process.argv.slice(2);
const valOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PACK = valOf('--pack');
if (!PACK) { console.error('Usage: --pack "<Pack Name>"'); process.exit(1); }
const COLS = Number(valOf('--cols', 8));
const ROWS = Number(valOf('--rows', 8));
const CELL = Number(valOf('--cell', 90));
const PAD = 22;

const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const packSlug = slugOf(PACK);
const OUT = `/private/tmp/claude-501/-Users-abiolalimitless-gameidea/scratchpad/pack-montages/${packSlug}`;

const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json'), 'utf8'));
const inPack = catalog.assets.filter((a) => a.pack === PACK && a.role !== 'atlas');
if (!inPack.length) { console.error(`No assets found for pack "${PACK}"`); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });

// Exact-byte-hash dedupe: collapse literal duplicate tiles (blank/padding slices repeated across a
// tilemap), keep every visually distinct sprite. One representative per hash; all sharers get labeled
// from that representative's caption in the apply step.
const byHash = new Map(); // hash -> { asset, members: [asset,...] }
let missing = 0;
for (const a of inPack) {
  const p = path.join(PACK_ROOT, a.localPath);
  let buf;
  try { buf = fs.readFileSync(p); } catch { missing++; continue; }
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (!byHash.has(hash)) byHash.set(hash, { asset: a, members: [] });
  byHash.get(hash).members.push(a.id);
}
const reps = [...byHash.entries()].map(([hash, v], i) => ({ hash, idx: i, asset: v.asset, members: v.members }));
fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(reps.map((r) => ({ idx: r.idx, hash: r.hash, localPath: r.asset.localPath, members: r.members })), null, 0));

function checker(size) {
  const s = 10; let r = '';
  for (let y = 0; y < size; y += s) for (let x = 0; x < size; x += s) if (((x / s) + (y / s)) % 2 === 0) r += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#c8c8c8"/>`;
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="100%" height="100%" fill="#e8e8e8"/>${r}</svg>`);
}
async function cell(rep) {
  const full = CELL + PAD; const layers = [];
  layers.push({ input: await sharp(checker(CELL)).png().toBuffer(), top: PAD, left: 0 });
  try {
    const img = await sharp(path.join(PACK_ROOT, rep.asset.localPath)).resize(CELL - 6, CELL - 6, { fit: 'inside' }).toBuffer();
    const meta = await sharp(img).metadata();
    layers.push({ input: img, top: PAD + 3 + Math.floor((CELL - 6 - meta.height) / 2), left: 3 + Math.floor((CELL - 6 - meta.width) / 2) });
  } catch {}
  layers.push({ input: Buffer.from(`<svg width="${full}" height="${PAD}"><rect width="100%" height="100%" fill="#111"/><text x="4" y="16" font-family="monospace" font-size="13" fill="#0f0">#${rep.idx}</text></svg>`), top: 0, left: 0 });
  return sharp({ create: { width: full, height: full, channels: 4, background: '#fff' } }).composite(layers).png().toBuffer();
}

const PER = COLS * ROWS;
let sheet = 0;
for (let s = 0; s < reps.length; s += PER) {
  const chunk = reps.slice(s, s + PER);
  const cells = [];
  for (const rep of chunk) cells.push(await cell(rep));
  const full = CELL + PAD;
  const comp = cells.map((buf, j) => ({ input: buf, top: Math.floor(j / COLS) * full, left: (j % COLS) * full }));
  await sharp({ create: { width: COLS * full, height: ROWS * full, channels: 4, background: '#fff' } })
    .composite(comp).png().toFile(path.join(OUT, `sheet-${sheet}.png`));
  sheet++;
}

console.log(`✅ ${PACK}: ${inPack.length} assets → ${reps.length} unique (${missing} missing on disk) → ${sheet} sheets`);
console.log(`   ${OUT}`);
