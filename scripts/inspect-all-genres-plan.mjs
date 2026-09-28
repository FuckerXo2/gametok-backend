import fs from 'fs';
import path from 'path';

const CATALOG_PATH = path.resolve('../2d-assets-main/catalog.json');
const ROOT_DIR = path.resolve('../2d-assets-main');

const rawCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
const packs = rawCatalog.assets;

console.log(`Loaded catalog with ${packs.length} total packs.`);

// Genres to include
const GENRES = ['characters', 'effects', 'vehicles', 'fantasy', 'sci-fi', 'ui', 'nature', 'modern-urban', 'tiles-terrain', 'misc'];

const genreStats = {};
for (const g of GENRES) genreStats[g] = { packs: 0, items: 0 };

let totalSelectedPacks = 0;
let totalSelectedSprites = 0;

for (const p of packs) {
  const g = p.genre || 'misc';
  if (!GENRES.includes(g)) continue;

  const packDir = path.join(ROOT_DIR, p.path);
  if (!fs.existsSync(packDir)) continue;

  // Find preview
  const files = fs.readdirSync(packDir);
  const previewFile = files.find(f => f.toLowerCase().includes('preview') && f.toLowerCase().endsWith('.png'))
    || files.find(f => f.toLowerCase().includes('sample') && f.toLowerCase().endsWith('.png'));

  // Collect candidate PNGs
  const sprites = [];
  function scanDir(dir, depth = 0) {
    if (depth > 4) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const lower = ent.name.toLowerCase();
        // Skip vector, black background, spritesheets, raw source dirs
        if (lower.includes('vector') || lower.includes('black background') || lower.includes('tilesheet') || lower.includes('spritesheet')) {
          continue;
        }
        scanDir(full, depth + 1);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.png')) {
        const lower = ent.name.toLowerCase();
        if (lower.includes('tilesheet') || lower.includes('spritesheet') || lower.includes('preview') || lower.includes('sample')) {
          continue;
        }
        // Avoid duplicate @2x if 1x exists or vice versa
        sprites.push(full);
      }
    }
  }

  scanDir(packDir);

  if (sprites.length > 0 || previewFile) {
    totalSelectedPacks++;
    totalSelectedSprites += Math.min(sprites.length, 50); // Cap per pack so single giant packs don't dominate
    genreStats[g].packs++;
    genreStats[g].items += Math.min(sprites.length, 50);
  }
}

console.log(`\nScan Summary:`);
console.log(`Total viable packs: ${totalSelectedPacks}`);
console.log(`Total sprites (capped at 50/pack): ${totalSelectedSprites}`);
console.table(genreStats);
