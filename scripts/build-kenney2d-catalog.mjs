#!/usr/bin/env node
// Build a searchable catalog of the Kenney All-in-1 2D sprites from a local pack.
//
// Mirrors build-kenney3d-catalog.mjs but for 2D, with three differences the 2D library forces:
//   1. SCALE (~37.5k sprites): we emit a SPLIT catalog — a lightweight pack-index.json (one entry
//      per pack, the only thing retrieval scans) plus per-pack manifest files packs/<pack>.json
//      (loaded only for the ONE pack a game picks). A single flat JSON would be ~8MB and unusable.
//   2. CAPABILITIES: each pack declares which logical roles it can fill (player/enemies/tiles/items/
//      projectiles/vehicles/ui/background/effects + animation actions), inferred from the sprite
//      categories actually present. Retrieval scores on "can this pack build the requested game?"
//   3. ANIMATION: real frame sequences (foo_walk1, foo_walk2, foo_jump) are grouped into named
//      animations per character at catalog time — this is what later replaces the fake squash.
//
// The pack itself is NOT committed (lives outside the repo). GLB/PNG bytes go to R2 separately;
// this only writes the committed index.
//
// Usage:
//   node scripts/build-kenney2d-catalog.mjs
//   node scripts/build-kenney2d-catalog.mjs "/path/to/Kenney Game Assets All-in-1 3"

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const bundleDir = process.argv[2]
  || path.resolve(repoRoot, '..', 'Kenney Game Assets All-in-1 3');

// We index the "2D assets" tree and the "UI assets" tree (the latter flagged ui:true).
const ROOTS = [
  { dir: path.join(bundleDir, '2D assets'), ui: false },
  { dir: path.join(bundleDir, 'UI assets'), ui: true },
];
if (!ROOTS.some((r) => fs.existsSync(r.dir))) {
  console.error(`[kenney2d] No "2D assets"/"UI assets" under: ${bundleDir}\nPass the bundle dir as the first argument.`);
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();

function tokenize(...parts) {
  const raw = parts.join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-/.()]+/g, ' ')
    .toLowerCase();
  return [...new Set(raw.split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w)))];
}

// Drop previews, license blobs, hi-dpi duplicates and combined sheets — we want the individual sprites.
// Also drop texture-CHANNEL maps (colormap/normalmap/roughness/…) — salvaged from the v1 intelligence
// curator's noise list; these are never gameplay sprites. (We do NOT nuke letter*/number* like v1 did —
// those are core assets in the Letter Tiles packs, and v1 could only drop them because it was lane-scoped.)
function shouldSkip(name) {
  return /preview|sample|license|readme|placeholder/i.test(name)
    || /tilesheet|spritesheet|_sheet\b|sheet@|@2x|@retina|_retina|_double/i.test(name)
    || /^(?:tilemap|colormap|normalmap|roughnessmap|metalnessmap|heightmap|specularmap|occlusionmap)\b/i.test(name)
    || /_(?:normal|roughness|metalness|specular|height|occlusion)(?:map)?$/i.test(name);
}

// Category by in-pack path + filename (rough but enough for pack-level capability signals). Folder
// names like "Tiles"/"Zombie 1"/"Enemies" carry strong signal, so we test the path within the pack
// (NOT the pack name itself — "Character Pack" would force everything). Order matters: enemy before
// character, etc. The Asset Resolver does the fine logical-role mapping later.
const CATEGORY_RULES = [
  ['enemy', /enemy|enemies|zombie|slime|spider|snake|\bbat\b|ghost|skeleton|\borc\b|\bbee\b|worm|snail|mouse|ladybug|blob|\bimp\b|goblin|monster|wasp|piranha|vampire|demon/i],
  ['character', /character|player|\bhero\b|alien|person|astronaut|ninja|adventurer|knight|soldier|survivor|hitman|wizard|archer|keeper|\bhuman\b|\bgirl\b|\bboy\b|\bman\b|woman|robot|pirate|\bnpc\b|villager/i],
  ['vehicle', /\bcar\b|truck|\btank\b|\bship\b|\bplane\b|\bboat\b|vehicle|rocket|\bjet\b|train|\bkart\b|motorcycle|racer/i],
  ['projectile', /bullet|laser|projectile|arrow|missile|\bbomb\b|fireball|\borb\b|\bshot\b|spike|cannonball/i],
  ['ui', /\bui\b|button|\bicon\b|cursor|crosshair|\bmedal\b|\brank\b|minimap|emote|smilie|smiley|googly|\bbadge\b|\bpanel\b|\bframe\b|checkbox|slider/i],
  ['item', /\bcoin\b|\bgem\b|\bkey\b|heart|\bstar\b|food|fruit|cake|donut|potion|powerup|\bflag\b|\bdoor\b|chest|crate|\bgold\b|diamond|trophy|\bgift\b|\bball\b|mushroom|cherry|apple|generic item|\bitem\b|\bcard\b|letter/i],
  ['background', /background|backdrop|\bsky\b|cloud|\bhill\b|mountain|foliage|\btree\b|bush|forest|\bwater\b|\bmoon\b|\bsun\b|planet|pattern/i],
  ['effect', /explosion|smoke|particle|splat|spark|flash|\bfire\b|\bdust\b|\bpuff\b|impact/i],
  ['tile', /\btile\b|\bblock\b|ground|platform|brick|terrain|dirt|\bwall\b|floor|stone|grass|\bsand\b|\bsnow\b|slab|bridge|fence|ladder|\bpipe\b|\bbox\b|\broad\b|texture|building|modular|dungeon/i],
];
// Split camelCase + strip separators/digits so "towerDefense_tile001" -> "tower defense tile" and the
// \b-anchored rules above actually fire (without this, "tile001" has no boundary after "tile").
function normForCat(text) {
  return String(text).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-/.()0-9]+/g, ' ').toLowerCase();
}
function categorize(text, isUI) {
  if (isUI) return 'ui';
  const t = normForCat(text);
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return 'prop';
}

// Capability hints from the PACK NAME — backfills capabilities for packs whose individual sprite
// names are too generic to categorize (Monster Builder = arm_/body_, Generic Items, Medals, etc.).
// OR'd with the sprite-category-derived capabilities.
const PACK_HINTS = [
  [/character|monster builder|toon|people|\bnpc\b|\bhero\b|adventurer|roguelike char|villager|shape character/i, ['player']],
  [/monster|\bzombie\b|\benemy\b|enemies|creature/i, ['enemies']],
  [/tile|platformer|dungeon|tower defense|isometric|\brts\b|roguelike|\btown\b|\bcity\b|building|\broad\b|\bmap\b|brick|block|terrain|nautical|medieval|holiday|\bski\b|sokoban|hexagon/i, ['tiles']],
  [/\bitem\b|\bfood\b|\bcoin\b|\bgem\b|loot|pickup|generic item|donut|playing card|letter|rune|ranks/i, ['items']],
  [/shooter|shmup|space shooter|\btank\b|weapon|blast/i, ['projectiles']],
  [/background|\bsky\b|foliage|nature|texture|pattern|planet|cloud/i, ['background']],
  [/\bui\b|button|\bmedal\b|\brank\b|cursor|crosshair|\bicon\b|minimap|emote|smilie|googly|fantasy ui/i, ['ui']],
  [/vehicle|\bcar\b|racing|\btank\b|\bship\b|watercraft|\btrain\b|pirate/i, ['vehicles']],
  [/explosion|smoke|particle|splat/i, ['effects']],
];

function inferStyle(pack) {
  if (/pixel|pico-?8|1-?bit|8-?bit/i.test(pack)) return 'pixel';
  if (/vector/i.test(pack)) return 'vector';
  if (/scribble|sketch|\bhand\b/i.test(pack)) return 'sketch';
  if (/monochrome|\bmono\b/i.test(pack)) return 'monochrome';
  return 'flat-cartoon';
}

// Animation actions we recognize as frame-sequence verbs.
const ACTIONS = 'walk|run|jump|climb|idle|attack|hurt|dead|die|fall|duck|swim|fly|hit|shoot|roll|slide|kick|punch|crouch|stand|cheer|talk|wave';
const ANIM_RE = new RegExp(`^(.+?)_(${ACTIONS})(\\d*)$`, 'i');

// Group a pack's sprites into named animations: { character, name, frames:[ids in order] }.
function groupAnimations(sprites) {
  const groups = new Map(); // base::action -> [{frame, id}]
  for (const s of sprites) {
    const m = s.name.match(ANIM_RE);
    if (!m) continue;
    const base = m[1];
    const action = m[2].toLowerCase();
    const frame = m[3] === '' ? 0 : parseInt(m[3], 10);
    const key = `${base}::${action}`;
    if (!groups.has(key)) groups.set(key, { character: base, name: action, items: [] });
    groups.get(key).items.push({ frame, id: s.id });
  }
  const out = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.frame - b.frame);
    // single isolated pose (one frame) is still a valid 1-frame animation (jump/hurt)
    out.push({ character: g.character, name: g.name, frames: g.items.map((i) => i.id) });
  }
  return out.sort((a, b) => a.character.localeCompare(b.character) || a.name.localeCompare(b.name));
}

// Read width/height from a PNG IHDR without decoding the image (8-byte sig, then len+IHDR, then w,h).
function pngSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch { return null; }
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && /\.(png|svg)$/i.test(e.name)) out.push(full);
  }
}

// ── crawl + dedup ────────────────────────────────────────────────────────────
// Kenney ships each sprite in several folders: PNG vs Vector (svg), and standard vs "HD"/"@2x".
// They're the SAME logical sprite, so we dedup by (pack, name), preferring standard-res PNG over
// HD over SVG — otherwise animation frames double up and counts inflate.
const candidates = new Map(); // `${pack}|${name}` -> best candidate

const isHiDpi = (rel) => /\bHD\b|retina|@2x|_double\b|\/2x\//i.test(rel);
const prefScore = (ext, hd) => (ext === 'png' ? 100 : 50) - (hd ? 10 : 0);

for (const root of ROOTS) {
  if (!fs.existsSync(root.dir)) continue;
  const files = [];
  walk(root.dir, files);
  for (const full of files) {
    const rel = path.relative(root.dir, full);          // "Pixel Platformer/Tiles/tile_0001.png"
    const segs = rel.split(path.sep);
    const pack = segs[0];
    const inPackPath = segs.slice(1).join('/');         // path WITHIN the pack (folders carry category signal)
    const name = path.basename(full).replace(/\.(png|svg)$/i, '');
    if (shouldSkip(name)) continue;
    const ext = path.extname(full).slice(1).toLowerCase();
    const score = prefScore(ext, isHiDpi(rel));
    const key = `${pack}|${name}`;
    const prev = candidates.get(key);
    if (prev && prev.score >= score) continue;
    candidates.set(key, { pack, name, inPackPath, ext, full, ui: root.ui, score,
      rel: path.join(root.ui ? 'UI assets' : '2D assets', rel) });
  }
}

const byPack = new Map(); // pack -> { ui, sprites:[] }
let totalSprites = 0;
for (const c of candidates.values()) {
  const size = c.ext === 'png' ? pngSize(c.full) : null;
  const rec = {
    id: `${slug(c.pack)}/${c.name}`,
    name: c.name,
    category: categorize(c.inPackPath, c.ui),
    ext: c.ext,
    rel: c.rel,
    ...(size ? { w: size.w, h: size.h } : {}),
  };
  if (!byPack.has(c.pack)) byPack.set(c.pack, { pack: c.pack, ui: c.ui, sprites: [] });
  byPack.get(c.pack).sprites.push(rec);
  totalSprites += 1;
}

// ── emit ───────────────────────────────────────────────────────────────────
const outDir = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d');
const packsDir = path.join(outDir, 'packs');
fs.mkdirSync(packsDir, { recursive: true });

const index = [];
const CAP_FROM_CATEGORY = {
  character: 'player', enemy: 'enemies', tile: 'tiles', item: 'items',
  projectile: 'projectiles', vehicle: 'vehicles', ui: 'ui', background: 'background', effect: 'effects',
};

for (const entry of [...byPack.values()].sort((a, b) => a.pack.localeCompare(b.pack))) {
  entry.sprites.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const animations = groupAnimations(entry.sprites);

  const cats = {};
  for (const s of entry.sprites) cats[s.category] = (cats[s.category] || 0) + 1;

  const capabilities = {};
  for (const [cat, cap] of Object.entries(CAP_FROM_CATEGORY)) capabilities[cap] = (cats[cat] || 0) > 0;
  if (entry.ui) capabilities.ui = true;
  // Backfill from pack-name hints (handles packs with too-generic sprite names).
  for (const [re, caps] of PACK_HINTS) if (re.test(entry.pack)) for (const c of caps) capabilities[c] = true;
  capabilities.animations = [...new Set(animations.map((a) => a.name))].sort();

  const packId = slug(entry.pack);
  const manifest = {
    pack: entry.pack,
    packId,
    style: inferStyle(entry.pack),
    ui: entry.ui,
    spriteCount: entry.sprites.length,
    categories: cats,
    capabilities,
    animations,
    sprites: entry.sprites,
  };
  fs.writeFileSync(path.join(packsDir, `${packId}.json`), JSON.stringify(manifest, null, 0));

  index.push({
    pack: entry.pack,
    packId,
    style: manifest.style,
    ui: entry.ui,
    genreTags: tokenize(entry.pack),
    spriteCount: entry.sprites.length,
    categories: cats,
    capabilities,
  });
}

const packIndex = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'Kenney Game Assets All-in-1 (2D + UI)',
  totalPacks: index.length,
  totalSprites,
  packs: index,
};
fs.writeFileSync(path.join(outDir, 'pack-index.json'), JSON.stringify(packIndex, null, 0));

console.log(`[kenney2d] ${totalSprites} sprites across ${index.length} packs`);
console.log(`[kenney2d]   -> ${path.relative(repoRoot, path.join(outDir, 'pack-index.json'))}`);
console.log(`[kenney2d]   -> ${path.relative(repoRoot, packsDir)}/<pack>.json (${index.length} files)`);
const withAnim = index.filter((p) => p.capabilities.animations.length).length;
console.log(`[kenney2d] packs with animations: ${withAnim}`);
