// Phaser atlas parser + per-animation splitter.
//
// Phaser's TexturePacker exports come in two flavors — Array v3 (frames as [] under textures[0])
// and Hash (frames as { filename: {...} }). Both are trimmed by default, so frame reassembly must
// use spriteSourceSize (offset inside the untrimmed canvas) not just the sheet rect.
//
// Filenames encode animation identity in several conventions across the sample assets. In priority
// order we try:
//   1. Aseprite:   "tank 0.ase"          → anim="tank", frame=0
//   2. Dir-prefix: "attack_A/frame0007"  → anim="attack_A", frame=7
//   3. Prefix_NNN: "Death_005" | "walk_002" | "Running_014" | "03_Walk_011" → anim=rest, frame=NNN
//   4. Pure num:   "0", "1", "frame1"    → anim="__all__" (single unnamed animation)
//   5. Fallback:   use the whole filename as a 1-frame anim (drops to single-frame filter)
import sharp from 'sharp';

export function extractAnimAndFrame(filename) {
  // Aseprite export: "tank 0.ase" / "tank 0.ase" (with .ase extension in the name)
  let m = filename.match(/^(.+?)\s+(\d+)\.ase$/i);
  if (m) return { anim: m[1].trim(), frameIdx: parseInt(m[2], 10) };

  // Dir prefix: "attack_A/frame0007" or "walk/0001"
  m = filename.match(/^(.+)\/(?:frame)?(\d+)$/);
  if (m) return { anim: m[1], frameIdx: parseInt(m[2], 10) };

  // "frame1" / "frame001" no underscore — treat all as one anim
  m = filename.match(/^frame(\d+)$/i);
  if (m) return { anim: '__all__', frameIdx: parseInt(m[1], 10) };

  // Pure numeric — one flat anim
  m = filename.match(/^(\d+)$/);
  if (m) return { anim: '__all__', frameIdx: parseInt(m[1], 10) };

  // Prefix ending in _NNN or _NN — needs at least 2 digits to avoid stripping legit trailing letters
  m = filename.match(/^(.+?)_(\d{2,})$/);
  if (m) return { anim: m[1], frameIdx: parseInt(m[2], 10) };

  // Prefix ending in a single digit (e.g. "walk_3")
  m = filename.match(/^(.+?)_(\d)$/);
  if (m) return { anim: m[1], frameIdx: parseInt(m[2], 10) };

  // Fallback: no numeric suffix — use whole filename as anim, no frame index (won't group)
  return { anim: filename, frameIdx: null };
}

// Normalize both TP-Array and TP-Hash JSONs into a common list of frame descriptors.
export function normalizePhaserAtlas(raw) {
  const frames = [];
  if (raw.textures && Array.isArray(raw.textures)) {
    const t = raw.textures[0];
    if (!t) return { imageName: null, frames: [] };
    const list = t.frames || [];
    for (const f of list) {
      frames.push({
        filename: f.filename,
        rect: f.frame,
        sourceSize: f.sourceSize || f.frame,
        spriteSourceSize: f.spriteSourceSize || { x: 0, y: 0, w: f.frame.w, h: f.frame.h },
        trimmed: !!f.trimmed,
        rotated: !!f.rotated,
      });
    }
    return { imageName: t.image, frames };
  }
  if (raw.frames && !Array.isArray(raw.frames)) {
    for (const [filename, f] of Object.entries(raw.frames)) {
      frames.push({
        filename,
        rect: f.frame,
        sourceSize: f.sourceSize || f.frame,
        spriteSourceSize: f.spriteSourceSize || { x: 0, y: 0, w: f.frame.w, h: f.frame.h },
        trimmed: !!f.trimmed,
        rotated: !!f.rotated,
      });
    }
    return { imageName: raw.meta?.image, frames };
  }
  // Array of frames without textures wrapper (unusual)
  if (Array.isArray(raw.frames)) {
    for (const f of raw.frames) {
      frames.push({
        filename: f.filename,
        rect: f.frame,
        sourceSize: f.sourceSize || f.frame,
        spriteSourceSize: f.spriteSourceSize || { x: 0, y: 0, w: f.frame.w, h: f.frame.h },
        trimmed: !!f.trimmed,
        rotated: !!f.rotated,
      });
    }
    return { imageName: raw.meta?.image, frames };
  }
  return { imageName: null, frames: [] };
}

// Group normalized frames by animation name. Frames within a group get sorted by frameIdx (or
// insertion order as a stable fallback for un-indexed frames). Groups with <2 frames dropped —
// animation-only rule stays honored.
export function groupByAnimation(frames) {
  const groups = new Map();
  for (const [i, f] of frames.entries()) {
    const { anim, frameIdx } = extractAnimAndFrame(f.filename);
    if (!groups.has(anim)) groups.set(anim, []);
    groups.get(anim).push({ ...f, frameIdx: frameIdx ?? i, _seq: i });
  }
  const results = [];
  for (const [anim, gframes] of groups) {
    if (gframes.length < 2) continue;
    gframes.sort((a, b) => (a.frameIdx - b.frameIdx) || (a._seq - b._seq));
    results.push({ anim, frames: gframes });
  }
  return results;
}

// Build a clean per-animation horizontal strip PNG. Cell size = max(sourceSize) across the group's
// frames so trimmed frames don't misalign with untrimmed ones. Each frame is composited into its
// cell at (cellX + spriteSourceSize.x, spriteSourceSize.y) so trimmed content anchors correctly.
export async function buildPerAnimationStrip(group, sourcePngBuffer, outSheetPath, outPreviewPath) {
  const cellW = Math.max(...group.frames.map(f => f.sourceSize.w));
  const cellH = Math.max(...group.frames.map(f => f.sourceSize.h));
  const nFrames = group.frames.length;

  const composite = [];
  for (let i = 0; i < nFrames; i++) {
    const f = group.frames[i];
    // Extract the trimmed content from the source sheet
    const cropped = await sharp(sourcePngBuffer)
      .extract({ left: f.rect.x, top: f.rect.y, width: f.rect.w, height: f.rect.h })
      .toBuffer();
    // Place it inside the cell at the spriteSourceSize offset (respects trim)
    composite.push({
      input: cropped,
      left: i * cellW + f.spriteSourceSize.x,
      top: f.spriteSourceSize.y,
    });
  }

  // Transparent sheet — this is the atlas the game will load
  await sharp({ create: { width: cellW * nFrames, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite).png().toFile(outSheetPath);

  // Dark-bg preview — for human review, same visual convention as Kenney previews
  await sharp({ create: { width: cellW * nFrames, height: cellH, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(composite).png().toFile(outPreviewPath);

  return { cellW, cellH, nFrames };
}
