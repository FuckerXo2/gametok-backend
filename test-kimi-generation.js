#!/usr/bin/env node

/**
 * Test script to run Kimi CLI game generation.
 * 
 * Usage:
 *   export MOONSHOT_API_KEY="your-api-key"
 *   node test-kimi-generation.js "Make a retro space shooter"
 */

import { buildClaudeStylePrompt } from './src/ai-engine/maker-claude-style-prompt.js';
import { runKimiCliAgent } from './src/ai-engine/maker-kimi-cli-runner.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const prompt = process.argv[2] || 'Create a simple endless runner game where you jump over obstacles';
    
    console.log('🚀 Testing GameTok Kimi CLI Generation Pipeline');
    console.log(`📝 Prompt: "${prompt}"`);
    console.log('');

    if (!process.env.MOONSHOT_API_KEY) {
        console.error('❌ Error: MOONSHOT_API_KEY is not set in the environment.');
        console.error('Please export it: export MOONSHOT_API_KEY="your-key"');
        process.exit(1);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const testDir = path.join(__dirname, 'generated-games', `kimi-test-${timestamp}`);

    try {
        // 1. Create workspace
        await fs.mkdir(testDir, { recursive: true });
        console.log(`📁 Created temp workspace at: ${testDir}`);

        // 2. Symlink backend node_modules to avoid slow installs
        const backendNodeModules = path.join(__dirname, 'node_modules');
        const projectNodeModules = path.join(testDir, 'node_modules');
        console.log('🔗 Symlinking node_modules to project workspace...');
        await fs.symlink(backendNodeModules, projectNodeModules, 'dir');

        // 3. Build Claude-style prompt instructions with asset details
        console.log('🔨 Preparing Kimi instructions and design brief...');
        const { system, user } = await buildClaudeStylePrompt(prompt);

        // 4. Run Kimi CLI directly in the workspace
        console.log('🤖 Spawning Kimi CLI agent loop...');
        await runKimiCliAgent(testDir, system, user);

        console.log('');
        console.log('✅ SUCCESS!');
        console.log(`📂 Code generated in: ${testDir}`);
        console.log('');
        console.log('🚀 To run and preview the game locally:');
        console.log(`   cd ${testDir}`);
        console.log('   npm run build  (to bundle)');
        console.log('   npx vite       (to preview)');
        console.log('');

    } catch (error) {
        console.error('');
        console.error('❌ PIPELINE FAILED:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
