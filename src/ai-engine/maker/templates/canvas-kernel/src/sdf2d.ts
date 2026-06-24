// GameTok 2D SDF polish kernel — crisp, glowing, anti-aliased shapes drawn from signed-distance
// fields and BAKED ONCE into an offscreen canvas you drawImage at runtime. No image assets, no FLUX.
// A distance field gives perfect anti-aliasing, soft glow, clean outlines, and smooth shape blending
// almost for free — the "designed" look that raw ctx.arc()/fillRect can't reach.
// Read-only kernel file: the Phase 2 agent imports these, never edits them.

// A signed distance function: returns <0 inside the shape, 0 on the edge, >0 outside.
// Coordinates are in pixels, measured from the CENTER of the baked canvas.
export type SDF = (x: number, y: number) => number;

// ── distance primitives (shape centered at 0,0) ──
export function sdCircle(r: number): SDF {
  return (x, y) => Math.hypot(x, y) - r;
}
export function sdBox(halfW: number, halfH: number): SDF {
  return (x, y) => {
    const dx = Math.abs(x) - halfW;
    const dy = Math.abs(y) - halfH;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  };
}
export function sdRoundRect(halfW: number, halfH: number, r: number): SDF {
  const box = sdBox(halfW - r, halfH - r);
  return (x, y) => box(x, y) - r;
}
export function sdCapsule(ax: number, ay: number, bx: number, by: number, r: number): SDF {
  return (x, y) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
  };
}

// ── combinators (build complex shapes from simple ones) ──
export function opUnion(a: SDF, b: SDF): SDF {
  return (x, y) => Math.min(a(x, y), b(x, y));
}
export function opSubtract(a: SDF, b: SDF): SDF {
  return (x, y) => Math.max(a(x, y), -b(x, y));
}
// Smooth/metaball blend — k controls the rounding of the join (try 6–18).
export function opSmoothUnion(a: SDF, b: SDF, k: number): SDF {
  return (x, y) => {
    const da = a(x, y), db = b(x, y);
    const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (db - da)) / k));
    return db + (da - db) * h - k * h * (1 - h);
  };
}
export function opRotate(sdf: SDF, angle: number): SDF {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (x, y) => sdf(c * x + s * y, -s * x + c * y);
}

export interface SDFStyle {
  fill?: string;            // flat body color (or use fillTop + fillBottom for a vertical gradient)
  fillTop?: string;
  fillBottom?: string;
  outline?: string;         // crisp edge color
  outlineWidth?: number;    // px
  glow?: string;            // soft glow color radiating outside the shape
  glowSize?: number;        // px reach of the glow
  highlight?: boolean;      // glossy top-lit sheen inside the body
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * THE PRIMITIVE — bake a signed-distance field into a crisp, glowing sprite. Evaluates `sdf` once per
 * pixel over a (width × height) offscreen canvas (cheap: done a handful of times at init, never per
 * frame) and returns an HTMLCanvasElement you draw exactly like any sprite: ctx.drawImage(sprite, x, y).
 * Anti-aliasing, glow, outline and a glossy highlight all fall out of the distance value automatically.
 * Compose shapes first with opSmoothUnion / opSubtract / opRotate, then bake the result.
 */
export function bakeSDF(width: number, height: number, sdf: SDF, style: SDFStyle = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = img.data;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const aa = 1.0;
  const top = hexToRgb(style.fillTop ?? style.fill ?? '#cfd6e0');
  const bot = hexToRgb(style.fillBottom ?? style.fill ?? '#9aa3ad');
  const outline = style.outline ? hexToRgb(style.outline) : null;
  const ow = style.outlineWidth ?? 0;
  const glow = style.glow ? hexToRgb(style.glow) : null;
  const gs = style.glowSize ?? 0;

  for (let y = 0; y < canvas.height; y += 1) {
    const t = y / canvas.height;
    const fr = top[0] + (bot[0] - top[0]) * t;
    const fg = top[1] + (bot[1] - top[1]) * t;
    const fb = top[2] + (bot[2] - top[2]) * t;
    const hl = style.highlight ? 0.35 * Math.max(0, -(y - cy) / cy) : 0;
    for (let x = 0; x < canvas.width; x += 1) {
      const d = sdf(x - cx, y - cy);
      let r = 0, g = 0, b = 0, a = 0;
      if (glow && gs > 0 && d > 0) {
        const gv = Math.pow(Math.max(0, 1 - d / gs), 2) * 0.8;
        r = glow[0]; g = glow[1]; b = glow[2]; a = gv;
      }
      const body = smoothstep(aa, -aa, d);
      if (body > 0) {
        r = fr * (1 + hl); g = fg * (1 + hl); b = fb * (1 + hl);
        a = Math.max(a, body);
      }
      if (outline && ow > 0) {
        const edge = (1 - smoothstep(ow - aa, ow + aa, Math.abs(d))) * (d < ow ? 1 : 0);
        if (edge > 0) {
          r = r * (1 - edge) + outline[0] * edge;
          g = g * (1 - edge) + outline[1] * edge;
          b = b * (1 - edge) + outline[2] * edge;
          a = Math.max(a, edge);
        }
      }
      const i = (y * canvas.width + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ── WORKED EXAMPLES — read these to learn the pattern, then bake the shapes THIS game needs ──

/** Faceted gem/pickup: a glowing rounded diamond. */
export function makeGem(size = 96, color = '#5ad6ff'): HTMLCanvasElement {
  const r = size * 0.32;
  const diamond = opRotate(sdRoundRect(r, r, r * 0.18), Math.PI / 4);
  return bakeSDF(size, size, diamond, {
    fillTop: '#e8fbff', fillBottom: color, outline: '#0a2230', outlineWidth: 2,
    glow: color, glowSize: size * 0.16, highlight: true,
  });
}

/** Glossy orb/coin/bubble. */
export function makeOrb(size = 80, color = '#ffcf5a'): HTMLCanvasElement {
  return bakeSDF(size, size, sdCircle(size * 0.34), {
    fillTop: '#fff4d6', fillBottom: color, outline: '#3a2a06', outlineWidth: 2,
    glow: color, glowSize: size * 0.14, highlight: true,
  });
}

/** Clean rounded HUD panel with a glowing edge. */
export function makeHudPanel(width = 260, height = 80, accent = '#46c8ff'): HTMLCanvasElement {
  return bakeSDF(width, height, sdRoundRect(width / 2 - 6, height / 2 - 6, 16), {
    fillTop: '#141a24', fillBottom: '#0b0f16', outline: accent, outlineWidth: 1.5,
    glow: accent, glowSize: 8,
  });
}
