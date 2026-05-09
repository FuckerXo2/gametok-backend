#!/usr/bin/env node
/**
 * Test FLUX with different dimensions to find minimum supported size
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

async function testDimension(width, height) {
    console.log(`\n🧪 Testing ${width}x${height}...`);
    
    try {
        const response = await fetch(NVIDIA_FLUX_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: 'simple red circle',
                width,
                height,
                cfg_scale: 0,
                mode: 'base',
                samples: 1,
                steps: 4,
            }),
        });
        
        if (!response.ok) {
            const text = await response.text();
            console.log(`   ❌ Failed: ${response.status}`);
            console.log(`   Error: ${text.slice(0, 150)}`);
            return false;
        }
        
        const json = await response.json();
        const success = json.artifacts?.[0]?.base64?.length > 0;
        
        if (success) {
            console.log(`   ✅ SUCCESS - ${width}x${height} works!`);
            console.log(`   Image size: ${(json.artifacts[0].base64.length / 1024).toFixed(1)} KB`);
        } else {
            console.log(`   ❌ No image returned`);
        }
        
        return success;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🔍 Testing FLUX Dimension Limits\n');
    console.log('=' .repeat(50));
    
    const testSizes = [
        { width: 256, height: 256, label: 'Sprite size' },
        { width: 512, height: 512, label: 'Small' },
        { width: 768, height: 768, label: 'Medium' },
        { width: 1024, height: 1024, label: 'Current (working)' },
        { width: 64, height: 64, label: 'Tiny sprite' },
        { width: 128, height: 128, label: 'Small sprite' },
    ];
    
    const results = [];
    
    for (const size of testSizes) {
        const success = await testDimension(size.width, size.height);
        results.push({ ...size, success });
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESULTS:\n');
    
    const working = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    if (working.length > 0) {
        console.log('✅ Working dimensions:');
        working.forEach(r => console.log(`   - ${r.width}x${r.height} (${r.label})`));
    }
    
    if (failed.length > 0) {
        console.log('\n❌ Failed dimensions:');
        failed.forEach(r => console.log(`   - ${r.width}x${r.height} (${r.label})`));
    }
    
    const minWorking = working.sort((a, b) => a.width - b.width)[0];
    if (minWorking) {
        console.log(`\n🎯 Minimum working size: ${minWorking.width}x${minWorking.height}`);
    }
}

main().catch(console.error);
