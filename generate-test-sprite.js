#!/usr/bin/env node
/**
 * Generate and save test sprites using FLUX
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

// Create output directory
const OUTPUT_DIR = path.join(__dirname, 'test-sprites');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function generateSprite(prompt, filename) {
    console.log(`\n🎨 Generating: ${filename}`);
    console.log(`   Prompt: ${prompt.slice(0, 80)}...`);
    
    try {
        const response = await fetch(NVIDIA_FLUX_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt,
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
        
        if (!artifact || !artifact.base64) {
            throw new Error(`No image returned (finishReason: ${artifact?.finishReason})`);
        }
        
        // Save base64 image
        const buffer = Buffer.from(artifact.base64, 'base64');
        const filepath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filepath, buffer);
        
        console.log(`   ✅ Saved: ${filepath}`);
        console.log(`   📊 Size: ${(buffer.length / 1024).toFixed(1)} KB`);
        console.log(`   ⚠️  Finish reason: ${artifact.finishReason}`);
        
        return filepath;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('🧪 FLUX Sprite Generation Test');
    console.log('=' .repeat(60));
    console.log(`📁 Output: ${OUTPUT_DIR}\n`);
    
    const testCases = [
        {
            prompt: 'pixel art game sprite, zombie character with rotting green flesh and torn clothes, top-down view, 16-bit retro game style, clean pixels, sharp edges, game asset, transparent background',
            filename: 'zombie-sprite.png'
        },
        {
            prompt: 'pixel art game sprite, survivor character wearing tactical vest and holding rifle, top-down view, 16-bit retro game style, clean pixels, sharp edges, game asset, hero character',
            filename: 'survivor-sprite.png'
        },
        {
            prompt: 'pixel art game sprite, red sports car vehicle, top-down racing view, 16-bit retro game style, clean pixels, sharp edges, game asset, sleek design',
            filename: 'car-sprite.png'
        },
        {
            prompt: 'pixel art game sprite, medieval knight in armor with sword and shield, top-down view, 16-bit retro game style, clean pixels, sharp edges, game asset, warrior character',
            filename: 'knight-sprite.png'
        },
    ];
    
    for (const testCase of testCases) {
        await generateSprite(testCase.prompt, testCase.filename);
        // Wait between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test complete!');
    console.log(`\n📁 Generated sprites saved to: ${OUTPUT_DIR}`);
    console.log('\n💡 Next steps:');
    console.log('   1. Open the sprites and review quality');
    console.log('   2. Compare to Astrocade\'s output');
    console.log('   3. If quality is good, integrate into Phase 2');
    console.log('   4. Generate 2-3 hero sprites per game');
}

main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
