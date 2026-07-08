#!/usr/bin/env node
/**
 * RTS Sci-fi: fix decorated terrain tiles wrongly tagged 'ground'.
 *
 * Vision pass found this pack's "Tile" folder mixes PLAIN tileable terrain (dirt/river/
 * water path bends — safe to repeat via tileSprite) with DECORATED single-use tiles that
 * have alien flora baked directly into the texture (a purple mushroom-tree cluster drawn
 * on top of the dirt). Both were tagged 'ground' since the whole Tile/ folder maps to
 * ground. When a game repeated one of the decorated tiles as its floor texture, the baked
 * flora repeated too — producing a wallpaper of purple blobs covering the entire map
 * (reproduced from a live "robots vs aliens tower defense" generation).
 *
 * Fix: the specific decorated tile numbers -> 'prop' (single-placement scenery, not a
 * repeatable floor). Plain path/water tiles are untouched and remain ground.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

const DECORATED_TILE_NUMBERS = new Set([1, 2, 15, 16, 26, 27, 28, 29, 30, 37, 38]);
const tileNum = (lp) => { const m = (lp || '').match(/scifiTile_(\d+)/i); return m ? Number(m[1]) : null; };

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let n = 0;
for (const a of data.assets) {
  if (a.pack !== 'RTS Sci-fi') continue;
  const t = tileNum(a.localPath);
  if (t !== null && DECORATED_TILE_NUMBERS.has(t)) { a.role = 'prop'; n++; }
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
console.log(`RTS Sci-fi: ${n} decorated tiles (both Default+Retina) ground -> prop`);
