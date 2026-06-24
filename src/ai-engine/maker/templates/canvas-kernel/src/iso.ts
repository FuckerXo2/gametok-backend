// GameTok 2D isometric kernel — the math that makes a flat top-down grid read as a tilted,
// "Clash of Clans" battlefield. Read-only kernel file: the Phase 2 agent consumes these, never edits.
//
// Why this exists: every strategy / base-builder / tactics game wants the ANGLED isometric look, not
// flat straight-down — but hand-rolling the grid<->screen projection (and getting click-picking +
// draw-order right) is exactly where models slip. createIsoGrid() hands you a configured grid with all
// of it solved: place(), toScreen(), toGrid() (for taps), and depth-sort. Your sprites stay normal 2D
// images; this just decides WHERE on screen each grid cell lands.

export interface IsoConfig {
  /** Full diamond tile WIDTH in screen px. Tile height defaults to tileW/2 (the classic 2:1 iso look). */
  tileW: number;
  /** Diamond tile HEIGHT in px. Omit for the standard 2:1 ratio (tileW/2). */
  tileH?: number;
  /** Screen px where grid cell (0,0)'s CENTER sits. Usually near the top-middle of the play area. */
  originX: number;
  originY: number;
}

export interface IsoGrid {
  tileW: number;
  tileH: number;
  /** Grid cell (col,row — may be fractional) -> screen pixel at the tile's CENTER. Place entities here. */
  toScreen(col: number, row: number): { x: number; y: number };
  /** Screen pixel -> fractional grid cell. Math.floor(col/row) gives the tile under a tap/click. */
  toGrid(px: number, py: number): { col: number; row: number };
  /** Painter's-order key: draw entities sorted ascending by depth() so nearer tiles cover farther ones. */
  depth(col: number, row: number): number;
  /** Draw ONE diamond ground tile (code-rendered, no asset). */
  drawTile(ctx: CanvasRenderingContext2D, col: number, row: number, opts?: IsoTileStyle): void;
  /** Fill a cols x rows diamond floor (optionally checkered) — the battlefield ground in one call. */
  drawGround(ctx: CanvasRenderingContext2D, cols: number, rows: number, opts?: IsoGroundStyle): void;
  /** Draw a sprite image so its FEET (bottom-center) rest on the cell — correct anchoring for units/props. */
  place(ctx: CanvasRenderingContext2D, img: CanvasImageSource, col: number, row: number, opts?: IsoPlaceOpts): void;
}

export interface IsoTileStyle { fill?: string; stroke?: string; lineWidth?: number; }
export interface IsoGroundStyle { fillA?: string; fillB?: string; stroke?: string; }
export interface IsoPlaceOpts { w?: number; h?: number; scale?: number; lift?: number; }

export function createIsoGrid(config: IsoConfig): IsoGrid {
  const tileW = config.tileW;
  const tileH = config.tileH ?? tileW / 2;
  const ox = config.originX;
  const oy = config.originY;
  const hw = tileW / 2;
  const hh = tileH / 2;

  const grid: IsoGrid = {
    tileW,
    tileH,
    toScreen(col, row) {
      return { x: ox + (col - row) * hw, y: oy + (col + row) * hh };
    },
    toGrid(px, py) {
      const dx = (px - ox) / hw;
      const dy = (py - oy) / hh;
      return { col: (dx + dy) / 2, row: (dy - dx) / 2 };
    },
    depth(col, row) {
      return col + row;
    },
    drawTile(ctx, col, row, opts = {}) {
      const { x, y } = grid.toScreen(col, row);
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x + hw, y);
      ctx.lineTo(x, y + hh);
      ctx.lineTo(x - hw, y);
      ctx.closePath();
      ctx.fillStyle = opts.fill ?? '#3c6b3c';
      ctx.fill();
      if (opts.stroke) {
        ctx.lineWidth = opts.lineWidth ?? 1;
        ctx.strokeStyle = opts.stroke;
        ctx.stroke();
      }
    },
    drawGround(ctx, cols, rows, opts = {}) {
      const a = opts.fillA ?? '#3c6b3c';
      const b = opts.fillB ?? '#356135';
      // Back-to-front so the diamonds overlap cleanly.
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          grid.drawTile(ctx, col, row, { fill: (col + row) % 2 === 0 ? a : b, stroke: opts.stroke });
        }
      }
    },
    place(ctx, img, col, row, opts = {}) {
      const { x, y } = grid.toScreen(col, row);
      const iw = (img as HTMLImageElement).width || 64;
      const ih = (img as HTMLImageElement).height || 64;
      const scale = opts.scale ?? 1;
      const w = opts.w ?? iw * scale;
      const h = opts.h ?? ih * scale;
      const lift = opts.lift ?? 0;
      // Anchor bottom-center to the tile center so the unit "stands on" the cell.
      ctx.drawImage(img, x - w / 2, y - h - lift + hh, w, h);
    },
  };
  return grid;
}

/**
 * Sort entities into correct isometric draw order (far tiles first). Pass an array and a getter for each
 * entity's grid cell; returns a NEW sorted array to render in order. Without this, units render in spawn
 * order and overlap wrong (a back unit painting over a front one).
 */
export function isoSort<T>(entities: T[], cell: (e: T) => { col: number; row: number }): T[] {
  return [...entities].sort((a, b) => {
    const ca = cell(a);
    const cb = cell(b);
    return (ca.col + ca.row) - (cb.col + cb.row);
  });
}
