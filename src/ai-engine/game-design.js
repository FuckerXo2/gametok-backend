/**
 * Design-first game planning — the "actually think about what you're building" step.
 *
 * v2 rework: the plan is grounded in a SUMMARY OF THE REAL v2 SPRITE CATALOG (species, counts,
 * perspectives, animated-vs-static) instead of the old pack-recall layer, which described a catalog
 * that no longer exists. The designer also tags every entity with HOW it will be rendered:
 *   - render:"sprite" — characters / creatures / vehicles, cast from the catalog (these drive RAG)
 *   - render:"code"   — environment, props, projectiles, effects, UI — drawn with Phaser graphics
 * This is the enforcement point for the two-bucket visual rule: sprites carry identity (faces,
 * silhouettes), code draws everything else better than a tiled texture ever did.
 *
 * Flash + low reasoning effort: ~3-6s, cheap. Bump GAMETOK_DESIGN_MODEL if it proves too shallow.
 */
import { isDeepSeekPrimaryEnabled, callDeepSeekFlashJson } from './deepseek-text-client.js';

const DESIGN_MODEL = process.env.GAMETOK_DESIGN_MODEL || 'deepseek-v4-flash';

const SYSTEM = `You are a senior mobile game designer. Given a game concept (a one-line idea from a user)
AND a summary of the sprite catalog that is actually available, produce a concrete design plan
GROUNDED IN THE AVAILABLE ART. The plan drives both asset retrieval and code generation, so it must
be specific enough that a builder could implement it without asking questions.

Think like a designer for a 15-second-to-fun TikTok-style vertical mobile game:
- The game runs in a vertical portrait window, plays with touch (drag + tap only, no keyboard).
- It should feel complete in seconds — a clear goal, immediate feedback, a satisfying loop.
- Choose ONE tight core loop. Do NOT invent extra modes, multiplayer, upgrades, or shops.

HOW THINGS GET RENDERED — tag every entity with "render":
- "sprite": ONLY characters, creatures, and vehicles — they are cast from the sprite catalog below.
  Pick entities the catalog can actually fulfil (e.g. if the concept needs a monster and the catalog
  has golems/trolls/ogres, name it "stone golem monster" so retrieval finds it). Some catalog sprites
  are ANIMATED (walk/attack/idle cycles), some are STATIC (single image the game moves with code —
  perfect for vehicles and boss monsters).
- "code": EVERYTHING ELSE — ground, sky, court, track, walls, hoops, goals, balls, coins, bullets,
  obstacles, platforms, particles, HUD. The builder draws these with layered Phaser graphics
  (gradients, silhouettes, textured detail). There are NO prop/environment sprites — do not invent them.

ORIENTATION must match the art you cast:
- Check each sprite entity's available perspectives in the catalog summary. If your player character
  only exists side-view, design a side-view game.
- Only pick "top_down" if the concept truly demands it AND top-down sprites exist for the entities
  (mostly ships/UFOs). "isometric" only fits the boat fleet.

WHEN TWO SPRITE ENTITIES PLAY A SIMILAR ROLE (e.g. two players in a 1v1, a player and a same-species
rival), give each a DISTINCT name so retrieval doesn't cast two copies of the same character. Check
the catalog summary for which distinguishing axis that species actually has:
- Aliens, robots, UFOs, and most vehicles come in color variants (blue/green/red/yellow) — use color
  for these: "blue robot" + "red robot".
- Humans in this catalog are NOT color-coded — they are distinct named characters (adventurer,
  soldier, zombie, mage, knight, etc.). For two human entities, name each a DIFFERENT character/class,
  never a color: "adventurer player character" + "soldier player character", not "blue human" +
  "red human" (that will retrieve wrong-species nonsense — there is no red human in the catalog).
When unsure whether a species has color variants, default to distinguishing by class/species/name
rather than guessing a color exists. Never name two sprite entities identically.

Return ONLY JSON, no prose, no markdown fences:
{
  "coreLoop": "2-3 sentences describing what the player DOES moment-to-moment and why it feels good.",
  "dimension": "2D" | "3D",
  "orientation": "side" | "top_down" | "isometric",
  "entities": [
    { "name": "concrete visual noun retrieval can search (e.g. \\"zombie enemy\\", \\"basketball hoop\\")",
      "render": "sprite" | "code",
      "role": "player" | "enemy" | "npc" | "object" }
  ],
  "layout": "1-2 sentences describing where things live on the vertical screen (top/middle/bottom).",
  "controls": "1 sentence describing the ONE primary touch gesture and what it does.",
  "winCondition": "How the player wins (concrete: 'score 3 baskets', 'survive 60 seconds').",
  "loseCondition": "How the player loses (or 'none' if it's a score-attack).",
  "hud": ["3-5 short strings — the on-screen readouts (e.g. \\"score\\", \\"time left\\")"]
}
"dimension" rules:
- "3D" if the concept genuinely requires depth, perspective cameras, or 3D physics (e.g. racing,
  flight sim, FPS, open-world exploration, Rocket League, Minecraft-style, any game where the camera
  moves through a 3D world). The builder will use Three.js.
- "2D" for everything else — side-scrollers, top-down, puzzle, card, arcade. The builder will use
  Phaser, Canvas, or CSS/DOM.
List 4-8 entities total. Every entity must appear on screen. No HUD/text/sound as entities.`;

/**
 * @param {string} concept - the raw game concept from the user
 * @param {{catalogSummary?: string}} [opts] - compact v2 catalog inventory (from getCatalogSummary())
 * @returns {Promise<null | {
 *   coreLoop: string,
 *   orientation: 'side'|'top_down'|'isometric',
 *   entities: {name: string, render: 'sprite'|'code', role: string}[],
 *   layout: string,
 *   controls: string,
 *   winCondition: string,
 *   loseCondition: string,
 *   hud: string[],
 * }>} the plan, or null on failure (caller falls back to shallow entity listing)
 */
export async function designGamePlan(concept, { catalogSummary = '' } = {}) {
  if (!isDeepSeekPrimaryEnabled()) return null;
  try {
    const catalogBlock = catalogSummary
      ? `\n\nSPRITE CATALOG (this is ALL the sprite art that exists — cast from it, code-draw everything else):\n${catalogSummary}`
      : '';
    const parsed = await callDeepSeekFlashJson({
      systemPrompt: SYSTEM,
      messages: [{ role: 'user', content: `GAME CONCEPT:\n${concept}${catalogBlock}` }],
      maxTokens: 1400,
      temperature: 0.4,
      model: DESIGN_MODEL,
      reasoningEffort: 'low',
    });
    // Validate essentials — a broken plan degrades to the shallow entity flow, never drives garbage.
    const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
    const entities = rawEntities
      .filter(e => e && typeof e.name === 'string' && e.name.trim())
      .map(e => ({
        name: e.name.trim(),
        render: e.render === 'sprite' ? 'sprite' : 'code',
        role: typeof e.role === 'string' ? e.role : 'object',
      }));
    const orientation = ['top_down', 'side', 'isometric'].includes(parsed.orientation) ? parsed.orientation : null;
    if (!entities.length || !orientation) return null;

    const plan = {
      coreLoop: String(parsed.coreLoop || '').trim(),
      dimension: parsed.dimension === '3D' ? '3D' : '2D',
      orientation,
      entities,
      layout: String(parsed.layout || '').trim(),
      controls: String(parsed.controls || '').trim(),
      winCondition: String(parsed.winCondition || '').trim(),
      loseCondition: String(parsed.loseCondition || '').trim(),
      hud: Array.isArray(parsed.hud) ? parsed.hud.filter(h => typeof h === 'string' && h.trim()) : [],
    };
    const spriteNames = plan.entities.filter(e => e.render === 'sprite').map(e => e.name);
    const codeNames = plan.entities.filter(e => e.render === 'code').map(e => e.name);
    console.log(`🧠 Game plan (${DESIGN_MODEL}):`);
    console.log(`   Dimension: ${plan.dimension}`);
    console.log(`   Core loop: ${plan.coreLoop}`);
    console.log(`   Orientation: ${plan.orientation}`);
    console.log(`   Sprite entities: [${spriteNames.join(', ')}]`);
    console.log(`   Code-drawn entities: [${codeNames.join(', ')}]`);
    console.log(`   Win: ${plan.winCondition} · Lose: ${plan.loseCondition}`);
    return plan;
  } catch (err) {
    console.error('⚠️  Game plan generation failed:', err.message);
    return null;
  }
}

/**
 * Render the plan as a human-readable block injected into the builder's user prompt. The builder's
 * system prompt teaches HOW to build; this says WHAT to build — including which entities come from
 * the AVAILABLE ASSETS list vs which the builder must draw with graphics.
 */
export function formatPlanForBuilder(plan) {
  if (!plan) return '';
  const spriteEntities = plan.entities.filter(e => e.render === 'sprite');
  const codeEntities = plan.entities.filter(e => e.render === 'code');
  return `# GAME DESIGN (build EXACTLY this — do not invent extra modes or scope)

Dimension: ${plan.dimension}
Core loop: ${plan.coreLoop}
Camera: ${plan.orientation}
Layout: ${plan.layout}
Primary control: ${plan.controls}
Win condition: ${plan.winCondition}
Lose condition: ${plan.loseCondition}
HUD readouts: ${plan.hud.join(', ')}

SPRITE entities — cast from the AVAILABLE ASSETS list above (each was retrieved for this design):
${spriteEntities.map(e => `- ${e.name} (${e.role})`).join('\n') || '- (none — this game is fully code-drawn)'}

CODE-DRAWN entities — draw these with layered Phaser graphics, NOT sprites (none exist for them):
${codeEntities.map(e => `- ${e.name} (${e.role})`).join('\n') || '- (none)'}`;
}
