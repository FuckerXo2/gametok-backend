/**
 * Test script to verify asset catalog loading
 */

import { CURATED_3D_MODELS } from './src/ai-engine/asset-catalog.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load animations catalog
const ANIMATIONS_CATALOG = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/ai-engine/animations-catalog.json'), 'utf-8')
);

console.log('✅ Asset Catalogs Loaded Successfully!\n');

// Test character models
const characters = CURATED_3D_MODELS.filter(m => m.category === 'character');
console.log(`📦 Character Models: ${characters.length}`);
characters.forEach(char => {
  console.log(`  - ${char.name} (${char.archetype})`);
  console.log(`    Tags: ${char.tags.slice(0, 5).join(', ')}`);
});

console.log(`\n🎬 Total Animations: ${ANIMATIONS_CATALOG.totalAnimations}`);
console.log(`   By Category:`);
Object.entries(ANIMATIONS_CATALOG.byCategory || ANIMATIONS_CATALOG.counts).forEach(([cat, count]) => {
  if (typeof count === 'number' && count > 100) {
    console.log(`   - ${cat}: ${count}`);
  }
});

// Test filtering for "fighting game"
console.log(`\n🧪 Test: Filter for "fighting game with scorpion"`);
const fightingPrompt = "fighting game with scorpion";
const keywords = fightingPrompt.toLowerCase();

const matchedCharacters = characters.filter(char => 
  char.tags.some(tag => keywords.includes(tag.toLowerCase()))
);
console.log(`   Matched Characters: ${matchedCharacters.map(c => c.name).join(', ')}`);

const fightingAnimations = ANIMATIONS_CATALOG.animations
  .filter(anim => ['combat', 'reactions'].includes(anim.bucket))
  .slice(0, 10);
console.log(`   Relevant Animations (first 10):`);
fightingAnimations.forEach(anim => {
  console.log(`   - ${anim.cleanName} (${anim.duration}s, ${anim.subBucket})`);
});

console.log('\n✅ Test Complete!');
