/**
 * Full integration test - simulates a real game generation request
 */

import { runDirectGenerationLoop } from './gametok-direct-loop.js';
import fs from 'fs';
import path from 'path';

async function testFullGeneration() {
  console.log('🧪 Full Integration Test: Direct Gemini Generation\n');
  console.log('=' .repeat(70));
  
  const jobId = 'test-' + Date.now();
  const outputDir = path.join('/tmp', jobId);
  
  try {
    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });
    
    console.log('\n📝 Simulating game generation request...');
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Prompt: "make a simple 2d snake game"`);
    console.log(`   Output: ${outputDir}\n`);
    
    // Run generation
    const result = await runDirectGenerationLoop({
      jobId,
      prompt: 'make a simple 2d snake game with arrow key controls',
      orientation: 'portrait',
      skipDirections: true, // Instant generation
      onProgress: (percent, status, message) => {
        console.log(`📊 Progress: ${percent}% - [${status}] ${message}`);
      },
    });
    
    console.log('\n✅ Generation Complete!');
    console.log('=' .repeat(70));
    console.log(`Title: ${result.metadata.title}`);
    console.log(`Success: ${result.success}`);
    console.log(`Code Length: ${result.gameScript.length} characters`);
    console.log(`Attempts: ${result.attemptCount}`);
    
    if (result.metadata.controls) {
      console.log(`\nControls:`);
      console.log(`  Keyboard: ${result.metadata.controls.keyboard || 'N/A'}`);
      console.log(`  Touch: ${result.metadata.controls.touch || 'N/A'}`);
    }
    
    // Save to file
    const outputFile = path.join(outputDir, 'game.html');
    fs.writeFileSync(outputFile, result.gameScript, 'utf-8');
    console.log(`\n💾 Game saved to: ${outputFile}`);
    
    // Validate HTML structure
    const hasDoctype = result.gameScript.includes('<!DOCTYPE');
    const hasClosingHtml = result.gameScript.includes('</html>');
    const hasScript = result.gameScript.includes('<script>');
    
    console.log('\n🔍 HTML Validation:');
    console.log(`  <!DOCTYPE>: ${hasDoctype ? '✓' : '✗'}`);
    console.log(`  </html>: ${hasClosingHtml ? '✓' : '✗'}`);
    console.log(`  <script>: ${hasScript ? '✓' : '✗'}`);
    
    if (hasDoctype && hasClosingHtml && hasScript) {
      console.log('\n✅ HTML structure is valid!');
    } else {
      console.warn('\n⚠️ HTML structure may be incomplete');
    }
    
    console.log('\n🎮 You can open the game in a browser:');
    console.log(`   file://${outputFile}`);
    
    return result;
    
  } catch (error) {
    console.error('\n❌ Generation Failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`\n   Stack: ${error.stack}`);
    throw error;
  }
}

// Run the test
testFullGeneration()
  .then(() => {
    console.log('\n\n🎉 Integration test passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n\n💥 Integration test failed!');
    process.exit(1);
  });
