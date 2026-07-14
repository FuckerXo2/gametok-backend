// Claude-style Phaser game generation prompt — v2 catalog pipeline.
// Flow: design plan (grounded in the v2 catalog summary) → entity-level RAG for the plan's SPRITE
// entities only → dominant-pack coherence re-rank → builder prompt with per-asset atlas contracts.
// Environment/props/UI are code-drawn by design; there are no environment sprites anymore.

import { listRequiredEntities } from './asset-selection.js';
import { retrieveAssetsForEntities, getCatalogSummary } from './asset-retrieval.js';
import { designGamePlan, formatPlanForBuilder } from './game-design.js';

/**
 * Fallback orientation from the raw prompt, used only when the design step fails. Defaults to
 * 'side' — the v2 catalog is overwhelmingly side-view (144 side vs ~10 top_down), so side is the
 * orientation we can actually cast.
 */
function detectOrientation(prompt) {
  const p = prompt.toLowerCase();
  if (/\b(isometric|iso|axonometric)\b/.test(p)) return 'isometric';
  if (/\b(top-?down|topdown|overhead|birds?-?eye)\b/.test(p)) return 'top_down';
  return 'side';
}

// Role headers for the AVAILABLE ASSETS list. v2 retrieval only produces character (incl.
// creatures) and vehicle roles — everything else in a game is code-drawn.
const ROLE_LABEL = {
  character: 'CHARACTERS / CREATURES (catalog sprites)',
  vehicle: 'VEHICLES (catalog sprites)',
};

// Native pixel sizes across the catalog vary wildly within the same role (16px pixel-art next to
// 512px hi-res packs). Left to the model this produces mismatched scale (a 720px character next to a
// 12px obstacle). So we compute a fixed ON-SCREEN target per role (calibrated to a ~390px-wide
// portrait phone; real device widths are 390–430px so these hold) and hand the model the exact
// display size to use, instead of asking it to reason about scaling itself.
const ROLE_TARGET_PX = { vehicle: 56, character: 48 };
// Fit a native w×h into a `target`x`target` box (contain, not stretch).
function fitBox(w, h, target) {
  if (!target || !w || !h) return null;
  const scale = target / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// Emit a Phaser-ready summary for one CHARACTER (may carry multiple animations, each a separate
// physical sheet — see asset-retrieval.js header comment). One display-size box is computed from
// the primary (first-listed) animation and applied to every animation of this character so it
// doesn't visually resize when switching pose.
function formatV2AssetLine(a, role) {
  const key = `v2_${a.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  const tags = `${a.species}·${a.perspective}·${a.playable_role}`;

  // STATIC: single image, no animation frames — load as a plain image and move it with code.
  if (a.motion === 'static') {
    const disp = fitBox(a.canvas_size?.w, a.canvas_size?.h, ROLE_TARGET_PX[role]);
    const targetDisplay = disp ? ` → setDisplaySize(${disp.w}, ${disp.h})` : '';
    return (
`- **${a.description}** [${tags}·STATIC]
    key: '${key}'  native ${a.canvas_size?.w}x${a.canvas_size?.h}${targetDisplay}
    image: ${a.image_url}
    → STATIC sprite (no animation). preload: this.load.image('${key}', '${a.image_url}'). Draw with this.add.image/sprite and move it with code (x/y velocity, setRotation, setScale). Do NOT call anims.create/play on this.`
    );
  }

  // ANIMATED: one or more named poses, each its OWN spritesheet PNG on R2 (never packed together).
  // Each pose gets its own texture key `${key}_${animName}` + its own load.spritesheet call (native
  // frame size differs per pose) + its own anims.create — then sprite.play('walk') / .play('attack')
  // switches texture automatically, Phaser handles that.
  const animNames = Object.keys(a.animations);
  const primary = a.animations[animNames[0]];
  const disp = fitBox(primary.canvas_size.w, primary.canvas_size.h, ROLE_TARGET_PX[role]);
  const targetDisplay = disp ? ` → setDisplaySize(${disp.w}, ${disp.h}) [use this SAME box for every pose below]` : '';
  const poseLines = animNames.map(name => {
    const def = a.animations[name];
    const poseKey = `${key}_${name}`;
    return `    - '${name}': preload this.load.spritesheet('${poseKey}', '${def.sheet_url}', { frameWidth: ${def.canvas_size.w}, frameHeight: ${def.canvas_size.h} }); anims.create({ key: '${name}', frames: this.anims.generateFrameNumbers('${poseKey}', { start: 0, end: ${def.frame_count - 1} }), frameRate: ${def.fps}, repeat: ${def.loop ? -1 : 0} }); sprite.play('${name}')`;
  }).join('\n');
  return (
`- **${a.description}** [${tags}·ANIMATED, ${animNames.length} pose(s): ${animNames.join(', ')}]
    key base: '${key}'${targetDisplay}
    → ANIMATED. Each pose is a separate spritesheet — set up ALL of them in preload()/create(), then call sprite.play(name) to switch:
${poseLines}`
  );
}

function formatGroupedAssets(grouped) {
  const roles = Object.keys(grouped);
  if (!roles.length) return '(No catalog assets matched — draw code fallbacks.)';
  let out = '';
  for (const role of roles) {
    out += `\n## ${ROLE_LABEL[role] || role.toUpperCase()}\n`;
    for (const a of grouped[role]) {
      out += formatV2AssetLine(a, role) + '\n\n';
    }
  }
  return out;
}

// Fold flat entity-retrieval matches into {role: [...]} shape for formatGroupedAssets()
// (role headers + per-role setDisplaySize sizing).
function groupByRole(assets, perRole) {
    const grouped = {};
    for (const a of assets) {
        if (!a.role) continue;
        (grouped[a.role] ||= []).push(a);
    }
    for (const role of Object.keys(grouped)) grouped[role] = grouped[role].slice(0, perRole);
    return grouped;
}

// Visual-coherence re-rank: find the dominant source_pack among all retrieved matches, then within
// each entity's matches boost same-pack items (+0.18, gated at a 0.50 plausibility floor — same
// calibration as asset-retrieval.js) and keep the top `keep`. One game's cast should come from one
// art style where possible: a toon zombie next to a toon adventurer, not next to a rendered zombie.
function coherenceRerank(results, keep = 2) {
    const packCounts = {};
    for (const r of results) for (const m of r.matches) {
        if (m.source_pack) packCounts[m.source_pack] = (packCounts[m.source_pack] || 0) + 1;
    }
    const dominant = Object.entries(packCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    for (const r of results) {
        r.matches = r.matches
            .map(m => ({ ...m, _score: m.score + (dominant && m.source_pack === dominant && m.score >= 0.50 ? 0.18 : 0) }))
            .sort((a, b) => b._score - a._score)
            .slice(0, keep);
    }
    return { results, dominant };
}

export async function buildClaudeStylePrompt(userPrompt) {
    // v2 pipeline:
    //   1. DESIGN — Flash produces a structured plan grounded in the REAL v2 catalog summary
    //      (species/counts/perspectives/animated-vs-static). Every entity is tagged sprite|code.
    //   2. RETRIEVE — entity-level RAG over v2 embeddings, but ONLY for the plan's sprite entities
    //      (characters/creatures/vehicles). Code-drawn entities never touch the catalog.
    //   3. COHERENCE — re-rank retrieved matches toward the dominant source pack so one game's cast
    //      shares an art style.
    //   4. BUILD PROMPT — per-asset atlas contracts (animated: load.atlas + anims; static:
    //      load.image + move with code) + the plan as explicit marching orders.
    // If the design step fails, degrade to a shallow entity list off the raw prompt (all treated as
    // sprite candidates). If retrieval finds nothing, the game is fully code-drawn — that's valid.
    let orientation = null;
    let plan = null;
    let spriteEntityNames = [];

    const catalogSummary = getCatalogSummary();
    const plannedResult = await designGamePlan(userPrompt, { catalogSummary });
    if (plannedResult) {
        plan = plannedResult;
        orientation = plan.orientation;
        spriteEntityNames = plan.entities.filter(e => e.render === 'sprite').map(e => e.name);
    } else {
        spriteEntityNames = await listRequiredEntities(userPrompt);
        orientation = detectOrientation(userPrompt);
    }

    let grouped = {};
    if (spriteEntityNames.length) {
        const raw = await retrieveAssetsForEntities(spriteEntityNames, {
            topKPerEntity: 4,
            orientation,
            softOrientation: true, // side-view player on a top-down concept beats NO player
        });
        const { results, dominant } = coherenceRerank(raw, 2);
        if (dominant) console.log(`🎨 Coherence anchor pack: ${dominant}`);

        // Similarity floor: the catalog has no entry for some concepts (a literal snake, a piano
        // key). Without a floor the weakest available match still gets returned and the builder
        // is told "you MUST show it" — forcing a wrong sprite (a fantasy monster as a snake head)
        // into a game that has nothing to do with it. Calibrated against real data: genuine matches
        // score 0.6-0.8 (basketball player 0.68, knight 0.67-0.84, zombie 0.69); the observed
        // garbage-tier case (snake head -> random monster) scored 0.32. 0.42 sits well below every
        // real match seen and well above the one confirmed bad one.
        const MIN_SPRITE_SCORE = 0.42;
        const downgraded = [];
        for (const r of results) {
            const survivors = r.matches.filter(m => m._score >= MIN_SPRITE_SCORE);
            if (!survivors.length && r.matches.length) downgraded.push(r.entity);
            r.matches = survivors;
        }
        if (downgraded.length) {
            console.log(`⬇️  No good sprite match (score < ${MIN_SPRITE_SCORE}) for: [${downgraded.join(', ')}] — reclassified to code-drawn`);
            if (plan) for (const e of plan.entities) if (downgraded.includes(e.name)) e.render = 'code';
        }

        const flat = [];
        const seen = new Set();
        for (const r of results) for (const m of r.matches) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            flat.push(m);
        }
        if (flat.length) grouped = groupByRole(flat, 10);
    }

    const assetList = Object.keys(grouped).length
      ? formatGroupedAssets(grouped)
      : '(No catalog sprites matched this concept — every entity in this game is code-drawn. Draw them WELL with layered graphics.)';
    return {
        system: `You are a Phaser 3 game code generator. Your job is to write a complete, working Phaser 3 game from scratch using JavaScript.

# AVAILABLE ASSETS

Use these assets from the catalog (already hosted and ready to use):

${assetList}

**CRITICAL**: Use ONLY the assets listed above, via the exact full URLs shown per asset. They are guaranteed live on the CDN. Do NOT invent other asset URLs — nothing else exists.

**HOW TO LOAD — every asset above is marked ANIMATED or STATIC:**

ANIMATED characters can have MULTIPLE poses (walk, idle, attack...) — each pose is its OWN spritesheet PNG (never packed together), so it needs its OWN texture key and its OWN \`load.spritesheet\` call. The asset's pose list above gives you the exact call for each. Set up EVERY pose the character has, then switch between them with \`sprite.play(name)\`:
\`\`\`js
// preload() — one load.spritesheet call PER POSE, exact keys/urls/dims from the asset's pose list
this.load.spritesheet('v2_knight_walk', walkUrl, { frameWidth: 79, frameHeight: 63 });
this.load.spritesheet('v2_knight_attack', attackUrl, { frameWidth: 90, frameHeight: 80 });

// create() — one anims.create PER POSE
this.anims.create({ key: 'walk', frames: this.anims.generateFrameNumbers('v2_knight_walk', { start: 0, end: 7 }), frameRate: 8, repeat: -1 });
this.anims.create({ key: 'attack', frames: this.anims.generateFrameNumbers('v2_knight_attack', { start: 0, end: 13 }), frameRate: 12, repeat: 0 });

const player = this.physics.add.sprite(W/2, H*0.8, 'v2_knight_walk'); // start on any one pose's texture
player.setDisplaySize(48, 64);          // use the SAME box for every pose of this character (shown once per asset)
player.body.setSize(48, 64);
player.play('walk');                    // later: player.play('attack') — Phaser swaps the texture automatically
\`\`\`

STATIC (single image URL, no poses): \`this.load.image(key, imageUrl)\` in preload(), then \`this.add.image/sprite\` and move it entirely with code — velocity, \`setRotation\`, tweens (bob/squash/tilt). NEVER call \`anims.create\`/\`play\` on a static asset.

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

3. **SPRITES FOR CHARACTERS / CREATURES / VEHICLES · CODE-DRAWN EVERYTHING ELSE — this is the #1 visual rule.** Split what you render into two buckets. Using the wrong bucket for a thing is an automatic FAIL.

   **Sprite bucket (MUST use catalog assets):** living things and vehicles ONLY — the **player character**, **NPCs / enemies / creatures**, **vehicles** (cars, ships, planes, boats, UFOs). Faces and silhouettes cannot be faked by code-drawn primitives. Every asset in AVAILABLE ASSETS is marked **ANIMATED** (load with \`this.load.atlas\`, build its animations, \`sprite.play(...)\`) or **STATIC** (load with \`this.load.image\`, move/rotate/scale it with code — never call anims on it). Follow the per-asset instructions exactly. If you loaded it, you MUST show it.

   **Code-drawn bucket (build with \`this.add.graphics()\`):** EVERYTHING ELSE — environment (sky, ground, terrain, walls, backdrops), gameplay objects (hoops, goals, balls, coins, bullets, platforms, obstacles, chests), decoration, HUD. There are NO prop or environment sprites in the catalog — do not invent asset URLs for them. A well-crafted code drawing beats a tiled texture. Build environments in LAYERS with intent:
   - **Sky**: a vertical gradient (dawn/dusk/night/deep-space/theme-matched) — NEVER a flat single fill. In Phaser: draw a full-screen \`graphics.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1).fillRect(0,0,W,H*0.55)\`.
   - **Distant layers**: silhouette hills / mountains / city / trees drawn as filled paths — \`g.beginPath(); g.moveTo(0,H); for(x…) g.lineTo(x, baseY + Math.sin(x*freq)*amp + Math.sin(x*freq*2.3)*amp*0.4); g.lineTo(W,H); g.closePath(); g.fillPath();\` — two or three layers in progressively lighter shades for atmospheric depth.
   - **Ground**: a filled gradient base + a randomized loop of small \`fillEllipse\` calls for dirt/pebble texture + short \`strokeLineShape\` curves for grass tufts along the terrain edge. Seed the randomness so it's stable across frames.
   - **Decoration**: rocks (irregular polygon via \`beginPath\`+\`lineTo\`+\`fillPath\`), trees (trunk rect + 3–5 overlapping filled circles for canopy), flowers (stem line + small colored dot). Scatter 10–30 of them.
   - **Gameplay objects get the same care**: a basketball hoop is a backboard rect + rim arc + net lines; a coin is a filled circle + inner ring + shine dot; a goal is posts + crossbar + net cross-hatch. Iconic, readable, multi-element — never a single bare rectangle.

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
- **THE ENVIRONMENT MUST LOOK DESIGNED** — a code-drawn layered scene (sky gradient + silhouette layers + textured ground + scattered decoration — see rule 3), themed to THIS game (fantasy dusk, deep space, neon night, sunny court). BANNED: a single flat colored fill, a wireframe grid, bright uniform green.
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
- **ANIMATIONS**: For every ANIMATED catalog sprite, build and PLAY its animation(s) — a character standing frozen while sliding around is a fail. For STATIC catalog sprites, add life with code: bob with a sine tween, tilt into turns with setRotation, squash-and-stretch on impact.
- Load all assets from the R2 CDN: https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/
- Responsive portrait: canvas fills the real container via Scale.RESIZE; lay out from live this.scale.width/height (do not assume 390×844)
- **POLISH**: Particle effects, screen shake, sound effects, smooth tweens
- **JUICE**: Add visual feedback for every action (hit flash, score popups, damage numbers)

# REMEMBER

- **TOUCH-FIRST**: fully playable with drag + tap alone (pointermove/pointerdown), NOT keyboard-only. WASD-only = broken.
- **FULLSCREEN**: Phaser.Scale.RESIZE (canvas = the real container, no crop, no black bars), NOT ENVELOP/FIT. body margin:0, overflow:hidden.
- **LIVE SIZE, SAFE AREA**: read \`this.scale.width/height\`, never hardcode 390/844; keep all HUD + buttons inside y ∈ [H*0.10, H*0.90] so nothing gets cut off in the shorter preview box.
- **CHARACTERS/CREATURES/VEHICLES = CATALOG SPRITES · EVERYTHING ELSE = CODE-DRAWN** — load and display catalog sprites for the player, enemies, creatures, vehicles (ANIMATED → play the animation; STATIC → move it with code). Draw environment AND gameplay objects (hoops, balls, coins, platforms) with \`graphics\` — layered, multi-element, never a flat fill or bare rectangle.
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
