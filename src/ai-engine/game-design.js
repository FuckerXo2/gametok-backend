/**
 * Design-first game planning — the "actually think about what you're building" step.
 *
 * Before this, the pipeline was assets-first: shallow entity-list off the raw concept → retrieve →
 * builder makes it up as it goes. The builder's reasoning was invisible (we throw away
 * reasoning_content), so nothing forced a real design decision anywhere. Games came out lazy-shaped
 * — right assets, wrong game.
 *
 * Now: DeepSeek Flash produces a structured plan up front (core loop, entities, layout, controls,
 * win condition, HUD). That plan drives BOTH the RAG asset retrieval (entities the design ACTUALLY
 * needs, not a guess) AND is passed as explicit context to the builder call — so the builder is no
 * longer wandering into the design; it's executing one. The plan is logged, which also finally
 * makes the design step visible in generation logs.
 *
 * Flash + `reasoning_effort: 'low'` (some thinking, not the wide-eyed non-thinking mode used for
 * pure routing tasks like pack selection). ~3-6s, cheap. If Flash proves too shallow we can bump
 * to V4 Pro without changing the callsite.
 */
import { isDeepSeekPrimaryEnabled, callDeepSeekFlashJson } from './deepseek-text-client.js';

const DESIGN_MODEL = process.env.GAMETOK_DESIGN_MODEL || 'deepseek-v4-flash';

const SYSTEM = `You are a senior mobile game designer. Given a game concept (a one-line idea from a user),
produce a concrete, buildable design plan. The plan will drive both asset retrieval and code
generation, so it must be specific enough that a builder could implement it without asking questions.

Think like a designer for a 15-second-to-fun TikTok-style vertical mobile game:
- The game runs in a vertical portrait window, plays with touch (drag + tap only, no keyboard).
- It should feel complete in seconds — a clear goal, immediate feedback, a satisfying loop.
- Choose ONE tight core loop. Do NOT invent extra modes, multiplayer, upgrades, or shops.
- Every entity you list must appear on screen. Do NOT list HUD/UI text or sound as entities.

Return ONLY JSON, no prose, no markdown fences:
{
  "coreLoop": "2-3 sentences describing what the player DOES moment-to-moment and why it feels good.",
  "orientation": "top_down" | "side" | "isometric",
  "entities": ["4-8 concrete visual nouns — the sprites the game needs (e.g. \\"basketball hoop\\", \\"player character\\", \\"court ground\\")"],
  "layout": "1-2 sentences describing where things live on the vertical screen (top/middle/bottom).",
  "controls": "1 sentence describing the ONE primary touch gesture and what it does.",
  "winCondition": "How the player wins (must be concrete: 'score 3 baskets', 'survive 60 seconds').",
  "loseCondition": "How the player loses (or 'none' if it's a score-attack).",
  "hud": ["3-5 short strings — the on-screen readouts (e.g. \\"score\\", \\"time left\\", \\"turn indicator\\")"]
}`;

/**
 * @param {string} concept - the raw game concept from the user
 * @returns {Promise<null | {
 *   coreLoop: string,
 *   orientation: 'top_down'|'side'|'isometric',
 *   entities: string[],
 *   layout: string,
 *   controls: string,
 *   winCondition: string,
 *   loseCondition: string,
 *   hud: string[],
 * }>} the plan, or null on failure (caller falls back to shallow entity listing)
 */
export async function designGamePlan(concept) {
  if (!isDeepSeekPrimaryEnabled()) return null;
  try {
    const parsed = await callDeepSeekFlashJson({
      systemPrompt: SYSTEM,
      messages: [{ role: 'user', content: `GAME CONCEPT:\n${concept}` }],
      maxTokens: 1200,
      temperature: 0.4,
      model: DESIGN_MODEL,
      reasoningEffort: 'low',
    });
    // Validate essential fields — a broken plan should degrade to the old shallow entity flow,
    // not silently drive retrieval + build with garbage.
    const entities = Array.isArray(parsed.entities) ? parsed.entities.filter(e => typeof e === 'string' && e.trim()) : [];
    const orientation = ['top_down', 'side', 'isometric'].includes(parsed.orientation) ? parsed.orientation : null;
    if (!entities.length || !orientation) return null;

    const plan = {
      coreLoop: String(parsed.coreLoop || '').trim(),
      orientation,
      entities,
      layout: String(parsed.layout || '').trim(),
      controls: String(parsed.controls || '').trim(),
      winCondition: String(parsed.winCondition || '').trim(),
      loseCondition: String(parsed.loseCondition || '').trim(),
      hud: Array.isArray(parsed.hud) ? parsed.hud.filter(h => typeof h === 'string' && h.trim()) : [],
    };
    console.log(`🧠 Game plan (${DESIGN_MODEL}):`);
    console.log(`   Core loop: ${plan.coreLoop}`);
    console.log(`   Orientation: ${plan.orientation}`);
    console.log(`   Entities: [${plan.entities.join(', ')}]`);
    console.log(`   Layout: ${plan.layout}`);
    console.log(`   Controls: ${plan.controls}`);
    console.log(`   Win: ${plan.winCondition} · Lose: ${plan.loseCondition}`);
    console.log(`   HUD: [${plan.hud.join(', ')}]`);
    return plan;
  } catch (err) {
    console.error('⚠️  Game plan generation failed:', err.message);
    return null;
  }
}

/**
 * Render the plan as a human-readable block to inject into the builder's user prompt. Kept simple
 * and terse — the builder's system prompt already teaches HOW to build; this just says WHAT to build.
 */
export function formatPlanForBuilder(plan) {
  if (!plan) return '';
  return `# GAME DESIGN (build EXACTLY this — do not invent extra modes or scope)

Core loop: ${plan.coreLoop}
Camera: ${plan.orientation}
Layout: ${plan.layout}
Primary control: ${plan.controls}
Win condition: ${plan.winCondition}
Lose condition: ${plan.loseCondition}
HUD readouts: ${plan.hud.join(', ')}

The AVAILABLE ASSETS list above was retrieved specifically for this design — every entity the design needs (${plan.entities.join(', ')}) has candidate sprites in that list.`;
}
