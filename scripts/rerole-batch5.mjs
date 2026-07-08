#!/usr/bin/env node
/** Batch 5 re-role: boardgame/cards/physics/voxel/platformer-terrain packs. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');
const base = (lp) => path.basename(lp || '').replace(/\.png$/i, '');
const folder = (lp) => path.dirname(lp || '').split('/').pop();

const RULES = {
  'Boardgame Pack': [
    { re: /^Pieces/i, on: 'folder', role: 'character' },   // player tokens
    { re: /^card/i, on: 'base', role: 'pickup' },
  ],
  'Playing Cards Pack': [
    { re: /^card/i, on: 'base', role: 'pickup' },
  ],
  '50s Diner': [
    { re: /^wall/i, on: 'base', role: 'background' },      // walltiles
    // furniture stays prop (navigable scenery, not floor)
  ],
  'Voxel Expansion Pack': [
    { re: /^item_/i, on: 'base', role: 'pickup' },
  ],
  'Brick Pack': [
    { re: /^extra_character/i, on: 'base', role: 'character' },
    { re: /^extra_box_coin/i, on: 'base', role: 'pickup' },
    { re: /^extra_/i, on: 'base', role: 'obstacle' },        // extra_box_exclamation etc
    { re: /^brick/i, on: 'base', role: 'ground' },
  ],
  'Puzzle Pack 1': [
    { re: /^ball|^element_/i, on: 'base', role: 'pickup' },
    { re: /^button/i, on: 'base', role: 'ui' },
  ],
  'Physics Assets': [
    { re: /^alien/i, on: 'base', role: 'character' },
    { re: /elements$/i, on: 'folder', role: 'obstacle' },     // Explosive/Metal/Glass/Stone/Wood elements
  ],
  'Platformer Assets Ice': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Platformer Assets Candy': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Platformer Assets Mushroom': [
    { re: /^bg_/i, on: 'base', role: 'background' },
    { re: /.*/, on: 'base', role: 'ground' },
  ],
  'Platformer Assets Holiday': [
    { re: /^balls?_/i, on: 'base', role: 'pickup' },
    { re: /^present_/i, on: 'base', role: 'pickup' },
  ],
};

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const summary = {};
for (const a of data.assets) {
  const rules = RULES[a.pack];
  if (!rules) continue;
  const b = base(a.localPath), f = folder(a.localPath);
  for (const r of rules) {
    if (r.re.test(r.on === 'folder' ? f : b)) {
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
console.log('✅ Batch 5 re-roled');
