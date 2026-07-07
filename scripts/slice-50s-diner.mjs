#!/usr/bin/env node
// Slice the 50s Diner sheets (16x16 grid, Kenney-style) into individual items by connected-component
// grouping over non-transparent 16px cells (handles multi-cell furniture like booths/jukeboxes), then
// build a labeled contact sheet for vision captioning. Mirrors the iso-nature montage approach.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(repoRoot, '..', '50s_Diner');
const OUT = path.resolve(repoRoot, '..', '50s_Diner', 'sliced', 'walltiles');
const CELL = 16;

const SHEETS = [
  { file: '50sdiner_set.png', tag: 'set' },
  { file: '50sdiner_room_door_tiles1.png', tag: 'door1' },
  { file: '50sdiner_room_door_tiles2.png', tag: 'door2' },
  { file: '50sdiner_room_door_tiles3.png', tag: 'door3' },
];

async function occupancyGrid(imgPath) {
  const img = sharp(imgPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + 3];
      if (a > 10) occ[Math.floor(y / CELL)][Math.floor(x / CELL)] = true;
    }
  }
  return { occ, width, height, cols, rows };
}

function components(occ, rows, cols) {
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const comps = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occ[r][c] || visited[r][c]) continue;
      const stack = [[r, c]];
      visited[r][c] = true;
      const cells = [];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        cells.push([cr, cc]);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && occ[nr][nc] && !visited[nr][nc]) {
            visited[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      comps.push(cells);
    }
  }
  return comps;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const items = [];
  for (const { file, tag } of SHEETS) {
    const imgPath = path.join(SRC_DIR, file);
    const { occ, width, height, cols, rows } = await occupancyGrid(imgPath);
    const comps = components(occ, rows, cols);
    let idx = 0;
    for (const cells of comps) {
      if (cells.length === 0) continue;
      const minR = Math.min(...cells.map((c) => c[0])), maxR = Math.max(...cells.map((c) => c[0]));
      const minC = Math.min(...cells.map((c) => c[1])), maxC = Math.max(...cells.map((c) => c[1]));
      const left = minC * CELL, top = minR * CELL;
      const w = Math.min((maxC - minC + 1) * CELL, width - left);
      const h = Math.min((maxR - minR + 1) * CELL, height - top);
      // Drop noise: single isolated pixels/anti-alias specks smaller than half a cell in both dims.
      if (w < 6 || h < 6) continue;
      const outName = `${tag}_${idx}.png`;
      await sharp(imgPath).extract({ left, top, width: w, height: h }).png().toFile(path.join(OUT, outName));
      items.push({ id: `${tag}_${idx}`, sheet: file, left, top, width: w, height: h, cellSpan: `${maxC - minC + 1}x${maxR - minR + 1}` });
      idx++;
    }
    console.log(`${file}: ${idx} items (grid ${cols}x${rows})`);
  }
  fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(items, null, 2));
  console.log(`\n✅ ${items.length} sliced items → ${OUT}/items.json`);
}

main();
