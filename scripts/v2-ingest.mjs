#!/usr/bin/env node
/**
 * v2 asset ingest — Phase 1+2 (discover/classify/atlas + vision label).
 *
 * Walks a source folder of PNGs, classifies each into a normalized v2 atlas
 * (single sprite = 1-frame atlas; a folder of name_1.png/name_2.png siblings
 * = grid-packed multi-frame atlas), generates a preview composite, sends it
 * to GPT-4o for structured labeling, and writes everything to a staging dir
 * for human review (v2-review.mjs) before anything touches R2.
 *
 * Usage: node scripts/v2-ingest.mjs "<source folder>" <role-hint> <source-tag>
 * Example:
 *   node scripts/v2-ingest.mjs "../Kenney Game Assets All-in-1 3/2D assets/Animal Pack/PNG/Round" animal kenney-animal-pack
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';

dotenv.config();

// --no-vision: skip the paid vision API call entirely. Atlas + preview still get built;
// label is left null with needsLabel:true for a human (or Claude, reading the preview PNGs
// directly) to fill in via v2-label.mjs afterward. Default true — self-labeling is free.
const args = process.argv.slice(2).filter(a => a !== '--no-vision');
const useVisionApi = process.argv.includes('--use-vision-api');
const [, , srcDirArg, roleHint, sourceTag] = ['', '', ...args];
if (!srcDirArg || !roleHint || !sourceTag) {
  console.error('Usage: node scripts/v2-ingest.mjs <sourceDir> <roleHint: character|vehicle|animal> <sourceTag> [--use-vision-api]');
  process.exit(1);
}

const SRC_DIR = path.resolve(srcDirArg);
const STAGING_DIR = path.resolve('v2-catalog/staging', sourceTag);
fs.mkdirSync(STAGING_DIR, { recursive: true });

let openai = null;
if (useVisionApi) {
  const { default: OpenAI } = await import('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- 1. DISCOVER ---
function findPngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPngs(full));
    else if (/\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// --- 2. CLASSIFY — group frame-sequence siblings by stem ---
function classify(pngPaths) {
  const groups = new Map();
  for (const p of pngPaths) {
    const dir = path.dirname(p);
    const name = path.basename(p, '.png');
    const m = name.match(/^(.*?)[_-]?(\d+)$/);
    const stem = m ? m[1] : name;
    const frameNum = m ? parseInt(m[2], 10) : null;
    const key = `${dir}::${stem.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { stem, dir, files: [] });
    groups.get(key).files.push({ path: p, frameNum, name });
  }
  // A group is a real animation sequence only if 2+ files AND all have frameNum
  const results = [];
  for (const [, g] of groups) {
    const framed = g.files.filter(f => f.frameNum !== null);
    if (g.files.length >= 2 && framed.length === g.files.length) {
      framed.sort((a, b) => a.frameNum - b.frameNum);
      results.push({ kind: 'sequence', stem: g.stem, files: framed.map(f => f.path) });
    } else {
      // Not a clean sequence — treat each file as its own single sprite
      for (const f of g.files) {
        results.push({ kind: 'single', stem: f.name, files: [f.path] });
      }
    }
  }
  return results;
}

// --- 3. ATLAS — grid-pack into normalized v2 atlas format ---
async function buildAtlas(group, outDir, id) {
  const frames = await Promise.all(group.files.map(f => sharp(f).metadata()));
  const w = Math.max(...frames.map(f => f.width));
  const h = Math.max(...frames.map(f => f.height));
  const cols = group.files.length;

  const sheetPath = path.join(outDir, `${id}.png`);
  const previewPath = path.join(outDir, `${id}_preview.png`);

  if (group.files.length === 1) {
    fs.copyFileSync(group.files[0], sheetPath);
    fs.copyFileSync(group.files[0], previewPath);
  } else {
    const composite = group.files.map((f, i) => ({ input: f, left: i * w, top: 0 }));
    await sharp({ create: { width: w * cols, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(composite)
      .png()
      .toFile(sheetPath);
    // Preview: same grid but on a visible checker-ish bg so vision model sees it clearly
    await sharp({ create: { width: w * cols, height: h, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
      .composite(composite)
      .png()
      .toFile(previewPath);
  }

  const atlas = {
    sheet: `${id}.png`,
    frameSize: { w, h },
    animations: group.kind === 'sequence'
      ? { walk: { frames: group.files.map((_, i) => i), fps: 8, loop: true } }
      : { idle: { frames: [0], fps: 1, loop: false } },
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(atlas, null, 2));
  return { atlas, sheetPath, previewPath };
}

// --- 4. VISION LABEL ---
async function labelAsset(previewPath, stem, roleHint) {
  const b64 = fs.readFileSync(previewPath).toString('base64');
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You are labeling game sprite assets for a 2D mobile game catalog. The catalog ONLY wants characters, vehicles (including spaceships), and animals — everything else (props, environment, UI) should be rejected. Return ONLY JSON, no prose:
{
  "role": "character"|"vehicle"|"animal"|"other",
  "orientation": "top_down"|"side"|"isometric"|"front",
  "quality": 1-5 (5 = crisp, detailed, production-ready; 1 = placeholder/broken/ugly),
  "description": "short visual description a game builder AI would use to know what this is and how it looks",
  "keep": true|false,
  "rejectReason": "empty string if keep=true, else why (wrong role, too low quality, etc.)"
}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Filename hint: "${stem}". Expected role: ${roleHint}. Label this asset.` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });
  return JSON.parse(resp.choices[0].message.content);
}

// --- MAIN ---
async function main() {
  const pngs = findPngs(SRC_DIR);
  console.log(`Found ${pngs.length} PNGs in ${SRC_DIR}`);
  const groups = classify(pngs);
  console.log(`Classified into ${groups.length} groups (${groups.filter(g => g.kind === 'sequence').length} sequences, ${groups.filter(g => g.kind === 'single').length} singles)`);

  const manifest = [];
  const sequences = groups.filter(g => g.kind === 'sequence');
  const droppedSingles = groups.length - sequences.length;
  if (droppedSingles) console.log(`Dropping ${droppedSingles} static single-frame sprites — animation-only catalog.`);

  for (const group of sequences) {
    const id = group.stem.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    console.log(`\n→ ${id} (${group.kind}, ${group.files.length} frame${group.files.length > 1 ? 's' : ''})`);
    try {
      const { atlas, sheetPath, previewPath } = await buildAtlas(group, STAGING_DIR, id);
      const label = useVisionApi
        ? await labelAsset(previewPath, group.stem, roleHint)
        : { role: null, orientation: null, quality: null, description: null, keep: null, rejectReason: '', needsLabel: true };
      if (useVisionApi) console.log(`  role=${label.role} orientation=${label.orientation} quality=${label.quality} keep=${label.keep}`);
      else console.log(`  atlas built, awaiting self-label → ${previewPath}`);
      manifest.push({
        id,
        source: sourceTag,
        stem: group.stem,
        kind: group.kind,
        frameCount: group.files.length,
        atlas,
        sheetPath: path.relative(process.cwd(), sheetPath),
        previewPath: path.relative(process.cwd(), previewPath),
        label,
        reviewed: false,
      });
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
    }
  }

  const manifestPath = path.join(STAGING_DIR, '_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Wrote manifest: ${manifestPath} (${manifest.length} assets)`);
  const kept = manifest.filter(m => m.label.keep);
  console.log(`   ${kept.length}/${manifest.length} passed vision keep=true (still needs human review)`);
}

main().catch(err => { console.error(err); process.exit(1); });
