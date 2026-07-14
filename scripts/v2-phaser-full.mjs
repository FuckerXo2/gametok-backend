#!/usr/bin/env node
// Comprehensive Phaser pass — process EVERY spritesheet_data + spritesheet-type atlas that isn't
// a structural non-sprite (tilemap/spine/font/audio). No path-based include-list; ingest everything
// mechanically, then build montage contact-sheets so keeps are decided by SIGHT, not by path.
//
// Output:
//   v2-catalog/staging/phaser-full/{pack}/{id}.{png,json} + _preview.png  (per-animation atlases)
//   v2-catalog/staging/phaser-full/_montages/montage_NN.png               (grids for bulk review)
//   v2-catalog/staging/phaser-full/_manifest.json
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { normalizePhaserAtlas, groupByAnimation, buildPerAnimationStrip } from './phaser-lib.mjs';

const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const OUT = path.resolve('v2-catalog/staging/phaser-full');
const MONT = path.join(OUT, '_montages');
fs.mkdirSync(MONT, { recursive: true });

const cat = JSON.parse(fs.readFileSync('src/ai-engine/phaser-cdn-catalog.json'));
const items = cat.assets;

// Structural skips — formats that cannot be character/vehicle/animal sprite atlases.
const SKIP = ['tilemaps/', 'spine/', 'animations/spine/', 'fonts/', 'audio/', 'skies/',
  'normal-maps/', 'textures/', 'swatches/', 'shaders/', 'paths/', 'panorama-360/', 'loader-tests/'];
const skip = p => SKIP.some(s => p.startsWith(s));

// Everything with an atlas JSON (both types can carry frame data)
const atlases = items.filter(x => (x.type === 'spritesheet_data' || x.type === 'spritesheet') && !skip(x.path) && x.path.endsWith('.json'));
console.log(`Atlases to process: ${atlases.length}`);

const slugify = s => s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return Buffer.from(await r.arrayBuffer()); }
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }

async function ingestOne(catEntry) {
  const jsonPath = catEntry.path;
  const packSlug = slugify(path.dirname(jsonPath).replace(/\//g, '_') || 'root');
  const stemBase = slugify(path.basename(jsonPath, '.json'));
  const outDir = path.join(OUT, packSlug);

  let raw;
  try { raw = await fetchJson(R2 + jsonPath); } catch (e) { return { path: jsonPath, error: 'json: ' + e.message, emitted: [] }; }
  const norm = normalizePhaserAtlas(raw);
  if (!norm.imageName || !norm.frames.length) return { path: jsonPath, error: 'no frames/image', emitted: [] };

  // Same-basename PNG first (stale imagePath fallback)
  const sameBase = R2 + jsonPath.replace(/\.json$/i, '.png');
  const derived = R2 + path.posix.join(path.dirname(jsonPath), path.posix.basename(norm.imageName));
  let png = null;
  for (const u of [sameBase, derived]) { try { png = await fetchBuf(u); break; } catch {} }
  if (!png) return { path: jsonPath, error: 'png fetch failed', emitted: [] };

  const groups = groupByAnimation(norm.frames);
  if (!groups.length) return { path: jsonPath, error: 'no multi-frame animations', emitted: [] };

  fs.mkdirSync(outDir, { recursive: true });
  const emitted = [];
  for (const g of groups) {
    const id = `${stemBase}__${slugify(g.anim)}`;
    const sheetPath = path.join(outDir, `${id}.png`);
    const previewPath = path.join(outDir, `${id}_preview.png`);
    try {
      const { cellW, cellH, nFrames } = await buildPerAnimationStrip(g, png, sheetPath, previewPath);
      // Guard against absurd atlases (e.g. 200-frame font sheets) — cap, still record
      const atlas = { sheet: `${id}.png`, frameSize: { w: cellW, h: cellH }, animations: { [g.anim]: { frames: Array.from({length: nFrames}, (_, i) => i), fps: 12, loop: true } } };
      fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(atlas, null, 2));
      emitted.push({ id: `phaser/${packSlug}/${id}`, source: jsonPath, packSlug, anim: g.anim, frameCount: nFrames, canvasW: cellW, canvasH: cellH, sheetPath, previewPath });
    } catch (e) { /* skip individual anim failures */ }
  }
  return { path: jsonPath, emitted };
}

// --- Run ingest ---
const manifest = [];
const errors = [];
let n = 0;
for (const a of atlases) {
  n++;
  process.stdout.write(`\r  [${n}/${atlases.length}] ${a.path.slice(0,50).padEnd(50)}   `);
  try {
    const res = await ingestOne(a);
    if (res.error) errors.push({ path: res.path, error: res.error });
    manifest.push(...res.emitted);
  } catch (e) { errors.push({ path: a.path, error: e.message }); }
}
console.log(`\n\nIngested ${manifest.length} per-animation atlases from ${atlases.length} sources (${errors.length} errored/empty)`);

fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(OUT, '_errors.json'), JSON.stringify(errors, null, 2));

// --- Build montage contact sheets: grid of previews, each cell scaled to fit, labeled by index ---
// 20 previews per montage, 4 cols × 5 rows, each cell 480×160 with the id printed.
const CELL_W = 480, CELL_H = 150, COLS = 4, ROWS = 6, PER = COLS * ROWS;
function labelSvg(text, w, h) {
  const safe = text.replace(/[&<>]/g, '');
  return Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#111"/><text x="4" y="12" font-family="monospace" font-size="11" fill="#0f0">${safe}</text></svg>`);
}
const montageIndex = [];
for (let m = 0; m * PER < manifest.length; m++) {
  const slice = manifest.slice(m * PER, m * PER + PER);
  const composites = [];
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * CELL_W, y = row * CELL_H;
    const globalIdx = m * PER + i;
    try {
      const resized = await sharp(item.previewPath).resize(CELL_W - 8, CELL_H - 24, { fit: 'inside', background: { r: 40, g: 40, b: 40, alpha: 1 } }).toBuffer();
      composites.push({ input: resized, left: x + 4, top: y + 20 });
    } catch {}
    composites.push({ input: labelSvg(`#${globalIdx} ${item.packSlug}/${item.anim} (${item.frameCount}f)`.slice(0, 68), CELL_W, 18), left: x, top: y });
    montageIndex.push({ idx: globalIdx, id: item.id, source: item.source, anim: item.anim, frameCount: item.frameCount });
  }
  const montagePath = path.join(MONT, `montage_${String(m).padStart(2, '0')}.png`);
  await sharp({ create: { width: CELL_W * COLS, height: CELL_H * ROWS, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
    .composite(composites).png().toFile(montagePath);
}
fs.writeFileSync(path.join(OUT, '_montage-index.json'), JSON.stringify(montageIndex, null, 2));
console.log(`Built ${Math.ceil(manifest.length / PER)} montage sheets in ${MONT}`);
console.log(`Review them, then keep by index list.`);
