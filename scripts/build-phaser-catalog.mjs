#!/usr/bin/env node
/**
 * Build the Phaser 2D asset catalog — the phaser equivalent of kenney2d/pack-index.json.
 *
 * Scans public/assets (the phaser3-examples set) and indexes everything a game can actually load:
 *   - atlases      (png + TexturePacker json)  → named frames + inferred animation groups
 *   - spritesheets (png + json in animations/) → same
 *   - tilemaps     (Tiled json)                → resolved tilesets + object layers (only local, loadable ones)
 *   - loose images (sprites/*.png)             → single-frame usables
 *
 * Output: src/ai-engine/phaser2d/catalog.json (committed; small). The heavy art itself is NOT committed
 * (gitignored) — it goes to R2 separately; `rel` doubles as the R2 key suffix under phaser2d/.
 *
 * Re-run any time you drop new assets:  node scripts/build-phaser-catalog.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ASSETS = path.join(repoRoot, 'public', 'assets');
const OUT = path.join(repoRoot, 'src', 'ai-engine', 'phaser2d', 'catalog.json');

if (!fs.existsSync(ASSETS)) {
  console.error(`❌ ${ASSETS} not found — the phaser3 asset set must be present locally to build the catalog.`);
  process.exit(1);
}

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const rel = (p) => path.relative(ASSETS, p).split(path.sep).join('/');
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Group frame names into animations: "attack_A/frame0007" → attack_A; "walk0003" → walk. */
function animationGroups(frames) {
  const names = Array.isArray(frames)
    ? frames.map((f) => f.filename || '')
    : (frames && typeof frames === 'object' ? Object.keys(frames) : []);
  const groups = {};
  for (const n of names) {
    let g = String(n).split('/')[0];
    g = g.replace(/[_-]?\d+$/, '').replace(/\.(png|jpg)$/i, '');
    if (!g) g = '_';
    groups[g] = (groups[g] || 0) + 1;
  }
  // keep meaningful groups (2+ frames = likely an animation), plus singletons if that's all there is
  const multi = Object.fromEntries(Object.entries(groups).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]));
  return { count: names.length, animations: Object.keys(multi).length ? multi : groups };
}

/** Heuristic role tag from name + animation signals. Refined later by the resolver; just a starting hint. */
const CHAR_ANIMS = /run|walk|idle|jump|attack|shoot|guard|die|dead|hurt|move/i;
function classify(key, animations) {
  const k = key.toLowerCase();
  const animKeys = Object.keys(animations || {}).join(' ');
  if (/knight|soldier|hero|player|ninja|elf|elves|robo|ryu|goku|fighter|alien|astro/.test(k)) return 'character';
  if (/zombie|monster|golem|troll|ogre|spider|enemy|baddie|skeleton|slime|jelly|jellies|bat|demon/.test(k)) return 'enemy';
  if (/card|match3|banner|badge|coin|gem|diamond|ui|button|icon/.test(k)) return 'ui_item';
  if (/glade|tree|bush|forest|cloud|rock|prop|foliage|scenery/.test(k)) return 'prop';
  if (/rocket|explosion|trail|particle|fx|smoke|fire|spark/.test(k)) return 'fx';
  if (/isoblock|megaset|rotated|tp3test|tweenparts|test|swatch/.test(k)) return 'grabbag';
  if (CHAR_ANIMS.test(animKeys)) return 'character';
  return 'misc';
}

const catalog = {
  generatedAt: new Date().toISOString(),
  source: 'phaser3-examples public/assets',
  note: 'rel paths double as R2 key suffixes under phaser2d/. Heavy art is gitignored; upload separately.',
  atlases: [],
  tilemaps: [],
  images: [],
};

// ---- Atlases + animation spritesheets (png + json in atlas/ and animations/) ----
for (const dir of ['atlas', 'animations']) {
  const d = path.join(ASSETS, dir);
  if (!fs.existsSync(d)) continue;
  for (const file of fs.readdirSync(d)) {
    if (!file.endsWith('.json')) continue;
    const key = file.replace(/\.json$/, '');
    const jsonPath = path.join(d, file);
    const pngPath = path.join(d, `${key}.png`);
    if (!exists(pngPath)) continue;
    const data = readJSON(jsonPath);
    if (!data) continue;
    const tex = Array.isArray(data.textures) ? data.textures[0] : null;
    const frames = tex && tex.frames ? tex.frames : data.frames;
    if (!frames) continue;
    const { count, animations } = animationGroups(frames);
    if (!count) continue;
    const size = tex && tex.size ? [tex.size.w, tex.size.h] : null;
    catalog.atlases.push({
      key, role: classify(key, animations), type: 'atlas',
      texture: rel(pngPath), data: rel(jsonPath), frames: count, animations, size,
    });
  }
}

// ---- Tilemaps (Tiled json) — keep only those whose tilesets resolve to local files ----
const mapsDir = path.join(ASSETS, 'tilemaps', 'maps');
if (fs.existsSync(mapsDir)) {
  for (const file of fs.readdirSync(mapsDir)) {
    if (!file.endsWith('.json')) continue;
    const jsonPath = path.join(mapsDir, file);
    const data = readJSON(jsonPath);
    if (!data || !Array.isArray(data.layers)) continue;
    const tilesets = (data.tilesets || []).map((ts) => {
      const img = ts.image || '';
      // resolve relative to the map file; reject absolute/foreign paths (C:\, Dropbox, arcadestorm, ...)
      const abs = img && !/^([a-z]:|\/|.*(dropbox|arcadestorm|program files))/i.test(img)
        ? path.resolve(mapsDir, img) : null;
      const ok = abs ? exists(abs) : false;
      return { name: ts.name, image: ok ? rel(abs) : img, exists: ok };
    });
    const loadable = tilesets.length > 0 && tilesets.every((t) => t.exists);
    if (!loadable) continue; // skip maps we can't actually load
    const objectLayers = data.layers.filter((l) => l.type === 'objectgroup').map((l) => l.name);
    catalog.tilemaps.push({
      key: file.replace(/\.json$/, ''), type: 'tilemapTiledJSON', data: rel(jsonPath),
      widthTiles: data.width, heightTiles: data.height, tileSize: [data.tilewidth, data.tileheight],
      tilesets: tilesets.map((t) => ({ name: t.name, image: t.image })),
      objectLayers,
    });
  }
}

// ---- Loose single images (sprites/*.png) — usable as individual sprites ----
const spritesDir = path.join(ASSETS, 'sprites');
if (fs.existsSync(spritesDir)) {
  for (const file of fs.readdirSync(spritesDir)) {
    if (!/\.png$/i.test(file)) continue;
    const key = file.replace(/\.png$/i, '');
    catalog.images.push({ key, type: 'image', texture: rel(path.join(spritesDir, file)) });
  }
}

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 1));

const byRole = {};
for (const a of catalog.atlases) byRole[a.role] = (byRole[a.role] || 0) + 1;
console.log(`✅ Phaser catalog written: ${rel(OUT).replace('../', '')}`);
console.log(`   atlases=${catalog.atlases.length} (${Object.entries(byRole).map(([r, c]) => `${r}:${c}`).join(', ')})`);
console.log(`   tilemaps=${catalog.tilemaps.length}  loose images=${catalog.images.length}`);
console.log(`   characters: ${catalog.atlases.filter((a) => a.role === 'character').map((a) => a.key).join(', ')}`);
console.log(`   enemies:    ${catalog.atlases.filter((a) => a.role === 'enemy').map((a) => a.key).join(', ')}`);
