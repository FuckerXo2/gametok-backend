#!/usr/bin/env node
// Pull character/vehicle/animal candidates from Phaser CDN (already on R2, TexturePacker/Aseprite
// JSON format — frames already packed, no repacking needed). Downloads sheet+json, crops a
// preview strip from real frame rects (capped at 12 frames) for review.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const STAGING = path.resolve('v2-catalog/staging/phaser-cdn');
fs.mkdirSync(STAGING, { recursive: true });

const CANDIDATES = [
  'animations/aseprite/paladin.json',
  'animations/aseprite/tank.json',
  'sets/platformer.json',
  'tests/player.json',
  'games/flood/monsters.json',
  'games/flood/blobs.json',
  'animations/walker.json',
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function normalizeFrames(raw) {
  // Aseprite export: frames is an object keyed "0","1",... OR an array
  const entries = Array.isArray(raw.frames) ? raw.frames.map((f, i) => [String(i), f]) : Object.entries(raw.frames);
  return entries.map(([key, f]) => ({ key, ...f.frame }));
}

async function main() {
  const manifest = [];
  for (const jsonPath of CANDIDATES) {
    const id = jsonPath.replace(/\.json$/, '').replace(/[\/]/g, '__');
    const pngPath = jsonPath.replace(/\.json$/, '.png');
    try {
      const [raw, pngBuf] = await Promise.all([
        fetchJson(R2 + jsonPath),
        fetchBuffer(R2 + pngPath),
      ]);
      const frames = normalizeFrames(raw);
      const sample = frames.slice(0, 12);
      const w = Math.max(...sample.map(f => f.w));
      const h = Math.max(...sample.map(f => f.h));
      const composite = [];
      for (let i = 0; i < sample.length; i++) {
        const f = sample[i];
        const input = await sharp(pngBuf).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).toBuffer();
        composite.push({ input, left: i * w, top: 0 });
      }
      const previewPath = path.join(STAGING, `${id}_preview.png`);
      await sharp({ create: { width: w * sample.length, height: h, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
        .composite(composite).png().toFile(previewPath);

      const sheetPath = path.join(STAGING, `${id}.png`);
      fs.writeFileSync(sheetPath, pngBuf);
      const atlas = {
        sheet: `${id}.png`,
        frameSize: { w, h },
        totalFrames: frames.length,
        frames: frames.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
        animations: { all: { frames: frames.map((_, i) => i), fps: 12, loop: true } },
      };
      fs.writeFileSync(path.join(STAGING, `${id}.json`), JSON.stringify(atlas, null, 2));

      manifest.push({
        id: `phaser-cdn/${id}`,
        source: `phaser-cdn/${jsonPath}`,
        stem: id,
        frameCount: frames.length,
        atlas,
        sheetPath: path.relative(process.cwd(), sheetPath),
        previewPath: path.relative(process.cwd(), previewPath),
        label: { role: null, orientation: null, quality: null, description: null, keep: null, needsLabel: true },
        reviewed: false,
      });
      console.log(`✓ ${jsonPath} (${frames.length} frames, showing first ${sample.length}) → ${previewPath}`);
    } catch (err) {
      console.error(`✗ ${jsonPath}: ${err.message}`);
    }
  }
  fs.writeFileSync(path.join(STAGING, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ ${manifest.length}/${CANDIDATES.length} candidates staged`);
}

main().catch(err => { console.error(err); process.exit(1); });
