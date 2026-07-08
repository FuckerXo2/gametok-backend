import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory catalog cache
let catalogCache = null;
let catalogLoadedAt = null;

/**
 * Load catalog from disk into memory
 * @returns {Object|null} The loaded catalog or null if failed
 */
function loadCatalog() {
  const catalogPath = path.join(__dirname, 'phaser-cdn-catalog.json');
  
  try {
    const catalogData = fs.readFileSync(catalogPath, 'utf8');
    catalogCache = JSON.parse(catalogData);
    catalogLoadedAt = Date.now();
    console.log(`✅ Asset catalog loaded: ${catalogCache.metadata.totalAssets} assets`);
    return catalogCache;
  } catch (err) {
    console.warn('⚠️  Failed to load asset catalog:', err.message);
    console.warn('   Run: node src/ai-engine/build-catalog.js');
    return null;
  }
}

/**
 * Get catalog from cache, loading if necessary (lazy loading)
 * @returns {Object|null} The catalog or null if not available
 */
export function getCatalog() {
  if (!catalogCache) {
    loadCatalog();
  }
  return catalogCache;
}

/**
 * Filter catalog by theme keywords
 * @param {string[]} themes - Array of theme keywords to filter by
 * @param {number} limit - Maximum number of assets to return (default: 100)
 * @returns {Object[]} Array of matching assets
 */
export function getAssetsByTheme(themes, limit = 100) {
  const catalog = getCatalog();
  if (!catalog) return [];
  
  const themeSet = new Set(themes.map(t => t.toLowerCase()));
  
  // Filter assets matching any theme
  const filtered = catalog.assets.filter(asset => 
    asset.themes.some(theme => themeSet.has(theme.toLowerCase()))
  );
  
  // Return top N assets
  return filtered.slice(0, limit);
}

/**
 * Get diverse sample across all themes
 * @param {number} limit - Maximum number of assets to return (default: 100)
 * @returns {Object[]} Array of diverse assets across themes
 */
export function getDiverseSample(limit = 100) {
  const catalog = getCatalog();
  if (!catalog) return [];
  
  const themeList = Object.keys(catalog.themes);
  if (themeList.length === 0) return [];
  
  const samplesPerTheme = Math.ceil(limit / themeList.length);
  const samples = [];
  
  for (const theme of themeList) {
    const themeAssets = catalog.assets
      .filter(asset => asset.themes.includes(theme))
      .slice(0, samplesPerTheme);
    samples.push(...themeAssets);
  }
  
  return samples.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED CATALOG (Kenney 2D + re-tagged Phaser), honest schema:
//   { id, source, url, type, theme[], role, orientation, description, width, height, tileable, pack }
// The generation model is blind, so entries are grouped by ROLE and filtered by ORIENTATION at
// prompt time — that's what stops a side-view poster being used as a top-down road.
// ─────────────────────────────────────────────────────────────────────────────
let unifiedCache = null;
function loadUnifiedCatalog() {
  if (unifiedCache) return unifiedCache;
  const sources = ['kenney2d-catalog.json', 'phaser-catalog-normalized.json', 'cooking-catalog.json', 'diner-catalog.json'];
  const merged = [];
  for (const f of sources) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
      if (Array.isArray(data.assets)) merged.push(...data.assets);
    } catch (err) {
      console.warn(`⚠️  Unified catalog: could not load ${f}: ${err.message}`);
    }
  }
  unifiedCache = merged;
  if (merged.length) console.log(`✅ Unified asset catalog: ${merged.length} assets (Kenney 2D + Phaser)`);
  return unifiedCache;
}

export function getUnifiedCatalog() { return loadUnifiedCatalog(); }

// Role buckets a 2D game actually wires, in prompt-presentation order.
const ROLE_ORDER = ['vehicle', 'character', 'ground', 'obstacle', 'pickup', 'served', 'projectile', 'background', 'prop', 'ui', 'audio'];

/**
 * Pick real, correctly-oriented assets for a game, grouped by role.
 * @param {{themes?: string[], packs?: string[], orientation?: string, perRole?: number}} opts
 *   `packs` — pack names from embedding search (semantic); takes priority over `themes` (regex).
 *   `themes` — legacy keyword themes; used as fallback when embeddings are unavailable.
 * @returns {Object<string, Object[]>} role -> assets
 */
export function selectGameAssets({ themes = [], packs = [], orientation = null, perRole = 14 } = {}) {
  const all = loadUnifiedCatalog();
  if (!all.length) return {};
  const themeSet = new Set(themes.map((t) => t.toLowerCase()));
  const packSet = new Set(packs.map((p) => p.toLowerCase()));
  const hasPackFilter = packSet.size > 0;
  const hasThemeFilter = themeSet.size > 0;

  const matchesFilter = (a) => {
    if (!hasPackFilter && !hasThemeFilter) return true;
    if (hasPackFilter && packSet.has((a.pack || '').toLowerCase())) return true;
    if (hasThemeFilter && (a.theme || []).some((t) => themeSet.has(t.toLowerCase()))) return true;
    return false;
  };
  // Orientation filter: keep exact matches + orientation-agnostic roles (ui/audio/pickup often n_a or
  // unknown). Never let a 'side' sprite into a 'top_down' game's gameplay roles.
  const AGNOSTIC_ROLES = new Set(['ui', 'audio', 'pickup', 'served']);
  const matchesOrient = (a) => {
    if (!orientation) return true;
    if (AGNOSTIC_ROLES.has(a.role)) return true;
    return a.orientation === orientation || a.orientation === 'unknown' || a.orientation === 'n_a';
  };
  const JUNK_PACK = /axonometric|block pack|prototype|development essentials|pattern pack|letter tiles|abstract platformer|shape characters/i;
  const isJunk = (a) => JUNK_PACK.test(a.pack || '')
    || /abstracttile|prototype|placeholder|blank|patternpack/i.test(a.localPath || '');
  const rank = (a) => {
    let r = 0;
    if (isJunk(a)) r += 1000;
    r += (a.source === 'kenney2d' ? 0 : 20);
    r += (a.orientation === orientation ? 0 : 10);
    if (hasPackFilter && packSet.has((a.pack || '').toLowerCase())) r -= 10;
    if (hasThemeFilter && (a.theme || []).some((t) => themeSet.has(t.toLowerCase()))) r -= 5;
    return r;
  };

  const familyKey = (a) => `${a.role}:${(a.localPath || a.url || '').toLowerCase().replace(/[_-]?\d+(\.\w+)?$/, '')}`;

  // Dedup near-duplicate variants, append onto `picks`, stop at perRole. Mutates seen/picks.
  const takeFrom = (ranked, seen, picks) => {
    for (const a of ranked) {
      if (picks.length >= perRole) break;
      const k = familyKey(a);
      if (seen.has(k)) continue;
      seen.add(k);
      picks.push(a);
    }
  };

  // Gameplay roles the model NEEDS to build a coherent game. If orientation filtering empties one of
  // these, we'd starve the model into inventing off-theme art (e.g. a diving prompt matched the right
  // pirate/nautical packs, but every ship is `side` orientation, so a top_down filter left vehicle +
  // character empty and the model fell back to leftover space-shooter props). So: keep orientation
  // strict when it yields enough, but backfill from the SAME theme/pack pool ignoring orientation when
  // a gameplay role comes up short. A slightly-wrong-angle on-theme sprite beats an off-theme one.
  const GAMEPLAY_ROLES = new Set(['vehicle', 'character', 'ground', 'obstacle', 'pickup', 'projectile']);
  const MIN_PER_GAMEPLAY_ROLE = 3;

  const grouped = {};
  for (const role of ROLE_ORDER) {
    const themed = all.filter((a) => a.role === role && matchesFilter(a));
    const strict = themed.filter(matchesOrient).sort((x, y) => rank(x) - rank(y));

    const seen = new Set();
    const picks = [];
    takeFrom(strict, seen, picks);

    // Backfill starved gameplay roles from the same on-theme pool, relaxing orientation only.
    if (GAMEPLAY_ROLES.has(role) && picks.length < MIN_PER_GAMEPLAY_ROLE) {
      const relaxed = themed.filter((a) => !matchesOrient(a)).sort((x, y) => rank(x) - rank(y));
      takeFrom(relaxed, seen, picks);
    }

    if (picks.length) grouped[role] = picks;
  }
  return grouped;
}

// Load catalog on module import for automatic initialization
loadCatalog();
loadUnifiedCatalog();
