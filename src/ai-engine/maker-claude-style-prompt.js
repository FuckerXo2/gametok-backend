// Claude-style Phaser game generation prompt
// This prompt instructs the AI to generate games exactly like Claude does:
// - No scaffolds, no templates, no contracts
// - Just clean Phaser 3 + JavaScript + CDN assets
// - Fixed dimensions, single-file output via Vite

import { getCatalog, getAssetsByTheme, getDiverseSample, selectGameAssets } from './load-catalog.js';

/**
 * Detect the intended camera orientation from the prompt so we only surface correctly-oriented art
 * (a top-down racer must not be handed side-view cars). Defaults to top_down for 2D mobile.
 */
function detectOrientation(prompt) {
  const p = prompt.toLowerCase();
  if (/\b(isometric|iso|axonometric)\b/.test(p)) return 'isometric';
  if (/\b(side-?scroll|platformer|side view|sidescroller|runner|jump)\b/.test(p)) return 'side';
  if (/\b(top-?down|topdown|overhead|birds?-?eye|racing|race|driving|tank)\b/.test(p)) return 'top_down';
  return 'top_down';
}

// Present role-grouped, orientation-filtered assets so the blind model can map them correctly.
const ROLE_LABEL = {
  vehicle: 'PLAYER / VEHICLES', character: 'PLAYER / CHARACTERS', ground: 'GROUND / TRACK TILES (tile these to build the world)',
  obstacle: 'OBSTACLES', pickup: 'PICKUPS / COLLECTIBLES', projectile: 'PROJECTILES',
  background: 'BACKGROUNDS', prop: 'PROPS / DECORATION', ui: 'UI', audio: 'AUDIO',
  served: 'SERVED DISHES (plated food to serve/deliver)',
};
const R2_BASE_URL = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
// The path the model must load is the R2 KEY (the part after /assets/), NOT the local folder path.
const assetKey = (a) => (a.url || '').replace(R2_BASE_URL, '') || a.localPath;
function formatGroupedAssets(grouped) {
  const roles = Object.keys(grouped);
  if (!roles.length) return '(No catalog assets matched — draw code fallbacks.)';
  let out = '';
  for (const role of roles) {
    out += `\n## ${ROLE_LABEL[role] || role.toUpperCase()}\n`;
    for (const a of grouped[role]) {
      const dim = a.width && a.height ? ` ${a.width}x${a.height}` : '';
      const tile = a.tileable ? ' [tileable]' : '';
      out += `- \`${assetKey(a)}\` — ${a.description}${dim}${tile}\n`;
    }
  }
  return out;
}

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
    'cooking': ['cooking', 'food', 'kitchen', 'chef', 'restaurant', 'diner', 'serve', 'burger'],
    'racing': ['racing', 'race', 'car', 'vehicle', 'track'],
    'puzzle': ['puzzle', 'match', 'block', 'tile'],
    'rpg': ['rpg', 'dungeon', 'quest', 'character', 'hero'],
    'visual-novel': ['visual novel', 'story', 'dialogue', 'character'],
    // outdoor/survival/farming/mining games need real terrain + trees/rocks (Isometric Nature etc.),
    // NOT abstract greybox blocks — map these words to the nature theme.
    'nature': ['survival', 'survive', 'wilderness', 'forest', 'jungle', 'woods', 'farm', 'farming',
               'mining', 'mine', 'craft', 'crafting', 'gather', 'harvest', 'island', 'camping', 'fishing', 'nature', 'outdoor'],
    'military': ['tank', 'army', 'war', 'battle', 'soldier', 'artillery'],
    'pirate': ['pirate', 'treasure', 'sea', 'ocean', 'sail'],
    'sports': ['sport', 'sports', 'soccer', 'football', 'golf', 'basketball', 'tennis']
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
    // Extract theme keywords + camera orientation from the user prompt.
    const themeKeywords = extractThemeKeywords(userPrompt);
    const orientation = detectOrientation(userPrompt);

    // Preferred path: unified catalog (Kenney 2D + re-tagged Phaser), grouped by role and filtered to
    // the right orientation. Falls back to the old flat themed list if the unified catalog is absent.
    const grouped = selectGameAssets({ themes: themeKeywords, orientation, perRole: 14 });
    const assetList = Object.keys(grouped).length
      ? formatGroupedAssets(grouped)
      : formatAssetsForPrompt(themeKeywords.length ? getAssetsByTheme(themeKeywords, 100) : getDiverseSample(100));
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

2. **FILL THE PHONE SCREEN — no black bars** - the game runs FULLSCREEN in a mobile feed. It MUST cover the whole screen edge-to-edge.
   - Design at a fixed portrait base: width: 390, height: 844.
   - Scale config: \`scale: { mode: Phaser.Scale.ENVELOP, autoCenter: Phaser.Scale.CENTER_BOTH, width: 390, height: 844 }\`.
   - **Use ENVELOP, NOT FIT.** FIT letterboxes with black bars; ENVELOP scales up to cover the entire screen. This is mandatory.
   - In index.html set \`html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}\` and the canvas/parent fill 100%.
   - Keep the player, HUD and key gameplay near the CENTER so ENVELOP's slight edge-crop never hides them.

3. **RENDER THE REAL SPRITES — this is the #1 rule** - The assets in "AVAILABLE ASSETS" are the whole point. LOAD them AND DISPLAY them.
   - Every core visible object MUST be a loaded catalog image, shown with \`this.add.image(...)\` / \`this.add.sprite(...)\` / \`this.physics.add.sprite(...)\`: the **background/track**, the **player**, every **collectible**, every **obstacle/enemy**.
   - You MUST call \`this.load.image(key, path)\` in preload() for each, then in create() draw it with that key. If you loaded it, you MUST show it.
   - Use ONLY assets from the catalog list above — they are guaranteed to exist (verified 200 on the CDN).
   - **BANNED as the primary look**: do NOT render the game as a grid of lines, a plain colored background, or bare rectangles/circles when a catalog sprite exists for that thing. A green wireframe grid is an automatic FAIL.
   - Primitives (\`Phaser.GameObjects.Graphics\`, rectangles, circles) are allowed ONLY for: HUD/UI chrome, particle dots, and as a fallback INSIDE a \`this.load.on('loaderror', ...)\` handler when a specific image fails — never as the default art.
   - Scroll the background by moving/tiling the loaded track image (\`this.add.tileSprite\` with the road texture), not by drawing lines.

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
   - **CRITICAL**: Register a \`this.load.on('loaderror', ...)\` handler; ONLY inside it may you swap a failed image for a colored-shape fallback
   - Test that game boots even if an asset fails — but the happy path MUST show the loaded sprites

# GAME REQUIREMENTS

- Complete, playable game with win/lose conditions
- **THE WORLD BACKGROUND IS BUILT FROM THE GROUND/TRACK TILES** — cover the play area by tiling the loaded ground/track sprite (e.g. \`this.add.tileSprite(...)\` scrolling toward the player). NEVER draw a grid of lines or a plain fill as the background. If there are GROUND/TRACK TILES in the asset list, using them for the background is MANDATORY.
- **Timers start > 0.** If there's a countdown, initialize it to a real value (e.g. 60) and only end the game when it actually reaches 0. The game MUST be playable for several seconds on load — never show GAME OVER immediately.
- Score system
- **DESIGN A UNIQUE, THEMED HUD — never ship the default look.** Do NOT reuse the generic "monospace text top-left + flat colored rectangle bar" layout that every game defaults to. The HUD is code-drawn (that's fine), but it MUST be visually designed to match THIS game's world, and look different from other games:
  - Choose a cohesive palette from the theme (neon/dark for space & cyber, warm pastels for cooking/diner, earthy greens/browns for survival, bold high-contrast arcade for racing/shooter).
  - Set deliberate typography — \`fontFamily\`, size, weight, color, and a \`stroke\`/shadow — NOT the Phaser default font.
  - Draw stat bars with intent: a background track + fill, rounded ends or segments, a border — not a bare rectangle. Add a small drawn icon (heart, coin, star, fuel) beside each stat.
  - Use rounded panels (\`graphics.fillRoundedRect\`), subtle drop shadows, and thoughtful corner placement. Vary the layout per game.
  - Buttons (restart, action) must be styled to match — rounded, colored, with a label and a pressed/hover state.
  - Goal: the HUD should read as hand-designed for this specific game, clearly distinct from a template.
- Game over screen with restart button (RESTART must fully reset timer/score and resume play)
- **TOUCH CONTROLS MUST ACTUALLY WORK — this is played on a PHONE with fingers, no keyboard exists.** A game that only responds to WASD/arrow keys is BROKEN and fails. This is the #1 gameplay rule.
  - The PRIMARY control MUST be pointer/touch and MUST fully drive the player. Register handlers in create():
    - **Move**: player follows the finger — \`this.input.on('pointermove', (p) => { player.x = p.x; player.y = p.y; })\` (or drag / lerp toward p.x,p.y / on-screen virtual joystick / tilt via deviceorientation).
    - **Act (shoot/jump/flap)**: \`this.input.on('pointerdown', () => { /* fire/jump */ })\` — a tap.
  - The game MUST be fully playable with ONLY dragging and tapping — never require a key press to start, move, or act.
  - Keyboard (WASD/arrows) is allowed ONLY as an optional secondary desktop fallback, never the sole input.
  - Use \`this.input.addPointer(2)\` if you need multi-touch (move + shoot at once).
- **ANIMATIONS**: Use spritesheet animations for characters (walk, idle, attack, death)
- Load all assets from the R2 CDN: https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/
- Fixed game dimensions (390x844 for mobile portrait)
- **POLISH**: Particle effects, screen shake, sound effects, smooth tweens
- **JUICE**: Add visual feedback for every action (hit flash, score popups, damage numbers)

# REMEMBER

- **TOUCH-FIRST**: fully playable with drag + tap alone (pointermove/pointerdown), NOT keyboard-only. WASD-only = broken.
- **FULLSCREEN**: Phaser.Scale.ENVELOP (fills the phone, no black bars), NOT FIT. body margin:0, overflow:hidden.
- **SHOW THE LOADED SPRITES** — background, player, coins, obstacles are catalog images, NOT drawn shapes. No grids, no bare rectangles for gameplay objects.
- Use JavaScript (.js) NOT TypeScript
- 390x844 portrait base design (with ENVELOP scaling to fill)
- All assets from CDN
- Pure Phaser 3 code
- Return valid JSON only`,

        user: `Create a complete Phaser 3 game based on this description:

${userPrompt}

Return ONLY valid JSON with the "files" array. No markdown code blocks, no explanation.`
    };
}
