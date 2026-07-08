/**
 * Semantic asset search via OpenAI embeddings.
 * Replaces the brittle extractThemeKeywords() regex with cosine-similarity
 * over pack-level embeddings.
 *
 * Flow: embed user prompt → rank packs by similarity → return top pack names
 * for selectGameAssets() to filter on.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'text-embedding-3-small';

let packEmbeddings = null;
let client = null;

function loadPackEmbeddings() {
  if (packEmbeddings) return packEmbeddings;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'pack-embeddings.json'), 'utf8');
    packEmbeddings = JSON.parse(raw);
    console.log(`✅ Pack embeddings loaded: ${packEmbeddings.packs.length} packs, ${packEmbeddings.dimension}d (${packEmbeddings.model})`);
    return packEmbeddings;
  } catch (err) {
    console.warn('⚠️  pack-embeddings.json not found — run: node scripts/build-pack-embeddings.mjs');
    return null;
  }
}

function getClient() {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn('⚠️  OPENAI_API_KEY not set — embedding search disabled');
    return null;
  }
  client = new OpenAI({ apiKey: key });
  return client;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Embed user prompt and return top matching pack names.
 * @param {string} prompt - User's game description
 * @param {number} topK - Number of packs to return (default 8)
 * @returns {Promise<string[]>} Pack names ranked by relevance, or [] on failure
 */
export async function findRelevantPacks(prompt, topK = 8) {
  const data = loadPackEmbeddings();
  const c = getClient();
  if (!data || !c) return [];

  try {
    const result = await c.embeddings.create({ model: MODEL, input: prompt });
    const queryVec = result.data[0].embedding;

    const scored = data.packs.map(p => ({
      pack: p.pack,
      score: cosine(queryVec, p.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);

    const top = scored.slice(0, topK);
    console.log(`🔍 Embedding search for "${prompt.slice(0, 60)}...":`);
    top.forEach((p, i) => console.log(`   ${i + 1}. ${p.pack} (${p.score.toFixed(3)})`));

    return top.map(p => p.pack);
  } catch (err) {
    console.error('⚠️  Embedding search failed:', err.message);
    return [];
  }
}

loadPackEmbeddings();
