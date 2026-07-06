#!/usr/bin/env node
// Apply the vision-verified per-pack orientations (pv-cap-*.json, keyed by preview-montage index →
// pack via manifest.json) to every sprite in kenney2d-catalog.json. Overwrites the name-heuristic
// orientation with the eyes-verified one. UI/pickup roles keep their own agnostic orientation.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PV = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/kenney-previews';
const CATALOG = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json');

const manifest = JSON.parse(fs.readFileSync(path.join(PV, 'manifest.json'), 'utf8'));
const idxToPack = new Map(manifest.map((m) => [m.index, m.pack]));

const packOrient = {};
for (let s = 0; s <= 11; s++) {
  const f = path.join(PV, `pv-cap-${s}.json`);
  if (!fs.existsSync(f)) continue;
  for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const pack = idxToPack.get(c.i);
    if (pack) packOrient[pack] = c.orientation;
  }
}
// the 2 packs with no preview (both platformer) default to side
packOrient['New Platformer Pack'] = packOrient['New Platformer Pack'] || 'side';
packOrient['Platformer Pack Remastered'] = packOrient['Platformer Pack Remastered'] || 'side';

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let changed = 0, verified = 0;
for (const a of catalog.assets) {
  const o = packOrient[a.pack];
  if (!o) continue;
  verified++;
  // Keep genuinely orientation-agnostic roles (ui/pickup/audio) as-is; set world roles to the pack camera.
  if (['ui', 'pickup', 'audio'].includes(a.role)) continue;
  if (a.orientation !== o) { a.orientation = o; changed++; }
  a.orientationVerified = true;
}
catalog.metadata = { ...catalog.metadata, orientationVisionPacks: Object.keys(packOrient).length, orientationVisionAt: new Date().toISOString() };
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));

const by = (f) => catalog.assets.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join('  ');
console.log(`✅ orientation applied from ${Object.keys(packOrient).length} vision-checked packs`);
console.log(`   ${verified} sprites touched, ${changed} orientations corrected`);
console.log('   NEW ORIENTATION:', top(by((a) => a.orientation)));
