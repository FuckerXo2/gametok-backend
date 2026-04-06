import fs from 'fs';
import { getAllAssets } from './src/ai-engine/asset-dictionary.js';
import dotenv from 'dotenv';
dotenv.config();

const napiKey = process.env.NVIDIA_API_KEY || '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';

async function getEmbedding(text) {
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${napiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: [text],
        model: 'nvidia/nv-embedqa-e5-v5',
        encoding_format: 'float',
        input_type: 'query'
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.data[0].embedding;
  } catch (err) {
    console.error("Failed:", err.message);
    return null;
  }
}

async function run() {
  const assets = getAllAssets();
  console.log(`Precomputing embeddings for ${assets.length} assets...`);
  const cache = [];
  
  // Batch processing
  for (let i = 0; i < assets.length; i += 20) {
    const batch = assets.slice(i, i + 20);
    console.log(`Processing batch ${i} to ${i + batch.length}...`);
    
    // We can run each batch in parallel
    const promises = batch.map(async (asset) => {
      const description = `${asset.label}. Tags: ${asset.tags.join(', ')}`;
      const vec = await getEmbedding(description);
      return { assetId: asset.id, vector: vec };
    });
    
    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r.vector) cache.push(r);
    });
    
    // Small delay to prevent rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  fs.writeFileSync('./src/ai-engine/asset-embeddings.json', JSON.stringify(cache));
  console.log(`Saved ${cache.length} embeddings!`);
}

run();
