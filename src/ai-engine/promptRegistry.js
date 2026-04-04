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
  "difficulty": "easy | medium | hard"
}

Output ONLY the JSON.`
  };
}

// ─────────────────────────────────────────────────────────
// PHASE 2: BUILD PROTOTYPE (runs on Claude Sonnet 4.6)
// Claude generates the COMPLETE game as a single HTML file
// ─────────────────────────────────────────────────────────

export function buildPhase2_BuildPrototype(specSheet) {
  return `You are an expert HTML5 Canvas2D game developer. Build a COMPLETE, POLISHED, PRODUCTION-QUALITY mobile game as a single HTML file.

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
- Hero: ${specSheet.entities?.hero} (draw as emoji: ${specSheet.heroEmoji || '🦸'})
- Enemy: ${specSheet.entities?.enemy} (draw as emoji: ${specSheet.enemyEmoji || '👾'})
- Collectible: ${specSheet.entities?.collectible || 'none'} (emoji: ${specSheet.collectibleEmoji || '⭐'})
- Obstacle: ${specSheet.entities?.obstacle || 'none'}

UI LABELS:
- Score: "${specSheet.scoreLabel || 'SCORE'}"
- Health: "${specSheet.healthLabel || 'LIVES'}"
- Game Over: "${specSheet.gameOverTitle || 'GAME OVER'}"

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════

1. SINGLE FILE: Everything (HTML + CSS + JS) in ONE complete HTML document. No external dependencies. No CDN imports.

2. CANVAS2D ONLY: Use HTML5 Canvas with 2D context. No WebGL, no Three.js, no Phaser. Pure Canvas2D.

3. MOBILE-FIRST TOUCH CONTROLS:
   - Use touch events (touchstart, touchmove, touchend) as PRIMARY input.
   - Also support mouse events as fallback (pointerdown, pointermove, pointerup).
   - NO keyboard controls. This runs on phones.
   - Common patterns: tap to jump, drag to move, swipe to dodge.

4. FULLSCREEN RESPONSIVE CANVAS:
   - Canvas MUST fill the entire viewport: canvas.width = window.innerWidth; canvas.height = window.innerHeight;
   - Handle window resize events.
   - Use CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; }
   - Set canvas style: canvas { display: block; }

5. RENDER ENTITIES AS EMOJI:
   - Use ctx.font = 'Xpx serif' and ctx.fillText('emoji', x, y) to draw game entities.
   - Hero emoji: ${specSheet.heroEmoji || '🦸'} (size: 40-50px)
   - Enemy emoji: ${specSheet.enemyEmoji || '👾'} (size: 35-45px)
   - Collectible emoji: ${specSheet.collectibleEmoji || '⭐'} (size: 30px)
   - Center the emoji text: ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

6. POLISHED HUD (MANDATORY):
   - Score display in top-left with label "${specSheet.scoreLabel || 'SCORE'}"
   - Health/lives display in top-right with label "${specSheet.healthLabel || 'LIVES'}"
   - Use the accent color (${specSheet.accentColor}) for HUD text.
   - Font: ctx.font = 'bold 20px sans-serif';
   - Add a semi-transparent dark bar behind the HUD for readability.

7. GAME STATES (MANDATORY):
   - Implement 3 states: 'MENU', 'PLAYING', 'GAMEOVER'
   - MENU: Show game title centered, "TAP TO START" instruction. Transition to PLAYING on touch.
   - PLAYING: The actual game loop.
   - GAMEOVER: Show "${specSheet.gameOverTitle || 'GAME OVER'}", final score, "TAP TO RESTART".

8. GAME FEEL / JUICE (MANDATORY):
   - Screen shake on damage (offset canvas translate by random ±5px for 10 frames).
   - Flash effect on hit (brief red overlay).
   - Score pop animation (briefly scale up score text on increment).
   - Particle burst on collectible pickup (8-12 small circles that fade out).
   - Smooth entity movement with delta-time (not frame-dependent).

9. COLLISION DETECTION:
   - Use simple circle-circle or AABB collision.
   - function circleCollision(a, b, rA, rB) { return Math.hypot(a.x-b.x, a.y-b.y) < rA + rB; }

10. ENEMY AI:
    - Enemies MUST move toward the player or spawn from edges.
    - Enemies must be constrained within screen bounds.
    - Increase difficulty over time (faster enemies, more spawns).

11. PERFORMANCE:
    - Use requestAnimationFrame for the game loop.
    - Delta-time based movement: let dt = (now - lastTime) / 1000;
    - Cap delta time: dt = Math.min(dt, 0.05);
    - Clear canvas each frame: ctx.clearRect(0, 0, canvas.width, canvas.height);

12. ERROR SAFETY:
    - Wrap the entire game in a try/catch.
    - If ANY error occurs, display it visually on screen (not just console).

13. NO BLANK SCREENS:
    - The background color (${specSheet.backgroundColor}) must ALWAYS be visible.
    - The canvas must ALWAYS render something — even during state transitions.

14. SOUND (OPTIONAL BUT PREFERRED):
    - Use Web Audio API for simple synthesized sounds if possible.
    - At minimum: collect sound (short ascending beep), hit sound (low thud), game over sound.

OUTPUT FORMAT:
Return ONLY the complete HTML code. Start with <!DOCTYPE html> and end with </html>.
Do NOT wrap in markdown code blocks. Do NOT include any explanation text.
Just the raw HTML.`;
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

  return rawHtml;
}
