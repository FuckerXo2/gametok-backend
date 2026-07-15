// Claude-style Phaser game generator - simplified pipeline
// This bypasses the complex template/scaffold system and generates games like Claude does

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildGamePrompt } from './maker-game-prompt.js';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple AI call using DeepSeek or OpenAI
async function callAIForClaudeStyle(systemPrompt, userPrompt, apiKey, modelName = 'deepseek-chat') {
    const OpenAI = (await import('openai')).default;
    
    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: modelName.includes('deepseek') 
            ? 'https://api.deepseek.com/v1' 
            : undefined
    });

    console.log(`🤖 Calling ${modelName} for Claude-style generation...`);
    
    const response = await client.chat.completions.create({
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                     content.match(/```\n([\s\S]*?)\n```/);
    
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    
    // Try parsing the whole thing as JSON
    try {
        return JSON.parse(content);
    } catch (e) {
        throw new Error(`AI returned invalid JSON: ${content.slice(0, 200)}...`);
    }
}

// Write files to a workspace
async function writeGameFiles(workspace, files) {
    for (const file of files) {
        const fullPath = path.join(workspace, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, 'utf-8');
        console.log(`📝 Wrote ${file.path}`);
    }
}

// Build the game with Vite
async function buildGameWithVite(workspace) {
    console.log('🔨 Installing dependencies...');
    execSync('npm install', { cwd: workspace, stdio: 'inherit' });
    
    console.log('🔨 Building with Vite...');
    try {
        execSync('npm run build', { cwd: workspace, stdio: 'inherit' });
    } catch (buildError) {
        console.error('❌ Build failed:', buildError.message);
        throw new Error(`Build failed: ${buildError.message}`);
    }
    
    // Read the built HTML file
    const distPath = path.join(workspace, 'dist', 'index.html');
    const html = await fs.readFile(distPath, 'utf-8');
    
    return html;
}

// Main generation function
export async function generateClaudeStyleGame(prompt, options = {}) {
    const {
        apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
        modelName = process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4',
        workspace = null,
    } = options;

    if (!apiKey) {
        throw new Error('No API key provided. Set DEEPSEEK_API_KEY or OPENAI_API_KEY');
    }

    // Create workspace
    const workspaceDir = workspace || path.join(tmpdir(), `game-${randomUUID()}`);
    await fs.mkdir(workspaceDir, { recursive: true });
    console.log(`📁 Workspace: ${workspaceDir}`);

    try {
        // Generate game files using AI
        console.log('🎮 Generating game files...');
        const promptData = await buildGamePrompt(prompt);
        const result = await callAIForClaudeStyle(
            promptData.system,
            promptData.user,
            apiKey,
            modelName
        );

        if (!result.files || !Array.isArray(result.files)) {
            throw new Error('AI did not return files array');
        }

        // Write files to workspace
        await writeGameFiles(workspaceDir, result.files);
        
        // SAVE SOURCE FOR DEBUGGING
        console.log('💾 Saving source files to workspace for debugging...');
        console.log(`📂 Source files location: ${workspaceDir}`);

        // Build with Vite
        const html = await buildGameWithVite(workspaceDir);

        return {
            success: true,
            html: html,
            workspace: workspaceDir,
            files: result.files,
        };

    } catch (error) {
        console.error('❌ Generation failed:', error);
        console.error('📂 Check source files at:', workspaceDir);
        throw error;
    }
}

// Test function for CLI usage
export async function testClaudeStyleGenerator() {
    const prompt = process.argv[2] || 'Create a simple space shooter game';
    
    console.log(`🚀 Testing Claude-style generator with prompt: "${prompt}"`);
    
    try {
        const result = await generateClaudeStyleGame(prompt);
        console.log('✅ Generation successful!');
        console.log(`📦 Workspace: ${result.workspace}`);
        console.log(`📄 HTML size: ${result.html.length} bytes`);
        
        // Write HTML to a test file
        const testFile = 'test-claude-style-game.html';
        await fs.writeFile(testFile, result.html, 'utf-8');
        console.log(`💾 Saved to ${testFile}`);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testClaudeStyleGenerator();
}
