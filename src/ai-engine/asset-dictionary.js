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

// Base URL is constructed at runtime from the request's host
// Default fallback for local dev
const DEFAULT_BASE = process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000';

let ASSET_BASE_URL = `${DEFAULT_BASE}/uploads/kenney`;
let WAVE1_BASE_URL = `${DEFAULT_BASE}/uploads/kenney-wave1`;

/**
 * Call this from routes.js with the actual request to set the correct base URL
 */
export function setAssetBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  ASSET_BASE_URL = `${protocol}://${host}/uploads/kenney`;
  WAVE1_BASE_URL = `${protocol}://${host}/uploads/kenney-wave1`;
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
        model: 'nvidia/nv-embedqa-e5-v5',
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const wave1CatalogPath = path.resolve(process.cwd(), 'docs', 'kenney-wave1-catalog.json');
  const wave1StageRoot = path.resolve(process.cwd(), 'public', 'uploads', 'kenney-wave1');
  if (fs.existsSync(wave1CatalogPath) && fs.existsSync(wave1StageRoot)) {
    wave1Catalog = JSON.parse(fs.readFileSync(wave1CatalogPath, 'utf8'));
    console.log(`✅ Loaded Wave 1 Kenney catalog with ${wave1Catalog?.totals?.assets || 0} staged assets.`);
  }
} catch (e) {
  console.warn("⚠️ Failed to load Wave 1 Kenney catalog:", e.message);
}

function toAbsoluteWave1Url(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${WAVE1_BASE_URL}${url.replace(/^\/uploads\/kenney-wave1/, '')}`;
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
    url: toAbsoluteWave1Url(asset.url),
  };
}

function getWave1Assets({ lane = null, category = null } = {}) {
  const assets = wave1Catalog?.assets || [];
  return assets
    .filter((asset) => !lane || asset.lane === lane)
    .filter((asset) => !category || asset.kind === category || asset.role === category || asset.runtime === category)
    .map(mapWave1Asset);
}

function scoreWave1Asset(asset, query) {
  const haystack = [
    asset.packName,
    asset.filename,
    asset.kind,
    asset.role,
    asset.lane,
    ...(asset.tags || []),
  ].join(' ').toLowerCase();

  let score = 0;
  for (const token of String(query || '').toLowerCase().split(/\s+/).filter(Boolean)) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/**
 * Perform vector search using precomputed cosine similarity
 */
export async function searchAssets(query, maxResults = 8, options = {}) {
  if (wave1Catalog?.assets?.length) {
    const lane = options?.lane || null;
    const category = options?.category || null;
    const ranked = getWave1Assets({ lane, category })
      .map((asset) => ({ ...asset, score: scoreWave1Asset(asset, query) }))
      .filter((asset) => asset.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, maxResults);

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
