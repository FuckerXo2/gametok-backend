#!/usr/bin/env node
/**
 * Batch 2 re-role: 17 more packs bulk-dumped as 'prop'.
 * Same engine as batch 1 — { re, on:'base'|'folder', role }, first match wins.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');
const base = (lp) => path.basename(lp || '').replace(/\.png$/i, '');
const folder = (lp) => path.dirname(lp || '').split('/').pop();

const RULES = {
  'Space Shooter Remastered': [
    { re: /^Enemies$|^Meteors$/i, on: 'folder', role: 'obstacle' },
    { re: /^Lasers$/i, on: 'folder', role: 'projectile' },
    { re: /^Power-ups$/i, on: 'folder', role: 'pickup' },
    { re: /^UI$/i, on: 'folder', role: 'ui' },
    { re: /^playerShip/i, on: 'base', role: 'vehicle' },
    { re: /^(black|blue|darkPurple|purple)$/i, on: 'base', role: 'background' },
  ],
  'Space Shooter Extension': [
    { re: /^spaceShips/i, on: 'base', role: 'vehicle' },
    { re: /^spaceMissiles/i, on: 'base', role: 'projectile' },
    { re: /^spaceAstronauts/i, on: 'base', role: 'character' },
    { re: /^spaceMeteors/i, on: 'base', role: 'obstacle' },
  ],
  'Scribble Dungeons': [
    { re: /_character$/i, on: 'base', role: 'character' },
    { re: /^weapon_|^shield_/i, on: 'base', role: 'pickup' },
  ],
  'Ranks Pack':  [{ re: /.*/, on: 'base', role: 'ui' }],
  'Emote Pack':  [{ re: /.*/, on: 'base', role: 'ui' }],
  'Generic Items': [{ re: /.*/, on: 'base', role: 'pickup' }],
  'Road Textures': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Road Textures (Classic)': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Isometric Modular Roads': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Map Pack': [{ re: /.*/, on: 'base', role: 'ground' }],
  'RPG Tiles Vector': [{ re: /.*/, on: 'base', role: 'ground' }],
  'Background Elements': [{ re: /.*/, on: 'base', role: 'background' }],
  'Rolling Ball Assets': [
    { re: /^ball_/i, on: 'base', role: 'vehicle' },
    { re: /^background_/i, on: 'base', role: 'background' },
    { re: /^block_/i, on: 'base', role: 'obstacle' },
  ],
  'Planets': [
    { re: /^planet|^sphere/i, on: 'base', role: 'background' },
  ],
  'Hexagon Base Pack': [
    { re: /^alien/i, on: 'base', role: 'character' },
  ],
  'Physics Assets': [
    { re: /^alien/i, on: 'base', role: 'character' },
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
console.log('✅ Batch 2 re-roled');
