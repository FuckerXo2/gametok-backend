#!/usr/bin/env node
// Contact-sheet ONE representative per unique Isometric Nature item (ignoring the 4 rotations) so a
// vision model can name each (pine tree / rock / bush / grass tile...) in ~8 reads instead of 752.
// Manifest maps index -> item number so captions apply to all rotations of that item.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PACK_ROOT = path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '2D assets');
const OUT = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/iso-nature';
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json'), 'utf8'));

const nature = catalog.assets.filter((a) => a.pack === 'Isometric Nature');
const repByItem = new Map(); // itemNum -> asset (prefer lowest rotation)
for (const a of nature) {
  const m = (a.localPath || '').match(/naturepack_(\d+)_(\d+)/i);
  const item = m ? m[1] : a.localPath;
  const rot = m ? Number(m[2]) : 0;
  const cur = repByItem.get(item);
  if (!cur || rot < cur.rot) repByItem.set(item, { asset: a, rot });
}
const reps = [...repByItem.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([item, v]) => ({ item, asset: v.asset }));

fs.mkdirSync(OUT, { recursive: true });
const CELL = 150, PAD = 26, COLS = 6, ROWS = 5, PER = COLS * ROWS;

function checker(size) {
  const s = 10; let r = '';
  for (let y = 0; y < size; y += s) for (let x = 0; x < size; x += s) if (((x / s) + (y / s)) % 2 === 0) r += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#c8c8c8"/>`;
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="100%" height="100%" fill="#e8e8e8"/>${r}</svg>`);
}
async function cell(rep, idx) {
  const full = CELL + PAD; const layers = [];
  layers.push({ input: await sharp(checker(CELL)).png().toBuffer(), top: PAD, left: 0 });
  try {
    const img = await sharp(path.join(PACK_ROOT, rep.asset.localPath)).resize(CELL, CELL, { fit: 'inside' }).toBuffer();
    const meta = await sharp(img).metadata();
    layers.push({ input: img, top: PAD + Math.floor((CELL - meta.height) / 2), left: Math.floor((CELL - meta.width) / 2) });
  } catch {}
  layers.push({ input: Buffer.from(`<svg width="${full}" height="${PAD}"><rect width="100%" height="100%" fill="#111"/><text x="4" y="19" font-family="monospace" font-size="16" fill="#0f0">#${idx} it${rep.item}</text></svg>`), top: 0, left: 0 });
  return sharp({ create: { width: full, height: full, channels: 4, background: '#fff' } }).composite(layers).png().toBuffer();
}

const manifest = [];
let sheet = 0;
for (let s = 0; s < reps.length; s += PER) {
  const chunk = reps.slice(s, s + PER); const cells = [];
  for (let j = 0; j < chunk.length; j++) { manifest.push({ index: s + j, item: chunk[j].item, sheet }); cells.push(await cell(chunk[j], s + j)); }
  const full = CELL + PAD;
  const comp = cells.map((buf, j) => ({ input: buf, top: Math.floor(j / COLS) * full, left: (j % COLS) * full }));
  await sharp({ create: { width: COLS * full, height: ROWS * full, channels: 4, background: '#fff' } }).composite(comp).png().toFile(path.join(OUT, `iso-${sheet}.png`));
  console.log(`iso-${sheet}.png (#${s}-#${s + chunk.length - 1})`);
  sheet++;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`\n✅ ${sheet} sheets, ${reps.length} unique items. ${OUT}`);
