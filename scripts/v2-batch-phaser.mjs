#!/usr/bin/env node
// Full-pass Phaser CDN ingest — downloads every candidate atlas + PNG from R2, parses per the
// TP-Array / TP-Hash format detection in phaser-lib.mjs, splits each into per-animation atlases,
// stages sheets + previews under v2-catalog/staging/phaser-cdn/{pack-or-source}/.
//
// Candidate list is curated from the phaser-cdn-catalog.json inventory: everything whose path
// suggests character/vehicle/animal/creature content. Obvious non-signal (fonts, tilemaps, audio,
// spine — which uses a different runtime — cards, breakout, coin-clicker) filtered out.
// Reject reasons preserved so the audit trail explains "why not this candidate."
import fs from 'fs';
import path from 'path';
import { normalizePhaserAtlas, groupByAnimation, buildPerAnimationStrip, extractAnimAndFrame } from './phaser-lib.mjs';

const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const STAGING_ROOT = path.resolve('v2-catalog/staging/phaser-cdn');
fs.mkdirSync(STAGING_ROOT, { recursive: true });

const cat = JSON.parse(fs.readFileSync('src/ai-engine/phaser-cdn-catalog.json'));
const items = cat.assets;

// --- Filter candidate atlases ---
const ATLAS_INCLUDE_PATHS = new Set([
  'animations/alien.json', 'animations/bird.json', 'animations/california-raisins.json',
  'animations/cybercity/cybercity0.json', 'animations/cybercity/cybercity1.json', 'animations/cybercity/cybercity2.json',
  'animations/cybercity/cybercity-multi.json',
  'animations/elves-craft-pixel.json', 'animations/knight.json', 'animations/robo.json',
  'animations/rocket.json', 'animations/sao0.json', 'animations/sao1.json',
  'animations/seacreatures_json.json', 'animations/sf2.json', 'animations/sf2ryu.json',
  'animations/soldier.json', 'animations/walker.json', 'animations/zombie.json',
  'animations/aseprite/paladin.json', 'animations/aseprite/paladin-array.json',
  'animations/aseprite/tank.json', 'animations/cube.json',
  'tests/player.json', 'tests/space/space.json',
  'games/tom/tomato/tomato_atlas.json', 'games/pacman/map.json',
  'games/germs/germs.json', 'games/snowmen-attack/sprites.json',
  'games/bank-panic/bank-panic.json',
  'physics/supercar.json',
]);
const ATLAS_EXCLUDE_REASONS = new Map([
  ['spine/', 'Spine runtime format — incompatible with Phaser basic atlas loader'],
  ['fonts/', 'bitmap font atlas, not character sprite'],
  ['tilemaps/', 'tilemap tile atlas — environment'],
  ['audio/', 'audio sprite JSON, not sprite atlas'],
  ['games/flood/', 'verified earlier as junk UI swatches / static variant grid'],
  ['games/breakout/', 'brick + paddle assets, not character animation'],
  ['games/coin-clicker/', 'single coin sprite'],
  ['games/emoji-match/', 'emoji icon set'],
  ['games/card-memory-game/', 'card face icons'],
  ['animations/gems.json', 'gem sprites, not character'],
  ['animations/diamond.json', 'diamond effect, not character'],
  ['animations/teapot.json', 'inanimate object'],
  ['animations/lazer/', 'projectile effect'],
  ['atlas/cards.json', 'playing cards'],
  ['atlas/monsters.json', 'ambiguous — deferring, may check in review'],
  ['phaserbyexample/', 'sample game tilemap scenes'],
]);

const allAtlases = items.filter(x => x.type === 'spritesheet_data');
const chosen = [];
const rejectedByFilter = [];
for (const a of allAtlases) {
  const p = a.path;
  if (ATLAS_INCLUDE_PATHS.has(p)) { chosen.push(a); continue; }
  let rejected = false;
  for (const [prefix, reason] of ATLAS_EXCLUDE_REASONS) {
    if (p.startsWith(prefix) || p === prefix) {
      rejectedByFilter.push({ path: p, reason });
      rejected = true;
      break;
    }
  }
  if (!rejected) rejectedByFilter.push({ path: p, reason: 'not in curated include list' });
}

// --- Raw frame group discovery from `sprite` type items ---
// Sibling frames named `foo/frame_00`, `cat1..cat4`, `orange-cat1..2` etc.
function discoverRawFrameGroups() {
  const sprites = items.filter(x => x.type === 'sprite');
  const buckets = new Map();
  for (const s of sprites) {
    const p = s.path;
    const dir = path.posix.dirname(p);
    const name = path.posix.basename(p, path.posix.extname(p));
    // horse/frame_00_delay-0.05s → stem "frame", frame 00 (but Delay isn't a real frame index part)
    let m = name.match(/^frame_(\d+)_delay[-_.\d]+s?$/i);
    if (m) {
      const key = dir + '::frame';
      if (!buckets.has(key)) buckets.set(key, { dir, stem: 'frame', files: [] });
      buckets.get(key).files.push({ path: p, frameNum: parseInt(m[1], 10), url: R2 + p });
      continue;
    }
    // catN / orange-catN / budbrain_chick
    m = name.match(/^(.+?)(\d+)$/);
    if (m && m[1].length >= 2) {
      const key = dir + '::' + m[1].toLowerCase();
      if (!buckets.has(key)) buckets.set(key, { dir, stem: m[1], files: [] });
      buckets.get(key).files.push({ path: p, frameNum: parseInt(m[2], 10), url: R2 + p });
    }
  }
  const groups = [];
  for (const g of buckets.values()) {
    if (g.files.length < 2) continue;
    g.files.sort((a, b) => a.frameNum - b.frameNum);
    groups.push(g);
  }
  return groups;
}
const rawGroups = discoverRawFrameGroups();

console.log(`=== Phaser CDN candidate inventory ===`);
console.log(`  Atlas candidates:      ${chosen.length}  (from ${allAtlases.length} total spritesheet_data)`);
console.log(`  Atlas rejected upfront: ${rejectedByFilter.length}`);
console.log(`  Raw frame-groups:      ${rawGroups.length}`);
rawGroups.forEach(g => console.log(`    ${g.dir}/${g.stem}* → ${g.files.length} frames`));

// --- Downloader ---
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function slugify(s) { return s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase(); }

// --- Ingest one atlas → emit per-animation strips ---
async function ingestAtlas(catalogEntry) {
  const jsonPath = catalogEntry.path;
  const packSlug = slugify(path.dirname(jsonPath).replace(/\//g, '_') || 'root');
  const stemBase = slugify(path.basename(jsonPath, '.json'));
  const outDir = path.join(STAGING_ROOT, packSlug);
  fs.mkdirSync(outDir, { recursive: true });

  const raw = await fetchJson(R2 + jsonPath);
  const norm = normalizePhaserAtlas(raw);
  if (!norm.imageName) return { atlasPath: jsonPath, error: 'unable to detect image path in JSON' };
  // Prefer same-basename-as-JSON: some atlases (aseprite tank.json) embed a Windows local path
  // like "C:\Users\rdave\Desktop\tank.png" that R2 can't resolve. Match the Kenney XML fix pattern.
  const sameBasename = jsonPath.replace(/\.json$/i, '.png');
  const derivedUrl = R2 + path.posix.join(path.dirname(jsonPath), path.posix.basename(norm.imageName));
  let png;
  const candidates = [R2 + sameBasename, derivedUrl];
  let fetchErr = null;
  for (const url of candidates) {
    try { png = await fetchBuffer(url); break; }
    catch (err) { fetchErr = err; }
  }
  if (!png) return { atlasPath: jsonPath, error: `PNG fetch failed for all candidates: ${fetchErr?.message}` };

  const groups = groupByAnimation(norm.frames);
  const emitted = [];
  for (const g of groups) {
    const animSlug = slugify(g.anim);
    const id = `${stemBase}__${animSlug}`;
    const sheetPath = path.join(outDir, `${id}.png`);
    const previewPath = path.join(outDir, `${id}_preview.png`);
    const atlasJsonPath = path.join(outDir, `${id}.json`);
    try {
      const { cellW, cellH, nFrames } = await buildPerAnimationStrip(g, png, sheetPath, previewPath);
      const atlas = {
        sheet: `${id}.png`,
        frameSize: { w: cellW, h: cellH },
        animations: { [g.anim]: { frames: Array.from({length: nFrames}, (_, i) => i), fps: 12, loop: true } },
      };
      fs.writeFileSync(atlasJsonPath, JSON.stringify(atlas, null, 2));
      emitted.push({ id: `phaser-cdn/${packSlug}/${id}`, source: `phaser-cdn/${jsonPath}`, stem: g.anim, animName: g.anim, frameCount: nFrames, canvasW: cellW, canvasH: cellH, sheetPath, previewPath });
    } catch (err) {
      console.error(`   ✗ ${id}: ${err.message}`);
    }
  }
  return { atlasPath: jsonPath, emitted };
}

// --- Ingest one raw-frame group → emit atlas ---
async function ingestRawGroup(g) {
  const packSlug = slugify(g.dir.replace(/\//g, '_') || 'root');
  const stemBase = slugify(g.stem);
  const outDir = path.join(STAGING_ROOT, packSlug);
  fs.mkdirSync(outDir, { recursive: true });

  const frameBuffers = [];
  let cellW = 0, cellH = 0;
  const sharp = (await import('sharp')).default;
  for (const f of g.files) {
    const buf = await fetchBuffer(f.url);
    frameBuffers.push(buf);
    const meta = await sharp(buf).metadata();
    if (meta.width > cellW) cellW = meta.width;
    if (meta.height > cellH) cellH = meta.height;
  }
  const id = stemBase;
  const sheetPath = path.join(outDir, `${id}.png`);
  const previewPath = path.join(outDir, `${id}_preview.png`);
  const atlasJsonPath = path.join(outDir, `${id}.json`);
  const composite = frameBuffers.map((input, i) => ({ input, left: i * cellW, top: 0 }));
  await sharp({ create: { width: cellW * frameBuffers.length, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite).png().toFile(sheetPath);
  await sharp({ create: { width: cellW * frameBuffers.length, height: cellH, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(composite).png().toFile(previewPath);
  const atlas = { sheet: `${id}.png`, frameSize: { w: cellW, h: cellH }, animations: { walk: { frames: Array.from({length: frameBuffers.length}, (_, i) => i), fps: 12, loop: true } } };
  fs.writeFileSync(atlasJsonPath, JSON.stringify(atlas, null, 2));
  return { id: `phaser-cdn/${packSlug}/${id}`, source: `phaser-cdn/raw-frames/${g.dir}`, stem: g.stem, animName: 'walk', frameCount: frameBuffers.length, canvasW: cellW, canvasH: cellH, sheetPath, previewPath };
}

// --- Batch runner ---
async function main() {
  const manifest = [];
  const errors = [];

  console.log('\n=== Ingesting atlases ===');
  for (const c of chosen) {
    process.stdout.write(`  ${c.path} ... `);
    try {
      const res = await ingestAtlas(c);
      if (res.error) { console.log(`✗ ${res.error}`); errors.push({ path: c.path, error: res.error }); continue; }
      console.log(`${res.emitted.length} animations`);
      manifest.push(...res.emitted);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      errors.push({ path: c.path, error: err.message });
    }
  }

  console.log('\n=== Ingesting raw frame groups ===');
  for (const g of rawGroups) {
    process.stdout.write(`  ${g.dir}/${g.stem}* (${g.files.length} frames) ... `);
    try {
      const item = await ingestRawGroup(g);
      manifest.push(item);
      console.log('ok');
    } catch (err) {
      console.log(`✗ ${err.message}`);
      errors.push({ path: `${g.dir}/${g.stem}`, error: err.message });
    }
  }

  fs.writeFileSync(path.join(STAGING_ROOT, '_manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(STAGING_ROOT, '_rejected-upfront.json'), JSON.stringify(rejectedByFilter, null, 2));
  fs.writeFileSync(path.join(STAGING_ROOT, '_errors.json'), JSON.stringify(errors, null, 2));

  console.log(`\n✅ Ingest complete`);
  console.log(`   Atlas sources processed: ${chosen.length}, produced ${manifest.filter(x => x.source.includes('.json')).length} per-animation atlases`);
  console.log(`   Raw frame groups: ${rawGroups.length}, produced ${manifest.filter(x => x.source.includes('raw-frames')).length}`);
  console.log(`   Total v2 candidates: ${manifest.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log(`   Rejected upfront: ${rejectedByFilter.length} (see _rejected-upfront.json for reasons)`);
  console.log(`\n   Manifest: ${path.join(STAGING_ROOT, '_manifest.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
