#!/usr/bin/env node
// Build a searchable catalog of the Kenney All-in-1 3D models (GLB only) from a local pack.
//
// The 649MB pack is NOT committed — it lives outside the repo. This crawls its "3D assets" tree,
// records every .glb with derived {kit, category, tags, sizeKB}, and writes a compact JSON catalog
// into the backend (committed) that the foundation/retrieval step searches. GLBs themselves get
// uploaded to R2 separately; this is just the index.
//
// Usage:
//   node scripts/build-kenney3d-catalog.mjs "/path/to/Kenney Game Assets All-in-1 3/3D assets"
//   (falls back to ../Kenney Game Assets All-in-1 3/3D assets relative to the repo)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CATEGORY_RULES = [
  [/animated character|protagonist|survivor|blocky character|mini character|cube pet|skater|retro character/i, 'character'],
  [/car|racing|toy car|vehicle|watercraft|train|coaster/i, 'vehicle'],
  [/city|building|modular building|suburban|commercial|industrial|town|urban|factory|market/i, 'building'],
  [/nature|tree|graveyard|holiday/i, 'nature'],
  [/dungeon|castle|fantasy|pirate|tower defense/i, 'fantasy'],
  [/space|station/i, 'space'],
  [/weapon|blaster/i, 'weapon'],
  [/food/i, 'food'],
  [/furniture/i, 'furniture'],
  [/road|brick|hexagon|prototype|platformer|marble|minigolf|skate|arcade|arena|toy/i, 'prop'],
];

function categorize(kit) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(kit)) return cat;
  return 'prop';
}

// camelCase / separators -> lowercase word tokens for keyword retrieval
function tokenize(...parts) {
  const raw = parts.join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-/.]+/g, ' ')
    .toLowerCase();
  return [...new Set(raw.split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w)))];
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.glb')) out.push(full);
  }
}

const packDir = process.argv[2]
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '3D assets');

if (!fs.existsSync(packDir)) {
  console.error(`[kenney3d] Pack dir not found: ${packDir}\nPass it as the first argument.`);
  process.exit(1);
}

const files = [];
walk(packDir, files);

const models = files.map((full) => {
  const rel = path.relative(packDir, full);          // e.g. "Car Kit/Models/GLB format/van.glb"
  const kit = rel.split(path.sep)[0];                // "Car Kit"
  const name = path.basename(full, '.glb');          // "van"
  let sizeKB = 0;
  try { sizeKB = Math.round(fs.statSync(full).size / 1024); } catch { /* skip */ }
  return {
    id: `${kit}/${name}`.replace(/\s+/g, '_').toLowerCase(),
    name,
    kit,
    category: categorize(kit),
    tags: tokenize(kit, name),
    sizeKB,
    rel,                                             // path inside the pack (source of truth for R2 upload)
  };
});

models.sort((a, b) => a.id.localeCompare(b.id));

const byKit = {};
const byCategory = {};
for (const m of models) {
  byKit[m.kit] = (byKit[m.kit] || 0) + 1;
  byCategory[m.category] = (byCategory[m.category] || 0) + 1;
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'Kenney Game Assets All-in-1 (GLB)',
  total: models.length,
  kits: Object.keys(byKit).sort().length,
  byCategory,
  models,
};

const outPath = path.join(repoRoot, 'src', 'ai-engine', 'kenney3d-catalog.json');
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 0));
console.log(`[kenney3d] ${models.length} GLB models across ${Object.keys(byKit).length} kits -> ${path.relative(repoRoot, outPath)}`);
console.log('[kenney3d] by category:', byCategory);
