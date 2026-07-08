#!/usr/bin/env node
/**
 * Batch 1 re-role: 11 filename/folder-classifiable packs bulk-dumped as 'prop'.
 * Each rule = { test: regex on basename OR folder, role }. First match wins;
 * unmatched assets keep their current role. Prints per-pack role counts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

// basename (no ext) + folder segment are both available to rules.
const base = (lp) => path.basename(lp || '').replace(/\.png$/i, '');
const folder = (lp) => path.dirname(lp || '').split('/').pop();

const RULES = {
  // Underwater: fish are hazards, terrain is floor, bubbles collectible, seaweed/rock scenery.
  'Fish Pack': [
    { re: /^hud_/i, on: 'base', role: 'ui' },
    { re: /^background_terrain/i, on: 'base', role: 'ground' },
    { re: /^terrain_/i, on: 'base', role: 'ground' },      // seafloor tiles
    { re: /^background_/i, on: 'base', role: 'background' },
    // rock_* / seaweed_* stay prop (foreground decoration)
    { re: /^bubble_/i, on: 'base', role: 'pickup' },
    { re: /^fish_/i, on: 'base', role: 'obstacle' },
  ],
  'Jumper Pack': [
    { re: /^Players$/i, on: 'folder', role: 'character' },
    { re: /^Enemies$/i, on: 'folder', role: 'obstacle' },
    { re: /^Items$/i, on: 'folder', role: 'pickup' },
    { re: /^Background$/i, on: 'folder', role: 'background' },
    { re: /^HUD$/i, on: 'folder', role: 'ui' },
  ],
  'Topdown Tanks': [
    { re: /^Tanks$/i, on: 'folder', role: 'vehicle' },
    { re: /^Bullets$/i, on: 'folder', role: 'projectile' },
    { re: /^Obstacles$/i, on: 'folder', role: 'obstacle' },
    { re: /^Environment$/i, on: 'folder', role: 'ground' },
  ],
  'Tank Pack': [
    { re: /^tanks/i, on: 'base', role: 'vehicle' },
    { re: /^tank_bullet/i, on: 'base', role: 'projectile' },
  ],
  'Topdown Tanks Remastered': [
    { re: /^tankBody|^tank(Blue|Dark|Green|Red|Sand)/i, on: 'base', role: 'vehicle' },
    { re: /^bullet|^shot/i, on: 'base', role: 'projectile' },
    { re: /^tile(Grass|Sand)/i, on: 'base', role: 'ground' },
    { re: /^tree|^barrel|^crate|^sandbag|^barricade|^fence|^oilSpill|^wire/i, on: 'base', role: 'obstacle' },
  ],
  'Simple Space': [
    { re: /^ship/i, on: 'base', role: 'vehicle' },
    { re: /^enemy|^meteor/i, on: 'base', role: 'obstacle' },
  ],
  'Alien UFO Pack': [
    { re: /^ship/i, on: 'base', role: 'vehicle' },
    { re: /^laser/i, on: 'base', role: 'projectile' },
  ],
  'Robot Pack': [
    { re: /^robot|^body/i, on: 'base', role: 'character' },
    // tracks_* (treads) stay prop
  ],
  'Animal Pack': [
    { re: /^slice/i, on: 'base', role: null },        // atlas slices: leave as-is
    { re: /.*/, on: 'base', role: 'character' },
  ],
  'Animal Pack Remastered': [
    { re: /.*/, on: 'base', role: 'character' },
  ],
  'Isometric Tiles Vehicles': [
    { re: /.*/, on: 'base', role: 'vehicle' },
  ],
};

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const summary = {};
for (const a of data.assets) {
  const rules = RULES[a.pack];
  if (!rules) continue;
  const b = base(a.localPath), f = folder(a.localPath);
  for (const r of rules) {
    const target = r.on === 'folder' ? f : b;
    if (r.re.test(target)) {
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
console.log('✅ Batch 1 re-roled');
