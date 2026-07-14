#!/usr/bin/env node
// One-off backfill: source_pack was dropped from the merged catalog+embeddings by the build/finalize
// scripts (now fixed). Restore it from the three staging _labeled.json files, keyed by id.
import fs from 'fs';
import path from 'path';

const AI = 'src/ai-engine';
const LABELED = [
  'v2-catalog/staging/kenney-all/_labeled.json',
  'v2-catalog/staging/phaser-cdn/_labeled.json',
  'v2-catalog/staging/phaser-full/_labeled.json',
];

// Build id → source_pack map from all labeled sources
const packById = new Map();
for (const f of LABELED) {
  const bundle = JSON.parse(fs.readFileSync(f));
  for (const item of bundle.items) if (item.source_pack) packById.set(item.id, item.source_pack);
}
console.log(`Loaded ${packById.size} id→source_pack mappings from labeled files`);

// Fallback: derive from id if any item isn't in the labeled files
function deriveFromId(id) {
  if (id.startsWith('kenney/')) return id.split('/')[1];            // kenney/toon_characters/... → toon_characters
  if (id.startsWith('phaser-cdn/')) return 'phaser-cdn ' + id.split('/')[1];
  if (id.startsWith('phaser/')) return 'phaser ' + id.split('/')[1];
  return 'unknown';
}

for (const file of ['v2-asset-catalog.json', 'v2-asset-embeddings.json']) {
  const p = path.join(AI, file);
  const data = JSON.parse(fs.readFileSync(p));
  let filled = 0, derived = 0;
  for (const item of data.items) {
    if (item.source_pack) continue;
    if (packById.has(item.id)) { item.source_pack = packById.get(item.id); filled++; }
    else { item.source_pack = deriveFromId(item.id); derived++; }
  }
  // Keep embeddings compact (no pretty-print), catalog pretty
  const pretty = file.includes('catalog');
  fs.writeFileSync(p, JSON.stringify(data, ...(pretty ? [null, 2] : [])));
  console.log(`${file}: filled ${filled} from labeled, ${derived} derived from id`);
}
console.log('✅ backfill complete');
