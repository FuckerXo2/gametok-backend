#!/usr/bin/env node
/**
 * Test the 4 models we missed: Qwen and FLUX variants
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";

const MODELS = [
    {
        name: 'Qwen Image',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/qwen/qwen-image',
    },
    {
        name: 'Qwen Image Edit',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/qwen/qwen-image-edit',
    },
    {
        name: 'FLUX.1-dev',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev',
    },
    {
        name: 'FLUX.1-Kontext-dev',
        endpoint: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev',
    },
];

async function testModel(model, width, height) {
    try {
        // Try FLUX-style body first
        const body = {
            prompt: 'simple red circle',
            width,
            height,
            cfg_scale: 0,
            mode: 'base',
            samples: 1,
            steps: 4,
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
            const match = text.match(/should be ([\d, ]+)/);
            return {
                success: false,
                status: response.status,
                error: text.slice(0, 150),
                allowedDimensions: match ? match[1] : null
            };
        }
        
        const json = await response.json();
        const hasImage = json.artifacts?.[0]?.base64?.length > 0 || json.data?.[0]?.url;
        
        return {
            success: hasImage,
            status: 200,
            imageSize: hasImage ? 'Generated' : null
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function main() {
    console.log('🔍 Testing Missing NVIDIA Image Models\n');
    console.log('=' .repeat(70));
    
    const testSizes = [
        { width: 64, height: 64, label: 'Tiny (64x64)' },
        { width: 128, height: 128, label: 'Small (128x128)' },
        { width: 256, height: 256, label: 'Sprite (256x256)' },
        { width: 512, height: 512, label: 'Medium (512x512)' },
    ];
    
    for (const model of MODELS) {
        console.log(`\n📦 ${model.name}`);
        console.log('─'.repeat(70));
        
        let foundWorking = false;
        
        for (const size of testSizes) {
            process.stdout.write(`   ${size.label}... `);
            
            const result = await testModel(model, size.width, size.height);
            
            if (result.success) {
                console.log(`✅ SUCCESS!`);
                foundWorking = true;
            } else if (result.status === 404) {
                console.log(`❌ Not available via cloud API`);
                break;
            } else if (result.allowedDimensions) {
                console.log(`❌ Not allowed`);
                if (!foundWorking) {
                    console.log(`   📋 Supported: ${result.allowedDimensions.slice(0, 100)}...`);
                }
            } else {
                console.log(`❌ Failed (${result.status || 'error'})`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 800));
        }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 FINAL VERDICT\n');
    console.log('If any model above shows ✅ for 256x256 or smaller,');
    console.log('we found a solution! Otherwise, Retro Diffusion it is.');
}

main().catch(console.error);
