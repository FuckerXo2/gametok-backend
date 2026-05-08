/**
 * DreamStream Asset Dictionary v4.0
 *
 * Runtime asset brain for generated games. Assets can be served from local dev,
 * Railway static folders, or Cloudflare R2 public buckets.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Base URL is constructed at runtime from the request's host
// Default fallback for local dev
const DEFAULT_BASE = process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000';
const ASSET_STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || '/app/storage';
const KENNEY_STAGE_CANDIDATES = [
  path.join(REPO_ROOT, 'public', 'uploads', 'kenney'),
  path.join(ASSET_STORAGE_ROOT, 'kenney'),
  path.join(REPO_ROOT, 'public', 'uploads', 'kenney-wave1'),
  path.join(ASSET_STORAGE_ROOT, 'kenney-wave1'),
];
const KENNEY_CATALOG_PATH_CANDIDATES = [
  process.env.KENNEY_CATALOG_PATH,
  process.env.KENNEY_INTELLIGENCE_PATH,
  path.join(REPO_ROOT, 'docs', 'kenney-catalog.json'),
  path.join(REPO_ROOT, 'docs', 'kenney-intelligence.json'),
  path.join(REPO_ROOT, 'docs', 'kenney-full-catalog.json'),
  path.join(REPO_ROOT, 'docs', 'kenney-full-intelligence.json'),
  path.join(REPO_ROOT, 'docs', 'kenney-wave1-intelligence.json'),
  path.join(REPO_ROOT, 'docs', 'kenney-wave1-catalog.json'),
].filter(Boolean);
const PHASER_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'phaser-assets-manifest.json');

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveAssetBaseUrls(origin = DEFAULT_BASE) {
  const cleanOrigin = cleanBaseUrl(origin);
  const fallbackKenneyPath = fs.existsSync(path.join(REPO_ROOT, 'public', 'uploads', 'kenney'))
    ? '/uploads/kenney'
    : '/uploads/kenney-wave1';
  return {
    legacyKenney: cleanBaseUrl(process.env.KENNEY_LEGACY_ASSET_BASE
      || process.env.KENNEY_LEGACY_ASSET_URL
      || process.env.KENNEY_ASSET_BASE
      || process.env.KENNEY_ASSET_URL
      || `${cleanOrigin}/uploads/kenney`),
    kenney: cleanBaseUrl(process.env.KENNEY_ASSET_BASE
      || process.env.KENNEY_ASSET_URL
      || process.env.KENNEY_FULL_ASSET_BASE
      || process.env.KENNEY_FULL_ASSET_URL
      || process.env.KENNEY_WAVE1_ASSET_BASE
      || process.env.KENNEY_WAVE1_ASSET_URL
      || `${cleanOrigin}${fallbackKenneyPath}`),
    phaser: cleanBaseUrl(process.env.PHASER_ASSET_BASE
      || process.env.PHASER_ASSET_URL
      || `${cleanOrigin}/assets`),
  };
}

let {
  legacyKenney: ASSET_BASE_URL,
  kenney: KENNEY_BASE_URL,
  phaser: PHASER_BASE_URL,
} = resolveAssetBaseUrls();

const NIM_RETRIEVAL_MODELS = Object.freeze({
  embed: process.env.NIM_ASSET_EMBED_MODEL || 'nvidia/llama-nemotron-embed-1b-v2',
  rerank: process.env.NIM_ASSET_RERANK_MODEL || 'nvidia/llama-nemotron-rerank-1b-v2',
  multimodalEmbed: process.env.NIM_ASSET_EMBED_VL_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2',
  multimodalRerank: process.env.NIM_ASSET_RERANK_VL_MODEL || 'nvidia/llama-nemotron-rerank-vl-1b-v2',
  legacyFallbackEmbed: process.env.NIM_ASSET_LEGACY_EMBED_MODEL || 'nvidia/nv-embedqa-e5-v5',
});

const LANE_SUPPORT_GRAPH = {
  endless_flyer: ['pixel_platformer'],
  topdown_arcade: ['pixel_platformer', 'auto_battler_arena'],
  pixel_platformer: ['endless_flyer', 'topdown_arcade', 'auto_battler_arena'],
  auto_battler_arena: ['pixel_platformer', 'topdown_arcade'],
  first_person_threejs: ['topdown_arcade', 'pixel_platformer'],
  third_person_threejs: ['first_person_threejs', 'topdown_arcade', 'pixel_platformer'],
};

const LANE_NOTES = {
  endless_flyer: [
    'Keep the flyer high enough on screen that the opening state looks safe and playable.',
    'Obstacle silhouettes matter more than raw asset count here; one strong plane plus clean hazards beats a cluttered bundle.',
    'Use horizon layers, cloud bands, and distant props so the flyer reads like open air instead of a boxed shaft.',
  ],
  topdown_arcade: [
    'Prefer readable survivor and zombie silhouettes over over-decorating the map.',
    'A few good tiles, pickups, and impacts are enough to sell the lane.',
    'Favor ground coverage and map context so the action feels placed inside a space, not floating in UI emptiness.',
    'If the control rig is move-and-fire, prioritize readable combat controls and pressure lanes over decorative filler.',
  ],
  pixel_platformer: [
    'Prioritize clear terrain silhouettes, readable pickups, and one dependable enemy family.',
    'Background depth matters here: hills, clouds, trees, and tile rhythm keep the scene from feeling trapped.',
  ],
  auto_battler_arena: [
    'This lane currently borrows character ingredients from nearby sprite families when the dedicated battle packs are too tile-heavy.',
    'If class-specific art is still imperfect, keep units chunky and readable instead of shrinking them into colored dots.',
    'Use banners, stage props, gates, and floor framing so the arena feels wide and deliberate.',
  ],
  endless_runner_vertical: [
    'Sell forward depth with repeated lane markers, skyline props, and distant obstacle silhouettes instead of a flat boxed track.',
    'Runner lanes need horizon support just as much as obstacle support.',
    'If the control rig is lane-swipe runner, the track needs clean lane telegraphing more than extra clutter.',
  ],
  story_horror_vignette: [
    'This lane can win with almost no custom art if the typography, spacing, and atmosphere are strong.',
    'Use texture, panels, restrained props, and ambient support instead of cluttering a horror vignette with random sprites.',
    'A single note, prompt card, terminal frame, or reveal object is often enough if the scene is staged well.',
  ],
  simulation_toybox: [
    'This lane wins by making the source zone, central machine, and result zone read clearly as one playful system.',
    'Favor strong workstation props, ingredient cards, trays, and reveal panels over cluttering the screen with unrelated decoration.',
    'A good central object plus a readable shelf and one satisfying reveal state beats trying to simulate ten subsystems.',
  ],
  single_room_shooter: [
    'A room-based game still needs depth: foreground props, back-wall details, and readable combat cover.',
    'Favor a strong room kit over random decorative clutter.',
  ],
  first_person_threejs: [
    'Use same-origin GLB models only if they actually help readability; otherwise keep geometry procedural and use the kit for landmarks.',
  ],
  third_person_threejs: [
    'This lane needs a visible player body or vehicle, not an invisible camera and not a top-down marker.',
    'Use simple 3D primitives and same-origin models for road/world landmarks, hazards, pickups, and silhouettes when they improve readability.',
    'The first frame should already read as chase/follow camera: player anchored in the lower third, world depth ahead, controls safely visible.',
  ],
};

/**
 * Call this from routes.js with the actual request to set the correct base URL
 */
export function setAssetBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const origin = `${protocol}://${host}`;
  const bases = resolveAssetBaseUrls(origin);
  ASSET_BASE_URL = bases.legacyKenney;
  KENNEY_BASE_URL = bases.kenney;
  PHASER_BASE_URL = bases.phaser;
}

export function getRetrievalModelConfig() {
  return { ...NIM_RETRIEVAL_MODELS };
}

// ═══════════════════════════════════════════════════════════
// CURATED ASSET LIBRARY — Every URL points to /uploads/kenney/
// ═══════════════════════════════════════════════════════════

const ASSET_LIBRARY = [
  // ============================================
  // PLAYER CHARACTERS (Kenney Platformer Art Deluxe)
  // ============================================
  { id: 'hero_human_1', file: 'p1_stand.png', tags: ['player', 'hero', 'human', 'character', 'boy', 'man', 'person', 'knight', 'warrior', 'adventurer'], category: 'character', label: 'Human Hero (Boy)' },
  { id: 'hero_human_2', file: 'p2_stand.png', tags: ['player', 'hero', 'human', 'character', 'girl', 'woman', 'person', 'knight', 'warrior'], category: 'character', label: 'Human Hero (Girl)' },
  { id: 'hero_human_3', file: 'p3_stand.png', tags: ['player', 'hero', 'human', 'character', 'man', 'person', 'strong'], category: 'character', label: 'Human Hero (Alt)' },
  { id: 'hero_alien_green', file: 'alienGreen_stand.png', tags: ['alien', 'player', 'green', 'platformer', 'character', 'hero', 'space', 'creature'], category: 'character', label: 'Green Alien Hero' },
  { id: 'hero_alien_blue', file: 'alienBlue_stand.png', tags: ['alien', 'player', 'blue', 'character', 'hero', 'space', 'creature'], category: 'character', label: 'Blue Alien Hero' },
  { id: 'hero_alien_pink', file: 'alienPink_stand.png', tags: ['alien', 'player', 'pink', 'character', 'hero', 'space', 'creature', 'cute'], category: 'character', label: 'Pink Alien Hero' },
  { id: 'hero_alien_beige', file: 'alienBeige_stand.png', tags: ['alien', 'player', 'beige', 'character', 'hero', 'creature'], category: 'character', label: 'Beige Alien Hero' },
  { id: 'hero_alien_yellow', file: 'alienYellow_stand.png', tags: ['alien', 'player', 'yellow', 'character', 'hero', 'creature'], category: 'character', label: 'Yellow Alien Hero' },

  // ============================================
  // ENEMIES (Kenney Platformer Art Deluxe)
  // ============================================
  { id: 'enemy_slime', file: 'slime.png', tags: ['slime', 'enemy', 'monster', 'blob', 'green', 'creature', 'villain'], category: 'enemy', label: 'Green Slime' },
  { id: 'enemy_slime_blue', file: 'slimeBlue.png', tags: ['slime', 'enemy', 'monster', 'blob', 'blue', 'creature', 'ice'], category: 'enemy', label: 'Blue Slime' },
  { id: 'enemy_slime_green', file: 'slimeGreen.png', tags: ['slime', 'enemy', 'monster', 'blob', 'green', 'creature', 'poison'], category: 'enemy', label: 'Poison Slime' },
  { id: 'enemy_ghost', file: 'ghost_normal.png', tags: ['ghost', 'enemy', 'undead', 'horror', 'scary', 'spirit', 'haunted', 'phantom', 'zombie'], category: 'enemy', label: 'Ghost Enemy' },
  { id: 'enemy_spider', file: 'spider.png', tags: ['spider', 'enemy', 'bug', 'insect', 'scary', 'creepy', 'dark', 'dungeon'], category: 'enemy', label: 'Spider Enemy' },
  { id: 'enemy_bat', file: 'bat.png', tags: ['bat', 'enemy', 'flying', 'dark', 'cave', 'dungeon', 'vampire', 'night', 'horror'], category: 'enemy', label: 'Bat Enemy' },
  { id: 'enemy_bee', file: 'bee.png', tags: ['bee', 'enemy', 'flying', 'insect', 'bug', 'sting', 'nature', 'forest'], category: 'enemy', label: 'Bee Enemy' },
  { id: 'enemy_fly', file: 'fly.png', tags: ['fly', 'enemy', 'flying', 'insect', 'bug', 'pest', 'swamp'], category: 'enemy', label: 'Fly Enemy' },
  { id: 'enemy_snake', file: 'snake.png', tags: ['snake', 'enemy', 'reptile', 'desert', 'danger', 'jungle', 'poison'], category: 'enemy', label: 'Snake Enemy' },
  { id: 'enemy_snakeLava', file: 'snakeLava.png', tags: ['snake', 'enemy', 'lava', 'fire', 'dragon', 'reptile'], category: 'enemy', label: 'Lava Snake' },
  { id: 'enemy_frog', file: 'frog.png', tags: ['frog', 'enemy', 'swamp', 'jump', 'creature', 'amphibian', 'nature'], category: 'enemy', label: 'Frog Enemy' },
  { id: 'enemy_mouse', file: 'mouse.png', tags: ['mouse', 'enemy', 'rodent', 'small', 'fast', 'rat', 'creature'], category: 'enemy', label: 'Mouse Enemy' },
  { id: 'enemy_worm', file: 'worm.png', tags: ['worm', 'enemy', 'underground', 'dirt', 'creature', 'bug'], category: 'enemy', label: 'Worm Enemy' },
  { id: 'enemy_snail', file: 'snail.png', tags: ['snail', 'enemy', 'slow', 'shell', 'creature', 'garden'], category: 'enemy', label: 'Snail Enemy' },
  { id: 'enemy_ladybug', file: 'ladyBug.png', tags: ['ladybug', 'enemy', 'insect', 'bug', 'nature', 'cute'], category: 'enemy', label: 'Ladybug Enemy' },
  { id: 'enemy_piranha', file: 'piranha.png', tags: ['piranha', 'enemy', 'fish', 'water', 'ocean', 'sea', 'underwater', 'dangerous'], category: 'enemy', label: 'Piranha Enemy' },
  { id: 'enemy_fish_green', file: 'fishGreen.png', tags: ['fish', 'enemy', 'water', 'ocean', 'sea', 'underwater', 'swim'], category: 'enemy', label: 'Green Fish' },
  { id: 'enemy_fish_pink', file: 'fishPink.png', tags: ['fish', 'enemy', 'water', 'ocean', 'sea', 'underwater', 'swim'], category: 'enemy', label: 'Pink Fish' },
  { id: 'enemy_spinner', file: 'spinner.png', tags: ['spinner', 'enemy', 'saw', 'blade', 'trap', 'mechanical', 'danger'], category: 'enemy', label: 'Spinner Blade' },
  { id: 'enemy_barnacle', file: 'barnacle.png', tags: ['barnacle', 'enemy', 'ocean', 'underwater', 'coral', 'sea'], category: 'enemy', label: 'Barnacle Enemy' },
  { id: 'enemy_grassblock', file: 'grassBlock.png', tags: ['grass', 'enemy', 'block', 'disguised', 'nature', 'surprise'], category: 'enemy', label: 'Grass Block Enemy' },

  // ============================================
  // COLLECTIBLE ITEMS
  // ============================================
  { id: 'item_coin_gold', file: 'coinGold.png', tags: ['coin', 'gold', 'money', 'collectible', 'treasure', 'score', 'currency'], category: 'item', label: 'Gold Coin' },
  { id: 'item_coin_silver', file: 'coinSilver.png', tags: ['coin', 'silver', 'money', 'collectible', 'treasure', 'currency'], category: 'item', label: 'Silver Coin' },
  { id: 'item_coin_bronze', file: 'coinBronze.png', tags: ['coin', 'bronze', 'money', 'collectible', 'treasure', 'currency'], category: 'item', label: 'Bronze Coin' },
  { id: 'item_gem_blue', file: 'gemBlue.png', tags: ['gem', 'blue', 'jewel', 'collectible', 'diamond', 'crystal', 'treasure', 'sapphire'], category: 'item', label: 'Blue Gem' },
  { id: 'item_gem_red', file: 'gemRed.png', tags: ['gem', 'red', 'jewel', 'collectible', 'ruby', 'crystal', 'treasure'], category: 'item', label: 'Red Gem' },
  { id: 'item_gem_green', file: 'gemGreen.png', tags: ['gem', 'green', 'jewel', 'collectible', 'emerald', 'crystal', 'treasure'], category: 'item', label: 'Green Gem' },
  { id: 'item_gem_yellow', file: 'gemYellow.png', tags: ['gem', 'yellow', 'jewel', 'collectible', 'topaz', 'crystal', 'treasure'], category: 'item', label: 'Yellow Gem' },
  { id: 'item_key_blue', file: 'keyBlue.png', tags: ['key', 'blue', 'unlock', 'door', 'collectible', 'item', 'puzzle'], category: 'item', label: 'Blue Key' },
  { id: 'item_key_yellow', file: 'keyYellow.png', tags: ['key', 'yellow', 'unlock', 'door', 'collectible', 'item', 'puzzle'], category: 'item', label: 'Yellow Key' },
  { id: 'item_key_red', file: 'keyRed.png', tags: ['key', 'red', 'unlock', 'door', 'collectible', 'item', 'puzzle'], category: 'item', label: 'Red Key' },
  { id: 'item_key_green', file: 'keyGreen.png', tags: ['key', 'green', 'unlock', 'door', 'collectible', 'item', 'puzzle'], category: 'item', label: 'Green Key' },
  { id: 'item_star', file: 'star.png', tags: ['star', 'collectible', 'power', 'bonus', 'score', 'shine', 'achievement'], category: 'item', label: 'Star' },
  { id: 'item_heart', file: 'heart.png', tags: ['heart', 'health', 'life', 'heal', 'love', 'collectible', 'powerup'], category: 'item', label: 'Heart (Health)' },
  { id: 'item_bomb', file: 'bomb.png', tags: ['bomb', 'explosive', 'weapon', 'danger', 'item', 'attack', 'throw'], category: 'item', label: 'Bomb' },
  { id: 'item_fireball', file: 'fireball.png', tags: ['fireball', 'fire', 'magic', 'projectile', 'weapon', 'attack', 'spell'], category: 'item', label: 'Fireball' },
  { id: 'item_cherry', file: 'cherry.png', tags: ['cherry', 'fruit', 'food', 'collectible', 'health', 'nature'], category: 'item', label: 'Cherry Fruit' },
  { id: 'item_mushroom_brown', file: 'mushroomBrown.png', tags: ['mushroom', 'powerup', 'grow', 'collectible', 'nature', 'forest'], category: 'item', label: 'Brown Mushroom' },
  { id: 'item_mushroom_red', file: 'mushroomRed.png', tags: ['mushroom', 'powerup', 'grow', 'collectible', 'nature', 'forest', 'magic'], category: 'item', label: 'Red Mushroom' },

  // ============================================
  // WEAPONS & SHIELDS
  // ============================================
  { id: 'weapon_sword_silver', file: 'swordSilver.png', tags: ['sword', 'weapon', 'silver', 'melee', 'knight', 'medieval', 'attack', 'slash'], category: 'weapon', label: 'Silver Sword' },
  { id: 'weapon_sword_bronze', file: 'swordBronze.png', tags: ['sword', 'weapon', 'bronze', 'melee', 'knight', 'medieval', 'attack'], category: 'weapon', label: 'Bronze Sword' },
  { id: 'weapon_sword_gold', file: 'swordGold.png', tags: ['sword', 'weapon', 'gold', 'melee', 'knight', 'medieval', 'attack', 'legendary'], category: 'weapon', label: 'Gold Sword' },
  { id: 'weapon_shield_bronze', file: 'shieldBronze.png', tags: ['shield', 'defense', 'armor', 'protect', 'knight', 'medieval', 'block'], category: 'weapon', label: 'Bronze Shield' },
  { id: 'weapon_shield_gold', file: 'shieldGold.png', tags: ['shield', 'defense', 'armor', 'protect', 'knight', 'medieval', 'legendary'], category: 'weapon', label: 'Gold Shield' },
  { id: 'weapon_shield_silver', file: 'shieldSilver.png', tags: ['shield', 'defense', 'armor', 'protect', 'knight', 'medieval'], category: 'weapon', label: 'Silver Shield' },
  { id: 'weapon_raygun', file: 'raygun.png', tags: ['raygun', 'gun', 'weapon', 'laser', 'sci-fi', 'space', 'shooter', 'projectile'], category: 'weapon', label: 'Ray Gun' },
  { id: 'weapon_raygun_big', file: 'raygunBig.png', tags: ['raygun', 'gun', 'weapon', 'laser', 'sci-fi', 'space', 'shooter', 'big'], category: 'weapon', label: 'Big Ray Gun' },

  // ============================================
  // ENVIRONMENT TILES
  // ============================================
  { id: 'tile_grass', file: 'grassMid.png', tags: ['grass', 'ground', 'tile', 'platform', 'nature', 'green', 'level', 'floor'], category: 'environment', label: 'Grass Tile' },
  { id: 'tile_grass_left', file: 'grassLeft.png', tags: ['grass', 'ground', 'tile', 'edge', 'left', 'nature'], category: 'environment', label: 'Grass Left Edge' },
  { id: 'tile_grass_right', file: 'grassRight.png', tags: ['grass', 'ground', 'tile', 'edge', 'right', 'nature'], category: 'environment', label: 'Grass Right Edge' },
  { id: 'tile_stone', file: 'stoneMid.png', tags: ['stone', 'rock', 'ground', 'tile', 'dungeon', 'cave', 'castle', 'medieval', 'floor'], category: 'environment', label: 'Stone Tile' },
  { id: 'tile_stone_wall', file: 'stoneWall.png', tags: ['stone', 'wall', 'tile', 'dungeon', 'cave', 'castle', 'medieval', 'dark', 'block'], category: 'environment', label: 'Stone Wall' },
  { id: 'tile_sand', file: 'sandMid.png', tags: ['sand', 'desert', 'ground', 'tile', 'beach', 'warm', 'floor'], category: 'environment', label: 'Sand Tile' },
  { id: 'tile_snow', file: 'snowMid.png', tags: ['snow', 'ice', 'ground', 'tile', 'winter', 'cold', 'arctic', 'floor'], category: 'environment', label: 'Snow Tile' },
  { id: 'tile_dirt', file: 'dirtMid.png', tags: ['dirt', 'ground', 'tile', 'underground', 'cave', 'brown', 'floor'], category: 'environment', label: 'Dirt Tile' },
  { id: 'tile_castle', file: 'castleMid.png', tags: ['castle', 'tile', 'stone', 'medieval', 'fortress', 'wall', 'floor'], category: 'environment', label: 'Castle Tile' },
  { id: 'tile_metal', file: 'metalMid.png', tags: ['metal', 'tile', 'industrial', 'sci-fi', 'steel', 'platform', 'floor'], category: 'environment', label: 'Metal Tile' },
  { id: 'env_lava', file: 'liquidLava.png', tags: ['lava', 'fire', 'hazard', 'liquid', 'danger', 'hot', 'death'], category: 'environment', label: 'Lava' },
  { id: 'env_water', file: 'liquidWater.png', tags: ['water', 'liquid', 'ocean', 'sea', 'lake', 'swim', 'underwater'], category: 'environment', label: 'Water' },
  { id: 'env_lava_top', file: 'liquidLavaTop.png', tags: ['lava', 'fire', 'surface', 'hazard', 'hot'], category: 'environment', label: 'Lava Surface' },
  { id: 'env_water_top', file: 'liquidWaterTop.png', tags: ['water', 'surface', 'ocean', 'lake', 'wave'], category: 'environment', label: 'Water Surface' },
  { id: 'env_spikes', file: 'spikes.png', tags: ['spikes', 'trap', 'hazard', 'danger', 'death', 'obstacle'], category: 'environment', label: 'Spikes Trap' },

  // ============================================
  // NATURE & DECORATIONS
  // ============================================
  { id: 'deco_bush', file: 'bush.png', tags: ['bush', 'nature', 'plant', 'green', 'decoration', 'forest', 'garden'], category: 'decoration', label: 'Bush' },
  { id: 'deco_plant', file: 'plant.png', tags: ['plant', 'nature', 'green', 'decoration', 'garden', 'small'], category: 'decoration', label: 'Small Plant' },
  { id: 'deco_cactus', file: 'cactus.png', tags: ['cactus', 'desert', 'plant', 'nature', 'prickly', 'decoration'], category: 'decoration', label: 'Cactus' },
  { id: 'deco_rock', file: 'rock.png', tags: ['rock', 'stone', 'boulder', 'nature', 'decoration', 'obstacle'], category: 'decoration', label: 'Rock' },
  { id: 'deco_cloud', file: 'cloud1.png', tags: ['cloud', 'sky', 'weather', 'decoration', 'background', 'white', 'fluffy'], category: 'decoration', label: 'Cloud' },
  { id: 'deco_torch', file: 'torch.png', tags: ['torch', 'light', 'fire', 'dungeon', 'medieval', 'dark', 'decoration', 'cave'], category: 'decoration', label: 'Wall Torch' },
  { id: 'deco_torch_lit', file: 'tochLit.png', tags: ['torch', 'light', 'fire', 'lit', 'dungeon', 'medieval', 'glow'], category: 'decoration', label: 'Lit Torch' },
  { id: 'deco_sign', file: 'sign.png', tags: ['sign', 'signpost', 'direction', 'decoration', 'village'], category: 'decoration', label: 'Sign Post' },
  { id: 'deco_fence', file: 'fence.png', tags: ['fence', 'barrier', 'wood', 'decoration', 'farm', 'village'], category: 'decoration', label: 'Wooden Fence' },
  { id: 'deco_door_closed', file: 'door_closedMid.png', tags: ['door', 'closed', 'entrance', 'building', 'dungeon', 'exit'], category: 'decoration', label: 'Closed Door' },
  { id: 'deco_door_open', file: 'door_openMid.png', tags: ['door', 'open', 'entrance', 'building', 'dungeon', 'exit'], category: 'decoration', label: 'Open Door' },
  { id: 'deco_ladder', file: 'ladder_mid.png', tags: ['ladder', 'climb', 'vertical', 'platformer', 'move'], category: 'decoration', label: 'Ladder' },
  { id: 'deco_flag_red', file: 'flagRed.png', tags: ['flag', 'red', 'finish', 'goal', 'checkpoint', 'victory'], category: 'decoration', label: 'Red Flag' },
  { id: 'deco_flag_green', file: 'flagGreen.png', tags: ['flag', 'green', 'start', 'checkpoint', 'go'], category: 'decoration', label: 'Green Flag' },
  { id: 'deco_spring', file: 'springboardUp.png', tags: ['spring', 'jump', 'bounce', 'trampoline', 'platformer'], category: 'decoration', label: 'Springboard' },

  // ============================================
  // CANDY / FUN THEMES
  // ============================================
  { id: 'candy_lollipop', file: 'lollipopRed.png', tags: ['candy', 'lollipop', 'sweet', 'food', 'cute', 'fun', 'dessert'], category: 'item', label: 'Red Lollipop' },
  { id: 'candy_cupcake', file: 'cupCake.png', tags: ['cupcake', 'cake', 'sweet', 'food', 'cute', 'dessert', 'candy'], category: 'item', label: 'Cupcake' },
  { id: 'candy_cookie', file: 'cookieBrown.png', tags: ['cookie', 'sweet', 'food', 'cute', 'dessert', 'snack'], category: 'item', label: 'Cookie' },
];

let assetEmbeddingsCache = null;

async function getEmbedding(text) {
  const napiKey = process.env.NVIDIA_API_KEY;
  if (!napiKey) return null;

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${napiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: [text],
        // Legacy asset-embeddings.json was precomputed with the older embedder family,
        // so keep this fallback compatible until we regenerate that vector store.
        model: NIM_RETRIEVAL_MODELS.legacyFallbackEmbed,
        encoding_format: 'float',
        input_type: 'query'
      })
    });
    const json = await res.json();
    return json.data[0].embedding;
  } catch (err) {
    console.error("Embedding API failed:", err);
    return null;
  }
}

function cosineSimilarity(A, B) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * True Semantic Vector Search (RAG) using NVIDIA NIM Embeddings.
 * Returns the top N matching assets sorted by vector similarity,
 * with FULL absolute URLs ready for the AI to use.
 */

let precomputedEmbeddings = null;
let kenneyCatalog = null;
let kenneyCatalogInfo = null;
let phaserManifest = null;

try {
  const jsonPath = path.join(__dirname, 'asset-embeddings.json');
  if (fs.existsSync(jsonPath)) {
    precomputedEmbeddings = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`✅ Loaded ${precomputedEmbeddings.length} precomputed asset vectors from memory.`);
  }
} catch (e) {
  console.warn("⚠️ Failed to load precomputed embeddings:", e.message);
}

try {
  const kenneyStageRoot = KENNEY_STAGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  const hasRemoteKenneyBase = Boolean(
    process.env.KENNEY_ASSET_BASE
    || process.env.KENNEY_ASSET_URL
    || process.env.KENNEY_FULL_ASSET_BASE
    || process.env.KENNEY_FULL_ASSET_URL
    || process.env.KENNEY_WAVE1_ASSET_BASE
    || process.env.KENNEY_WAVE1_ASSET_URL
  );
  const preferredCatalogPath = KENNEY_CATALOG_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (preferredCatalogPath && (kenneyStageRoot || hasRemoteKenneyBase)) {
    kenneyCatalog = JSON.parse(fs.readFileSync(preferredCatalogPath, 'utf8'));
    kenneyCatalogInfo = {
      path: preferredCatalogPath,
      source: preferredCatalogPath.includes('wave1') ? 'legacy-wave1-catalog' : 'kenney-catalog',
      servingRoot: kenneyStageRoot || KENNEY_BASE_URL,
    };
    console.log(
      `✅ Loaded Kenney catalog with ${kenneyCatalog?.summary?.totals?.usefulAssets || kenneyCatalog?.totals?.assets || 0} assets from ${kenneyCatalogInfo.servingRoot}.`
    );
  }
} catch (e) {
  console.warn("⚠️ Failed to load Kenney catalog:", e.message);
}

try {
  if (fs.existsSync(PHASER_MANIFEST_PATH)) {
    phaserManifest = JSON.parse(fs.readFileSync(PHASER_MANIFEST_PATH, 'utf8'));
    console.log(`✅ Loaded Phaser asset manifest with ${phaserManifest?.entries?.length || 0} files.`);
  }
} catch (e) {
  console.warn("⚠️ Failed to load Phaser asset manifest:", e.message);
}

function toAbsoluteKenneyUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${KENNEY_BASE_URL}${url
    .replace(/^\/uploads\/kenney-wave1/, '')
    .replace(/^\/uploads\/kenney/, '')}`;
}

function toAbsolutePhaserUrl(relativePathOrUrl) {
  if (!relativePathOrUrl) return relativePathOrUrl;
  if (/^https?:\/\//i.test(relativePathOrUrl)) return relativePathOrUrl;
  const pathPart = String(relativePathOrUrl)
    .replace(/^\/?phaser-assets\//, '')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');
  return `${cleanBaseUrl(PHASER_BASE_URL)}/${pathPart}`;
}

function toAbsoluteLegacyUrl(file) {
  return `${ASSET_BASE_URL}/${file}`;
}

function mapKenneyAsset(asset) {
  return {
    id: `${asset.lane}:${asset.packSlug}:${asset.filename}`,
    file: asset.targetPath,
    tags: asset.tags || [],
    category: asset.kind || asset.role || asset.runtime || 'asset',
    label: `${asset.packName} — ${asset.filename}`,
    lane: asset.lane,
    lanes: asset.lanes || (asset.lane ? [asset.lane] : []),
    runtime: asset.runtime,
    role: asset.role,
    packName: asset.packName,
    kind: asset.kind,
    useful: asset.useful !== false,
    semanticRoles: asset.semanticRoles || [],
    qualityHint: asset.qualityHint || 'support',
    url: toAbsoluteKenneyUrl(asset.url),
  };
}

function assetMatchesLane(asset, lane) {
  if (!lane) return true;
  const lanes = new Set([
    asset.lane,
    ...(asset.lanes || []),
  ].filter(Boolean));
  return lanes.has(lane) || lanes.has('general');
}

const PHASER_ROLE_KEYWORDS = [
  ['player', ['player', 'hero', 'ship', 'car', 'tank', 'robot', 'knight', 'character', 'person']],
  ['enemy', ['enemy', 'zombie', 'monster', 'alien', 'ghost', 'spider', 'skull', 'boss', 'creep', 'bug']],
  ['pickup', ['coin', 'gem', 'diamond', 'star', 'heart', 'ammo', 'medkit', 'powerup', 'bonus', 'key']],
  ['control', ['button', 'joystick', 'dpad', 'cursor', 'pointer', 'touch', 'gamepad', 'pad']],
  ['audio', ['audio', 'music', 'sfx', 'sound', 'loop', 'theme', 'impact', 'shoot', 'jump', 'coin']],
  ['environment', ['tiles', 'tilemap', 'map', 'background', 'sky', 'wall', 'floor', 'terrain', 'tree', 'road', 'city', 'dungeon', 'water', 'space']],
  ['ui', ['ui', 'font', 'panel', 'hud', 'icon', 'menu', 'dialog', 'window', 'text']],
  ['prop', ['barrel', 'crate', 'box', 'door', 'chest', 'rock', 'torch', 'house', 'weapon', 'gun', 'laser', 'bullet']],
];

function prettyPhaserLabel(asset) {
  const rawName = String(asset?.filename || asset?.relativePath || 'asset')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rawName.replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferPhaserRole(asset) {
  const haystack = String(asset?.searchableText || `${asset?.relativePath || ''} ${(asset?.tags || []).join(' ')}`).toLowerCase();
  for (const [role, keywords] of PHASER_ROLE_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return role;
  }
  if (asset?.kind === 'audio') return 'audio';
  if (asset?.category === 'ui') return 'ui';
  if (asset?.category === 'model3d') return 'prop';
  if (asset?.category === 'tilemap' || asset?.category === 'environment') return 'environment';
  return 'asset';
}

function inferPhaserKind(asset) {
  if (asset?.extension === 'mtl') return 'material';
  if (asset?.kind === 'model3d') return 'model';
  if (asset?.kind === 'audio') return 'audio';
  if (asset?.kind === 'video') return 'video';
  if (asset?.category === 'tilemap') return 'tilemap';
  if (asset?.category === 'ui') return 'ui';
  if (asset?.category === 'sprite') return 'sprite';
  if (asset?.category === 'environment') return 'environment';
  if (asset?.category === 'shader') return 'shader';
  if (asset?.kind === 'image') return 'sprite';
  return asset?.kind || asset?.category || 'asset';
}

function inferPhaserRuntime(asset) {
  if (asset?.extension === 'mtl') return 'asset';
  if (asset?.kind === 'model3d') return 'threejs';
  if (asset?.category === 'tilemap' || asset?.category === 'shader') return 'phaser';
  return 'canvas';
}

function phaserQualityHint(asset, role, kind) {
  const haystack = String(asset?.searchableText || '').toLowerCase();
  if (['player', 'enemy', 'pickup'].includes(role) || kind === 'model') return 'hero';
  if (haystack.includes('background') || haystack.includes('tiles') || haystack.includes('audio')) return 'support';
  return 'support';
}

function mapPhaserAsset(asset) {
  const role = inferPhaserRole(asset);
  const kind = inferPhaserKind(asset);
  const category = asset.category || kind;
  const semanticRoles = [...new Set([
    role,
    kind,
    category,
    asset.kind,
    ...(asset.tags || []),
  ].filter(Boolean))];

  return {
    id: asset.id || `phaser:${asset.relativePath}`,
    file: asset.relativePath,
    tags: asset.tags || [],
    category,
    label: `Phaser — ${prettyPhaserLabel(asset)}`,
    lane: null,
    runtime: inferPhaserRuntime(asset),
    role,
    packName: 'Phaser Examples',
    kind,
    useful: true,
    semanticRoles,
    qualityHint: phaserQualityHint(asset, role, kind),
    licenseNote: asset.licenseNote,
    url: toAbsolutePhaserUrl(asset.relativePath || asset.url),
  };
}

function getKenneyAssets({ lane = null, category = null, includeNoise = false } = {}) {
  const assets = kenneyCatalog?.assets || [];
  return assets
    .filter((asset) => assetMatchesLane(asset, lane))
    .filter((asset) => !category || asset.kind === category || asset.role === category || asset.runtime === category)
    .filter((asset) => includeNoise || asset.useful !== false)
    .map(mapKenneyAsset);
}

function getPhaserAssets({ category = null, includeNoise = false } = {}) {
  const assets = phaserManifest?.entries || [];
  return assets
    .filter((asset) => !category || asset.category === category || asset.kind === category || asset.extension === category)
    .filter((asset) => includeNoise || asset.sizeBytes > 0)
    .map(mapPhaserAsset);
}

function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token && token.length > 1)
  )];
}

function expandLaneCandidates(primaryLane, extraLanes = []) {
  return [...new Set([
    primaryLane,
    ...(extraLanes || []),
    ...(LANE_SUPPORT_GRAPH[primaryLane] || []),
  ].filter(Boolean))];
}

function getAssetSearchText(asset) {
  return [
    asset.id,
    asset.file,
    asset.label,
    asset.packName,
    asset.kind,
    asset.category,
    asset.lane,
    asset.runtime,
    asset.role,
    ...(asset.tags || []),
    ...(asset.semanticRoles || []),
  ].join(' ').toLowerCase();
}

function roleMatches(asset, desiredRoles = []) {
  if (!Array.isArray(desiredRoles) || desiredRoles.length === 0) return true;
  const normalizedRoles = new Set([
    ...(asset.semanticRoles || []),
    asset.role,
    asset.category,
    asset.kind,
  ].filter(Boolean));
  return desiredRoles.some((role) => normalizedRoles.has(role));
}

function kindMatches(asset, desiredKinds = []) {
  if (!Array.isArray(desiredKinds) || desiredKinds.length === 0) return true;
  const normalizedKinds = new Set([asset.kind, asset.category, asset.role].filter(Boolean));
  return desiredKinds.some((kind) => normalizedKinds.has(kind));
}

function strictKindMatches(asset, desiredKinds = []) {
  if (!Array.isArray(desiredKinds) || desiredKinds.length === 0) return true;
  const normalizedKinds = new Set([asset.kind, asset.category].filter(Boolean));
  return desiredKinds.some((kind) => normalizedKinds.has(kind));
}

function roleExcluded(asset, forbiddenRoles = []) {
  if (!Array.isArray(forbiddenRoles) || forbiddenRoles.length === 0) return false;
  const normalizedRoles = new Set([
    ...(asset.semanticRoles || []),
    asset.role,
    asset.category,
    asset.kind,
  ].filter(Boolean));
  return forbiddenRoles.some((role) => normalizedRoles.has(role));
}

function kindExcluded(asset, forbiddenKinds = []) {
  if (!Array.isArray(forbiddenKinds) || forbiddenKinds.length === 0) return false;
  const normalizedKinds = new Set([asset.kind, asset.category, asset.role].filter(Boolean));
  return forbiddenKinds.some((kind) => normalizedKinds.has(kind));
}

function qualityBonus(asset, preferHero = false) {
  if (asset.qualityHint === 'hero') return preferHero ? 6 : 3;
  if (asset.qualityHint === 'support') return 1;
  return 0;
}

function laneBonus(laneIndex = 0) {
  if (laneIndex === 0) return 5;
  if (laneIndex === 1) return 3;
  return 1;
}

function rankKenneyAssets(query, options = {}) {
  const {
    lane = null,
    extraLanes = [],
    desiredRoles = [],
    desiredKinds = [],
    forbiddenRoles = [],
    forbiddenKinds = [],
    runtime = null,
    preferHero = false,
    limit = 6,
  } = options;

  const lanes = lane ? expandLaneCandidates(lane, extraLanes) : [];
  const candidates = (lanes.length > 0 ? lanes : [null])
    .flatMap((laneName, laneIndex) => getKenneyAssets({ lane: laneName }).map((asset) => ({ ...asset, __laneIndex: laneIndex })))
    .filter((asset) => !runtime || asset.runtime === runtime)
    .filter((asset) => roleMatches(asset, desiredRoles))
    .filter((asset) => kindMatches(asset, desiredKinds));
  const filteredCandidates = candidates
    .filter((asset) => !roleExcluded(asset, forbiddenRoles))
    .filter((asset) => !kindExcluded(asset, forbiddenKinds));

  const queryTokens = tokenize(query);

  const ranked = filteredCandidates
    .map((asset) => {
      const haystack = getAssetSearchText(asset);
      const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
      const matchScore = matchedTokens.reduce((score, token) => score + (token.length >= 5 ? 2 : 1), 0);
      const semanticScore = desiredRoles.length > 0 && roleMatches(asset, desiredRoles) ? 6 : 0;
      const kindScore = desiredKinds.length > 0 && kindMatches(asset, desiredKinds) ? 4 : 0;
      const score = matchScore + semanticScore + kindScore + qualityBonus(asset, preferHero) + laneBonus(asset.__laneIndex);
      return { asset, score, matchedTokens: matchedTokens.length };
    })
    .filter(({ asset, score, matchedTokens }) => {
      if (!asset?.useful) return false;
      if (queryTokens.length === 0) return score > 0;
      return matchedTokens > 0 || score >= 8;
    })
    .sort((a, b) =>
      b.score - a.score ||
      (b.asset.qualityHint === 'hero') - (a.asset.qualityHint === 'hero') ||
      a.asset.label.localeCompare(b.asset.label)
    )
    .map(({ asset }) => asset);

  // Add randomization: pick from top candidates for variety
  const dedupedRanked = dedupeAssets(ranked);
  const topCandidates = dedupedRanked.slice(0, Math.min(limit * 3, dedupedRanked.length));
  return shuffleArray(topCandidates).slice(0, limit);
}

function rankPhaserAssets(query, options = {}) {
  const {
    desiredRoles = [],
    desiredKinds = [],
    forbiddenRoles = [],
    forbiddenKinds = [],
    runtime = null,
    preferHero = false,
    limit = 6,
  } = options;

  const candidates = getPhaserAssets()
    .filter((asset) => !runtime || asset.runtime === runtime || (runtime === 'threejs' && asset.kind === 'model'))
    .filter((asset) => roleMatches(asset, desiredRoles))
    // Phaser's examples bundle is broad; keep kind matching strict so support files
    // like .mtl materials do not masquerade as visible sprites or environments.
    .filter((asset) => strictKindMatches(asset, desiredKinds))
    .filter((asset) => !roleExcluded(asset, forbiddenRoles))
    .filter((asset) => !kindExcluded(asset, forbiddenKinds))
    .filter((asset) => desiredKinds.includes('material') || asset.kind !== 'material')
    .filter((asset) => desiredKinds.length === 0 || desiredKinds.includes('model') || asset.kind !== 'model');

  const queryTokens = tokenize(query);
  const ranked = candidates
    .map((asset) => {
      const haystack = getAssetSearchText(asset);
      const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
      const matchScore = matchedTokens.reduce((score, token) => score + (token.length >= 5 ? 2 : 1), 0);
      const semanticScore = desiredRoles.length > 0 && roleMatches(asset, desiredRoles) ? 5 : 0;
      const kindScore = desiredKinds.length > 0 && strictKindMatches(asset, desiredKinds) ? 4 : 0;
      const runtimeScore = runtime && asset.runtime === runtime ? 3 : 0;
      const phaserCoverageScore = ['audio', 'model', 'tilemap', 'shader', 'video'].includes(asset.kind) ? 2 : 0;
      const score = matchScore + semanticScore + kindScore + runtimeScore + phaserCoverageScore + qualityBonus(asset, preferHero);
      return { asset, score, matchedTokens: matchedTokens.length };
    })
    .filter(({ asset, score, matchedTokens }) => {
      if (!asset?.useful) return false;
      if (queryTokens.length === 0) return score > 0;
      return matchedTokens > 0 || score >= 8;
    })
    .sort((a, b) =>
      b.score - a.score ||
      (b.asset.qualityHint === 'hero') - (a.asset.qualityHint === 'hero') ||
      a.asset.label.localeCompare(b.asset.label)
    )
    .map(({ asset }) => asset);

  // Add randomization: pick from top candidates for variety
  const dedupedRanked = dedupeAssets(ranked);
  const topCandidates = dedupedRanked.slice(0, Math.min(limit * 3, dedupedRanked.length));
  return shuffleArray(topCandidates).slice(0, limit);
}

function scoreLegacyAsset(asset, query) {
  const haystack = `${asset.label} ${asset.category} ${(asset.tags || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of String(query || '').toLowerCase().split(/\s+/).filter(Boolean)) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function pickLegacyAssets(query, options = {}) {
  const { limit = 3, categories = [] } = options;
  return ASSET_LIBRARY
    .filter((asset) => categories.length === 0 || categories.includes(asset.category))
    .map((asset) => ({
      ...asset,
      url: toAbsoluteLegacyUrl(asset.file),
      score: scoreLegacyAsset(asset, query),
    }))
    .filter((asset) => asset.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ score, ...asset }) => asset);
}

function dedupeAssets(assets = []) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = asset?.url || asset?.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function filterAssetsByKeywords(assets = [], keywords = []) {
  const terms = keywords.map((term) => String(term || '').toLowerCase()).filter(Boolean);
  if (terms.length === 0) return dedupeAssets(assets);
  return dedupeAssets(assets).filter((asset) => {
    const haystack = [
      asset?.label,
      asset?.packName,
      asset?.url,
      asset?.lane,
      ...(Array.isArray(asset?.tags) ? asset.tags : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
}

function hasAnyAssetKeyword(assets = [], keywords = []) {
  const filtered = filterAssetsByKeywords(assets, keywords);
  return filtered.length > 0;
}

function summarizeBundleSection(assets, role) {
  return dedupeAssets(assets).map((asset) => ({
    role,
    label: asset.label,
    kind: asset.kind || asset.category || 'asset',
    packName: asset.packName || 'Legacy Library',
    url: asset.url,
  }));
}

function mergeAssetGroups(...groups) {
  return dedupeAssets(groups.flat().filter(Boolean));
}

function enrichNotesWithCrossLaneBorrowing(lane, assets = []) {
  const borrowedLanes = [...new Set(
    assets
      .map((asset) => asset?.lane)
      .filter((assetLane) => assetLane && assetLane !== lane)
  )];

  if (borrowedLanes.length === 0) {
    return LANE_NOTES[lane] || [];
  }

  return [
    ...(LANE_NOTES[lane] || []),
    `This run borrowed a few supporting assets from nearby lanes: ${borrowedLanes.join(', ')}.`,
  ];
}

function augmentBundleWithPhaser({
  lane,
  prompt,
  visuals = [],
  controls = [],
  audio = [],
  models = [],
  isCockpitDriver = false,
} = {}) {
  let nextVisuals = visuals;
  let nextControls = controls;
  let nextAudio = audio;
  let nextModels = models;
  const notes = [];

  const visualRoles = lane === 'story_horror_vignette'
    ? ['environment', 'prop', 'ui']
    : ['player', 'enemy', 'pickup', 'environment', 'prop', 'ui'];
  const visualKinds = lane === 'first_person_threejs' || lane === 'third_person_threejs'
    ? ['environment', 'sprite', 'ui']
    : ['sprite', 'environment', 'item', 'ui', 'tilemap'];

  if (nextVisuals.length < 5) {
    nextVisuals = mergeAssetGroups(
      nextVisuals,
      rankPhaserAssets(prompt, {
        desiredRoles: visualRoles,
        desiredKinds: visualKinds,
        forbiddenRoles: ['audio'],
        limit: Math.max(2, 5 - nextVisuals.length),
      })
    );
  }

  if (nextControls.length < 2) {
    nextControls = mergeAssetGroups(
      nextControls,
      rankPhaserAssets(`${prompt} button ui touch joystick menu hud`, {
        desiredRoles: ['control', 'ui'],
        desiredKinds: ['control', 'ui', 'sprite'],
        limit: Math.max(1, 2 - nextControls.length),
      })
    );
  }

  if (nextAudio.length < 3) {
    nextAudio = mergeAssetGroups(
      nextAudio,
      rankPhaserAssets(`${prompt} sound effect music impact shoot jump pickup ambience`, {
        desiredRoles: ['audio'],
        desiredKinds: ['audio'],
        limit: Math.max(1, 3 - nextAudio.length),
      })
    );
  }

  if (lane === 'first_person_threejs' || lane === 'third_person_threejs' || isCockpitDriver) {
    const modelPrompt = isCockpitDriver
      ? `${prompt} car vehicle road city obstacle pickup dashboard model`
      : lane === 'third_person_threejs'
      ? `${prompt} visible player vehicle hero enemy road arena obstacle pickup chase camera model`
      : `${prompt} zombie enemy weapon dungeon room wall prop model`;
    nextModels = mergeAssetGroups(
      nextModels,
      rankPhaserAssets(modelPrompt, {
        runtime: 'threejs',
        desiredRoles: ['enemy', 'player', 'pickup', 'environment', 'prop'],
        desiredKinds: ['model'],
        preferHero: true,
        limit: Math.max(2, 5 - nextModels.length),
      })
    );
  }

  const phaserCount = [...nextVisuals, ...nextControls, ...nextAudio, ...nextModels]
    .filter((asset) => asset?.packName === 'Phaser Examples')
    .length;
  if (phaserCount > 0) {
    notes.push(
      'Phaser examples assets are available as a secondary library for sprites, audio, tilemaps, shaders, videos, and 3D models. Use them alongside Kenney when they fit the prompt, and verify per-asset licensing before commercial redistribution.'
    );
  }

  return {
    visuals: nextVisuals,
    controls: nextControls,
    audio: nextAudio,
    models: nextModels,
    notes,
  };
}

function wantsGeneratedPixelArt(specSheet = {}, promptText = '') {
  const text = [
    promptText,
    specSheet?.title,
    specSheet?.genre,
    specSheet?.summary,
    specSheet?.visualStyle,
    specSheet?.promptEcho,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return specSheet?.pixelArtStrict === true || [
    'pixel',
    'pixel art',
    'pixel-art',
    '8-bit',
    '16-bit',
    'retro sprite',
    'sprite sheet',
    'tileset',
  ].some((keyword) => text.includes(keyword));
}

/**
 * AI-Driven Asset Selection (Two-Stage Generation)
 * 
 * Stage 1: Ask Kimi what assets it needs
 * Stage 2: Search for those exact assets using semantic search
 * 
 * This gives Kimi full control over asset selection while still using
 * our 84K asset library intelligently.
 */
export async function buildDreamAssetBundleWithAI(specSheet = {}, promptText = '', nvidiaClient) {
  const lane = specSheet?.runtimeLane || 'arcade_canvas';
  
  console.log(`🤖 AI-Driven Asset Selection: Asking Kimi what assets it needs...`);
  
  try {
    // Stage 1: Ask Kimi to describe what assets it needs
    const assetRequirementsPrompt = {
      system: `You are an expert game designer analyzing asset requirements.

Given a game prompt and specifications, describe exactly what assets are needed to build this game.

Return a JSON object with these categories:
- player: { description, style, count }
- enemies: { description, style, count }
- environment: { description, style, count }
- pickups: { description, style, count }
- audio: { description, mood, count }
- controls: { description, style, count }
- models: { description, style, count } (for 3D games only)

IMPORTANT: The "count" field should reflect the game's complexity:
- Simple games (Pong, Snake): 2-5 assets per category
- Medium games (platformers, shooters): 6-12 assets per category
- Complex games (RPGs, open world): 15-30 assets per category

Be specific about:
- Visual style (realistic, pixel art, cartoon, horror, etc.)
- Mood/atmosphere (dark, cheerful, tense, etc.)
- Gameplay requirements (fast-paced, strategic, etc.)
- Asset count based on game complexity (simple, medium, complex)

Example for "zombie survival shooter" (COMPLEX GAME):
{
  "player": {
    "description": "Rugged zombie survivor with tactical gear, holding assault rifle",
    "style": "realistic, gritty, post-apocalyptic",
    "count": 6
  },
  "enemies": {
    "description": "Various zombie types: slow walkers, fast runners, tank zombies with rotting flesh",
    "style": "horrific, gore, blood splatter, undead",
    "count": 10
  },
  "environment": {
    "description": "Destroyed urban environment, abandoned buildings, debris, broken cars, dark streets",
    "style": "dark, moody, post-apocalyptic city, desolate",
    "count": 15
  },
  "pickups": {
    "description": "Ammo boxes, medkits, health packs, weapon upgrades",
    "style": "military, tactical, survival gear",
    "count": 6
  },
  "audio": {
    "description": "Gunshots, zombie groans, ambient horror, footsteps, reload sounds",
    "mood": "tense, scary, action-packed, survival horror",
    "count": 10
  },
  "controls": {
    "description": "Joystick for movement, fire button, reload button, tactical UI",
    "style": "military HUD, dark theme, combat interface",
    "count": 6
  }
}

Example for "Pong clone" (SIMPLE GAME):
{
  "player": {
    "description": "Two paddles, simple rectangular shapes",
    "style": "minimalist, retro, clean",
    "count": 2
  },
  "enemies": {
    "description": "None needed",
    "style": "N/A",
    "count": 0
  },
  "environment": {
    "description": "Simple background, center line",
    "style": "minimalist, retro, black and white",
    "count": 2
  },
  "pickups": {
    "description": "None needed",
    "style": "N/A",
    "count": 0
  },
  "audio": {
    "description": "Ball hit sound, score sound, background music",
    "mood": "retro, arcade, simple",
    "count": 3
  },
  "controls": {
    "description": "Up/down buttons for paddle movement",
    "style": "simple, minimal UI",
    "count": 2
  }
}

Example for "platformer adventure" (MEDIUM GAME):
{
  "player": {
    "description": "Adventurer character with running, jumping animations",
    "style": "cartoon, colorful, friendly",
    "count": 4
  },
  "enemies": {
    "description": "Various enemies: slimes, bats, spiders",
    "style": "cartoon, cute but dangerous",
    "count": 6
  },
  "environment": {
    "description": "Platforms, trees, rocks, grass, clouds",
    "style": "colorful, nature-themed, adventure",
    "count": 8
  },
  "pickups": {
    "description": "Coins, power-ups, health hearts",
    "style": "shiny, collectible, rewarding",
    "count": 4
  },
  "audio": {
    "description": "Jump sound, collect coin, enemy hit, background music",
    "mood": "upbeat, adventurous, fun",
    "count": 6
  },
  "controls": {
    "description": "Left/right movement, jump button",
    "style": "simple, clear, responsive",
    "count": 3
  }
}`,
      user: `Game prompt: "${promptText}"
Game type: ${lane}
Genre: ${specSheet?.genre || 'action'}
Visual style: ${specSheet?.visualStyle || 'dynamic'}
Control rig: ${specSheet?.controlRig || 'standard'}

Analyze this game and describe exactly what assets are needed.

IMPORTANT: Adjust the asset counts based on game complexity:
- If this is a SIMPLE game (Pong, Snake, Tic-Tac-Toe): Use 2-5 assets per category
- If this is a MEDIUM game (platformer, shooter, puzzle): Use 6-12 assets per category  
- If this is a COMPLEX game (RPG, open world, strategy): Use 15-30 assets per category

Be specific and detailed about descriptions and styles.`
    };

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.3-70b-instruct',
      messages: [
        { role: 'system', content: assetRequirementsPrompt.system },
        { role: 'user', content: assetRequirementsPrompt.user }
      ],
      max_tokens: 2000,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    if (!response?.choices?.[0]?.message?.content) {
      console.warn('⚠️ AI asset requirements failed, falling back to rule-based selection');
      return buildDreamAssetBundle(specSheet, promptText);
    }

    const requirements = JSON.parse(response.choices[0].message.content);
    console.log(`✅ Kimi described asset needs:`, JSON.stringify(requirements, null, 2));

    // Stage 2: Search for assets based on AI's requirements
    const bundle = {
      lane,
      visuals: [],
      controls: [],
      audio: [],
      models: [],
      notes: ['Assets selected by AI-driven semantic search based on Kimi\'s requirements']
    };

    // Search for each category
    if (requirements.player) {
      console.log(`🔍 Searching for player assets: "${requirements.player.description}"`);
      const playerAssets = await searchAssets(
        `${requirements.player.description} ${requirements.player.style || ''}`,
        requirements.player.count || 6,
        { 
          lane,
          desiredRoles: ['player', 'hero'],
          desiredKinds: ['sprite', 'character', 'model'],
          preferHero: true
        }
      );
      bundle.visuals.push(...playerAssets);
      console.log(`  ✓ Found ${playerAssets.length} player assets`);
    }

    if (requirements.enemies) {
      console.log(`🔍 Searching for enemy assets: "${requirements.enemies.description}"`);
      const enemyAssets = await searchAssets(
        `${requirements.enemies.description} ${requirements.enemies.style || ''}`,
        requirements.enemies.count || 8,
        { 
          lane,
          desiredRoles: ['enemy', 'obstacle'],
          desiredKinds: ['sprite', 'character', 'model'],
          preferHero: true
        }
      );
      bundle.visuals.push(...enemyAssets);
      console.log(`  ✓ Found ${enemyAssets.length} enemy assets`);
    }

    if (requirements.environment) {
      console.log(`🔍 Searching for environment assets: "${requirements.environment.description}"`);
      const envAssets = await searchAssets(
        `${requirements.environment.description} ${requirements.environment.style || ''}`,
        requirements.environment.count || 12,
        { 
          lane,
          desiredRoles: ['environment', 'prop', 'background'],
          desiredKinds: ['environment', 'sprite', 'model']
        }
      );
      bundle.visuals.push(...envAssets);
      console.log(`  ✓ Found ${envAssets.length} environment assets`);
    }

    if (requirements.pickups) {
      console.log(`🔍 Searching for pickup assets: "${requirements.pickups.description}"`);
      const pickupAssets = await searchAssets(
        `${requirements.pickups.description} ${requirements.pickups.style || ''}`,
        requirements.pickups.count || 5,
        { 
          lane,
          desiredRoles: ['pickup', 'item'],
          desiredKinds: ['item', 'sprite', 'environment']
        }
      );
      bundle.visuals.push(...pickupAssets);
      console.log(`  ✓ Found ${pickupAssets.length} pickup assets`);
    }

    if (requirements.audio) {
      console.log(`🔍 Searching for audio assets: "${requirements.audio.description}"`);
      const audioAssets = await searchAssets(
        `${requirements.audio.description} ${requirements.audio.mood || ''}`,
        requirements.audio.count || 8,
        { 
          lane,
          desiredKinds: ['audio']
        }
      );
      bundle.audio.push(...audioAssets);
      console.log(`  ✓ Found ${audioAssets.length} audio assets`);
    }

    if (requirements.controls) {
      console.log(`🔍 Searching for control assets: "${requirements.controls.description}"`);
      const controlAssets = await searchAssets(
        `${requirements.controls.description} ${requirements.controls.style || ''}`,
        requirements.controls.count || 6,
        { 
          lane,
          desiredRoles: ['control', 'ui'],
          desiredKinds: ['control', 'ui']
        }
      );
      bundle.controls.push(...controlAssets);
      console.log(`  ✓ Found ${controlAssets.length} control assets`);
    }

    if (requirements.models && (lane === 'first_person_threejs' || lane === 'third_person_threejs')) {
      console.log(`🔍 Searching for 3D model assets: "${requirements.models.description}"`);
      const modelAssets = await searchAssets(
        `${requirements.models.description} ${requirements.models.style || ''}`,
        requirements.models.count || 8,
        { 
          lane,
          desiredKinds: ['model'],
          runtime: 'threejs'
        }
      );
      bundle.models.push(...modelAssets);
      console.log(`  ✓ Found ${modelAssets.length} 3D model assets`);
    }

    // Deduplicate and format
    bundle.visuals = summarizeBundleSection(dedupeAssets(bundle.visuals), 'visual');
    bundle.controls = summarizeBundleSection(dedupeAssets(bundle.controls), 'control');
    bundle.audio = summarizeBundleSection(dedupeAssets(bundle.audio), 'audio');
    bundle.models = summarizeBundleSection(dedupeAssets(bundle.models), 'model');

    const totalAssets = bundle.visuals.length + bundle.controls.length + bundle.audio.length + bundle.models.length;
    console.log(`🎉 AI-Driven Asset Selection complete: ${totalAssets} assets selected`);
    console.log(`   Visuals: ${bundle.visuals.length}, Controls: ${bundle.controls.length}, Audio: ${bundle.audio.length}, Models: ${bundle.models.length}`);

    return totalAssets > 0 ? bundle : null;

  } catch (error) {
    console.error('❌ AI-driven asset selection failed:', error.message);
    console.log('⚠️ Falling back to rule-based asset selection');
    return buildDreamAssetBundle(specSheet, promptText);
  }
}

export function buildDreamAssetBundle(specSheet = {}, promptText = '') {
  const lane = specSheet?.runtimeLane || 'arcade_canvas';
  const controlRig = specSheet?.controlRig || null;
  const isCockpitDriver = lane === 'first_person_threejs' && controlRig === 'cockpit_driver';
  const isMoveAndFire = controlRig === 'move_and_fire';
  const isLaneSwipeRunner = controlRig === 'lane_swipe_runner';
  const wantsStrictGeneratedPixel = lane === 'pixel_platformer' && wantsGeneratedPixelArt(specSheet, promptText);
  const prompt = [
    promptText,
    specSheet?.title,
    specSheet?.genre,
    specSheet?.summary,
    specSheet?.entities?.hero,
    specSheet?.entities?.enemy,
    specSheet?.entities?.collectible,
  ].filter(Boolean).join(' ');

  if (!kenneyCatalog?.assets?.length && !phaserManifest?.entries?.length && !ASSET_LIBRARY.length) {
    return null;
  }

  let visuals = [];
  let controls = [];
  let audio = [];
  let models = [];
  let notes = [];

  switch (lane) {
    case 'endless_flyer':
      visuals = mergeAssetGroups(
        rankKenneyAssets(`${prompt} plane flyer bird player`, { lane, desiredRoles: ['player'], desiredKinds: ['sprite', 'character'], forbiddenRoles: ['ui', 'control'], preferHero: true, limit: 6 }),
        rankKenneyAssets(`${prompt} obstacle cloud sky pipe gate tower`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], forbiddenRoles: ['ui', 'control'], limit: 8 }),
        rankKenneyAssets(`${prompt} coin star pickup score`, { lane, desiredRoles: ['pickup'], desiredKinds: ['environment', 'item', 'sprite'], forbiddenRoles: ['ui', 'control'], limit: 5 })
      );
      controls = rankKenneyAssets(`${prompt} button joystick tap ui`, { lane, desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 });
      audio = rankKenneyAssets(`${prompt} jingle impact interface`, { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 8 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, visuals);
      break;

    case 'topdown_arcade':
      visuals = mergeAssetGroups(
        rankKenneyAssets(`${prompt} survivor soldier hero player gun blaster fighter`, { lane, desiredRoles: ['player'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 6 }),
        rankKenneyAssets(`${prompt} zombie skeleton enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 8 }),
        rankKenneyAssets(`${prompt} road parking lot tile barricade crate barrel floor curb wall`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 10 }),
        rankKenneyAssets(`${prompt} skyline horizon tree building fence sign streetlight background`, { lane, extraLanes: ['pixel_platformer'], desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 6 }),
        rankKenneyAssets(`${prompt} coin ammo medkit pickup`, { lane, desiredRoles: ['pickup'], desiredKinds: ['environment', 'item', 'sprite'], limit: 5 })
      );
      controls = rankKenneyAssets(
        isMoveAndFire
          ? `${prompt} joystick thumbpad fire button attack ui combat`
          : `${prompt} button shoot joystick ui`,
        { lane, desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 }
      );
      audio = rankKenneyAssets(
        isMoveAndFire
          ? `${prompt} gun hit muzzle impact combat interface`
          : `${prompt} impact interface gun hit`,
        { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 10 }
      );
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(isMoveAndFire
          ? ['Move-and-fire control rig detected: prefer visible combat-control art, ammo/medkit pickups, and readable enemy pressure over generic top-down filler.']
          : []),
      ];
      break;

    case 'pixel_platformer':
      visuals = wantsStrictGeneratedPixel
        ? []
        : mergeAssetGroups(
            rankKenneyAssets(`${prompt} pixel background clouds sky hills trees grass`, { lane, desiredRoles: ['environment'], desiredKinds: ['environment', 'sprite'], limit: 10 }),
            rankKenneyAssets(`${prompt} pixel player hero adventurer character`, { lane, desiredRoles: ['player'], desiredKinds: ['sprite', 'character'], preferHero: true, limit: 8 }),
            rankKenneyAssets(`${prompt} pixel slime ghost enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['sprite', 'character'], preferHero: true, limit: 8 }),
            rankKenneyAssets(`${prompt} coin gem heart pickup hud`, { lane, desiredRoles: ['pickup', 'ui'], desiredKinds: ['environment', 'sprite', 'item'], limit: 6 })
          );
      controls = wantsStrictGeneratedPixel
        ? []
        : rankKenneyAssets(`${prompt} button ui`, { lane, desiredRoles: ['ui'], desiredKinds: ['ui', 'control'], limit: 5 });
      audio = rankKenneyAssets(`${prompt} jingle platformer coin`, { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 8 });
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(wantsStrictGeneratedPixel
          ? ['Strict pixel-art prompt detected: do not attach Kenney visual sprites for this run. Generate original pixel art procedurally instead.']
          : ['This lane should stay visually pixel-first. Prefer the staged pixel platformer packs over smooth or mixed-style substitutes.']),
      ];
      break;

    case 'auto_battler_arena':
      visuals = filterAssetsByKeywords(
        mergeAssetGroups(
          rankKenneyAssets(`${prompt} knight archer wizard ally warrior paladin mage`, { lane, extraLanes: ['pixel_platformer', 'topdown_arcade'], desiredRoles: ['player'], desiredKinds: ['character', 'sprite', 'weapon'], preferHero: true, limit: 10 }),
          rankKenneyAssets(`${prompt} goblin orc zombie skeleton enemy monster`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer', 'first_person_threejs'], desiredRoles: ['enemy'], desiredKinds: ['character', 'sprite', 'model'], preferHero: true, limit: 10 }),
          rankKenneyAssets(`${prompt} battlefield arena board prep grid fantasy tile banner frame floor`, { lane, desiredRoles: ['environment', 'ui', 'prop'], desiredKinds: ['environment', 'ui', 'sprite'], limit: 12 }),
          rankKenneyAssets(`${prompt} gate castle torch crowd stand wall statue horizon backdrop`, { lane, extraLanes: ['pixel_platformer', 'topdown_arcade'], desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 8 }),
          pickLegacyAssets(`${prompt} knight archer wizard fantasy`, { limit: 6, categories: ['character', 'weapon'] }),
          pickLegacyAssets(`${prompt} goblin orc zombie skeleton ghost enemy`, { limit: 6, categories: ['enemy'] })
        ),
        ['knight', 'archer', 'wizard', 'mage', 'warrior', 'paladin', 'goblin', 'orc', 'skeleton', 'enemy', 'banner', 'gate', 'castle', 'arena', 'battle', 'grid', 'frame', 'tile']
      );
      visuals = visuals.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return (
          !/tile_\d+\.png/.test(label) &&
          !/\/tiles\/tile_\d+\.png/.test(url) &&
          !label.includes('cloud') &&
          !label.includes('sand tile') &&
          !label.includes('grass tile') &&
          !label.includes('water') &&
          !label.includes('lava') &&
          !url.includes('cloud') &&
          !url.includes('sand') &&
          !url.includes('grass') &&
          !url.includes('liquidwater') &&
          !url.includes('liquidlava')
        );
      });
      if (
        !hasAnyAssetKeyword(visuals, ['knight', 'archer', 'wizard', 'mage', 'warrior', 'paladin']) ||
        !hasAnyAssetKeyword(visuals, ['goblin', 'orc', 'skeleton', 'enemy', 'zombie', 'ghost']) ||
        !hasAnyAssetKeyword(visuals, ['banner', 'gate', 'castle', 'arena', 'battle', 'grid', 'frame', 'tile', 'wall', 'floor'])
      ) {
        visuals = [];
      }
      controls = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} battle button deploy ui frame`, { lane, desiredRoles: ['ui', 'control'], desiredKinds: ['ui', 'control', 'environment'], limit: 3 }),
        ['battle', 'button', 'frame', 'panel', 'banner', 'deploy']
      );
      controls = controls.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return !label.includes('divider-') && !url.includes('/divider/');
      });
      if (!hasAnyAssetKeyword(controls, ['battle', 'button', 'frame', 'panel', 'banner', 'deploy'])) {
        controls = [];
      }
      audio = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} impact sword magic battle interface`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 3 }),
        ['impact', 'sword', 'magic', 'battle', 'hit', 'attack']
      );
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(visuals.length === 0
          ? ['No convincing class/enemy/arena assets were found for this prompt, so the builder should proceduralize chunky allied squads, goblin fodder, and stage props instead of forcing weak fantasy sprites.']
          : []),
        ...(controls.length === 0
          ? ['No convincing battle-control art was found, so the builder should render a procedural BATTLE/deploy panel instead of pasting generic divider chrome into the arena.']
          : []),
      ];
      break;

    case 'endless_runner_vertical':
      visuals = filterAssetsByKeywords(
        mergeAssetGroups(
          rankKenneyAssets(`${prompt} runner player hero skater surfer character`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['player'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 6 }),
          rankKenneyAssets(`${prompt} train barrier cone obstacle sign crate hazard`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['enemy', 'obstacle', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 8 }),
          rankKenneyAssets(
            isLaneSwipeRunner
              ? `${prompt} road lane marker track stripe divider arrow skyline city building fence horizon background`
              : `${prompt} road lane marker track stripe skyline city building fence horizon background`,
            { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 10 }
          ),
          rankKenneyAssets(`${prompt} coin gem pickup score`, { lane, extraLanes: ['pixel_platformer'], desiredRoles: ['pickup'], desiredKinds: ['item', 'sprite', 'environment'], limit: 5 })
        ),
        ['runner', 'run', 'track', 'lane', 'road', 'stripe', 'barrier', 'train', 'coin', 'gem', 'pickup', 'sign', 'cone', 'arrow']
      );
      if (!hasAnyAssetKeyword(visuals, ['runner', 'track', 'lane', 'road', 'barrier', 'train', 'sign', 'cone'])) {
        visuals = [];
      }
      controls = filterAssetsByKeywords(rankKenneyAssets(
        isLaneSwipeRunner
          ? `${prompt} swipe left right jump slide ui lane runner`
          : `${prompt} swipe button ui lane`,
        { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 }
      ), ['left', 'right', 'arrow', 'button', 'direction', 'swipe']);
      controls = controls.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return !label.includes('direction_') && !url.includes('direction_');
      });
      if (!hasAnyAssetKeyword(controls, ['swipe', 'button', 'jump', 'slide'])) {
        controls = [];
      }
      audio = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} swoosh hit coin interface`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 8 }),
        ['coin', 'jump', 'swoosh', 'swipe', 'pickup', 'move', 'woosh']
      );
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(isLaneSwipeRunner
          ? ['Lane-swipe runner control rig detected: prioritize lane markers, obstacle telegraphing, and jump/slide cues so the path reads instantly.']
          : []),
        ...(visuals.length === 0
          ? ['No convincing runner character/track assets were found for this prompt, so the builder should proceduralize the runner silhouette, lanes, and early obstacles instead of forcing weak sprite support.']
          : []),
        ...(controls.length === 0
          ? ['No convincing lane-runner control art was found, so the builder should rely on swipe coaching, motion telegraphing, and a procedural jump/slide treatment instead of explicit arrow buttons.']
          : []),
      ];
      break;

    case 'story_horror_vignette':
      visuals = filterAssetsByKeywords(
        mergeAssetGroups(
          rankKenneyAssets(`${prompt} paper note letter terminal frame card panel eerie prop`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['environment', 'prop', 'ui'], desiredKinds: ['environment', 'ui', 'item', 'sprite'], limit: 6 }),
          rankKenneyAssets(`${prompt} candle lamp glow dust smoke shadow frame background`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite', 'item'], limit: 5 })
        ),
        ['panel', 'frame', 'window', 'terminal', 'screen', 'card', 'paper', 'note', 'letter', 'lamp', 'candle']
      );
      controls = rankKenneyAssets(`${prompt} yes no continue button ui prompt`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 5 });
      controls = controls.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return !label.includes('button_bean') && !label.includes('screws') && !url.includes('button_bean') && !url.includes('screws');
      });
      if (!hasAnyAssetKeyword(controls, ['button', 'panel', 'frame', 'card', 'tab'])) {
        controls = [];
      }
      audio = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} ambience hum whisper click interface eerie`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 6 }),
        ['hum', 'whisper', 'click', 'interface', 'eerie', 'soft', 'ambient']
      );
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        'Minimal story/horror vignette detected: sparse assets are acceptable if atmosphere, typography, and one strong focal object carry the scene.',
        ...(controls.length === 0
          ? ['No convincing story-choice UI art was found, so the builder should render restrained procedural YES/NO or CONTINUE controls instead of using playful mobile or sci-fi button skins.']
          : []),
      ];
      break;

    case 'simulation_toybox':
      visuals = filterAssetsByKeywords(
        mergeAssetGroups(
          rankKenneyAssets(`${prompt} ingredient card pantry shelf tray bottle jar fruit gem reagent item`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['pickup', 'item', 'prop', 'ui'], desiredKinds: ['item', 'ui', 'sprite', 'environment'], limit: 8 }),
          rankKenneyAssets(`${prompt} cauldron pot machine altar lab table workbench station core vessel`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['environment', 'prop', 'ui'], desiredKinds: ['environment', 'sprite', 'ui', 'item'], limit: 8 }),
          rankKenneyAssets(`${prompt} result card badge reveal modal frame spark bubble glow`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['ui', 'prop'], desiredKinds: ['ui', 'environment', 'item', 'sprite'], limit: 6 })
        ),
        ['card', 'panel', 'tray', 'shelf', 'bottle', 'jar', 'potion', 'gem', 'item', 'machine', 'station', 'workbench', 'altar', 'pot', 'cauldron', 'frame', 'badge']
      );
      if (!hasAnyAssetKeyword(visuals, ['machine', 'station', 'workbench', 'altar', 'pot', 'cauldron', 'tray', 'shelf', 'card', 'frame'])) {
        visuals = [];
      }
      controls = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} drag button combine mix fuse cook brew reveal ui`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 }),
        ['button', 'panel', 'frame', 'card', 'tab']
      );
      if (visuals.length === 0) {
        controls = [];
      }
      audio = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} bubble pop sparkle reveal success interface`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 6 }),
        ['bubble', 'pop', 'sparkle', 'success', 'confirm', 'magic', 'reveal']
      );
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        'Simulation/toybox lane detected: prioritize source shelf/tray ingredients, one central machine or vessel, and a satisfying reveal/result layer.',
        ...(visuals.length === 0
          ? ['No convincing workstation assets were found for this prompt, so the builder should proceduralize the toybox layout and controls instead of forcing mismatched props or generic UI buttons.']
          : []),
      ];
      break;

    case 'single_room_shooter':
      visuals = mergeAssetGroups(
        rankKenneyAssets(`${prompt} soldier survivor hero player gun`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['player'], desiredKinds: ['character', 'sprite', 'weapon'], preferHero: true, limit: 6 }),
        rankKenneyAssets(`${prompt} zombie skeleton enemy monster raider`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['enemy'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 8 }),
        rankKenneyAssets(`${prompt} bunker room wall floor table crate barrel cover terminal prop`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer'], desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 10 }),
        rankKenneyAssets(`${prompt} medkit ammo coin pickup`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['pickup'], desiredKinds: ['item', 'sprite', 'environment'], limit: 5 }),
        pickLegacyAssets(`${prompt} torch door rock bunker cover`, { limit: 5, categories: ['decoration', 'environment'] })
      );
      visuals = visuals.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return (
          !/tile_\d+\.png/.test(label) &&
          !/\/tiles\/tile_\d+\.png/.test(url) &&
          !label.includes('cloud') &&
          !label.includes('sand tile') &&
          !label.includes('grass tile') &&
          !label.includes('water') &&
          !label.includes('lava') &&
          !url.includes('cloud') &&
          !url.includes('sand') &&
          !url.includes('grass') &&
          !url.includes('liquidwater') &&
          !url.includes('liquidlava')
        );
      });
      controls = rankKenneyAssets(`${prompt} fire button joystick ui`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 });
      controls = controls.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return !label.includes('screws') && !url.includes('screws');
      });
      if (!hasAnyAssetKeyword(controls, ['joystick', 'button', 'attack', 'fire', 'thumb'])) {
        controls = [];
      }
      audio = filterAssetsByKeywords(
        rankKenneyAssets(`${prompt} gunshot muzzle hit reload impact combat weapon`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 8 }),
        ['gun', 'shot', 'gunshot', 'hit', 'reload', 'impact', 'weapon', 'attack', 'combat']
      );
      audio = audio.filter((asset) => {
        const label = String(asset?.label || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return !label.includes('footstep') && !url.includes('footstep');
      });
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(!hasAnyAssetKeyword(visuals, ['wall', 'floor', 'table', 'crate', 'barrel', 'cover', 'terminal', 'room', 'bunker'])
          ? ['No convincing room-kit props were found for this prompt, so the builder should proceduralize the back wall, cover pieces, and floor framing instead of forcing generic tile slices.']
          : []),
        ...(controls.length === 0
          ? ['No convincing move-and-fire control art was found, so the builder should render a procedural joystick and attack button instead of pasting generic sci-fi chrome.']
          : []),
      ];
      break;

    case 'first_person_threejs':
      if (isCockpitDriver) {
        models = mergeAssetGroups(
          rankKenneyAssets(`${prompt} road barrier traffic cone pillar tunnel prop`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['environment', 'prop'], desiredKinds: ['model', 'environment'], runtime: 'threejs', limit: 8 }),
          rankKenneyAssets(`${prompt} boost pickup checkpoint coin`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['pickup'], desiredKinds: ['model', 'environment'], runtime: 'threejs', preferHero: true, limit: 5 }),
          rankKenneyAssets(`${prompt} vehicle car chassis cockpit dashboard prop`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['player', 'prop'], desiredKinds: ['model', 'environment'], runtime: 'threejs', preferHero: true, limit: 5 })
        );
        controls = filterAssetsByKeywords(mergeAssetGroups(
          rankKenneyAssets(`${prompt} steering wheel dashboard speedometer pedal ui`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 8 }),
          pickLegacyAssets(`${prompt} speedometer dashboard steering`, { limit: 4, categories: ['decoration', 'item'] })
        ), ['steer', 'wheel', 'dashboard', 'speed', 'pedal', 'meter', 'rpm', 'gauge']);
        audio = rankKenneyAssets(`${prompt} engine rev brake swoosh interface`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 6 });
        notes = [
          ...enrichNotesWithCrossLaneBorrowing(lane, [...models, ...controls]),
          'Cockpit-driver control rig detected: prioritize dashboard, steering, pedals, road cues, and horizon props over dungeon-style first-person set dressing.',
        ];
      } else {
        models = mergeAssetGroups(
          rankKenneyAssets(`${prompt} zombie skeleton enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['model'], runtime: 'threejs', preferHero: true, limit: 6 }),
          rankKenneyAssets(`${prompt} chest coin pickup treasure`, { lane, desiredRoles: ['pickup'], desiredKinds: ['model'], runtime: 'threejs', preferHero: true, limit: 5 }),
          rankKenneyAssets(`${prompt} wall floor dungeon graveyard barrel torch prop`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['model'], runtime: 'threejs', limit: 8 })
        );
        controls = rankKenneyAssets(`${prompt} button joystick ui touch`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 6 });
        audio = rankKenneyAssets(`${prompt} impact interface horror hit`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 6 });
        notes = enrichNotesWithCrossLaneBorrowing(lane, models);
      }
      break;

    case 'third_person_threejs':
      models = mergeAssetGroups(
        rankKenneyAssets(`${prompt} visible player hero character car vehicle body`, { lane, extraLanes: ['first_person_threejs', 'topdown_arcade'], desiredRoles: ['player', 'prop'], desiredKinds: ['model', 'character', 'sprite'], runtime: 'threejs', preferHero: true, limit: 6 }),
        rankKenneyAssets(`${prompt} enemy traffic hazard monster drone obstacle`, { lane, extraLanes: ['first_person_threejs', 'topdown_arcade'], desiredRoles: ['enemy', 'obstacle', 'prop'], desiredKinds: ['model', 'environment', 'sprite'], runtime: 'threejs', preferHero: true, limit: 8 }),
        rankKenneyAssets(`${prompt} road arena floor wall cover checkpoint pickup landmark horizon`, { lane, extraLanes: ['first_person_threejs', 'topdown_arcade', 'pixel_platformer'], desiredRoles: ['environment', 'pickup', 'prop'], desiredKinds: ['model', 'environment', 'item', 'sprite'], runtime: 'threejs', limit: 10 })
      );
      controls = rankKenneyAssets(`${prompt} joystick action attack accelerate brake drift ui touch`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 8 });
      audio = rankKenneyAssets(`${prompt} impact engine hit pickup boost interface`, { lane, extraLanes: ['first_person_threejs', 'topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 8 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, [...models, ...controls]);
      break;

    default:
      visuals = mergeAssetGroups(
        rankKenneyAssets(prompt, { desiredKinds: ['character', 'sprite', 'environment', 'item', 'weapon'], preferHero: true, limit: 12 }),
        pickLegacyAssets(prompt, { limit: 8, categories: ['character', 'enemy', 'environment', 'item', 'weapon'] })
      );
      notes = [
        'This lane has no dedicated bundle recipe yet, so the asset brain searched the whole organized Kenney library and then fell back to the legacy curated set.',
      ];
      break;
  }

  const phaserAugment = augmentBundleWithPhaser({
    lane,
    prompt,
    visuals,
    controls,
    audio,
    models,
    isCockpitDriver,
  });
  visuals = phaserAugment.visuals;
  controls = phaserAugment.controls;
  audio = phaserAugment.audio;
  models = phaserAugment.models;
  notes = [...notes, ...phaserAugment.notes];

  const bundle = {
    lane,
    visuals: summarizeBundleSection(visuals, 'visual'),
    controls: summarizeBundleSection(controls, 'control'),
    audio: summarizeBundleSection(audio, 'audio'),
    models: summarizeBundleSection(models, 'model'),
    notes,
  };

  const total = bundle.visuals.length + bundle.controls.length + bundle.audio.length + bundle.models.length;
  return total > 0 ? bundle : null;
}

/**
 * Search assets using the Kenney catalog first, then fall back to Phaser and the
 * legacy precomputed vector store when needed.
 */
export async function searchAssets(query, maxResults = 8, options = {}) {
  const phaserRanked = rankPhaserAssets(query, {
    desiredRoles: options?.desiredRoles || (options?.category ? [options.category] : []),
    desiredKinds: options?.desiredKinds || [],
    runtime: options?.runtime || null,
    preferHero: options?.preferHero !== false,
    limit: maxResults,
  });

  if (kenneyCatalog?.assets?.length) {
    const ranked = rankKenneyAssets(query, {
      lane: options?.lane || null,
      extraLanes: options?.lanes || [],
      desiredRoles: options?.desiredRoles || (options?.category ? [options.category] : []),
      desiredKinds: options?.desiredKinds || [],
      runtime: options?.runtime || null,
      preferHero: options?.preferHero !== false,
      limit: maxResults,
    });

    const combinedRanked = dedupeAssets([...ranked, ...phaserRanked]).slice(0, maxResults);
    if (combinedRanked.length) {
      return combinedRanked;
    }
  }

  if (phaserRanked.length) {
    return phaserRanked.slice(0, maxResults);
  }

  if (!precomputedEmbeddings) {
    console.error("❌ Precomputed embeddings missing! Run precompute_embeddings.js");
    return [];
  }

  const queryVector = await getEmbedding(query);
  if (!queryVector) return [];

  const scored = precomputedEmbeddings.map(entry => {
    const score = cosineSimilarity(queryVector, entry.vector);
    const assetObj = ASSET_LIBRARY.find(a => a.id === entry.assetId);
    return { 
      ...assetObj, 
      score,
      // Construct the full absolute URL for the AI
      url: `${ASSET_BASE_URL}/${assetObj.file}`
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(a => a.score > 0.40).slice(0, maxResults);
}

/**
 * Get all available assets (for admin/debug)
 */
export function getAllAssets() {
  return dedupeAssets([
    ...(kenneyCatalog?.assets?.length ? getKenneyAssets() : []),
    ...getPhaserAssets(),
    ...ASSET_LIBRARY.map(a => ({ ...a, url: `${ASSET_BASE_URL}/${a.file}` })),
  ]);
}

function publicUrlForDiagnostics(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url).replace(/[?#].*$/, '');
  }
}

function envFlag(name) {
  return Boolean(String(process.env[name] || '').trim());
}

export function getAssetRuntimeDiagnostics() {
  const kenneyAssets = kenneyCatalog?.assets?.length ? getKenneyAssets({ includeNoise: true }) : [];
  const phaserAssets = getPhaserAssets({ includeNoise: true });
  const legacyAssets = ASSET_LIBRARY.map(a => ({ ...a, url: `${ASSET_BASE_URL}/${a.file}` }));
  const sampleKenney = kenneyAssets.slice(0, 5).map((asset) => ({
    id: asset.id,
    label: asset.label,
    kind: asset.kind,
    role: asset.role,
    runtime: asset.runtime,
    url: publicUrlForDiagnostics(asset.url),
  }));

  return {
    bases: {
      kenney: publicUrlForDiagnostics(KENNEY_BASE_URL),
      legacyKenney: publicUrlForDiagnostics(ASSET_BASE_URL),
      phaser: publicUrlForDiagnostics(PHASER_BASE_URL),
    },
    env: {
      KENNEY_ASSET_BASE: envFlag('KENNEY_ASSET_BASE'),
      KENNEY_ASSET_URL: envFlag('KENNEY_ASSET_URL'),
      KENNEY_FULL_ASSET_BASE: envFlag('KENNEY_FULL_ASSET_BASE'),
      KENNEY_FULL_ASSET_URL: envFlag('KENNEY_FULL_ASSET_URL'),
      KENNEY_WAVE1_ASSET_BASE: envFlag('KENNEY_WAVE1_ASSET_BASE'),
      KENNEY_WAVE1_ASSET_URL: envFlag('KENNEY_WAVE1_ASSET_URL'),
      KENNEY_CATALOG_PATH: envFlag('KENNEY_CATALOG_PATH'),
      KENNEY_INTELLIGENCE_PATH: envFlag('KENNEY_INTELLIGENCE_PATH'),
      R2_PUBLIC_URL: envFlag('R2_PUBLIC_URL'),
      R2_BUCKET_NAME: envFlag('R2_BUCKET_NAME'),
      R2_ACCOUNT_ID: envFlag('R2_ACCOUNT_ID'),
      R2_ACCESS_KEY_ID: envFlag('R2_ACCESS_KEY_ID'),
      R2_SECRET_ACCESS_KEY: envFlag('R2_SECRET_ACCESS_KEY'),
    },
    catalogs: {
      kenney: {
        loaded: Boolean(kenneyCatalog?.assets?.length),
        source: kenneyCatalogInfo?.source || null,
        path: kenneyCatalogInfo?.path || null,
        servingRoot: publicUrlForDiagnostics(kenneyCatalogInfo?.servingRoot),
        assets: kenneyCatalog?.assets?.length || 0,
        usefulAssets: kenneyCatalog?.summary?.totals?.usefulAssets || null,
      },
      phaser: {
        loaded: Boolean(phaserManifest?.entries?.length),
        path: PHASER_MANIFEST_PATH,
        assets: phaserManifest?.entries?.length || 0,
      },
      legacyCurated: {
        assets: legacyAssets.length,
      },
    },
    totals: {
      kenney: kenneyAssets.length,
      phaser: phaserAssets.length,
      legacyCurated: legacyAssets.length,
      allDeduped: getAllAssets().length,
    },
    samples: {
      kenney: sampleKenney,
    },
  };
}

/**
 * Get assets by category
 */
export function getAssetsByCategory(category) {
  return dedupeAssets([
    ...(kenneyCatalog?.assets?.length ? getKenneyAssets({ category }) : []),
    ...getPhaserAssets({ category }),
    ...ASSET_LIBRARY
      .filter(a => a.category === category)
      .map(a => ({ ...a, url: `${ASSET_BASE_URL}/${a.file}` })),
  ]);
}
