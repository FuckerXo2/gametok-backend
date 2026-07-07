#!/usr/bin/env node
// Manual bounding-box slice of 50sdiner_set.png — the sheet is a dense icon sheet with zero pixel
// gaps between items, so connected-component auto-slicing merges everything into one blob. Boxes
// below were read off a 6x-scaled 16px-cell grid overlay (see slice-50s-diner.mjs for the tile-sheet
// sibling that DOES auto-slice cleanly).
// Box format: [colStart, rowStart, colEnd, rowEnd] in 16px cells (end exclusive).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SRC = path.resolve(repoRoot, '..', '50s_Diner', '50sdiner_set.png');
const OUT = path.resolve(repoRoot, '..', '50s_Diner', 'sliced', 'furniture');
const CELL = 16;

// Furniture repeats identically at 3 color offsets (row band +0=red, +8=teal, +16=pink), each band
// has a chairs/tables sub-row (rows+0..4) and a booths sub-row (rows+4..8).
const FURNITURE_TEMPLATE = [
  { id: 'chair_ladderback', box: [0, 0, 3, 4] },
  { id: 'chair_roundback', box: [3, 0, 5, 4] },
  { id: 'chair_small', box: [5, 0, 7, 4] },
  { id: 'table_square', box: [7, 0, 9, 4] },
  { id: 'table_rect_long', box: [9, 0, 12, 4] },
  { id: 'table_tall', box: [12, 0, 14, 4] },
  { id: 'lamp_orb', box: [13, 0, 15, 4] },
  { id: 'booth_corner', box: [0, 4, 3, 8] },
  { id: 'booth_double', box: [3, 4, 6, 8] },
  { id: 'booth_bench', box: [6, 4, 9, 8] },
  { id: 'stool_round', box: [9, 4, 11, 8] },
];
const COLORS = [{ name: 'red', rowOffset: 0 }, { name: 'teal', rowOffset: 8 }, { name: 'pink', rowOffset: 16 }];

const SHARED = [
  { id: 'counter_soda_fountain', box: [16, 0, 21, 8] },
  { id: 'counter_plain_gray', box: [22, 9, 28, 11] },
  { id: 'counter_drawers_gray', box: [22, 11, 28, 14] },
  { id: 'floor_tile_gray_cream', box: [22, 0, 24, 4] },
  { id: 'floor_tile_teal_cream', box: [24, 0, 26, 4] },
  { id: 'floor_tile_orange_cream', box: [22, 4, 24, 8] },
  { id: 'floor_tile_pink_cream', box: [24, 4, 26, 8] },
  { id: 'floor_solid_pink', box: [22, 8, 24, 12] },
  { id: 'floor_solid_teal', box: [24, 8, 26, 12] },
  { id: 'floor_tile_checker_bw_trim', box: [26, 8, 28, 9] },
  { id: 'wall_art_milkshake', box: [22, 14, 24, 16] },
  { id: 'wall_art_cola_truck_ad', box: [24, 14, 26, 15] },
  { id: 'wall_art_icecream_ad', box: [24, 15, 26, 16] },
  { id: 'clock_pink', box: [26, 14, 27, 16] },
  { id: 'menu_board_dark', box: [22, 16, 28, 18] },
  { id: 'wall_art_chart_teal', box: [22, 19, 24, 21] },
  { id: 'wall_art_checklist_pink', box: [24, 19, 26, 21] },
  { id: 'wall_art_icecream_sundae', box: [26, 18, 28, 21] },
  { id: 'sign_cola_small', box: [22, 21, 24, 23] },
  { id: 'wall_art_cola_bottle', box: [24, 21, 26, 23] },
  { id: 'wall_art_burger', box: [26, 21, 28, 23] },
  { id: 'cap_pepsi', box: [22, 23, 23, 24] },
  { id: 'cap_cola', box: [23, 23, 24, 24] },
  { id: 'record_pink', box: [22, 24, 23, 25] },
  { id: 'record_teal', box: [23, 24, 24, 25] },
  { id: 'record_plain', box: [22, 25, 23, 26] },
  { id: 'coffee_machine_2burner', box: [14, 24, 16, 26] },
  { id: 'coffee_pots_pair', box: [16, 24, 18, 26] },
  { id: 'espresso_machines_pair', box: [18, 24, 20, 26] },
  { id: 'soda_fountain_4flavor', box: [20, 24, 22, 26] },
  { id: 'dispenser_side_buttons', box: [22, 24, 24, 26] },
  { id: 'food_hotdog_plate', box: [14, 26, 16, 28] },
  { id: 'drink_soda_bottle_pour', box: [17, 26, 18, 28] },
  { id: 'drink_bottle', box: [18, 26, 19, 28] },
  { id: 'cup_white', box: [19, 26, 20, 27] },
  { id: 'food_icecream_sundae', box: [20, 26, 21, 28] },
  { id: 'food_burger_plate', box: [14, 27, 15, 28] },
  { id: 'cup_coffee_white', box: [15, 27, 16, 28] },
  { id: 'cup_coffee_brown', box: [16, 27, 17, 28] },
  { id: 'bottle_ketchup_gray', box: [17, 27, 18, 28] },
  { id: 'bottle_mustard', box: [18, 27, 19, 28] },
  { id: 'bottle_ketchup_red', box: [19, 27, 20, 28] },
  { id: 'food_pie_slice', box: [20, 27, 21, 28] },
  { id: 'menu_receipt', box: [21, 27, 22, 28] },
  { id: 'guitar_teal', box: [0, 26, 2, 28] },
  { id: 'guitar_red', box: [2, 26, 4, 28] },
  { id: 'jukebox_yellow_brown', box: [4, 24, 6, 28] },
  { id: 'jukebox_classic', box: [6, 24, 8, 28] },
  { id: 'jukebox_brown_speaker', box: [8, 24, 10, 28] },
];

async function crop(id, box) {
  const [c0, r0, c1, r1] = box;
  const left = c0 * CELL, top = r0 * CELL;
  const width = (c1 - c0) * CELL, height = (r1 - r0) * CELL;
  const outPath = path.join(OUT, `${id}.png`);
  await sharp(SRC).extract({ left, top, width, height }).png().toFile(outPath);
  return outPath;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  for (const color of COLORS) {
    for (const item of FURNITURE_TEMPLATE) {
      const [c0, r0, c1, r1] = item.box;
      const box = [c0, r0 + color.rowOffset, c1, r1 + color.rowOffset];
      const id = `${item.id}_${color.name}`;
      await crop(id, box);
      manifest.push({ id, box, color: color.name, base: item.id });
    }
  }
  for (const item of SHARED) {
    await crop(item.id, item.box);
    manifest.push({ id: item.id, box: item.box, color: null, base: item.id });
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`✅ ${manifest.length} items cropped → ${OUT}`);
}
main();
