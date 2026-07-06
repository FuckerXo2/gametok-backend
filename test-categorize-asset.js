import { categorizeAsset, THEME_KEYWORDS, extractThemes } from './src/ai-engine/categorize-asset.js';

console.log('🧪 Testing categorize-asset.js module\n');

// Test cases for type classification
const typeTests = [
  { path: 'sprites/zombie.png', expectedType: 'sprite' },
  { path: 'sprites/zombie-spritesheet.png', expectedType: 'spritesheet' },
  { path: 'animations/knight-atlas.png', expectedType: 'spritesheet' },
  { path: 'audio/shoot.mp3', expectedType: 'audio' },
  { path: 'audio/background.wav', expectedType: 'audio' },
  { path: 'audio/music.ogg', expectedType: 'audio' },
  { path: 'data/player-spritesheet.json', expectedType: 'spritesheet_data' },
  { path: 'backgrounds/space.jpg', expectedType: 'sprite' },
  { path: 'backgrounds/medieval.webp', expectedType: 'sprite' }
];

// Test cases for theme extraction
const themeTests = [
  { path: 'sprites/zombie-attack.png', expectedThemes: ['zombie'] },
  { path: 'sprites/space-alien.png', expectedThemes: ['space'] },
  { path: 'medieval/knight-sword.png', expectedThemes: ['medieval'] },
  { path: 'platformer/coin-collect.png', expectedThemes: ['platformer'] },
  { path: 'shooter/bullet-gun.png', expectedThemes: ['shooter'] },
  { path: 'cooking/food-kitchen.png', expectedThemes: ['cooking'] },
  { path: 'racing/car-vehicle.png', expectedThemes: ['racing'] },
  { path: 'rpg/hero-quest.png', expectedThemes: ['rpg'] },
  { path: 'puzzle/block-match.png', expectedThemes: ['puzzle'] },
  { path: 'generic/button.png', expectedThemes: ['generic'] }
];

let passedTests = 0;
let failedTests = 0;

console.log('📋 Type Classification Tests:');
console.log('─'.repeat(60));

typeTests.forEach(test => {
  const result = categorizeAsset(test.path);
  const passed = result.type === test.expectedType;
  
  if (passed) {
    console.log(`✅ ${test.path}`);
    console.log(`   Type: ${result.type} (expected: ${test.expectedType})`);
    passedTests++;
  } else {
    console.log(`❌ ${test.path}`);
    console.log(`   Type: ${result.type} (expected: ${test.expectedType})`);
    failedTests++;
  }
});

console.log('\n🏷️  Theme Extraction Tests:');
console.log('─'.repeat(60));

themeTests.forEach(test => {
  const result = categorizeAsset(test.path);
  const hasExpectedTheme = test.expectedThemes.every(theme => 
    result.themes.includes(theme)
  );
  
  if (hasExpectedTheme) {
    console.log(`✅ ${test.path}`);
    console.log(`   Themes: [${result.themes.join(', ')}] (expected: [${test.expectedThemes.join(', ')}])`);
    passedTests++;
  } else {
    console.log(`❌ ${test.path}`);
    console.log(`   Themes: [${result.themes.join(', ')}] (expected: [${test.expectedThemes.join(', ')}])`);
    failedTests++;
  }
});

console.log('\n📊 Test Summary:');
console.log('─'.repeat(60));
console.log(`Total Tests: ${passedTests + failedTests}`);
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);

// Test THEME_KEYWORDS export
console.log('\n🔑 THEME_KEYWORDS export test:');
console.log('─'.repeat(60));
if (THEME_KEYWORDS && typeof THEME_KEYWORDS === 'object') {
  console.log('✅ THEME_KEYWORDS exported correctly');
  console.log(`   Themes available: ${Object.keys(THEME_KEYWORDS).join(', ')}`);
  passedTests++;
} else {
  console.log('❌ THEME_KEYWORDS not exported correctly');
  failedTests++;
}

// Test extractThemes export
console.log('\n🔍 extractThemes export test:');
console.log('─'.repeat(60));
if (extractThemes && typeof extractThemes === 'function') {
  console.log('✅ extractThemes exported correctly');
  const testResult = extractThemes('zombie/attack', 'zombie');
  console.log(`   Test result: [${testResult.join(', ')}]`);
  passedTests++;
} else {
  console.log('❌ extractThemes not exported correctly');
  failedTests++;
}

console.log('\n' + '═'.repeat(60));
if (failedTests === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log(`⚠️  ${failedTests} test(s) failed`);
  process.exit(1);
}
