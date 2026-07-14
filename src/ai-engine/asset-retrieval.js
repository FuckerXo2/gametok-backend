/**
 * v2 per-asset retrieval — searches the v2 catalog (180 curated animated character/creature/vehicle
 * sprites) instead of the legacy 39k-item pool.
 *
 * The old catalog mixed characters with tiles, HUD icons, static props, and modular parts, so
 * "find me a hoop" could return anything from a real basketball hoop to a floor tile that shared a
 * few tokens. v2 is curated to only ship things a game can actually render as an animated sprite,
 * with controlled-enum labels (asset_type, species, animation_type, perspective, movement, theme,
 * playable_role) that anchor the embedding on the axes the design planner queries.
 *
 * Backward compatibility: the return shape includes legacy fields (`role`, `orientation`, `url`,
 * `description`) so existing prompt-formatting code in maker-claude-style-prompt.js keeps working
 * while it also gets the new v2 fields (`animation_type`, `species`, `atlas_url`, `atlas_animations`,
 * `canvas_size`) for real Phaser atlas wiring.
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
    const raw = fs.readFileSync(path.join(__dirname, 'v2-asset-embeddings.json'), 'utf8');
    const data = JSON.parse(raw);
    for (const item of data.items) {
      const buf = Buffer.from(item.vec, 'base64');
      item.vecArr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }
    cache = data;
    console.log(`✅ v2 asset embeddings loaded: ${data.items.length} items, ${data.dimension}d`);
    return cache;
  } catch (err) {
    console.warn('⚠️  v2-asset-embeddings.json not found — run: node scripts/v2-build-embeddings.mjs');
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

// Map v2 asset_type → legacy role bucket so downstream role-grouping code keeps working.
// character/creature both bucket to 'character' (grouped visually as one class); vehicle stays.
function assetTypeToRole(assetType) {
  return assetType === 'vehicle' ? 'vehicle' : 'character';
}

function shapeItem(v2, score) {
  return {
    // Legacy fields (used by maker-claude-style-prompt.js's groupByRole + formatGroupedAssets)
    id: v2.id,
    role: assetTypeToRole(v2.asset_type),
    orientation: v2.perspective,
    url: v2.r2?.sheet_url,
    description: v2.description,
    width: v2.canvas_size?.w,
    height: v2.canvas_size?.h,
    pack: v2.source_pack,
    // v2 fields — the builder uses these to load atlases and play animations correctly.
    asset_type: v2.asset_type,
    species: v2.species,
    motion: v2.motion || 'animated',
    animation_type: v2.animation_type,
    perspective: v2.perspective,
    movement: v2.movement,
    theme: v2.theme,
    playable_role: v2.playable_role,
    frame_count: v2.frame_count,
    canvas_size: v2.canvas_size,
    quality_score: v2.quality_score,
    atlas_url: v2.r2?.atlas_url,
    atlas_animations: v2.atlas_animations,
    score,
  };
}

/**
 * Cosine-rank search over the v2 catalog for one already-embedded query vector.
 * @param {Float32Array} queryVec
 * @param {{topK?: number, orientation?: string, excludeIds?: Set<string>, preferPacks?: string[]}} opts
 */
function searchByVector(queryVec, { topK = 3, orientation = null, excludeIds = null, preferPacks = null } = {}) {
  const data = loadAssetEmbeddings();
  if (!data) return [];
  const preferSet = preferPacks?.length ? new Set(preferPacks.map(p => p.toLowerCase())) : null;
  const scored = [];
  for (const item of data.items) {
    if (excludeIds?.has(item.id)) continue;
    // Orientation filter — v2 items use `perspective` (side | top_down | isometric | front).
    // Only enforce when the caller requested one; still allow items marked with a compatible view.
    if (orientation && item.perspective !== orientation) continue;
    let score = cosine(queryVec, item.vecArr);
    // Pack-affinity bonus: keep art style coherent within one game. Calibrated the same way as the
    // legacy catalog — gate at a plausibility floor so unrelated items from the same pack don't
    // steamroll a genuinely-better sibling from another pack. 0.50 floor holds for the same reason.
    const PACK_AFFINITY_FLOOR = 0.50;
    if (preferSet?.has((item.source_pack || '').toLowerCase()) && score >= PACK_AFFINITY_FLOOR) score += 0.18;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => shapeItem(s.item, s.score));
}

/**
 * Batch-search N entities in one OpenAI call (cheap: entities are short phrases).
 * @param {string[]} entities e.g. ["basketball player", "goal", "puck"]
 * @param {{topKPerEntity?: number, orientation?: string, preferPacks?: string[], softOrientation?: boolean}} opts
 *   softOrientation: if the orientation filter starves an entity to zero matches, retry that entity
 *   without the filter — a side-view player on a top-down concept beats no player at all, and the
 *   catalog is heavily side-view (144 side vs ~10 top_down), so hard filtering starves often.
 * @returns {Promise<{entity: string, matches: object[]}[]>}
 */
export async function retrieveAssetsForEntities(entities, { topKPerEntity = 3, orientation = null, preferPacks = null, softOrientation = false } = {}) {
  const data = loadAssetEmbeddings();
  const c = getClient();
  if (!data || !c || !entities?.length) return [];

  try {
    const result = await c.embeddings.create({ model: MODEL, input: entities, dimensions: DIMENSIONS });
    const results = [];
    const seen = new Set();
    for (let i = 0; i < entities.length; i++) {
      const queryVec = new Float32Array(result.data[i].embedding);
      let matches = searchByVector(queryVec, { topK: topKPerEntity, orientation, excludeIds: seen, preferPacks });
      if (!matches.length && orientation && softOrientation) {
        matches = searchByVector(queryVec, { topK: topKPerEntity, orientation: null, excludeIds: seen, preferPacks });
      }
      matches.forEach(m => seen.add(m.id));
      results.push({ entity: entities[i], matches });
    }
    return results;
  } catch (err) {
    console.error('⚠️  Entity retrieval failed:', err.message);
    return [];
  }
}

/**
 * Compact, dynamically-generated summary of what the v2 catalog can actually cast — fed to the
 * design step so plans are grounded in real inventory instead of speculation. Groups by
 * asset_type + motion, lists species with counts and available perspectives, and states the
 * catalog-wide perspective reality (heavily side-view) so the designer picks fulfillable camera angles.
 */
export function getCatalogSummary() {
  const data = loadAssetEmbeddings();
  if (!data) return '(catalog unavailable)';
  const groups = new Map(); // "asset_type|motion" -> Map(species -> {count, perspectives:Set})
  const perspTotals = {};
  for (const it of data.items) {
    const motion = it.motion || 'animated';
    const gk = `${it.asset_type}|${motion}`;
    if (!groups.has(gk)) groups.set(gk, new Map());
    const g = groups.get(gk);
    if (!g.has(it.species)) g.set(it.species, { count: 0, perspectives: new Set(), anims: new Set() });
    const s = g.get(it.species);
    s.count++;
    s.perspectives.add(it.perspective);
    if (motion === 'animated') s.anims.add(it.animation_type);
    perspTotals[it.perspective] = (perspTotals[it.perspective] || 0) + 1;
  }
  const order = ['character|animated', 'creature|animated', 'vehicle|animated', 'character|static', 'creature|static', 'vehicle|static'];
  const lines = [];
  for (const gk of order) {
    if (!groups.has(gk)) continue;
    const [type, motion] = gk.split('|');
    const speciesEntries = [...groups.get(gk).entries()].sort((a, b) => b[1].count - a[1].count);
    const parts = speciesEntries.map(([sp, s]) => {
      const persp = [...s.perspectives].join('/');
      const anims = motion === 'animated' ? `; anims: ${[...s.anims].slice(0, 6).join(',')}` : '';
      return `${sp} ×${s.count} (${persp}${anims})`;
    });
    lines.push(`${type.toUpperCase()}S — ${motion.toUpperCase()}: ${parts.join(' · ')}`);
  }
  const perspLine = Object.entries(perspTotals).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}: ${c}`).join(', ');
  lines.push(`PERSPECTIVE REALITY: ${perspLine} — the catalog is overwhelmingly SIDE-VIEW. Design side-view games unless the concept truly demands otherwise.`);
  return lines.join('\n');
}
