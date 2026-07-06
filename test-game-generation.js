#!/usr/bin/env node

/**
 * Test Game Generation with Asset Catalog
 * 
 * This script tests the complete game generation pipeline:
 * 1. Loads the asset catalog
 * 2. Extracts theme keywords from user prompt
 * 3. Filters assets by theme
 * 4. Builds the AI prompt with filtered assets
 * 5. Calls DeepSeek API to generate game code
 * 6. Saves the generated game files
 * 7. Optionally runs the game locally
 */

import { buildClaudeStylePrompt } from './src/ai-engine/maker-claude-style-prompt.js';
import { getCatalog } from './src/ai-engine/load-catalog.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-cce53b5817ae4782ab8980a4e807e8cf';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * Call DeepSeek API to generate game code
 */
async function callDeepSeekAPI(systemPrompt, userPrompt) {
  console.log('🤖 Calling DeepSeek API...');
  
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 8000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Parse AI response and extract files
 */
function parseAIResponse(response) {
  console.log('📝 Parsing AI response...');
  
  // Try to extract JSON from response (might be wrapped in markdown)
  let jsonStr = response.trim();
  
  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.files || !Array.isArray(parsed.files)) {
      throw new Error('Response missing "files" array');
    }
    
    return parsed.files;
  } catch (error) {
    console.error('❌ Failed to parse AI response as JSON');
    console.error('Response preview:', jsonStr.substring(0, 500));
    throw error;
  }
}

/**
 * Save generated files to output directory
 */
function saveGeneratedFiles(files, outputDir) {
  console.log(`💾 Saving ${files.length} files to ${outputDir}...`);
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Save each file
  for (const file of files) {
    const filePath = path.join(outputDir, file.path);
    const fileDir = path.dirname(filePath);
    
    // Create subdirectories if needed
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, file.content, 'utf-8');
    console.log(`  ✓ ${file.path}`);
  }
  
  console.log('✅ All files saved successfully!');
}

/**
 * Display catalog statistics
 */
function displayCatalogStats() {
  const catalog = getCatalog();
  
  console.log('\n📊 Asset Catalog Statistics:');
  console.log(`   Total assets: ${catalog.assets.length}`);
  
  // Count by type
  const byType = {};
  catalog.assets.forEach(asset => {
    byType[asset.type] = (byType[asset.type] || 0) + 1;
  });
  
  console.log('   By type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });
  
  // Count by theme
  const byTheme = {};
  catalog.assets.forEach(asset => {
    asset.themes.forEach(theme => {
      byTheme[theme] = (byTheme[theme] || 0) + 1;
    });
  });
  
  console.log('   By theme:');
  Object.entries(byTheme)
    .sort((a, b) => b[1] - a[1])
    .forEach(([theme, count]) => {
      console.log(`     - ${theme}: ${count}`);
    });
}

/**
 * Main test function
 */
async function testGameGeneration() {
  console.log('🎮 GameTok AI Game Generation Test\n');
  
  // Get user prompt from command line or use default
  const userPrompt = process.argv[2] || 
    'Create a zombie survival shooter game with animated zombie sprites. Player must survive waves of zombies. Use touch controls for mobile. Add particle effects when zombies die.';
  
  console.log('📝 User prompt:');
  console.log(`   "${userPrompt}"\n`);
  
  // Display catalog stats
  displayCatalogStats();
  
  // Build the prompt with asset catalog
  console.log('\n🔨 Building AI prompt with asset catalog...');
  const { system, user } = buildClaudeStylePrompt(userPrompt);
  
  // Show asset filtering results
  const assetSection = system.match(/# AVAILABLE ASSETS\n\n([\s\S]*?)\n\n# CRITICAL RULES/);
  if (assetSection) {
    const assetText = assetSection[1];
    const spriteCount = (assetText.match(/^- \*\*/gm) || []).length;
    console.log(`   ✓ Filtered and injected ${spriteCount} relevant assets into prompt`);
  }
  
  try {
    // Call AI to generate game
    const aiResponse = await callDeepSeekAPI(system, user);
    
    // Parse response
    const files = parseAIResponse(aiResponse);
    console.log(`   ✓ Generated ${files.length} files`);
    
    // Save files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputDir = path.join(__dirname, 'generated-games', `game-${timestamp}`);
    saveGeneratedFiles(files, outputDir);
    
    console.log('\n🎉 Game generation complete!');
    console.log(`\n📁 Game files saved to: ${outputDir}`);
    console.log('\n🚀 To run the game:');
    console.log(`   cd ${outputDir}`);
    console.log(`   npm install`);
    console.log(`   npm run dev`);
    console.log('\n   Then open http://localhost:5173 in your browser');
    
  } catch (error) {
    console.error('\n❌ Error during game generation:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testGameGeneration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
