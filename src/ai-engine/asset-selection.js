/**
 * Fallback entity listing for the v2 pipeline.
 *
 * The primary path is game-design.js: a full plan whose entities are tagged sprite|code. This
 * shallow lister only runs when the design step fails — it names the concrete CHARACTER / CREATURE /
 * VEHICLE entities a concept needs so entity-level RAG (asset-retrieval.js) can still cast the game.
 * Environment/props/objects are NOT listed — the v2 catalog has no sprites for them; they're
 * code-drawn by the builder.
 *
 * (The old selectPacksWithModel pack-selection layer lived here — deleted with the old catalog:
 * packs are no longer a selection unit, entity-level RAG + coherence re-rank replaced it.)
 */
import { isDeepSeekPrimaryEnabled, callDeepSeekFlashJson } from './deepseek-text-client.js';

const SELECTION_MODEL = process.env.GAMETOK_SELECTION_MODEL || 'deepseek-v4-flash';

const ENTITY_SYSTEM = `You are a game asset director. Given a game concept, list the LIVING THINGS and
VEHICLES this specific game needs as sprites — characters, creatures/animals/monsters, and vehicles
(cars, ships, planes, boats, UFOs) the player would see on screen.

Rules:
- ONLY characters, creatures, and vehicles. Do NOT list environment (ground, court, sky), props
  (hoops, goals, chests), balls/bullets/coins, HUD, sound, or effects — those are drawn in code.
- Be concrete and searchable: "zombie enemy", "knight player character", "alien UFO", not "enemy".
- 2-6 entities. Each is a short noun phrase (2-4 words).

Return ONLY JSON: {"entities": ["knight player character", "stone golem boss", ...]}`;

/**
 * @param {string} concept - the game concept/prompt
 * @returns {Promise<string[]>} concrete sprite-castable entities, or [] on failure
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
