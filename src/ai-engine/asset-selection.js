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
