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

// All assets are tagged for semantic search by the Planner Agent
const ASSET_LIBRARY = [
  // ============================================
  // CHARACTERS & PLAYERS
  // ============================================
  { id: 'char_alien_green', url: 'https://kenney.nl/media/pages/assets/platformer-art-deluxe/52f4518804-1677578214/sample.png', tags: ['alien', 'player', 'green', 'platformer', 'character', 'hero'], category: 'character', label: 'Green Alien Hero' },
  { id: 'char_knight', url: 'https://kenney.nl/media/pages/assets/tiny-dungeon/7e4a760685-1677578240/sample.png', tags: ['knight', 'warrior', 'medieval', 'dungeon', 'hero', 'armor', 'sword', 'character'], category: 'character', label: 'Pixel Knight' },
  { id: 'char_zombie', url: 'https://kenney.nl/media/pages/assets/zombie-2d-characters/a8c3a26780-1705312786/sample.png', tags: ['zombie', 'enemy', 'undead', 'horror', 'monster', 'villain', 'scary'], category: 'character', label: 'Zombie Character' },
  { id: 'char_robot', url: 'https://kenney.nl/media/pages/assets/robot-pack/44eb0ab1c3-1677578222/sample.png', tags: ['robot', 'mech', 'sci-fi', 'machine', 'future', 'android', 'character'], category: 'character', label: 'Robot Character' },
  { id: 'char_animal', url: 'https://kenney.nl/media/pages/assets/animal-pack-redux/621f174b0a-1677578183/sample.png', tags: ['animal', 'pet', 'dog', 'cat', 'farm', 'cute', 'character'], category: 'character', label: 'Animal Characters' },

  // ============================================
  // SPACE & SCI-FI
  // ============================================
  { id: 'space_ship', url: 'https://kenney.nl/media/pages/assets/space-shooter-redux/cc87fcfb31-1677578231/sample.png', tags: ['spaceship', 'ship', 'space', 'shooter', 'rocket', 'ufo', 'vehicle', 'sci-fi'], category: 'vehicle', label: 'Space Shooter Ships' },
  { id: 'space_planets', url: 'https://kenney.nl/media/pages/assets/planets/9a7dd04b70-1677578219/sample.png', tags: ['planet', 'space', 'earth', 'moon', 'sun', 'star', 'galaxy', 'background', 'cosmos'], category: 'background', label: 'Planets' },

  // ============================================
  // PLATFORMER TILES & ENVIRONMENTS
  // ============================================
  { id: 'tiles_platformer', url: 'https://kenney.nl/media/pages/assets/simplified-platformer-pack/fd8b0e9ad4-1677578227/sample.png', tags: ['platform', 'tile', 'ground', 'block', 'brick', 'level', 'environment', 'jump'], category: 'environment', label: 'Platformer Tiles' },
  { id: 'tiles_dungeon', url: 'https://kenney.nl/media/pages/assets/tiny-dungeon/7e4a760685-1677578240/sample.png', tags: ['dungeon', 'cave', 'dark', 'underground', 'medieval', 'tile', 'wall', 'floor'], category: 'environment', label: 'Dungeon Tiles' },
  { id: 'tiles_town', url: 'https://kenney.nl/media/pages/assets/tiny-town/88e73e8fb8-1677578241/sample.png', tags: ['town', 'city', 'house', 'building', 'road', 'village', 'urban', 'tile'], category: 'environment', label: 'Town Tiles' },

  // ============================================
  // UI ELEMENTS
  // ============================================
  { id: 'ui_buttons', url: 'https://kenney.nl/media/pages/assets/ui-pack/3ec58a2a6e-1677578243/sample.png', tags: ['button', 'ui', 'menu', 'interface', 'panel', 'hud', 'start', 'play'], category: 'ui', label: 'UI Buttons & Panels' },
  { id: 'ui_icons', url: 'https://kenney.nl/media/pages/assets/game-icons/e61c7ec41d-1677578198/sample.png', tags: ['icon', 'heart', 'star', 'coin', 'gem', 'trophy', 'score', 'life', 'power'], category: 'ui', label: 'Game Icons' },

  // ============================================
  // VEHICLES & RACING
  // ============================================
  { id: 'car_racing', url: 'https://kenney.nl/media/pages/assets/racing-pack/d7e590bb73-1677578221/sample.png', tags: ['car', 'racing', 'vehicle', 'race', 'road', 'speed', 'truck', 'drift'], category: 'vehicle', label: 'Racing Cars' },

  // ============================================
  // WEAPONS & ITEMS
  // ============================================
  { id: 'items_food', url: 'https://kenney.nl/media/pages/assets/food-kit/d53b26c1e6-1696691075/sample.png', tags: ['food', 'fruit', 'apple', 'pizza', 'burger', 'collectible', 'item', 'eat'], category: 'item', label: 'Food Items' },

  // ============================================
  // NATURE & BACKGROUNDS
  // ============================================
  { id: 'bg_nature', url: 'https://kenney.nl/media/pages/assets/background-elements-redux/b62bae2dc7-1677578189/sample.png', tags: ['tree', 'nature', 'grass', 'forest', 'hill', 'cloud', 'sky', 'outdoor', 'background'], category: 'background', label: 'Nature Elements' },

  // ============================================
  // PHYSICS & PUZZLE
  // ============================================
  { id: 'physics_shapes', url: 'https://kenney.nl/media/pages/assets/physics-pack/1fce01ef8a-1677578218/sample.png', tags: ['physics', 'ball', 'box', 'circle', 'triangle', 'shape', 'puzzle', 'bounce', 'block'], category: 'physics', label: 'Physics Shapes' },

  // ============================================
  // SPORTS
  // ============================================
  { id: 'sports_ball', url: 'https://kenney.nl/media/pages/assets/sports-pack/7f2e510ddc-1677578232/sample.png', tags: ['ball', 'soccer', 'basketball', 'football', 'tennis', 'sport', 'sports'], category: 'sports', label: 'Sports Balls' },

  // ============================================
  // FISH & UNDERWATER
  // ============================================
  { id: 'fish_pack', url: 'https://kenney.nl/media/pages/assets/fish-pack/6b40d68e8e-1677578196/sample.png', tags: ['fish', 'ocean', 'sea', 'underwater', 'water', 'swim', 'aquarium', 'shark', 'whale'], category: 'character', label: 'Fish & Sea Life' },

  // ============================================
  // EMOJIS & EXPRESSIONS
  // ============================================
  { id: 'emojis', url: 'https://kenney.nl/media/pages/assets/emotes-pack/cb14e20bd4-1677578195/sample.png', tags: ['emoji', 'face', 'expression', 'smile', 'happy', 'sad', 'angry', 'laugh', 'emotional'], category: 'ui', label: 'Emoji Pack' },

  // ============================================
  // MEDIEVAL & FANTASY
  // ============================================
  { id: 'medieval_items', url: 'https://kenney.nl/media/pages/assets/tiny-dungeon/7e4a760685-1677578240/sample.png', tags: ['sword', 'shield', 'potion', 'treasure', 'chest', 'medieval', 'fantasy', 'weapon', 'magic', 'rpg'], category: 'item', label: 'Fantasy Items' },

  // ============================================
  // PIRATE
  // ============================================
  { id: 'pirate_pack', url: 'https://kenney.nl/media/pages/assets/pirate-pack/81cd3e7dff-1677578219/sample.png', tags: ['pirate', 'ship', 'cannonball', 'treasure', 'island', 'ocean', 'boat', 'skull'], category: 'character', label: 'Pirate Pack' },
];

/**
 * Search the asset dictionary by tags.
 * Returns the top N matching assets sorted by relevance (number of tag matches).
 */
export function searchAssets(query, maxResults = 5) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (queryWords.length === 0) return [];

  const scored = ASSET_LIBRARY.map(asset => {
    let score = 0;
    for (const word of queryWords) {
      // Exact tag match = 3 points
      if (asset.tags.includes(word)) score += 3;
      // Partial tag match = 1 point
      else if (asset.tags.some(t => t.includes(word) || word.includes(t))) score += 1;
      // Label match = 2 points
      if (asset.label.toLowerCase().includes(word)) score += 2;
    }
    return { ...asset, score };
  }).filter(a => a.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
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
