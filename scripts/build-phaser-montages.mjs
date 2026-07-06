#!/usr/bin/env node
// Download the gameplay-role Phaser assets from R2 and tile them into labeled contact sheets so a
// vision model can caption ~20 at a time instead of one-by-one. Each cell shows the asset on a
// checkerboard (so transparency/edges are visible) with its index number burned in the corner.
// Writes a manifest mapping index -> {path, role} for reattaching captions.

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SCRATCH = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/phaser-montage';
const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const list = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-abiolalimitless-gameidea/gp308.json', 'utf8'));

const CELL = 150, PAD = 26, COLS = 6, ROWS = 5, PER = COLS * ROWS; // 30 per sheet
fs.mkdirSync(SCRATCH, { recursive: true });
fs.mkdirSync(path.join(SCRATCH, 'src'), { recursive: true });

async function dl(item, i) {
  const dest = path.join(SCRATCH, 'src', `${i}.png`);
  if (fs.existsSync(dest)) return dest;
  const res = await fetch(R2 + item.path);
  if (!res.ok) return null;
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// light checkerboard tile so transparent PNG edges are visible in the sheet
function checkerTile(size) {
  const s = 10; let rects = '';
  for (let y = 0; y < size; y += s) for (let x = 0; x < size; x += s)
    if (((x / s) + (y / s)) % 2 === 0) rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#d8d8d8"/>`;
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="100%" height="100%" fill="#efefef"/>${rects}</svg>`);
}

async function buildCell(srcPath, idx) {
  const full = CELL + PAD;
  const bg = sharp({ create: { width: full, height: full, channels: 4, background: '#ffffff' } });
  const layers = [];
  // checker area
  layers.push({ input: await sharp(checkerTile(CELL)).png().toBuffer(), top: PAD, left: 0 });
  if (srcPath) {
    try {
      const img = await sharp(srcPath).resize(CELL, CELL, { fit: 'inside', withoutEnlargement: false }).toBuffer();
      const meta = await sharp(img).metadata();
      layers.push({ input: img, top: PAD + Math.floor((CELL - meta.height) / 2), left: Math.floor((CELL - meta.width) / 2) });
    } catch { /* skip broken */ }
  }
  // index label
  layers.push({ input: Buffer.from(`<svg width="${full}" height="${PAD}"><rect width="100%" height="100%" fill="#111"/><text x="4" y="19" font-family="monospace" font-size="18" fill="#0f0">#${idx}</text></svg>`), top: 0, left: 0 });
  return bg.composite(layers).png().toBuffer();
}

const manifest = [];
let sheetNo = 0;
for (let start = 0; start < list.length; start += PER) {
  const chunk = list.slice(start, start + PER);
  const cells = [];
  for (let j = 0; j < chunk.length; j++) {
    const idx = start + j;
    const src = await dl(chunk[j], idx);
    manifest.push({ index: idx, path: chunk[j].path, role: chunk[j].role, sheet: sheetNo });
    cells.push(await buildCell(src, idx));
  }
  const full = CELL + PAD;
  const sheet = sharp({ create: { width: COLS * full, height: ROWS * full, channels: 4, background: '#ffffff' } });
  const comp = cells.map((buf, j) => ({ input: buf, top: Math.floor(j / COLS) * full, left: (j % COLS) * full }));
  await sheet.composite(comp).png().toFile(path.join(SCRATCH, `sheet-${sheetNo}.png`));
  console.log(`sheet-${sheetNo}.png  (#${start}–#${start + chunk.length - 1})`);
  sheetNo++;
}
fs.writeFileSync(path.join(SCRATCH, 'manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`\n✅ ${sheetNo} sheets, ${manifest.length} assets. Scratch: ${SCRATCH}`);
