/**
 * DreamStream Prompt Registry v3.0
 *
 * Live architecture:
 * Phase 1: QUANTIZE  — Gemma on NIM extracts structured spec
 * Phase 2A: ART      — Qwen 3.5 on NIM writes RenderEngine drawing code
 * Phase 2B: ENGINE   — Qwen 3 Coder on NIM writes the full gameplay HTML shell
 * Phase 3: VERIFY    — Puppeteer sandbox validates the game doesn't crash
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
- The spec must describe a game the engineer can ship as one self-contained mobile HTML canvas experience.
- If the user's ask is too large, scale it into a strong playable vertical slice instead of describing an impossible full production game.
- renderManifest MUST be specific to the requested game. Never use a fixed default list from some unrelated genre.

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
  "levelDesign": "Endless | Single Screen Arena | Linear Levels",
  "backgroundColor": "#hex color that matches the theme and visual style",
  "accentColor": "#hex secondary color for UI elements",
  "entities": {
    "hero": "What the player controls (be specific and visual — e.g. 'a small glowing boy')",
    "enemy": "What threatens the player (be specific — e.g. 'a tall dark priest with red eyes')",
    "collectible": "What the player collects (e.g. 'glowing TV screens', or null)",
    "obstacle": "Environmental hazards (e.g. 'dark fog patches', or null)"
  },
  "renderManifest": ["drawHero", "drawEnemy", "drawObstacle", "drawProjectile", "drawPickup", "drawParticle"],
  "heroEmoji": "Single emoji representing the hero (e.g. 👦, 🚀, 🐱)",
  "enemyEmoji": "Single emoji representing the enemy (e.g. 👹, 👾, 🧟)",
  "collectibleEmoji": "Single emoji for collectible (e.g. 📺, 💎, ⭐) or null",
  "scoreLabel": "What to call the score (e.g. TVS COLLECTED, COINS, KILLS)",
  "healthLabel": "What to call health/lives (e.g. SANITY, LIVES, HEALTH)",
  "gameOverTitle": "Thematic game over message",
  "difficulty": "easy | medium | hard",
  "seed": "A random alphanumeric string (e.g. 'f9a2b7')"
}

renderManifest rules:
- Always include drawBackground and drawHUD implicitly through the shared API; do NOT list them in renderManifest.
- Include 3 to 8 function names only.
- Function names must match the actual fantasy of the prompt.
- Good example for an auto-battler: ["drawKnight", "drawArcher", "drawWizard", "drawGoblin", "drawExplosion", "drawDamageNumber"]
- Good example for a racing game: ["drawPlayerCar", "drawTrafficCar", "drawBarrier", "drawBoostPickup", "drawSmokeParticle"]
- Bad example: reusing knight/goblin names for every game no matter the prompt.

Output ONLY the JSON.`
  };
}

// ─────────────────────────────────────────────────────────
// LEGACY: Single-agent prototype prompt kept for local prompt experiments.
// The production DreamStream route uses the Artist + Engineer split below.
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

ENTITIES (draw these as colored geometric shapes — NO emojis, NO images):
- Hero: ${specSheet.entities?.hero}
- Enemy: ${specSheet.entities?.enemy}
- Collectible: ${specSheet.entities?.collectible || 'none'}

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
   - You MUST include <meta charset="UTF-8"> in the <head>.

2. MOBILE-FIRST TOUCH CONTROLS (STRICT):
   - USE 'pointerdown', 'pointermove', 'pointerup' for universal touch/mouse support.
   - Add 'touch-action: none;' to your CSS for the body/canvas so iOS doesn't intercept the touches.
   - Attach your event listeners directly to the window or canvas (e.g. window.addEventListener('pointerdown', ...)).
   - Do NOT use the 'click' event. It is swallowed by iOS WebViews.

3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize events to update camera/canvas.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - ⚠️ MUST USE VIBRANT BACKGROUNDS: At the start of your draw loop, NEVER clear the screen with \`ctx.fillStyle = "black";\`. You MUST clear using \`ctx.clearRect(0, 0, canvas.width, canvas.height);\` so the vibrant CSS background color shows through!

4. WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - DO NOT trap the player in a single small screen box unless it's a puzzle game!
   - For RPGs, Survival, Shooters, and Platformers, the world MUST be massive or strictly infinite. 
   - You MUST implement a Camera System. In Canvas2D, calculate \`camera.x\` and \`camera.y\` to follow the player, and use \`ctx.save(); ctx.translate(-camera.x, -camera.y);\` before drawing the game world (and restore before drawing HUD).
   - Spawn enemies and environment objects dynamically across global world coordinates, not just the visible screen!

5. ENTITY RENDERING (ARTIST-CODER PROCEDURAL GRAPHICS):
   - ⚠️ ABSOLUTELY NO EXTERNAL IMAGES OR URLS. Do NOT attempt to load external sprites, PNGs, or textures!
   - ⚠️ NEVER USE EMOJIS OR UNICODE CHARACTERS. The device CANNOT render them — they show as broken boxes.
   - You MUST act as an 'Artist-Coder'. You will draw every single entity (Player, Enemies, Backgrounds, Collectibles) procedurally using pure Canvas2D API.
   - The hero description is: ${specSheet.entities?.hero || "Main player character"}
   - The enemy description is: ${specSheet.entities?.enemy || "Adversary or obstacle"}
   - 🔥 DO NOT DRAW BORING RECTANGLES OR BASIC CIRCLES! 
   - Write custom generative, multi-layered Canvas drawing sequence functions for each entity. Use bezier curves, gradients, globalCompositeOperation, shadows, glowing effects, and paths.
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
   - Each entity type MUST be at least 30x30 pixels and visually distinct.

6. HUD & UI:
   - Score: "${specSheet.scoreLabel || 'SCORE'}"
   - Health: "${specSheet.healthLabel || 'LIVES'}"
   - Use accent color (${specSheet.accentColor}).
   - High-contrast for readability on small screens.

7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
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
// EDIT PROMPT HELPER (kept for local experiments and legacy tooling)
// ─────────────────────────────────────────────────────────

export function buildPhase2_EditGame(engineCode, instructions, artistCode) {
  // If we have separate artist code, send both sections clearly labeled
  if (artistCode) {
    return `You are an expert HTML5 game developer. You are modifying an existing game that has TWO parts:

===SECTION 1: ARTIST CODE (Canvas drawing functions)===
${artistCode}

===SECTION 2: ENGINE CODE (Game HTML with physics, input, game loop)===
${engineCode}

USER WANTS: "${instructions}"

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
4. The ENGINE_CODE section must start with <!DOCTYPE html> and end with </html>.`;
  }

  // Fallback for legacy games without separate artist code
  return `You are an expert HTML5 game developer. You are modifying an existing game.

EXISTING GAME CODE:
${engineCode}

USER INSTRUCTIONS: "${instructions}"

RULES:
1. Apply ONLY the requested changes to the existing code.
2. CRITICAL: You MUST return the COMPLETE, FULL, UNABRIDGED modified HTML file.
3. NEVER abbreviate, truncate, or skip sections. NEVER write "..." or "// rest of code". Every single line must be present.
4. Keep everything that works — only change what the user asked for.
5. Start with <!DOCTYPE html> and end with </html>.
6. Do NOT wrap in markdown code blocks. Do NOT include explanation.
7. Just output the raw HTML. Nothing else.`;
}


// ─────────────────────────────────────────────────────────
// POST-PROCESSING: Inject runtime diagnostics, Juice, and Audio
// into the raw HTML returned by the gameplay engineer
// ─────────────────────────────────────────────────────────

export function postProcessRawHtml(rawHtml) {
  const runtimeOverlayScript = `
    <script>
      (function() {
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
    rawHtml = rawHtml.replace('</body>', runtimeOverlayScript + juiceScript + audioScript + '</body>');
  } else {
    rawHtml += runtimeOverlayScript + juiceScript + audioScript;
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
export function buildPhase2A_Artist(specSheet) {
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
export function buildPhase2B_Engineer(specSheet, generatedArtistCode) {
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

  return `You are an elite HTML5 Game Engineer. Build a COMPLETE mobile game as a single HTML file.
You are strictly in charge of physics, inputs, state, and the game loop.
DO NOT WRITE ART LOGIC. All entity rendering is handled by the Artist API Contract.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}

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

OUTPUT FORMAT: Return ONLY HTML code, no markdown wrappers.`;
}

export function compileMultiAgentGame(artistGeneratedJS, engineHtml) {
    const artistScript = `\n<script id="artist-engine">
// MULTI-AGENT PROCEDURAL GRAPHICS
try {
\n${artistGeneratedJS}\n
} catch(e) { console.error("Artist-Coder Syntax Error", e); }
</script>\n`;

    // 3. Robust injection before the main game logic begins
    if (engineHtml.includes('</head>')) {
        return engineHtml.replace('</head>', artistScript + '</head>');
    } else if (engineHtml.includes('<script')) {
        return engineHtml.replace('<script', artistScript + '<script');
    } else {
        return artistScript + engineHtml;
    }
}
