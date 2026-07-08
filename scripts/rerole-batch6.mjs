#!/usr/bin/env node
/** Batch 6 re-role: Block Pack, Platformer Bricks, small collectible packs. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');
const base = (lp) => path.basename(lp || '').replace(/\.png$/i, '');

const RULES = {
  'Block Pack': [
    { re: /^character_/i, role: 'character' },
    { re: /^cart/i, role: 'vehicle' },
    { re: /^box_treasure/i, role: 'pickup' },
    { re: /^box/i, role: 'obstacle' },
    { re: /^tile/i, role: 'ground' },
    // door/fence/foliage/detail/ladder/market stay prop (decoration)
  ],
  'Platformer Bricks': [
    { re: /^(key|lock)/i, role: 'pickup' },
    { re: /^boxCoin|^boxItem/i, role: 'pickup' },
    { re: /^boxExplosive|^boxWarning/i, role: 'obstacle' },
    { re: /^box/i, role: 'obstacle' },
    { re: /^liquid/i, role: 'obstacle' },
    { re: /^(plant|cactus)/i, role: 'obstacle' },
    { re: /.*/, role: 'ground' },  // dirt/grass/sand/snow/stone/mud/magic/castle/bridge terrain runs
  ],
  'Medals': [{ re: /.*/, role: 'ui' }],
  'Smilies': [{ re: /.*/, role: 'ui' }],
  'Donuts': [{ re: /.*/, role: 'pickup' }],
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
console.log('✅ Batch 6 re-roled');
