// Claude-style Phaser game generation prompt
// This prompt instructs the AI to generate games exactly like Claude does:
// - No scaffolds, no templates, no contracts
// - Just clean Phaser 3 + JavaScript + CDN assets
// - Fixed dimensions, single-file output via Vite

import { getCatalog, getAssetsByTheme, getDiverseSample } from './load-catalog.js';

/**
 * Extract theme keywords from user prompt
 * @param {string} prompt - User's game description
 * @returns {string[]} Array of matched theme names
 */
function extractThemeKeywords(prompt) {
  const promptLower = prompt.toLowerCase();
  const themes = [];
  
  const keywords = {
    'zombie': ['zombie', 'undead', 'horror', 'skeleton'],
    'space': ['space', 'alien', 'rocket', 'galaxy', 'star', 'ufo'],
    'medieval': ['medieval', 'knight', 'castle', 'sword', 'dragon'],
    'shooter': ['shooter', 'shoot', 'gun', 'bullet', 'weapon'],
    'platformer': ['platform', 'jump', 'coin', 'gem', 'mario'],
    'cooking': ['cooking', 'food', 'kitchen', 'chef', 'restaurant'],
    'racing': ['racing', 'race', 'car', 'vehicle', 'track'],
    'puzzle': ['puzzle', 'match', 'block', 'tile'],
    'rpg': ['rpg', 'dungeon', 'quest', 'character', 'hero'],
    'visual-novel': ['visual novel', 'story', 'dialogue', 'character']
  };
  
  for (const [theme, words] of Object.entries(keywords)) {
    if (words.some(word => promptLower.includes(word))) {
      themes.push(theme);
    }
  }
  
  return themes;
}

/**
 * Format assets for inclusion in AI prompt
 * @param {Object[]} assets - Array of asset objects from catalog
 * @returns {string} Formatted markdown string of assets
 */
function formatAssetsForPrompt(assets) {
  if (!assets || assets.length === 0) {
    return '(No assets available - use fallback graphics)';
  }
  
  // Group by type
  const byType = {
    sprite: [],
    spritesheet: [],
    audio: []
  };
  
  assets.forEach(asset => {
    if (byType[asset.type]) {
      byType[asset.type].push(asset);
    }
  });
  
  let output = '';
  
  // Format sprites
  if (byType.sprite.length > 0) {
    output += '## Sprites\n\n';
    byType.sprite.forEach(asset => {
      output += `- **${asset.path}** - ${asset.description} [${asset.themes.join(', ')}]\n`;
    });
    output += '\n';
  }
  
  // Format spritesheets
  if (byType.spritesheet.length > 0) {
    output += '## Spritesheets (Animated)\n\n';
    byType.spritesheet.forEach(asset => {
      const jsonPath = asset.path.replace(/\.(png|jpg|jpeg)$/i, '.json');
      output += `- **${asset.path}** + **${jsonPath}** - ${asset.description} [${asset.themes.join(', ')}]\n`;
    });
    output += '\n';
  }
  
  // Format audio (limit to 10 entries)
  if (byType.audio.length > 0) {
    output += '## Audio\n\n';
    byType.audio.slice(0, 10).forEach(asset => {
      output += `- **${asset.path}** - ${asset.description}\n`;
    });
    output += '\n';
  }
  
  return output;
}

export function buildClaudeStylePrompt(userPrompt) {
    // Extract theme keywords from user prompt
    const themeKeywords = extractThemeKeywords(userPrompt);
    
    // Get relevant assets based on themes
    const relevantAssets = themeKeywords.length > 0
      ? getAssetsByTheme(themeKeywords, 100)
      : getDiverseSample(100);
    
    // Format assets for prompt
    const assetList = formatAssetsForPrompt(relevantAssets);
    return {
        system: `You are a Phaser 3 game code generator. Your job is to write a complete, working Phaser 3 game from scratch using JavaScript.

# AVAILABLE ASSETS

Use these assets from the catalog (already hosted and ready to use):

${assetList}

**Asset URL Format**: 
- Use the R2 CDN BASE_URL: \`'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/'\`
- Construct full URLs: \`\${BASE_URL}{path}\`
- Example: If BASE_URL is 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/' and path is 'audio/DOG.mp3', use 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/audio/DOG.mp3'

**CRITICAL**: Only use assets from the list above. They are guaranteed to exist and are properly themed for your game.

# CRITICAL RULES

1. **Use JavaScript, NOT TypeScript** - Simpler, fewer type errors
   - Files: .js not .ts
   - No type annotations
   - No interfaces or type imports

2. **Fixed Dimensions** - NEVER use window.innerWidth or window.innerHeight
   - Mobile games: width: 390, height: 844
   - Desktop games: width: 800, height: 600
   - Always use Phaser.Scale.FIT mode with autoCenter

3. **All Assets from Catalog** - Use ONLY assets listed in the "AVAILABLE ASSETS" section above
   - Base URL is dynamically set based on environment (Railway or localhost)
   - **CRITICAL**: Only use assets from the catalog list - they are guaranteed to exist
   - Assets are pre-filtered by theme to match your game concept
   - For missing functionality: Draw colored rectangles/circles using Phaser.GameObjects.Graphics
   - Better to have working placeholder graphics than broken image loads

4. **Project Structure** - Always create these exact files:
   - index.html (minimal, just loads the module)
   - package.json (phaser 3.80.1, vite, vite-plugin-singlefile)
   - vite.config.js (IMPORTANT: use CommonJS require syntax, NOT ES6 import)
   - src/main.js (Phaser config)
   - src/scenes/GameScene.js (main game scene)

**CRITICAL vite.config.js format:**
\`\`\`javascript
const { viteSingleFile } = require('vite-plugin-singlefile');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
\`\`\`

5. **No Custom Scaffolds** - Write pure Phaser 3 code
   - NO window.__GAMETOK_TEMPLATE_PROBE__
   - NO custom wrapper APIs
   - Just standard Phaser 3 API

6. **Output Format** - Return ONLY a JSON object with this structure:
   {
     "files": [
       { "path": "index.html", "content": "..." },
       { "path": "package.json", "content": "..." },
       { "path": "vite.config.js", "content": "..." },
       { "path": "src/main.js", "content": "..." },
       { "path": "src/scenes/GameScene.js", "content": "..." }
     ]
   }

7. **Clean JavaScript** - Your code MUST run without errors:
   - No TypeScript syntax
   - Proper null checks before accessing physics bodies
   - Check this.input.keyboard exists before using it
   - **CRITICAL**: Wrap asset loading in try-catch or use load events
   - Handle asset load failures gracefully - use colored shapes as fallback
   - Test that game boots even if assets fail to load

# GAME REQUIREMENTS

- Complete, playable game with win/lose conditions
- Score system  
- Game over screen with restart button
- **MOBILE-FIRST**: Primary controls MUST be touch/pointer based
- Keyboard controls as secondary fallback only
- Touch controls: virtual joystick, tap to shoot, or pointer-follow movement
- **ANIMATIONS**: Use spritesheet animations for characters (walk, idle, attack, death)
- Load all assets from the R2 CDN: https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/
- Fixed game dimensions (390x844 for mobile portrait)
- **POLISH**: Particle effects, screen shake, sound effects, smooth tweens
- **JUICE**: Add visual feedback for every action (hit flash, score popups, damage numbers)

# REMEMBER

- Use JavaScript (.js) NOT TypeScript
- Fixed dimensions ONLY (no window.innerWidth)
- All assets from CDN
- Pure Phaser 3 code
- Return valid JSON only`,

        user: `Create a complete Phaser 3 game based on this description:

${userPrompt}

Return ONLY valid JSON with the "files" array. No markdown code blocks, no explanation.`
    };
}
