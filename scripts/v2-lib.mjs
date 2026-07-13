// Shared discover/classify/atlas logic for v2 ingest.
//
// TWO paths into a pack:
//  1. XML PATH (preferred): Kenney ships TexturePacker XML atlases (Spritesheet/*.xml) for many
//     packs — <SubTexture name="characterBlue (1).png" x= y= width= height=/>. This is Kenney's OWN
//     authoritative frame data. We parse it directly instead of guessing from raw filenames, which
//     catches naming conventions filename-regex misses (parenthesized "name (N).png", not just
//     trailing "name_N.png").
//  2. FILENAME PATH (fallback): for packs with no XML, group raw PNG siblings by stem. Handles BOTH
//     "name_1.png"/"name1.png" AND "name (1).png" conventions.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export function findPngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPngs(full));
    else if (/\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}

export function findSpritesheetXmls(packDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.xml$/i.test(entry.name)) out.push(full);
    }
  };
  try { walk(packDir); } catch { /* no dir */ }
  return out;
}

// --- XML PATH: parse TexturePacker generic XML, group by stem+size ---
function parseStem(name) {
  // Strips a trailing frame number in EITHER convention:
  //   "characterBlue (1).png" -> stem "characterBlue", frame 1
  //   "walk_3.png" / "walk3.png" -> stem "walk", frame 3
  const base = name.replace(/\.png$/i, '');
  let m = base.match(/^(.*?)\s*\((\d+)\)$/); // "(N)" convention
  if (m) return { stem: m[1], frameNum: parseInt(m[2], 10) };
  m = base.match(/^(.*?)[_-]?(\d+)$/); // trailing-digit convention
  if (m) return { stem: m[1], frameNum: parseInt(m[2], 10) };
  return { stem: base, frameNum: null };
}

export function parseXmlAtlas(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  // Kenney's imagePath="..." attribute is frequently stale (e.g. "sprites.png" when the real file
  // is "sheet_characters.png"). The reliable pairing is same-basename-as-the-XML — try that first.
  const sameBasename = xmlPath.replace(/\.xml$/i, '.png');
  let sheetPng = fs.existsSync(sameBasename) ? sameBasename : null;
  if (!sheetPng) {
    const imagePathMatch = xml.match(/imagePath="([^"]+)"/);
    if (imagePathMatch) {
      const candidate = path.join(path.dirname(xmlPath), imagePathMatch[1]);
      if (fs.existsSync(candidate)) sheetPng = candidate;
    }
  }
  if (!sheetPng) return null;

  const subTexRe = /<SubTexture\s+name="([^"]+)"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g;
  const entries = [];
  let m;
  while ((m = subTexRe.exec(xml))) {
    const [, name, x, y, w, h] = m;
    entries.push({ name, x: +x, y: +y, w: +w, h: +h });
  }

  // Group by stem. NOT by exact w×h — Kenney tight-crops each frame's bbox, so a walk cycle's
  // drive1/drive2 might differ by a few px (arm/leg position moves the bounding rect). Grouping by
  // exact size splits real animations into 1-frame atlases and drops them entirely. The stem alone
  // + being inside the same XML atlas file is a strong-enough identity signal — Kenney doesn't ship
  // two different assets with the same stem in one XML.
  const groups = new Map();
  for (const e of entries) {
    const { stem, frameNum } = parseStem(e.name);
    if (frameNum === null) continue;
    if (!groups.has(stem)) groups.set(stem, { stem, frames: [] });
    groups.get(stem).frames.push({ ...e, frameNum });
  }

  // Distinguishes sibling XML files that describe DIFFERENT entities (e.g. Toon Characters ships
  // one XML per character folder, all using generic pose names like "walk0") from sibling XML files
  // that re-embed the SAME entity (e.g. Sports Pack's sheet_characters.xml + sheet_charactersEquipment.xml
  // both listing "characterBlue"). Using the grandparent folder name as part of the dedup key means
  // Male person / Robot / Zombie stay distinct while Sports Pack's true re-exports still collapse.
  const sourceFolder = path.basename(path.dirname(path.dirname(xmlPath)));

  const sequences = [];
  for (const [, g] of groups) {
    if (g.frames.length < 2) continue; // animation-only
    g.frames.sort((a, b) => a.frameNum - b.frameNum);
    sequences.push({ kind: 'xml-sequence', stem: g.stem, sheetPng, frames: g.frames, sourceFolder });
  }
  return sequences;
}

export async function buildAtlasFromXml(group, outDir, id) {
  // Canvas cell = the max bbox across all frames — smaller frames get bottom-centered inside
  // (feet-anchored), matching how tight-cropped side-view sprites should be composited.
  const w = Math.max(...group.frames.map(f => f.w));
  const h = Math.max(...group.frames.map(f => f.h));
  const sheetPath = path.join(outDir, `${id}.png`);
  const previewPath = path.join(outDir, `${id}_preview.png`);

  const composite = [];
  for (let i = 0; i < group.frames.length; i++) {
    const f = group.frames[i];
    const input = await sharp(group.sheetPng).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).toBuffer();
    // Center horizontally in the cell, bottom-align vertically (feet stay on the ground line)
    const offsetX = Math.floor((w - f.w) / 2);
    const offsetY = h - f.h;
    composite.push({ input, left: i * w + offsetX, top: offsetY });
  }
  await sharp({ create: { width: w * group.frames.length, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite).png().toFile(sheetPath);
  await sharp({ create: { width: w * group.frames.length, height: h, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(composite).png().toFile(previewPath);

  const atlas = {
    sheet: `${id}.png`,
    frameSize: { w, h },
    animations: { walk: { frames: group.frames.map((_, i) => i), fps: 8, loop: true } },
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(atlas, null, 2));
  return { atlas, sheetPath, previewPath };
}

// --- FILENAME PATH (fallback for packs with no XML) ---
export function classify(pngPaths) {
  const groups = new Map();
  for (const p of pngPaths) {
    const dir = path.dirname(p);
    const name = path.basename(p, '.png');
    const { stem, frameNum } = parseStem(name + '.png');
    const key = `${dir}::${stem.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { stem, dir, files: [] });
    groups.get(key).files.push({ path: p, frameNum, name });
  }
  const results = [];
  for (const [, g] of groups) {
    const framed = g.files.filter(f => f.frameNum !== null);
    if (g.files.length >= 2 && framed.length === g.files.length) {
      framed.sort((a, b) => a.frameNum - b.frameNum);
      results.push({ kind: 'sequence', stem: g.stem, dir: g.dir, files: framed.map(f => f.path) });
    }
  }
  return results;
}

export async function buildAtlas(group, outDir, id) {
  const frames = await Promise.all(group.files.map(f => sharp(f).metadata()));
  const w = Math.max(...frames.map(f => f.width));
  const h = Math.max(...frames.map(f => f.height));
  const cols = group.files.length;

  const sheetPath = path.join(outDir, `${id}.png`);
  const previewPath = path.join(outDir, `${id}_preview.png`);

  const composite = group.files.map((f, i) => ({ input: f, left: i * w, top: 0 }));
  await sharp({ create: { width: w * cols, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite).png().toFile(sheetPath);
  await sharp({ create: { width: w * cols, height: h, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(composite).png().toFile(previewPath);

  const atlas = {
    sheet: `${id}.png`,
    frameSize: { w, h },
    animations: { walk: { frames: group.files.map((_, i) => i), fps: 8, loop: true } },
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(atlas, null, 2));
  return { atlas, sheetPath, previewPath };
}

export function slugify(s) {
  return s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}
