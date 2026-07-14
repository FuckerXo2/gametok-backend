#!/usr/bin/env node
// Sweep standalone static sprites (the 2045 'sprite' type that the animation pipeline ignored).
// Downloads sprites from character/vehicle/monster-likely folders, builds montage contact-sheets
// (individual sprites, labeled by #index) for bulk visual review. Keeps decided by sight afterward.
//
// Usage: node scripts/v2-sprite-sweep.mjs <folderPrefix>   (e.g. "sprites/" or "games/")
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const cat = JSON.parse(fs.readFileSync('src/ai-engine/phaser-cdn-catalog.json'));

const prefix = process.argv[2];
if (!prefix) { console.error('Usage: node scripts/v2-sprite-sweep.mjs <folderPrefix>'); process.exit(1); }
const tag = prefix.replace(/[^a-z0-9]/gi, '_').replace(/_+$/, '');
const OUT = path.resolve('v2-catalog/staging/sprite-sweep', tag);
const MONT = path.join(OUT, '_montages');
fs.mkdirSync(MONT, { recursive: true });

// Skip obvious non-visual-character sub-paths even within a target folder
const SKIP = /\/(bullet|particle|normal|font|sky|texture|swatch|tile|number|numeral|cursor)/i;
const targets = cat.assets.filter(x => x.type === 'sprite' && x.path.startsWith(prefix) && !SKIP.test(x.path));
console.log(`${prefix}: ${targets.length} sprites to sweep`);

async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return Buffer.from(await r.arrayBuffer()); }

// Download + record dimensions
const records = [];
let n = 0;
for (const s of targets) {
  n++;
  process.stdout.write(`\r  fetching ${n}/${targets.length}   `);
  try {
    const buf = await fetchBuf(R2 + s.path);
    const meta = await sharp(buf).metadata();
    const local = path.join(OUT, s.path.replace(/\//g, '__'));
    fs.writeFileSync(local, buf);
    records.push({ path: s.path, local, w: meta.width, h: meta.height });
  } catch (e) { /* skip 404s */ }
}
console.log(`\n  downloaded ${records.length}`);

// Montage: 5 cols × 6 rows, 300×180 cells, sprite scaled to fit + label
const CW = 300, CH = 180, COLS = 5, ROWS = 6, PER = COLS * ROWS;
function label(t, w) { return Buffer.from(`<svg width="${w}" height="16"><rect width="${w}" height="16" fill="#111"/><text x="3" y="12" font-family="monospace" font-size="10" fill="#0f0">${t.replace(/[&<>]/g,'')}</text></svg>`); }

const index = [];
for (let m = 0; m * PER < records.length; m++) {
  const slice = records.slice(m * PER, m * PER + PER);
  const comps = [];
  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const gi = m * PER + i;
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * CW, y = row * CH;
    try {
      const img = await sharp(r.local).resize(CW - 6, CH - 22, { fit: 'inside', background: { r: 40, g: 40, b: 40, alpha: 1 } }).toBuffer();
      comps.push({ input: img, left: x + 3, top: y + 18 });
    } catch {}
    const name = r.path.split('/').slice(-2).join('/');
    comps.push({ input: label(`#${gi} ${name} ${r.w}x${r.h}`.slice(0, 46), CW), left: x, top: y });
    index.push({ idx: gi, path: r.path, local: r.local, w: r.w, h: r.h });
  }
  await sharp({ create: { width: CW * COLS, height: CH * ROWS, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
    .composite(comps).png().toFile(path.join(MONT, `montage_${String(m).padStart(2, '0')}.png`));
}
fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 2));
console.log(`Built ${Math.ceil(records.length / PER)} montages in ${MONT}`);
