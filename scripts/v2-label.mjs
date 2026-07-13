#!/usr/bin/env node
// v2 asset labeling — apply the canonical retrieval schema to every curated asset.
//
// SCHEMA (all fields required, controlled enums where possible):
//   id                  string   unique catalog id (from ingest)
//   asset_type          enum     character | creature | vehicle
//   species             enum     see SPECIES enum below
//   animation_type      enum     walk | run | idle | attack | cheer | climb | swim | hold |
//                                fly | damage | drive | turn | action | rotate
//   perspective         enum     side | top_down | isometric | front
//   movement            enum     ground | air | water
//   theme               enum     platformer | sci_fi | nautical | casual | abstract
//   playable_role       enum     player | enemy | npc | generic
//   frame_count         number   from atlas
//   canvas_size         {w,h}    from atlas
//   source_pack         string   Kenney pack name
//   quality_score       1–5      visual quality bucket
//   confidence_score    0–1      label-derivation confidence
//   description         string   free-text visual description (retained for embedding)
//   search_text         string   flat token bag for keyword fallback
//   atlas_ref           object   sheet/preview paths + animation frame ranges
//
// Rules are per (pack, stem-pattern). Every rule produces a full schema-valid label. If any rule
// misses an item the script fails loudly rather than shipping partial labels.
import fs from 'fs';
import path from 'path';

const STAGING = 'v2-catalog/staging/kenney-all';
const curated = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest-curated.json')));

// --- ENUM DEFINITIONS ---
const ENUMS = {
  asset_type:     ['character', 'creature', 'vehicle'],
  species:        [
    // humanoid categories
    'human', 'alien', 'robot', 'zombie', 'wingman', 'spikeman',
    // non-humanoid creatures
    'bunny', 'spider', 'fish', 'fly', 'slime', 'snail', 'monster',
    // vehicles
    'ufo', 'plane', 'boat', 'spaceship',
  ],
  animation_type: ['walk', 'run', 'idle', 'attack', 'cheer', 'climb', 'swim', 'hold', 'fly',
                   'damage', 'drive', 'turn', 'action', 'rotate'],
  perspective:    ['side', 'top_down', 'isometric', 'front'],
  movement:       ['ground', 'air', 'water'],
  theme:          ['platformer', 'sci_fi', 'nautical', 'casual', 'abstract'],
  playable_role:  ['player', 'enemy', 'npc', 'generic'],
};

// --- HELPERS ---
const humanCharDesc = {
  femaleAdventurer: 'young female adventurer, brown hair with blue headband, blue tunic outfit',
  femalePerson:     'female character, dark hair with headband, green shirt, purple shorts',
  maleAdventurer:   'young male adventurer, brown hair, green vest over white shirt, brown trousers',
  malePerson:       'muscular male character with mustache, black hair, orange and white outfit',
  robot:            'blue robot character with glowing chest light',
  zombie:           'green-skinned zombie, torn purple shirt, orange pants, glowing yellow eyes',
};
const platformerCharDesc = {
  adventurer: 'male adventurer character, flat-shaded platformer style',
  female:     'female character, flat-shaded platformer style',
  player:     'generic player character, flat-shaded platformer style',
  soldier:    'soldier character with helmet and rifle, flat-shaded platformer style',
  zombie:     'zombie character, flat-shaded platformer style',
};
const alienColorDesc = {
  Beige:  'beige/tan alien astronaut, round bubble helmet',
  Blue:   'blue alien astronaut, round bubble helmet',
  Green:  'green alien astronaut, round bubble helmet',
  Pink:   'pink alien astronaut, round bubble helmet',
  Yellow: 'yellow alien astronaut, round bubble helmet',
};
const robotColorDesc = {
  blue: 'blue humanoid robot on tank treads', green: 'green humanoid robot on tank treads',
  red:  'red humanoid robot on tank treads',  yellow: 'yellow humanoid robot on tank treads',
};
const ufoColorDesc = {
  Beige:  'beige/tan alien UFO spaceship',
  Blue:   'blue alien UFO spaceship',
  Green:  'green alien UFO spaceship',
  Yellow: 'yellow alien UFO spaceship',
};
const planeColorDesc = {
  Blue:   'blue cartoon biplane', Green:  'green cartoon biplane',
  Red:    'red cartoon biplane',  Yellow: 'yellow cartoon biplane',
};

const ANIM_LABELS = {
  attack: 'attack animation', cheer: 'cheer/celebrate animation', climb: 'climbing animation',
  run:    'run cycle',        turn:   'direction-turn animation',  walk:  'walk cycle',
  swim:   'swim animation',   hold:   'hold/carry pose',           action: 'generic action pose',
  fly:    'flight animation', damage: 'damage/hurt state animation', drive: 'driving/rolling animation',
  rotate: '8-direction rotation cycle', idle: 'idle animation',
};

// --- PER-PACK LABELING RULES ---
// Each entry is a function (item) → label object (schema fields). Returns null to signal
// "this rule does not apply" so the dispatcher can try the next.
const PACK_RULES = {
  'Toon Characters': (item) => {
    // XML groups pose stems ("walk", "climb", ...) but character identity is in the source folder,
    // encoded in the id path as `{stem}__{folder_snake_case}_{w}x{h}`.
    if (!['attack', 'cheer', 'climb', 'run', 'switch', 'walk'].includes(item.stem)) return null;
    const idTail = item.id.split('/').pop(); // e.g. "walk__female_adventurer_96x128"
    const charMatch = idTail.match(/^\w+__(female_adventurer|female_person|male_adventurer|male_person|robot|zombie)_/);
    if (!charMatch) return null;
    const charKey = charMatch[1];
    const descKey = { female_adventurer: 'femaleAdventurer', female_person: 'femalePerson',
                      male_adventurer: 'maleAdventurer', male_person: 'malePerson',
                      robot: 'robot', zombie: 'zombie' }[charKey];
    const anim = item.stem === 'switch' ? 'turn' : item.stem;
    const species = charKey === 'robot' ? 'robot' : (charKey === 'zombie' ? 'zombie' : 'human');
    return {
      asset_type: 'character', species, animation_type: anim,
      perspective: 'side', movement: 'ground', theme: 'casual',
      playable_role: 'generic', quality_score: 5, confidence_score: 1.0,
      description: `${humanCharDesc[descKey]}, ${ANIM_LABELS[anim]} (${item.frameCount} frames)`,
    };
  },

  'Platformer Characters 1': (item) => {
    const m = item.stem.match(/^(adventurer|female|player|soldier|zombie)_(action|cheer|climb|hold|swim|walk)$/);
    if (!m) return null;
    const [, char, pose] = m;
    const species = char === 'zombie' ? 'zombie' : 'human';
    return {
      asset_type: 'character', species, animation_type: pose,
      perspective: 'side', movement: 'ground', theme: 'platformer',
      playable_role: 'generic', quality_score: 4, confidence_score: 1.0,
      description: `${platformerCharDesc[char]}, ${ANIM_LABELS[pose]} (${item.frameCount} frames)`,
    };
  },

  'Isometric Watercraft': (item) => {
    const m = item.stem.match(/^watercraftPack_(\d+)$/);
    if (!m) return null;
    return {
      asset_type: 'vehicle', species: 'boat', animation_type: 'rotate',
      perspective: 'isometric', movement: 'water', theme: 'nautical',
      playable_role: 'generic', quality_score: 4, confidence_score: 1.0,
      description: `isometric boat/watercraft design #${m[1]}, ${ANIM_LABELS.rotate}`,
    };
  },

  'Abstract Platformer': (item) => {
    let m = item.stem.match(/^enemy(Floating|Flying|FlyingAlt|Spikey|Swimming|Walking)$/);
    if (m) return {
      asset_type: 'creature', species: 'monster',
      animation_type: m[1].toLowerCase().startsWith('swim') ? 'swim' : (m[1].toLowerCase().startsWith('fly') ? 'fly' : 'walk'),
      perspective: 'side',
      movement: m[1].toLowerCase().startsWith('swim') ? 'water' : (m[1].toLowerCase().startsWith('fly') ? 'air' : 'ground'),
      theme: 'abstract', playable_role: 'enemy', quality_score: 3, confidence_score: 0.85,
      description: `abstract geometric ${m[1].toLowerCase()} enemy, simple flat shape (${item.frameCount} frames)`,
    };
    m = item.stem.match(/^player(Blue|Green|Grey|Red)_(swim|switch|up|walk)$/);
    if (m) {
      const [, color, poseRaw] = m;
      const anim = poseRaw === 'switch' ? 'turn' : (poseRaw === 'up' ? 'action' : poseRaw);
      return {
        asset_type: 'character', species: 'alien',
        animation_type: anim, perspective: 'side',
        movement: anim === 'swim' ? 'water' : 'ground',
        theme: 'abstract', playable_role: 'player', quality_score: 3, confidence_score: 0.9,
        description: `abstract ${color.toLowerCase()} player character (simple flat shape), ${ANIM_LABELS[anim]} (${item.frameCount} frames)`,
      };
    }
    return null;
  },

  'Platformer Assets Extra Animations & Enemies': (item) => {
    let m = item.stem.match(/^alien(Beige|Blue|Green|Pink|Yellow)_(climb|swim|walk)$/);
    if (m) return {
      asset_type: 'character', species: 'alien', animation_type: m[2],
      perspective: 'side', movement: m[2] === 'swim' ? 'water' : 'ground',
      theme: 'platformer', playable_role: 'enemy', quality_score: 4, confidence_score: 1.0,
      description: `${alienColorDesc[m[1]]}, ${ANIM_LABELS[m[2]]} (${item.frameCount} frames)`,
    };
    if (item.stem === 'spider_walk') return {
      asset_type: 'creature', species: 'spider', animation_type: 'walk',
      perspective: 'side', movement: 'ground', theme: 'platformer',
      playable_role: 'enemy', quality_score: 4, confidence_score: 1.0,
      description: `black spider, walk cycle (${item.frameCount} frames)`,
    };
    return null;
  },

  'Platformer Pack Remastered': (item) => {
    const m = item.stem.match(/^alien(Beige|Blue|Green|Pink|Yellow)_(climb|swim|walk)$/);
    if (!m) return null;
    return {
      asset_type: 'character', species: 'alien', animation_type: m[2],
      perspective: 'side', movement: m[2] === 'swim' ? 'water' : 'ground',
      theme: 'platformer', playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `${alienColorDesc[m[1]]} (remastered), ${ANIM_LABELS[m[2]]} (${item.frameCount} frames)`,
    };
  },

  'Robot Pack': (item) => {
    const m = item.stem.match(/^robot_(blue|green|red|yellow)(Damage|Drive)$/);
    if (!m) return null;
    const [, color, stateRaw] = m;
    const anim = stateRaw === 'Damage' ? 'damage' : 'drive';
    return {
      asset_type: 'character', species: 'robot', animation_type: anim,
      perspective: 'side', movement: 'ground', theme: 'sci_fi',
      playable_role: 'generic', quality_score: 4, confidence_score: 1.0,
      description: `${robotColorDesc[color]}, ${ANIM_LABELS[anim]} (${item.frameCount} frames)`,
    };
  },

  'Platformer Assets Base': (item) => {
    const creatureMap = {
      fishSwim:  { species: 'fish',  animation_type: 'swim', movement: 'water', desc: 'blue fish, side view' },
      flyFly:    { species: 'fly',   animation_type: 'fly',  movement: 'air',   desc: 'small housefly, side view' },
      slimeWalk: { species: 'slime', animation_type: 'walk', movement: 'ground', desc: 'green slime blob, side view' },
      snailWalk: { species: 'snail', animation_type: 'walk', movement: 'ground', desc: 'brown-shelled snail, side view' },
    };
    if (creatureMap[item.stem]) {
      const c = creatureMap[item.stem];
      return {
        asset_type: 'creature', species: c.species, animation_type: c.animation_type,
        perspective: 'side', movement: c.movement, theme: 'platformer',
        playable_role: 'enemy', quality_score: 4, confidence_score: 1.0,
        description: `${c.desc}, ${ANIM_LABELS[c.animation_type]} (${item.frameCount} frames)`,
      };
    }
    const p = item.stem.match(/^p(\d)_walk$/);
    if (p) return {
      asset_type: 'character', species: 'alien', animation_type: 'walk',
      perspective: 'side', movement: 'ground', theme: 'platformer',
      playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `Kenney Platformer alien astronaut player ${p[1]} (green/red/blue variant), 11-frame walk cycle`,
    };
    return null;
  },

  'Alien UFO Pack': (item) => {
    const m = item.stem.match(/^ship(Beige|Blue|Green|Yellow)_damage$/);
    if (!m) return null;
    return {
      asset_type: 'vehicle', species: 'ufo', animation_type: 'damage',
      perspective: 'top_down', movement: 'air', theme: 'sci_fi',
      playable_role: 'enemy', quality_score: 4, confidence_score: 1.0,
      description: `${ufoColorDesc[m[1]]}, ${ANIM_LABELS.damage} (${item.frameCount} frames)`,
    };
  },

  'Jumper Pack': (item) => {
    if (/^bunny\d_walk$/.test(item.stem)) return {
      asset_type: 'creature', species: 'bunny', animation_type: 'walk',
      perspective: 'side', movement: 'ground', theme: 'casual',
      playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `cute cartoon bunny, side-view walk cycle (${item.frameCount} frames)`,
    };
    if (item.stem === 'spikeMan_walk') return {
      asset_type: 'creature', species: 'spikeman', animation_type: 'walk',
      perspective: 'side', movement: 'ground', theme: 'casual',
      playable_role: 'enemy', quality_score: 4, confidence_score: 0.9,
      description: `spiky purple monster with feet, side-view walk cycle (${item.frameCount} frames)`,
    };
    if (item.stem === 'wingMan') return {
      asset_type: 'character', species: 'wingman', animation_type: 'fly',
      perspective: 'side', movement: 'air', theme: 'casual',
      playable_role: 'enemy', quality_score: 4, confidence_score: 0.9,
      description: `winged humanoid enemy, 5-frame flight animation`,
    };
    return null;
  },

  'Tappy Plane': (item) => {
    const m = item.stem.match(/^plane(Blue|Green|Red|Yellow)$/);
    if (!m) return null;
    return {
      asset_type: 'vehicle', species: 'plane', animation_type: 'fly',
      perspective: 'side', movement: 'air', theme: 'casual',
      playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `${planeColorDesc[m[1]]}, bank/wobble flight animation (${item.frameCount} frames)`,
    };
  },

  'Simplified Platformer Pack': (item) => {
    const m = item.stem.match(/^platformChar_(climb|walk)$/);
    if (!m) return null;
    return {
      asset_type: 'character', species: 'robot', animation_type: m[1],
      perspective: 'side', movement: 'ground', theme: 'platformer',
      playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `yellow smiley-face robot character, ${ANIM_LABELS[m[1]]} (${item.frameCount} frames)`,
    };
  },

  'Space Shooter Remastered': (item) => {
    const m = item.stem.match(/^playerShip(\d)_damage$/);
    if (!m) return null;
    return {
      asset_type: 'vehicle', species: 'spaceship', animation_type: 'damage',
      perspective: 'top_down', movement: 'air', theme: 'sci_fi',
      playable_role: 'player', quality_score: 4, confidence_score: 1.0,
      description: `top-down player spaceship variant #${m[1]}, ${ANIM_LABELS.damage} (${item.frameCount} frames)`,
    };
  },
};

// --- VALIDATION ---
function validate(label, item) {
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(label[field])) {
      throw new Error(`Item ${item.id}: field '${field}'=${JSON.stringify(label[field])} not in enum [${allowed.join(', ')}]`);
    }
  }
  if (typeof label.quality_score !== 'number' || label.quality_score < 1 || label.quality_score > 5)
    throw new Error(`Item ${item.id}: quality_score out of range`);
  if (typeof label.confidence_score !== 'number' || label.confidence_score < 0 || label.confidence_score > 1)
    throw new Error(`Item ${item.id}: confidence_score out of range`);
  if (typeof label.description !== 'string' || !label.description.trim())
    throw new Error(`Item ${item.id}: description missing`);
}

// Build search_text — flat token bag for cheap keyword fallback / debugging
function buildSearchText(label) {
  return [
    label.asset_type, label.species, label.animation_type,
    label.perspective, label.movement, label.theme, label.playable_role,
    label.description,
  ].join(' ').toLowerCase().replace(/[^a-z0-9\s_]/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- APPLY ---
const labeled = [];
const missed = [];

for (const item of curated) {
  const rule = PACK_RULES[item.pack];
  if (!rule) { missed.push({ id: item.id, pack: item.pack, stem: item.stem, reason: 'no rule for pack' }); continue; }
  const label = rule(item);
  if (!label) { missed.push({ id: item.id, pack: item.pack, stem: item.stem, reason: 'rule returned null (stem did not match any sub-pattern)' }); continue; }

  validate(label, item);
  label.frame_count = item.frameCount;
  label.canvas_size = item.atlas.frameSize;
  label.source_pack = item.pack;
  label.search_text = buildSearchText(label);
  // Rename the placeholder "walk" key in the source atlas metadata to the semantic animation_type
  // so game code can call this.anims.create({ key: label.animation_type, ... }) coherently.
  // Preserve frame indices and fps/loop verbatim — this is only a key rename.
  const semanticAnimations = {};
  for (const [key, value] of Object.entries(item.atlas.animations)) {
    semanticAnimations[key === 'walk' ? label.animation_type : key] = value;
  }
  label.atlas_ref = {
    sheet: item.atlas.sheet,
    sheet_path: item.sheetPath,
    preview_path: item.previewPath,
    animations: semanticAnimations,
  };
  labeled.push({ id: item.id, ...label });
}

if (missed.length) {
  console.error(`\n❌ ${missed.length} items had no matching rule — refusing to ship partial labels.`);
  for (const m of missed) console.error(`   ${m.pack} / ${m.stem} (${m.id}) — ${m.reason}`);
  process.exit(1);
}

// --- WRITE ---
fs.writeFileSync(path.join(STAGING, '_labeled.json'), JSON.stringify({ schema: ENUMS, items: labeled }, null, 2));

// --- REPORT ---
console.log(`✅ Labeled ${labeled.length}/${curated.length} items — all rules matched.`);
console.log(`\n=== SCHEMA (controlled enums) ===`);
for (const [k, v] of Object.entries(ENUMS)) console.log(`  ${k}: [${v.join(', ')}]`);

console.log(`\n=== CATEGORY COUNTS ===`);
function count(field) {
  const c = {};
  for (const l of labeled) c[l[field]] = (c[l[field]] || 0) + 1;
  return c;
}
for (const field of ['asset_type', 'species', 'animation_type', 'perspective', 'movement', 'theme', 'playable_role']) {
  const c = count(field);
  const entries = Object.entries(c).sort((a,b)=>b[1]-a[1]);
  console.log(`  ${field}:`);
  for (const [k, v] of entries) console.log(`    ${k.padEnd(12)} ${v}`);
}

console.log(`\n=== QUALITY DISTRIBUTION ===`);
const qc = {}; for (const l of labeled) qc[l.quality_score] = (qc[l.quality_score]||0)+1;
for (const q of [5,4,3,2,1]) if (qc[q]) console.log(`  quality ${q}: ${qc[q]}`);

console.log(`\n=== CONFIDENCE DISTRIBUTION ===`);
const cc = {}; for (const l of labeled) cc[l.confidence_score] = (cc[l.confidence_score]||0)+1;
for (const c of Object.keys(cc).sort((a,b)=>b-a)) console.log(`  confidence ${c}: ${cc[c]}`);

console.log(`\n=== 3 EXAMPLES ===`);
const sample = [
  labeled.find(l => l.source_pack === 'Toon Characters' && l.animation_type === 'walk'),
  labeled.find(l => l.source_pack === 'Alien UFO Pack'),
  labeled.find(l => l.species === 'bunny'),
].filter(Boolean);
for (const s of sample) {
  console.log(JSON.stringify(s, null, 2));
  console.log();
}
