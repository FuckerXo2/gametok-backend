/**
 * DreamStream Prompt Registry
 *
 * Main DreamStream:
 * Phase 1: QUANTIZE  — Llama 3.3 extracts a structured spec
 * Phase 2: BUILD     — Claude Opus writes the full game in one shot
 * Phase 3: VERIFY    — Puppeteer sandbox validates the result
 *
 * Labs:
 * Solo Qwen experiment path
 *
 * Experimental collaboration prompts are kept below for iteration and fallback work.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────
// VISUAL STYLE REFERENCE
// ─────────────────────────────────────────────────────────

import { buildCapabilityPromptBlock } from './capability-graph.js';
import { formatUnityPhase1PromptBlock, formatUnityPromptBlock } from './gametok-unity.js';

const VISUAL_STYLES = [
  'NEON_CYBERPUNK', 'PIXEL_RETRO', 'FLAT_VECTOR', 'DARK_HORROR',
  'PASTEL_CUTE', 'NATURE_ORGANIC', 'SPACE_COSMIC', 'OCEAN_AQUATIC',
  'DESERT_WARM', 'WINTER_COLD'
];

const ATMOSPHERES = [
  'Bright & Cheerful', 'Dark & Menacing', 'Neon & Electric',
  'Calm & Relaxing', 'Tense & Stressful', 'Mysterious & Eerie'
];

const PACING = ['Fast / Arcade', 'Medium / Balanced', 'Slow / Strategic', 'Turn-Based'];
const CAMERA_PERSPECTIVES = ['FIRST_PERSON', 'THIRD_PERSON', 'ISOMETRIC', 'TOP_DOWN', 'SIDE_VIEW'];
const ENVIRONMENT_TYPES = ['DUNGEON', 'ARENA', 'CORRIDOR', 'OPEN_FIELD', 'CITY', 'SPACE', 'INTERIOR'];
const ENGINE_PREFERENCES = ['THREE_JS', 'PHASER_WEBGL', 'DOM_UI', 'P5_JS'];

function formatPromptList(items, fallback = 'none provided') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join('\n');
}

function normalizeList(items, fallback = []) {
  return Array.isArray(items) && items.length > 0 ? items : fallback;
}

function requestsFirstPerson3D(userPrompt = '') {
  const text = String(userPrompt || '').toLowerCase();
  const perspectiveIntent = ['first-person', 'first person', 'fps', '3d', 'three.js', 'threejs', 'voxel', 'block world']
    .some((keyword) => text.includes(keyword));
  const worldIntent = ['dungeon', 'maze', 'corridor', 'crawler', 'shooter', 'wasteland', 'explore', 'arena']
    .some((keyword) => text.includes(keyword));
  return perspectiveIntent && worldIntent;
}

function requestsStrictPixelArt(specSheet = {}, userPrompt = '') {
  const text = [
    String(userPrompt || ''),
    String(specSheet.visualStyle || ''),
    String(specSheet.summary || ''),
    String(specSheet.genre || ''),
    String(specSheet.promptEcho || ''),
  ].join(' ').toLowerCase();

  return specSheet.pixelArtStrict === true || [
    'pixel',
    'pixel art',
    'pixel-art',
    '8-bit',
    '16-bit',
    'retro sprite',
    'tileset',
  ].some((keyword) => text.includes(keyword));
}

function formatAssetLines(sectionName, assets = []) {
  if (!Array.isArray(assets) || assets.length === 0) return '';
  const lines = assets
    .map((asset) => `- ${asset.role}: ${asset.label} [${asset.kind}] (${asset.packName}) -> ${asset.url}`)
    .join('\n');
  return `${sectionName}:\n${lines}`;
}

function buildAssetKitBlock(assetBundle = null) {
  if (!assetBundle) {
    return `APPROVED ASSET KIT:
- No curated self-hosted asset kit was attached for this run.
- Build everything procedurally and do NOT fetch any third-party images, textures, or audio URLs.`;
  }

  const sections = [
    formatAssetLines('Visual Assets', assetBundle.visuals),
    formatAssetLines('Control / UI Assets', assetBundle.controls),
    formatAssetLines('Audio Assets', assetBundle.audio),
    formatAssetLines('3D Models', assetBundle.models),
  ].filter(Boolean);

  const notes = (assetBundle.notes || []).map((note) => `- ${note}`).join('\n');

  return `APPROVED SELF-HOSTED ASSET KIT (${assetBundle.lane}):
- You MAY use these same-origin GameTok assets directly.
- You MUST NOT fetch any other third-party asset URLs beyond allowed engine CDNs.
- If you use these assets, preload them, fail gracefully, and keep the game playable even if one asset fails to load.
- It is okay to mix these assets with procedural particles, lighting, and effects.
${sections.join('\n\n')}

Asset Notes:
${notes || '- No extra notes.'}`;
}

function normalizeMediaAttachmentType(type = '') {
  const normalized = String(type || '').trim().toLowerCase();
  switch (normalized) {
    case 'photo':
    case 'gif':
    case 'sticker':
      return 'image';
    case 'music':
      return 'bgm';
    case 'audio':
      return 'sfx';
    default:
      return normalized || 'image';
  }
}

function describeMediaAttachmentUsage(type) {
  switch (normalizeMediaAttachmentType(type)) {
    case 'image':
      return 'Use as a sprite, background, prop, splash art, HUD art, or decorative layer if it fits the game.';
    case 'video':
      return 'Use as a looping, muted background layer, intro panel, or atmospheric screen element. Keep the game playable if it fails to load.';
    case 'bgm':
      return 'Use as optional looping background music with safe default volume and graceful fallback.';
    case 'sfx':
      return 'Use as a triggered sound effect for actions, impacts, pickups, or events.';
    case 'meme':
      return 'Use as a humorous sticker, popup, reward card, decal, or themed collectible if it improves the fantasy.';
    default:
      return 'Use it thoughtfully if it improves clarity, personality, or game feel. Never make bootability depend on it.';
  }
}

function describeMediaAttachmentRole(role, type) {
  switch (String(role || '').trim().toLowerCase()) {
    case 'hero':
      return 'Treat this as a primary focal asset. Build visible interaction or composition around it.';
    case 'background':
      return 'Treat this as a backdrop, atmosphere layer, or looping background panel.';
    case 'overlay':
      return 'Treat this as a meme/sticker/overlay layer used for humor, reactions, decals, or popups.';
    case 'panel':
      return 'Treat this as an in-world screen, card, modal, billboard, or framed content panel.';
    case 'prop':
      return 'Treat this as a tangible prop, collectible, tool, ingredient, or scene object.';
    case 'bgm':
      return 'Treat this as the main looping background music choice.';
    case 'sfx':
      return 'Treat this as a triggered sound effect or moment-based audio cue.';
    case 'reference':
      return 'Treat this as a visual/style reference or optional supporting media, not necessarily a required on-screen element.';
    default:
      return type === 'video'
        ? 'Use this video intentionally rather than as random decoration.'
        : 'Use this asset intentionally rather than as random decoration.';
  }
}

function buildUserMediaBlock(mediaAttachments = []) {
  if (!Array.isArray(mediaAttachments) || mediaAttachments.length === 0) {
    return `USER-PROVIDED MEDIA:
- No user-provided media attachments were included for this run.`;
  }

  const lines = mediaAttachments.map((asset, index) => {
    const type = normalizeMediaAttachmentType(asset?.type);
    const role = asset?.role || 'hero';
    const title = asset?.title || asset?.label || `Attachment ${index + 1}`;
    const url = asset?.url || 'missing-url';
    const instruction = asset?.instruction || 'No extra instruction provided.';
    const usage = describeMediaAttachmentUsage(type);
    const roleGuidance = describeMediaAttachmentRole(role, type);
    return [
      `- Attachment ${index + 1}: ${title}`,
      `  - type: ${type}`,
      `  - role: ${role}`,
      `  - url: ${url}`,
      `  - user intent: ${instruction}`,
      `  - usage guidance: ${usage}`,
      `  - role guidance: ${roleGuidance}`,
    ].join('\n');
  }).join('\n');

  return `USER-PROVIDED MEDIA:
- These attachments are part of the user's request and should be honored when practical.
- Prefer them over generic decorative substitutes when they clearly fit the game.
- If the user assigns a role like hero/background/overlay/panel, preserve that role unless it would completely break readability or bootability.
- If one attachment fails to load, keep the game playable and visible anyway.
- Do not silently ignore them unless they truly conflict with bootability or readability.
${lines}`;
}

function buildAudioKitBlock(audioBundle = null) {
  if (!audioBundle || (!audioBundle.audio?.length && !audioBundle.music?.length)) {
    return `AUDIO ASSETS:
- No curated audio assets were attached for this run.
- If DREAM_AUDIO_MANIFEST is present, use DreamAudio to play real local audio files from that manifest.
- Do NOT create oscillator/beep sounds as a substitute for real audio files.
- Keep the game playable without audio.`;
  }

  const audioLines = (audioBundle.audio || []).map((asset) => `- ${asset.label}: ${asset.url}`).join('\n');
  const musicLines = (audioBundle.music || []).map((asset) => `- ${asset.label}: ${asset.url}`).join('\n');

  return `AUDIO ASSETS FROM LIBRARY:
- These are curated same-origin audio assets you MAY use.
- Preload them gracefully and keep the game playable if they fail to load.

Sound Effects:
${audioLines || '- No sound effects provided'}

Background Music:
${musicLines || '- No background music provided'}`;
}

function buildAIAssetsBlock(generatedAssets = null) {
  if (!generatedAssets || !generatedAssets.assets) {
    return `AI-GENERATED ASSETS:
- No AI-generated assets were created for this run.
- You MUST generate all visual assets procedurally using canvas drawing, Phaser graphics, or Three.js geometry.
- Do NOT use external image URLs or fetch third-party assets.`;
  }

  const assets = generatedAssets.assets;
  const manifestAssets = Array.isArray(generatedAssets.manifest?.assets)
    ? generatedAssets.manifest.assets
    : Object.entries(assets).map(([id, dataUri]) => ({
        id,
        key: id,
        role: id === 'player' ? 'player' : id.replace(/[0-9_-]+$/g, ''),
        category: id === 'player' ? 'player' : id.replace(/[0-9_-]+$/g, ''),
        width: 128,
        height: 128,
        transparent: !id.startsWith('background'),
        url: dataUri,
      }));
  
  // Group assets by type
  const primaryManifestAssets = manifestAssets.filter((asset) => asset.kind !== 'animation_frame');
  const frameManifestAssets = manifestAssets.filter((asset) => asset.kind === 'animation_frame');
  const byRole = (role, prefix = role) => primaryManifestAssets.filter((asset) => asset.role === role || asset.category === role || asset.id.startsWith(prefix));
  const uniqueAssets = (assetArray) => Array.from(new Map(assetArray.map((asset) => [asset.id, asset])).values());
  const player = byRole('player');
  const enemies = byRole('enemy');
  const items = byRole('item');
  const backgrounds = uniqueAssets(byRole('environment', 'background').concat(byRole('background')));
  const ui = byRole('ui');
  const props = byRole('prop');
  const assetPackSummary = Array.isArray(generatedAssets.assetPack)
    ? generatedAssets.assetPack.map((asset) => {
        const summary = { ...asset };
        if (summary.url) summary.url = `[embedded:${Math.round(String(summary.url).length / 1024)}KB]`;
        return summary;
      })
    : [];
  const animationSummary = Array.isArray(generatedAssets.animations) ? generatedAssets.animations : [];
  const audioSummary = generatedAssets.audio || { sfx: [], music: [] };
  const tilesetSummary = Array.isArray(generatedAssets.tilesets) ? generatedAssets.tilesets : [];
  const artDirection = generatedAssets.assetPlan?.artDirection || generatedAssets.manifest?.artDirection || null;
  const productionContract = generatedAssets.productionContract || generatedAssets.manifest?.productionContract || null;
  
  const formatAssetList = (assetArray) => {
    return assetArray.map((asset) => {
      const dataUri = assets[asset.id] || asset.url || '';
      const sizeKB = Math.round(dataUri.length / 1024);
      const dimensions = asset.width && asset.height ? `${asset.width}x${asset.height}` : 'image';
      const transparent = asset.transparent === false ? 'opaque/background' : 'transparent sprite';
      return `  - ${asset.id}: use window.DREAM_ASSETS["${asset.id}"] (${dimensions}, ${transparent}, ${sizeKB}KB)`;
    }).join('\n');
  };

  return `AI-GENERATED CUSTOM VISUAL ASSETS:
- These assets were generated specifically for THIS game using NVIDIA FLUX AI.
- They are injected into the final HTML before your game runs.
- You MUST use these assets as your PRIMARY visual assets for the game.
- Load them by key from window.DREAM_ASSETS or window.DREAM_ASSET_PACK.
- These are CUSTOM assets made for this exact game concept — use them prominently!

${player.length > 0 ? `PLAYER CHARACTER:
${formatAssetList(player)}
` : ''}
${enemies.length > 0 ? `ENEMIES/OPPONENTS:
${formatAssetList(enemies)}
` : ''}
${items.length > 0 ? `ITEMS/COLLECTIBLES:
${formatAssetList(items)}
` : ''}
${backgrounds.length > 0 ? `BACKGROUNDS/ENVIRONMENTS:
${formatAssetList(backgrounds)}
` : ''}
${ui.length > 0 ? `UI ELEMENTS:
${formatAssetList(ui)}
` : ''}
${props.length > 0 ? `PROPS/OBSTACLES:
${formatAssetList(props)}
` : ''}
${artDirection ? `ART DIRECTION:
\`\`\`json
${JSON.stringify(artDirection, null, 2)}
\`\`\`
` : ''}

STRUCTURED ASSET PACK:
\`\`\`json
${JSON.stringify({
  artDirection,
  productionContract,
  assets: assetPackSummary,
  animations: animationSummary,
  animationFrames: frameManifestAssets.map((asset) => ({
    key: asset.key,
    sourceKey: asset.sourceKey,
    animationKey: asset.animationKey,
    frameName: asset.frameName,
  })),
  audio: audioSummary,
  tilesets: tilesetSummary,
}, null, 2)}
\`\`\`

${productionContract ? `PRODUCTION CONTRACT:
\`\`\`json
${JSON.stringify(productionContract, null, 2)}
\`\`\`
` : ''}

ASSET USAGE CONTRACT:
- The structured asset pack is the source of truth for art roles. Treat each asset's role/category/gameplayRole as binding.
- The PRODUCTION CONTRACT is the source of truth for screen layout, runtime roles, first-frame acceptance, gameplay acceptance, and what must be code-rendered.
- The ART DIRECTION block is the source of truth for visual composition: palette, sprite angle, background layering, terrain style, UI style, and mobile framing.
- Use DreamAssets.preloadPhaser(this) in preload() to load every image in the manifest.
- Use DreamAssets.firstByRole("player"), "enemy", "item", "prop", and "background"/"environment" to connect assets to gameplay entities.
- Use DreamAssets.addSprite(scene, roleOrKey, x, y, { maxW, maxH }) and DreamAssets.addBackgroundCover(scene, roleOrKey, width, height) when helpful.
- DreamAssets.getImage(key) returns a data URL string, not an HTMLImageElement. For canvas drawImage, use DreamAssets.loadImageElement(key) or create a new Image and set img.src to the data URL. Never set .onload on the data URL string.
- Use DreamAssets.safeRect(width, height) to place HUD, touch controls, menus, score, lives, wave labels, and inventory inside the GameTok-safe rectangle.
- Every major gameplay entity on screen must be backed by either an asset key from DREAM_ASSET_PACK or a clearly intentional particle/shape effect. Do not use circles/rectangles as the player or main enemies when matching assets exist.
- If an asset is marked transparent, render it as a sprite/entity. If transparent is false, render it as a background, floor, arena, or full-scene layer.
- Render HUD, labels, meters, buttons, menus, trajectory text, and editor controls with code using the UI style from artDirection.uiStyle. Do not use AI images as HUD.
- Terrain and platforms must follow artDirection.terrainStyle but remain code-defined geometry when they affect collision, aiming, landing, movement, or win/loss.
- In artillery, lander, racing, platforming, puzzle, or tactical games, the background is never the physical world. Draw the physical terrain/track/grid/pad with code and style it to match the background.
- If an animation manifest references a sourceKey, apply that tween or an equivalent procedural animation to that exact sprite.
- If an animation manifest has type "frame_sequence", call DreamAssets.createAnimations(this) in create() and play that animation key on the matching sprite. Prefer real frame_sequence assets over tweens.
- If audio exists in DREAM_AUDIO_MANIFEST, wire at least: ui_tap, impact, collect/reward, primary_action, movement_burst if movement exists, success/failure when those states exist.

CRITICAL INSTRUCTIONS - NO LAZY VISUAL FALLBACKS:
1. Use the selected engine/template correctly. If the selected template is Canvas 2D, render generated PNG assets with loaded HTMLImageElement objects and ctx.drawImage. If it is Phaser or Three.js, use native textures/sprites/materials.
2. Load ALL image assets from window.DREAM_ASSETS by key. Do not invent data URIs.
3. Use the player asset for the main character/hero
4. Use enemy assets for obstacles/opponents/monsters
5. Use item assets for collectibles/pickups/power-ups
6. Use background assets for environment/scenery layers
7. Render HUD, health bars, buttons, labels, and controls in code. Do not use generated images for readable UI.
8. Use prop assets for obstacles, decorations, interactive objects
9. All sprites have transparent backgrounds (except backgrounds)
10. ⚠️ ABSOLUTELY NO SVG CIRCLES OR PROCEDURAL PLACEHOLDER SHAPES for main gameplay entities when matching AI-generated PNG assets exist.
11. For Canvas 2D, never pass a data URL string directly to ctx.drawImage. Convert it with new Image() or DreamAssets.loadImageElement(keyOrRole), cache it, then draw the HTMLImageElement.
12. Do NOT fetch external images — these embedded assets are ALL you need for visuals
13. Use window.DREAM_ASSET_PACK as the source of truth for available assets and roles.
14. Use window.DREAM_ANIMATIONS and the injected DreamAssets helper to create Phaser frame animations/tweens for idle, movement, hit, defeat, dash, and action feedback. Example: DreamAssets.createAnimations(this); playerSprite.play("player_idle", true); DreamAssets.applyTween(this, playerSprite, "player_idle").
15. Use window.DREAM_AUDIO_MANIFEST and the injected DreamAudio runtime for real audio files. Trigger sounds with DreamAudio.play("impact"), DreamAudio.play("collect"), DreamAudio.play("primary_action"), DreamAudio.play("movement_burst"), DreamAudio.play("success"), DreamAudio.play("failure"), or any key from the manifest. Do NOT synthesize oscillator/beep sounds.
16. Use window.DREAM_TILESETS for tile/grid/platform/maze/dungeon games. If a tileset manifest exists, build the playfield from a repeatable tile rhythm instead of one empty flat backdrop.
17. Match artDirection: sprite angle, palette, screen composition, background layering, terrain rendering, and code-rendered UI style must feel like one art system.

Example Phaser 3 usage:
\`\`\`javascript
// In preload()
const dreamAssets = window.DREAM_ASSETS || {};
const loadedKeys = DreamAssets.preloadPhaser(this);

// In create()
const W = this.scale.width, H = this.scale.height;
const safe = DreamAssets.safeRect(W, H);
${backgrounds.length > 0 ? `DreamAssets.addBackgroundCover(this, '${backgrounds[0].id}', W, H);` : ''}
${player.length > 0 ? `this.player = DreamAssets.addSprite(this, '${player[0].id}', W * 0.5, safe.y + safe.height * 0.55, { maxW: 96, maxH: 96, depth: 10 });` : ''}
${enemies.length > 0 ? `this.enemy = DreamAssets.addSprite(this, '${enemies[0].id}', W * 0.5, safe.y + safe.height * 0.25, { maxW: 86, maxH: 86, depth: 9 });` : ''}
// Create animations/tweens from window.DREAM_ANIMATIONS.
// DreamAssets.createAnimations(this);
// playerSprite.play('player_idle', true);
// DreamAssets.applyTween(this, this.player, 'player_idle');
// Trigger sound at gameplay moments:
// DreamAudio.play('primary_action'); DreamAudio.play('impact'); DreamAudio.play('collect'); DreamAudio.startMusic();
\`\`\`

Example Three.js usage:
\`\`\`javascript
const textureLoader = new THREE.TextureLoader();
${player.length > 0 ? `const playerTexture = textureLoader.load((window.DREAM_ASSETS || {})['${player[0].id}']);
const playerMaterial = new THREE.MeshBasicMaterial({ map: playerTexture, transparent: true });
const playerMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), playerMaterial);
scene.add(playerMesh);` : ''}
\`\`\``;
}

function buildPixelArtRuleBlock(specSheet = {}, userPrompt = '') {
  if (!requestsStrictPixelArt(specSheet, userPrompt)) return '';

  return `STRICT PIXEL-ART CONTRACT:
- The user explicitly wants pixel art. Treat that as a hard visual requirement, not a loose retro vibe.
- Use Phaser 3 with WebGL renderer (type: Phaser.WEBGL) for GPU acceleration.
- Configure Phaser for pixel-perfect rendering:
  - Set pixelArt: true in the game config
  - Use NEAREST texture filtering: Phaser.Textures.FilterMode.NEAREST
  - Disable antialiasing: antialias: false
- Keep sprite/camera movement aligned to integer pixels whenever practical. Avoid subpixel blur.
- Use consistent tile sizing such as 16x16, 24x24, or 32x32. Platforms, pickups, enemies, and HUD ornaments should respect that pixel grid.
- Do NOT use soft gradients, blurry glow blobs, glassmorphism, or modern rounded-dashboard UI styling as the primary look.
- Do NOT leave giant smooth empty sky areas with tiny sprites floating in them. Compose the frame like a real pixel platformer: stronger tile rhythm, horizon layers, chunkier platforms, and readable spacing.
- Prefer pixel-friendly backgrounds, tiles, characters, pickups, and HUD ornaments from the approved asset kit.
- If no visual pixel kit is attached for this run, you MUST generate the pixel sprites, tiles, pickups, and backdrop yourself instead of faking a smooth scene.
- If you must draw missing art procedurally, make it blocky, tile-like, and pixel-readable instead of smooth or painterly.
- Use chunky, readable pixel-style HUD text treatment. Avoid sleek modern UI panels that clash with pixel sprites.`;
}

// ─────────────────────────────────────────────────────────
// PHASE 1: MINIMAL INTENT EXTRACTION (runs on Kimi K-2.6)
// Extract only what's needed: user intent, 2D/3D, asset search terms, animation frames
// ─────────────────────────────────────────────────────────

export function buildPhase1_Quantize(userPrompt, { dynamicFoundation = false } = {}) {
  const archetypeBlock = dynamicFoundation
    ? `- Do NOT pick legacy template folders or archetype buckets. Phase 1.5 Foundation Architect will design the per-game foundation contract.
- Still describe dimension, perspective, physics, and mobile layout clearly for the foundation architect.`
    : `- Classify the game into ONE of these archetypes based purely on PHYSICS and PERSPECTIVE (not genre name):
  1. turn_based_artillery: turn-based angle/power projectile firing (e.g. Tanks, Angry Birds if turn-based)
  2. top_down_action: top-down or isometric view, free 8-way movement, entity collisions (e.g. Zelda, Vampire Survivors)
  3. platformer: side view, Y-axis gravity, running and jumping on platforms (e.g. Mario)
  4. runner: side view, auto-scrolling, dodging obstacles (e.g. Flappy Bird, Chrome Dino)
  5. arcade_shooter: free movement + firing projectiles, usually top-down/side space (e.g. Asteroids, Space Invaders)
  6. physics_simulation: placing objects then simulating rigid body physics (e.g. building contraptions)
  7. grid_puzzle: movement locked to discrete grid steps (e.g. Sokoban, Match-3, Tetris)
  8. interactive_story: branching narrative, state machines, choices (e.g. Visual Novel)
  9. first_person_3d: 3D perspective, moving and looking around (e.g. FPS, walking sim)
  10. arcade: anything else that doesn't fit the strict physics of the above (e.g. Fruit Ninja swipe games, whack-a-mole, idle games).`;

  const technicalRequirementsShape = dynamicFoundation
    ? `"dimension": "2D | 3D",
    "perspective": "first_person | third_person | top_down | side_view | isometric",
    "preferredEngine": "CANVAS",
    "physicsSummary": "Describe movement/collision/loop physics in plain language for the foundation architect",
    "screenComposition": "Where the player, hazards, runtime HUD, controls, and important action should live on a phone screen",
    "hudPlan": "What the HUD must show as code-rendered interface, not as AI-generated image art"`
    : `"dimension": "2D | 3D",
    "perspective": "first_person | third_person | top_down | side_view | isometric",
    "preferredEngine": "PHASER | THREE | CANVAS",
    "archetype": "turn_based_artillery | top_down_action | platformer | runner | arcade_shooter | physics_simulation | grid_puzzle | interactive_story | first_person_3d | arcade",
    "archetypeReasoning": "Briefly explain why this archetype fits the physics and perspective requested",
    "screenComposition": "Where the player, hazards, runtime HUD, controls, and important action should live on a phone screen",
    "hudPlan": "What the HUD must show as code-rendered interface, not as AI-generated image art"`;

  return {
    system: `You are a world-class game director and technical designer for mobile HTML5 games.
Your job is to deeply understand the requested game BEFORE any code is written.

RULES:
- Output ONLY raw JSON, no markdown, no explanation.
${archetypeBlock}
- DIMENSION — decide 2D vs 3D by the idea's REAL reference form and the genre's modern player expectation, NOT by whether the user typed the word "3D". Most of these games are spatial-motion fantasies that players today picture in 3D even when they don't say so. Match what the named/implied game actually is:
  * Choose "3D" (perspective with depth) whenever the core fantasy is moving THROUGH a space with depth. This includes — even when the word "3D" is absent:
    - Driving / racing / DRIFTING / motorcycle / kart games ("neon drift through midnight streets" is 3D third-person, NOT top-down).
    - Board/ski/skate/surf/sled/sports-motion games (snowboarding, skateboarding, surfing, downhill, BMX).
    - Behind-the-character endless runners / chasers (Subway Surfers, Temple Run).
    - First-person anything (FPS, walking sim, dungeon crawler), flight / space-with-depth.
    - Voxel/blocky/Minecraft-style worlds, or any prompt naming a famously-3D game.
    For 3D set perspective to first_person or third_person.
  * Choose "2D" for genuinely flat games: top-down or side-view, match/puzzle/grid, platformers, whack-a-mole, card/board, flat arcade/swipe games — and ALWAYS 2D when the user explicitly says top-down, side-view, 2D, retro, or pixel-flat.
  * Tie-breaker: if a motion/driving/sports/runner idea is ambiguous, prefer 3D (that is the form players expect). Only fall back to 2D when the idea is genuinely flat OR the user explicitly asked for a flat/retro/top-down look. Do NOT downgrade an obviously-3D idea to 2D just to be safe.
- Think in concrete playable behavior: player verbs, entity rules, feedback, screen composition, and the first 10 seconds.
- Keep scope realistic for one self-contained mobile HTML5 game.
- The builder must be able to implement your spec directly.
- Plan gameplay/environment visual assets that support the gameplay rules, not random decoration.
- Be specific with asset descriptions because they will be used to generate AI art.

${formatUnityPhase1PromptBlock()}`,

    user: `USER PROMPT: "${userPrompt}"

Extract this JSON:
{
  "title": "Creative game title",
  "userIntent": "One sentence: what does the user want to experience emotionally and mechanically?",
  "playableExperience": {
    "coreFantasy": "What the player should feel they are doing, not a genre label",
    "coreLoop": "A concrete repeatable loop: input -> game reaction -> reward/pressure -> next decision",
    "primaryMechanic": "The one mechanic that must work for the game to feel like the prompt",
    "funFactor": "Why this game will be satisfying moment to moment",
    "firstTenSeconds": [
      "what is visible on frame 1",
      "what pressure or goal appears within 2 seconds",
      "what the player can do immediately",
      "what feedback proves the main mechanic works"
    ],
    "winCondition": "How a player succeeds, or score/survival target if endless",
    "loseCondition": "How a player fails"
  },
  "technicalRequirements": {
    ${technicalRequirementsShape}
  },
  "artDirection": {
    "styleName": "short name for the visual style, GROUNDED IN THE USER'S PROMPT and chosen for CINEMATIC IMPACT — pick the time-of-day, mood, and lighting that make THIS subject look best, not the flattest/safest one (a street racer reads best as a moody dusk/night city with lit windows + wet reflective asphalt; a forest adventure as lush woodland with shafts of light). Use dramatic lighting, deep contrast, and rich color. Do NOT reflexively reskin everything as neon/synthwave/cyberpunk, but do NOT default to flat evenly-lit midday either",
    "palette": ["4-6 concrete color names or hex values"],
    "spriteStyle": "how characters/vehicles/objects should look: perspective, outline, detail level, lighting, scale language",
    "spriteCameraAngle": "side view | top-down | three-quarter | front-facing | first-person diegetic",
    "backgroundStyle": "what scenery layers should look like and how much detail belongs in the background",
    "terrainStyle": "how code-rendered terrain/platforms/paths/arenas should look, including edge treatment and material",
    "uiStyle": "how runtime code-rendered HUD/buttons/meters should look; no AI-generated HUD images",
    "screenComposition": "portrait mobile layout: sky/playfield/action/HUD/control zones with safe top/bottom spacing",
    "consistencyRules": [
      "rule that keeps all assets and code-rendered visuals coherent"
    ],
    "avoid": [
      "visual mistake to avoid, such as tiny sprites, empty sky, baked text, random sticker assets, clashing UI"
    ]
  },
  "mobileControls": [
    {
      "action": "player action",
      "input": "tap | drag | swipe | hold | joystick | button | gesture",
      "feedback": "visible feedback when input works"
    }
  ],
  "playerActions": [
    "concrete verb the player can perform"
  ],
  "entityRules": [
    {
      "entity": "name",
      "role": "player | enemy | item | obstacle | projectile | spell | environment | ui",
      "behavior": "exact gameplay behavior",
      "interaction": "how it affects or is affected by other entities",
      "feedback": "visual/audio feedback when it acts, hits, dies, scores, etc."
    }
  ],
  "mustExist": [
    "specific feature, entity, feedback, objective, control, or rule that must be implemented"
  ],
  "feelRules": [
    "concrete juice/animation/audio/feedback rule"
  ],
  "failureModesToAvoid": [
    "specific bad outcome that would make this game not match the prompt"
  ],
  "assetRoles": [
    {
      "assetId": "player | enemy1 | item1 | background1 | prop1",
      "roleInGameplay": "how this asset should be used in the game, not just what it depicts"
    }
  ],
  "visualAssets": {
    "player": {
      "description": "detailed visual description of main character",
      "type": "character",
      "size": 128,
      "transparent": true
    },
    "enemies": [
      {
        "id": "enemy1",
        "description": "detailed visual description of enemy",
        "type": "enemy",
        "size": 128,
        "transparent": true
      }
    ],
    "items": [
      {
        "id": "item1",
        "description": "detailed visual description of collectible/item",
        "type": "item",
        "size": 64,
        "transparent": true
      }
    ],
    "backgrounds": [
      {
        "id": "bg1",
        "description": "detailed mobile-safe scenery description only; no text, no HUD, no buttons, no characters unless purely distant environmental silhouettes",
        "type": "background",
        "width": 768,
        "height": 1344,
        "transparent": false
      }
    ],
    "ui": [],
    "props": [
      {
        "id": "prop1",
        "description": "prop/obstacle description",
        "type": "prop",
        "size": 96,
        "transparent": true
      }
    ]
  },
  "audioNeeds": {
    "music": ["background music style"],
    "sfx": ["sound effect types needed"]
  }
}

IMPORTANT:
- This is not a mood board. It is the game's operational understanding.
- STAY GROUNDED IN THE USER'S PROMPT, but ground it CINEMATICALLY — pick the most striking real-world-plausible look for the subject, and lean into dramatic night/dusk/overcast lighting and deep contrast when that flatters it. A city street racer looks best at night with lit windows and wet reflective asphalt, NOT flat midday sun on a green field. Do NOT reflexively reskin everything as neon/synthwave/cyberpunk — reserve heavy glow/holographic looks for when the user's words call for them — but equally, do NOT retreat to flat, evenly-lit daylight as a default. When the user gave no style, choose the look with the most mood and depth for the subject.
- playableExperience, mobileControls, entityRules, mustExist, feelRules, failureModesToAvoid, and assetRoles must be specific to the user's prompt.
- artDirection must be specific enough that a second artist could draw the same game world consistently.
- artDirection must explain what is AI-generated art versus what is code-rendered runtime UI/geometry.
- mustExist should include 8-14 concrete checks the final game must satisfy.
- failureModesToAvoid should include 5-10 concrete mistakes to prevent.
- firstTenSeconds should make the game feel alive immediately.
- Include 1 player character
- Include 2-3 enemies
- Include 2-3 items/collectibles
- Include 1-2 backgrounds
- Include 2-4 props/obstacles
- Be specific with descriptions (colors, style, details)
- Total: 6-10 visual assets
- Do NOT request AI-generated HUD panels, meters, labels, buttons, text, or control surfaces. Put HUD/control requirements in technicalRequirements.hudPlan, mobileControls, and mustExist instead.
- Do NOT invent multiplayer, online modes, customization, campaigns, shops, or extra features unless the user explicitly asked for them.
- For collision terrain, paths, pads, platforms, or tactical grids, require code-defined gameplay geometry. Background art is scenery only.
- Background descriptions must explicitly forbid text, UI, HUD, buttons, labels, watermarks, and foreground playable entities.
- Asset descriptions must inherit artDirection.palette, spriteStyle, spriteCameraAngle, and backgroundStyle so assets do not clash.

SIZE GUIDELINES:
- Characters/enemies: 128px (medium detail)
- Items/collectibles: 64px (small, simple)
- Backgrounds: width 768, height 1344 for portrait mobile scenery unless the game needs a landscape arena; never 512px square by default
- Props/obstacles: 96px (medium, environmental)

TRANSPARENCY RULES:
- Set "transparent": true for sprites that need background removal (characters, items, UI, props)
- Set "transparent": false for backgrounds and full-scene images

Output ONLY the JSON.`
  };
}

function buildEngineSpecBlock(specSheet) {
  if (specSheet.runtimeLane === 'third_person_threejs') {
    return `ENGINE SPEC: THREE.JS THIRD-PERSON / CHASE CAMERA
- Imports:
  - <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js"></script>
- Required setup:
  1. const scene = new THREE.Scene()
  2. const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 300)
  3. const renderer = new THREE.WebGLRenderer({ antialias: true })
  4. renderer.setSize(window.innerWidth, window.innerHeight)
  5. add ambient light + directional/hemisphere light
  6. build a visible player/vehicle group and floor/road/arena geometry
- Camera:
  - camera follows a target behind or over the shoulder
  - updateCamera(dt) should smooth position and call camera.lookAt(target)
- Controls:
  - driving prompts: steering + ACCEL/GAS + BRAKE + optional DRIFT/BOOST
  - character prompts: left joystick + action/interact/attack button
- World style:
  - compact but real 3D space with readable hazards, pickups, landmarks, and depth`;
  }

  if (specSheet.runtimeLane === 'first_person_threejs' || specSheet.preferredEngine === 'THREE_JS') {
    return `ENGINE SPEC: THREE.JS FIRST-PERSON
- Imports:
  - <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js"></script>
- Required setup:
  1. const scene = new THREE.Scene()
  2. const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 200)
  3. const renderer = new THREE.WebGLRenderer({ antialias: true })
  4. renderer.setSize(window.innerWidth, window.innerHeight)
  5. add ambient light + one stronger directional/point light
  6. build floor plus wall meshes using BoxGeometry / PlaneGeometry
- Controls:
  - left thumb joystick = movement
  - right drag region = yaw/pitch look
  - touch button = attack/interact if needed
- World style:
  - compact low-poly or blocky geometry
  - no external textures required
  - strong landmarks, readable lighting, obvious depth`;
  }

  if (specSheet.preferredEngine === 'P5_JS') {
    return `ENGINE SPEC: P5.JS
- Use p5.js via CDN.
- Use WEBGL mode only if the cameraPerspective is 3D-like.
- Keep the render loop simple and mobile-friendly.`;
  }

  if (specSheet.preferredEngine === 'DOM_UI') {
    return `ENGINE SPEC: DOM/CSS
- Build the interface with HTML/CSS overlays.
- Prefer this only for UI-heavy non-action games.`;
  }

  return `ENGINE SPEC: PHASER 3 WITH AUTO RENDERER
- Use Phaser 3 via CDN (https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js)
- Use AUTO renderer for compatibility: type: Phaser.AUTO
- Keep the game compact, touch-first, and readable on mobile.
- Use Phaser's built-in physics, sprites, and animations for better performance.`;
}

function buildOperationalGameSpecBlock(qualityIntent = {}) {
  const playableExperience = qualityIntent.playableExperience || {};
  const list = (value, fallback = []) => normalizeList(value, fallback);
  const entityRules = Array.isArray(qualityIntent.entityRules) ? qualityIntent.entityRules : [];
  const controls = Array.isArray(qualityIntent.mobileControls) ? qualityIntent.mobileControls : [];
  const assetRoles = Array.isArray(qualityIntent.assetRoles) ? qualityIntent.assetRoles : [];
  const compactSpec = {
    title: qualityIntent.title || 'Untitled Game',
    userIntent: qualityIntent.userIntent || '',
    playableExperience: {
      coreFantasy: playableExperience.coreFantasy || '',
      coreLoop: playableExperience.coreLoop || '',
      primaryMechanic: playableExperience.primaryMechanic || '',
      funFactor: playableExperience.funFactor || '',
      firstTenSeconds: list(playableExperience.firstTenSeconds),
      winCondition: playableExperience.winCondition || '',
      loseCondition: playableExperience.loseCondition || '',
    },
    technicalRequirements: qualityIntent.technicalRequirements || {},
    artDirection: qualityIntent.artDirection || {},
    mobileControls: controls,
    playerActions: list(qualityIntent.playerActions),
    entityRules,
    mustExist: list(qualityIntent.mustExist),
    feelRules: list(qualityIntent.feelRules),
    failureModesToAvoid: list(qualityIntent.failureModesToAvoid),
    assetRoles,
  };

  return `OPERATIONAL GAME SPEC - BUILD THIS, NOT JUST THE THEME:
${JSON.stringify(compactSpec, null, 2)}

BUILDER CONTRACT:
- Treat the operational spec above as the source of truth for gameplay.
- Implement every mustExist item in actual playable code, not as text labels.
- Implement every entityRules behavior and interaction that is relevant to the final game.
- The first 10 seconds must match playableExperience.firstTenSeconds.
- Controls MUST work on both phone and desktop, doing the exact same actions:
  - Phone (touch): implement mobileControls — tap, swipe left/right, drag, and on-screen buttons.
  - Desktop (keyboard): add window keydown/keyup listeners and map the SAME actions to keys — Arrow Left/Right and A/D for left/right movement or steering, Arrow Up/Down or W/S for up/down, Space or Enter for the primary action, Escape or P for pause.
  - Both input methods must always be active at the same time. Never require keyboard-only or touch-only.
  - Hide the on-screen touch buttons on desktop using a CSS @media (pointer: coarse) check, since desktop players use the keyboard.
- Use assetRoles and the AI asset keys to connect art to gameplay roles.
- Follow artDirection as the visual source of truth. Code-rendered HUD, terrain, controls, and generated sprites must feel like one art system.
- Add feelRules as real feedback: animation, particles, hit-stop, screen shake, sound, UI pulses, or camera motion.
- Actively avoid every failureModesToAvoid item.
- If scope conflicts arise, keep the primaryMechanic, coreLoop, firstTenSeconds, and mustExist items before adding extras.`;
}

export function buildLabsSoloPrototype(userPrompt, qualityIntent = {}, audioBundle = null, mediaAttachments = [], generatedAssets = null) {
  const wants3D = qualityIntent?.technicalRequirements?.dimension === '3D';
  const wantsFirstPerson = qualityIntent?.technicalRequirements?.perspective === 'first_person';
  const wantsThirdPerson = qualityIntent?.technicalRequirements?.perspective === 'third_person';

  const audioKitBlock = buildAudioKitBlock(audioBundle);
  const userMediaBlock = buildUserMediaBlock(mediaAttachments);
  const aiAssetsBlock = buildAIAssetsBlock(generatedAssets);
  const operationalSpecBlock = buildOperationalGameSpecBlock(qualityIntent);

  const engineNote = wants3D
    ? `Use Three.js (https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js). ${wantsFirstPerson ? 'First-person camera.' : wantsThirdPerson ? 'Third-person chase camera.' : 'Choose the best camera for the game.'}`
    : `Use Phaser 3 (https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js) with type: Phaser.AUTO. Load ALL visuals from the AI-GENERATED ASSETS section below as base64 data URIs.`;

  return `You are an expert HTML5 game developer. Build a complete, polished, mobile-first game as a single self-contained HTML file.

GAME CONCEPT:
"${userPrompt}"

${formatUnityPromptBlock({ audience: 'builder' })}

${operationalSpecBlock}

ENGINE:
${engineNote}

REQUIREMENTS:
- Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown, no explanation.
- Controls must work on BOTH phone and desktop and trigger the same actions:
  - Phone (touch): pointerdown/pointermove/pointerup — tap, swipe left/right, drag, on-screen buttons.
  - Desktop (keyboard): add window keydown/keyup listeners — Arrow keys and WASD for movement/left-right, Space or Enter for the primary action, Escape or P for pause.
  - Both input methods must be active simultaneously. Never require one or the other.
  - Hide the on-screen touch buttons on desktop with @media (pointer: coarse).
- Boot immediately — no DOMContentLoaded or window.onload wrappers.
- First frame must be visible and themed immediately.
- Use a real mobile viewport contract: derive width/height from window.innerWidth/window.innerHeight or visualViewport, not fixed 800x600/1024x768 dimensions.
- Configure Phaser scale with width: window.innerWidth, height: window.innerHeight, mode: Phaser.Scale.RESIZE or Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, and handle resize/orientationchange.
- Keep html/body/root/canvas at width:100vw; height:100dvh or 100vh fallback; margin:0; overflow:hidden; touch-action:none; no horizontal scrolling.
- Reserve GameTok chrome-safe space: top 112px and bottom 48px minimum. Place HUD, score, lives, wave labels, pause, inventory, joysticks, buttons, and menus inside DreamAssets.safeRect(width,height).
- No gameplay-critical UI may appear at y < 112px. Spawn player/objectives/enemies inside the visible safe play rectangle on frame one.
- Every resize must recompute canvas/renderer size, camera/world bounds, HUD positions, control positions, and background cover scale.
- Prevent all external navigation from the generated game. Do not set window.location, do not call window.open, do not create links to websites, and do not load iframes.
- Complete game loop: start, play, win/lose, restart.
- Score, HUD, and moment-to-moment feedback must be rendered by code as clean runtime UI, not as random AI-generated HUD images.
- Never place text inside generated image assets. All readable labels, meters, buttons, score, turn prompts, and control panels must be code-rendered.
- Background assets are scenery only. Do not use background art as collision terrain, tactical paths, landing pads, platforms, or UI. Gameplay geometry must be code-defined when it affects collision, aiming, movement, or win/loss.
- Treat artDirection as binding: sprite angle, palette, background layering, terrain style, runtime UI style, and mobile composition must match across the whole game.
- Code-render terrain/platforms/arenas/paths using artDirection.terrainStyle. Do not use raw blocky default shapes unless the artDirection explicitly calls for blocky pixel art.
- Code-render HUD and controls using artDirection.uiStyle with clear hierarchy, padding, contrast, and no overlap with GameTok chrome.
- Do not add multiplayer, online play, shops, campaigns, deep customization, or extra modes unless the user explicitly requested them.
- Expose window.gametokEditable = { images:[], music:[], colors:[], text:[], tune:[], videos:[], sfx:[] } with any tweakable values.
- Wrap init in try/catch with a visible error panel fallback.

${aiAssetsBlock}

${audioKitBlock}

${userMediaBlock}

QUALITY BAR:
- This must look and feel like a REAL published mobile game.
- The generated game must satisfy the OPERATIONAL GAME SPEC above.
- The player must understand and use the primary mechanic within the first 10 seconds.
- Use the AI-generated assets as your PRIMARY visual assets. They are custom-made for this exact game.
- Use the structured manifest deliberately: player art for player, enemy art for enemies, item art for rewards, background art as scenery only, props as colliders/obstacles/interactables.
- Do not let assets float randomly or appear as decorative stickers. Every visible asset should have a gameplay role, collision/interaction role, or environmental composition role.
- Compose the first screen like a finished mobile game: readable action area, intentional negative space, properly scaled sprites, code-rendered HUD, and controls that do not cover gameplay.
- Avoid dead-looking scenes: no tiny lonely sprites in giant empty backgrounds, no mismatched asset styles, no baked AI text, no offscreen HUD, no procedural filler that ignores the asset pack.
- Add particles, screen shake, smooth animations, satisfying audio feedback.
- Make it fun to play for at least 2 minutes.
- No placeholder art, no empty screens, no broken controls.

OUTPUT: The complete HTML file only.`;
}

// ─────────────────────────────────────────────────────────
// PHASE 3: SELF-CRITIQUE + IMPROVEMENT PASS
// Kimi reads its own output, judges quality, rewrites weak parts
// ─────────────────────────────────────────────────────────

export function buildPhase3_SelfCritique(originalPrompt, currentHtml, qualityIntent = null) {
  const operationalSpec = qualityIntent ? buildOperationalGameSpecBlock(qualityIntent) : '';
  return `You are a senior game developer doing a quality review of a game you just built.

ORIGINAL CONCEPT:
"${originalPrompt}"

${operationalSpec}

YOUR CURRENT BUILD:
\`\`\`html
${currentHtml}
\`\`\`

REVIEW CHECKLIST - be brutally honest:
1. Does it actually match the concept? (right genre, right feel, right theme)
2. Does it satisfy every mustExist item from the operational spec?
3. Does the first 10 seconds match playableExperience.firstTenSeconds?
4. Are entityRules implemented as actual gameplay behavior?
5. Do the visuals look good? (proper sprites loaded, not ugly shapes or placeholders)
6. Is the gameplay fun and responsive? (controls work, feedback is satisfying)
7. Is there visual juice? (particles, animations, screen shake, impact effects)
8. Does audio work? (real local audio files loaded, not silence or oscillator beeps)
9. Is the UI readable on mobile? (not tiny text, not overlapping elements)
10. Are there any broken features? (things that don't work as intended)

Based on your review, rewrite the COMPLETE improved HTML file that fixes every issue you found.

RULES:
- If something is already good, keep it exactly as is.
- Only rewrite parts that are genuinely weak or broken.
- Do NOT downgrade working features while fixing others.
- The game must still boot immediately and work on mobile touch.
- Output ONLY the complete HTML file. No explanation.`;
}

export function buildPhase1B_Scaffold(specSheet) {
  return {
    system: `You are the Technical Design Lead for a mobile HTML5 Canvas game studio.
Your job is to turn a validated game spec into a SHARED SCAFFOLD CONTRACT that both the artist and engineer can follow.

IMPORTANT RULES:
- Output ONLY raw JSON.
- Think like a gameplay lead creating a playable shell, not a prose writer.
- Keep the scaffold realistic for one self-contained mobile canvas game.
- Prefer one polished vertical slice over impossible scope.
- Include only contracts and structure the team can actually execute in one pass.`,
    user: `GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

Return this JSON shape:
{
  "initialState": "MENU | PREP | PLAYING",
  "stateFlow": ["MENU", "PREP", "BATTLE", "RESULT"],
  "cameraMode": "single_screen | follow_player | anchored_arena",
  "worldRules": ["short practical world rule"],
  "hudBlocks": ["currency", "health", "battle_button"],
  "entityBlueprints": [
    {
      "id": "knight",
      "role": "ally | enemy | projectile | pickup | fx | obstacle",
      "renderFn": "drawKnight",
      "width": 72,
      "height": 72,
      "spawnRule": "how it appears in the scene"
    }
  ],
  "firstFrameChecklist": ["visible thing that must exist on first frame"],
  "interactionLoops": ["short input or game-loop description"],
  "engineTodos": ["concrete engineering task"],
  "artistTodos": ["concrete art/render task"],
  "integrationNotes": ["how art + logic should fit together"]
}

Rules:
- entityBlueprints must align with renderManifest and the requested game fantasy.
- Include 3 to 8 entityBlueprints.
- Width and height must be realistic gameplay sizes, never 1.
- stateFlow should reflect the actual lane. Auto-battlers should usually use MENU/PREP/BATTLE/RESULT.
- firstFrameChecklist must guarantee a non-black, readable first frame.
- integrationNotes should describe how the engineer should call the render API safely.

Output ONLY JSON.`
  };
}

export function buildSharedScaffoldShell(specSheet, scaffold) {
  const stateFlow = normalizeList(scaffold?.stateFlow, ['MENU', 'PLAYING', 'RESULT']);
  const entityBlueprints = normalizeList(scaffold?.entityBlueprints, []).slice(0, 8);
  const firstEntity = entityBlueprints[0] || { id: 'hero', renderFn: 'drawHero', width: 72, height: 72, role: 'ally' };
  const secondEntity = entityBlueprints[1] || { id: 'enemy', renderFn: 'drawEnemy', width: 64, height: 64, role: 'enemy' };
  const hudBlocks = normalizeList(scaffold?.hudBlocks, ['score', 'health']);
  const worldRules = normalizeList(scaffold?.worldRules, ['Keep the experience readable on a phone screen.']);
  const engineTodos = normalizeList(scaffold?.engineTodos, ['Implement a complete update loop and state transitions.']);
  const interactionLoops = normalizeList(scaffold?.interactionLoops, ['Use touch-first controls and keep the first interaction obvious.']);
  const integrationNotes = normalizeList(scaffold?.integrationNotes, ['Always render through window.RenderEngine functions.']);
  const safeScaffoldJson = JSON.stringify({
    initialState: scaffold?.initialState || 'MENU',
    stateFlow,
    cameraMode: scaffold?.cameraMode || 'single_screen',
    hudBlocks,
    worldRules,
    entityBlueprints,
    firstFrameChecklist: normalizeList(scaffold?.firstFrameChecklist, ['Draw a visible background and at least one ally + one enemy.']),
    interactionLoops,
    engineTodos,
    artistTodos: normalizeList(scaffold?.artistTodos, ['Create readable silhouettes and themed background depth.']),
    integrationNotes,
  }, null, 2);
  const allyBlueprints = entityBlueprints.filter((entity) => entity.role === 'ally');
  const enemyBlueprints = entityBlueprints.filter((entity) => entity.role === 'enemy');
  const safeAllies = allyBlueprints.length > 0 ? allyBlueprints : [firstEntity];
  const safeEnemies = enemyBlueprints.length > 0 ? enemyBlueprints : [secondEntity];

  if (specSheet.runtimeLane === 'auto_battler_arena') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${specSheet.title}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--gametok-stage-bg, ${specSheet.backgroundColor || '#111111'});
      touch-action: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
      touch-action: none;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script>
  const DreamScaffold = ${safeScaffoldJson};
  const UnitCatalog = ${JSON.stringify(safeAllies, null, 2)};
  const EnemyCatalog = ${JSON.stringify(safeEnemies, null, 2)};
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TOP_INSET = 112;
  const SIDE_PAD = 24;
  const gameRuntimeTuning = {
    cameraShakeDecay: 18,
    allyDamageScale: 1,
    enemyWaveScale: 1
  };

  window.gametokEditable = window.gametokEditable || {
    images: [],
    music: [],
    colors: [
      { id: 'stage_bg', cssVar: '--gametok-stage-bg', value: '${specSheet.backgroundColor || '#111111'}' }
    ],
    text: [
      { id: 'battle_button_label', value: 'BATTLE', path: 'game.ui.battleButton.label' }
    ],
    tune: [
      { id: 'camera_shake_decay', value: 18, path: 'gameRuntimeTuning.cameraShakeDecay' },
      { id: 'ally_damage_scale', value: 1, path: 'gameRuntimeTuning.allyDamageScale' },
      { id: 'enemy_wave_scale', value: 1, path: 'gameRuntimeTuning.enemyWaveScale' }
    ],
    videos: [],
    sfx: []
  };
  window.gameRuntimeTuning = gameRuntimeTuning;
  document.documentElement.style.setProperty('--gametok-stage-bg', '${specSheet.backgroundColor || '#111111'}');

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distance(a, b) {
    return Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.height / 2) - (b.y + b.height / 2));
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function makeDamageNumber(x, y, value, color) {
    return { x, y, value, color, life: 0.9 };
  }

  function createUnitFromBlueprint(blueprint, x, y, side) {
    const archetype = String(blueprint.id || '').toLowerCase();
    const isKnight = archetype.includes('knight');
    const isArcher = archetype.includes('archer');
    const isWizard = archetype.includes('wizard');
    const isGoblin = archetype.includes('goblin');
    return {
      id: Math.random().toString(36).slice(2),
      type: blueprint.id,
      renderFn: blueprint.renderFn,
      x,
      y,
      width: blueprint.width || 64,
      height: blueprint.height || 64,
      side,
      hp: isKnight ? 180 : isWizard ? 90 : isArcher ? 110 : isGoblin ? 55 : 100,
      maxHp: isKnight ? 180 : isWizard ? 90 : isArcher ? 110 : isGoblin ? 55 : 100,
      damage: (isKnight ? 26 : isWizard ? 18 : isArcher ? 12 : isGoblin ? 10 : 12) * gameRuntimeTuning.allyDamageScale,
      speed: isKnight ? 62 : isWizard ? 48 : isArcher ? 72 : isGoblin ? 78 : 70,
      range: isKnight ? 78 : isWizard ? 180 : isArcher ? 220 : isGoblin ? 54 : 70,
      cooldown: 0.2,
      attackRate: isKnight ? 0.8 : isWizard ? 1.3 : isArcher ? 0.55 : isGoblin ? 0.75 : 0.8,
      archetype,
      knockback: isKnight ? 18 : isWizard ? 8 : 5,
      aoe: isWizard ? 82 : 0
    };
  }

  const game = {
    state: DreamScaffold.initialState || 'PREP',
    camera: { x: 0, y: 0, shake: 0 },
    score: 0,
    health: 100,
    wave: 1,
    battleTimer: 0,
    previewIndex: 0,
    placementSlots: [],
    allies: [],
    enemies: [],
    projectiles: [],
    particles: [],
    damageNumbers: [],
    pointer: { x: 0, y: 0, down: false },
    lastTime: 0,
    ui: {
      battleButton: { x: 0, y: 0, w: 188, h: 66, label: 'BATTLE', visible: true }
    },
    resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.ui.battleButton.x = canvas.width - this.ui.battleButton.w - SIDE_PAD;
      this.ui.battleButton.y = TOP_INSET + 6;
      const laneTop = TOP_INSET + 124;
      const laneHeight = canvas.height - laneTop - 84;
      const laneBottom = laneTop + laneHeight;
      this.placementSlots = Array.from({ length: 4 }, (_, index) => ({
        x: 92 + index * 88,
        y: laneBottom - 136 - (index % 2) * 58,
        w: 76,
        h: 76
      }));
    },
    resetPrep() {
      this.state = 'PREP';
      this.wave = 1;
      this.battleTimer = 0;
      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.damageNumbers = [];
      this.health = 100;
      this.score = 0;
      this.previewIndex = 0;
      this.ui.battleButton.visible = true;
      this.allies = this.placementSlots.slice(0, 3).map((slot, index) => {
        const blueprint = UnitCatalog[index % UnitCatalog.length];
        return createUnitFromBlueprint(blueprint, slot.x, slot.y, 'ally');
      });
    },
    spawnGoblinWave(count) {
      const enemyBlueprint = EnemyCatalog[0];
      const scaledCount = Math.max(1, Math.round(count * gameRuntimeTuning.enemyWaveScale));
      for (let i = 0; i < scaledCount; i++) {
        const yBase = TOP_INSET + 170 + (i % 4) * 88;
        this.enemies.push(createUnitFromBlueprint(enemyBlueprint, canvas.width - 170 + (i % 2) * 18, yBase + Math.floor(i / 2) * 22, 'enemy'));
      }
    },
    startBattle() {
      if (this.allies.length === 0) return;
      this.state = 'BATTLE';
      this.ui.battleButton.visible = false;
      this.spawnGoblinWave(5);
    },
    cycleSlot(slotIndex) {
      const slot = this.placementSlots[slotIndex];
      const blueprint = UnitCatalog[this.previewIndex % UnitCatalog.length];
      this.previewIndex += 1;
      const existing = this.allies.findIndex((unit) => unit.slotIndex === slotIndex);
      const unit = createUnitFromBlueprint(blueprint, slot.x, slot.y, 'ally');
      unit.slotIndex = slotIndex;
      if (existing >= 0) this.allies.splice(existing, 1, unit);
      else this.allies.push(unit);
    },
    applyDamage(target, amount, source) {
      if (!target) return;
      target.hp -= amount;
      this.damageNumbers.push(makeDamageNumber(target.x + target.width / 2, target.y, amount, source && source.side === 'ally' ? '#fef08a' : '#fca5a5'));
      this.camera.shake = Math.max(this.camera.shake, source && source.archetype.includes('knight') ? 10 : 5);
    },
    updateUnit(unit, opponents, dt) {
      if (!unit || opponents.length === 0) return;
      unit.cooldown -= dt;
      const target = opponents.reduce((best, candidate) => !best || distance(unit, candidate) < distance(unit, best) ? candidate : best, null);
      if (!target) return;
      const gap = distance(unit, target);
      if (gap > unit.range) {
        const dirX = ((target.x - unit.x) || 1) / gap;
        const dirY = ((target.y - unit.y) || 1) / gap;
        unit.x += dirX * unit.speed * dt * (unit.side === 'ally' ? 1 : -1);
        unit.y += dirY * unit.speed * dt * 0.4;
      } else if (unit.cooldown <= 0) {
        unit.cooldown = unit.attackRate;
        if (unit.aoe > 0) {
          opponents.forEach((candidate) => {
            if (distance(candidate, target) <= unit.aoe) this.applyDamage(candidate, unit.damage, unit);
          });
        } else if (unit.range > 120) {
          this.projectiles.push({
            x: unit.x + unit.width / 2,
            y: unit.y + unit.height / 2,
            tx: target.x + target.width / 2,
            ty: target.y + target.height / 2,
            damage: unit.damage,
            owner: unit.side,
            speed: unit.archetype.includes('archer') ? 520 : 360
          });
        } else {
          this.applyDamage(target, unit.damage, unit);
          target.x += unit.side === 'ally' ? unit.knockback : -unit.knockback;
        }
      }
    },
    updateProjectiles(dt) {
      this.projectiles = this.projectiles.filter((projectile) => {
        const dx = projectile.tx - projectile.x;
        const dy = projectile.ty - projectile.y;
        const dist = Math.hypot(dx, dy) || 1;
        projectile.x += (dx / dist) * projectile.speed * dt;
        projectile.y += (dy / dist) * projectile.speed * dt;
        const targets = projectile.owner === 'ally' ? this.enemies : this.allies;
        const hit = targets.find((target) => Math.hypot(projectile.x - (target.x + target.width / 2), projectile.y - (target.y + target.height / 2)) < target.width * 0.45);
        if (hit) {
          this.applyDamage(hit, projectile.damage, { side: projectile.owner, archetype: projectile.owner });
          return false;
        }
        return dist > 18;
      });
    },
    cleanupDead() {
      const removedEnemies = this.enemies.filter((unit) => unit.hp <= 0).length;
      if (removedEnemies > 0) this.score += removedEnemies * 10;
      this.allies = this.allies.filter((unit) => unit.hp > 0);
      this.enemies = this.enemies.filter((unit) => unit.hp > 0);
    },
    update(dt, time) {
      this.damageNumbers.forEach((item) => { item.y -= 42 * dt; item.life -= dt; });
      this.damageNumbers = this.damageNumbers.filter((item) => item.life > 0);
      this.camera.shake = Math.max(0, this.camera.shake - dt * gameRuntimeTuning.cameraShakeDecay);
      if (this.state !== 'BATTLE') return;
      this.battleTimer += dt;
      if (this.enemies.length < 3 && this.wave < 4) {
        this.wave += 1;
        this.spawnGoblinWave(3 + this.wave);
      }
      this.allies.forEach((unit) => this.updateUnit(unit, this.enemies, dt));
      this.enemies.forEach((unit) => this.updateUnit(unit, this.allies, dt));
      this.updateProjectiles(dt);
      this.cleanupDead();
      if (this.allies.length === 0) {
        this.state = 'RESULT';
        this.ui.battleButton.label = 'TRY AGAIN';
        this.ui.battleButton.visible = true;
      } else if (this.wave >= 4 && this.enemies.length === 0) {
        this.state = 'RESULT';
        this.ui.battleButton.label = 'REMATCH';
        this.ui.battleButton.visible = true;
      }
    },
    renderFallbackEntity(entity) {
      ctx.save();
      ctx.translate(entity.x - this.camera.x, entity.y - this.camera.y);
      ctx.fillStyle = entity.side === 'ally' ? '#f59e0b' : '#22c55e';
      if (entity.archetype && entity.archetype.includes('wizard')) ctx.fillStyle = '#a855f7';
      if (entity.archetype && entity.archetype.includes('archer')) ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 0, entity.width, entity.height);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, entity.width, entity.height);
      ctx.restore();
    },
    renderEntity(entity, time) {
      if (!entity || !entity.renderFn || !window.RenderEngine) return;
      const fn = window.RenderEngine[entity.renderFn];
      if (typeof fn === 'function' && !fn.__dreamstreamStub) {
        fn(ctx, entity.x - this.camera.x, entity.y - this.camera.y, entity.width, entity.height, time);
      } else {
        this.renderFallbackEntity(entity);
      }
    },
    drawArena() {
      const arenaTop = TOP_INSET + 118;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(SIDE_PAD, arenaTop, canvas.width - SIDE_PAD * 2, canvas.height - arenaTop - 36);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const x = SIDE_PAD + 30 + i * ((canvas.width - SIDE_PAD * 2 - 60) / 5);
        ctx.beginPath();
        ctx.moveTo(x, arenaTop);
        ctx.lineTo(x, canvas.height - 40);
        ctx.stroke();
      }
      ctx.restore();
    },
    drawPrepSlots() {
      if (this.state !== 'PREP') return;
      ctx.save();
      this.placementSlots.forEach((slot, index) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 3;
        ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '12px system-ui';
        ctx.fillText(String(index + 1), slot.x + 8, slot.y + 18);
      });
      ctx.restore();
    },
    drawBattleButton() {
      if (!this.ui.battleButton.visible) return;
      const b = this.ui.battleButton;
      ctx.save();
      ctx.fillStyle = '${specSheet.accentColor || '#ffd54a'}';
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 4;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 28px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    },
    drawDamageNumbers() {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui';
      this.damageNumbers.forEach((item) => {
        ctx.globalAlpha = clamp(item.life, 0, 1);
        ctx.fillStyle = item.color;
        ctx.fillText(String(item.value), item.x, item.y);
      });
      ctx.restore();
    },
    render(time) {
      const shakeX = (Math.random() - 0.5) * this.camera.shake;
      const shakeY = (Math.random() - 0.5) * this.camera.shake;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, this.camera.x || 0, this.camera.y || 0, time);
      this.drawArena();
      this.drawPrepSlots();
      this.allies.forEach((entity) => this.renderEntity(entity, time));
      this.enemies.forEach((entity) => this.renderEntity(entity, time));
      this.drawDamageNumbers();
      this.drawBattleButton();
      window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, this.score, this.health);
      ctx.restore();
    },
    handlePointerDown(x, y) {
      if (this.ui.battleButton.visible && pointInRect(x, y, this.ui.battleButton)) {
        if (this.state === 'PREP') this.startBattle();
        else this.resetPrep();
        return;
      }
      if (this.state !== 'PREP') return;
      const slotIndex = this.placementSlots.findIndex((slot) => pointInRect(x, y, slot));
      if (slotIndex >= 0) this.cycleSlot(slotIndex);
    },
    loop(now) {
      const dt = Math.min(0.033, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.update(dt, now / 1000);
      this.render(now / 1000);
      requestAnimationFrame(this.loop.bind(this));
    }
  };

  function renderFatal(error) {
    document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#7f1d1d;font-family:system-ui;">Boot error: ' + String(error && error.message || error) + '</div>';
  }

  try {
    game.resize();
    game.resetPrep();
    window.addEventListener('resize', () => game.resize());
    window.addEventListener('pointerdown', (event) => {
      game.pointer.down = true;
      game.pointer.x = event.clientX;
      game.pointer.y = event.clientY;
      game.handlePointerDown(event.clientX, event.clientY);
    });
    window.addEventListener('pointerup', () => { game.pointer.down = false; });
    game.render(0);
    requestAnimationFrame(game.loop.bind(game));
  } catch (error) {
    renderFatal(error);
  }
  </script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${specSheet.title}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--gametok-stage-bg, ${specSheet.backgroundColor || '#111111'});
      touch-action: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
      touch-action: none;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script>
  const DreamScaffold = ${safeScaffoldJson};
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const gameRuntimeTuning = {
    cameraShakeDecay: 12,
    scoreMultiplier: 1,
    healthMultiplier: 1
  };

  window.gametokEditable = window.gametokEditable || {
    images: [],
    music: [],
    colors: [
      { id: 'stage_bg', cssVar: '--gametok-stage-bg', value: '${specSheet.backgroundColor || '#111111'}' },
      { id: 'accent_color', value: '${specSheet.accentColor || '#ffd54a'}' }
    ],
    text: [
      { id: 'battle_button_label', value: 'BATTLE', path: 'game.ui.battleButton.label' }
    ],
    tune: [
      { id: 'camera_shake_decay', value: 12, path: 'gameRuntimeTuning.cameraShakeDecay' },
      { id: 'score_multiplier', value: 1, path: 'gameRuntimeTuning.scoreMultiplier' },
      { id: 'health_multiplier', value: 1, path: 'gameRuntimeTuning.healthMultiplier' }
    ],
    videos: [],
    sfx: []
  };
  window.gameRuntimeTuning = gameRuntimeTuning;
  document.documentElement.style.setProperty('--gametok-stage-bg', '${specSheet.backgroundColor || '#111111'}');

  const game = {
    state: DreamScaffold.initialState,
    stateFlow: DreamScaffold.stateFlow,
    camera: { x: 0, y: 0, shakeX: 0, shakeY: 0 },
    score: 0,
    health: 100,
    wave: 1,
    allies: [],
    enemies: [],
    projectiles: [],
    pickups: [],
    particles: [],
    damageNumbers: [],
    ui: {
      battleButton: { x: 0, y: 0, w: 184, h: 64, label: 'BATTLE', visible: true }
    },
    bootReady: false,
    pointer: { x: 0, y: 0, down: false },
    lastTime: 0,
    seedFirstFrame() {
      this.allies = [{
        type: '${firstEntity.id}',
        renderFn: '${firstEntity.renderFn}',
        x: 240,
        y: 500,
        width: ${firstEntity.width},
        height: ${firstEntity.height},
        hp: 100
      }];
      this.enemies = [{
        type: '${secondEntity.id}',
        renderFn: '${secondEntity.renderFn}',
        x: 820,
        y: 360,
        width: ${secondEntity.width},
        height: ${secondEntity.height},
        hp: 100
      }];
    },
    resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.ui.battleButton.x = canvas.width - this.ui.battleButton.w - 24;
      this.ui.battleButton.y = 24;
    },
    renderEntity(entity, time) {
      if (!entity || !entity.renderFn || !window.RenderEngine) return;
      const fn = window.RenderEngine[entity.renderFn];
      if (typeof fn === 'function') {
        fn(ctx, entity.x - this.camera.x, entity.y - this.camera.y, entity.width, entity.height, time);
      }
    },
    drawBattleButton() {
      if (!this.ui.battleButton.visible) return;
      const b = this.ui.battleButton;
      ctx.save();
      ctx.fillStyle = '${specSheet.accentColor || '#ffd54a'}';
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 4;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 28px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    },
    render(time) {
      window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, this.camera.x || 0, this.camera.y || 0, time);
      for (const entity of this.allies) this.renderEntity(entity, time);
      for (const entity of this.enemies) this.renderEntity(entity, time);
      this.drawBattleButton();
      window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, this.score * gameRuntimeTuning.scoreMultiplier, this.health * gameRuntimeTuning.healthMultiplier);
    },
    loop(now) {
      const time = now / 1000;
      const dt = Math.min(0.033, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.update(dt, time);
      this.render(time);
      requestAnimationFrame(this.loop.bind(this));
    },
    update(dt, time) {
      // TODO_ENGINE: Implement full state machine, input handling, combat, spawning, physics, and win/loss flow.
      // DreamScaffold.engineTodos:
      // ${engineTodos.join('\n      // ')}
      // DreamScaffold.interactionLoops:
      // ${interactionLoops.join('\n      // ')}
      // DreamScaffold.worldRules:
      // ${worldRules.join('\n      // ')}
    }
  };

  function renderFatal(error) {
    document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#7f1d1d;font-family:system-ui;">Boot error: ' + String(error && error.message || error) + '</div>';
  }

  try {
    game.resize();
    game.seedFirstFrame();
    window.addEventListener('resize', () => game.resize());
    window.addEventListener('pointerdown', (event) => {
      game.pointer.down = true;
      game.pointer.x = event.clientX;
      game.pointer.y = event.clientY;
    });
    window.addEventListener('pointerup', () => { game.pointer.down = false; });
    game.render(0);
    requestAnimationFrame(game.loop.bind(game));
  } catch (error) {
    renderFatal(error);
  }
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// MAIN DREAMSTREAM: Single-agent prototype prompt used by Claude Opus.
// ─────────────────────────────────────────────────────────

export function buildPhase2_BuildPrototype(specSheet, assetBundle = null, mediaAttachments = [], generatedAssets = null) {
  const isFirstPerson3D = specSheet.runtimeLane === 'first_person_threejs';
  const isThirdPerson3D = specSheet.runtimeLane === 'third_person_threejs';
  const isStoryHorrorVignette = specSheet.runtimeLane === 'story_horror_vignette';
  const isSimulationToybox = specSheet.runtimeLane === 'simulation_toybox';
  const isCockpitDriver = specSheet.controlRig === 'cockpit_driver';
  const isChaseCameraDriver = specSheet.controlRig === 'chase_camera_driver';
  const isThirdPersonJoystick = specSheet.controlRig === 'third_person_joystick';
  const isMoveAndFire = specSheet.controlRig === 'move_and_fire';
  const isLaneSwipeRunner = specSheet.controlRig === 'lane_swipe_runner';
  const isBinaryChoiceStory = specSheet.controlRig === 'binary_choice_story';
  const isDragDropToybox = specSheet.controlRig === 'drag_drop_toybox';
  const engineSpecBlock = buildEngineSpecBlock(specSheet);
  const assetKitBlock = buildAssetKitBlock(assetBundle);
  const aiAssetsBlock = buildAIAssetsBlock(generatedAssets);
  const userMediaBlock = buildUserMediaBlock(mediaAttachments);
  const capabilityBlock = buildCapabilityPromptBlock(specSheet.capabilities || []);
  const pixelArtRuleBlock = buildPixelArtRuleBlock(specSheet, specSheet.promptEcho || '');
  const engineSelectionRules = isFirstPerson3D || isThirdPerson3D
    ? `You MUST use THREE.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js) for this game.
- This is a hard requirement because the prompt/spec requires a real 3D experience.
- You MUST use THREE.WebGLRenderer and THREE.PerspectiveCamera.
- You MUST preserve the requested camera perspective. Do NOT downgrade to top-down, side-view, orthographic, or fake-2D.
- If you use provided self-hosted GLB models, you MAY additionally load GLTFLoader from the official Three.js examples CDN.`
    : `You MUST choose one of the following engines:
1. PHASER 3 WITH AUTO RENDERER (via CDN: https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js)
   - REQUIRED for: ALL 2D games (arcade, platformers, shooters, puzzles, etc.)
   - Loads PNG/sprite assets from URLs (use the provided asset kit!)
   - Has built-in physics, animations, particle systems
   - Use AUTO renderer: type: Phaser.AUTO
   - DO NOT use Canvas 2D - Phaser is better and uses our assets!
2. THREE.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js)
   - REQUIRED for: ALL 3D games (first-person, third-person, isometric 3D)
   - Loads GLB 3D models from URLs (use the provided 3D models!)
   - Use THREE.WebGLRenderer and THREE.PerspectiveCamera
3. DOM/CSS (Native HTML/CSS)
   - ONLY for: Text-heavy games (trivia, word games, visual novels, story games)
   - Can display images from URLs but no game physics

CRITICAL: DO NOT use native Canvas 2D (ctx.fillRect, ctx.arc, etc.) - it creates ugly procedural shapes.
ALWAYS use Phaser for 2D games or Three.js for 3D games so you can load our high-quality assets!`;

  const fullscreenRule = isFirstPerson3D || isThirdPerson3D
    ? `3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize events to update renderer size and camera aspect.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - Render a visible world immediately: floor/road, walls or landmarks, lighting, player/vehicle framing, and at least one objective, hazard, pickup, or enemy on the first frame.`
    : isStoryHorrorVignette
    ? `3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize cleanly and keep the focal text/choice area centered and readable on phones.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - The first frame must already look intentional: typography, atmospheric backing, and the primary prompt or object should be visible immediately.`
    : isSimulationToybox
    ? `3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize cleanly and keep the central machine/workbench readable on phones.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - The first frame must already show the central toybox object plus at least one source area or action area so the system reads immediately.`
    : `3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize events to update camera/canvas.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - ⚠️ MUST USE VIBRANT BACKGROUNDS: At the start of your draw loop, NEVER clear the screen with \`ctx.fillStyle = "black";\`. You MUST clear using \`ctx.clearRect(0, 0, canvas.width, canvas.height);\` so the vibrant CSS background color shows through!`;

  const cameraRule = isFirstPerson3D
    ? `4. WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - This must be a true first-person world, not a map view.
   - Keep the world compact but real: hallways, rooms, props, pickups, enemies, and an obvious goal.
   - The player's viewpoint is the camera. Add touch movement plus right-side drag look or similar mobile-friendly look controls.
   - Use perspective depth, collision-aware movement, and readable landmarks instead of faking 3D with flat sprites.`
    : isThirdPerson3D
    ? `4. THIRD-PERSON WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - This must be a true third-person/chase-camera 3D game, not a top-down map and not a first-person camera.
   - The player body or vehicle must be visible at all times, anchored in the lower third or center-lower frame.
   - Use a PerspectiveCamera that follows behind or over the shoulder of the player with smoothing.
   - Build a compact but real 3D world: road/arena floor, depth landmarks, hazards, pickups, enemies or traffic, and readable lighting.
   - Movement must visibly move the player/vehicle through the world while the camera follows.`
    : isStoryHorrorVignette
    ? `4. SCENE FRAMING & FOCAL COMPOSITION (CRITICAL):
   - This lane wins through staging, not world size.
   - Use a single strong focal area: note, question card, terminal prompt, dialogue block, or reveal object.
   - Negative space is welcome, but it must feel intentional. Support darkness with vignette, texture, gradients, haze, glow, or subtle motion.
   - Keep the scene phone-readable: do not bury the main text in tiny type or thin low-contrast UI.`
    : isSimulationToybox
    ? `4. SCENE FRAMING & FOCAL COMPOSITION (CRITICAL):
   - This lane wins through a readable workstation layout, not through giant world scale.
   - Use one strong central object: cauldron, machine, altar, kitchen station, crafting bench, lab table, or fusion core.
   - Source zones, control zones, and result zones must be visibly separate so the system feels understandable at a glance.
   - Keep the scene phone-readable: a player should know where to drag from, where to drop, and where to trigger the result within the first second.`
    : `4. WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - DO NOT trap the player in a single small screen box unless it's a puzzle game!
   - For RPGs, Survival, Shooters, and Platformers, the world MUST be massive or strictly infinite. 
   - You MUST implement a Camera System. In Canvas2D, calculate \`camera.x\` and \`camera.y\` to follow the player, and use \`ctx.save(); ctx.translate(-camera.x, -camera.y);\` before drawing the game world (and restore before drawing HUD).
   - Spawn enemies and environment objects dynamically across global world coordinates, not just the visible screen!`;

  const renderingRule = isFirstPerson3D
    ? `5. ENTITY RENDERING (ARTIST-CODER PROCEDURAL GRAPHICS + APPROVED ASSETS):
   - ⚠️ ABSOLUTELY NO THIRD-PARTY IMAGES OR TEXTURES. Do NOT load random remote sprites, PNGs, or material maps.
   - You SHOULD use the approved same-origin GameTok asset kit below, including .glb models, whenever it contains readable enemies, props, pickups, or landmark pieces.
   - Otherwise build your art procedurally with Three.js primitives, low-poly meshes, emissive materials, lighting, fog, and particle-like effects.
   - The hero description is: ${specSheet.entities?.hero || "Main player character"}
   - The enemy description is: ${specSheet.entities?.enemy || "Adversary or obstacle"}
   - Create a readable first-person weapon/hands or viewport cue so the player perspective feels embodied.
   - Environments must have depth: floor plane, walls, props, pickups, and at least one strong light source.
   - Prefer chunky, stylish geometry that reads well on mobile over ultra-detailed scenes.
   - Do not represent enemies or pickups as plain spheres, cubes, or colored blobs if the asset kit already includes a usable matching model or prop.`
    : isThirdPerson3D
    ? `5. THIRD-PERSON ENTITY RENDERING (PROCEDURAL 3D + APPROVED ASSETS):
   - ⚠️ ABSOLUTELY NO THIRD-PARTY IMAGES OR TEXTURES. Do NOT load random remote sprites, PNGs, or material maps.
   - You SHOULD use the approved same-origin GameTok asset kit below when it contains useful models, road/world props, pickups, hazards, UI, or audio.
   - The hero/vehicle description is: ${specSheet.entities?.hero || "Visible player avatar or vehicle"}
   - The enemy/hazard description is: ${specSheet.entities?.enemy || "Adversary, traffic, or obstacle"}
   - Always render a visible player body or vehicle with enough shape detail to read instantly.
   - Environments must have depth: floor/road plane, landmarks or walls, hazards, pickups/checkpoints, lighting, fog or atmosphere, and shadows where practical.
   - Prefer chunky, stylish low-poly geometry over tiny placeholder dots. If no asset fits, build the hero/vehicle from grouped Three.js meshes.`
    : isStoryHorrorVignette
    ? `5. SCENE RENDERING (TYPOGRAPHY + ATMOSPHERE FIRST):
   - This lane does NOT need a pile of sprites to feel complete.
   - Strong typography, spacing, paper/card panels, terminal framing, gradients, grain, vignette, and subtle motion are valid primary art here.
   - Use approved same-origin assets only if they clearly strengthen the fantasy. Do NOT dump random props into a minimal horror scene.
   - A dark scene must still feel designed. Support it with texture, glow falloff, shadow gradients, soft borders, motion, or reveal mechanics.
   - If you use buttons, cards, prompts, or notes, make them beautiful and deliberate rather than default browser rectangles.
   - One strong scene gimmick is better than ten weak decorations: folding note, unsettling survey prompt, flickering monitor, confession letter, breathing void, etc.`
    : isSimulationToybox
    ? `5. SCENE RENDERING (TOYBOX SYSTEM FIRST):
   - This lane does NOT need to simulate a giant world. It needs a delightful multi-zone workstation.
   - Use approved same-origin assets when they clearly fit the machine, ingredients, shelf, tools, or result reveal. Otherwise build the station procedurally with strong shapes, panels, trays, and effects.
   - Prioritize:
     - one strong central vessel or machine
     - readable ingredient/tool cards or pieces
     - clear source shelf/tray/pantry layout
     - a satisfying result card, modal, or transformed output
   - If you use buttons, combine controls, or recipe chips, make them feel like part of the toy, not generic app scaffolding.
   - Keep the number of systems small, but make every zone feel intentional and tactile.`
    : `5. ENTITY RENDERING (ARTIST-CODER GRAPHICS + APPROVED ASSETS):
   - ⚠️ ABSOLUTELY NO THIRD-PARTY IMAGES OR URLS. Do NOT attempt to load random external sprites, PNGs, or textures!
   - You SHOULD use the approved same-origin GameTok asset kit below for characters, props, backgrounds, controls, or audio whenever it contains a usable match.
   - ⚠️ NEVER USE EMOJIS OR UNICODE CHARACTERS. The device CANNOT render them — they show as broken boxes.
   - You MUST still act as an 'Artist-Coder'. Use the approved assets as your base kit, then layer procedural effects, particles, tinting, and HUD polish on top.
   - The hero description is: ${specSheet.entities?.hero || "Main player character"}
   - The enemy description is: ${specSheet.entities?.enemy || "Adversary or obstacle"}
   - 🔥 DO NOT DRAW BORING RECTANGLES OR BASIC CIRCLES AS HEROES OR ENEMIES WHEN A USABLE ASSET EXISTS IN THE ATTACHED KIT.
   - If you use sprite assets, preload them with Image() and draw them cleanly at readable sizes.
   - If the attached kit contains even a rough character/creature silhouette that fits the fantasy, use that asset before inventing a plain geometric placeholder.
   - Write custom generative, multi-layered Canvas drawing sequences for effects, particles, lighting, screen shake, HUD polish, and any missing entities. Use bezier curves, gradients, globalCompositeOperation, shadows, glowing effects, and paths.
   - Make it look Spectacular and match the game's theme perfectly.
   - Example abstract energetic procedural art:
     \`\`\`javascript
     function drawHero(ctx, x, y, width, height) {
         ctx.save();
         ctx.translate(x + width/2, y + height/2);
         const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, width);
         gradient.addColorStop(0, '#fff');
         gradient.addColorStop(1, '${specSheet.accentColor || '#f0f'}');
         ctx.fillStyle = gradient;
         ctx.shadowBlur = 15;
         ctx.shadowColor = '${specSheet.accentColor || '#f0f'}';
         ctx.beginPath();
         // ... (Write complex procedural paths here mapping your character's shape)
         ctx.arc(0, 0, width/2, 0, Math.PI * 2);
         ctx.fill();
         ctx.restore();
     }
     \`\`\`
   - Each entity type MUST be at least 30x30 pixels and visually distinct.`;

  const gameStateRule = isFirstPerson3D || isThirdPerson3D
    ? `7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
   - MENU: Show a readable title and TAP TO START overlay before entering the level.
   - You MUST transition from MENU to PLAYING with a \`pointerdown\` handler. Use this exact boot shape:
     \`window.addEventListener('pointerdown', () => { if (gameState === 'MENU') startGame(); });\`
   - Define a top-level \`startGame()\` function that hides the menu overlay, marks gameplay as active, and resumes audio if needed.
   - Do NOT rely on the \`click\` event for the start flow. It is unreliable in iOS WebViews.
   - If you render a start overlay, make the full overlay react to \`pointerdown\`, not a tiny HTML button.
   - PLAYING: ${isThirdPerson3D ? 'Third-person chase/follow camera action or driving loop.' : 'First-person exploration/combat loop.'}
   - GAMEOVER / WIN: Show the result and TAP TO RESTART.
   - Draw your HUD and touch controls as overlays without blocking the renderer.`
    : isStoryHorrorVignette
    ? `7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
   - INTRO: Show the prompt, note, question, or opening text immediately.
   - INTERACTION: Use large readable buttons or clearly taught gestures. If the scene uses YES/NO or CONTINUE, those controls must be visible and tappable.
   - REVEAL / ENDING: Transition the typography or focal object dramatically, then offer TAP TO RESTART or a clear replay affordance.
   - If you use overlays, let the full interactive area respond to \`pointerdown\` instead of relying on tiny hit targets.`
    : isSimulationToybox
    ? `7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
   - SETUP: Show the workstation, ingredient/tool source area, and central combine zone immediately.
   - INTERACTION: Let the player drag or tap ingredients/tools into the main zone using large readable targets.
   - REACTION / REVEAL: Trigger a visible mixing, cooking, crafting, or fusion phase, then show a satisfying result with replay affordance.
   - If you use overlays, modals, or reveal cards, keep them large, centered, and obviously interactive.`
    : `7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
   - MENU: Draw centered title and "TAP TO START" text directly on the Canvas.
   - You MUST transition from MENU to PLAYING state exactly like this:
     window.addEventListener('pointerdown', () => { if (gameState === 'MENU') gameState = 'PLAYING'; });
   - Do NOT create physical HTML <button> overlays. They block touches in iOS WebViews. Draw everything on the canvas and listen for a global screen tap!
   - PLAYING: Core gameplay.
   - GAMEOVER: Draw "${specSheet.gameOverTitle || 'GAME OVER'}", final score, "TAP TO RESTART".`;

  const starterArchitectureRule = isFirstPerson3D
    ? `9. FIRST-PERSON THREE.JS STARTER ARCHITECTURE (FOLLOW THIS SHAPE):
   - Your HTML should include:
     - a full-screen renderer mount
     - a HUD overlay
     - ${isCockpitDriver ? 'a steering control zone or wheel UI' : 'a left joystick zone'}
     - ${isCockpitDriver ? 'accelerate and brake controls' : 'a right-side look drag zone'}
     - ${isCockpitDriver ? 'dashboard or cockpit HUD instrumentation' : 'an attack/interact button if combat exists'}
   - Your JavaScript should roughly define:
     - scene, camera, renderer
     - player = { position, velocity, yaw, pitch, hp, gold${isCockpitDriver ? ', speed, steering, throttle, brake' : ''} }
     - input = { ${isCockpitDriver ? 'steer, throttle, brake' : 'moveX, moveY, lookX, lookY, attacking'} }
     - world = { walls: [], enemies: [], pickups: [] }
     - functions: buildWorld(), spawnEnemies(), updatePlayer(dt), updateEnemies(dt), collectPickups(), renderHud(), animate()
   - Keep geometry simple and low-poly: boxes, planes, cylinders, and spheres are enough.
   - The first frame must never be a flat blank field with only HUD text. buildWorld() must create at minimum: a floor plane, 4+ walls/cover pieces, 3+ enemies or targets when combat exists, 2+ pickups/landmarks, lighting/fog, and a weapon/hand/crosshair cue.
   - For zombie/FPS shooter prompts, enemies must be visible and damageable quickly, FIRE/SHOOT must spawn projectiles or raycast hits, and health/ammo must update from real collisions.
   - Add collision checks so the player cannot walk through walls.
   - Add visible lighting, fog, or emissive landmarks so the depth reads instantly.
   - Do NOT replace this with a top-down map, pseudo-3D raycast, or flat sprite maze.`
    : isThirdPerson3D
    ? `9. THIRD-PERSON THREE.JS STARTER ARCHITECTURE (FOLLOW THIS SHAPE):
   - Your HTML should include:
     - a full-screen renderer mount
     - a HUD overlay
     - ${isChaseCameraDriver ? 'accelerate, brake, and steering/drift controls' : 'a left joystick zone'}
     - ${isChaseCameraDriver ? 'speed/drift/checkpoint HUD instrumentation' : 'a large action/interact/attack button'}
   - Your JavaScript should roughly define:
     - scene, camera, renderer
     - player = { position, velocity, yaw, hp${isChaseCameraDriver ? ', speed, steering, throttle, brake' : ', actionCooldown'} }
     - input = { ${isChaseCameraDriver ? 'steer, throttle, brake, drift' : 'moveX, moveY, action'} }
     - world = { hazards: [], enemies: [], pickups: [], landmarks: [] }
     - functions: buildWorld(), updatePlayer(dt), updateCamera(dt), updateWorld(dt), resolveCollisions(), renderHud(), animate()
   - Build the visible player/vehicle from grouped meshes or same-origin models; never make the player an invisible camera.
   - The first frame must show: visible player/vehicle, floor/road/arena depth, at least 3 hazards/enemies/pickups/landmarks, lighting, and safe mobile controls.
   - Do NOT replace this with first-person, top-down, pseudo-3D raycast, or flat 2D lane art.`
    : '';

  const touchRigArchitectureRule = isMoveAndFire
    ? `9B. MOVE-AND-FIRE CONTROL SHELL (FOLLOW THIS SHAPE):
   - Your HTML/CSS should include:
     - a fixed left-side movement zone, thumbpad, or joystick ring
     - a fixed right-side fire control that reads immediately as ATTACK / FIRE / SHOOT
     - a HUD showing health plus at least one combat metric such as ammo, wave, combo, or score
   - Your JavaScript should roughly define:
     - player = { x, y, vx, vy, facing, hp, fireCooldown }
     - input = { moveX, moveY, firing, aimX, aimY }
     - world = { enemies: [], projectiles: [], pickups: [], impacts: [] }
     - functions: updatePlayer(dt), updateCombat(dt), spawnEnemyWave(), renderControls(), renderHud(), animate()
   - The fire control must create visible projectiles, pulses, slashes, or beam attacks.
   - Enemy hits must produce readable feedback such as flash, recoil, hit sparks, health drop, or death burst.
   - Keep the controls pinned and readable. Do NOT hide them behind tiny icons or gesture-only guessing.`
    : isLaneSwipeRunner
    ? `9B. LANE-SWIPE RUNNER CONTROL SHELL (FOLLOW THIS SHAPE):
   - Your HTML/CSS should include:
     - a wide playable track with clearly readable left/center/right lane structure
     - a minimal HUD with score plus distance/coins/chain or similar runner feedback
     - optional hint chips for SWIPE / JUMP / SLIDE if the fantasy benefits from onboarding
   - Your JavaScript should roughly define:
     - runner = { lane: 1, targetLane: 1, x, y, vy, isJumping, isSliding, speed }
     - input = { swipeX, swipeY, queuedAction }
     - world = { laneWidth, obstacles: [], pickups: [], scenery: [], scroll }
     - functions: updateRunner(dt), handleSwipe(action), spawnTrackChunk(), resolveLaneCollisions(), renderHud(), animate()
   - Forward motion must be automatic every frame.
   - Lane changes must snap or ease between discrete lanes. Do NOT turn this into free drag steering.
   - Obstacles and pickups should telegraph the intended path so the lane fantasy reads instantly.`
    : isBinaryChoiceStory
    ? `9B. STORY / HORROR VIGNETTE SHELL (FOLLOW THIS SHAPE):
   - Your HTML/CSS should include:
     - a full-screen atmospheric scene layer
     - one centered or intentionally offset focal prompt panel, note, terminal, or dialogue block
     - one or two large readable choice controls or a very clear continue/reveal control
     - a subtle ambient layer such as vignette, grain, breathing glow, dust, flicker, or drifting particles
   - Your JavaScript should roughly define:
     - state = { phase, selectedChoice, revealProgress, tension }
     - choices = [{ label, outcome }] or a similarly small branching structure
     - functions: renderScene(), advancePhase(), handleChoice(), updateAtmosphere(), restartExperience()
   - The scene should reach its first interesting interaction immediately.
   - Use timing, spacing, and state transitions to create dread instead of piling on mechanics.`
    : isDragDropToybox
    ? `9B. SIMULATION / TOYBOX SHELL (FOLLOW THIS SHAPE):
   - Your HTML/CSS should include:
     - one central workstation object or vessel
     - a source shelf, tray, pantry, toolbar, or card row for ingredients/tools
     - a visible action button or reaction trigger when the system is ready
     - a result reveal area, card, or modal
   - Your JavaScript should roughly define:
     - state = { selectedItems, phase, progress, result, canCombine }
     - ingredients = [...] or tools = [...]
     - functions: renderWorkbench(), addIngredient(), removeIngredient(), canTriggerCombine(), runReaction(), revealResult(), resetToybox()
   - The scene should support at least three readable zones:
     - source zone
     - interaction zone
     - result/reveal zone
   - Use drag-and-drop where it helps, but large tap-to-add controls are acceptable if they keep the toybox readable and satisfying.`
    : '';

  const controlRigRule = isCockpitDriver
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a cockpit-driving fantasy. Do NOT use a walking joystick + look pad as the main interaction.
   - The player must see dedicated driving controls such as:
     - steering wheel OR left/right steering pad
     - accelerate pedal/button
     - brake pedal/button
   - The HUD should feel like a vehicle dashboard: speed, gear/boost, or lane status are welcome.
   - The road/runway must react to steering and speed so the controls visibly matter.
   - Follow this implementation shape closely:
     - create a \`vehicle\` object with at least: \`speed\`, \`steering\`, \`throttle\`, \`brake\`, \`laneOffset\`
     - create an \`input\` object with at least: \`steer\`, \`throttle\`, \`brake\`
     - render visible DOM or canvas controls for steering + throttle + brake
     - draw cockpit/dashboard instrumentation in the foreground every frame
     - forward road motion must visibly change when throttle or brake is pressed
   - Good control labels include: STEER, ACCEL, BRAKE, BOOST, KM/H, RPM.
   - The scene should read like “I am driving this vehicle,” not “I am walking through a level with a car overlay.”`
    : isChaseCameraDriver
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a chase-camera driving fantasy. Do NOT use cockpit-only view, top-down view, or an invisible camera.
   - The player must see a visible vehicle in the lower third with a camera following behind it.
   - The player must see dedicated driving controls such as steering, accelerate, brake, and optional drift/boost.
   - Acceleration, braking, steering, and drift/boost must visibly affect the vehicle and road hazards immediately.
   - Good control labels include: STEER, ACCEL, BRAKE, DRIFT, BOOST, KM/H.`
    : isThirdPersonJoystick
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a third-person character/action fantasy. Do NOT use first-person view, top-down dots, or gesture-only guessing.
   - The player must see a visible hero controlled by a left joystick or movement pad.
   - The player must see a large action/interact/attack button when combat or interaction exists.
   - The follow camera must track behind or over the shoulder and keep enemies/objectives readable.`
    : isMoveAndFire
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a move-and-fire combat fantasy. Do NOT hide the controls or reduce it to a single tap-anywhere interaction.
   - The player must see:
     - a movement zone, drag pad, or virtual joystick
     - a clearly readable fire button or hold-to-fire control
   - The combat loop must visibly respond to that rig:
     - movement changes player position
     - fire control actually shoots, attacks, or emits projectiles
     - enemies react through hits, damage, knockback, or death
   - Follow this implementation shape closely:
     - create \`player\` state with movement, facing, and combat cooldown
     - create \`input\` state with movement + firing
     - create projectiles or attack events driven by the fire control
     - render the movement control and fire control in fixed visible screen positions
     - maintain enemy pressure so the player has a reason to move and shoot continuously
   - Good control labels include: FIRE, SHOOT, BLAST, ATTACK.
   - The scene should read like “I am controlling and attacking,” not “I tap random UI and things happen.”`
    : isLaneSwipeRunner
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a lane-swipe runner fantasy. Do NOT convert it into free steering or drag-movement movement.
   - The player must feel automatic forward motion with discrete lane decisions.
   - The build must support:
     - swipe left/right for lane changes
     - swipe up to jump
     - swipe down to slide when the lane needs it
   - Follow this implementation shape closely:
     - keep a fixed lane index or target lane
     - auto-advance the world or runner forward every frame
     - obstacles must occupy lanes clearly
     - coin lines or pickups should guide the best lane path
     - lane changes should be triggered by real swipe detection or clearly labeled left/right lane buttons if swipe fallback is needed
   - Good runner labels include: SWIPE, JUMP, SLIDE, BOOST, DISTANCE.
   - The scene should read like “I am threading lanes at speed,” not “I am dragging a character around a boxed map.”`
    : isBinaryChoiceStory
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a minimal story / horror vignette fantasy. Do NOT turn it into a generic arcade button field or an empty black screen with one forgotten label.
   - The player must see:
     - a clearly readable prompt, note, question, or reveal object
     - one or two deliberate interactive choices OR a clearly labeled continue/reveal interaction
   - The interaction loop must visibly respond to that rig:
     - tapping a choice changes the scene state, text, reveal, or atmosphere
     - the scene escalates, resolves, or reveals something instead of staying static
   - Follow this implementation shape closely:
     - create \`state\` with phases or beats
     - create visible choice controls or a reveal interaction
     - use typography and atmosphere as first-class parts of the feedback
     - make the dark space feel designed through texture, glow, vignette, or scene framing
   - Good labels include: YES, NO, OPEN, READ, CONTINUE, ANSWER, STAY, LEAVE.
   - The scene should read like “I am participating in an ominous interaction,” not “I am looking at a blank app mockup.”`
    : isDragDropToybox
    ? `CONTROL RIG (MANDATORY FOR THIS BUILD):
   - This prompt is a simulation / toybox fantasy. Do NOT flatten it into one generic button or one empty drag area.
   - The player must see:
     - a source shelf, tray, toolbar, or ingredient row
     - a clearly readable central combine / craft / cook / fusion zone
     - a trigger or readiness control when the recipe/state is valid
   - The interaction loop must visibly respond to that rig:
     - dragging or tapping items changes the workstation state
     - the central object reacts as items are added
     - the system reaches a visible reveal, result, or transformation state
   - Follow this implementation shape closely:
     - create \`state\` with selected items, phase, and result
     - create visible multi-zone UI for source, interaction, and reveal
     - make the central object the star of the scene
     - use reaction feedback such as bubbles, sparks, glow, shake, progress, or morphing
   - Good labels include: MIX, COMBINE, FUSE, COOK, BREW, REVEAL, RESET.
   - The scene should read like “I am operating a playful system,” not “I am tapping a menu with random props.”`
    : `CONTROL RIG:
   - Honor the requested control model: ${specSheet.controlModel || 'Simple touch-first interaction.'}
   - The on-screen controls should match the fantasy instead of defaulting to generic buttons.`;

  const mobileViewportRule = `4D. MOBILE VIEWPORT + GAMETOK CHROME SAFE BOUNDS CONTRACT (NON-NEGOTIABLE):
   - Target screen is a phone viewport around 390x844 CSS pixels, but your code must adapt to any viewport.
   - Define viewport dimensions from window.innerWidth / window.innerHeight or window.visualViewport when available. Do not hard-code desktop game dimensions such as 800x600, 1024x768, or fixed world-to-screen assumptions.
   - CSS must keep html, body, root containers, and the main canvas/renderer constrained to the phone: width: 100vw; height: 100dvh or 100vh fallback; margin: 0; overflow: hidden; touch-action: none.
   - IMPORTANT: GameTok previews and feeds may place native controls over the WebView. Treat the top 112px as reserved chrome and the bottom 48px as reserved chrome unless CSS env(safe-area-inset-*) gives larger values.
   - Define constants like SAFE_TOP = Math.max(112, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0) and SAFE_BOTTOM = Math.max(48, ...).
   - HUD, score, wave text, health, labels, menus, joysticks, fire buttons, and interactive controls must be clamped inside the playable safe rectangle: x 12..width-12, y SAFE_TOP..height-SAFE_BOTTOM.
   - Nothing important may render under the native top toolbar/status area. Do NOT draw score, lives, wave, pause, inventory, or powerups at y < SAFE_TOP.
   - Controls must be large enough for touch and pinned to safe areas, usually in the lower third above SAFE_BOTTOM. Never place controls partly outside the visible viewport.
   - Gameplay-critical entities visible on the first frame must be inside the visible camera/viewport, or intentionally in world coordinates that the camera can reach immediately. Do not spawn the player/objective off-screen.
   - Add a resize() function and call it immediately plus on resize/orientationchange. Resize the renderer/canvas AND recompute HUD/control positions.
   - Use a clamp(value, min, max) helper for screen-space positions. After any ctx.translate/world camera draw, restore the canvas transform before drawing HUD/controls.
   - The page must not create horizontal scrolling. documentElement.scrollWidth and body.scrollWidth should stay within the viewport width.`;

  return `You are an expert Creative Coder and Game Engine Specialist. Build a COMPLETE, POLISHED, PRODUCTION-QUALITY mobile game as a single HTML file.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Genre: ${specSheet.genre}
- Summary: ${specSheet.summary}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}
- Visual Style: ${specSheet.visualStyle}
- Atmosphere: ${specSheet.atmosphere}
- Pacing: ${specSheet.pacing}
- Runtime Lane: ${specSheet.runtimeLane || 'arcade_canvas'}
- Control Rig: ${specSheet.controlRig || 'generic_touch'}
- Preferred Engine: ${specSheet.preferredEngine || 'AUTO'}
- Perspective: ${specSheet.preferredPerspective || 'AUTO'}
- Camera Perspective: ${specSheet.cameraPerspective || 'AUTO'}
- Environment Type: ${specSheet.environmentType || 'ARENA'}
- Environment Scale: ${specSheet.environmentScale || 'scene_with_breathing_room'}
- Background Color: ${specSheet.backgroundColor}
- Accent Color: ${specSheet.accentColor}
- Capabilities: ${(specSheet.capabilities || []).map((capability) => capability.id).join(', ') || 'none'}

ENTITIES (use attached same-origin character/prop assets whenever possible; only fall back to procedural stand-ins if the kit truly has no usable match):
- Hero: ${specSheet.entities?.hero}
- Enemy: ${specSheet.entities?.enemy}
- Collectible: ${specSheet.entities?.collectible || 'none'}

UI LABELS:
- Score: "${specSheet.scoreLabel || 'SCORE'}"
- Health: "${specSheet.healthLabel || 'LIVES'}"
- Game Over: "${specSheet.gameOverTitle || 'GAME OVER'}"

DETERMINISTIC SEED: "${specSheet.seed || 'f9a2b7'}"
You MUST implement a seeded random number generator (PRNG) and use it for ALL procedural generation and gameplay randomness.

${assetKitBlock}

${aiAssetsBlock}

${userMediaBlock}

${pixelArtRuleBlock}

CAPABILITY GRAPH CONTRACT:
These capabilities are composable building blocks. They are not hard genre lanes. Implement all selected capabilities while preserving the user's original fantasy.
${capabilityBlock}

ENVIRONMENT + COMPOSITION TARGETS:
${formatPromptList(specSheet.compositionTargets, '- give the scene breathing room and a clear focal path')}

FIRST-FRAME CHECKLIST:
${formatPromptList(specSheet.firstFrameChecklist, '- show a readable focal object immediately')}

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════
${engineSelectionRules}

${engineSpecBlock}

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════

1. SINGLE FILE: Everything in ONE HTML document. You MAY use CDNs for Three.js or p5.js if chosen.
   - You MUST include <meta charset="UTF-8"> in the <head>.
   - You MUST define \`window.gametokEditable\` at top level using this shape:
     \`{ images: [], music: [], colors: [], text: [], tune: [], videos: [], sfx: [] }\`
   - If your game has editable strings, colors, asset URLs, or tunable numbers, register them in that object with \`selector\`, \`cssVar\`, or \`path\` fields so the host app can patch them later.

2. MOBILE-FIRST TOUCH CONTROLS (STRICT):
   - USE 'pointerdown', 'pointermove', 'pointerup' for universal touch/mouse support.
   - Add 'touch-action: none;' to your CSS for the body/canvas so iOS doesn't intercept the touches.
   - Attach your event listeners directly to the window or canvas (e.g. window.addEventListener('pointerdown', ...)).
   - Do NOT use the 'click' event. It is swallowed by iOS WebViews.

${fullscreenRule}

${cameraRule}

4B. ENVIRONMENT SCALE & FRAMING (CRITICAL):
   - The scene must feel intentionally composed for the lane, not trapped in a small accidental box.
   - Use horizon lines, depth cues, repeated structures, negative space, background layers, distant silhouettes, or room depth to make the world feel bigger than the immediate interaction zone.
   - If the lane is room-based, stage the room with clear foreground/midground/background depth instead of a flat boxed backdrop.
   - If the lane is a runner/platformer/flyer, the environment should imply continuation beyond the first screen.

4C. FIRST-FRAME READABILITY (CRITICAL):
   - The first rendered frame must already communicate the lane clearly before the player touches anything.
   - Every item in the FIRST-FRAME CHECKLIST above must be visible immediately when the game boots.
   - Do NOT hide the key focal object, controls, or lane-defining geometry behind delayed transitions, async loading emptiness, or a blank intro state.
   - If assets load later, render procedural placeholders or styled panels immediately so the first frame still feels authored.

${mobileViewportRule}

${renderingRule}

${controlRigRule}

6. HUD & UI:
   - Score: "${specSheet.scoreLabel || 'SCORE'}"
   - Health: "${specSheet.healthLabel || 'LIVES'}"
   - Use accent color (${specSheet.accentColor}).
   - High-contrast for readability on small screens.

${gameStateRule}

7. GAME FEEL / JUICE (MANDATORY):
   - Immersive screen shake / camera shake on impact.
   - Visual feedback for Every Action (flashes, tiny particles, scaling).
   - Sound: Use DreamAudio and DREAM_AUDIO_MANIFEST when available. Do NOT create oscillator/beep sounds.

8. ERROR HANDLING & LOGGING (CRITICAL FOR MOBILE):
   - Use try/catch blocks. Render error text on the screen if the engine fails to initialize.
   - DO NOT use console.log(), console.warn(), or console.error() inside the game loop (requestAnimationFrame). Spamming the console will CRASH the mobile wrapper.
   - Never log massive objects like 'window' or DOM events.

${starterArchitectureRule}

${touchRigArchitectureRule}

OUTPUT FORMAT:
Return ONLY the complete HTML code. Do NOT wrap in markdown. No explanation. Just raw HTML starting with <!DOCTYPE html>.`;
}

// ─────────────────────────────────────────────────────────
// EDIT PROMPT HELPER (kept for local experiments and legacy tooling)
// ─────────────────────────────────────────────────────────

export function buildPhase2_EditGame(engineCode, instructions, artistCode, mediaAttachments = []) {
  const userMediaBlock = buildUserMediaBlock(mediaAttachments);
  // If we have separate artist code, send both sections clearly labeled
  if (artistCode) {
    return `You are an expert HTML5 game developer. You are modifying an existing game that has TWO parts:

===SECTION 1: ARTIST CODE (Canvas drawing functions)===
${artistCode}

===SECTION 2: ENGINE CODE (Game HTML with physics, input, game loop)===
${engineCode}

USER WANTS: "${instructions}"

${userMediaBlock}

YOUR TASK:
- If the user wants to change visuals/characters/art → edit SECTION 1 (Artist Code)
- If the user wants to change gameplay/physics/positioning/controls → edit SECTION 2 (Engine Code)  
- If the user wants both → edit both sections

OUTPUT FORMAT (you MUST follow this exactly):
===ARTIST_CODE===
(output the complete artist code JavaScript here — the window.RenderEngine object)
===ENGINE_CODE===
(output the complete engine HTML here — starting with <!DOCTYPE html> and ending with </html>)

RULES:
1. Output BOTH sections every time, even if you only changed one. Copy the unchanged section exactly.
2. NEVER abbreviate, truncate, or use "..." or "// rest of code". Output EVERY line.
3. Do NOT wrap in markdown code blocks. Do NOT add explanation text.
4. The ENGINE_CODE section must start with <!DOCTYPE html> and end with </html>.
5. Preserve or improve any existing \`window.gametokEditable\` contract. Do not delete editable metadata unless the user explicitly asked to remove that feature.`;
  }

  // Fallback for legacy games without separate artist code
  return `You are an expert HTML5 game developer. You are modifying an existing game.

EXISTING GAME CODE:
${engineCode}

USER INSTRUCTIONS: "${instructions}"

${userMediaBlock}

RULES:
1. Apply ONLY the requested changes to the existing code.
2. CRITICAL: You MUST return the COMPLETE, FULL, UNABRIDGED modified HTML file.
3. NEVER abbreviate, truncate, or skip sections. NEVER write "..." or "// rest of code". Every single line must be present.
4. Keep everything that works — only change what the user asked for.
5. Start with <!DOCTYPE html> and end with </html>.
6. Do NOT wrap in markdown code blocks. Do NOT include explanation.
7. Preserve or improve any existing \`window.gametokEditable\` contract so the host app can still patch text, colors, media, and tuning values later.
8. Just output the raw HTML. Nothing else.`;
}


// ─────────────────────────────────────────────────────────
// POST-PROCESSING: Inject runtime diagnostics, Juice, and Audio
// into the raw HTML returned by the gameplay engineer
// ─────────────────────────────────────────────────────────

function buildGameTokEditableBridgeScript() {
  return `
    <script>
      (function() {
        var BRIDGE_ORIGIN = 'gametok_gaming_iframe_api';
        var EDITABLE_KEYS = ['images', 'music', 'colors', 'text', 'tune', 'videos', 'sfx'];

        function cloneEditableShape(source) {
          var editable = {};
          var input = source && typeof source === 'object' ? source : {};
          EDITABLE_KEYS.forEach(function(key) {
            editable[key] = Array.isArray(input[key]) ? input[key].map(function(item) {
              return item && typeof item === 'object' ? Object.assign({}, item) : item;
            }) : [];
          });
          return editable;
        }

        function normalizeMessage(data) {
          if (typeof data === 'string') {
            try {
              return JSON.parse(data);
            } catch (error) {
              return null;
            }
          }
          return data && typeof data === 'object' ? data : null;
        }

        function setNestedValue(root, path, value) {
          if (!root || !path) return;
          var parts = String(path).split('.');
          var cursor = root;
          for (var index = 0; index < parts.length - 1; index += 1) {
            var key = parts[index];
            if (!key) return;
            if (!cursor[key] || typeof cursor[key] !== 'object') {
              cursor[key] = {};
            }
            cursor = cursor[key];
          }
          cursor[parts[parts.length - 1]] = value;
        }

        function applySelectorValue(entry, applier) {
          if (!entry || !entry.selector) return;
          try {
            document.querySelectorAll(entry.selector).forEach(function(node) {
              applier(node, entry.value);
            });
          } catch (error) {}
        }

        function applyEditable(editable) {
          editable.colors.forEach(function(entry) {
            if (!entry) return;
            if (entry.cssVar) document.documentElement.style.setProperty(entry.cssVar, entry.value);
            if (entry.path) setNestedValue(window, entry.path, entry.value);
          });

          editable.text.forEach(function(entry) {
            if (!entry) return;
            if (entry.path) setNestedValue(window, entry.path, entry.value);
            applySelectorValue(entry, function(node, value) {
              var text = value == null ? '' : String(value);
              if ('value' in node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) node.value = text;
              else node.textContent = text;
            });
          });

          editable.images.forEach(function(entry) {
            if (!entry) return;
            if (entry.path) setNestedValue(window, entry.path, entry.value);
            applySelectorValue(entry, function(node, value) {
              if (node.tagName === 'IMG' || node.tagName === 'SOURCE') node.src = value || '';
              else if (node.tagName === 'VIDEO') node.poster = value || '';
              else node.style.backgroundImage = value ? 'url("' + value + '")' : '';
            });
          });

          editable.music.forEach(function(entry) {
            if (!entry) return;
            if (entry.path) setNestedValue(window, entry.path, entry.value);
            applySelectorValue(entry, function(node, value) {
              if ('src' in node) node.src = value || '';
            });
          });

          editable.videos.forEach(function(entry) {
            if (!entry) return;
            if (entry.path) setNestedValue(window, entry.path, entry.value);
            applySelectorValue(entry, function(node, value) {
              if ('src' in node) node.src = value || '';
            });
          });

          editable.sfx.forEach(function(entry) {
            if (entry && entry.path) setNestedValue(window, entry.path, entry.value);
          });

          editable.tune.forEach(function(entry) {
            if (entry && entry.path) setNestedValue(window, entry.path, entry.value);
          });
        }

        function postBridgeMessage(payload) {
          try {
            window.parent && window.parent.postMessage(payload, '*');
          } catch (error) {}

          try {
            if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }
          } catch (error) {}
        }

        var editable = cloneEditableShape(window.gametokEditable || window.sekaiEditable || window.__GAMETOK_EDITABLE__);

        function syncEditableReferences() {
          window.gametokEditable = editable;
          window.sekaiEditable = editable;
          window.__GAMETOK_EDITABLE__ = editable;
        }

        function emitEditableMetadata(taskId) {
          postBridgeMessage({
            origin: BRIDGE_ORIGIN,
            type: 'receive_editable_metadata',
            taskId: taskId || null,
            data: editable
          });
        }

        window.GameTokRuntime = Object.assign({}, window.GameTokRuntime, {
          bridgeOrigin: BRIDGE_ORIGIN,
          getEditableMetadata: function() {
            return editable;
          },
          setEditableMetadata: function(nextEditable, options) {
            editable = cloneEditableShape(nextEditable);
            syncEditableReferences();
            applyEditable(editable);
            if (!options || options.silent !== true) emitEditableMetadata(options && options.taskId);
            return editable;
          },
          applyEditablePatch: function(patch, options) {
            editable = cloneEditableShape(Object.assign({}, editable, patch || {}));
            syncEditableReferences();
            applyEditable(editable);
            if (!options || options.silent !== true) emitEditableMetadata(options && options.taskId);
            return editable;
          },
          requestEditableMetadata: emitEditableMetadata,
          send: function(type, data, extra) {
            postBridgeMessage(Object.assign({
              origin: BRIDGE_ORIGIN,
              type: type,
              data: data || {}
            }, extra || {}));
          }
        });

        syncEditableReferences();
        applyEditable(editable);

        window.addEventListener('message', function(event) {
          var message = normalizeMessage(event && event.data);
          if (!message) return;
          if (message.origin && message.origin !== BRIDGE_ORIGIN && message.origin !== 'sekai_gaming_iframe_api') return;

          if (message.type === 'request_editable_metadata') {
            emitEditableMetadata(message.taskId);
          } else if (message.type === 'receive_editable_patch' || message.type === 'set_editable_metadata') {
            window.GameTokRuntime.applyEditablePatch(message.data || {}, { silent: true });
            emitEditableMetadata(message.taskId);
          } else if (message.type === 'receive_editable_metadata') {
            window.GameTokRuntime.setEditableMetadata(message.data || {}, { silent: true });
          }
        });

        postBridgeMessage({
          origin: BRIDGE_ORIGIN,
          type: 'gametok_iframe_ready',
          data: { editableKeys: EDITABLE_KEYS }
        });
        emitEditableMetadata();
      })();
    </script>
  `;
}

function buildDreamAssetsScript(generatedAssets = null) {
  if (!generatedAssets || !generatedAssets.assets || Object.keys(generatedAssets.assets).length === 0) {
    return '';
  }

  const manifest = generatedAssets.manifest || { version: 1, assets: [] };
  const assetPack = Array.isArray(generatedAssets.assetPack)
    ? generatedAssets.assetPack
    : Object.entries(generatedAssets.assets).map(([key, url]) => ({
        key,
        type: 'image',
        url,
      }));
  const animations = generatedAssets.animations || {};
  const audio = generatedAssets.audio || { sfx: [], music: [] };
  const tilesets = generatedAssets.tilesets || [];
  const productionContract = generatedAssets.productionContract || manifest.productionContract || null;
  const payload = {
    assets: generatedAssets.assets,
    assetPack,
    manifest,
    animations,
    audio,
    tilesets,
    productionContract,
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `
    <script>
      (function() {
        var dreamAssetPayload = ${json};
        window.DREAM_ASSETS = dreamAssetPayload.assets || {};
        window.DREAM_ASSET_PACK = dreamAssetPayload.assetPack || [];
        window.DREAM_ASSET_MANIFEST = (dreamAssetPayload.manifest && dreamAssetPayload.manifest.makerAssetManifest) || dreamAssetPayload.manifest || { version: 1, assets: [] };
        (function installManifestArrayCompat() {
          var manifest = window.DREAM_ASSET_MANIFEST || { version: 1, assets: [] };
          var assets = [];
          if (Array.isArray(manifest)) {
            assets = manifest;
          } else if (Array.isArray(manifest.assets)) {
            assets = manifest.assets;
          } else if (manifest.assets && typeof manifest.assets === 'object') {
            assets = Object.keys(manifest.assets).map(function(key) {
              var asset = manifest.assets[key];
              return asset && typeof asset === 'object'
                ? Object.assign({ key: asset.key || key, id: asset.id || key }, asset)
                : { key: key, id: key, url: asset };
            });
          } else if (Array.isArray(window.DREAM_ASSET_PACK)) {
            assets = window.DREAM_ASSET_PACK;
          }
          if (!Array.isArray(manifest)) {
            if (!Array.isArray(manifest.assets)) manifest.assets = assets;
            ['find', 'filter', 'map', 'forEach', 'some', 'every', 'reduce'].forEach(function(method) {
              if (typeof manifest[method] === 'function' || typeof assets[method] !== 'function') return;
              manifest[method] = function() {
                return assets[method].apply(assets, arguments);
              };
            });
            if (typeof manifest.length !== 'number') manifest.length = assets.length;
            if (typeof Symbol !== 'undefined' && !manifest[Symbol.iterator]) {
              manifest[Symbol.iterator] = function() {
                var index = 0;
                return {
                  next: function() {
                    return index < assets.length
                      ? { value: assets[index++], done: false }
                      : { value: undefined, done: true };
                  }
                };
              };
            }
          }
          window.DREAM_ASSET_MANIFEST = manifest;
          window.DREAM_ASSET_LIST = assets;
        })();
        window.DREAM_ANIMATIONS = dreamAssetPayload.animations || {};
        window.DREAM_AUDIO_MANIFEST = dreamAssetPayload.audio || { sfx: [], music: [] };
        window.DREAM_TILESETS = dreamAssetPayload.tilesets || [];
        window.DREAM_PRODUCTION_CONTRACT = dreamAssetPayload.productionContract || (window.DREAM_ASSET_MANIFEST && window.DREAM_ASSET_MANIFEST.productionContract) || null;
        (function mirrorDreamAssetAliases() {
          var assets = window.DREAM_ASSETS || {};
          var pack = window.DREAM_ASSET_PACK || [];
          function assignAlias(alias, sourceKey) {
            if (!alias || !sourceKey || assets[alias]) return;
            if (!assets[sourceKey]) return;
            assets[alias] = assets[sourceKey];
          }
          function findBackgroundAsset() {
            return pack.find(function(asset) {
              if (!asset || !asset.key) return false;
              var role = String(asset.role || asset.category || '').toLowerCase();
              var type = String(asset.type || asset.assetType || '').toLowerCase();
              return type === 'background' || role === 'background' || role === 'environment';
            }) || pack.find(function(asset) {
              return asset && asset.key && /^background/i.test(String(asset.key));
            }) || null;
          }
          var backgroundAsset = findBackgroundAsset();
          if (backgroundAsset && backgroundAsset.key && assets[backgroundAsset.key]) {
            ['toybox_background', 'background', 'background1', 'environment', 'stage_background', 'game_background', 'arcade_background', 'simulation_background'].forEach(function(alias) {
              assignAlias(alias, backgroundAsset.key);
            });
          }
          var itemAssets = pack.filter(function(asset) {
            if (!asset || !asset.key) return false;
            var role = String(asset.role || asset.category || '').toLowerCase();
            return role === 'item' || /^item\\d+$/i.test(String(asset.key));
          }).sort(function(a, b) {
            return String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
          });
          itemAssets.forEach(function(asset, index) {
            assignAlias('item' + (index + 1), asset.key);
            assignAlias(asset.key, asset.key);
          });
          (window.DREAM_ASSET_MANIFEST && window.DREAM_ASSET_MANIFEST.slots || []).forEach(function(slot) {
            if (!slot || !slot.runtimeKey || !assets[slot.runtimeKey]) return;
            assignAlias(slot.id, slot.runtimeKey);
            assignAlias(slot.role, slot.runtimeKey);
          });
        })();
        window.__DREAM_ASSET_USAGE = window.__DREAM_ASSET_USAGE || { helperCalls: 0, usedKeys: {}, usedRoles: {}, preloadedKeys: {}, preloadedRoles: {}, renderedKeys: {}, renderedRoles: {}, usedAnimations: {}, usedTilesets: {} };
        window.__DREAM_ASSET_URL_TO_KEY = window.__DREAM_ASSET_URL_TO_KEY || {};
        (window.DREAM_ASSET_PACK || []).forEach(function(asset) {
          if (!asset || !asset.key || !window.DREAM_ASSETS || !window.DREAM_ASSETS[asset.key]) return;
          window.__DREAM_ASSET_URL_TO_KEY[window.DREAM_ASSETS[asset.key]] = asset.key;
        });
        function dreamAssetForKey(key) {
          return (window.DREAM_ASSET_PACK || []).find(function(item) {
            return item && (item.key === key || item.id === key);
          }) || null;
        }
        function dreamAssetForImage(image) {
          if (!image) return null;
          var key = image.__dreamAssetKey;
          if (!key && image.currentSrc) key = window.__DREAM_ASSET_URL_TO_KEY[image.currentSrc];
          if (!key && image.src) key = window.__DREAM_ASSET_URL_TO_KEY[image.src];
          return key ? dreamAssetForKey(key) || { key: key } : null;
        }
        function markDreamAssetUsage(key, role, usageKind) {
          try {
            window.__DREAM_ASSET_USAGE.helperCalls += 1;
            if (usageKind === 'preload') {
              if (key) window.__DREAM_ASSET_USAGE.preloadedKeys[key] = (window.__DREAM_ASSET_USAGE.preloadedKeys[key] || 0) + 1;
              if (role) window.__DREAM_ASSET_USAGE.preloadedRoles[role] = (window.__DREAM_ASSET_USAGE.preloadedRoles[role] || 0) + 1;
              return;
            }
            if (key) window.__DREAM_ASSET_USAGE.usedKeys[key] = (window.__DREAM_ASSET_USAGE.usedKeys[key] || 0) + 1;
            if (role) window.__DREAM_ASSET_USAGE.usedRoles[role] = (window.__DREAM_ASSET_USAGE.usedRoles[role] || 0) + 1;
            if (usageKind === 'render') {
              if (key) window.__DREAM_ASSET_USAGE.renderedKeys[key] = (window.__DREAM_ASSET_USAGE.renderedKeys[key] || 0) + 1;
              if (role) window.__DREAM_ASSET_USAGE.renderedRoles[role] = (window.__DREAM_ASSET_USAGE.renderedRoles[role] || 0) + 1;
            }
            if (usageKind === 'animation' && key) {
              window.__DREAM_ASSET_USAGE.usedAnimations[key] = (window.__DREAM_ASSET_USAGE.usedAnimations[key] || 0) + 1;
            }
            if (usageKind === 'tileset' && key) {
              window.__DREAM_ASSET_USAGE.usedTilesets[key] = (window.__DREAM_ASSET_USAGE.usedTilesets[key] || 0) + 1;
            }
          } catch (e) {}
        }
        function installCanvasRenderTracker() {
          try {
            if (window.__dreamCanvasRenderTrackerInstalled) return;
            window.__dreamCanvasRenderTrackerInstalled = true;
            var imageDescriptor = Object.getOwnPropertyDescriptor(Image.prototype, 'src')
              || Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
            if (imageDescriptor && imageDescriptor.set && imageDescriptor.get) {
              Object.defineProperty(Image.prototype, 'src', {
                configurable: true,
                enumerable: imageDescriptor.enumerable,
                get: function() { return imageDescriptor.get.call(this); },
                set: function(value) {
                  try {
                    var key = window.__DREAM_ASSET_URL_TO_KEY && window.__DREAM_ASSET_URL_TO_KEY[String(value || '')];
                    if (key) this.__dreamAssetKey = key;
                  } catch (e) {}
                  return imageDescriptor.set.call(this, value);
                }
              });
            }
            var originalDrawImage = CanvasRenderingContext2D && CanvasRenderingContext2D.prototype && CanvasRenderingContext2D.prototype.drawImage;
            if (originalDrawImage && !originalDrawImage.__dreamTracked) {
              var trackedDrawImage = function(image) {
                try {
                  var asset = dreamAssetForImage(image);
                  if (asset && asset.key) markDreamAssetUsage(asset.key, asset.role || asset.category, 'render');
                } catch (e) {}
                return originalDrawImage.apply(this, arguments);
              };
              trackedDrawImage.__dreamTracked = true;
              CanvasRenderingContext2D.prototype.drawImage = trackedDrawImage;
            }
          } catch (e) {}
        }
        function installPhaserRenderTracker() {
          try {
            if (!window.Phaser || window.__dreamPhaserRenderTrackerInstalled) return false;
            var factory = window.Phaser.GameObjects && window.Phaser.GameObjects.GameObjectFactory && window.Phaser.GameObjects.GameObjectFactory.prototype;
            if (!factory) return false;
            ['image', 'sprite', 'tileSprite'].forEach(function(methodName) {
              var original = factory[methodName];
              if (typeof original !== 'function' || original.__dreamTracked) return;
              var tracked = function(x, y, key) {
                var result = original.apply(this, arguments);
                try {
                  var asset = dreamAssetForKey(key);
                  if (asset && asset.key) markDreamAssetUsage(asset.key, asset.role || asset.category, 'render');
                } catch (e) {}
                return result;
              };
              tracked.__dreamTracked = true;
              factory[methodName] = tracked;
            });
            window.__dreamPhaserRenderTrackerInstalled = true;
            return true;
          } catch (e) {
            return false;
          }
        }
        installCanvasRenderTracker();
        var phaserTrackerTimer = setInterval(function() {
          if (installPhaserRenderTracker()) clearInterval(phaserTrackerTimer);
        }, 25);
        setTimeout(function() { try { clearInterval(phaserTrackerTimer); } catch (e) {} }, 5000);
        window.__dreamAudioQueue = window.__dreamAudioQueue || [];
        window.DreamAudio = window.DreamAudio || {
          unlock: function() {},
          play: function(key) { window.__dreamAudioQueue.push(['play', key]); },
          startMusic: function(key) { window.__dreamAudioQueue.push(['startMusic', key]); },
          ensureBackgroundMusic: function() { window.__dreamAudioQueue.push(['startMusic']); },
          isMusicPlaying: function() { return false; },
          getManifest: function() { return window.DREAM_AUDIO_MANIFEST || { sfx: [], music: [] }; }
        };
        window.playDreamSound = window.playDreamSound || function(key) { window.DreamAudio.play(key); };
        window.DreamAssets = window.DreamAssets || {
          markRendered: function(key, role) {
            markDreamAssetUsage(key, role, 'render');
            return true;
          },
          getImage: function(key) {
            var asset = (window.DREAM_ASSET_PACK || []).find(function(item) {
              return item && (item.key === key || item.id === key);
            });
            markDreamAssetUsage(key, asset && (asset.role || asset.category));
            return window.DREAM_ASSETS && window.DREAM_ASSETS[key];
          },
          loadImageElement: function(keyOrRole) {
            var asset = (window.DREAM_ASSETS || {})[keyOrRole] ? { key: keyOrRole } : (this.firstByRole(keyOrRole) || this.get(keyOrRole));
            var key = asset && asset.key ? asset.key : keyOrRole;
            var dataUrl = this.getImage(key);
            if (!dataUrl) return Promise.resolve(null);
            window.DREAM_IMAGES = window.DREAM_IMAGES || {};
            if (window.DREAM_IMAGES[key]) return Promise.resolve(window.DREAM_IMAGES[key]);
            return new Promise(function(resolve) {
              var img = new Image();
              img.onload = function() {
                window.DREAM_IMAGES[key] = img;
                if (asset && (asset.role || asset.category)) window.DREAM_IMAGES[asset.role || asset.category] = img;
                markDreamAssetUsage(key, asset && (asset.role || asset.category), 'preload');
                resolve(img);
              };
              img.onerror = function() { resolve(null); };
              img.src = dataUrl;
            });
          },
          get: function(key) {
            return (window.DREAM_ASSET_PACK || []).find(function(asset) {
              return asset.key === key || asset.id === key;
            }) || null;
          },
          getPack: function(type) {
            var pack = window.DREAM_ASSET_PACK || [];
            return type ? pack.filter(function(asset) { return asset.type === type; }) : pack;
          },
          findByRole: function(role) {
            return (window.DREAM_ASSET_PACK || []).filter(function(asset) {
              return asset.role === role || asset.category === role;
            });
          },
          firstByRole: function(role) {
            return this.findByRole(role)[0] || null;
          },
          preloadPhaser: function(scene) {
            if (!scene || !scene.load) return [];
            var loaded = [];
            var assets = window.DREAM_ASSETS || {};
            (window.DREAM_ASSET_PACK || []).forEach(function(asset) {
              if (asset.type !== 'image' || !asset.key || !assets[asset.key]) return;
              try {
                scene.load.image(asset.key, assets[asset.key]);
                markDreamAssetUsage(asset.key, asset.role || asset.category, 'preload');
                loaded.push(asset.key);
              } catch (e) {}
            });
            return loaded;
          },
          scaleToFit: function(displayObject, maxW, maxH, upscaleLimit) {
            if (!displayObject) return displayObject;
            var width = displayObject.width || displayObject.displayWidth || 1;
            var height = displayObject.height || displayObject.displayHeight || 1;
            var scale = Math.min(maxW / width, maxH / height);
            if (Number.isFinite(upscaleLimit)) scale = Math.min(scale, upscaleLimit);
            if (!Number.isFinite(scale) || scale <= 0) scale = 1;
            if (typeof displayObject.setScale === 'function') displayObject.setScale(scale);
            else {
              displayObject.scaleX = scale;
              displayObject.scaleY = scale;
            }
            return displayObject;
          },
          addSprite: function(scene, keyOrRole, x, y, options) {
            if (!scene || !scene.add) return null;
            var opts = options || {};
            var asset = (window.DREAM_ASSETS || {})[keyOrRole] ? { key: keyOrRole } : this.firstByRole(keyOrRole);
            var key = asset && asset.key ? asset.key : keyOrRole;
            if (!(window.DREAM_ASSETS || {})[key]) return null;
            var sprite = scene.add.sprite(x, y, key);
            markDreamAssetUsage(key, asset && (asset.role || asset.category) || keyOrRole, 'render');
            if (opts.depth !== undefined && sprite.setDepth) sprite.setDepth(opts.depth);
            if (opts.maxW || opts.maxH) this.scaleToFit(sprite, opts.maxW || 96, opts.maxH || 96, opts.upscaleLimit || 1.5);
            if (opts.origin && sprite.setOrigin) sprite.setOrigin(opts.origin[0], opts.origin[1]);
            return sprite;
          },
          addBackgroundCover: function(scene, keyOrRole, width, height) {
            if (!scene || !scene.add) return null;
            var asset = (window.DREAM_ASSETS || {})[keyOrRole] ? { key: keyOrRole } : (this.firstByRole('background') || this.firstByRole('environment'));
            var key = asset && asset.key ? asset.key : keyOrRole;
            if (!(window.DREAM_ASSETS || {})[key]) return null;
            var bg = scene.add.image(width / 2, height / 2, key);
            markDreamAssetUsage(key, asset && (asset.role || asset.category) || keyOrRole, 'render');
            var scale = Math.max(width / Math.max(bg.width || 1, 1), height / Math.max(bg.height || 1, 1));
            if (bg.setScale) bg.setScale(scale);
            if (bg.setDepth) bg.setDepth(-100);
            return bg;
          },
          safeRect: function(width, height) {
            width = width || window.innerWidth || 390;
            height = height || window.innerHeight || 844;
            var contract = window.DREAM_PRODUCTION_CONTRACT || {};
            var screen = contract.screen || {};
            var top = Math.max(Number(screen.safeTopPx || 112), Number(window.__GAMETOK_SAFE_TOP || 0));
            var bottom = Math.max(Number(screen.safeBottomPx || 48), Number(window.__GAMETOK_SAFE_BOTTOM || 0));
            return { x: 12, y: top, width: Math.max(1, width - 24), height: Math.max(1, height - top - bottom), top: top, bottom: bottom };
          },
          productionContract: function() {
            return window.DREAM_PRODUCTION_CONTRACT || null;
          },
          acceptanceChecklist: function() {
            var contract = window.DREAM_PRODUCTION_CONTRACT || {};
            return {
              firstFrame: contract.firstFrameAcceptance || [],
              gameplay: contract.gameplayAcceptance || []
            };
          },
          animationsFor: function(sourceKey) {
            return (window.DREAM_ANIMATIONS || []).filter(function(animation) {
              return animation.sourceKey === sourceKey || animation.role === sourceKey || animation.key === sourceKey;
            });
          },
          getTileset: function(key) {
            var tilesets = window.DREAM_TILESETS || [];
            var tileset = tilesets.find(function(item) {
              return item && (item.key === key || item.sheetKey === key || item.imageKey === key);
            }) || null;
            if (tileset && tileset.imageKey) markDreamAssetUsage(tileset.imageKey, tileset.role || 'tileset', 'tileset');
            return tileset;
          },
          firstTileset: function() {
            var tileset = (window.DREAM_TILESETS || [])[0] || null;
            if (tileset && tileset.imageKey) markDreamAssetUsage(tileset.imageKey, tileset.role || 'tileset', 'tileset');
            return tileset;
          },
          createAnimations: function(scene) {
            if (!scene || !scene.anims) return [];
            var created = [];
            var animations = window.DREAM_ANIMATIONS || [];
            animations.forEach(function(animation) {
              if (!animation || animation.type !== 'frame_sequence' || !animation.key || !Array.isArray(animation.frames) || animation.frames.length === 0) return;
              try {
                if (scene.anims.exists && scene.anims.exists(animation.key)) return;
                var frames = animation.frames
                  .filter(function(key) { return scene.textures && scene.textures.exists && scene.textures.exists(key); })
                  .map(function(key) { return { key: key }; });
                if (frames.length === 0) return;
                scene.anims.create({
                  key: animation.key,
                  frames: frames,
                  frameRate: animation.frameRate || 6,
                  repeat: animation.repeat === undefined ? -1 : animation.repeat
                });
                markDreamAssetUsage(animation.key, animation.role || 'animation', 'animation');
                frames.forEach(function(frame) { markDreamAssetUsage(frame.key, animation.role || 'animation'); });
                created.push(animation.key);
              } catch (e) {}
            });
            return created;
          },
          applyTween: function(scene, target, animationKey) {
            if (!scene || !scene.tweens || !target) return null;
            var animations = window.DREAM_ANIMATIONS || [];
            var animation = animations.find(function(item) {
              return item.key === animationKey || item.sourceKey === animationKey || item.role === animationKey;
            }) || {};
            if (animation.key) markDreamAssetUsage(animation.key, animation.role || 'animation', 'animation');
            var text = [animation.key, animation.role, (animation.states || []).join(' '), animation.implementation].join(' ').toLowerCase();
            var tweenConfig;
            if (/dash|move|whoosh|trail/.test(text)) {
              tweenConfig = { scaleX: 1.08, scaleY: 0.92, duration: 110, yoyo: true, ease: 'Sine.easeOut' };
            } else if (/hit|defeat|flash|impact/.test(text)) {
              tweenConfig = { alpha: 0.55, scale: 1.15, duration: 80, yoyo: true, ease: 'Quad.easeOut' };
            } else {
              tweenConfig = { y: target.y - 4, scaleX: 1.03, scaleY: 0.97, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' };
            }
            return scene.tweens.add(Object.assign({ targets: target }, tweenConfig));
          }
        };
      })();
    </script>
  `;
}

export function postProcessRawHtml(rawHtml, generatedAssets = null, options = {}) {
  const minimalRuntime = Boolean(options?.minimalRuntime);
  const runtimeOverlayScript = `
    <script>
      (function() {
        function isStartLikeLabel(text) {
          var normalized = String(text || '').trim().toLowerCase();
          if (!normalized) return false;
          return normalized.includes('start') ||
            normalized.includes('play') ||
            normalized.includes('begin') ||
            normalized.includes('tap to start') ||
            normalized.includes('enter');
        }

        function rescueStartInteraction(target) {
          if (!target || target.__dreamstreamStartBound) return;
          target.__dreamstreamStartBound = true;
          target.style.touchAction = target.style.touchAction || 'none';
          target.addEventListener('pointerdown', function(event) {
            try { event.preventDefault(); } catch (e) {}
            try { event.stopPropagation(); } catch (e) {}
            try {
              if (typeof window.startGame === 'function') {
                window.startGame();
              } else if (typeof window.start === 'function') {
                window.start();
              } else if (typeof target.onclick === 'function') {
                target.onclick(event);
              } else if (typeof target.click === 'function') {
                target.click();
              }
            } catch (e) {}
          }, { passive: false });
        }

        function bindStartTargets() {
          try {
            var candidates = Array.from(document.querySelectorAll('button, [role="button"], [onclick], #start, #start-button, #start-btn, #overlay, #menu, .start, .start-button, .start-btn, .overlay'));
            candidates.forEach(function(el) {
              var text = [el.innerText, el.textContent, el.getAttribute && el.getAttribute('aria-label')].filter(Boolean).join(' ');
              if (isStartLikeLabel(text) || /start|play|begin|tap/i.test(el.id || '') || /start|play|begin|tap/i.test(el.className || '')) {
                rescueStartInteraction(el);
              }
            });
          } catch (e) {}
        }

        function reportRuntimeIssue(kind, detail) {
          try {
            var existing = document.getElementById('__dreamstream_runtime_error');
            if (!existing) {
              existing = document.createElement('div');
              existing.id = '__dreamstream_runtime_error';
              existing.style.position = 'fixed';
              existing.style.left = '12px';
              existing.style.right = '12px';
              existing.style.top = '12px';
              existing.style.zIndex = '999999';
              existing.style.padding = '14px 16px';
              existing.style.borderRadius = '16px';
              existing.style.background = 'rgba(127, 29, 29, 0.96)';
              existing.style.color = '#fff';
              existing.style.fontFamily = 'system-ui, -apple-system, sans-serif';
              existing.style.fontSize = '13px';
              existing.style.lineHeight = '1.45';
              existing.style.whiteSpace = 'pre-wrap';
              existing.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)';
              document.body.appendChild(existing);
            }
            existing.textContent = kind + "\\n\\n" + String(detail || 'Unknown runtime failure');
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'RUNTIME_ERROR',
                kind: kind,
                detail: String(detail || 'Unknown runtime failure')
              }));
            }
          } catch (e) {}
        }

        window.addEventListener('error', function(event) {
          reportRuntimeIssue('DreamStream runtime error', event && event.message ? event.message : 'Unknown script error');
        });

        window.addEventListener('unhandledrejection', function(event) {
          var reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'Unknown promise rejection';
          reportRuntimeIssue('DreamStream async error', reason);
        });

        function blockExternalNavigation(url) {
          try {
            if (!url) return false;
            var parsed = new URL(String(url), window.location.href);
            if (parsed.protocol === 'about:' || parsed.protocol === 'blob:' || parsed.protocol === 'data:') return false;
            return parsed.origin !== window.location.origin;
          } catch (e) {
            return false;
          }
        }

        try {
          var originalOpen = window.open;
          window.open = function(url) {
            if (blockExternalNavigation(url)) {
              reportRuntimeIssue('DreamStream blocked navigation', 'Generated game tried to open external URL: ' + url);
              return null;
            }
            return originalOpen ? originalOpen.apply(window, arguments) : null;
          };
        } catch (e) {}

        document.addEventListener('click', function(event) {
          try {
            var node = event.target;
            while (node && node !== document.body) {
              if (node.tagName === 'A' && blockExternalNavigation(node.href)) {
                event.preventDefault();
                event.stopPropagation();
                reportRuntimeIssue('DreamStream blocked navigation', 'Generated game tried to leave the playable preview: ' + node.href);
                return false;
              }
              node = node.parentNode;
            }
          } catch (e) {}
        }, true);

        bindStartTargets();
        window.addEventListener('load', function() {
          bindStartTargets();
          setTimeout(bindStartTargets, 400);
        });

        window.addEventListener('load', function() {
          setTimeout(function() {
            try {
              var canvas = document.querySelector('canvas');
              if (!canvas) {
                reportRuntimeIssue('DreamStream boot warning', 'No canvas element was rendered after load. The generated game likely failed during initialization.');
              }
            } catch (e) {}
          }, 2500);
        });
      })();
    </script>
  `;

  // Inject Juice Engine
  let juiceScript = '';
  try {
    if (minimalRuntime) {
      juiceScript = '';
    } else {
    const juicePath = path.join(__dirname, 'juice.js');
    const juiceCode = fs.readFileSync(juicePath, 'utf8');
    juiceScript = '<script>' + juiceCode + '</script>';
    }
  } catch (e) {
    console.error('Failed to load juice.js:', e);
  }

  // Inject Audio Engine
  let audioScript = '';
  try {
    if (minimalRuntime) {
      audioScript = '';
    } else {
    const audioPath = path.join(__dirname, 'audio.js');
    const audioCode = fs.readFileSync(audioPath, 'utf8');
    audioScript = '<script>' + audioCode + '</script>';
    }
  } catch (e) {
    console.error('Failed to load audio.js:', e);
  }

  const editableBridgeScript = minimalRuntime ? '' : buildGameTokEditableBridgeScript();
  const dreamAssetsScript = buildDreamAssetsScript(generatedAssets);

  if (dreamAssetsScript) {
    if (rawHtml.includes('<head>')) {
      rawHtml = rawHtml.replace('<head>', '<head>' + dreamAssetsScript);
    } else if (rawHtml.toLowerCase().includes('<html>')) {
      rawHtml = rawHtml.replace(/<html>/i, '<html><head>' + dreamAssetsScript + '</head>');
    } else {
      rawHtml = dreamAssetsScript + rawHtml;
    }
  }

  // Inject right before </body> or at end
  const runtimeScripts = minimalRuntime ? '' : (editableBridgeScript + runtimeOverlayScript + juiceScript + audioScript);
  if (rawHtml.includes('</body>')) {
    rawHtml = rawHtml.replace('</body>', runtimeScripts + '</body>');
  } else {
    rawHtml += runtimeScripts;
  }

  // Force inject essential mobile metas and strict no-selection CSS
  const metaTags = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <style>
      * {
        -webkit-touch-callout: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      body, html {
        touch-action: none;
        overflow: hidden;
      }
    </style>
  `;

  if (rawHtml.includes('<head>')) {
    rawHtml = rawHtml.replace('<head>', '<head>' + metaTags);
  } else if (rawHtml.toLowerCase().includes('<html>')) {
    rawHtml = rawHtml.replace(/<html>/i, '<html><head>' + metaTags + '</head>');
  } else {
    rawHtml = metaTags + rawHtml;
  }

  return rawHtml;
}

// ─────────────────────────────────────────────────────────
// PHASE 2A: ARTIST-CODER (Dedicated Art Generation)
// ─────────────────────────────────────────────────────────
export function buildPhase2A_Artist(specSheet, scaffold) {
  const scaffoldJson = JSON.stringify(scaffold || {}, null, 2);
  return `You are a world-class procedural artist who creates stunning visuals using ONLY Canvas2D JavaScript.
Your job: write a \`window.RenderEngine\` object with drawing functions for a game.
You must NOT write game loops, physics, input handling, or HTML. ONLY drawing code.

GAME CONTEXT:
- Title: "${specSheet.title}"
- Visual Style: ${specSheet.visualStyle}
- Atmosphere: ${specSheet.atmosphere}
- Accent Color: ${specSheet.accentColor || '#f0f'}
- Hero: ${specSheet.entities?.hero || 'Main player character'}
- Enemy: ${specSheet.entities?.enemy || 'Adversary or obstacle'}
- Runtime Lane: ${specSheet.runtimeLane || 'arcade_canvas'}
- Playable Slice: ${specSheet.playableSlice || 'One compact mobile game scene.'}
- Scene Blueprint: ${specSheet.sceneBlueprint || 'A readable stage with one hero and one threat type.'}

SHARED SCAFFOLD CONTRACT:
${scaffoldJson}

VISUAL TARGETS:
${formatPromptList(specSheet.visualTargets, '- clean readable silhouettes')}

SPECTACLE FOCUS:
${formatPromptList(specSheet.spectacleFocus, '- subtle particles and impact flashes')}

MANDATORY CANVAS2D TECHNIQUES:
- Use advanced techniques matching the atmosphere (e.g. ctx.createLinearGradient or ctx.createRadialGradient for rich color fills if needed).
- Use ctx.shadowBlur + ctx.shadowColor ONLY if the game's theme requires glowing/magic/neon/energy. If it's a dark or flat cartoon game, use solid strokes or flat shading instead.
- Use ctx.globalCompositeOperation wisely. Don't use 'lighter' unless making neon/fire/magic effects.
- ctx.save() / ctx.restore() + ctx.translate + ctx.rotate for sub-parts (limbs, wings, turrets).
- Math.sin(time) and Math.cos(time) for idle animations (breathing, bobbing, pulsing).
- Build complex figures from 5+ primitives (do not just use a single shape).

QUALITY RULES:
- Each draw function must use AT LEAST 15 lines of Canvas calls. Simple rectangles or circles alone = FAILURE.
- The hero should look like a recognizable character with body parts, not a blob.
- The enemy must look visually distinct from the hero.
- The background must have depth (layers: far sky/gradient → mid-ground details → near-ground texture) that fits the user's requested Atmosphere.
- Strictly adhere to the requested Visual Style (${specSheet.visualStyle}) and Atmosphere (${specSheet.atmosphere}).
- Every requested function in renderManifest must actually exist on window.RenderEngine.
- Prefer resilient stylized silhouettes and readable shapes over ultra-complex art that is likely to break.
- The shared scaffold shell will call your functions on frame zero, so drawBackground and drawHUD must be safe and deterministic immediately.

API CONTRACT — output ONLY this JavaScript object, nothing else:

window.RenderEngine = {
${(specSheet.renderManifest && specSheet.renderManifest.length > 0 ? specSheet.renderManifest : ['drawHero', 'drawEnemy', 'drawObstacle', 'drawProjectile', 'drawPickup', 'drawParticle']).map(fnName => `    ${fnName}: function(ctx, x, y, w, h, time) {\n        // REQUIRED: Fully generative canvas drawing sequence for ${fnName}\n    }`).join(',\n')}
    ,
    drawBackground: function(ctx, width, height, scrollX, scrollY, time) {
        // REQUIRED: Multi-layer parallax background. At least 3 depth layers.
        // scrollX/scrollY = camera offset for parallax. time = animation.
    },
    drawHUD: function(ctx, width, height, score, health) {
        // REQUIRED: Heads-up display with score text + health bar + stylized frame.
    }
};

OUTPUT ONLY THE JAVASCRIPT OBJECT. No markdown fences. No explanation. No HTML.`;
}

// ─────────────────────────────────────────────────────────
// PHASE 2B: ENGINEER-CODER (Dedicated Physics/Logic)
// ─────────────────────────────────────────────────────────
export function buildPhase2B_Engineer(specSheet, generatedArtistCode, scaffold, scaffoldShell) {
  // Extract the exact function names the Artist actually generated to prevent name mismatches
  const exactFunctions = [];
  const regex = /draw[A-Z][a-zA-Z0-9_]+/g;
  let match;
  while ((match = regex.exec(generatedArtistCode)) !== null) {
      if (!exactFunctions.includes(match[0]) && match[0] !== 'drawBackground' && match[0] !== 'drawHUD') {
          exactFunctions.push(match[0]);
      }
  }
  // Dedup and fallback
  let parsedManifest = exactFunctions.length > 0 ? exactFunctions : (specSheet.renderManifest || ['drawHero', 'drawEnemy', 'drawObstacle']);
  const scaffoldJson = JSON.stringify(scaffold || {}, null, 2);

  return `You are an elite HTML5 Game Engineer. Build a COMPLETE mobile game as a single HTML file.
You are strictly in charge of physics, inputs, state, and the game loop.
DO NOT WRITE ART LOGIC. All entity rendering is handled by the Artist API Contract.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Genre: ${specSheet.genre}
- Summary: ${specSheet.summary}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}
- Runtime Lane: ${specSheet.runtimeLane || 'arcade_canvas'}
- Playable Slice: ${specSheet.playableSlice || 'One compact mobile game scene.'}
- Scene Blueprint: ${specSheet.sceneBlueprint || 'A readable stage with one hero and one threat type.'}
- Control Model: ${specSheet.controlModel || 'Simple touch-first interaction.'}

SHARED SCAFFOLD CONTRACT:
${scaffoldJson}

START FROM THIS SCAFFOLD HTML SHELL AND PRESERVE ITS BOOT SHAPE, RUNTIME OBJECTS, AND FIRST-FRAME GUARANTEES:
\`\`\`html
${scaffoldShell}
\`\`\`

SPECTACLE FOCUS:
${formatPromptList(specSheet.spectacleFocus, '- impact flashes')}

PLAYABILITY RULES:
${formatPromptList(specSheet.playabilityRules, '- Prefer one polished gameplay loop over sprawling feature lists.')}

${specSheet.runtimeLane === 'auto_battler_arena' ? `AUTO-BATTLER EXECUTION NOTE:
- Use a short prep phase with a visible BATTLE button.
- Keep active fighters to a readable squad and staged goblin waves.
- Sell "hundreds of goblins" with spawn gates, queues, dust, corpse decals, and effects instead of true large-scale ragdoll simulation.
- Heavy units should feel powerful through knockback, hit-stop, and wide attack arcs.
` : ''}

API CONTRACT (CRITICAL):
You MUST use native Canvas2D.
An Architect has explicitly designed the RenderEngine for this game. It will be automatically injected.
⚠️ FATAL RULE: DO NOT ATTEMPT TO WRITE OR DEFINE \`window.RenderEngine\` IN YOUR CODE! 
If you write \`window.RenderEngine = {}\` in your script, it will overwrite the Artist's code and ruin the game!
Assume \`window.RenderEngine\` exists globally. Your ONLY job is to CALL these functions inside your game loop:
\`\`\`javascript
${parsedManifest.map(fn => `window.RenderEngine.${fn} = function(ctx, x, y, width, height, time) {};`).join('\n')}
window.RenderEngine.drawBackground = function(ctx, width, height, scrollX, scrollY, time) {};
window.RenderEngine.drawHUD = function(ctx, width, height, score, health) {};
\`\`\`
In your game loop, you MUST track elapsed time and pass it to draw functions for animation:
\`const time = performance.now() / 1000;\`

REQUIRED DRAW CALLS in your render loop (Always subtract camera.x/camera.y from world coordinates!):
\`window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, camera.x||0, camera.y||0, time);\`
${parsedManifest.filter(fn => fn !== 'drawBackground' && fn !== 'drawHUD').map(fnName => `\`window.RenderEngine.${fnName}(ctx, entity.x - camera.x, entity.y - camera.y, entity.width, entity.height, time);\` // Use this for ${fnName.replace('draw', '')}`).join('\n')}
\`window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, score, health);\`

RULES:
1. Output ONE continuous HTML file starting with <!DOCTYPE html>.
2. Do not include external libraries.
3. Mobile-first touch controls (pointerdown/pointerup).
4. Fullscreen Canvas2D (resize loop).
5. Implement Juiciness (screen shake, physics easing).
6. BOOT RELIABILITY (CRITICAL):
   - The game must boot immediately at top level. Do NOT wait for DOMContentLoaded or window.onload.
   - Create the canvas and first frame synchronously so the mobile WebView does not sit on a blank screen.
   - Wrap boot code in try/catch and render a visible on-screen error panel if initialization fails.
   - The opening frame must draw a visible background and menu text. Never leave the screen blank while waiting for input.
7. LEVEL GENERATION (${specSheet.levelDesign || 'Dynamic'}):
   - If Endless: Procedurally generate platforms/enemies infinitely as player moves.
   - If Area/Single Screen: Confine bounds to canvas dimensions.
   - If Linear: Design distinct logical transitions or waves.
8. SENSE OF ALIGNMENT: Ensure physics, entity speeds, and platform alignments are spaced logically so the game is mathematically playable and flows smoothly without impossible gaps.
9. PROPER SCALE & MOVEMENT (CRITICAL): Under NO CIRCUMSTANCES should any entity (hero, enemy, platform) have a width or height of 1. Use realistic pixel dimensions (e.g. Hero: 60x80, Enemy: 50x50, Platforms: 100x20). Also, ensure the hero physically MOVES (updates x/y axis) if the game is endless.
10. CAMERA SHIFTS (CRITICAL): When calling your RenderEngine functions (drawHero, drawEnemy, etc.), you MUST pass Screen Coordinates by subtracting your game camera. You MUST do: \`window.RenderEngine.drawHero(ctx, hero.x - camera.x, hero.y - camera.y, ...)\`. Otherwise, the hero will walk completely off the Canvas screen!
11. NO PLACEHOLDERS (CRITICAL): You MUST write the absolutely complete physics loop and game update math yourself! DO NOT leave "// Placeholder" comments for logic! You are building the final production build right now. Do not skip any core functionality.
12. IMPLEMENT: Score tracking, health system, particle effects on hits/kills, and pickup collectibles.
13. SCOPE CONTROL:
   - If the prompt asks for an enormous cinematic game, compress it into one excellent playable scene or wave-based loop.
   - Fake scale with spawning, particles, layered backgrounds, damage numbers, hit flashes, and camera shake instead of overengineering.
14. RENDER CONTRACT:
   - Draw background every frame.
   - Draw at least one hero/player unit and one enemy/threat within the first second.
   - Ensure the game still looks intentional even before the user taps start.
15. SHARED-SHELL CONTRACT:
   - Preserve the existing scaffold shell structure instead of inventing a new one from scratch.
   - Keep the first-frame visibility guarantees from the scaffold.
   - Expand the placeholder update logic into the final working game.
   - Do not remove the RenderEngine call pattern.
   - Remove any scaffold placeholder markers like TODO_ENGINE from the final output.

OUTPUT FORMAT: Return ONLY HTML code, no markdown wrappers.`;
}

export function buildPhase3_Repair(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, compiledHtml, crashLog) {
  return `You are the integration lead repairing a broken DreamStream game build.
The Artist and Engineer must now be repaired TOGETHER so the merged artifact boots.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

CURRENT ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

CURRENT ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CURRENT COMPILED HTML:
\`\`\`html
${compiledHtml}
\`\`\`

CRASH REPORT:
${crashLog}

TASK:
- Analyze whether the crash lives in the artist code, the engineer code, or their integration boundary.
- Repair BOTH sides if necessary so the merged game boots reliably.
- Keep the same game fantasy and scaffolded structure.
- The fixed code must preserve the RenderEngine contract and the engineer shell contract.

OUTPUT FORMAT (MANDATORY):
===ARTIST_CODE===
(complete artist JavaScript object)
===ENGINE_CODE===
(complete engine HTML document starting with <!DOCTYPE html>)

RULES:
- Output BOTH sections every time.
- No markdown fences.
- No explanation.
- No placeholders or ellipses.
- Make boot reliability the top priority over extra features.`;
}

export function buildPhase2C_Critic(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml) {
  return {
    system: `You are the collaboration critic for a mobile HTML5 canvas game team.
Your job is to review the ARTIST code and ENGINEER code together and decide what must be revised before merge.

IMPORTANT RULES:
- Output ONLY raw JSON.
- Focus on playability, contract mismatches, boot safety, missing interactions, and visual/gameplay alignment.
- Be concise and specific.
- Prefer a short revision list over long essays.`,
    user: `GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

Return JSON:
{
  "shouldRevise": true,
  "artistFeedback": ["specific art/render fix"],
  "engineerFeedback": ["specific gameplay/boot fix"],
  "jointRisks": ["integration mismatch or runtime risk"],
  "collaborationSummary": "one short sentence about how the two should align"
}

Rules:
- artistFeedback and engineerFeedback should each contain 0 to 4 short actionable notes.
- jointRisks should call out contract mismatches, not vague complaints.
- If the build already looks coherent, set shouldRevise to false.
- Prioritize missing play loop, missing interaction, bad render contract usage, and dead-screen risks.

Output ONLY JSON.`
  };
}

export function buildPhase2D_ArtistRevision(specSheet, scaffold, artistGeneratedJS, criticNotes) {
  return `You are the procedural artist revising your RenderEngine after team review.
Keep the existing game fantasy, but fix the issues called out by the critic so the engineer can integrate cleanly.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

CURRENT ARTIST CODE:
${artistGeneratedJS}

CRITIC FEEDBACK FOR ARTIST:
${formatPromptList(criticNotes?.artistFeedback, '- no direct artist changes requested')}

JOINT RISKS:
${formatPromptList(criticNotes?.jointRisks, '- no joint risks reported')}

COLLABORATION SUMMARY:
${criticNotes?.collaborationSummary || 'Keep the render API easy for the engineer to call correctly.'}

RULES:
- Output the COMPLETE window.RenderEngine object.
- Keep the same function names unless the scaffold contract demands otherwise.
- Make drawBackground and drawHUD safe on frame zero.
- Favor readable, robust silhouettes over brittle complexity.
- Output ONLY JavaScript, no markdown, no explanation.`;
}

export function buildPhase2E_EngineerRevision(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, criticNotes) {
  return `You are the HTML5 game engineer revising your implementation after team review.
Keep the existing scaffolded game structure, but fix the interaction, playability, and integration problems called out by the critic.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

CURRENT ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

CURRENT ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CRITIC FEEDBACK FOR ENGINEER:
${formatPromptList(criticNotes?.engineerFeedback, '- no direct engineer changes requested')}

JOINT RISKS:
${formatPromptList(criticNotes?.jointRisks, '- no joint risks reported')}

COLLABORATION SUMMARY:
${criticNotes?.collaborationSummary || 'Preserve the shared shell and make the game actually playable.'}

RULES:
- Output the COMPLETE HTML document.
- Preserve the scaffolded boot shape and first-frame guarantees.
- Use the artist render functions exactly as provided.
- Remove placeholder behavior and ensure the first interaction leads to a real play loop.
- Output ONLY HTML, no markdown, no explanation.`;
}

export function buildPhase2F_Integrator(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, criticNotes) {
  return `You are the intelligent integration lead for a mobile HTML5 canvas game team.
Your job is to merge the ARTIST and ENGINEER outputs into one coherent final build plan before technical packaging happens.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CRITIC NOTES:
${JSON.stringify(criticNotes || {}, null, 2)}

TASK:
- Resolve any remaining mismatches between render code and gameplay code.
- Keep the best parts of both outputs instead of blindly rewriting from scratch.
- Ensure the engineer HTML calls the artist render API correctly.
- Keep the scaffolded structure and first-frame/playability guarantees.
- Prefer robust alignment over flashy but brittle code.

OUTPUT FORMAT (MANDATORY):
===ARTIST_CODE===
(complete final artist JavaScript object)
===ENGINE_CODE===
(complete final engine HTML document starting with <!DOCTYPE html>)

RULES:
- Output BOTH sections every time.
- No markdown fences.
- No explanation.
- Do not drop working functionality unless it conflicts with boot safety or playability.
- Remove any TODO placeholders or dead shell behavior from the final output.`;
}

export function compileMultiAgentGame(artistGeneratedJS, engineHtml, options = {}) {
    const renderManifest = normalizeList(options.renderManifest, []);
    const renderFns = Array.from(new Set([...renderManifest, 'drawBackground', 'drawHUD']));
    const renderEngineStubScript = `\n<script id="render-engine-stubs">
window.RenderEngine = window.RenderEngine || {};
(function() {
  var noop = function() {};
  noop.__dreamstreamStub = true;
  ${renderFns.map((fnName) => `if (typeof window.RenderEngine.${fnName} !== 'function') window.RenderEngine.${fnName} = noop;`).join('\n  ')}
})();
</script>\n`;
    const artistScript = `\n<script id="artist-engine">
// MULTI-AGENT PROCEDURAL GRAPHICS
try {
\n${artistGeneratedJS}\n
} catch(e) { console.error("Artist-Coder Syntax Error", e); }
</script>\n`;

    // 3. Robust injection before the main game logic begins
    if (engineHtml.includes('</head>')) {
        return engineHtml.replace('</head>', renderEngineStubScript + artistScript + '</head>');
    } else if (engineHtml.includes('<script')) {
        return engineHtml.replace('<script', renderEngineStubScript + artistScript + '<script');
    } else {
        return renderEngineStubScript + artistScript + engineHtml;
    }
}
