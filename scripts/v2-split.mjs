#!/usr/bin/env node
// v2 color/model variant SPLITTER — recovers animations from grids in the 11 deferred packs.
//
// TWO OPERATIONS:
//   1. RESCUE — stems mistakenly deferred at pack level but ARE real animations at stem level.
//      Just add them to curated as-is (no image ops needed).
//   2. SPLIT  — stems that are truly a grid of N sub-animations packed as one strip. Crop the
//      packed strip into N new sub-atlases, one per sub-animation. Deterministic ids via
//      `<original>__split_<label>` — no collision with existing curated ids because splits emit
//      only new suffixed ids.
//
// Non-splittable stems (static color/model variants — Racing Pack cars, Pirate Pack ship, etc.)
// are recorded to the split log with a specific "not-an-animation" reason.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const STAGING = 'v2-catalog/staging/kenney-all';
const rawManifest = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest.json')));
const curated = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest-curated.json')));
const reviewLog = JSON.parse(fs.readFileSync(path.join(STAGING, '_review-log.json')));

// --- CONFIG ---
// One entry per deferred (pack, stem) — either a RESCUE, a SPLIT, or a REJECT with reason.
// Uses raw stem (not slugified id), matches on `item.pack === pack && item.stem === stem`.
const RULES = {
  // === RESCUES: real animations wrongly caught by a broad pack-level defer ===
  'Space Shooter Remastered': {
    rescue: {
      // Verified visually as 3-frame ship damage animations (light → damaged → wrecked)
      stems: ['playerShip1_damage', 'playerShip2_damage', 'playerShip3_damage'],
      label: 'ship damage state animation',
      role: 'vehicle',
      orientation: 'top_down',
      quality: 4,
    },
    // Everything else in the pack: color-variant enemies (static), modular parts, effects, HUD.
    // Not animations. Recorded as final-reject.
    rejectRest: 'static color-variant enemy models, modular wings/cockpits, projectiles, HUD — not walk cycles',
  },

  // === SPLITS ===
  'Sokoban Pack': {
    // Attempted a 4-direction × 6-frame split of player (24 frames) but visual inspection of the
    // resulting splits showed each 6-frame chunk contained a mix of front/back/side views — the
    // grid is not a clean 4-direction × 6-frame walk cycle as I first assumed. Rather than
    // ship mislabeled directional walks, deferring for proper manual review. The 24 frames ARE real
    // animation content, just need someone to look at each frame individually to determine layout.
    rejectRest: 'player 24-frame grid contains real animation content but not a clean 4-direction × 6-frame walk cycle — needs per-frame inspection to determine actual layout',
  },

  // === REJECTS: verified static model palettes, splitting would produce single-frame sprites ===
  'Racing Pack': {
    rejectRest: 'cars are 5 static car MODELS per color (sedan/hatch/wagon/etc.), no motion frames — splitting yields single-image sprites',
  },
  'Tank Pack': {
    rejectRest: 'tanks_tankX are 5 static tank models/angles per color; bullets, tracks, explosions, turret are props/effects — no walk cycles',
  },
  'Topdown Tanks Remastered': {
    rejectRest: 'tankX_barrel are 3 static turret barrel parts; bullets/tiles/explosions are props/effects',
  },
  'Pirate Pack': {
    rejectRest: '"ship" is 24 static ship designs (color × flag variants); crew/dinghies/hulls/sails are props or static variants',
  },
  'Pixel Shmup': {
    rejectRest: 'ship is 24 static ship-design color variants + tile atlas — no animation',
  },
  'Monochrome RPG Tileset': {
    rejectRest: 'character/enemy are 4-frame color-variant palettes of one static sprite (mint/gold/red/blue), not walk animations',
  },
  'Pixel Vehicle Pack': {
    rejectRest: 'man_walk / woman_walk are real 2-frame walk cycles but at 11×15 native — too tiny to display recognizably even after upscaling',
  },
  'RTS Sci-fi': {
    rejectRest: 'scifiUnit grids are per-team-color palettes of mixed unit types (infantry + tank models), not walk cycles — each color-block is 12 static unit designs',
  },
  'RTS Medieval': {
    rejectRest: 'medievalUnit grids are per-color palettes of 6 static villager/soldier designs, not walk cycles',
  },
  'RTS Medieval (Pixel)': {
    rejectRest: 'pixel-art variant of RTS Medieval — same static color-palette structure',
  },
};

// --- SPLIT ENGINE ---
// The original XML-built atlas is a horizontal strip of N cells, each `frameSize.w × frameSize.h`.
// To split, we crop columns [range[0]..range[1]) into a new strip and emit as a new atlas.
async function performSplit(item, split) {
  const originalSheet = path.resolve(item.sheetPath);
  const { w: cellW, h: cellH } = item.atlas.frameSize;

  const results = [];
  for (const sub of split.subGroups) {
    const [from, to] = sub.frameRange;
    const nFrames = to - from;
    if (nFrames < 2) throw new Error(`split ${sub.name}: only ${nFrames} frame(s), need ≥ 2 for animation`);

    const cropLeft = from * cellW;
    const cropWidth = nFrames * cellW;

    const newId = `${item.id}__split_${sub.name}`;
    const packDir = path.dirname(item.sheetPath);
    const outName = `${path.basename(item.id.split('/').pop())}__split_${sub.name}`;
    const sheetPath = path.join(packDir, `${outName}.png`);
    const previewPath = path.join(packDir, `${outName}_preview.png`);
    const atlasPath = path.join(packDir, `${outName}.json`);

    // Crop transparent sheet
    await sharp(originalSheet).extract({ left: cropLeft, top: 0, width: cropWidth, height: cellH })
      .png().toFile(sheetPath);
    // Rebuild preview on dark bg (same convention as extraction pipeline)
    const buf = await sharp(sheetPath).toBuffer();
    await sharp({ create: { width: cropWidth, height: cellH, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
      .composite([{ input: buf, left: 0, top: 0 }])
      .png().toFile(previewPath);

    const atlas = {
      sheet: `${outName}.png`,
      frameSize: { w: cellW, h: cellH },
      animations: { walk: { frames: Array.from({ length: nFrames }, (_, i) => i), fps: 8, loop: true } },
    };
    fs.writeFileSync(atlasPath, JSON.stringify(atlas, null, 2));

    results.push({
      id: newId,
      source: item.source,
      pack: item.pack,
      stem: `${item.stem}_${sub.name}`,
      frameCount: nFrames,
      atlas,
      sheetPath: path.relative(process.cwd(), sheetPath),
      previewPath: path.relative(process.cwd(), previewPath),
      splitFrom: item.id,
      splitRange: sub.frameRange,
      label: {
        role: split.role,
        orientation: split.orientation,
        quality: split.quality,
        description: `${split.characterDesc}, ${sub.description}`,
        keep: true,
        rejectReason: '',
        needsLabel: false,
        labeledBy: 'claude-vision-inline (post-split)',
      },
      reviewed: true,
    });
  }
  return results;
}

// --- APPLY ---
const existingIds = new Set(curated.map(c => c.id));
const rescued = [];
const splitOut = [];
const finalRejected = [];
const stillDeferred = [];

// Iterate through the deferred bucket (all items originally marked "DEFERRED" at pack or stem level)
const deferredItemsById = new Set(reviewLog.deferred.map(d => d.id));
const deferredRawItems = rawManifest.filter(item => deferredItemsById.has(item.id));

// A pack may have items we WANT to keep in "still deferred" (Sokoban player, above) rather than
// hard-reject — its rejectRest text explicitly says so ("needs per-frame inspection").
const NEEDS_MANUAL_MARKER = /needs per-frame inspection|needs manual/i;

for (const item of deferredRawItems) {
  const rule = RULES[item.pack];
  if (!rule) {
    stillDeferred.push({ id: item.id, pack: item.pack, stem: item.stem, reason: 'no rule configured for this pack — needs manual review' });
    continue;
  }

  // 1. RESCUE
  if (rule.rescue && rule.rescue.stems.includes(item.stem)) {
    if (existingIds.has(item.id)) continue; // safety
    rescued.push({
      ...item,
      label: {
        role: rule.rescue.role,
        orientation: rule.rescue.orientation,
        quality: rule.rescue.quality,
        description: `${item.stem} — ${rule.rescue.label}`,
        keep: true,
        rejectReason: '',
        needsLabel: false,
        labeledBy: 'claude-vision-inline (rescue)',
      },
      reviewed: true,
      rescuedFrom: 'pack-level DEFERRED but item is a real animation at stem level',
    });
    continue;
  }

  // 2. SPLIT
  if (rule.splits) {
    const match = rule.splits.find(s => s.stem === item.stem);
    if (match) {
      // Prefer specific size if configured (skips retina @2 duplicates)
      if (match.preferSize) {
        const { w, h } = item.atlas.frameSize;
        if (w !== match.preferSize.w || h !== match.preferSize.h) {
          finalRejected.push({ id: item.id, pack: item.pack, stem: item.stem,
            reason: `size ${w}x${h} not preferred (want ${match.preferSize.w}x${match.preferSize.h}) — duplicate of the preferred variant we split`,
          });
          continue;
        }
      }
      try {
        const newItems = await performSplit(item, match);
        splitOut.push(...newItems);
      } catch (err) {
        finalRejected.push({ id: item.id, pack: item.pack, stem: item.stem, reason: `split failed: ${err.message}` });
      }
      continue;
    }
  }

  // 3. REJECT / STILL-DEFER (pack-level rejectRest text controls which bucket)
  const reason = rule.rejectRest || 'no rule';
  if (NEEDS_MANUAL_MARKER.test(reason) && item.stem === 'player') {
    stillDeferred.push({ id: item.id, pack: item.pack, stem: item.stem, reason });
  } else {
    finalRejected.push({ id: item.id, pack: item.pack, stem: item.stem, reason });
  }
}

// --- MERGE INTO CURATED ---
const newItems = [...rescued, ...splitOut];
const finalCurated = [...curated, ...newItems];

// --- WRITE OUTPUTS ---
fs.writeFileSync(path.join(STAGING, '_manifest-curated.json'), JSON.stringify(finalCurated, null, 2));

const splitLog = {
  summary: {
    deferredInput: deferredRawItems.length,
    rescued: rescued.length,
    splitOutputItems: splitOut.length,
    finalRejected: finalRejected.length,
    stillDeferred: stillDeferred.length,
    curatedBefore: curated.length,
    curatedAfter: finalCurated.length,
    delta: newItems.length,
  },
  rescued: rescued.map(r => ({ id: r.id, pack: r.pack, stem: r.stem, frameCount: r.frameCount })),
  split: splitOut.map(s => ({ id: s.id, pack: s.pack, stem: s.stem, splitFrom: s.splitFrom, frameCount: s.frameCount, range: s.splitRange })),
  finalRejected,
  stillDeferred,
};
fs.writeFileSync(path.join(STAGING, '_split-log.json'), JSON.stringify(splitLog, null, 2));

// --- REPORT ---
console.log('\n=== SPLITTER PASS COMPLETE ===');
console.log(`Deferred items processed:  ${deferredRawItems.length}`);
console.log(`✅ Rescued:                 ${rescued.length}  (already-animation items wrongly deferred at pack level)`);
console.log(`✂️  Split into new atlases: ${splitOut.length}  (from ${new Set(splitOut.map(s=>s.splitFrom)).size} original grids)`);
console.log(`❌ Final rejected:          ${finalRejected.length}  (static color/model variants, not animations)`);
console.log(`⏸  Still deferred:          ${stillDeferred.length}  (need manual attention)`);
console.log();
console.log(`Curated manifest:  ${curated.length} → ${finalCurated.length}  (Δ +${newItems.length})`);
console.log();
console.log('=== PACKS AFFECTED ===');
const affectedPacks = new Set([
  ...rescued.map(r => r.pack),
  ...splitOut.map(s => s.pack),
  ...finalRejected.map(r => r.pack),
  ...stillDeferred.map(s => s.pack),
]);
for (const pack of Array.from(affectedPacks).sort()) {
  const r = rescued.filter(x => x.pack === pack).length;
  const s = splitOut.filter(x => x.pack === pack).length;
  const j = finalRejected.filter(x => x.pack === pack).length;
  const d = stillDeferred.filter(x => x.pack === pack).length;
  const bits = [];
  if (r) bits.push(`✅${r} rescued`);
  if (s) bits.push(`✂️${s} split-recovered`);
  if (j) bits.push(`❌${j} final-rejected`);
  if (d) bits.push(`⏸${d} still-deferred`);
  console.log(`  ${pack}: ${bits.join(', ')}`);
}
if (stillDeferred.length) {
  console.log('\n=== STILL DEFERRED (manual review) ===');
  const byPack = {};
  for (const d of stillDeferred) (byPack[d.pack] ||= []).push(d.stem);
  for (const [p, stems] of Object.entries(byPack)) console.log(`  ${p}: ${stems.join(', ')}`);
}
console.log(`\nSplit log: ${path.join(STAGING, '_split-log.json')}`);
console.log(`Updated curated: ${path.join(STAGING, '_manifest-curated.json')}`);
