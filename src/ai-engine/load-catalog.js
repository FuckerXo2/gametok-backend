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

// Load catalog on module import for automatic initialization
loadCatalog();
