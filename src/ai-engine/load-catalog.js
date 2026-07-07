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
  const sources = ['kenney2d-catalog.json', 'phaser-catalog-normalized.json'];
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
const ROLE_ORDER = ['vehicle', 'character', 'ground', 'obstacle', 'pickup', 'projectile', 'background', 'prop', 'ui', 'audio'];

/**
 * Pick real, correctly-oriented assets for a game, grouped by role.
 * @param {{themes?: string[], orientation?: string, perRole?: number}} opts
 * @returns {Object<string, Object[]>} role -> assets
 */
export function selectGameAssets({ themes = [], orientation = null, perRole = 14 } = {}) {
  const all = loadUnifiedCatalog();
  if (!all.length) return {};
  const themeSet = new Set(themes.map((t) => t.toLowerCase()));

  const matchesTheme = (a) => themeSet.size === 0 || (a.theme || []).some((t) => themeSet.has(t.toLowerCase()));
  // Orientation filter: keep exact matches + orientation-agnostic roles (ui/audio/pickup often n_a or
  // unknown). Never let a 'side' sprite into a 'top_down' game's gameplay roles.
  const AGNOSTIC_ROLES = new Set(['ui', 'audio', 'pickup']);
  const matchesOrient = (a) => {
    if (!orientation) return true;
    if (AGNOSTIC_ROLES.has(a.role)) return true;
    return a.orientation === orientation || a.orientation === 'unknown' || a.orientation === 'n_a';
  };
  // Abstract/prototype/placeholder art (letter cubes, blank tiles, prototype textures, patterns) is
  // designed for greyboxing, not shipping. It was outranking real themed art — e.g. an iso survival
  // game rendered Axonometric-Blocks A/B/C letter cubes as "resources" instead of Isometric-Nature
  // trees. Push it to last-resort so real art always wins when it exists.
  const JUNK_PACK = /axonometric|block pack|prototype|development essentials|pattern pack|letter tiles|abstract platformer|shape characters/i;
  const isJunk = (a) => JUNK_PACK.test(a.pack || '')
    || /abstracttile|prototype|placeholder|blank|patternpack/i.test(a.localPath || '');
  // Lower rank = picked first. Layers: junk last, prefer honest Kenney labels, exact orientation,
  // and (when themes are requested) assets that actually carry the requested theme.
  const rank = (a) => {
    let r = 0;
    if (isJunk(a)) r += 1000;
    r += (a.source === 'kenney2d' ? 0 : 20);
    r += (a.orientation === orientation ? 0 : 10);
    if (themeSet.size && (a.theme || []).some((t) => themeSet.has(t.toLowerCase()))) r -= 5;
    return r;
  };

  const grouped = {};
  for (const role of ROLE_ORDER) {
    const picks = all
      .filter((a) => a.role === role && matchesTheme(a) && matchesOrient(a))
      .sort((x, y) => rank(x) - rank(y))
      .slice(0, perRole);
    if (picks.length) grouped[role] = picks;
  }
  return grouped;
}

// Load catalog on module import for automatic initialization
loadCatalog();
loadUnifiedCatalog();
