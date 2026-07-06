import path from 'path';

/**
 * Theme keywords for categorizing assets by game theme
 */
const THEME_KEYWORDS = {
  'space': ['space', 'alien', 'rocket', 'star', 'ufo', 'galaxy', 'astronaut', 'planet', 'spaceship'],
  'medieval': ['medieval', 'knight', 'castle', 'sword', 'dragon', 'dungeon', 'warrior', 'armor'],
  'zombie': ['zombie', 'undead', 'horror', 'skeleton', 'skull', 'grave', 'apocalypse'],
  'platformer': ['platform', 'jump', 'coin', 'gem', 'mario', 'runner', 'collectible'],
  'shooter': ['shoot', 'gun', 'bullet', 'enemy', 'weapon', 'fire', 'blast', 'target'],
  'cooking': ['food', 'kitchen', 'cooking', 'chef', 'restaurant', 'ingredients', 'recipe', 'meal'],
  'visual-novel': ['character', 'portrait', 'dialogue', 'ui', 'textbox', 'background', 'scene', 'story'],
  'puzzle': ['block', 'tile', 'match', 'gem', 'puzzle', 'grid', 'swap'],
  'rpg': ['rpg', 'character', 'hero', 'monster', 'dungeon', 'quest', 'spell', 'magic'],
  'racing': ['car', 'vehicle', 'road', 'track', 'race', 'speed', 'wheel', 'driver'],
  'generic': [] // Fallback theme
};

/**
 * Extract themes from filename and path using keyword matching
 * @param {string} pathLower - Lowercase file path
 * @param {string} name - Lowercase filename without extension
 * @returns {string[]} Array of theme tags
 */
function extractThemes(pathLower, name) {
  const themes = [];
  
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    // Skip 'generic' as it's a fallback
    if (theme === 'generic') continue;
    
    for (const keyword of keywords) {
      if (pathLower.includes(keyword) || name.includes(keyword)) {
        themes.push(theme);
        break; // One match per theme is enough
      }
    }
  }
  
  // Default to 'generic' if no themes matched
  if (themes.length === 0) {
    themes.push('generic');
  }
  
  return themes;
}

/**
 * Categorize an asset by type and theme based on its file path
 * @param {string} filePath - Relative file path from assets directory
 * @returns {{type: string, themes: string[]}} Asset type and theme tags
 */
export function categorizeAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const pathLower = filePath.toLowerCase();
  const name = path.basename(filePath, ext).toLowerCase();
  
  let type = 'unknown';
  
  // Type classification based on extension and path patterns
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    // Check if it's a spritesheet or atlas
    if (pathLower.includes('spritesheet') || pathLower.includes('atlas')) {
      type = 'spritesheet';
    } else {
      type = 'sprite';
    }
  } else if (['.mp3', '.wav', '.ogg'].includes(ext)) {
    type = 'audio';
  } else if (ext === '.json') {
    // JSON files can be spritesheet_data or tilemap
    // This will need content inspection to differentiate
    // For now, default to spritesheet_data
    type = 'spritesheet_data';
  }
  
  // Theme extraction
  const themes = extractThemes(pathLower, name);
  
  return { type, themes };
}

export { THEME_KEYWORDS, extractThemes };
