#!/usr/bin/env node
/**
 * Test NVIDIA image generation models for pixel art sprite generation
 * 
 * Tests both SDXL and FLUX.1-schnell to compare quality for game sprites
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: NVIDIA_API_KEY,
});

// Create output directory
const OUTPUT_DIR = path.join(__dirname, 'test-sprites');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Generate sprite using NVIDIA Stable Diffusion 3.5 Large
 */
async function generateWithSD35(prompt, description) {
    console.log(`\n🎨 [SD 3.5] Generating: "${description}"`);
    
    // Pixel art optimized prompt for SD 3.5
    const pixelArtPrompt = `pixel art game sprite: ${prompt}. Style: clean 16-bit pixel art, sharp edges, game asset, top-down view, retro game graphics, vibrant colors, no blur`;
    
    try {
        const response = await fetch('https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-5-large', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: pixelArtPrompt,
                negative_prompt: 'blurry, low quality, 3d render, realistic photo, watermark',
                width: 1024,
                height: 1024,
                steps: 30,
                cfg_scale: 7,
                seed: Math.floor(Math.random() * 4_000_000_000),
            }),
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`SD 3.5 ${response.status}: ${text.slice(0, 200)}`);
        }
        
        const json = await response.json();
        const artifact = json?.artifacts?.[0];
        
        if (!artifact || !artifact.base64) {
            throw new Error(`SD 3.5 returned no image`);
        }
        
        // Save base64 image
        const buffer = Buffer.from(artifact.base64, 'base64');
        const filename = `sd35-${description.replace(/\s+/g, '-')}-${Date.now()}.png`;
        const filepath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filepath, buffer);
        
        console.log(`   ✅ Saved: ${filename}`);
        
        return { filepath };
    } catch (error) {
        console.error(`   ❌ SD 3.5 Error: ${error.message}`);
        return null;
    }
}

/**
 * Generate sprite using NVIDIA FLUX.1-schnell (faster, might be better quality)
 */
async function generateWithFLUX(prompt, description) {
    console.log(`\n⚡ [FLUX] Generating: "${description}"`);
    
    // FLUX prompt - it's better at following instructions
    const fluxPrompt = `pixel art game sprite: ${prompt}. Style: 16-bit retro game, clean pixel art, sharp edges, top-down view, game asset, no blur, high contrast colors`;
    
    try {
        // FLUX uses a different API endpoint
        const response = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux-1-schnell', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: fluxPrompt,
                width: 1024,
                height: 1024,
                cfg_scale: 0,
                mode: 'base',
                samples: 1,
                steps: 4,
                seed: Math.floor(Math.random() * 4_000_000_000),
            }),
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`FLUX ${response.status}: ${text.slice(0, 200)}`);
        }
        
        const json = await response.json();
        const artifact = json?.artifacts?.[0];
        
        if (!artifact || artifact.finishReason !== 'SUCCESS' || !artifact.base64) {
            throw new Error(`FLUX returned non-success artifact`);
        }
        
        // Save base64 image
        const buffer = Buffer.from(artifact.base64, 'base64');
        const filename = `flux-${description.replace(/\s+/g, '-')}-${Date.now()}.png`;
        const filepath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filepath, buffer);
        
        console.log(`   ✅ Saved: ${filename}`);
        
        return { filepath };
    } catch (error) {
        console.error(`   ❌ FLUX Error: ${error.message}`);
        return null;
    }
}

/**
 * Test both models with the same prompts
 */
async function runTests() {
    console.log('🧪 Testing NVIDIA Image Generation for Game Sprites');
    console.log('=' .repeat(60));
    console.log(`📁 Output directory: ${OUTPUT_DIR}\n`);
    
    const testCases = [
        {
            prompt: 'zombie character, rotting flesh, green decaying skin, torn clothes, undead monster',
            description: 'zombie'
        },
        {
            prompt: 'survivor character, tactical vest, holding assault rifle, military gear, hero',
            description: 'survivor'
        },
        {
            prompt: 'red sports car, racing vehicle, sleek design, top-down view',
            description: 'car'
        },
        {
            prompt: 'medieval knight, armor, sword and shield, warrior',
            description: 'knight'
        },
    ];
    
    for (const testCase of testCases) {
        console.log('\n' + '─'.repeat(60));
        console.log(`Testing: ${testCase.description.toUpperCase()}`);
        console.log('─'.repeat(60));
        
        // Test SD 3.5
        await generateWithSD35(testCase.prompt, testCase.description);
        
        // Wait a bit between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Test FLUX
        await generateWithFLUX(testCase.prompt, testCase.description);
        
        // Wait between test cases
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test complete!');
    console.log(`📁 Check sprites in: ${OUTPUT_DIR}`);
    console.log('\n💡 Next steps:');
    console.log('   1. Review generated sprites');
    console.log('   2. Compare quality to Astrocade');
    console.log('   3. Choose best model (SD 3.5 vs FLUX)');
    console.log('   4. Integrate into Phase 2 pipeline');
}

// Run tests
runTests().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
