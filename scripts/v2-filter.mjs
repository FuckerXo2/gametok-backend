#!/usr/bin/env node
// v2 filtering pass — pack-by-pack review, keep only usable character/creature/vehicle animations.
// Every decision recorded with a reason to _review-log.json for auditability.
//
// Two decision layers:
//   1. Pack-level rules (auto-reject entire packs when the whole pack is out of scope).
//   2. Stem-level rules within a pack (keep only specific stems, reject the rest with reason).
import fs from 'fs';
import path from 'path';

const STAGING = 'v2-catalog/staging/kenney-all';
const manifest = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest.json')));

const byPack = new Map();
for (const item of manifest) {
  if (!byPack.has(item.pack)) byPack.set(item.pack, []);
  byPack.get(item.pack).push(item);
}

// --- PACK-LEVEL REJECT RULES (whole pack out of scope) ---
const PACK_REJECT_RULES = [
  { match: /^(Isometric (Modular Roads|Modular Buildings|Nature|Medieval Town|Minigolf|Space Interior|Tower Defense|Vector Buildings|Tiles Buildings|Tiles City|Tiles Base|Blocks|Tiles Vehicles))$/,
    reason: 'isometric tile/prop/vehicle-tile pack — environment, not character/vehicle sprites' },
  { match: /^(Brick Pack|Hexagon Pack|Hexagon Base Pack|Block Pack|Block Pack \(Pixel\)|Voxel Pack|Axonometric Blocks|Pixel Platformer Blocks)$/,
    reason: 'building-block/tile pack — environment' },
  { match: /^(Pattern Pack|Pattern Pack Lines|Pattern Pack Pixel|Prototype Textures|Road Textures|Road Textures \(Classic\)|Background Elements|Background Elements Remastered|Foliage Pack|Foliage Sprites|Map Pack|Minimap Pack)$/,
    reason: 'texture/pattern/background/foliage — environment' },
  { match: /^(Particle Pack|Smoke Particles|Explosion Pack|Splat Pack|Emote Pack)$/,
    reason: 'particle/effect/emote — not character/vehicle' },
  { match: /^(Medals|Ranks Pack|Playing Cards Pack|Boardgame Pack|Letter Tiles Redux|Rune Pack|Donuts|Googly Eyes|Fish Pack)$/,
    reason: 'UI/game-piece/icon pack (Fish Pack verified as HUD digits, not animals)' },
  { match: /^(Physics Assets|Generic Items|Puzzle Pack 2|Rolling Ball Assets)$/,
    reason: 'puzzle/physics prop pack — object animations, not characters' },
  { match: /^(Character Pack|Character Pack Facial Hair)$/,
    reason: 'modular character-part builder — not full-body animations' },
  { match: /^(Holiday Pack 2016|Planets)$/,
    reason: 'decorative/celestial props' },
  { match: /^Sports Pack$/,
    reason: 'top-down sports characters are 21x31 minimal blobs — visible-but-low-quality; balls are equipment' },
  { match: /^(Space Shooter Extension)$/,
    reason: 'modular space-station part kit (buildings/rockets/parts), not gameplay sprites' },
  // Small tile-only packs (filename fallback picked up a single 100+-frame tile atlas)
  { match: /^(Pico-8 City|Pixel Line Platformer|Pixel Platformer Farm Expansion|Pixel Platformer Food Expansion|Pixel Platformer Industrial Expansion|Platformer Assets Ice|Platformer Assets Pixel|Platformer Assets Requests|Platformer Assets Tile Extensions|Roguelike Base Pack|Roguelike City Pack|Tiny Battle|Tiny Dungeon|Tiny Ski|Tiny Town|Topdown Shooter|Tower Defense|RPG Tiles Vector|Scribble Platformer|Platformer Pack Medieval|Platformer Pack Nautical|Pico-8 Platformer|1-Bit Platformer Pack|Micro Roguelike|Pixel Platformer|RPG Urban Pack|Monochrome Pirates|Desert Shooter Pack|Shooting Gallery|Platformer Pack Industrial|Platformer Assets Holiday)$/,
    reason: 'tile/prop-only pack (verified: single tile-atlas group or decoration objects, no characters)' },
  // Deferred edge cases — real chars/vehicles but wrongly grouped as color-variant grids
  { match: /^(RTS Medieval|RTS Medieval \(Pixel\)|RTS Sci-fi)$/,
    reason: 'DEFERRED: color-variant grid (real units but 4 colors × 4 poses grouped as one 16-frame anim) — needs splitter' },
  { match: /^(Racing Pack)$/,
    reason: 'DEFERRED: cars are 5 different vehicle models (color variants) grouped as 5-frame anim — needs splitter' },
  { match: /^(Tank Pack)$/,
    reason: 'DEFERRED: tanks_tank* are 5 different tank angles/rotations grouped as anim — plus bullets/tracks/explosions (props)' },
  { match: /^(Topdown Tanks Remastered)$/,
    reason: 'bullets/tiles/explosions + tankX_barrel (weapon parts, not vehicle bodies)' },
  { match: /^(Topdown Tanks)$/,
    reason: 'smoke particles only — no tank bodies in this pack' },
  { match: /^(Pixel Shmup)$/,
    reason: 'DEFERRED: ship is 24-vehicle color-variant grid + tile atlas' },
  { match: /^(Pirate Pack|Monochrome RPG Tileset)$/,
    reason: 'DEFERRED: real characters/ships but grouped as color-variant grids (Pirate ship=24 designs, RPG char/enemy=4-color grid)' },
  { match: /^(Space Shooter Remastered)$/,
    reason: 'DEFERRED: playerShip damage OK (3 stems) but rest is color-variant enemies, modular wing/cockpit parts, effects, HUD' },
  { match: /^(Pixel Vehicle Pack)$/,
    reason: 'DEFERRED: tiny 11×15 pixel walk cycles — real but too small/low-quality for use even at scaled sizes' },
  { match: /^(New Platformer Pack)$/,
    reason: 'hud_character is 0-9 HUD digits, not a character' },
];

// --- STEM-LEVEL RULES (partial-keep packs) ---
// Each entry: pack → { keepFn(stem) → boolean, keepReason, rejectReason(stem) }
const PACK_STEM_RULES = {
  'Toon Characters': {
    keep: () => true,
    keepReason: 'verified: 6 humanoid characters × 6 poses (attack, cheer, climb, run, switch, walk), side-view, quality 5',
  },
  'Platformer Characters 1': {
    keep: () => true,
    keepReason: 'verified: 5 characters (adventurer, female, player, soldier, zombie) × 6 poses (action, cheer, climb, hold, swim, walk), side-view, quality 4',
  },
  'Isometric Watercraft': {
    keep: () => true,
    keepReason: 'verified: 29 boat designs × 8 rotation angles, isometric — usable for iso movement (rotation cycle, not walk)',
  },
  'Robot Pack': {
    keep: (stem) => /^robot_(blue|green|red|yellow)(Damage|Drive)$/.test(stem),
    keepReason: 'verified: 4 robot colors × (Damage, Drive) side-view 2-frame animations',
    rejectReason: 'tracks_back/long/short are track-piece props, not the robot itself',
  },
  'Alien UFO Pack': {
    keep: (stem) => /^ship\w+_damage$/i.test(stem),
    keepReason: 'verified: 4 UFO colors × damage animation (2 frames)',
    rejectReason: 'laser variants are projectiles, not vehicles',
  },
  'Tappy Plane': {
    keep: (stem) => /^plane\w+$/i.test(stem),
    keepReason: 'verified: 4 plane colors × 3-frame bank/wobble flight animation',
    rejectReason: 'number is HUD digits',
  },
  'Abstract Platformer': {
    keep: (stem) => /^(enemy|player)/i.test(stem),
    keepReason: 'verified: 6 enemies (Floating, Flying, FlyingAlt, Spikey, Swimming, Walking) × 4 frames + 4 players × 4 poses (swim, switch, up, walk), side-view',
    rejectReason: 'plant/tile groups are environment',
  },
  'Jumper Pack': {
    keep: (stem) => /(bunny|spikeMan|wingMan)/i.test(stem),
    keepReason: 'verified: bunny1_walk, bunny2_walk (side-view animal walks), spikeMan_walk (enemy), wingMan (5-frame flying character)',
    rejectReason: 'bronze/gold/silver = medals; grass/sun = env; spikeBall = obstacle',
  },
  'Platformer Assets Base': {
    keep: (stem) => /(fishSwim|flyFly|slimeWalk|snailWalk|^p\d_walk$)/i.test(stem),
    keepReason: 'verified: fishSwim, flyFly, slimeWalk, snailWalk (4 creatures) + p1/p2/p3_walk (3 characters × 11-frame walk cycles)',
    rejectReason: 'hud/hud_p/cloud are HUD/env',
  },
  'Platformer Assets Extra Animations & Enemies': {
    keep: (stem) => /^(alien\w+|spider_walk)$/i.test(stem),
    keepReason: 'verified: 5 alien colors × 3 poses (climb, swim, walk) + spider_walk creature',
  },
  'Platformer Pack Remastered': {
    keep: (stem) => /^alien\w+_(climb|swim|walk)$/i.test(stem),
    keepReason: 'verified: 5 alien colors × 3 poses (climb, swim, walk), side-view',
    rejectReason: 'flag colors are props; hud is UI; torch is env',
  },
  'Sokoban Pack': {
    keep: () => false,
    keepReason: '',
    rejectReason: 'DEFERRED: player groups are 24-item color+direction grids (all 4 characters × 4 directions × frames baked in) — needs splitter; block/crate/environment/ground are props',
  },
  'Simplified Platformer Pack': {
    keep: (stem) => /^platformChar_(climb|walk)$/i.test(stem),
    keepReason: 'verified: yellow robot character, climb + walk animations',
    rejectReason: 'platformPack_item/tile are env',
  },
};

// --- APPLY RULES ---
const decisions = {};
const kept = [];
const rejected = [];
const deferred = [];

for (const [pack, items] of byPack) {
  const packRule = PACK_REJECT_RULES.find(r => r.match.test(pack));
  if (packRule) {
    decisions[pack] = { decision: 'reject_all', reason: packRule.reason, count: items.length };
    for (const item of items) {
      const bucket = packRule.reason.startsWith('DEFERRED') ? deferred : rejected;
      bucket.push({ id: item.id, pack, stem: item.stem, reason: packRule.reason });
    }
    continue;
  }

  const stemRule = PACK_STEM_RULES[pack];
  if (!stemRule) {
    // Unhandled pack — mark for manual attention (shouldn't happen after this pass)
    decisions[pack] = { decision: 'unreviewed', reason: 'no rule matched', count: items.length };
    for (const item of items) rejected.push({ id: item.id, pack, stem: item.stem, reason: 'no rule matched' });
    continue;
  }

  const keptStems = [], rejectedStems = [];
  const isDeferred = /^DEFERRED/.test(stemRule.rejectReason || '');
  for (const item of items) {
    if (stemRule.keep(item.stem)) {
      kept.push({ id: item.id, pack, stem: item.stem, frameCount: item.frameCount, reason: stemRule.keepReason });
      keptStems.push(item.stem);
    } else {
      const bucket = isDeferred ? deferred : rejected;
      bucket.push({ id: item.id, pack, stem: item.stem, reason: stemRule.rejectReason || 'not in keep-list' });
      rejectedStems.push(item.stem);
    }
  }
  const decision = keptStems.length === items.length ? 'keep_all'
    : (keptStems.length ? 'keep_partial' : (isDeferred ? 'defer_all' : 'reject_all'));
  decisions[pack] = {
    decision,
    reason: keptStems.length ? stemRule.keepReason : (stemRule.rejectReason || 'not in keep-list'),
    kept: keptStems.length,
    rejected: rejectedStems.length,
    total: items.length,
  };
}

// --- REPORT ---
console.log(`\n=== FILTER PASS COMPLETE ===`);
console.log(`Input sequences: ${manifest.length}`);
console.log(`✅ Kept:      ${kept.length}`);
console.log(`❌ Rejected:  ${rejected.length}`);
console.log(`⏸  Deferred:  ${deferred.length} (edge cases for color-variant splitter task)`);
console.log(`\n=== PER-PACK DECISIONS ===`);
for (const [pack, d] of Object.entries(decisions).sort((a,b)=>(b[1].kept||0)-(a[1].kept||0))) {
  const n = d.total ?? d.count ?? 0;
  if (d.decision === 'reject_all') console.log(`  ❌ ${pack}: ${n} rejected — ${d.reason}`);
  else if (d.decision === 'defer_all') console.log(`  ⏸  ${pack}: ${n} deferred — ${d.reason}`);
  else if (d.decision === 'keep_all') console.log(`  ✅ ${pack}: all ${n} kept — ${d.reason}`);
  else if (d.decision === 'keep_partial') console.log(`  ◐  ${pack}: ${d.kept}/${n} kept, ${d.rejected} rejected — ${d.reason}`);
  else console.log(`  ⚠️  ${pack}: ${n} UNREVIEWED — ${d.reason}`);
}

fs.writeFileSync(path.join(STAGING, '_review-log.json'), JSON.stringify({
  summary: {
    input: manifest.length,
    kept: kept.length,
    rejected: rejected.length,
    deferred: deferred.length,
  },
  decisions,
  kept,
  rejected,
  deferred,
}, null, 2));
console.log(`\nReview log: ${path.join(STAGING, '_review-log.json')}`);

// --- WRITE CURATED MANIFEST ---
const keptIds = new Set(kept.map(k => k.id));
const curatedManifest = manifest.filter(item => keptIds.has(item.id));
fs.writeFileSync(path.join(STAGING, '_manifest-curated.json'), JSON.stringify(curatedManifest, null, 2));
console.log(`Curated manifest: ${path.join(STAGING, '_manifest-curated.json')} (${curatedManifest.length} items)`);
