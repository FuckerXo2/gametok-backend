/**
 * Per-ASSET retrieval — "find me a hoop", not "find me a pack that probably has one."
 *
 * This is the RAG loop the pack-level pipeline was missing: pack selection can correctly identify
 * that Sports Pack has a hoop, but the item itself can still get crowded out by generic siblings
 * before the generator ever sees it (perRole caps, tie-broken by array order). Searching per
 * CONCRETE ENTITY against individual asset embeddings sidesteps that entirely — you ask for a hoop,
 * you get a hoop, regardless of what pack/role bucket it's filed under.
 *
 * Flow (caller-orchestrated, see maker-claude-style-prompt.js):
 *   1. listRequiredEntities(concept)          — DeepSeek Flash: "basketball, hoop, court, player..."
 *   2. searchAssetsForEntity(entity) per item — cosine search over per-asset embeddings
 *   3. caller merges/dedupes/groups by role for the generator prompt
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;

let cache = null;
function loadAssetEmbeddings() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'asset-embeddings.json'), 'utf8');
    const data = JSON.parse(raw);
    // Decode base64 Float32 vectors once at load time, not per-query.
    for (const item of data.items) {
      const buf = Buffer.from(item.vec, 'base64');
      item.vecArr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }
    cache = data;
    console.log(`✅ Asset embeddings loaded: ${data.items.length} items, ${data.dimension}d`);
    return cache;
  } catch (err) {
    console.warn('⚠️  asset-embeddings.json not found — run: node scripts/build-asset-embeddings.mjs');
    return null;
  }
}

let client = null;
function getClient() {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.warn('⚠️  OPENAI_API_KEY not set — asset retrieval disabled'); return null; }
  client = new OpenAI({ apiKey: key });
  return client;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Search individual assets for a single concrete entity (e.g. "basketball hoop").
 * @param {Float32Array} queryVec - pre-embedded query (batch entities into one API call upstream)
 * @param {{topK?: number, orientation?: string, excludeIds?: Set<string>}} opts
 */
function searchByVector(queryVec, { topK = 3, orientation = null, excludeIds = null, preferPacks = null } = {}) {
  const data = loadAssetEmbeddings();
  if (!data) return [];
  const AGNOSTIC_ROLES = new Set(['ui', 'audio', 'pickup', 'served']);
  const preferSet = preferPacks?.length ? new Set(preferPacks.map(p => p.toLowerCase())) : null;
  const scored = [];
  for (const item of data.items) {
    if (excludeIds?.has(item.id)) continue;
    if (orientation && !AGNOSTIC_ROLES.has(item.role)) {
      if (item.orientation !== orientation && item.orientation !== 'unknown' && item.orientation !== 'n_a') continue;
    }
    let score = cosine(queryVec, item.vecArr);
    // Bonus for the game's already-identified "home" pack(s) — keeps art style coherent (e.g. a
    // basketball player from Sports Pack over an equally-plausible generic CDN humanoid). GATED on
    // a plausibility floor: only boost if the item was already a real (if second-place) contender —
    // otherwise the bonus steamrolls genuinely irrelevant items to the top. Measured calibration:
    // Sports Pack character scored 0.587 raw for "player character" (a real contender, should win
    // the tiebreak) vs Sports Pack's "goal block" at 0.426 raw for "court ground" — a pack that
    // legitimately has no court texture (an ungated bonus made that irrelevant item outrank real
    // floor textures). 0.50 sits cleanly between the two.
    const PACK_AFFINITY_FLOOR = 0.50;
    if (preferSet?.has((item.pack || '').toLowerCase()) && score >= PACK_AFFINITY_FLOOR) score += 0.18;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => ({ ...s.item, vecArr: undefined, vec: undefined, score: s.score }));
}

/**
 * Batch-search multiple entities in ONE embedding API call (cheap: entities are short phrases).
 * @param {string[]} entities - e.g. ["basketball", "hoop", "court ground", "player character"]
 * @param {{topKPerEntity?: number, orientation?: string}} opts
 * @returns {Promise<{entity: string, matches: object[]}[]>}
 */
export async function retrieveAssetsForEntities(entities, { topKPerEntity = 3, orientation = null, preferPacks = null } = {}) {
  const data = loadAssetEmbeddings();
  const c = getClient();
  if (!data || !c || !entities?.length) return [];

  try {
    const result = await c.embeddings.create({ model: MODEL, input: entities, dimensions: DIMENSIONS });
    const results = [];
    const seen = new Set(); // avoid the exact same sprite matching two entities and eating both slots
    for (let i = 0; i < entities.length; i++) {
      const queryVec = new Float32Array(result.data[i].embedding);
      const matches = searchByVector(queryVec, { topK: topKPerEntity, orientation, excludeIds: seen, preferPacks });
      matches.forEach(m => seen.add(m.id));
      results.push({ entity: entities[i], matches });
    }
    return results;
  } catch (err) {
    console.error('⚠️  Entity retrieval failed:', err.message);
    return [];
  }
}
