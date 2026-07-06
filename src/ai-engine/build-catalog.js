import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanAssets, ASSETS_ROOT } from './scan-local-assets.js';
import { categorizeAsset } from './categorize-asset.js';
import { extractMetadata } from './extract-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate a human-readable description for an asset
 * @param {string} filePath - Relative path to asset file
 * @param {string} type - Asset type
 * @param {Object} metadata - Extracted metadata
 * @returns {string} Description string
 */
function generateDescription(filePath, type, metadata) {
  const name = path.basename(filePath, path.extname(filePath));
  let desc = `${name} ${type}`;
  
  if (metadata.dimensions) {
    desc += ` (${metadata.dimensions.width}x${metadata.dimensions.height})`;
  }
  
  if (metadata.frames) {
    desc += ` [${metadata.frames} frames]`;
  }
  
  return desc;
}

/**
 * Build the complete asset catalog by orchestrating scanner, categorizer, and metadata extractor
 * @returns {Promise<Object>} The complete catalog object
 */
async function buildCatalog() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  PHASER ASSET CATALOG BUILDER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // Step 1: Scan for assets
  console.log('🔍 Step 1: Scanning local assets...');
  console.log(`   Root: ${ASSETS_ROOT}`);
  const filePaths = scanAssets(ASSETS_ROOT);
  
  if (filePaths.length === 0) {
    console.error('');
    console.error('❌ No assets found! Please check that the assets directory exists.');
    console.error(`   Expected path: ${ASSETS_ROOT}`);
    return null;
  }
  
  console.log('');
  console.log(`✅ Found ${filePaths.length} asset files`);
  console.log('');
  
  // Step 2: Categorize and extract metadata
  console.log('🏷️  Step 2: Categorizing and extracting metadata...');
  
  const assets = [];
  const categories = {};
  const themes = {};
  
  let processed = 0;
  const total = filePaths.length;
  
  for (const filePath of filePaths) {
    processed++;
    
    // Show progress every 100 files or at the end
    if (processed % 100 === 0 || processed === total) {
      const percentage = ((processed / total) * 100).toFixed(1);
      console.log(`   Progress: ${processed}/${total} (${percentage}%)`);
    }
    
    try {
      // Categorize asset
      const { type, themes: assetThemes } = categorizeAsset(filePath);
      
      // Extract metadata
      const metadata = await extractMetadata(filePath, type);
      
      // Build asset entry
      const asset = {
        path: filePath.replace(/\\/g, '/'),  // Normalize path separators
        filename: path.basename(filePath),
        type,
        themes: assetThemes,
        dimensions: metadata.dimensions,
        frames: metadata.frames,
        fileSize: metadata.fileSize,
        extension: path.extname(filePath),
        description: generateDescription(filePath, type, metadata)
      };
      
      assets.push(asset);
      
      // Update category counters
      categories[type] = (categories[type] || 0) + 1;
      
      // Update theme counters
      assetThemes.forEach(theme => {
        themes[theme] = (themes[theme] || 0) + 1;
      });
      
    } catch (err) {
      console.error(`   ⚠️  Failed to process ${filePath}:`, err.message);
      // Continue processing other files
    }
  }
  
  console.log('');
  console.log('✅ Categorization complete');
  console.log('');
  
  // Step 3: Determine base URL from environment
  console.log('🌐 Step 3: Configuring base URL...');
  
  let baseUrl;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/assets/`;
    console.log(`   Environment: Railway (${process.env.RAILWAY_PUBLIC_DOMAIN})`);
  } else {
    baseUrl = 'http://localhost:3000/assets/';
    console.log('   Environment: Local development');
  }
  console.log(`   Base URL: ${baseUrl}`);
  console.log('');
  
  // Step 4: Build catalog object
  console.log('📦 Step 4: Building catalog structure...');
  
  const catalog = {
    metadata: {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      totalAssets: assets.length,
      assetsPath: ASSETS_ROOT,
      baseUrl
    },
    assets,
    categories,
    themes
  };
  
  console.log('');
  console.log('✅ Catalog structure created');
  console.log('');
  
  // Step 5: Write catalog to disk
  console.log('💾 Step 5: Writing catalog to disk...');
  
  const catalogPath = path.join(__dirname, 'phaser-cdn-catalog.json');
  
  try {
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`   Output: ${catalogPath}`);
    console.log('');
    console.log('✅ Catalog written successfully');
  } catch (err) {
    console.error('');
    console.error('❌ Failed to write catalog file:', err.message);
    throw err;
  }
  
  // Step 6: Display statistics
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATALOG STATISTICS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`📊 Total Assets: ${catalog.metadata.totalAssets}`);
  console.log('');
  console.log('📂 Categories:');
  Object.entries(categories)
    .sort(([, a], [, b]) => b - a)
    .forEach(([category, count]) => {
      const percentage = ((count / catalog.metadata.totalAssets) * 100).toFixed(1);
      console.log(`   ${category.padEnd(20)} ${count.toString().padStart(6)} (${percentage}%)`);
    });
  console.log('');
  console.log('🎨 Themes:');
  Object.entries(themes)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)  // Show top 15 themes
    .forEach(([theme, count]) => {
      const percentage = ((count / catalog.metadata.totalAssets) * 100).toFixed(1);
      console.log(`   ${theme.padEnd(20)} ${count.toString().padStart(6)} (${percentage}%)`);
    });
  
  if (Object.keys(themes).length > 15) {
    console.log(`   ... and ${Object.keys(themes).length - 15} more themes`);
  }
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Catalog build complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  return catalog;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCatalog()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('');
      console.error('❌ Catalog build failed:', err.message);
      console.error('');
      process.exit(1);
    });
}

export { buildCatalog, generateDescription };
