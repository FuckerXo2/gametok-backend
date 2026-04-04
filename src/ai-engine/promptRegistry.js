/**
 * DreamStream Prompt Registry v2.0
 * Inspired by Dream3DForge's multi-phase pipeline.
 * 
 * Instead of one monolithic prompt, we split generation into 3 phases:
 *   Phase 1: QUANTIZE  — AI acts as Game Designer, extracts structured spec from user prompt
 *   Phase 2: ARCHITECT — AI acts as Template Router, picks template + full JSON config
 *   Phase 3: POLISH    — AI acts as QA, reviews config and fixes obvious issues
 * 
 * Each phase is a focused, small prompt → higher quality output per call.
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────
// ENUM REFERENCE (mirrors Dream3DForge's type system)
// ─────────────────────────────────────────────────────────

const GENRES = [
  'TopDown Shooter', 'Platformer', 'Endless Runner', 'Puzzle', 'Arcade',
  'Racing', 'Horror Survival', 'Tower Defense', 'Rhythm', 'Idle/Clicker',
  'Sports', 'Word/Trivia', 'Physics Sandbox', 'Strategy', 'Card/Memory'
];

const VISUAL_STYLES = [
  'NEON_CYBERPUNK',    // Dark bg, bright neon accents, glowing edges
  'PIXEL_RETRO',       // Chunky pixels, limited palette, nostalgic
  'FLAT_VECTOR',       // Clean shapes, bold solid colors, modern
  'DARK_HORROR',       // Desaturated, high contrast, eerie atmosphere
  'PASTEL_CUTE',       // Soft colors, rounded shapes, friendly
  'NATURE_ORGANIC',    // Greens, browns, earthy tones, outdoor feel
  'SPACE_COSMIC',      // Deep blues, purples, stars, nebula vibes
  'OCEAN_AQUATIC',     // Blues, teals, underwater or beach vibes
  'DESERT_WARM',       // Oranges, yellows, sandy tones
  'WINTER_COLD',       // Whites, light blues, icy feel
];

const ATMOSPHERES = [
  'Bright & Cheerful',
  'Dark & Menacing',
  'Neon & Electric',
  'Calm & Relaxing',
  'Tense & Stressful',
  'Mysterious & Eerie'
];

const PACING = ['Fast / Arcade', 'Medium / Balanced', 'Slow / Strategic', 'Turn-Based'];

// ─────────────────────────────────────────────────────────
// TEMPLATE MANIFEST (auto-scanned from /templates/)
// ─────────────────────────────────────────────────────────

function getTemplateManifest() {
  const templatesDir = path.join(process.cwd(), 'src/ai-engine/templates');
  try {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.html'));
    return files.map(f => f.replace('.html', ''));
  } catch (e) {
    return ['TopDownShooter', 'EndlessRunner', 'CatchFalling', 'WhackAMole'];
  }
}

// Template-to-genre hints so the AI doesn't have to guess blindly
const TEMPLATE_HINTS = {
  'TopDownShooter':     'Top-down shooter with WASD + aim. Good for: shooting, survival, zombie, arena.',
  'EndlessRunner':      'Auto-scrolling runner with jump/duck. Good for: running, chasing, obstacle course.',
  'CatchFalling':       'Catch falling items with horizontal movement. Good for: collecting, cooking, rain.',
  'WhackAMole':         'Tap targets that pop up. Good for: whack-a-mole, reflex, pop-up games.',
  'T05_BreakoutClone':  'Paddle + ball brick breaker. Good for: breakout, arkanoid, brick games.',
  'T06_SnakeGame':      'Classic snake growing game. Good for: snake, worm, eating games.',
  'T07_SpaceInvaders':  'Rows of enemies descending, player shoots up. Good for: space, aliens, shooting.',
  'T08_FlappyBird':     'Tap to flap through gaps. Good for: flying, bird, helicopter games.',
  'T09_Asteroids':      'Ship rotates + shoots in open space. Good for: asteroids, space, shooting.',
  'T10_Pong':           'Two paddles, bouncing ball. Good for: pong, tennis, 2-player.',
  'T11_DoodleJump':     'Vertical jump on platforms. Good for: jumping, climbing, doodle.',
  'T12_MemoryCardMatch':'Flip cards to match pairs. Good for: memory, matching, card games.',
  'T13_TicTacToe':      'Classic X/O grid game. Good for: tic tac toe, strategy, board.',
  'T14_AimTrainer':     'Click targets for accuracy. Good for: aim, accuracy, shooting practice.',
  'T15_TetrislikeDrop': 'Falling blocks, complete rows. Good for: tetris, stacking, puzzle.',
  'T16_PianoTiles':     'Tap falling tiles in columns. Good for: piano, music, rhythm.',
  'T17_KnifeHit':       'Throw knives at spinning target. Good for: knife, throwing, precision.',
  'T18_FruitNinjaSlicing':'Swipe to slice objects. Good for: fruit ninja, slicing, swiping.',
  'T19_DodgetheLasers': 'Dodge projectiles/beams. Good for: dodging, laser, survival.',
  'T20_Platformer':     'Side-scrolling jump & run. Good for: mario, platformer, adventure.',
  'T21_TowerDefenseBasic':'Place towers to stop waves. Good for: tower defense, strategy.',
  'T22_IdleClicker':    'Click to earn, auto-upgrade. Good for: idle, clicker, incremental.',
  'T23_RacingTopDown':  'Top-down car racing. Good for: racing, driving, cars.',
  'T24_BulletHell':     'Dense projectile patterns to dodge. Good for: bullet hell, shmup.',
  'T25_ColorSwitch':    'Match color to pass barriers. Good for: color, timing, reflex.',
  'T26_GravityGuy':     'Flip gravity to navigate. Good for: gravity, flip, platformer.',
  'T27_HelicopterGame': 'Hold to rise, release to fall. Good for: helicopter, flying, cave.',
  'T28_PacmanMaze':     'Navigate maze eating dots. Good for: pacman, maze, ghost.',
  'T29_FroggerCrosser': 'Cross lanes of traffic/water. Good for: frogger, crossing, traffic.',
  'T30_TypingGame':     'Type words before they reach bottom. Good for: typing, words, education.',
  'T31_SimonSays':      'Repeat color/sound sequences. Good for: simon, memory, sequence.',
  'T32_WhackAMoleVariant':'Variant whack-a-mole. Good for: tapping, reflex, arcade.',
  'T33_MiningDiggingGame':'Dig downward collecting gems. Good for: mining, digging, underground.',
  'T34_FishingGame':    'Cast line, reel in fish. Good for: fishing, ocean, relaxing.',
  'T35_ArcheryTrajectory':'Aim arc trajectory to hit target. Good for: archery, bow, aiming.',
  'T36_PinballBumper':  'Pinball with flippers. Good for: pinball, bumpers, arcade.',
  'T37_BilliardsPhysics':'Pool/billiards ball physics. Good for: pool, billiards, snooker.',
  'T38_AirHockey':      'Air hockey puck physics. Good for: hockey, puck, 2-player.',
  'T39_SkiSlalom':      'Ski downhill through gates. Good for: skiing, slalom, winter.',
  'T40_Bowling':        'Bowling lane with pins. Good for: bowling, sports.',
  'T41_BouncingDVDLogo':'Bouncing logo screensaver. Good for: bouncing, physics, screensaver.',
  'T42_JetpackJoyride': 'Hold to fly with jetpack. Good for: jetpack, flying, coins.',
  'T43_DontTouchtheSpikes':'Bounce avoiding spikes. Good for: bouncing, spikes, timing.',
  'T44_SubwaySurfers3lane':'3-lane swipe runner. Good for: subway surfers, running, swiping.',
  'T45_RhythmTiming':   'Hit notes on beat. Good for: rhythm, music, timing, dance.',
  'T46_LineRiderDrawpath':'Draw path for rider to follow. Good for: drawing, physics, line rider.',
  'T47_PhysicsStacker':  'Stack objects, balance. Good for: stacking, balance, physics.',
  'T48_WaterSortPuzzle': 'Sort colored liquids. Good for: water sort, liquid, puzzle.',
  'T49_2048Sliding':     'Slide and merge tiles. Good for: 2048, number, puzzle.',
  'T50_JigsawSlide':     'Sliding tile puzzle. Good for: jigsaw, sliding, puzzle.',
  'T51_WordSearch':      'Find hidden words in grid. Good for: word search, vocabulary.',
  'T52_Hangman':         'Guess letters before hangman. Good for: hangman, word, guessing.',
  'T53_TriviaQuiz':      'Answer multiple choice questions. Good for: trivia, quiz, knowledge.',
  'T54_TugofWarMashing': 'Tap rapidly to win tug of war. Good for: mashing, competition.',
};

// ─────────────────────────────────────────────────────────
// PHASE 1: QUANTIZE REQUIREMENTS
// AI acts as Lead Game Designer — extracts structured spec
// ─────────────────────────────────────────────────────────

export function buildPhase1_Quantize(userPrompt) {
  return {
    system: `You are a Lead Game Designer for a mobile HTML5 Canvas2D game studio.
Your job is to analyze a user's casual game idea and extract a precise, structured Game Spec Sheet.

IMPORTANT RULES:
- Output ONLY raw JSON, no markdown, no explanation.
- Be creative but realistic for a mobile casual game.
- The visual style MUST match the mood of the game (horror = dark, cute = pastel, etc.)
- Choose a background color that FITS the game theme. DO NOT default to dark/black unless the game is actually dark-themed.

Available Visual Styles: ${VISUAL_STYLES.join(', ')}
Available Atmospheres: ${ATMOSPHERES.join(', ')}
Available Pacing: ${PACING.join(', ')}`,

    user: `USER PROMPT: "${userPrompt}"

Extract a Game Spec Sheet as JSON:
{
  "title": "Creative game title",
  "genre": "Best fitting genre",
  "summary": "2-3 sentence game description with clear mechanics",
  "coreMechanics": ["mechanic1", "mechanic2", "mechanic3"],
  "visualStyle": "ONE from the Visual Styles list",
  "atmosphere": "ONE from the Atmospheres list",
  "pacing": "ONE from the Pacing list",
  "backgroundColor": "#hex color that matches the theme and visual style",
  "accentColor": "#hex secondary color for UI elements",
  "entities": {
    "hero": "What the player controls (be specific)",
    "enemy": "What threatens the player (be specific)",
    "collectible": "What the player collects (be specific, or null)",
    "obstacle": "Environmental hazards (be specific, or null)"
  },
  "scoreLabel": "What to call the score (e.g. KILLS, COINS, POINTS, FISH, etc.)",
  "healthLabel": "What to call health/lives (e.g. LIVES, HEALTH, SANITY, ARMOR, etc.)",
  "gameOverTitle": "Thematic game over message",
  "difficulty": "easy | medium | hard"
}

Output ONLY the JSON.`
  };
}

// ─────────────────────────────────────────────────────────
// PHASE 2: ARCHITECT (Template Router + Config Generator)
// AI acts as Technical Director — picks best template + config
// ─────────────────────────────────────────────────────────

export function buildPhase2_Architect(specSheet) {
  const templates = getTemplateManifest();
  const templateDescriptions = templates
    .map(t => `  - ${t}: ${TEMPLATE_HINTS[t] || 'General game template.'}`)
    .join('\n');

  return {
    system: `You are a Technical Director for a mobile game studio.
You receive a Game Spec Sheet and must map it to the BEST matching pre-built template from our library, then generate the full JSON configuration to skin that template.

CRITICAL RULES:
1. You MUST select a template from the list below. Pick the one whose mechanics most closely match the spec.
2. Output ONLY raw JSON, no markdown.
3. Asset keys MUST be exactly: "HERO", "ENEMY", "BACKGROUND", "COLLECTIBLE", "WEAPON", or "OBSTACLE". NO custom keys.
4. Prefer emoji assets ("type": "emoji") — they load instantly and look great on mobile.
5. Use kenney assets ("type": "kenney") for specific game art needs.
6. Only use "ai" type assets as an absolute last resort.

AVAILABLE TEMPLATES:
${templateDescriptions}`,

    user: `GAME SPEC SHEET:
${JSON.stringify(specSheet, null, 2)}

Now select the best template and generate the full configuration:
{
  "selectedTemplateId": "EXACT_TEMPLATE_NAME_FROM_LIST",
  "config": {
    "primary_color": "${specSheet.backgroundColor || '#1a1a2e'}",
    "SCORE_LABEL": "${specSheet.scoreLabel || 'SCORE'}",
    "HEALTH_LABEL": "${specSheet.healthLabel || 'LIVES'}",
    "GAMEOVER_TITLE": "${specSheet.gameOverTitle || 'GAME OVER'}",
    "FINAL_SCORE_LABEL": "FINAL ${specSheet.scoreLabel || 'SCORE'}",
    "RESTART_TEXT": "PLAY AGAIN",
    "heroSpeed": 6,
    "enemySpeed": 3,
    "spawnRate": 1200,
    "gameSpeed": 8
  },
  "neededAssets": {
    "HERO": { "type": "emoji", "value": "emoji_here" },
    "ENEMY": { "type": "emoji", "value": "emoji_here" },
    "COLLECTIBLE": { "type": "emoji", "value": "emoji_here_or_null" }
  }
}

Output ONLY the JSON.`
  };
}

// ─────────────────────────────────────────────────────────
// PHASE 3: POLISH (Optional QA pass)
// AI reviews the combined spec + config for consistency
// ─────────────────────────────────────────────────────────

export function buildPhase3_Polish(specSheet, architectOutput) {
  return {
    system: `You are a QA Director for a mobile game studio.
You receive a Game Spec and a Template Configuration. Your job is to review for consistency and fix any obvious issues.

RULES:
1. If the config looks good, return it UNCHANGED.
2. If the background color doesn't match the atmosphere, fix it.
3. If the emojis don't match the entities described in the spec, fix them.
4. If the template choice seems wrong for the described mechanics, suggest a better one.
5. Output ONLY the corrected JSON config (same schema as input).
6. Asset keys MUST remain: "HERO", "ENEMY", "BACKGROUND", "COLLECTIBLE", "WEAPON", "OBSTACLE".`,

    user: `ORIGINAL SPEC:
${JSON.stringify(specSheet, null, 2)}

ARCHITECT OUTPUT:
${JSON.stringify(architectOutput, null, 2)}

Review and return the final corrected JSON (same schema as architect output). Fix any mismatches. Output ONLY JSON.`
  };
}


// ─────────────────────────────────────────────────────────
// TEMPLATE COMPILER (kept from original prompt.js)
// Injects config + assets + juice into raw HTML template
// ─────────────────────────────────────────────────────────

export function injectTemplate(templateId, config, assetMap) {
  const templatesDir = path.join(process.cwd(), 'src/ai-engine/templates');
  let rawHtml = '';
  try {
    rawHtml = fs.readFileSync(path.join(templatesDir, templateId + '.html'), 'utf-8');
  } catch (e) {
    // Fallback to TopDownShooter if template not found
    try {
      rawHtml = fs.readFileSync(path.join(templatesDir, 'TopDownShooter.html'), 'utf-8');
    } catch (e2) {
      return '<html><body><h1>Template not found</h1></body></html>';
    }
  }

  const safeConfig = config || {};
  const paramsStr = JSON.stringify(safeConfig);

  // Build asset <img> tags and CSS background
  let assetTagsStr = '';
  let globalCss = '<style>body, html, canvas { ';

  if (safeConfig.primary_color) {
    globalCss += `background-color: ${safeConfig.primary_color} !important; `;
  }

  if (assetMap) {
    for (const [key, url] of Object.entries(assetMap)) {
      assetTagsStr += `<img id="img_${key}" src="${url}" hidden>\n`;
      if (key === 'BACKGROUND') {
        globalCss += `background-image: url('${url}') !important; background-size: cover !important; background-position: center !important; `;
      }
    }
  }

  globalCss += '}</style>\n';

  // Canvas clear override (prevents black backgrounds)
  const clearScript = `
  <script>
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, contextAttributes) {
          const ctx = originalGetContext.call(this, type, contextAttributes);
          if (type === '2d' && !ctx._hasDreamStreamOverride) {
              ctx._hasDreamStreamOverride = true;
              const origFillRect = ctx.fillRect;
              ctx.fillRect = function(x, y, w, h) {
                  if (x === 0 && y === 0 && w >= this.canvas.width * 0.9 && h >= this.canvas.height * 0.9) {
                      ctx.clearRect(x, y, w, h);
                      return;
                  }
                  origFillRect.apply(this, arguments);
              };
          }
          return ctx;
      };
  </script>
  `;

  // Juice Engine injection
  let juiceScript = '';
  try {
    const juicePath = path.join(process.cwd(), 'src/ai-engine/juice.js');
    const juiceCode = fs.readFileSync(juicePath, 'utf8');
    juiceScript = '<script>' + juiceCode + '</script>';
  } catch (e) {
    console.error("Failed to load juice engine", e);
  }

  // Procedural Audio Engine injection
  let audioScript = '';
  try {
    const audioPath = path.join(process.cwd(), 'src/ai-engine/audio.js');
    const audioCode = fs.readFileSync(audioPath, 'utf8');
    audioScript = '<script>' + audioCode + '</script>';
  } catch (e) {
    // audio.js doesn't exist yet, that's fine
  }

  // Replace placeholders
  let finalHtml = rawHtml.replace('{{GAME_PARAMETERS}}', paramsStr);
  finalHtml = finalHtml.replace('</head>', globalCss + clearScript + juiceScript + audioScript + '</head>');
  finalHtml = finalHtml.replace('{{ASSET_TAGS}}', assetTagsStr);

  // Replace text placeholders
  const textPlaceholders = ['primary_color', 'SCORE_LABEL', 'HEALTH_LABEL', 'TIMER_LABEL', 'GAMEOVER_TITLE', 'FINAL_SCORE_LABEL', 'RESTART_TEXT'];
  for (const ph of textPlaceholders) {
    const val = safeConfig[ph] || ph.replace(/_/g, ' ');
    const regex = new RegExp('{{' + ph + '}}', 'g');
    finalHtml = finalHtml.replace(regex, val);
  }

  // Cleanup any unfilled brackets
  finalHtml = finalHtml.replace(/{{.*?}}/g, '');

  return finalHtml;
}
