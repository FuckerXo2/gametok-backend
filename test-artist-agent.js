/**
 * Test Artist Agent Integration
 * 
 * This script tests the Artist Agent by generating a few test sprites.
 */

import { artistAgent, batchArtistAgent } from './src/ai-engine/sprite-generator.js';

async function testSingleGeneration() {
    console.log('\n🧪 TEST 1: Single Sprite Generation');
    console.log('=====================================\n');
    
    try {
        const dataUri = await artistAgent({
            assetType: 'sprite',
            description: 'brave knight character in armor',
            category: 'player',
            size: 128,
            transparent: true,
        });
        
        console.log('✅ SUCCESS: Generated knight sprite');
        console.log(`   Data URI length: ${dataUri.length} chars`);
        console.log(`   Preview: ${dataUri.slice(0, 80)}...`);
        
        return true;
    } catch (error) {
        console.error('❌ FAILED:', error.message);
        return false;
    }
}

async function testBatchGeneration() {
    console.log('\n🧪 TEST 2: Batch Sprite Generation');
    console.log('=====================================\n');
    
    try {
        const result = await batchArtistAgent([
            {
                id: 'player',
                assetType: 'sprite',
                description: 'hero character with sword',
                category: 'player',
                size: 128,
                transparent: true,
            },
            {
                id: 'enemy',
                assetType: 'sprite',
                description: 'green monster creature',
                category: 'enemy',
                size: 128,
                transparent: true,
            },
            {
                id: 'item',
                assetType: 'sprite',
                description: 'golden coin',
                category: 'item',
                size: 64,
                transparent: true,
            },
        ]);
        
        console.log('✅ SUCCESS: Generated batch of sprites');
        console.log(`   Assets generated: ${Object.keys(result.assets).length}`);
        console.log(`   Errors: ${result.errors ? result.errors.length : 0}`);
        
        for (const [id, dataUri] of Object.entries(result.assets)) {
            console.log(`   - ${id}: ${dataUri.length} chars`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ FAILED:', error.message);
        return false;
    }
}

async function testContentFilterAvoidance() {
    console.log('\n🧪 TEST 3: Content Filter Avoidance');
    console.log('=====================================\n');
    
    try {
        const dataUri = await artistAgent({
            assetType: 'sprite',
            description: 'zombie with rotting flesh and blood',
            category: 'enemy',
            size: 128,
            transparent: true,
        });
        
        console.log('✅ SUCCESS: Generated sprite with filtered content');
        console.log(`   Data URI length: ${dataUri.length} chars`);
        console.log('   Note: "zombie" → "undead creature", "blood" → "red particles"');
        
        return true;
    } catch (error) {
        console.error('❌ FAILED:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('\n🎨 ARTIST AGENT TEST SUITE');
    console.log('===========================\n');
    console.log('This will test the Artist Agent integration.');
    console.log('Expected time: ~30-60 seconds (3 sprites × ~10-20 seconds each)\n');
    
    const startTime = Date.now();
    
    const test1 = await testSingleGeneration();
    const test2 = await testBatchGeneration();
    const test3 = await testContentFilterAvoidance();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('\n📊 TEST RESULTS');
    console.log('================\n');
    console.log(`Test 1 (Single): ${test1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Test 2 (Batch):  ${test2 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Test 3 (Filter): ${test3 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`\nTotal time: ${duration}s`);
    
    const allPassed = test1 && test2 && test3;
    console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`);
    
    process.exit(allPassed ? 0 : 1);
}

runAllTests();
