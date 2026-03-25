import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

console.log("=== 🚀 Initializing Semantic Vector Asset Scraper ===");

// Make sure process.env.GEMINI_API_KEY is set when running
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

const FOLDERS = [
    { type: 'sprite', ext: '.png', path: 'public/assets/sprites' },
    { type: 'background', ext: '.png', path: 'public/assets/skies' },
    { type: 'particle', ext: '.png', path: 'public/assets/particles' }
];

async function fetchGithubDirectory(dirPath) {
    const url = `https://api.github.com/repos/phaserjs/examples/contents/${dirPath}`;
    console.log(`📡 Scraping: ${url}`);
    
    const response = await fetch(url, { headers: { 'User-Agent': 'DreamStream-Asset-Scraper' } });
    if (!response.ok) {
        console.error(`GitHub API Error: ${response.status} ${response.statusText}`);
        return [];
    }
    const data = await response.json();
    return data.filter(file => file.type === 'file').map(file => file.name);
}

// Generates an embedding for a text string (e.g. "cute pink pig animal")
async function embedText(text) {
    try {
        const result = await embedModel.embedContent(text);
        return result.embedding.values;
    } catch (e) {
        console.error(`Embedding failed for [${text}]:`, e.message);
        return null;
    }
}

// Convert filename (e.g. "space-baddie.png") into semantic tags ("space baddie")
function generateSemanticTags(filename, category) {
    let clean = filename.replace(/\.(png|jpg|jpeg)$/, '')
                        .replace(/[_-]/g, ' ')
                        .replace(/[0-9]/g, '');
    return `${category} ${clean}`.trim();
}

async function buildDatabase() {
    let database = [];
    
    // Scrape file names
    for (const folder of FOLDERS) {
        const files = await fetchGithubDirectory(folder.path);
        console.log(`📥 Downloaded ${files.length} assets from /${folder.path}`);
        
        // Filter out non-images
        const validFiles = files.filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
        
        // Pick top 200 items per folder so we don't blow up rate limits during scraping
        const sample = validFiles.slice(0, 150); 
        
        console.log(`🧠 Generating Vectors for ${sample.length} ${folder.type}s...`);
        for (let i = 0; i < sample.length; i++) {
            const filename = sample[i];
            const tags = generateSemanticTags(filename, folder.type);
            const vector = await embedText(tags);
            
            if (vector) {
                database.push({
                    name: filename,
                    url: `https://labs.phaser.io/assets/${folder.path.split('public/assets/')[1]}/${filename}`,
                    type: folder.type,
                    tags: tags,
                    vector: vector
                });
            }
            // Small heartbeat delay to respect API limits
            await new Promise(r => setTimeout(r, 200));
            if (i % 25 === 0 && i !== 0) console.log(`   ... Embedded ${i}/${sample.length}`);
        }
    }

    console.log(`✅ Embedding Complete. Indexed ${database.length} assets.`);
    fs.writeFileSync('src/vector_db.json', JSON.stringify(database, null, 2));
    console.log("💾 Saved locally to src/vector_db.json!");
}

buildDatabase();
