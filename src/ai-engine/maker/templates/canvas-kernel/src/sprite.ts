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
