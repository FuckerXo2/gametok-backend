#!/usr/bin/env node
/**
 * Test all NVIDIA image generation models for small dimension support
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";

// Known NVIDIA image generation models
const MODELS = [
    {
        name: 'FLUX.1-schnell',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell',
        type: 'flux'
    },
    {
        name: 'FLUX.2-klein-4b',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b',
        type: 'flux'
    },
    {
        name: 'SD 3.5 Large',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-5-large',
        type: 'sd'
    },
    {
        name: 'SD 3.5 Medium',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-5-medium',
        type: 'sd'
    },
    {
        name: 'Edify Image',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/nvidia/edify-image',
        type: 'edify'
    },
];

async function testModel(model, width, height) {
    try {
        const body = model.type === 'flux' ? {
            prompt: 'simple red circle',
            width,
            height,
            cfg_scale: 0,
            mode: 'base',
            samples: 1,
            steps: 4,
        } : {
            prompt: 'simple red circle',
            width,
            height,
            steps: 30,
            cfg_scale: 7,
        };
        
        const response = await fetch(model.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        
        if (!response.ok) {
            const text = await response.text();
            // Extract dimension requirements from error if present
            const match = text.match(/should be ([\d, ]+)/);
            return {
                success: false,
                status: response.status,
                error: text.slice(0, 100),
                allowedDimensions: match ? match[1] : null
            };
        }
        
        const json = await response.json();
        const hasImage = json.artifacts?.[0]?.base64?.length > 0;
        
        return {
            success: hasImage,
            status: 200,
            imageSize: hasImage ? (json.artifacts[0].base64.length / 1024).toFixed(1) + ' KB' : null
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function main() {
    console.log('🔍 Testing All NVIDIA Image Generation Models\n');
    console.log('=' .repeat(70));
    
    const testSizes = [
        { width: 64, height: 64, label: 'Tiny (64x64)' },
        { width: 128, height: 128, label: 'Small (128x128)' },
        { width: 256, height: 256, label: 'Sprite (256x256)' },
        { width: 512, height: 512, label: 'Medium (512x512)' },
    ];
    
    const results = {};
    
    for (const model of MODELS) {
        console.log(`\n📦 Testing: ${model.name}`);
        console.log('─'.repeat(70));
        
        results[model.name] = {};
        
        for (const size of testSizes) {
            process.stdout.write(`   ${size.label}... `);
            
            const result = await testModel(model, size.width, size.height);
            results[model.name][`${size.width}x${size.height}`] = result;
            
            if (result.success) {
                console.log(`✅ SUCCESS (${result.imageSize})`);
            } else if (result.status === 404) {
                console.log(`❌ Model not found`);
                break; // Skip other sizes for this model
            } else if (result.allowedDimensions) {
                console.log(`❌ Not allowed (supports: ${result.allowedDimensions})`);
            } else {
                console.log(`❌ Failed (${result.status || 'error'})`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 800));
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY\n');
    
    const workingModels = [];
    
    for (const [modelName, sizes] of Object.entries(results)) {
        const smallestWorking = Object.entries(sizes)
            .filter(([_, result]) => result.success)
            .sort((a, b) => {
                const [widthA] = a[0].split('x').map(Number);
                const [widthB] = b[0].split('x').map(Number);
                return widthA - widthB;
            })[0];
        
        if (smallestWorking) {
            workingModels.push({
                name: modelName,
                minSize: smallestWorking[0],
                imageSize: smallestWorking[1].imageSize
            });
        }
    }
    
    if (workingModels.length > 0) {
        console.log('✅ Models that work:\n');
        workingModels.forEach(m => {
            console.log(`   ${m.name}`);
            console.log(`      Minimum: ${m.minSize} (${m.imageSize})`);
        });
        
        const bestModel = workingModels.sort((a, b) => {
            const [widthA] = a.minSize.split('x').map(Number);
            const [widthB] = b.minSize.split('x').map(Number);
            return widthA - widthB;
        })[0];
        
        console.log(`\n🎯 Best for sprites: ${bestModel.name} (min ${bestModel.minSize})`);
    } else {
        console.log('❌ No models support small sprite dimensions (<512px)');
        console.log('\n💡 Recommendation: Use Retro Diffusion API for native sprite generation');
    }
}

main().catch(console.error);
