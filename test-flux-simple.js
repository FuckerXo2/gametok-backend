#!/usr/bin/env node
/**
 * Simple test of FLUX endpoint that's working in cover-art.js
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const NVIDIA_FLUX_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

async function testFlux() {
    console.log('🧪 Testing FLUX endpoint from cover-art.js\n');
    console.log(`📍 Endpoint: ${NVIDIA_FLUX_URL}\n`);
    
    const prompt = 'pixel art game sprite: zombie character, rotting flesh, green decaying skin. Style: 16-bit retro game, clean pixel art, sharp edges, top-down view';
    
    console.log(`🎨 Prompt: ${prompt}\n`);
    
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
        
        console.log(`📡 Response status: ${response.status} ${response.statusText}\n`);
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`❌ Error response:\n${text}\n`);
            return;
        }
        
        const json = await response.json();
        console.log('✅ Success! Response structure:');
        console.log(`   - artifacts: ${json.artifacts?.length || 0}`);
        console.log(`   - finishReason: ${json.artifacts?.[0]?.finishReason}`);
        console.log(`   - base64 length: ${json.artifacts?.[0]?.base64?.length || 0} chars\n`);
        
        if (json.artifacts?.[0]?.base64) {
            console.log('🎉 FLUX is working! Image generated successfully.');
        }
        
    } catch (error) {
        console.error(`❌ Fatal error: ${error.message}`);
    }
}

testFlux();
