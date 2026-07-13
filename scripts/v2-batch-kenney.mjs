#!/usr/bin/env node
// Batch-ingest EVERY Kenney 2D pack. XML-atlas-first (authoritative, catches all naming
// conventions), filename-guessing fallback for packs with no Spritesheet/*.xml.
import fs from 'fs';
import path from 'path';
import { findPngs, findSpritesheetXmls, parseXmlAtlas, buildAtlasFromXml, classify, buildAtlas, slugify } from './v2-lib.mjs';

const KENNEY_ROOT = path.resolve('../Kenney Game Assets All-in-1 3/2D assets');
const STAGING_ROOT = path.resolve('v2-catalog/staging/kenney-all');
fs.mkdirSync(STAGING_ROOT, { recursive: true });

const packs = fs.readdirSync(KENNEY_ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log(`Scanning ${packs.length} Kenney packs (XML-first, filename-fallback)...`);

const masterManifest = [];
let totalSequences = 0, xmlPacks = 0, filenamePacks = 0, emptyPacks = 0;

for (const pack of packs) {
  const packDir = path.join(KENNEY_ROOT, pack);
  const packTag = slugify(pack);
  const outDir = path.join(STAGING_ROOT, packTag);

  const xmls = findSpritesheetXmls(packDir);
  let groups = [];
  let mode = null;

  if (xmls.length) {
    mode = 'xml';
    // Skip retina/HD/2x variants — same art at 2x resolution, duplicates the whole catalog.
    const nonRetina = xmls.filter(x => !/retina|_hd|_2x|sheetHD/i.test(x));
    const chosenXmls = nonRetina.length ? nonRetina : xmls;
    for (const xmlPath of chosenXmls) {
      try {
        const seqs = parseXmlAtlas(xmlPath);
        if (seqs) groups.push(...seqs);
      } catch (err) {
        console.error(`  ✗ XML parse failed ${xmlPath}: ${err.message}`);
      }
    }
  }

  // Filename fallback if XML produced nothing (pack has XML for non-animated stuff only, or none)
  if (!groups.length) {
    mode = 'filename';
    let pngs;
    try { pngs = findPngs(packDir); } catch { continue; }
    if (pngs.length) groups = classify(pngs).map(g => ({ ...g, kind: 'sequence' }));
  }

  if (!groups.length) { emptyPacks++; continue; }
  if (mode === 'xml') xmlPacks++; else filenamePacks++;

  // Dedup: sibling XML files in the same pack (e.g. sheet_characters.xml AND
  // sheet_charactersEquipment.xml) frequently re-embed the SAME frames. Same stem+size+frameCount
  // within a pack is almost certainly a duplicate export, not a distinct asset.
  const seen = new Set();
  groups = groups.filter(g => {
    // Use max bbox size across frames for dedup — same reason as buildAtlasFromXml uses max.
    const w = g.dir ? null : (g.frames ? Math.max(...g.frames.map(f => f.w)) : null);
    const h = g.dir ? null : (g.frames ? Math.max(...g.frames.map(f => f.h)) : null);
    const n = g.frames ? g.frames.length : g.files.length;
    const key = `${g.stem}::${w}x${h}::${n}::${g.sourceFolder || g.dir || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  fs.mkdirSync(outDir, { recursive: true });
  for (const group of groups) {
    const w = group.dir ? null : (group.frames ? Math.max(...group.frames.map(f => f.w)) : null);
    const h = group.dir ? null : (group.frames ? Math.max(...group.frames.map(f => f.h)) : null);
    const folderHint = group.sourceFolder ? slugify(group.sourceFolder) + '_' : '';
    const subdirHint = group.dir ? slugify(path.basename(group.dir)) : `${folderHint}${w}x${h}`;
    const id = `${slugify(group.stem)}__${subdirHint}`.slice(0, 120);
    try {
      const built = group.kind === 'xml-sequence'
        ? await buildAtlasFromXml(group, outDir, id)
        : await buildAtlas(group, outDir, id);
      masterManifest.push({
        id: `kenney/${packTag}/${id}`,
        source: `kenney/${pack}`,
        pack,
        mode,
        stem: group.stem,
        frameCount: (group.frames || group.files).length,
        atlas: built.atlas,
        sheetPath: path.relative(process.cwd(), built.sheetPath),
        previewPath: path.relative(process.cwd(), built.previewPath),
        label: { role: null, orientation: null, quality: null, description: null, keep: null, needsLabel: true },
        reviewed: false,
      });
      totalSequences++;
    } catch (err) {
      console.error(`  ✗ ${pack}/${group.stem}: ${err.message}`);
    }
  }
  console.log(`  [${mode}] ${pack}: ${groups.length} sequences`);
}

const manifestPath = path.join(STAGING_ROOT, '_manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(masterManifest, null, 2));
console.log(`\n✅ ${totalSequences} sequences — ${xmlPacks} packs via XML, ${filenamePacks} via filename fallback, ${emptyPacks} packs had nothing`);
console.log(`   Manifest: ${manifestPath}`);
