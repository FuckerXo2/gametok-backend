import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from '../db.js';
import { ASSET_CATALOG } from '../assets.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0; let normA = 0; let normB = 0;
    for(let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getDynamicAssetCatalog(userPrompt) {
    try {
        const promptEmbedResult = await embedModel.embedContent(userPrompt);
        const promptVector = promptEmbedResult.embedding.values;

        const { rows } = await pool.query('SELECT name, url, type, tags, vector FROM asset_vectors');
        if (rows.length === 0) return ASSET_CATALOG;

        const scoredAssets = rows.map(row => {
            const vec = typeof row.vector === 'string' ? JSON.parse(row.vector) : row.vector; 
            return { name: row.name, url: row.url, type: row.type, score: cosineSimilarity(promptVector, vec) };
        });
        
        scoredAssets.sort((a, b) => b.score - a.score);
        const topAssets = scoredAssets.slice(0, 20);
        
        return {
            characters_and_items: topAssets.filter(t => t.type === 'sprite').map(a => ({ name: a.name, url: a.url })),
            backgrounds: topAssets.filter(t => t.type === 'background').map(a => ({ name: a.name, url: a.url })),
            particles: topAssets.filter(t => t.type === 'particle').map(a => ({ name: a.name, url: a.url }))
        };
    } catch (e) {
        console.error("RAG Failure, falling back to static catalog:", e.message);
        return ASSET_CATALOG;
    }
}
