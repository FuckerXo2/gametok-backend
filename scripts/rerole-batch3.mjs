#!/usr/bin/env node
/** Batch 3 re-role: filename-classifiable remainder. Same engine as batch 1/2. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');
const base = (lp) => path.basename(lp || '').replace(/\.png$/i, '');

const RULES = {
  'Scribble Platformer': [
    { re: /^background_/i, role: 'background' },
    { re: /^character_/i, role: 'character' },
    { re: /^item_/i, role: 'pickup' },
    { re: /^effect_/i, role: 'prop' },
  ],
  'Isometric Minigolf': [
    { re: /^Obstacle/i, role: 'obstacle' },
    { re: /.*/, role: 'ground' },           // course tiles = the playable surface
  ],
  'Isometric Vector Roads Base': [
    { re: /^conifer/i, role: 'prop' },       // roadside trees
    { re: /.*/, role: 'ground' },            // roads/beach/crossroad terrain
  ],
  'Isometric Vector Roads Water': [
    { re: /.*/, role: 'ground' },            // rivers/bridges/waterfalls = terrain
  ],
  'Platformer Assets Requests': [
    { re: /laser/i, role: 'projectile' },
    { re: /spike/i, role: 'obstacle' },
  ],
  'Holiday Pack 2016': [
    { re: /^santa/i, role: 'character' },
    { re: /foliageTree/i, role: 'prop' },
  ],
};

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const summary = {};
for (const a of data.assets) {
  const rules = RULES[a.pack];
  if (!rules) continue;
  const b = base(a.localPath);
  for (const r of rules) {
    if (r.re.test(b)) {
      if (r.role) a.role = r.role;
      (summary[a.pack] ||= {})[r.role || '(kept)'] = ((summary[a.pack] ||= {})[r.role || '(kept)'] || 0) + 1;
      break;
    }
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
for (const [pack, roles] of Object.entries(summary)) {
  console.log(`${pack}: ${Object.entries(roles).map(([r, c]) => `${c}→${r}`).join(', ')}`);
}
console.log('✅ Batch 3 re-roled');
