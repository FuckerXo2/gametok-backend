#!/usr/bin/env node
/**
 * Tower Defense re-role: vision pass via contact-sheet montages (6 sheets, 563 items,
 * Claude read each one directly). Tower Defense is ~90% terrain path tiles (stays
 * ground/prop) with towers/enemies/gems/UI/effects scattered inside by tile number —
 * bulk-labeling would mislabel a tower as floor, so this labels by exact tile NUMBER
 * (parsed from filename), which matches both "Default size" and "Retina" copies of the
 * same content in one pass.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

const TILE_ROLE = {
  character: [226, 227, 228, 229, 238, 239, 240, 242, 249, 250, 251, 252], // turret bases + barrels
  pickup: [245, 246, 255, 272, 273, 274, 275, 291, 292],                    // gems, coins, keys
  obstacle: [270, 271, 293, 294],                                          // flying enemy planes
  ui: [266, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289], // banner + digits/symbols
  prop: [295, 296, 297, 298],                                              // flame effect
};

const tileNum = (lp) => { const m = (lp || '').match(/tile(\d+)/i); return m ? Number(m[1]) : null; };

const tileToRole = new Map();
for (const [role, tiles] of Object.entries(TILE_ROLE)) {
  for (const t of tiles) tileToRole.set(t, role);
}

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let updated = 0;
const counts = {};
for (const a of data.assets) {
  if (a.pack !== 'Tower Defense') continue;
  const t = tileNum(a.localPath);
  if (t === null) continue;
  const role = tileToRole.get(t);
  if (!role) continue;
  a.role = role;
  updated++;
  counts[role] = (counts[role] || 0) + 1;
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
console.log('Tower Defense: ' + updated + ' assets relabeled — ' + Object.entries(counts).map(([r, c]) => c + '→' + r).join(', '));
