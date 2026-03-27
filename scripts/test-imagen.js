import dotenv from 'dotenv';
dotenv.config();

async function testGeminiImage() {
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`;
    
    try {
        const payload = {
            "instances": [ { "prompt": "a cute pixel art dog" } ],
            "parameters": { "sampleCount": 1 }
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log("Status:", res.status);
        if (data.predictions && data.predictions.length > 0) {
            console.log("SUCCESS! Got base64 image chunk of length:", data.predictions[0].bytesBase64Encoded.length);
        } else {
            console.log("Response:", JSON.stringify(data, null, 2));
        }
    } catch(e) { console.error("Error", e); }
}

testGeminiImage();
