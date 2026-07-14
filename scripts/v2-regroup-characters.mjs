#!/usr/bin/env node
// Regroup the v2 catalog from 262 flat animation-items to ~144 character-centric entries, each
// carrying ALL of its animations. Fixes: retrieval was picking a character's SWIM pose for
// "basketball player" because each animation embedded and competed independently.
//
// Grouping key: source_pack + description with the animation-specific clause stripped. Every
// labeling script in this project wrote descriptions as "{character desc}, {anim clause} (N
// frames)" reusing the same character-desc prefix per pose — verified empirically: this correctly
// clusters e.g. Toon Characters' 6 poses per character while leaving Isometric Watercraft's 29
// DISTINCT boat designs (which just happen to each have their own single rotation "animation")
// un-merged, since each boat's description is unique.
//
// New entry shape — one logical character, multiple PHYSICAL sheets (each animation is still its
// own PNG on R2; poses were never re-packed into one shared texture):
//   { id, asset_type, species, perspective, movement, theme, playable_role, motion,
//     quality_score, confidence_score, source_pack, description,
//     animations: { [name]: { sheet_url, atlas_url, frame_count, canvas_size, fps, loop } } }  // animated
//   { ..., motion:'static', image_url, canvas_size, animations: {} }                             // static
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const AI = 'src/ai-engine';
const catPath = path.join(AI, 'v2-asset-catalog.json');
const embPath = path.join(AI, 'v2-asset-embeddings.json');
const cat = JSON.parse(fs.readFileSync(catPath));

function stripAnimClause(desc) {
  return desc
    .replace(/,\s*[^,]*\(\d+\s*frames?\)\s*\.?$/i, '')
    .replace(/,\s*\(static single-frame sprite, move with code\)\s*\.?$/i, '')
    .replace(/\s*\(static single-frame sprite, move with code\)\s*\.?$/i, '')
    .trim();
}
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// --- GROUP ---
const groups = new Map();
for (const it of cat.items) {
  const key = it.source_pack + '::' + stripAnimClause(it.description);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(it);
}
console.log(`${cat.items.length} items -> ${groups.size} character groups`);

// --- BUILD MERGED ENTRIES ---
const usedIds = new Set();
function uniqueId(base) {
  let id = base, n = 2;
  while (usedIds.has(id)) id = `${base}_${n++}`;
  usedIds.add(id);
  return id;
}

const merged = [];
const warnings = [];
for (const [, items] of groups) {
  const first = items[0];
  // Sanity: every field except animation_type/quality/confidence/frame_count/canvas_size/id/r2
  // should agree across the group — these came from the same labeling call for the same character.
  for (const f of ['asset_type', 'species', 'perspective', 'movement', 'theme', 'playable_role', 'motion', 'source_pack']) {
    const vals = new Set(items.map(i => i[f]));
    if (vals.size > 1) warnings.push(`${first.id.split('/').slice(0,2).join('/')}: field '${f}' disagrees across group: ${[...vals].join(', ')}`);
  }

  const strippedDesc = stripAnimClause(first.description);
  const packSlug = slugify(first.source_pack);
  const charSlug = slugify(strippedDesc).split('_').slice(0, 6).join('_');
  const id = uniqueId(`char/${packSlug}/${charSlug}`);

  const animations = {};
  for (const it of items) {
    const animName = it.animation_type;
    animations[animName] = {
      sheet_url: it.r2.sheet_url,
      atlas_url: it.r2.atlas_url,
      frame_count: it.frame_count,
      canvas_size: it.canvas_size,
      fps: it.atlas_animations?.[animName]?.fps ?? 8,
      loop: it.atlas_animations?.[animName]?.loop ?? true,
    };
  }
  const animNames = Object.keys(animations);
  const qualityScore = Math.max(...items.map(i => i.quality_score));
  const confidenceScore = Math.min(...items.map(i => i.confidence_score));

  const entry = {
    id,
    asset_type: first.asset_type,
    species: first.species,
    perspective: first.perspective,
    movement: first.movement,
    theme: first.theme,
    playable_role: first.playable_role,
    motion: first.motion,
    quality_score: qualityScore,
    confidence_score: confidenceScore,
    source_pack: first.source_pack,
    description: strippedDesc,
    animation_names: animNames,
    animations,
  };
  if (first.motion === 'static') {
    entry.image_url = first.r2.sheet_url;
    entry.canvas_size = first.canvas_size;
  }
  merged.push(entry);
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} field-consistency warnings (using first item's value):`);
  warnings.slice(0, 20).forEach(w => console.log('  ' + w));
}

// --- RE-EMBED (fresh, on the clean character description + animation list) ---
console.log('\n=== EMBEDDING ===');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function embedText(e) {
  return `${e.asset_type} ${e.species} ${e.motion} ${e.perspective} ${e.movement} ${e.theme} ${e.playable_role} animations:${e.animation_names.join(',')}. ${e.description}`;
}
const MODEL = 'text-embedding-3-small', DIMENSIONS = 256;
const resp = await openai.embeddings.create({ model: MODEL, input: merged.map(embedText), dimensions: DIMENSIONS });
const b64 = f => Buffer.from(new Float32Array(f).buffer).toString('base64');

const embItems = merged.map((e, i) => ({ ...e, vec: b64(resp.data[i].embedding) }));
const catItems = merged.map(e => ({ ...e, search_text: embedText(e).toLowerCase() }));

// --- BACKUP + WRITE ---
fs.copyFileSync(catPath, catPath + '.pre-regroup.bak');
fs.copyFileSync(embPath, embPath + '.pre-regroup.bak');
fs.writeFileSync(catPath, JSON.stringify({ schema: cat.schema, builtAt: new Date().toISOString(), items: catItems }, null, 2));
fs.writeFileSync(embPath, JSON.stringify({ model: MODEL, dimension: DIMENSIONS, builtAt: new Date().toISOString(), items: embItems }));

console.log(`\n✅ Regrouped: ${cat.items.length} -> ${merged.length} character entries`);
console.log(`   Backups: ${catPath}.pre-regroup.bak, ${embPath}.pre-regroup.bak`);
const multi = merged.filter(e => e.animation_names.length > 1).length;
console.log(`   ${multi} characters have 2+ animations, ${merged.length - multi} have 1`);
