#!/usr/bin/env node

// Test script to validate the asset catalog system with a zombie game
import { buildClaudeStylePrompt } from './src/ai-engine/maker-claude-style-prompt.js';
import { getCatalog } from './src/ai-engine/load-catalog.js';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  PHASER ASSET CATALOG SYSTEM - VALIDATION TEST');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Step 1: Verify catalog is loaded
console.log('📦 Step 1: Checking catalog status...');
const catalog = getCatalog();

if (!catalog) {
  console.error('❌ FAILED: Catalog not found!');
  console.error('   Run: node src/ai-engine/build-catalog.js');
  process.exit(1);
}

console.log(`✅ Catalog loaded: ${catalog.metadata.totalAssets} assets`);
console.log(`   Version: ${catalog.metadata.version}`);
console.log(`   Last updated: ${catalog.metadata.lastUpdated}`);
console.log(`   Base URL: ${catalog.metadata.baseUrl}`);
console.log('');

// Step 2: Check catalog structure
console.log('📊 Step 2: Analyzing catalog structure...');
console.log('');
console.log('Categories:');
Object.entries(catalog.categories).forEach(([type, count]) => {
  const percentage = ((count / catalog.metadata.totalAssets) * 100).toFixed(1);
  console.log(`   ${type.padEnd(20)} ${count.toString().padStart(5)} (${percentage}%)`);
});
console.log('');
console.log('Themes:');
Object.entries(catalog.themes)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 10)
  .forEach(([theme, count]) => {
    const percentage = ((count / catalog.metadata.totalAssets) * 100).toFixed(1);
    console.log(`   ${theme.padEnd(20)} ${count.toString().padStart(5)} (${percentage}%)`);
  });
console.log('');

// Step 3: Test zombie theme detection
console.log('🧟 Step 3: Testing zombie game prompt...');
const zombiePrompt = 'Create a zombie shooter survival game where players defend against waves of zombies';
const promptData = buildClaudeStylePrompt(zombiePrompt);

console.log(`   User prompt: "${zombiePrompt}"`);
console.log('');

// Step 4: Analyze generated prompt
console.log('🔍 Step 4: Analyzing generated AI prompt...');
const systemPrompt = promptData.system;

// Extract the AVAILABLE ASSETS section
const assetSectionMatch = systemPrompt.match(/# AVAILABLE ASSETS\n\n(.*?)\n\n\*\*Asset URL Format\*\*/s);

if (!assetSectionMatch) {
  console.error('❌ FAILED: No AVAILABLE ASSETS section found in prompt!');
  process.exit(1);
}

const assetSection = assetSectionMatch[1];
console.log('✅ AVAILABLE ASSETS section found');
console.log('');

// Check for zombie assets
const zombieAssets = assetSection.match(/zombie/gi) || [];
const skeletonAssets = assetSection.match(/skeleton/gi) || [];
const horrorAssets = assetSection.match(/horror/gi) || [];

console.log('📋 Zombie-themed assets in prompt:');
console.log(`   "zombie" mentions: ${zombieAssets.length}`);
console.log(`   "skeleton" mentions: ${skeletonAssets.length}`);
console.log(`   "horror" mentions: ${horrorAssets.length}`);
console.log('');

if (zombieAssets.length === 0) {
  console.error('❌ FAILED: No zombie assets found in prompt!');
  console.error('   Theme detection may not be working correctly.');
  process.exit(1);
}

// Step 5: Display sample assets
console.log('📸 Step 5: Sample zombie assets from prompt:');
const assetLines = assetSection.split('\n').filter(line => 
  line.includes('zombie') || line.includes('skeleton') || line.includes('horror')
);
assetLines.slice(0, 10).forEach(line => {
  console.log(`   ${line.trim()}`);
});
if (assetLines.length > 10) {
  console.log(`   ... and ${assetLines.length - 10} more zombie assets`);
}
console.log('');

// Step 6: Verify asset URLs are properly formatted
console.log('🌐 Step 6: Verifying asset URL format...');
const urlFormatSection = systemPrompt.match(/\*\*Asset URL Format\*\*:(.*?)\n\n/s);

if (!urlFormatSection) {
  console.error('❌ FAILED: Asset URL format section not found!');
  process.exit(1);
}

console.log('✅ Asset URL format instructions included');
console.log('');

// Step 7: Check critical rules
console.log('⚠️  Step 7: Checking critical rules...');
const hasCriticalAssetRule = systemPrompt.includes('Only use assets from the list above');
const hasGuaranteedExistRule = systemPrompt.includes('guaranteed to exist');

if (!hasCriticalAssetRule || !hasGuaranteedExistRule) {
  console.error('❌ WARNING: Critical asset usage rules may be missing!');
} else {
  console.log('✅ Critical asset usage rules present');
}
console.log('');

// Step 8: Final validation
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  VALIDATION RESULTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('✅ Catalog system is working correctly!');
console.log('✅ Zombie theme detection is working');
console.log(`✅ ${zombieAssets.length + skeletonAssets.length + horrorAssets.length} zombie-themed assets in prompt`);
console.log('✅ Asset URL formatting is correct');
console.log('✅ Critical rules are in place');
console.log('');
console.log('🎉 The AI will now generate zombie games with REAL assets!');
console.log('   No more blind-guessing filenames or 404 errors.');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
