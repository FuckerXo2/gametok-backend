/**
 * Model-in-the-loop asset selection (prevention, not cure).
 *
 * The old pipeline let a single embedding cosine-rank DECIDE which packs a game got, then handed
 * the blind generator a hard-constrained shortlist ("only use these"). Any mistake in that dumb
 * ranking (a generic-filler spec, an odd phrasing, a wrong orientation guess) shipped a broken game
 * and the generator couldn't recover — it only saw the post-filter list.
 *
 * Here the embedding step is demoted to RECALL (a wide candidate net). A fast model does the actual
 * SELECTION: given the game concept and the candidate packs' contents, it picks the packs this game
 * genuinely needs and the camera orientation — the way a designer would. Runs on DeepSeek V4 Flash
 * (non-thinking mode) — same vendor/key as generation, but the fast tier, so this never becomes the
 * latency bottleneck DeepSeek V4 Pro (reasoning) would.
 */
import { isDeepSeekPrimaryEnabled, callDeepSeekFlashJson } from './deepseek-text-client.js';

const SELECTION_MODEL = process.env.GAMETOK_SELECTION_MODEL || 'deepseek-v4-flash';

const SYSTEM = `You are a game asset director. Given a game concept and a list of candidate asset packs
(each with its name, sample contents, gameplay roles, and camera perspective), decide which packs this
specific game actually needs, and what camera orientation the game should use.

Think like a designer building THIS game:
- Pick packs whose contents match the game's real entities (a basketball game needs a ball + players +
  a court; a tank game needs tanks, not spaceships).
- Prefer 1-4 packs that TOGETHER cover the needed roles (player, ground/background, obstacles/enemies,
  pickups). Don't pad with loosely-related packs — a wrong-theme pack pollutes the game.
- Orientation: "top_down" (overhead), "side" (platformer/side view), or "isometric". Pick what fits the
  game AND the chosen packs' perspective.
- If NONE of the candidates genuinely fit the concept, set "packs" to [] and "drawInstead" to true —
  it's better to code-draw than to force mismatched art.

Return ONLY JSON: {"packs": ["Exact Pack Name", ...], "orientation": "top_down|side|isometric", "drawInstead": false, "reason": "one short sentence"}
Pack names MUST match the candidate names exactly.`;

/**
 * @param {{concept: string, candidates: {pack: string, text: string}[]}} args
 * @returns {Promise<{packs: string[], orientation: string|null, drawInstead: boolean, reason: string}|null>}
 *   null on failure (caller should fall back to embedding rank + regex orientation)
 */
export async function selectPacksWithModel({ concept, candidates }) {
  if (!isDeepSeekPrimaryEnabled() || !candidates?.length) return null;

  const candidateBlock = candidates.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
  const user = `GAME CONCEPT:\n${concept}\n\nCANDIDATE PACKS:\n${candidateBlock}`;

  try {
    const parsed = await callDeepSeekFlashJson({
      systemPrompt: SYSTEM,
      messages: [{ role: 'user', content: user }],
      maxTokens: 400,
      temperature: 0.2,
      model: SELECTION_MODEL,
    });
    const valid = new Set(candidates.map(p => p.pack));
    const packs = Array.isArray(parsed.packs) ? parsed.packs.filter(p => valid.has(p)) : [];
    const orientation = ['top_down', 'side', 'isometric'].includes(parsed.orientation) ? parsed.orientation : null;
    const drawInstead = parsed.drawInstead === true || (packs.length === 0 && !valid.has(parsed.packs?.[0]));
    console.log(`🎯 Model asset-selection (${SELECTION_MODEL}): [${packs.join(', ')}] orient=${orientation} — ${parsed.reason || ''}`);
    return { packs, orientation, drawInstead, reason: parsed.reason || '' };
  } catch (err) {
    console.error('⚠️  Model asset-selection failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-ENTITY RETRIEVAL (RAG) — the actual fix for "the hoop got crowded out by 13
// generic siblings." Instead of picking PACKS and hoping the right ITEM survives the
// perRole cap downstream, this lists the concrete visual entities the game needs, so
// each one can be searched for directly (see asset-retrieval.js).
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_SYSTEM = `You are a game asset director. Given a game concept, list the concrete VISUAL
entities this specific game needs as sprites — the things a player would actually see on screen.

Rules:
- Be concrete and specific: "basketball hoop", not "sports equipment". "basketball", not "ball".
- Include: the player character(s)/vehicle, the ball/weapon/tool they use, the ground/court/track,
  obstacles or enemies, collectibles, and any distinctive prop the concept implies (a hoop for
  basketball, a net for volleyball, a shark for a shark-chase game).
- 4-8 entities. Do not include HUD/UI text, sound, or particle effects — those are code-drawn.
- Each entity is a short noun phrase (2-4 words), not a sentence.

Return ONLY JSON: {"entities": ["basketball hoop", "basketball", "player character", "court ground", ...]}`;

/**
 * @param {string} concept - the game concept/prompt
 * @returns {Promise<string[]>} concrete visual entities, or [] on failure
 */
export async function listRequiredEntities(concept) {
  if (!isDeepSeekPrimaryEnabled()) return [];
  try {
    const parsed = await callDeepSeekFlashJson({
      systemPrompt: ENTITY_SYSTEM,
      messages: [{ role: 'user', content: `GAME CONCEPT:\n${concept}` }],
      maxTokens: 250,
      temperature: 0.3,
      model: SELECTION_MODEL,
    });
    const entities = Array.isArray(parsed.entities) ? parsed.entities.filter(e => typeof e === 'string' && e.trim()) : [];
    console.log(`📋 Required entities (${SELECTION_MODEL}): [${entities.join(', ')}]`);
    return entities;
  } catch (err) {
    console.error('⚠️  Entity listing failed:', err.message);
    return [];
  }
}
