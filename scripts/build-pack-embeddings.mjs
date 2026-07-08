#!/usr/bin/env node
/**
 * Build pack-level embeddings via OpenAI text-embedding-3-small.
 * Reads the unified asset catalog, builds a rich text summary per pack,
 * batch-embeds them, and writes pack-embeddings.json next to the catalogs.
 *
 * Usage:  OPENAI_API_KEY=... node scripts/build-pack-embeddings.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_DIR = path.join(__dirname, '..', 'src', 'ai-engine');
const OUT = path.join(AI_DIR, 'pack-embeddings.json');
const MODEL = 'text-embedding-3-small';

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

function buildPackSummaries(assets) {
  const packs = {};
  for (const a of assets) {
    if (a.role === 'atlas') continue;
    const p = a.pack || a.source || 'unknown';
    if (!packs[p]) packs[p] = { roles: new Set(), orientations: new Set(), descs: [] };
    if (a.role) packs[p].roles.add(a.role);
    if (a.orientation && a.orientation !== 'unknown' && a.orientation !== 'n_a') {
      packs[p].orientations.add(a.orientation);
    }
    const desc = (a.description || '').split('—')[0].trim();
    if (desc && desc.length > 3 && !desc.startsWith('tile ') && !desc.startsWith('FULL PACKED')) {
      packs[p].descs.push(desc);
    }
  }

  // Collapse near-identical variants BEFORE sampling. Kenney names sprites like "characterBlue (1..14)"
  // or "ball_basket1..4" — without this, 14 identical variants eat every summary slot and the pack's
  // real variety (balls, bats, rackets) never enters the embedding. This is what made a basketball
  // prompt unable to find the Sports Pack: its fingerprint was 14x "characterBlue" + "element", no ball.
  const normalize = (d) => d
    .replace(/\s*\(\d+\)\s*$/, '')   // "characterBlue (12)" -> "characterBlue"
    .replace(/[\s_-]*\d+$/, '')      // "ball basket4" / "tile_0000" -> "ball basket" / "tile"
    .trim();

  const summaries = [];
  for (const [name, info] of Object.entries(packs)) {
    // Dedup on the normalized key, but keep the readable normalized form for the summary text.
    const seen = new Set();
    const distinct = [];
    for (const d of info.descs) {
      const key = normalize(d).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      distinct.push(normalize(d));
    }
    const sampleDescs = distinct.slice(0, 30).join(', ');
    const orient = [...info.orientations].join('/') || 'various';
    const roles = [...info.roles].join(', ');

    const text = `${name}: ${sampleDescs}. Roles: ${roles}. Perspective: ${orient}.`;
    summaries.push({ pack: name, text });
  }
  return summaries;
}

async function batchEmbed(client, texts) {
  const BATCH = 100;
  const embeddings = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    console.log(`  Embedding batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(texts.length / BATCH)} (${batch.length} items)...`);
    const result = await client.embeddings.create({ model: MODEL, input: batch });
    embeddings.push(...result.data.map(d => d.embedding));
  }
  return embeddings;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY');
    process.exit(1);
  }

  console.log('Loading assets...');
  const assets = loadAllAssets();
  console.log(`  ${assets.length} total assets`);

  console.log('Building pack summaries...');
  const summaries = buildPackSummaries(assets);
  console.log(`  ${summaries.length} packs`);

  console.log(`Embedding via OpenAI ${MODEL}...`);
  const client = new OpenAI({ apiKey });
  const vectors = await batchEmbed(client, summaries.map(s => s.text));

  const output = {
    model: MODEL,
    dimension: vectors[0]?.length || 0,
    builtAt: new Date().toISOString(),
    packs: summaries.map((s, i) => ({
      pack: s.pack,
      text: s.text,
      embedding: vectors[i],
    })),
  };

  fs.writeFileSync(OUT, JSON.stringify(output));
  const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`✅ Wrote ${OUT} (${output.packs.length} packs, ${output.dimension}d, ${sizeMB} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
