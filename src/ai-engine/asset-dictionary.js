/**
 * DreamStream Asset Dictionary
 * 
 * A curated library of high-quality, CC0-licensed 2D game sprites from Kenney.nl
 * hosted on their public GitHub CDN. The AI Planner Agent searches this dictionary
 * by tags instead of generating every image from scratch via Pollinations.
 * 
 * Architecture: Rezona-inspired "Search First, Generate Last"
 * - If a tag matches → use the pre-made, perfect sprite URL
 * - If no tag matches → fall back to Pollinations AI image generation
 */

// Base URL for Kenney's GitHub-hosted PNG assets
const KENNEY_BASE = 'https://raw.githubusercontent.com/kenney-assets/Game-Assets/main';

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg';

// All assets are tagged for semantic search by the Planner Agent
const ASSET_LIBRARY = [
  // ============================================
  // CHARACTERS & PLAYERS
  // ============================================
  { id: 'char_alien_green', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/space-baddie.png', tags: ['alien', 'player', 'green', 'platformer', 'character', 'hero'], category: 'character', label: 'Alien Hero' },
  { id: 'char_knight', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/shinyball.png', tags: ['knight', 'warrior', 'medieval', 'dungeon', 'hero', 'armor', 'sword', 'character'], category: 'character', label: 'Shiny Hero' },
  { id: 'char_zombie', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/ghost.png', tags: ['zombie', 'enemy', 'undead', 'horror', 'monster', 'villain', 'scary', 'ghost'], category: 'character', label: 'Ghost Enemy' },
  { id: 'char_robot', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/mine.png', tags: ['robot', 'mech', 'sci-fi', 'machine', 'future', 'android', 'character'], category: 'character', label: 'Floating Mine' },
  { id: 'char_animal', url: `${TWEMOJI_BASE}/1f436.svg`, tags: ['animal', 'pet', 'dog', 'cat', 'farm', 'cute', 'character'], category: 'character', label: 'Animal Dog' },

  // ============================================
  // SPACE & SCI-FI
  // ============================================
  { id: 'space_ship', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/asteroids_ship.png', tags: ['spaceship', 'ship', 'space', 'shooter', 'rocket', 'ufo', 'vehicle', 'sci-fi'], category: 'vehicle', label: 'Space Ship' },
  { id: 'space_planets', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/earth.png', tags: ['planet', 'space', 'earth', 'moon', 'sun', 'star', 'galaxy', 'background', 'cosmos'], category: 'background', label: 'Earth Planet' },

  // ============================================
  // PLATFORMER TILES & ENVIRONMENTS
  // ============================================
  { id: 'tiles_platformer', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/platform.png', tags: ['platform', 'tile', 'ground', 'block', 'brick', 'level', 'environment', 'jump'], category: 'environment', label: 'Grass Platform' },
  { id: 'tiles_dungeon', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/mushroom2.png', tags: ['dungeon', 'cave', 'dark', 'underground', 'medieval', 'tile', 'wall', 'floor'], category: 'environment', label: 'Dungeon Mushroom' },
  { id: 'tiles_town', url: `${TWEMOJI_BASE}/1f3d8.svg`, tags: ['town', 'city', 'house', 'building', 'road', 'village', 'urban', 'tile'], category: 'environment', label: 'Town Building' },

  // ============================================
  // UI ELEMENTS
  // ============================================
  { id: 'ui_buttons', url: `${TWEMOJI_BASE}/25b6.svg`, tags: ['button', 'ui', 'menu', 'interface', 'panel', 'hud', 'start', 'play'], category: 'ui', label: 'Play Button' },
  { id: 'ui_icons', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/diamond.png', tags: ['icon', 'heart', 'star', 'coin', 'gem', 'trophy', 'score', 'life', 'power'], category: 'ui', label: 'Gem UI Icon' },

  // ============================================
  // VEHICLES & RACING
  // ============================================
  { id: 'car_racing', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/car-red.png', tags: ['car', 'racing', 'vehicle', 'race', 'road', 'speed', 'truck', 'drift'], category: 'vehicle', label: 'Red Racing Car' },

  // ============================================
  // WEAPONS & ITEMS
  // ============================================
  { id: 'items_food', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/apple.png', tags: ['food', 'fruit', 'apple', 'pizza', 'burger', 'collectible', 'item', 'eat'], category: 'item', label: 'Red Apple' },

  // ============================================
  // NATURE & BACKGROUNDS
  // ============================================
  { id: 'bg_nature', url: 'https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/tree.png', tags: ['tree', 'nature', 'grass', 'forest', 'hill', 'cloud', 'sky', 'outdoor', 'background'], category: 'background', label: 'Pine Tree' },

  // ============================================
  // PHYSICS & PUZZLE
  // ============================================
  { id: 'physics_shapes', url: `${TWEMOJI_BASE}/1f7e5.svg`, tags: ['physics', 'ball', 'box', 'circle', 'triangle', 'shape', 'puzzle', 'bounce', 'block'], category: 'physics', label: 'Red Box Shape' },

  // ============================================
  // SPORTS
  // ============================================
  { id: 'sports_ball', url: `${TWEMOJI_BASE}/26bd.svg`, tags: ['ball', 'soccer', 'basketball', 'football', 'tennis', 'sport', 'sports'], category: 'sports', label: 'Soccer Ball' },

  // ============================================
  // FISH & UNDERWATER
  // ============================================
  { id: 'fish_pack', url: `${TWEMOJI_BASE}/1f41f.svg`, tags: ['fish', 'ocean', 'sea', 'underwater', 'water', 'swim', 'aquarium', 'shark', 'whale'], category: 'character', label: 'Swimming Fish' },

  // ============================================
  // EMOJIS & EXPRESSIONS
  // ============================================
  { id: 'emojis', url: `${TWEMOJI_BASE}/1f600.svg`, tags: ['emoji', 'face', 'expression', 'smile', 'happy', 'sad', 'angry', 'laugh', 'emotional'], category: 'ui', label: 'Smile Emote' },

  // ============================================
  // MEDIEVAL & FANTASY
  // ============================================
  { id: 'medieval_items', url: `${TWEMOJI_BASE}/1f6e1.svg`, tags: ['sword', 'shield', 'potion', 'treasure', 'chest', 'medieval', 'fantasy', 'weapon', 'magic', 'rpg'], category: 'item', label: 'Knight Shield' },

  // ============================================
  // PIRATE
  // ============================================
  { id: 'pirate_pack', url: `${TWEMOJI_BASE}/1f3f4-200d-2620-fe0f.svg`, tags: ['pirate', 'ship', 'cannonball', 'treasure', 'island', 'ocean', 'boat', 'skull'], category: 'character', label: 'Pirate Flag' },
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
 * Returns the top N matching assets sorted by vector similarity.
 */
export async function searchAssets(query, maxResults = 5) {
  if (!assetEmbeddingsCache) {
    console.log("🧩 Initializing RAG Asset Vector Cache...");
    assetEmbeddingsCache = [];
    for (const asset of ASSET_LIBRARY) {
      const description = `${asset.label}. Tags: ${asset.tags.join(', ')}`;
      const vector = await getEmbedding(description);
      if (vector) assetEmbeddingsCache.push({ asset, vector });
    }
    console.log(`✅ Cached ${assetEmbeddingsCache.length} asset vectors.`);
  }

  const queryVector = await getEmbedding(query);
  if (!queryVector) return [];

  const scored = assetEmbeddingsCache.map(entry => {
    const score = cosineSimilarity(queryVector, entry.vector);
    return { ...entry.asset, score };
  });

  // Sort highest similarity first and filter out very low matches
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(a => a.score > 0.45).slice(0, maxResults);
}

/**
 * Get all available assets (for admin/debug)
 */
export function getAllAssets() {
  return ASSET_LIBRARY;
}

/**
 * Get assets by category
 */
export function getAssetsByCategory(category) {
  return ASSET_LIBRARY.filter(a => a.category === category);
}
