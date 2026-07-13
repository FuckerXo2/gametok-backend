#!/usr/bin/env node
// v2 per-asset embeddings — same encoding conventions as build-asset-embeddings.mjs
// (text-embedding-3-small @ 256d, base64-packed Float32) so the retrieval loader can share code.
// Input text: description + enum tags (asset_type, species, animation_type, perspective, movement,
// theme, playable_role) — enums are short controlled tokens that anchor the embedding on the axes
// the design planner will actually query.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_DIR = path.join(__dirname, '..', 'src', 'ai-engine');
const LABELED = path.resolve('v2-catalog/staging/kenney-all/_labeled.json');
const OUT = path.join(AI_DIR, 'v2-asset-embeddings.json');
const CATALOG_OUT = path.join(AI_DIR, 'v2-asset-catalog.json');
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;

const bundle = JSON.parse(fs.readFileSync(LABELED));

function embedText(l) {
  // Enums first (weighted by repetition — the planner queries in these terms), then rich description.
  return `${l.asset_type} ${l.species} ${l.animation_type} ${l.perspective} ${l.movement} ${l.theme} ${l.playable_role}. ${l.description}`;
}

function floatsToBase64(floats) {
  return Buffer.from(new Float32Array(floats).buffer).toString('base64');
}

async function batchEmbed(client, texts) {
  const BATCH = 200;
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    process.stdout.write(`\r  Embedding ${Math.min(i + BATCH, texts.length)}/${texts.length}...`);
    const result = await client.embeddings.create({ model: MODEL, input: batch, dimensions: DIMENSIONS });
    vectors.push(...result.data.map(d => d.embedding));
  }
  console.log();
  return vectors;
}

async function main() {
  const items = bundle.items;
  if (!items?.length) { console.error('no items in labeled bundle'); process.exit(1); }
  console.log(`v2 embeddings for ${items.length} labeled items`);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const vectors = await batchEmbed(client, items.map(embedText));

  // Embeddings file: minimal, only what retrieval needs — id, all label enums, R2 URLs, vector.
  const embItems = items.map((l, i) => ({
    id: l.id,
    asset_type: l.asset_type,
    species: l.species,
    animation_type: l.animation_type,
    perspective: l.perspective,
    movement: l.movement,
    theme: l.theme,
    playable_role: l.playable_role,
    frame_count: l.frame_count,
    canvas_size: l.canvas_size,
    quality_score: l.quality_score,
    confidence_score: l.confidence_score,
    description: l.description,
    r2: l.r2,
    atlas_animations: l.atlas_ref.animations,
    vec: floatsToBase64(vectors[i]),
  }));

  fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, dimension: DIMENSIONS, builtAt: new Date().toISOString(), items: embItems }));

  // Catalog file: same items minus the vec (human-inspectable, retrieval doesn't need it if embeddings load)
  const catalogItems = embItems.map(({ vec, ...rest }) => rest);
  fs.writeFileSync(CATALOG_OUT, JSON.stringify({ schema: bundle.schema, builtAt: new Date().toISOString(), items: catalogItems }, null, 2));

  const embMB = (fs.statSync(OUT).size / 1e6).toFixed(2);
  const catMB = (fs.statSync(CATALOG_OUT).size / 1e6).toFixed(2);
  console.log(`✅ Wrote ${OUT}  (${items.length} items, ${DIMENSIONS}d, ${embMB} MB)`);
  console.log(`✅ Wrote ${CATALOG_OUT}  (${catMB} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
