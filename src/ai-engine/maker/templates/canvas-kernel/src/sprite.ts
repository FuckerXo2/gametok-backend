// sprite.ts — draw the REAL provided sprites by LOGICAL role. Read-only kernel helper.
//
// Server-side, the Asset Resolver wrote window.DREAM_SPRITE_ROLES (logical role -> concrete keys) and
// assetLoader.ts populated window.DREAM_IMAGES (key -> loaded HTMLImageElement). These helpers are the
// EASY path: call sprite(ctx,'player',x,y) instead of hand-drawing a rectangle. If a sprite isn't
// available (not provided / not yet loaded) they no-op and return false, so the builder can draw a
// fallback — they never throw and never draw a broken image.

type ActorRole = { base: string; animations?: Record<string, string[]> };
type RoleMap = {
  player?: ActorRole; enemy?: ActorRole;
  projectile?: { base: string }; vehicle?: { base: string };
  tiles?: string[]; items?: string[]; background?: string[];
  ui?: Record<string, string>;
};

type DrawOpts = { size?: number; scale?: number; flipX?: boolean; anchor?: 'center' | 'top' | 'bottom' };

function roles(): RoleMap {
  return ((window as unknown as { DREAM_SPRITE_ROLES?: RoleMap }).DREAM_SPRITE_ROLES) || {};
}

function imageFor(key?: string): HTMLImageElement | null {
  if (!key) return null;
  const images = (window as unknown as { DREAM_IMAGES?: Record<string, HTMLImageElement> }).DREAM_IMAGES || {};
  const im = images[key];
  return (im instanceof HTMLImageElement && im.complete && im.naturalWidth > 0) ? im : null;
}

// Set server-side from the chosen pack's style: pixel packs must render nearest-neighbour (smoothing
// blurs them); flat-cartoon/vector packs must keep smoothing ON (nearest makes them jagged). Kernel
// picks the right mode automatically so the builder never has to think about it.
function pixelArt(): boolean {
  return Boolean((window as unknown as { DREAM_PIXEL_ART?: boolean }).DREAM_PIXEL_ART);
}

/** Is a real sprite available for this logical role? (e.g. decide sprite vs code-drawn fallback). */
export function hasSprite(role: string): boolean {
  return Boolean((roles() as Record<string, unknown>)[role]);
}

function drawImageCentered(ctx: CanvasRenderingContext2D, im: HTMLImageElement | null, x: number, y: number, o: DrawOpts): boolean {
  if (!im) return false;
  let w = im.naturalWidth;
  let h = im.naturalHeight;
  if (o.size) { const s = o.size / Math.max(w, h); w *= s; h *= s; }
  if (o.scale) { w *= o.scale; h *= o.scale; }
  const offY = o.anchor === 'top' ? 0 : o.anchor === 'bottom' ? h : h / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = !pixelArt();
  ctx.translate(x, y);
  if (o.flipX) ctx.scale(-1, 1);
  ctx.drawImage(im, -w / 2, -offY, w, h);
  ctx.restore();
  return true;
}

/** Draw the resting/base pose of a role: sprite(ctx, 'player', x, y). Returns false if unavailable. */
export function sprite(ctx: CanvasRenderingContext2D, role: string, x: number, y: number, o: DrawOpts = {}): boolean {
  const v = (roles() as Record<string, ActorRole | string[]>)[role];
  const key = Array.isArray(v) ? v[0] : v?.base;
  return drawImageCentered(ctx, imageFor(key), x, y, o);
}

/**
 * Draw the current frame of an animation: animatedSprite(ctx, 'player', 'walk', t, x, y). `t` is
 * elapsed seconds. Falls back to the base pose if the role has no such animation.
 */
export function animatedSprite(
  ctx: CanvasRenderingContext2D, role: string, anim: string, t: number,
  x: number, y: number, o: DrawOpts & { fps?: number } = {},
): boolean {
  const v = (roles() as Record<string, ActorRole>)[role];
  const frames = v?.animations?.[anim];
  if (!frames || !frames.length) return sprite(ctx, role, x, y, o);
  const fps = o.fps ?? 10;
  const key = frames[Math.floor(Math.max(0, t) * fps) % frames.length];
  return drawImageCentered(ctx, imageFor(key), x, y, o);
}

/** Draw the i-th sprite from a LIST role (tiles/items/background): tile(ctx, 'tiles', i, x, y). */
export function tile(ctx: CanvasRenderingContext2D, role: string, i: number, x: number, y: number, o: DrawOpts = {}): boolean {
  const list = (roles() as Record<string, string[]>)[role];
  if (!list || !list.length) return false;
  const key = list[((i % list.length) + list.length) % list.length];
  return drawImageCentered(ctx, imageFor(key), x, y, o);
}

/** How many sprites a list role has (for looping tiles/items): count('tiles'). */
export function count(role: string): number {
  const list = (roles() as Record<string, string[]>)[role];
  return Array.isArray(list) ? list.length : 0;
}

/**
 * Fill a rectangle by TILING the ground — the ONE-LINE way to give a TOP-DOWN game a real floor instead
 * of a flat color void. Call this FIRST every frame, before entities: tileGround(ctx, canvas.width,
 * canvas.height). Uses ONLY the seamless `tiles` role (NEVER the `background` role — those are
 * decorative parallax pieces like clouds/hills that look broken when tiled edge-to-edge; use
 * drawParallax() for those). Forces seamless nearest-neighbour; returns false if no ground tiles exist
 * (then draw your own solid/gradient fallback). Pass originX/originY (e.g. a scrolling camera offset) to
 * scroll the floor. `vary:true` cycles all ground tiles for a patterned floor; default tiles one base
 * tile for a clean, seam-free surface.
 */
export function tileGround(
  ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
  o: { size?: number; originX?: number; originY?: number; tileIndex?: number; vary?: boolean } = {},
): boolean {
  const r = roles() as Record<string, string[]>;
  const list = r.tiles || []; // ground/floor tiles ONLY — background pieces are NOT seamless, never tile them
  if (!list.length) return false;
  const baseIdx = ((o.tileIndex ?? 0) % list.length + list.length) % list.length;
  const first = imageFor(list[baseIdx]);
  if (!first) return false;
  const cell = o.size || Math.max(first.naturalWidth, first.naturalHeight) || 64;
  const ox = ((o.originX || 0) % cell + cell) % cell;
  const oy = ((o.originY || 0) % cell + cell) % cell;
  ctx.save();
  ctx.imageSmoothingEnabled = false; // tiles must be seamless — nearest avoids edge bleed
  let col = 0;
  for (let x = -ox; x < viewW; x += cell, col++) {
    let row = 0;
    for (let y = -oy; y < viewH; y += cell, row++) {
      const idx = o.vary ? (baseIdx + col + row) % list.length : baseIdx;
      const im = imageFor(list[idx]);
      if (im) ctx.drawImage(im, x, y, cell, cell);
    }
  }
  ctx.restore();
  return true;
}

/**
 * Draw environment props from the `items` role at fixed world positions — quick arena dressing (crates,
 * barrels, debris) so the play space reads as a real place, not empty ground. Scatter the positions
 * ONCE at init and keep them fixed; call this each frame after tileGround, before entities. Each prop's
 * `i` picks which item sprite (defaults to spreading across the pack); `size` sets its on-screen size.
 * Returns how many were drawn (0 if no item sprites are available).
 */
export function scatterProps(
  ctx: CanvasRenderingContext2D,
  props: Array<{ x: number; y: number; i?: number; size?: number }>,
): number {
  const list = (roles() as Record<string, string[]>).items || [];
  if (!list.length || !props.length) return 0;
  let n = 0;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    const idx = ((p.i ?? k) % list.length + list.length) % list.length;
    if (drawImageCentered(ctx, imageFor(list[idx]), p.x, p.y, { size: p.size, anchor: 'bottom' })) n++;
  }
  return n;
}

/**
 * Draw the `background` role as a FAR PARALLAX layer — the correct use of decorative scene pieces
 * (clouds, hills, mountains, bushes). This is for SIDE-SCROLLERS: a sky (draw your own gradient first),
 * then a sparse row of big background pieces. NEVER tile these edge-to-edge (they are not seamless —
 * that looks broken); tileGround() is for the floor, this is for the horizon. Give explicit positions,
 * or pass a count to auto-space them across the width. Returns how many were drawn.
 */
export function drawParallax(
  ctx: CanvasRenderingContext2D,
  opts: { viewW: number; baselineY: number; count?: number; size?: number; originX?: number; scroll?: number }
    | Array<{ x: number; y: number; i?: number; size?: number }>,
): number {
  const list = (roles() as Record<string, string[]>).background || [];
  if (!list.length) return 0;
  let pieces: Array<{ x: number; y: number; i?: number; size?: number }>;
  if (Array.isArray(opts)) {
    pieces = opts;
  } else {
    const n = Math.max(1, opts.count ?? 4);
    const scroll = (opts.scroll ?? 0) * (opts.originX ?? 0);
    const step = opts.viewW / n;
    pieces = [];
    for (let k = 0; k < n; k++) {
      pieces.push({ x: ((k + 0.5) * step - scroll) % (opts.viewW + step), y: opts.baselineY, i: k, size: opts.size });
    }
  }
  let drawn = 0;
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    const idx = ((p.i ?? k) % list.length + list.length) % list.length;
    if (drawImageCentered(ctx, imageFor(list[idx]), p.x, p.y, { size: p.size, anchor: 'bottom' })) drawn++;
  }
  return drawn;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATLAS + ANIMATION — draw one sprite sheet (image + frame rectangles) and play
// its named animations. This is what lets the kernel use packed sprite sheets
// (Phaser/TexturePacker-style) where a whole character lives in ONE image with
// its walk/attack/die frames declared as data — instead of one file per frame.
//
// The resolver inlines the atlas image into DREAM_IMAGES and writes a NORMALIZED
// descriptor into window.DREAM_ATLASES, keyed by role (e.g. 'player','enemy'):
//   { image, frames: { name -> {frame,sourceSize?,spriteSourceSize?,trimmed?,rotated?} },
//     animations: { anim -> [frameName, ...] } }
// The builder never parses raw atlas JSON — it just calls playAnim/drawAtlas.
// ─────────────────────────────────────────────────────────────────────────────

type AtlasFrame = {
  frame: { x: number; y: number; w: number; h: number };
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
};
type Atlas = { image: string; frames: Record<string, AtlasFrame>; animations: Record<string, string[]> };

function atlasesMap(): Record<string, Atlas> {
  return ((window as unknown as { DREAM_ATLASES?: Record<string, Atlas> }).DREAM_ATLASES) || {};
}

/** Is a packed sprite-sheet available for this role/name? (e.g. hasAtlas('player')). */
export function hasAtlas(name: string): boolean {
  return Boolean(atlasesMap()[name]);
}

/** Animation names available on an atlas (e.g. ['idle','run','attack_A','die']). */
export function animList(name: string): string[] {
  const a = atlasesMap()[name];
  return a ? Object.keys(a.animations || {}) : [];
}

function drawFrame(
  ctx: CanvasRenderingContext2D, atlas: Atlas, frameName: string, x: number, y: number, o: DrawOpts,
): boolean {
  const im = imageFor(atlas.image);
  const fr = atlas.frames?.[frameName];
  if (!im || !fr) return false;
  const src = fr.frame;
  // Anchor + size off the UNTRIMMED source box so every frame of an animation shares
  // the same footprint (trimmed frames jitter otherwise).
  const sw = fr.sourceSize?.w ?? src.w;
  const sh = fr.sourceSize?.h ?? src.h;
  let scale = 1;
  if (o.size) scale = o.size / Math.max(sw, sh);
  if (o.scale) scale *= o.scale;
  const anchorX = (sw * scale) / 2;
  const anchorY = o.anchor === 'top' ? 0 : o.anchor === 'bottom' ? sh * scale : (sh * scale) / 2;
  const sss = fr.trimmed && fr.spriteSourceSize ? fr.spriteSourceSize : { x: 0, y: 0 };
  ctx.save();
  ctx.imageSmoothingEnabled = !pixelArt();
  ctx.translate(x, y);
  if (o.flipX) ctx.scale(-1, 1);
  // Top-left of the untrimmed box, relative to the anchor; add the trim offset. On flipX the
  // horizontal trim is measured from the opposite edge so mirrored frames stay aligned.
  const offX = (o.flipX ? (sw - sss.x - src.w) : sss.x) * scale;
  const left = -anchorX + offX;
  const top = -anchorY + sss.y * scale;
  if (fr.rotated) {
    // Packer rotated the frame 90° CW to save space: draw with a matching rotation. Source w/h swap.
    ctx.translate(left + (src.h * scale) / 2, top + (src.w * scale) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(im, src.x, src.y, src.w, src.h, -(src.w * scale) / 2, -(src.h * scale) / 2, src.w * scale, src.h * scale);
  } else {
    ctx.drawImage(im, src.x, src.y, src.w, src.h, left, top, src.w * scale, src.h * scale);
  }
  ctx.restore();
  return true;
}

/** Draw ONE named frame of an atlas: drawAtlas(ctx, 'player', 'idle/frame0001', x, y). */
export function drawAtlas(
  ctx: CanvasRenderingContext2D, name: string, frameName: string, x: number, y: number, o: DrawOpts = {},
): boolean {
  const atlas = atlasesMap()[name];
  return atlas ? drawFrame(ctx, atlas, frameName, x, y, o) : false;
}

/**
 * Play a named animation from a packed sprite sheet — the EASY path for animated characters:
 *   playAnim(ctx, 'player', 'run', t, x, y, { size: 48, anchor: 'bottom', flipX: !facingRight })
 * `t` is elapsed seconds. Loops by default; pass loop:false to hold the last frame (e.g. a death
 * pose). Falls back to the atlas's first frame, then returns false, so you can draw a fallback.
 */
export function playAnim(
  ctx: CanvasRenderingContext2D, name: string, anim: string, t: number,
  x: number, y: number, o: DrawOpts & { fps?: number; loop?: boolean } = {},
): boolean {
  const atlas = atlasesMap()[name];
  if (!atlas) return false;
  const frames = atlas.animations?.[anim];
  if (!frames || !frames.length) {
    // no such animation — show the first available frame so the character still appears
    const first = Object.keys(atlas.frames || {})[0];
    return first ? drawFrame(ctx, atlas, first, x, y, o) : false;
  }
  const fps = o.fps ?? 12;
  const i = Math.floor(Math.max(0, t) * fps);
  const idx = o.loop === false ? Math.min(i, frames.length - 1) : i % frames.length;
  return drawFrame(ctx, atlas, frames[idx], x, y, o);
}
