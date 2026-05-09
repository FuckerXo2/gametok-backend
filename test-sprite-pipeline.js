#!/usr/bin/env node
/**
 * Test the complete sprite generation pipeline
 */

import { generateSprite } from './src/ai-engine/sprite-generator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, 'test-sprites-processed');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function testSprite(description, type, filename) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎨 Testing: ${description}`);
    console.log(`   Type: ${type}`);
    console.log(`${'='.repeat(70)}`);
    
    try {
        // Generate at different sizes
        const sizes = [64, 128, 256];
        
        for (const size of sizes) {
            console.log(`\n📐 Generating ${size}x${size}...`);
            
            const startTime = Date.now();
            const sprite = await generateSprite({
                description,
                type,
                targetSize: size,
                removeBg: true,
            });
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            // Save to file
            const buffer = Buffer.from(sprite, 'base64');
            const filepath = path.join(OUTPUT_DIR, `${filename}-${size}px.png`);
            fs.writeFileSync(filepath, buffer);
            
            console.log(`   ✅ Generated in ${duration}s`);
            console.log(`   💾 Saved: ${filepath}`);
            console.log(`   📊 Size: ${(buffer.length / 1024).toFixed(1)} KB`);
        }
        
        return true;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🧪 Testing Free Sprite Generation Pipeline\n');
    console.log('Pipeline: FLUX.2-klein-4b → BRIA RMBG → Sharp Downscale\n');
    
    const testCases = [
        {
            description: 'red sports car, sleek design, racing vehicle',
            type: 'vehicle',
            filename: 'car'
        },
        {
            description: 'medieval knight in shining armor, sword and shield',
            type: 'character',
            filename: 'knight'
        },
        {
            description: 'green fantasy monster, undead creature',
            type: 'enemy',
            filename: 'monster'
        },
        {
            description: 'brave hero character, tactical gear',
            type: 'character',
            filename: 'hero'
        },
    ];
    
    let successCount = 0;
    
    for (const testCase of testCases) {
        const success = await testSprite(
            testCase.description,
            testCase.type,
            testCase.filename
        );
        
        if (success) successCount++;
        
        // Wait between tests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 RESULTS: ${successCount}/${testCases.length} successful`);
    console.log(`📁 Output: ${OUTPUT_DIR}`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Open the sprites and check quality`);
    console.log(`   2. Compare 64px, 128px, 256px versions`);
    console.log(`   3. If quality is good → integrate into Phase 2`);
    console.log(`   4. If quality is bad → consider Retro Diffusion`);
}

main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
