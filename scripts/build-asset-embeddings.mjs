#!/usr/bin/env node
/**
 * Per-ASSET embeddings (not per-pack) — the retrieval backend for entity-level search.
 *
 * Pack-level search (build-pack-embeddings.mjs) answers "which packs fit this game" but a pack
 * can hold hundreds of items, and the actual item a game needs (a basketball hoop) can be crowded
 * out downstream by generic-named siblings before the generator ever sees it. This embeds every
 * individual asset description, so a game can ask "find me a hoop" directly and get one back,
 * regardless of which pack/role bucket it happens to live in.
 *
 * 256 dims (not the full 1536) — OpenAI's text-embedding-3 models are trained with Matryoshka
 * representation learning, so truncating to 256 keeps the great majority of retrieval quality at
 * ~1/6 the storage. Vectors are base64-packed Float32Array (not JSON number arrays) — verbose JSON
 * floats run ~5x larger than packed binary; base64-Float32 keeps the ~40k-item file in the tens of
 * MB instead of ~200MB.
 *
 * Usage: OPENAI_API_KEY=... node scripts/build-asset-embeddings.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_DIR = path.join(__dirname, '..', 'src', 'ai-engine');
const OUT = path.join(AI_DIR, 'asset-embeddings.json');
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;

const SOURCES = ['kenney2d-catalog.json', 'phaser-catalog-normalized.json', 'cooking-catalog.json', 'diner-catalog.json'];

function loadAllAssets() {
  const all = [];
  for (const f of SOURCES) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(AI_DIR, f), 'utf8'));
      if (Array.isArray(data.assets)) all.push(...data.assets);
    } catch {}
  }
  return all;
}

// Text fed to the embedder per item — short, descriptive, includes pack/role for context.
function assetText(a) {
  const name = String(a.description || '').split('—')[0].trim();
  return `${name} (${a.role || 'prop'}, ${a.pack || a.source || ''})`;
}

function floatsToBase64(floats) {
  const buf = Buffer.from(new Float32Array(floats).buffer);
  return buf.toString('base64');
}

async function batchEmbed(client, texts) {
  const BATCH = 500;
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    process.stdout.write(`\r  Embedding ${Math.min(i + BATCH, texts.length)}/${texts.length}...`);
    const result = await client.embeddings.create({ model: MODEL, input: batch, dimensions: DIMENSIONS });
    vectors.push(...result.data.map(d => d.embedding));
  }
  console.log('');
  return vectors;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  console.log('Loading assets...');
  const assets = loadAllAssets().filter(a => a.role !== 'atlas');
  console.log(`  ${assets.length} assets (excluding atlas composites)`);

  console.log(`Embedding via OpenAI ${MODEL} @ ${DIMENSIONS}d...`);
  const client = new OpenAI({ apiKey });
  const vectors = await batchEmbed(client, assets.map(assetText));

  const items = assets.map((a, i) => ({
    id: a.id,
    pack: a.pack || a.source || '',
    role: a.role,
    orientation: a.orientation || 'unknown',
    description: a.description,
    localPath: a.localPath,
    url: a.url,
    width: a.width,
    height: a.height,
    tileable: a.tileable || false,
    vec: floatsToBase64(vectors[i]),
  }));

  const output = { model: MODEL, dimension: DIMENSIONS, builtAt: new Date().toISOString(), items };
  fs.writeFileSync(OUT, JSON.stringify(output));
  const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`✅ Wrote ${OUT} (${items.length} items, ${DIMENSIONS}d, ${sizeMB} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
