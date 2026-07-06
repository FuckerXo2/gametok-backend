#!/usr/bin/env node

// Test script for Claude-style game generation

import { generateClaudeStyleGame } from './src/ai-engine/maker-claude-style-generator.js';
import fs from 'fs/promises';

async function main() {
    const prompt = process.argv[2] || 'Create a simple endless runner game where you dodge obstacles';
    
    console.log('🚀 Testing Claude-style Phaser game generation');
    console.log(`📝 Prompt: "${prompt}"`);
    console.log('');

    try {
        const result = await generateClaudeStyleGame(prompt, {
            apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
        });

        console.log('');
        console.log('✅ SUCCESS!');
        console.log(`📁 Workspace: ${result.workspace}`);
        console.log(`📄 HTML size: ${(result.html.length / 1024).toFixed(1)} KB`);
        console.log(`📦 Files generated: ${result.files.length}`);
        console.log('');
        console.log('Files:');
        result.files.forEach(f => console.log(`  - ${f.path}`));
        console.log('');

        // Save to a test file
        const testFile = 'test-claude-game.html';
        await fs.writeFile(testFile, result.html, 'utf-8');
        console.log(`💾 Saved game to: ${testFile}`);
        console.log('');
        console.log('🎮 Open the file in your browser to play!');

    } catch (error) {
        console.error('');
        console.error('❌ FAILED:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
