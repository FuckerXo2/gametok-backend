#!/usr/bin/env node
// Ingest Kenney 2D asset packs into a unified, honestly-labeled catalog.
//
// WHY: our generation model is blind — it only reads text labels. Kenney's FOLDER STRUCTURE is
// honest semantic metadata (Racing Pack/PNG/Cars/car_red_1.png => theme:racing, role:vehicle), unlike
// the Phaser catalog whose filename-substring tags are garbage. This walks the packs, keeps only
// INDIVIDUAL sprite PNGs (skips packed spritesheets/tilesheets/vector), reads real dimensions, and
// derives theme/role/orientation/tileable from the path + a per-pack override table.
//
// Output: src/ai-engine/kenney2d-catalog.json (unified schema). Upload URLs assume the R2 key
// kenney2d/<pack-slug>/<relpath>.png (see scripts/upload-kenney2d-r2.mjs).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PACK_ROOT = process.env.KENNEY2D_ROOT
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3', '2D assets');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const OUT = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json');

if (!fs.existsSync(PACK_ROOT)) { console.error(`2D asset root not found: ${PACK_ROOT}`); process.exit(1); }

// ── folders / files we never treat as individual usable sprites ──
const SKIP_DIR = /^(spritesheet|spritesheets|tilesheet|tilesheets|vector|construct 3|construct3|tiled|isometric|Sample|Preview|Voxel)$/i;
const SKIP_FILE = /^(preview|sample|license|thumbnail|readme)/i;
// Full packed spritesheet composites (e.g. Tilemap/tilemap_packed.png) are the WHOLE atlas as one
// image, not a single usable sprite — never expose them as selectable game assets.
const SKIP_ATLAS = /^(tilemap|.*_tilemap)(_packed)?\.png$/i;
const KEEP_EXT = new Set(['.png']);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ── theme from pack name ──
function themeForPack(pack) {
  const p = pack.toLowerCase();
  const t = new Set();
  if (/racing|road|vehicle|\bcar\b|tank|ski|minigolf|watercraft/.test(p)) t.add('racing');
  if (/platformer|jumper|jump|tappy|scribble platformer/.test(p)) t.add('platformer');
  if (/shooter|shmup|shooting|desert shooter|space shooter/.test(p)) t.add('shooter');
  if (/space|alien|ufo|planet|sci-fi|scifi|simple space/.test(p)) t.add('space');
  if (/medieval|castle|knight|rts medieval|tower defense/.test(p)) t.add('medieval');
  if (/rpg|roguelike|dungeon|monster|rune/.test(p)) t.add('rpg');
  if (/pirate|nautical|watercraft/.test(p)) t.add('pirate');
  if (/tank|battle|military|rts sci-fi/.test(p)) t.add('military');
  if (/sport|ball|golf/.test(p)) t.add('sports');
  if (/puzzle|sokoban|match|block|letter|boardgame|playing cards/.test(p)) t.add('puzzle');
  if (/animal|fish|foliage|nature|farm/.test(p)) t.add('nature');
  if (/ui|icon|emote|crosshair|medal|rank|smilies|googly/.test(p)) t.add('ui');
  if (t.size === 0) t.add('generic');
  return [...t];
}

// ── orientation from pack name (per-pack override for the ones name-heuristics get wrong) ──
const ORIENTATION_OVERRIDE = {
  'Racing Pack': 'top_down',
  'Pixel Vehicle Pack': 'side',        // vision-verified: side-view pixel cars, NOT top-down
  'Road Textures': 'top_down',
  'Road Textures (Classic)': 'top_down',
  'Topdown Shooter': 'top_down',
  'Topdown Shooter (Pixel)': 'top_down',
  'Topdown Tanks': 'top_down',
  'Topdown Tanks Remastered': 'top_down',
  'Tank Pack': 'top_down',
  'Tiny Ski': 'top_down',
  'Micro Roguelike': 'top_down',
  'Roguelike Base Pack': 'top_down',
  'Roguelike Characters Pack': 'top_down',
  'Roguelike City Pack': 'top_down',
  'Roguelike Dungeon Pack': 'top_down',
  'Roguelike Interior Pack': 'top_down',
  'Tiny Town': 'top_down',
  'Tiny Dungeon': 'top_down',
  'Tiny Battle': 'top_down',
  'RPG Urban Pack': 'top_down',
  'Map Pack': 'top_down',
  'Sokoban Pack': 'top_down',
  'RTS Medieval': 'top_down',
  'RTS Medieval (Pixel)': 'top_down',
  'RTS Sci-fi': 'top_down',
  'Tower Defense': 'top_down',
  'Isometric Minigolf': 'top_down',
};
function orientationForPack(pack) {
  if (ORIENTATION_OVERRIDE[pack]) return ORIENTATION_OVERRIDE[pack];
  const p = pack.toLowerCase();
  if (/isometric|axonometric|hexagon/.test(p)) return 'isometric';
  if (/topdown|top-down/.test(p)) return 'top_down';
  if (/platformer|jumper|jump|tappy|shmup|pico-8 platformer/.test(p)) return 'side';
  if (/\bui\b|icon|emote|crosshair|medal|rank|button|smilies|googly|letter|playing cards|pattern/.test(p)) return 'ui';
  return 'unknown'; // vision/spot-check can refine
}

// ── role from the nearest meaningful subfolder + filename ──
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

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIR.test(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else {
      yield path.join(dir, ent.name);
    }
  }
}

const packs = fs.readdirSync(PACK_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const assets = [];
let skippedNoDim = 0;

for (const pack of packs) {
  const packDir = path.join(PACK_ROOT, pack);
  const theme = themeForPack(pack);
  const orientation = orientationForPack(pack);
  const packSlug = slug(pack);

  for (const file of walk(packDir)) {
    const ext = path.extname(file).toLowerCase();
    if (!KEEP_EXT.has(ext)) continue;
    const base = path.basename(file);
    if (SKIP_FILE.test(base) || SKIP_ATLAS.test(base)) continue;

    const rel = path.relative(packDir, file);              // e.g. PNG/Cars/car_red_1.png
    // Only strip generic non-semantic wrapper dirs. "Tiles" is itself meaningful (maps to role=ground
    // via roleFor's \btiles\b match) — stripping it when it's the pack's TOP-level folder (e.g.
    // "Roguelike City Pack/Tiles/tile_0000.png") left subDir empty and silently dumped 5,952 assets
    // across 22 packs into the generic 'prop' bucket instead of 'ground'. Never strip it.
    const relNoTop = rel.replace(/^(PNG|Sprites)\//i, ''); // Cars/car_red_1.png
    const subDir = path.dirname(relNoTop) === '.' ? '' : path.dirname(relNoTop);
    const nameNoExt = path.basename(base, ext);

    let dim = null;
    try { const d = imageSize(fs.readFileSync(file)); dim = { width: d.width, height: d.height }; }
    catch { skippedNoDim += 1; continue; }

    const role = roleFor(subDir, base);
    const tileable = role === 'ground' && GROUND_TILEABLE.test(subDir + '/' + base);
    const key = `kenney2d/${packSlug}/${relNoTop.replace(/\\/g, '/').toLowerCase().replace(/\s+/g, '-')}`;

    assets.push({
      id: key.replace(/\.png$/, ''),
      source: 'kenney2d',
      url: R2_BASE + key,
      localPath: path.relative(PACK_ROOT, file),
      type: tileable ? 'tileable' : 'sprite',
      theme,
      role,
      orientation,
      description: `${nameNoExt.replace(/[_-]+/g, ' ')} — ${role}${orientation !== 'unknown' ? ', ' + orientation.replace('_', '-') : ''} (Kenney ${pack})`,
      width: dim.width,
      height: dim.height,
      tileable,
      pack,
    });
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  metadata: { source: 'kenney2d', generatedAt: new Date().toISOString(), totalAssets: assets.length, packs: packs.length, r2Base: R2_BASE, r2Prefix: 'kenney2d/' },
  assets,
}, null, 2));

// ── report ──
const by = (f) => assets.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (o, n = 20) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join('  ');
console.log(`✅ ingested ${assets.length} individual Kenney 2D sprites from ${packs.length} packs (skipped ${skippedNoDim} unreadable)`);
console.log('THEMES  ', top(by((a) => a.theme[0])));
console.log('ROLES   ', top(by((a) => a.role)));
console.log('ORIENT  ', top(by((a) => a.orientation)));
console.log('→', OUT);
