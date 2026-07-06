#!/usr/bin/env node
// Tile every Kenney 2D pack's Preview.png (fallback Sample.png) into labeled contact sheets so a
// vision model can read each pack's ORIENTATION at a glance (one preview = whole pack's camera).
// Only packs present in kenney2d-catalog.json are included. Writes manifest (index -> pack).

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const PACK_ROOT = '/Users/abiolalimitless/gameidea/Kenney Game Assets All-in-1 3/2D assets';
const OUT = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/kenney-previews';
const catalog = JSON.parse(fs.readFileSync('/Users/abiolalimitless/gameidea/gametok-backend/src/ai-engine/kenney2d-catalog.json', 'utf8'));
const packs = [...new Set(catalog.assets.map((a) => a.pack))].sort();

fs.mkdirSync(OUT, { recursive: true });
const CELL = 300, PAD = 30, COLS = 4, ROWS = 3, PER = COLS * ROWS; // 12/sheet, big enough to read camera

function previewFor(pack) {
  for (const f of ['Preview.png', 'Sample.png', 'preview.png', 'sample.png']) {
    const p = path.join(PACK_ROOT, pack, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function cell(pack, idx) {
  const full = CELL + PAD;
  const layers = [];
  layers.push({ input: { create: { width: CELL, height: CELL, channels: 4, background: '#ffffff' } }, top: PAD, left: 0 });
  const prev = previewFor(pack);
  if (prev) {
    try {
      const img = await sharp(prev).resize(CELL, CELL, { fit: 'inside', background: '#ffffff', flatten: true }).flatten({ background: '#ffffff' }).toBuffer();
      const m = await sharp(img).metadata();
      layers.push({ input: img, top: PAD + Math.floor((CELL - m.height) / 2), left: Math.floor((CELL - m.width) / 2) });
    } catch { /* skip */ }
  }
  const label = `#${idx} ${pack}`.slice(0, 40);
  layers.push({ input: Buffer.from(`<svg width="${full}" height="${PAD}"><rect width="100%" height="100%" fill="#111"/><text x="4" y="21" font-family="monospace" font-size="16" fill="#0f0">${label.replace(/&/g, '&amp;')}</text></svg>`), top: 0, left: 0 });
  return sharp({ create: { width: full, height: full, channels: 4, background: '#ffffff' } }).composite(layers).png().toBuffer();
}

const manifest = [];
let sheet = 0;
for (let s = 0; s < packs.length; s += PER) {
  const chunk = packs.slice(s, s + PER);
  const cells = [];
  for (let j = 0; j < chunk.length; j++) { manifest.push({ index: s + j, pack: chunk[j], sheet }); cells.push(await cell(chunk[j], s + j)); }
  const full = CELL + PAD;
  const comp = cells.map((buf, j) => ({ input: buf, top: Math.floor(j / COLS) * full, left: (j % COLS) * full }));
  await sharp({ create: { width: COLS * full, height: ROWS * full, channels: 4, background: '#ffffff' } }).composite(comp).png().toFile(path.join(OUT, `pv-${sheet}.png`));
  console.log(`pv-${sheet}.png  (#${s}–#${s + chunk.length - 1})`);
  sheet++;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`\n✅ ${sheet} preview sheets, ${manifest.length} packs. ${OUT}`);
