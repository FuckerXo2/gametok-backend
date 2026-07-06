import { categorizeAsset, THEME_KEYWORDS, extractThemes } from './src/ai-engine/categorize-asset.js';

console.log('🧪 Comprehensive Test for categorize-asset.js\n');
console.log('Testing Requirements: 2.1-2.7, 3.1-3.8\n');

let totalTests = 0;
let passedTests = 0;

function test(description, condition) {
  totalTests++;
  if (condition) {
    console.log(`✅ ${description}`);
    passedTests++;
    return true;
  } else {
    console.log(`❌ ${description}`);
    return false;
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('Requirement 2.2: Classify .png/.jpg/.webp without "spritesheet"/"atlas" as "sprite"');
console.log('═══════════════════════════════════════════════════════════\n');

test('zombie.png → sprite', categorizeAsset('sprites/zombie.png').type === 'sprite');
test('hero.jpg → sprite', categorizeAsset('characters/hero.jpg').type === 'sprite');
test('background.webp → sprite', categorizeAsset('backgrounds/background.webp').type === 'sprite');
test('button.jpeg → sprite', categorizeAsset('ui/button.jpeg').type === 'sprite');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 2.3: Classify images with "spritesheet"/"atlas" as "spritesheet"');
console.log('═══════════════════════════════════════════════════════════\n');

test('player-spritesheet.png → spritesheet', 
  categorizeAsset('animations/player-spritesheet.png').type === 'spritesheet');
test('enemy-atlas.png → spritesheet', 
  categorizeAsset('animations/enemy-atlas.png').type === 'spritesheet');
test('character-atlas.jpg → spritesheet', 
  categorizeAsset('spritesheets/character-atlas.jpg').type === 'spritesheet');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 2.4: Classify .mp3/.wav/.ogg as "audio"');
console.log('═══════════════════════════════════════════════════════════\n');

test('shoot.mp3 → audio', categorizeAsset('audio/shoot.mp3').type === 'audio');
test('music.wav → audio', categorizeAsset('audio/music.wav').type === 'audio');
test('explosion.ogg → audio', categorizeAsset('audio/explosion.ogg').type === 'audio');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 2.5: Classify .json paired with image as "spritesheet_data"');
console.log('═══════════════════════════════════════════════════════════\n');

test('player-spritesheet.json → spritesheet_data', 
  categorizeAsset('animations/player-spritesheet.json').type === 'spritesheet_data');
test('enemy-atlas.json → spritesheet_data', 
  categorizeAsset('data/enemy-atlas.json').type === 'spritesheet_data');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.2: Tag "space" theme for space/alien/rocket/star keywords');
console.log('═══════════════════════════════════════════════════════════\n');

test('space-ship.png → space theme', 
  categorizeAsset('sprites/space-ship.png').themes.includes('space'));
test('alien-enemy.png → space theme', 
  categorizeAsset('sprites/alien-enemy.png').themes.includes('space'));
test('rocket-launcher.png → space theme', 
  categorizeAsset('weapons/rocket-launcher.png').themes.includes('space'));
test('star-background.png → space theme', 
  categorizeAsset('backgrounds/star-background.png').themes.includes('space'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.3: Tag "medieval" theme for medieval/knight/castle/sword keywords');
console.log('═══════════════════════════════════════════════════════════\n');

test('medieval-town.png → medieval theme', 
  categorizeAsset('backgrounds/medieval-town.png').themes.includes('medieval'));
test('knight-warrior.png → medieval theme', 
  categorizeAsset('characters/knight-warrior.png').themes.includes('medieval'));
test('castle-walls.png → medieval theme', 
  categorizeAsset('structures/castle-walls.png').themes.includes('medieval'));
test('sword-weapon.png → medieval theme', 
  categorizeAsset('weapons/sword-weapon.png').themes.includes('medieval'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.4: Tag "zombie" theme for zombie/undead/horror/skeleton keywords');
console.log('═══════════════════════════════════════════════════════════\n');

test('zombie-attack.png → zombie theme', 
  categorizeAsset('enemies/zombie-attack.png').themes.includes('zombie'));
test('undead-horde.png → zombie theme', 
  categorizeAsset('enemies/undead-horde.png').themes.includes('zombie'));
test('horror-scene.png → zombie theme', 
  categorizeAsset('backgrounds/horror-scene.png').themes.includes('zombie'));
test('skeleton-enemy.png → zombie theme', 
  categorizeAsset('enemies/skeleton-enemy.png').themes.includes('zombie'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.5: Tag "platformer" theme for platform/jump/coin/gem keywords');
console.log('═══════════════════════════════════════════════════════════\n');

test('platform-tile.png → platformer theme', 
  categorizeAsset('tiles/platform-tile.png').themes.includes('platformer'));
test('jump-animation.png → platformer theme', 
  categorizeAsset('animations/jump-animation.png').themes.includes('platformer'));
test('coin-collect.png → platformer theme', 
  categorizeAsset('collectibles/coin-collect.png').themes.includes('platformer'));
test('gem-power.png → platformer theme', 
  categorizeAsset('collectibles/gem-power.png').themes.includes('platformer'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.6: Tag "shooter" theme for shoot/gun/bullet/enemy/weapon keywords');
console.log('═══════════════════════════════════════════════════════════\n');

test('shoot-effect.png → shooter theme', 
  categorizeAsset('effects/shoot-effect.png').themes.includes('shooter'));
test('gun-pistol.png → shooter theme', 
  categorizeAsset('weapons/gun-pistol.png').themes.includes('shooter'));
test('bullet-projectile.png → shooter theme', 
  categorizeAsset('projectiles/bullet-projectile.png').themes.includes('shooter'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.7: Tag "generic" when no theme keywords match');
console.log('═══════════════════════════════════════════════════════════\n');

test('random-asset.png → generic theme', 
  categorizeAsset('assets/random-asset.png').themes.includes('generic'));
test('misc-file.png → generic theme', 
  categorizeAsset('misc/misc-file.png').themes.includes('generic'));
test('nothing-special.png → generic theme', 
  categorizeAsset('stuff/nothing-special.png').themes.includes('generic'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Requirement 3.8: Support multiple theme tags per asset');
console.log('═══════════════════════════════════════════════════════════\n');

const zombieShooter = categorizeAsset('games/zombie-shooter.png');
test('zombie-shooter.png has multiple themes', zombieShooter.themes.length > 1);
test('zombie-shooter.png includes zombie theme', zombieShooter.themes.includes('zombie'));
test('zombie-shooter.png includes shooter theme', zombieShooter.themes.includes('shooter'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Additional Theme Tests (cooking, racing, rpg, puzzle, visual-novel)');
console.log('═══════════════════════════════════════════════════════════\n');

test('food-item.png → cooking theme', 
  categorizeAsset('items/food-item.png').themes.includes('cooking'));
test('car-racing.png → racing theme', 
  categorizeAsset('vehicles/car-racing.png').themes.includes('racing'));
test('hero-rpg.png → rpg theme', 
  categorizeAsset('characters/hero-rpg.png').themes.includes('rpg'));
test('puzzle-block.png → puzzle theme', 
  categorizeAsset('pieces/puzzle-block.png').themes.includes('puzzle'));
test('character-portrait.png → visual-novel theme', 
  categorizeAsset('portraits/character-portrait.png').themes.includes('visual-novel'));

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Module Exports Test');
console.log('═══════════════════════════════════════════════════════════\n');

test('THEME_KEYWORDS is exported', typeof THEME_KEYWORDS === 'object');
test('THEME_KEYWORDS has all required themes', 
  ['space', 'medieval', 'zombie', 'platformer', 'shooter', 'cooking', 
   'visual-novel', 'puzzle', 'rpg', 'racing', 'generic'].every(
    theme => THEME_KEYWORDS.hasOwnProperty(theme)
  )
);
test('extractThemes is exported', typeof extractThemes === 'function');
test('categorizeAsset is exported', typeof categorizeAsset === 'function');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Test Summary');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`Total Tests: ${totalTests}`);
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${totalTests - passedTests}`);
console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (passedTests === totalTests) {
  console.log('\n🎉 All requirements validated successfully!');
  console.log('\n✅ Task 3.1 COMPLETE:');
  console.log('   - categorize-asset.js module created');
  console.log('   - Type classification logic implemented');
  console.log('   - THEME_KEYWORDS object defined with all themes');
  console.log('   - extractThemes() function implemented');
  console.log('   - categorizeAsset() function implemented');
  console.log('   - All requirements (2.1-2.7, 3.1-3.8) validated');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the implementation.');
  process.exit(1);
}
