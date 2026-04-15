/**
 * DreamStream Asset Dictionary v4.0 — SELF-HOSTED KENNEY SPRITES
 * 
 * 838 hand-picked, CC0-licensed 2D game sprites from Kenney.nl,
 * hosted directly on our own Railway backend at /uploads/kenney/.
 * 
 * No more broken external URLs. No more CORS. No more 404s.
 * These files live on OUR server and are served via Express static middleware.
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
const WAVE1_STAGE_CANDIDATES = [
  path.join(REPO_ROOT, 'public', 'uploads', 'kenney-wave1'),
  path.join(ASSET_STORAGE_ROOT, 'kenney-wave1'),
];
const WAVE1_CATALOG_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-catalog.json');
const WAVE1_INTELLIGENCE_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-intelligence.json');

let ASSET_BASE_URL = `${DEFAULT_BASE}/uploads/kenney`;
let WAVE1_BASE_URL = `${DEFAULT_BASE}/uploads/kenney-wave1`;

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
};

const LANE_NOTES = {
  endless_flyer: [
    'Keep the flyer high enough on screen that the opening state looks safe and playable.',
    'Obstacle silhouettes matter more than raw asset count here; one strong plane plus clean hazards beats a cluttered bundle.',
  ],
  topdown_arcade: [
    'Prefer readable survivor and zombie silhouettes over over-decorating the map.',
    'A few good tiles, pickups, and impacts are enough to sell the lane.',
  ],
  pixel_platformer: [
    'Prioritize clear terrain silhouettes, readable pickups, and one dependable enemy family.',
  ],
  auto_battler_arena: [
    'This lane currently borrows character ingredients from nearby sprite families when the dedicated battle packs are too tile-heavy.',
    'If class-specific art is still imperfect, keep units chunky and readable instead of shrinking them into colored dots.',
  ],
  first_person_threejs: [
    'Use same-origin GLB models only if they actually help readability; otherwise keep geometry procedural and use the kit for landmarks.',
  ],
};

/**
 * Call this from routes.js with the actual request to set the correct base URL
 */
export function setAssetBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  ASSET_BASE_URL = `${protocol}://${host}/uploads/kenney`;
  WAVE1_BASE_URL = `${protocol}://${host}/uploads/kenney-wave1`;
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
  const napiKey = process.env.NVIDIA_API_KEY || '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';
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
let wave1Catalog = null;

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
  const wave1StageRoot = WAVE1_STAGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  const preferredCatalogPath = fs.existsSync(WAVE1_INTELLIGENCE_PATH) ? WAVE1_INTELLIGENCE_PATH : WAVE1_CATALOG_PATH;
  if (fs.existsSync(preferredCatalogPath) && wave1StageRoot) {
    wave1Catalog = JSON.parse(fs.readFileSync(preferredCatalogPath, 'utf8'));
    console.log(
      `✅ Loaded Wave 1 Kenney catalog with ${wave1Catalog?.summary?.totals?.usefulAssets || wave1Catalog?.totals?.assets || 0} staged assets from ${wave1StageRoot}.`
    );
  }
} catch (e) {
  console.warn("⚠️ Failed to load Wave 1 Kenney catalog:", e.message);
}

function toAbsoluteWave1Url(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${WAVE1_BASE_URL}${url.replace(/^\/uploads\/kenney-wave1/, '')}`;
}

function toAbsoluteLegacyUrl(file) {
  return `${ASSET_BASE_URL}/${file}`;
}

function mapWave1Asset(asset) {
  return {
    id: `${asset.lane}:${asset.packSlug}:${asset.filename}`,
    file: asset.targetPath,
    tags: asset.tags || [],
    category: asset.kind || asset.role || asset.runtime || 'asset',
    label: `${asset.packName} — ${asset.filename}`,
    lane: asset.lane,
    runtime: asset.runtime,
    role: asset.role,
    packName: asset.packName,
    kind: asset.kind,
    useful: asset.useful !== false,
    semanticRoles: asset.semanticRoles || [],
    qualityHint: asset.qualityHint || 'support',
    url: toAbsoluteWave1Url(asset.url),
  };
}

function getWave1Assets({ lane = null, category = null, includeNoise = false } = {}) {
  const assets = wave1Catalog?.assets || [];
  return assets
    .filter((asset) => !lane || asset.lane === lane)
    .filter((asset) => !category || asset.kind === category || asset.role === category || asset.runtime === category)
    .filter((asset) => includeNoise || asset.useful !== false)
    .map(mapWave1Asset);
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

function rankWave1Assets(query, options = {}) {
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
    .flatMap((laneName, laneIndex) => getWave1Assets({ lane: laneName }).map((asset) => ({ ...asset, __laneIndex: laneIndex })))
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

  return dedupeAssets(ranked).slice(0, limit);
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

export function buildDreamAssetBundle(specSheet = {}, promptText = '') {
  const lane = specSheet?.runtimeLane || 'arcade_canvas';
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

  if (!wave1Catalog?.assets?.length && !ASSET_LIBRARY.length) {
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
        rankWave1Assets(`${prompt} plane flyer bird player`, { lane, desiredRoles: ['player'], desiredKinds: ['sprite', 'character'], forbiddenRoles: ['ui', 'control'], preferHero: true, limit: 2 }),
        rankWave1Assets(`${prompt} obstacle cloud sky pipe gate tower`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], forbiddenRoles: ['ui', 'control'], limit: 2 }),
        rankWave1Assets(`${prompt} coin star pickup score`, { lane, desiredRoles: ['pickup'], desiredKinds: ['environment', 'item', 'sprite'], forbiddenRoles: ['ui', 'control'], limit: 2 })
      );
      controls = rankWave1Assets(`${prompt} button joystick tap ui`, { lane, desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 3 });
      audio = rankWave1Assets(`${prompt} jingle impact interface`, { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 3 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, visuals);
      break;

    case 'topdown_arcade':
      visuals = mergeAssetGroups(
        rankWave1Assets(`${prompt} survivor soldier hero player gun`, { lane, desiredRoles: ['player'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 2 }),
        rankWave1Assets(`${prompt} zombie skeleton enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['character', 'sprite'], preferHero: true, limit: 2 }),
        rankWave1Assets(`${prompt} road parking lot tile barricade crate barrel`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['environment', 'sprite'], limit: 2 }),
        rankWave1Assets(`${prompt} coin ammo medkit pickup`, { lane, desiredRoles: ['pickup'], desiredKinds: ['environment', 'item', 'sprite'], limit: 2 })
      );
      controls = rankWave1Assets(`${prompt} button shoot joystick ui`, { lane, desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 2 });
      audio = rankWave1Assets(`${prompt} impact interface gun hit`, { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 3 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, visuals);
      break;

    case 'pixel_platformer':
      visuals = wantsStrictGeneratedPixel
        ? []
        : mergeAssetGroups(
            rankWave1Assets(`${prompt} pixel background clouds sky hills trees grass`, { lane, desiredRoles: ['environment'], desiredKinds: ['environment', 'sprite'], limit: 3 }),
            rankWave1Assets(`${prompt} pixel player hero adventurer character`, { lane, desiredRoles: ['player'], desiredKinds: ['sprite', 'character'], preferHero: true, limit: 3 }),
            rankWave1Assets(`${prompt} pixel slime ghost enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['sprite', 'character'], preferHero: true, limit: 2 }),
            rankWave1Assets(`${prompt} coin gem heart pickup hud`, { lane, desiredRoles: ['pickup', 'ui'], desiredKinds: ['environment', 'sprite', 'item'], limit: 2 })
          );
      controls = wantsStrictGeneratedPixel
        ? []
        : rankWave1Assets(`${prompt} button ui`, { lane, desiredRoles: ['ui'], desiredKinds: ['ui', 'control'], limit: 2 });
      audio = rankWave1Assets(`${prompt} jingle platformer coin`, { lane, desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 2 });
      notes = [
        ...enrichNotesWithCrossLaneBorrowing(lane, visuals),
        ...(wantsStrictGeneratedPixel
          ? ['Strict pixel-art prompt detected: do not attach Kenney visual sprites for this run. Generate original pixel art procedurally instead.']
          : ['This lane should stay visually pixel-first. Prefer the staged pixel platformer packs over smooth or mixed-style substitutes.']),
      ];
      break;

    case 'auto_battler_arena':
      visuals = mergeAssetGroups(
        rankWave1Assets(`${prompt} knight archer wizard ally warrior paladin mage`, { lane, extraLanes: ['pixel_platformer', 'topdown_arcade'], desiredRoles: ['player'], desiredKinds: ['character', 'sprite', 'weapon'], preferHero: true, limit: 3 }),
        rankWave1Assets(`${prompt} goblin orc zombie skeleton enemy monster`, { lane, extraLanes: ['topdown_arcade', 'pixel_platformer', 'first_person_threejs'], desiredRoles: ['enemy'], desiredKinds: ['character', 'sprite', 'model'], preferHero: true, limit: 3 }),
        rankWave1Assets(`${prompt} battlefield arena board prep grid fantasy tile banner frame`, { lane, desiredRoles: ['environment', 'ui', 'prop'], desiredKinds: ['environment', 'ui', 'sprite'], limit: 4 }),
        pickLegacyAssets(`${prompt} knight archer wizard fantasy`, { limit: 4, categories: ['character', 'weapon'] }),
        pickLegacyAssets(`${prompt} goblin orc zombie skeleton ghost enemy`, { limit: 3, categories: ['enemy'] })
      );
      controls = rankWave1Assets(`${prompt} battle button deploy ui frame`, { lane, desiredRoles: ['ui', 'control'], desiredKinds: ['ui', 'control', 'environment'], limit: 3 });
      audio = rankWave1Assets(`${prompt} impact sword magic battle interface`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 3 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, visuals);
      break;

    case 'first_person_threejs':
      models = mergeAssetGroups(
        rankWave1Assets(`${prompt} zombie skeleton enemy monster`, { lane, desiredRoles: ['enemy'], desiredKinds: ['model'], runtime: 'threejs', preferHero: true, limit: 2 }),
        rankWave1Assets(`${prompt} chest coin pickup treasure`, { lane, desiredRoles: ['pickup'], desiredKinds: ['model'], runtime: 'threejs', preferHero: true, limit: 2 }),
        rankWave1Assets(`${prompt} wall floor dungeon graveyard barrel torch prop`, { lane, desiredRoles: ['environment', 'prop'], desiredKinds: ['model'], runtime: 'threejs', limit: 4 })
      );
      controls = rankWave1Assets(`${prompt} button joystick ui touch`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['control', 'ui'], desiredKinds: ['control', 'ui'], limit: 3 });
      audio = rankWave1Assets(`${prompt} impact interface horror hit`, { lane, extraLanes: ['topdown_arcade'], desiredRoles: ['audio'], desiredKinds: ['audio'], limit: 3 });
      notes = enrichNotesWithCrossLaneBorrowing(lane, models);
      break;

    default:
      visuals = mergeAssetGroups(
        rankWave1Assets(prompt, { desiredKinds: ['character', 'sprite', 'environment', 'item', 'weapon'], preferHero: true, limit: 6 }),
        pickLegacyAssets(prompt, { limit: 4, categories: ['character', 'enemy', 'environment', 'item', 'weapon'] })
      );
      notes = [
        'This lane has no dedicated bundle recipe yet, so the asset brain searched the whole organized Kenney library and then fell back to the legacy curated set.',
      ];
      break;
  }

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
 * Search assets using the curated Wave 1 intelligence index first, then fall back
 * to the legacy precomputed vector store when needed.
 */
export async function searchAssets(query, maxResults = 8, options = {}) {
  if (wave1Catalog?.assets?.length) {
    const ranked = rankWave1Assets(query, {
      lane: options?.lane || null,
      extraLanes: options?.lanes || [],
      desiredRoles: options?.desiredRoles || (options?.category ? [options.category] : []),
      desiredKinds: options?.desiredKinds || [],
      runtime: options?.runtime || null,
      preferHero: options?.preferHero !== false,
      limit: maxResults,
    });

    if (ranked.length) {
      return ranked;
    }
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
  if (wave1Catalog?.assets?.length) {
    return getWave1Assets();
  }
  return ASSET_LIBRARY.map(a => ({ ...a, url: `${ASSET_BASE_URL}/${a.file}` }));
}

/**
 * Get assets by category
 */
export function getAssetsByCategory(category) {
  if (wave1Catalog?.assets?.length) {
    return getWave1Assets({ category });
  }
  return ASSET_LIBRARY
    .filter(a => a.category === category)
    .map(a => ({ ...a, url: `${ASSET_BASE_URL}/${a.file}` }));
}
