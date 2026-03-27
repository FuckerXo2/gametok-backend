import fs from 'fs';
import path from 'path';

async function testHorde() {
    console.log("🎨 Testing AI Horde Image Generator standalone...");
    
    // We mock the manifest that Claude Haiku would normally provide
    const manifest = {
        assets: [
            {
                key: 'pizza_sprite',
                prompt: 'a flying pizza slice, pixel art style, solid black background',
                width: 512,
                height: 512
            }
        ]
    };

    const fetchImage = async (assetObj) => {
        try {
            console.log(`-> Requesting image for [${assetObj.key}] from AI Horde...`);
            const submitRes = await fetch("https://aihorde.net/api/v2/generate/async", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': '0000000000' },
                body: JSON.stringify({
                    prompt: assetObj.prompt,
                    params: { width: assetObj.width, height: assetObj.height, steps: 20 },
                    nsfw: false, censor_nsfw: true, r2: true
                })
            });
            
            if (!submitRes.ok) throw new Error("Horde submit failed: " + submitRes.status);
            const submitData = await submitRes.json();
            const jobId = submitData.id;
            if (!jobId) throw new Error("No job ID returned");
            
            console.log(`-> Job ID [${jobId}] created. Waiting for generation (~20-30s)...`);

            // Poll for completion
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const checkRes = await fetch("https://aihorde.net/api/v2/generate/check/" + jobId);
                const checkData = await checkRes.json();
                if (checkData.done) {
                    console.log(`\n-> Job [${jobId}] DONE!`);
                    break;
                }
                process.stdout.write(".");
            }

            // Get final status and image
            const statusRes = await fetch("https://aihorde.net/api/v2/generate/status/" + jobId);
            const statusData = await statusRes.json();
            if (statusData.generations && statusData.generations.length > 0) {
                const imgUrl = statusData.generations[0].img;
                console.log(`✅ SUCCESS! Image URL: ${imgUrl}`);
                
                // Download and save the image to artifacts so we can show it to the user
                const imgRes = await fetch(imgUrl);
                const arrayBuffer = await imgRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                const artifactDir = '/Users/abiolalimitless/.gemini/antigravity/brain/e86ac177-1445-4976-8276-a3e34624ba27';
                const filePath = path.join(artifactDir, `${assetObj.key}.webp`);
                fs.writeFileSync(filePath, buffer);
                console.log(`💾 Image saved directly to artifacts at: ${filePath}`);
                
                return filePath;
            }
            console.log(`\n❌ FAILED to get image array`);
            return null;
        } catch(e) { 
            console.error(`\n❌ Art Error:`, e.message); 
            return null; 
        }
    };

    await fetchImage(manifest.assets[0]);
}

testHorde();
