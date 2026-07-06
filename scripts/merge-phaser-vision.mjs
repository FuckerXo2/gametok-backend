#!/usr/bin/env node
// Merge the vision captions (cap-*.json, keyed by montage index) back into
// phaser-catalog-normalized.json, using manifest.json to map index -> asset path.
// Overwrites theme/role/orientation/type/description for the 308 gameplay assets I actually looked
// at, and stamps vision:true so we know which entries are eyes-verified vs filename-guessed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const MON = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/phaser-montage';
const CATALOG = path.join(repoRoot, 'src', 'ai-engine', 'phaser-catalog-normalized.json');

const manifest = JSON.parse(fs.readFileSync(path.join(MON, 'manifest.json'), 'utf8'));
const idxToPath = new Map(manifest.map((m) => [m.index, m.path]));

const caps = {};
for (let s = 0; s <= 10; s++) {
  const f = path.join(MON, `cap-${s}.json`);
  if (!fs.existsSync(f)) continue;
  for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) caps[c.i] = c;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const byPath = new Map(catalog.assets.map((a) => [a.localPath, a]));

let updated = 0, missing = 0;
for (const [idx, cap] of Object.entries(caps)) {
  const p = idxToPath.get(Number(idx));
  const a = p && byPath.get(p);
  if (!a) { missing++; continue; }
  a.theme = cap.theme;
  a.role = cap.role;
  a.orientation = cap.orientation;
  a.type = cap.type;
  a.description = `${cap.desc} (phaser cdn, vision-verified)`;
  a.vision = true;
  updated++;
}

catalog.metadata = { ...catalog.metadata, visionVerified: updated, visionPassAt: new Date().toISOString() };
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));

const by = (pred) => catalog.assets.filter(pred).length;
console.log(`✅ vision-merged ${updated} phaser assets (${missing} unmatched)`);
console.log('   normalmaps flagged (excluded from gameplay):', by((a) => a.role === 'normalmap'));
console.log('   vision top_down vehicles:', by((a) => a.vision && a.role === 'vehicle' && a.orientation === 'top_down'));
console.log('   vision ground/track:', by((a) => a.vision && a.role === 'ground'));
console.log('   vision pickups:', by((a) => a.vision && a.role === 'pickup'));
