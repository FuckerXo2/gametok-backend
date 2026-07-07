#!/usr/bin/env node
// One-off patch: recompute role/description/tileable for the 5,952 assets across 22 packs whose
// top-level "Tiles/" folder was wrongly stripped as a generic wrapper (like "PNG/"), losing the
// semantic signal that dumped them all into role='prop'. See ingest-kenney2d.mjs relNoTop comment.
// Mirrors roleFor()/GROUND_TILEABLE from ingest-kenney2d.mjs exactly, applied only to affected rows —
// does NOT touch already vision-labeled assets (Iso Nature, cooking, diner, atlas exclusions, etc).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const CATALOG = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json');

function roleFor(subPath, file) {
  const s = (subPath + '/' + file).toLowerCase();
  if (/\b(car|cars|motorcycle|truck|vehicle|tank|racer|ship|boat|plane|jet)\b/.test(s)) return 'vehicle';
  if (/\b(road|asphalt|dirt|grass|sand|tile|tiles|terrain|ground|floor|water|track)\b/.test(s)) return 'ground';
  if (/\b(coin|gem|star|key|heart|diamond|fruit|food|pickup|powerup|item|potion|treasure)\b/.test(s)) return 'pickup';
  if (/\b(character|characters|player|hero|zombie|alien|robot|monster|enemy|soldier|people|man|woman|adventurer|survivor)\b/.test(s)) return 'character';
  if (/\b(bullet|laser|missile|projectile|shot|arrow)\b/.test(s)) return 'projectile';
  if (/\b(object|objects|prop|rock|tree|barrel|cone|crate|box|fence|barrier|obstacle|bush)\b/.test(s)) return 'obstacle';
  if (/\b(ui|button|panel|icon|hud|cursor|crosshair)\b/.test(s)) return 'ui';
  if (/\b(background|backgrounds|sky|bg)\b/.test(s)) return 'background';
  return 'prop';
}
const GROUND_TILEABLE = /\b(road|asphalt|dirt|grass|sand|tile|tiles|terrain|ground|floor|water|track|brick|pattern)\b/i;

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let changed = 0;
const byRole = {};
for (const a of catalog.assets) {
  const parts = a.localPath.replace(/\\/g, '/').split('/');
  if (parts.length < 3 || parts[1] !== 'Tiles') continue; // only the "Pack/Tiles/..." top-level case
  if (a.role === 'atlas' || a.visionLabeled) continue; // never touch already-labeled/excluded rows

  const relNoTop = parts.slice(1).join('/');            // "Tiles/tile_0000.png"
  const subDir = path.posix.dirname(relNoTop) === '.' ? '' : path.posix.dirname(relNoTop);
  const base = parts[parts.length - 1];
  const nameNoExt = base.replace(/\.[^.]+$/, '');

  const newRole = roleFor(subDir, base);
  const newTileable = newRole === 'ground' && GROUND_TILEABLE.test(subDir + '/' + base);
  const newType = newTileable ? 'tileable' : 'sprite';
  const newDesc = `${nameNoExt.replace(/[_-]+/g, ' ')} — ${newRole}${a.orientation && a.orientation !== 'unknown' ? ', ' + a.orientation.replace('_', '-') : ''} (Kenney ${a.pack})`;

  if (a.role !== newRole || a.description !== newDesc) {
    a.role = newRole;
    a.tileable = newTileable;
    a.type = newType;
    a.description = newDesc;
    changed++;
    byRole[newRole] = (byRole[newRole] || 0) + 1;
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));
console.log(`✅ fixed ${changed} assets (Tiles-wrapper bug)`);
console.log('   new role distribution:', JSON.stringify(byRole));
