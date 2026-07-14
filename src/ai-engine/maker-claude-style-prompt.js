// Claude-style Phaser game generation prompt
// This prompt instructs the AI to generate games exactly like Claude does:
// - No scaffolds, no templates, no contracts
// - Just clean Phaser 3 + JavaScript + CDN assets
// - Fixed dimensions, single-file output via Vite

import { getCatalog, getAssetsByTheme, getDiverseSample, selectGameAssets } from './load-catalog.js';
import { findRelevantPacks, recallCandidatePacks } from './embedding-search.js';
import { selectPacksWithModel, listRequiredEntities } from './asset-selection.js';
import { retrieveAssetsForEntities } from './asset-retrieval.js';
import { designGamePlan, formatPlanForBuilder } from './game-design.js';

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

// Native pixel sizes across the catalog vary wildly within the same role (16px pixel-art next to
// 512px hi-res packs). Left to the model this produces mismatched scale (a 720px character next to a
// 12px obstacle). So we compute a fixed ON-SCREEN target per role (calibrated to a ~390px-wide
// portrait phone; real device widths are 390–430px so these hold) and hand the model the exact
// display size to use, instead of asking it to reason about scaling itself.
const ROLE_TARGET_PX = {
  vehicle: 56, character: 48, obstacle: 40, pickup: 28, projectile: 16,
  prop: 40, served: 40, ground: 64, background: null, ui: null, audio: null,
};
// Fit the asset's native aspect ratio inside a `target`x`target` box (contain, not stretch).
function computeDisplaySize(a, target) {
  if (!target || !a.width || !a.height) return null;
  const scale = target / Math.max(a.width, a.height);
  return { w: Math.round(a.width * scale), h: Math.round(a.height * scale) };
}
// Emit a Phaser-ready summary per asset. v2 items (identified by presence of atlas_url) get the
// full atlas + animation contract the builder needs — sheet URL, atlas JSON URL, load key, exact
// animation names and frame ranges, native cell size. Legacy items keep the old shape.
function formatV2AssetLine(a, role) {
  const disp = computeDisplaySize(a, ROLE_TARGET_PX[role]);
  const targetDisplay = disp ? ` → setDisplaySize(${disp.w}, ${disp.h})` : '';
  const key = `v2_${a.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  const tags = `${a.species}·${a.perspective}·${a.playable_role}`;

  // STATIC assets (motion==='static') have no animation frames — load as a plain image and move it
  // with code (position/rotation/scale). Do NOT tell the model to build animations for these.
  if (a.motion === 'static') {
    return (
`- **${a.description}** [${tags}·STATIC]
    key: '${key}'  native ${a.canvas_size?.w}x${a.canvas_size?.h}${targetDisplay}
    image: ${a.url}
    → STATIC sprite (no animation). preload: this.load.image('${key}', '${a.url}'). Draw with this.add.image/sprite and move it with code (x/y velocity, setRotation, setScale). Do NOT call anims.create/play on this.`
    );
  }

  // ANIMATED assets — load as a TexturePacker atlas and build each named animation.
  const animLines = Object.entries(a.atlas_animations || {}).map(([name, def]) => {
    const range = def.frames.length <= 6 ? `[${def.frames.join(',')}]` : `[${def.frames[0]}..${def.frames[def.frames.length-1]}]`;
    return `        '${name}': frames ${range}, fps ${def.fps}, loop ${def.loop}`;
  }).join('\n');
  return (
`- **${a.description}** [${tags}·ANIMATED]
    key: '${key}'  native ${a.canvas_size?.w}x${a.canvas_size?.h}${targetDisplay}
    sheet: ${a.url}
    atlas: ${a.atlas_url}
    → ANIMATED. preload: this.load.atlas('${key}', sheet, atlas). Build the animation(s) below with anims.create + generateFrameNumbers, then sprite.play(name).
    animations:
${animLines}`
  );
}

function formatGroupedAssets(grouped) {
  const roles = Object.keys(grouped);
  if (!roles.length) return '(No catalog assets matched — draw code fallbacks.)';
  let out = '';
  for (const role of roles) {
    out += `\n## ${ROLE_LABEL[role] || role.toUpperCase()}\n`;
    for (const a of grouped[role]) {
      if (a.atlas_url) { out += formatV2AssetLine(a, role) + '\n\n'; continue; }
      // Legacy path (kept for the old-catalog fallback so nothing regresses if v2 retrieval misses)
      const dim = a.width && a.height ? ` ${a.width}x${a.height}` : '';
      const tile = a.tileable ? ' [tileable]' : '';
      const disp = computeDisplaySize(a, ROLE_TARGET_PX[role]);
      const render = disp ? ` → setDisplaySize(${disp.w}, ${disp.h})` : '';
      out += `- \`${assetKey(a)}\` — ${a.description}${dim}${tile}${render}\n`;
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

// Fold flat entity-retrieval matches into the same {role: [...]} shape selectGameAssets() returns,
// so formatGroupedAssets() (role headers, per-role setDisplaySize sizing) works unchanged either way.
function groupByRole(assets, perRole) {
    const grouped = {};
    for (const a of assets) {
        if (!a.role) continue;
        (grouped[a.role] ||= []).push(a);
    }
    for (const role of Object.keys(grouped)) grouped[role] = grouped[role].slice(0, perRole);
    return grouped;
}

export async function buildClaudeStylePrompt(userPrompt) {
    // Pipeline (each layer degrades gracefully if the next one up is unavailable):
    //   -1. DESIGN — Flash produces a real structured plan (core loop, entities, orientation, layout,
    //       controls, win/lose, HUD) BEFORE we touch assets. Was: no design step at all — the builder
    //       improvised silently in throwaway reasoning tokens. Now: the plan drives retrieval (search
    //       for the entities the DESIGN needs, not a shallow guess off the raw prompt) AND is injected
    //       into the builder's user message so the model executes a design instead of wandering into one.
    //    0. Entity-level RAG: search per-asset embeddings for each entity the plan named. Fixes
    //       "the hoop got crowded out" — you ask for a hoop, you get a hoop, regardless of bucket.
    //    1. Pack selection: embedding recalls candidates, a fast model picks the packs + orientation.
    //       Also feeds pack-affinity bias into tier 0 for visual coherence.
    //    2. Embedding rank only, 3. regex keywords: successive fallbacks if the layer above is dead.
    let relevantPacks = [];
    let orientation = null;
    let entities = [];
    let plan = null;

    // Recall runs first (no LLM, fast) so the design step can see what art is actually available.
    // Otherwise the plan speculates in the abstract and can pick an orientation the catalog can't
    // fulfil (reproduced: basketball plan said "side" while all our Sports Pack art is top-down —
    // hoop got starved out by the orientation filter downstream).
    const candidates = await recallCandidatePacks(userPrompt, 25);
    const plannedResult = await designGamePlan(userPrompt, { availablePacks: candidates });
    if (plannedResult) {
        plan = plannedResult;
        entities = plan.entities;
        orientation = plan.orientation;
    } else {
        // Design failed — degrade to shallow entity listing (previous behavior).
        entities = await listRequiredEntities(userPrompt);
    }

    if (candidates.length) {
        const picked = await selectPacksWithModel({ concept: userPrompt, candidates });
        if (picked && !picked.drawInstead && picked.packs.length) {
            relevantPacks = picked.packs;
            // Pack selection's orientation wins over the plan's when both are set. Why: the plan's
            // orientation is a speculative design call ("basketball is side-view"), but the pack
            // selection is grounded in what our catalog ACTUALLY has (Sports Pack art is top-down).
            // A mismatch starves entity retrieval — reproduced: plan said side, pack said top_down,
            // hoop got filtered out because its orientation was top_down. Prefer the grounded signal.
            if (picked.orientation && plan?.orientation && picked.orientation !== plan.orientation) {
                console.log(`⚠️  Plan orientation (${plan.orientation}) disagrees with pack selection (${picked.orientation}) — using pack orientation to stay grounded in available assets.`);
            }
            if (picked.orientation) orientation = picked.orientation;
        }
    }
    if (!relevantPacks.length) {
        relevantPacks = await findRelevantPacks(userPrompt, 8); // tier 2
    }
    if (!orientation) orientation = detectOrientation(userPrompt);
    const themeKeywords = relevantPacks.length ? [] : extractThemeKeywords(userPrompt); // tier 3

    // Tier 0: entity retrieval, biased toward the pack(s) tier 1 identified (visual coherence —
    // a basketball player from Sports Pack over an equally-plausible generic CDN humanoid — gated so
    // the bias can't force a genuinely wrong item just because it shares a pack, see asset-retrieval.js).
    let grouped = {};
    if (entities.length) {
        const results = await retrieveAssetsForEntities(entities, { topKPerEntity: 4, orientation, preferPacks: relevantPacks });
        const flat = [];
        const seen = new Set();
        for (const r of results) for (const m of r.matches) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            flat.push(m);
        }
        if (flat.length) grouped = groupByRole(flat, 10);
    }

    // Fallback to pack/role-bucket selection if entity retrieval found nothing usable.
    if (!Object.keys(grouped).length) {
        grouped = selectGameAssets({ packs: relevantPacks, themes: themeKeywords, orientation, perRole: 14 });
    }
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

**HOW TO LOAD v2 SPRITE ATLASES (any asset with sheet + atlas URLs above):**
Each v2 asset is a Phaser TexturePacker JSON-Hash atlas. In preload() call \`this.load.atlas(key, sheetUrl, atlasUrl)\` — DO NOT use \`this.load.image\` on the sheet URL; the atlas file carries the per-frame rects. Then in create() build the animation using the exact animation name and frame range listed for that asset:
\`\`\`js
// preload()
this.load.atlas('v2_...', sheetUrl, atlasUrl);

// create() — one anims.create per animation the asset provides
this.anims.create({
  key: 'walk',
  frames: this.anims.generateFrameNumbers('v2_...', { start: 0, end: N-1 }),
  frameRate: 8,
  repeat: -1,
});

// Then create the sprite and play the animation
const player = this.physics.add.sprite(W/2, H*0.8, 'v2_...');
player.setDisplaySize(48, 64);         // use the → setDisplaySize hint shown per asset
player.body.setSize(48, 64);            // physics body follows setDisplaySize manually
player.play('walk');
\`\`\`
Notes: the animation name (\`'walk'\`, \`'damage'\`, \`'rotate'\`, etc.) is whatever the asset lists — use it verbatim so the animation matches its semantics. Frame counts and fps come from the animation entry per asset.

# CRITICAL RULES

1. **Use JavaScript, NOT TypeScript** - Simpler, fewer type errors
   - Files: .js not .ts
   - No type annotations
   - No interfaces or type imports

2. **THE CANVAS IS THE REAL SCREEN — fill it, never design to a fixed 390×844 rectangle.** The game runs fullscreen in a mobile feed AND inside a shorter preview box. Designing to a fixed 390×844 and letting Phaser scale/crop it is BANNED: when the real container is a different shape (e.g. the preview is ~390×720), the fixed design gets cropped and your score/buttons at the top and bottom edges are sliced off. Make the canvas equal the actual container and lay everything out from the LIVE size.
   - Scale config: \`scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }\`. The canvas now equals the real container — nothing is cropped and there are no black bars. Do NOT use ENVELOP or FIT, and do NOT pass a fixed width/height.
   - **NEVER hardcode 390 or 844.** Read the live size wherever you position things: \`const W = this.scale.width, H = this.scale.height;\`. Place everything as a fraction of W/H — screen center is \`W/2, H/2\`; a bottom button sits at \`H - H*0.10\`, not \`844 - 84\`.
   - Put ALL positioning inside one \`layout(W, H)\` method, call it once at the end of create(), and re-run it on resize so it adapts to preview vs full screen: \`this.scale.on('resize', (s) => this.layout(s.width, s.height));\`. Any background/tileSprite must be sized to W×H and resized here too.
   - **SAFE AREA — MANDATORY. This is what stops your HUD getting cut off.** The extreme top and bottom of the screen sit under the status bar/notch and home indicator, and the preview box is shorter still. Every HUD element, score, timer, and button MUST have its center inside \`y ∈ [H*0.10, H*0.90]\` and \`x ∈ [W*0.05, W*0.95]\`. Full-bleed background art may reach the edges; TEXT and CONTROLS may NOT touch the extreme top/bottom edges.
   - In index.html set \`html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}\` and the canvas/parent fill 100%.

3. **SPRITES FOR CHARACTERS + KEY PROPS · CODE-DRAWN LAYERS FOR ENVIRONMENT — this is the #1 visual rule.** Split what you render into two buckets. Using the wrong bucket for a thing is an automatic FAIL.

   **Sprite bucket (MUST use catalog images):** anything that needs a recognizable identity at a glance — the **player character**, **NPCs / enemies**, **vehicles**, and **key gameplay props** (basketball hoop, treasure chest, tank, car, weapon, specific collectible). Faces, silhouettes, and iconic shapes cannot be faked by code-drawn primitives. For each of these, call \`this.load.image(key, path)\` in preload() using EXACTLY the paths in AVAILABLE ASSETS, then \`this.add.image/sprite(...)\` in create(). If you loaded it, you MUST show it.

   **Code-drawn bucket (build with \`this.add.graphics()\` — a well-crafted code scene beats a tiled 64×64 sprite):** the environment — sky, ground, terrain, walls, backdrops, decoration. Build in LAYERS with intent:
   - **Sky**: a vertical gradient (dawn/dusk/night/deep-space/theme-matched) — NEVER a flat single fill. In Phaser: draw a full-screen \`graphics.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1).fillRect(0,0,W,H*0.55)\`.
   - **Distant layers**: silhouette hills / mountains / city / trees drawn as filled paths — \`g.beginPath(); g.moveTo(0,H); for(x…) g.lineTo(x, baseY + Math.sin(x*freq)*amp + Math.sin(x*freq*2.3)*amp*0.4); g.lineTo(W,H); g.closePath(); g.fillPath();\` — two or three layers in progressively lighter shades for atmospheric depth.
   - **Ground**: a filled gradient base + a randomized loop of small \`fillEllipse\` calls for dirt/pebble texture + short \`strokeLineShape\` curves for grass tufts along the terrain edge. Seed the randomness so it's stable across frames.
   - **Decoration**: rocks (irregular polygon via \`beginPath\`+\`lineTo\`+\`fillPath\`), trees (trunk rect + 3–5 overlapping filled circles for canopy), flowers (stem line + small colored dot). Scatter 10–30 of them.
   - **Environment sprites in AVAILABLE ASSETS are OPTIONAL** — a \`tileSprite\` of a real texture is fine if it genuinely fits the theme, but do NOT reach for it as a substitute for actually designing the scene. A layered code scene almost always looks richer.

   **BANNED as the environment (automatic FAIL):** a single flat colored fill, a bright uniform green plane, a wireframe grid, or any "programmer art" default. If your sky/ground/backdrop looks like it took under 10 lines of code, redo it with gradients, silhouette layers, and texture.

   Primitives (\`Phaser.GameObjects.Graphics\`, rectangles, circles) are additionally allowed for HUD/UI chrome, particle dots, and as a fallback INSIDE \`this.load.on('loaderror', ...)\` when a required sprite fails.

3.1. **create() MUST FOLLOW THIS EXACT PHASE ORDER — no exceptions.** The single biggest source of shipped-broken games is state being read before it exists (e.g. building the HUD that reads \`this.timeLeft\` before you assigned \`this.timeLeft = 60\`, so \`.toString()\` crashes on undefined). Structure \`create()\` as six named helper methods called in this order, and put NOTHING between them:

\`\`\`js
create() {
  this.initState();      // 1. Assign EVERY this.* variable your game reads
  this.buildWorld();     // 2. Background tile/tileSprite, physics world bounds, camera
  this.spawnEntities();  // 3. Player, enemies, pickups, obstacles (created + sized)
  this.buildHUD();       // 4. HUD text/bars — may READ state assigned in phase 1
  this.wireInput();      // 5. pointerdown, pointermove, drag, keyboard fallbacks
  this.startTimers();    // 6. time.addEvent, tween loops — the game loop begins here
}
\`\`\`

Rules per phase:
- **initState()** — EVERY numeric/boolean/array state your HUD, timers, or handlers will read MUST be assigned here. Score, timeLeft, health, lives, isGameOver, suspicion, level, combo, etc. If \`buildHUD()\` writes \`this.timeLeft.toString()\`, then \`initState()\` MUST have already done \`this.timeLeft = 60\`. Zero exceptions.
- **buildWorld()** — draw the tiled ground/background first so everything else layers on top. NO reads of gameplay state here.
- **spawnEntities()** — create sprites/groups; call \`setDisplaySize(W, H)\` + matching \`body.setSize(W, H)\` right after each physics sprite (see rule 3.5).
- **buildHUD()** — freely reads state from phase 1 (safe by construction).
- **wireInput()** — only assign handlers, don't fire them.
- **startTimers()** — \`this.time.addEvent(...)\` and any tween.timeline loops. The game clock starts ticking here, not before.

You may add more phases (e.g. \`spawnGuards()\`) but they MUST fit between the six above without reordering them.

3.5. **SIZE EVERY SPRITE — never render at native pixel size.** The catalog mixes packs at wildly different native resolutions (a character sprite can be 16px or 720px). Rendering native size WILL produce a giant sprite next to a tiny one in the same game.
   - Every asset line above ends with \`→ setDisplaySize(W, H)\` when it's a gameplay sprite. You MUST call that exact \`sprite.setDisplaySize(W, H)\` (or \`image.setDisplaySize(W, H)\`) right after creating it. Do not invent your own size or use the sprite's native width/height.
   - **Physics bodies do NOT auto-follow setDisplaySize** — for every \`this.physics.add.sprite(...)\`/\`this.physics.add.image(...)\`, immediately call \`sprite.body.setSize(W, H)\` (or \`body.setCircle(W/2)\` for round objects) using the SAME W/H you passed to \`setDisplaySize\`, so the hitbox matches what's on screen.
   - Ground/track tiles use \`this.add.tileSprite(x, y, screenW, screenH, key)\` sized to the screen/world area, not to the tile's native pixels — \`tileSprite\` handles the repeat internally.
   - Assets with no \`→ setDisplaySize\` hint (background, UI, audio) don't need this — size backgrounds to the canvas instead.

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
- **THE ENVIRONMENT MUST LOOK DESIGNED** — either a code-drawn layered scene (sky gradient + silhouette hills + textured ground + grass/rocks — see rule 3) OR a tiled ground sprite via \`this.add.tileSprite(...)\`. Whichever route you pick, the world must feel intentional and match the theme. BANNED as the environment: a single flat colored fill, a wireframe grid, or bright uniform green. Prefer code-drawn for stylized/themed scenes (fantasy, space, sunset, night); prefer tiling a real sprite when the catalog has a texture that genuinely fits (e.g. a road for a racer).
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
- Responsive portrait: canvas fills the real container via Scale.RESIZE; lay out from live this.scale.width/height (do not assume 390×844)
- **POLISH**: Particle effects, screen shake, sound effects, smooth tweens
- **JUICE**: Add visual feedback for every action (hit flash, score popups, damage numbers)

# REMEMBER

- **TOUCH-FIRST**: fully playable with drag + tap alone (pointermove/pointerdown), NOT keyboard-only. WASD-only = broken.
- **FULLSCREEN**: Phaser.Scale.RESIZE (canvas = the real container, no crop, no black bars), NOT ENVELOP/FIT. body margin:0, overflow:hidden.
- **LIVE SIZE, SAFE AREA**: read \`this.scale.width/height\`, never hardcode 390/844; keep all HUD + buttons inside y ∈ [H*0.10, H*0.90] so nothing gets cut off in the shorter preview box.
- **CHARACTERS + KEY PROPS = SPRITES · ENVIRONMENT = CODE-DRAWN LAYERS** — load and display catalog sprites for the player, enemies, vehicles, hoops, chests, weapons. Draw the sky/ground/hills/decoration with \`graphics\` — layered gradients + silhouettes + textured detail. Never a flat fill or wireframe grid.
- **SIZE THE SPRITES** — for every catalog image you display, call \`setDisplaySize(W, H)\` using the exact numbers given per asset, and \`body.setSize(W, H)\` on physics sprites. Never render at native pixel size.
- Use JavaScript (.js) NOT TypeScript
- All assets from CDN
- Pure Phaser 3 code
- Return valid JSON only`,

        user: `Create a complete Phaser 3 game based on this description:

${userPrompt}
${plan ? '\n' + formatPlanForBuilder(plan) + '\n' : ''}
Return ONLY valid JSON with the "files" array. No markdown code blocks, no explanation.`
    };
}
