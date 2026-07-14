#!/usr/bin/env node
// Phaser finalize: label → upload → HEAD-verify → embed → merge into main v2 catalog.
// Uses the same R2 path scheme + schema + embedding format as Kenney, and appends into
// v2-asset-embeddings.json + v2-asset-catalog.json so retrieval sees Phaser + Kenney as one pool.
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'OPENAI_API_KEY']) {
  if (!process.env[k]) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const STAGING = 'v2-catalog/staging/phaser-cdn';
const AI_DIR = 'src/ai-engine';
const curated = JSON.parse(fs.readFileSync(path.join(STAGING, '_curated-with-labels.json')));

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/, '');

const slugify = (s) => s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

// --- Label ---
// Each curated entry already has label metadata. We derive the final v2 schema per item, including
// animation_type from the source group's animName, and build the search_text token bag.
function buildLabeled(entry) {
  const { item, label } = entry;
  const anim = item.animName === '__all__' ? 'walk' : (item.animName || 'walk');
  const cleanAnim = /^\d+$/.test(anim) ? 'walk' : slugify(anim.replace(/^\d+_/, ''));
  const animCanonical = mapAnimType(cleanAnim, label.desc_prefix);
  const description = `${label.desc_prefix}, ${cleanAnim} animation (${item.frameCount} frames)`;
  const searchText = [
    label.asset_type, label.species, animCanonical,
    label.perspective, label.movement, label.theme, label.playable_role,
    description,
  ].join(' ').toLowerCase().replace(/[^a-z0-9\s_]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: item.id,
    asset_type: label.asset_type,
    species: label.species,
    animation_type: animCanonical,
    perspective: label.perspective,
    movement: label.movement,
    theme: label.theme,
    playable_role: label.playable_role,
    frame_count: item.frameCount,
    canvas_size: { w: item.canvasW, h: item.canvasH },
    source_pack: label.source,
    quality_score: label.quality,
    confidence_score: 0.9,
    description,
    search_text: searchText,
    _sheetPath: item.sheetPath,
    _previewPath: item.previewPath,
    _rawAnimName: item.animName,
    _cleanAnim: cleanAnim,
  };
}

// Fold arbitrary phaser animation names down to our controlled animation_type enum. Fallback to
// a sensible default keeps the enum stable; the raw name stays available in atlas_animations key.
function mapAnimType(cleanAnim, descPrefix) {
  const a = cleanAnim.toLowerCase();
  if (/walk|run(ning)?|gallop/.test(a)) return /run(ning)?/.test(a) ? 'run' : 'walk';
  if (/idle|guard(_end|_start)?$|hold/.test(a)) return 'idle';
  if (/attack|shoot|shot|fire|hit(_)?/.test(a)) return 'attack';
  if (/^get_hit$|hurt/.test(a)) return 'damage';
  if (/die|death|dead|fall_loop/.test(a)) return 'damage';
  if (/climb/.test(a)) return 'climb';
  if (/swim/.test(a)) return 'swim';
  if (/jump/.test(a)) return 'action';
  if (/turn/.test(a)) return 'turn';
  if (/cheer/.test(a)) return 'cheer';
  if (/fly|flying/.test(a)) return 'fly';
  if (/damage|explode/.test(a)) return 'damage';
  if (/rotate|spin/.test(a)) return 'rotate';
  return 'walk'; // default — most useful anim type for generic sequences
}

const labeled = curated.map(buildLabeled);
console.log(`Built ${labeled.length} labels`);

// --- R2 keys ---
function r2KeysFor(item) {
  const packSlug = slugify(item.source_pack.replace(/^phaser-cdn\s*/, 'phaser_'));
  const basename = path.basename(item._sheetPath, '.png');
  const dir = `assets/v2/${item.asset_type}/${packSlug}`;
  return {
    sheetKey: `${dir}/${basename}.png`,
    atlasKey: `${dir}/${basename}.json`,
    sheetLocal: item._sheetPath,
    atlasLocal: item._sheetPath.replace(/\.png$/, '.json'),
  };
}

async function putObject(local, key, contentType) {
  const body = fs.readFileSync(local);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
  return { key, size: body.length };
}

// --- Upload ---
console.log('\n=== UPLOAD ===');
const uploaded = [];
const t0 = Date.now();
const CONC = 12;
for (let i = 0; i < labeled.length; i += CONC) {
  const batch = labeled.slice(i, i + CONC);
  const results = await Promise.allSettled(batch.map(async item => {
    const keys = r2KeysFor(item);
    await Promise.all([
      putObject(keys.sheetLocal, keys.sheetKey, 'image/png'),
      putObject(keys.atlasLocal, keys.atlasKey, 'application/json'),
    ]);
    return { id: item.id, sheetKey: keys.sheetKey, atlasKey: keys.atlasKey };
  }));
  for (const [j, r] of results.entries()) {
    if (r.status === 'fulfilled') uploaded.push(r.value);
    else { console.error(`Upload failed for ${batch[j].id}: ${r.reason.message}`); process.exit(1); }
  }
  process.stdout.write(`\r  uploaded ${uploaded.length}/${labeled.length}   `);
}
console.log(`\n  ${((Date.now()-t0)/1000).toFixed(1)}s`);

// --- HEAD verify ---
console.log('\n=== HEAD VERIFY ===');
const allKeys = [];
for (const u of uploaded) { allKeys.push(u.sheetKey, u.atlasKey); }
const misses = [];
for (let i = 0; i < allKeys.length; i += 24) {
  const batch = allKeys.slice(i, i + 24);
  const results = await Promise.all(batch.map(async k => {
    const url = `${PUBLIC_URL}/${k}`;
    const res = await fetch(url, { method: 'HEAD' });
    return { key: k, url, ok: res.ok, status: res.status };
  }));
  for (const r of results) if (!r.ok) misses.push(r);
}
if (misses.length) { console.error(`❌ ${misses.length} HEAD misses`); process.exit(1); }
console.log(`✅ All ${allKeys.length} objects live on R2`);

// --- Attach R2 URLs + finalize atlas metadata ---
const uploadById = new Map(uploaded.map(u => [u.id, u]));
const finalized = labeled.map(l => {
  const u = uploadById.get(l.id);
  const atlas_ref = {
    sheet: path.basename(u.sheetKey),
    sheet_path: l._sheetPath,
    preview_path: l._previewPath,
    animations: { [l.animation_type]: { frames: Array.from({length: l.frame_count}, (_, i) => i), fps: 12, loop: true } },
  };
  const r2 = { sheet_url: `${PUBLIC_URL}/${u.sheetKey}`, atlas_url: `${PUBLIC_URL}/${u.atlasKey}`, sheet_key: u.sheetKey, atlas_key: u.atlasKey };
  const { _sheetPath, _previewPath, _rawAnimName, _cleanAnim, ...rest } = l;
  return { ...rest, r2, atlas_ref };
});

fs.writeFileSync(path.join(STAGING, '_labeled.json'), JSON.stringify({ items: finalized }, null, 2));

// --- Embed ---
console.log('\n=== EMBED ===');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function embedText(l) { return `${l.asset_type} ${l.species} ${l.animation_type} ${l.perspective} ${l.movement} ${l.theme} ${l.playable_role}. ${l.description}`; }
const embResp = await openai.embeddings.create({ model: 'text-embedding-3-small', input: finalized.map(embedText), dimensions: 256 });
function floatsToBase64(f) { return Buffer.from(new Float32Array(f).buffer).toString('base64'); }
const newEmbItems = finalized.map((l, i) => ({
  id: l.id, asset_type: l.asset_type, species: l.species, animation_type: l.animation_type,
  perspective: l.perspective, movement: l.movement, theme: l.theme, playable_role: l.playable_role,
  frame_count: l.frame_count, canvas_size: l.canvas_size, source_pack: l.source_pack,
  quality_score: l.quality_score,
  confidence_score: l.confidence_score, description: l.description, r2: l.r2,
  atlas_animations: l.atlas_ref.animations, vec: floatsToBase64(embResp.data[i].embedding),
}));

// --- Merge into main catalog + embeddings ---
const embPath = path.join(AI_DIR, 'v2-asset-embeddings.json');
const catPath = path.join(AI_DIR, 'v2-asset-catalog.json');
const embOld = JSON.parse(fs.readFileSync(embPath));
const catOld = JSON.parse(fs.readFileSync(catPath));

// Dedup by id (idempotent re-runs)
const existingIds = new Set(embOld.items.map(x => x.id));
const additionsEmb = newEmbItems.filter(x => !existingIds.has(x.id));
const additionsCat = newEmbItems.filter(x => !existingIds.has(x.id)).map(({ vec, ...rest }) => rest);

embOld.items.push(...additionsEmb);
embOld.builtAt = new Date().toISOString();
fs.writeFileSync(embPath, JSON.stringify(embOld));

catOld.items.push(...additionsCat);
catOld.builtAt = new Date().toISOString();
fs.writeFileSync(catPath, JSON.stringify(catOld, null, 2));

console.log(`✅ Merged ${additionsEmb.length} new items into ${embPath}`);
console.log(`   Catalog: ${catOld.items.length} total items (was ${catOld.items.length - additionsEmb.length})`);
console.log('\n=== DONE ===');
console.log(`Kenney: 180 items → Kenney+Phaser: ${catOld.items.length} items live.`);
