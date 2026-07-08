#!/usr/bin/env node
/**
 * Batch 4: the 3 Platformer tilesets (Nautical/Medieval/Industrial).
 * Vision pass (contact-sheet montages) confirmed these are Kenney level-building
 * TILESETS: ~65% terrain autotile variants + themed world-decoration, numbered
 * filenames (no hidden characters/enemies/pickups). Their honest role is 'ground'
 * — the "tile these to build the world" bucket — a strict upgrade over 'prop' for
 * constructing themed levels. Decoration living in the world-tile bucket is an
 * accepted minor imperfection; clean per-tile separation isn't rangeable.
 *
 * Tower Defense + Isometric Tower Defense are deliberately NOT here: they hold
 * gameplay-critical towers/enemies/gems that must not be bulk-labeled ground.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');
const PACKS = new Set(['Platformer Pack Nautical', 'Platformer Pack Medieval', 'Platformer Pack Industrial']);

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const counts = {};
for (const a of data.assets) {
  if (!PACKS.has(a.pack)) continue;
  a.role = 'ground';
  counts[a.pack] = (counts[a.pack] || 0) + 1;
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
for (const [p, c] of Object.entries(counts)) console.log(`${p}: ${c}→ground`);
console.log('✅ Batch 4 re-roled (3 platformer tilesets)');
