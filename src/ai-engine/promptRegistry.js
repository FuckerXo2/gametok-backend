/**
 * DreamStream Prompt Registry v3.0 — CLAUDE RAW CODE GENERATION
 * 
 * Inspired by Dream3DForge's multi-phase pipeline.
 * Phase 1: QUANTIZE  — Gemma acts as Game Designer, extracts structured spec (FREE)
 * Phase 2: BUILD     — Claude Sonnet 4.6 generates FULL raw HTML/JS game code (PREMIUM)
 * Phase 3: VERIFY    — Puppeteer sandbox validates the game doesn't crash
 * 
 * No more templates. Claude writes the entire game from scratch every time.
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────
// VISUAL STYLE REFERENCE
// ─────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────
// PHASE 1: QUANTIZE REQUIREMENTS (runs on Gemma — FREE)
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
- Games should be touch-friendly (tap, swipe, drag — no keyboard required).

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
    "hero": "What the player controls (be specific and visual — e.g. 'a small glowing boy')",
    "enemy": "What threatens the player (be specific — e.g. 'a tall dark priest with red eyes')",
    "collectible": "What the player collects (e.g. 'glowing TV screens', or null)",
    "obstacle": "Environmental hazards (e.g. 'dark fog patches', or null)"
  },
  "heroEmoji": "Single emoji representing the hero (e.g. 👦, 🚀, 🐱)",
  "enemyEmoji": "Single emoji representing the enemy (e.g. 👹, 👾, 🧟)",
  "collectibleEmoji": "Single emoji for collectible (e.g. 📺, 💎, ⭐) or null",
  "scoreLabel": "What to call the score (e.g. TVS COLLECTED, COINS, KILLS)",
  "healthLabel": "What to call health/lives (e.g. SANITY, LIVES, HEALTH)",
  "gameOverTitle": "Thematic game over message",
  "difficulty": "easy | medium | hard",
  "seed": "A random alphanumeric string (e.g. 'f9a2b7')"
}

Output ONLY the JSON.`
  };
}

// ─────────────────────────────────────────────────────────
// PHASE 2: BUILD PROTOTYPE (runs on Claude Sonnet 4.6)
// Claude generates the COMPLETE game as a single HTML file
// ─────────────────────────────────────────────────────────

export function buildPhase2_BuildPrototype(specSheet) {
  return `You are an expert Creative Coder and Game Engine Specialist. Build a COMPLETE, POLISHED, PRODUCTION-QUALITY mobile game as a single HTML file.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Genre: ${specSheet.genre}
- Summary: ${specSheet.summary}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}
- Visual Style: ${specSheet.visualStyle}
- Atmosphere: ${specSheet.atmosphere}
- Pacing: ${specSheet.pacing}
- Background Color: ${specSheet.backgroundColor}
- Accent Color: ${specSheet.accentColor}

ENTITIES:
- Hero: ${specSheet.entities?.hero} (emoji representation: ${specSheet.heroEmoji || '🦸'})
- Enemy: ${specSheet.entities?.enemy} (emoji representation: ${specSheet.enemyEmoji || '👾'})
- Collectible: ${specSheet.entities?.collectible || 'none'} (emoji: ${specSheet.collectibleEmoji || '⭐'})

UI LABELS:
- Score: "${specSheet.scoreLabel || 'SCORE'}"
- Health: "${specSheet.healthLabel || 'LIVES'}"
- Game Over: "${specSheet.gameOverTitle || 'GAME OVER'}"

DETERMINISTIC SEED: "${specSheet.seed || 'f9a2b7'}"
You MUST implement a seeded random number generator (PRNG) and use it for ALL procedural generation and gameplay randomness.

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════
You MUST choose one of the following engines based on the game genre and visuals:
1. THREE.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js)
   - Best for: 3D games, immersive environments, first-person or third-person perspectives.
2. P5.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.js)
   - Best for: Creative art games, complex 2D physics, generative visuals.
3. CANVAS 2D (Native)
   - Best for: Classic 2D arcade games, platformers, top-down shooters.
4. DOM/CSS (Native)
   - Best for: Card games, puzzles, trivia, word games.

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════

1. SINGLE FILE: Everything in ONE HTML document. You MAY use CDNs for Three.js or p5.js if chosen.
   - You MUST include <meta charset="UTF-8"> in the <head> otherwise Emojis will break and show question marks.

2. MOBILE-FIRST TOUCH CONTROLS (STRICT):
   - USE 'pointerdown', 'pointermove', 'pointerup' for universal touch/mouse support.
   - Add 'touch-action: none;' to your CSS for the body/canvas so iOS doesn't intercept the touches.
   - Attach your event listeners directly to the window or canvas (e.g. window.addEventListener('pointerdown', ...)).
   - Do NOT use the 'click' event. It is swallowed by iOS WebViews.

3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize events to update camera/canvas.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }

4. WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - DO NOT trap the player in a single small screen box unless it's a puzzle game!
   - For RPGs, Survival, Shooters, and Platformers, the world MUST be massive or strictly infinite. 
   - You MUST implement a Camera System. In Canvas2D, calculate \`camera.x\` and \`camera.y\` to follow the player, and use \`ctx.save(); ctx.translate(-camera.x, -camera.y);\` before drawing the game world (and restore before drawing HUD).
   - Spawn enemies and environment objects dynamically across global world coordinates, not just the visible screen!

5. ENTITY RENDERING (STRICT KENNEY ASSET USAGE):
   - Here is the ASSET MANIFEST of high-quality image URLs provided for this game:
   - ASSET MANIFEST: ${JSON.stringify(specSheet.assetManifest || [])}
   - NEVER USE EMOJIS! The user's device cannot render them! You MUST use the image URLs from the manifest or draw geometric shapes.
   - You MUST preload images BEFORE your game loop using this exact pattern:
     \`\`\`javascript
     const images = {};
     const manifest = ${JSON.stringify(specSheet.assetManifest || [])};
     let loaded = 0;
     manifest.forEach(asset => {
       const img = new Image();
       img.src = asset.url;
       img.onload = () => {
         loaded++;
         images[asset.id] = img;
         if(loaded === manifest.length) startGameLoop(); // start requestAnimationFrame
       };
     });
     if(manifest.length === 0) startGameLoop();
     \`\`\`
   - Inside your game loop, use \`ctx.drawImage(images['asset_id'], x, y, width, height);\`.

6. HUD & UI:
   - Score: "${specSheet.scoreLabel || 'SCORE'}"
   - Health: "${specSheet.healthLabel || 'LIVES'}"
   - Use accent color (${specSheet.accentColor}).
   - High-contrast for readability on small screens.

7. GAME STATES (THE START BUTTON FIX):
   - MENU: Draw centered title and "TAP TO START" text directly on the Canvas.
   - You MUST transition from MENU to PLAYING state exactly like this:
     window.addEventListener('pointerdown', () => { if (gameState === 'MENU') gameState = 'PLAYING'; });
   - Do NOT create physical HTML <button> overlays. They block touches in iOS WebViews. Draw everything on the canvas and listen for a global screen tap!
   - PLAYING: Core gameplay.
   - GAMEOVER: Draw "${specSheet.gameOverTitle || 'GAME OVER'}", final score, "TAP TO RESTART".

7. GAME FEEL / JUICE (MANDATORY):
   - Immersive screen shake / camera shake on impact.
   - Visual feedback for Every Action (flashes, tiny particles, scaling).
   - Sound: Use Web Audio API for synthesized effects (Collect: chirpy, Hit: deep thud).

8. ERROR HANDLING & LOGGING (CRITICAL FOR MOBILE):
   - Use try/catch blocks. Render error text on the screen if the engine fails to initialize.
   - DO NOT use console.log(), console.warn(), or console.error() inside the game loop (requestAnimationFrame). Spamming the console will CRASH the mobile wrapper.
   - Never log massive objects like 'window' or DOM events.

OUTPUT FORMAT:
Return ONLY the complete HTML code. Do NOT wrap in markdown. No explanation. Just raw HTML starting with <!DOCTYPE html>.`;
}

// ─────────────────────────────────────────────────────────
// PHASE 2B: EDIT GAME (Claude modifies existing code)
// ─────────────────────────────────────────────────────────

export function buildPhase2_EditGame(existingCode, instructions) {
  return `You are an expert HTML5 game developer. You are modifying an existing game.

EXISTING GAME CODE:
${existingCode}

USER INSTRUCTIONS: "${instructions}"

RULES:
1. Apply the requested changes to the existing code.
2. Return the COMPLETE modified HTML file (not just the diff).
3. Keep everything that works — only change what the user asked for.
4. Start with <!DOCTYPE html> and end with </html>.
5. Do NOT wrap in markdown code blocks. Do NOT include explanation.
6. Just output the raw HTML.`;
}


// ─────────────────────────────────────────────────────────
// POST-PROCESSING: Inject Juice + Audio engines into
// the raw HTML that Claude generates
// ─────────────────────────────────────────────────────────

export function postProcessRawHtml(rawHtml) {
  // Inject Juice Engine
  let juiceScript = '';
  try {
    const juicePath = path.join(process.cwd(), 'src/ai-engine/juice.js');
    const juiceCode = fs.readFileSync(juicePath, 'utf8');
    juiceScript = '<script>' + juiceCode + '</script>';
  } catch (e) {}

  // Inject Audio Engine
  let audioScript = '';
  try {
    const audioPath = path.join(process.cwd(), 'src/ai-engine/audio.js');
    const audioCode = fs.readFileSync(audioPath, 'utf8');
    audioScript = '<script>' + audioCode + '</script>';
  } catch (e) {}

  // Inject right before </body> or at end
  if (rawHtml.includes('</body>')) {
    rawHtml = rawHtml.replace('</body>', juiceScript + audioScript + '</body>');
  } else {
    rawHtml += juiceScript + audioScript;
  }

  // Force inject essential mobile metas
  const metaTags = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
