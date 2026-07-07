#!/usr/bin/env node
// Ingest the sliced 50s Diner furniture + wall/door tiles into diner-catalog.json (unified schema,
// theme:cooking). Sources are pre-sliced by slice-50s-diner-manual.mjs (furniture, hand-cropped —
// the sheet has zero pixel gaps between items so auto-slicing merges everything) and
// slice-50s-diner.mjs (wall/door tiles, auto-sliced cleanly via connected components).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DINER_ROOT = path.resolve(repoRoot, '..', '50s_Diner');
const FURNITURE_DIR = path.join(DINER_ROOT, 'sliced', 'furniture');
const WALLTILES_DIR = path.join(DINER_ROOT, 'sliced', 'walltiles');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const OUT = path.join(repoRoot, 'src', 'ai-engine', 'diner-catalog.json');

// base id -> { role, description } — applied to every color variant of that base.
const FURNITURE_ROLE = {
  chair_ladderback: ['prop', 'diner chair, ladder-back'],
  chair_roundback: ['prop', 'diner chair, round-back'],
  chair_small: ['prop', 'diner chair, small/low-back'],
  table_square: ['prop', 'diner table, square top on pedestal'],
  table_rect_long: ['prop', 'diner table, long rectangular'],
  table_tall: ['prop', 'diner table, tall rectangular'],
  lamp_orb: ['prop', 'diner floor lamp, round orb top'],
  booth_corner: ['prop', 'diner booth seat, corner/L-shaped'],
  booth_double: ['prop', 'diner booth seat, double bench'],
  booth_bench: ['prop', 'diner booth bench seat'],
  stool_round: ['prop', 'diner stool, round seat on pole'],
};

const SHARED_META = {
  counter_soda_fountain: ['prop', 'diner counter with soda fountain front'],
  counter_plain_gray: ['prop', 'diner counter, plain gray'],
  counter_drawers_gray: ['prop', 'diner counter with drawers'],
  floor_tile_gray_cream: ['ground', 'checkerboard floor tile, gray/cream'],
  floor_tile_teal_cream: ['ground', 'checkerboard floor tile, teal/cream'],
  floor_tile_orange_cream: ['ground', 'checkerboard floor tile, orange/cream'],
  floor_tile_pink_cream: ['ground', 'checkerboard floor tile, pink/cream'],
  floor_solid_pink: ['ground', 'solid floor tile, pink'],
  floor_solid_teal: ['ground', 'solid floor tile, teal'],
  floor_tile_checker_bw_trim: ['ground', 'black/white checker floor trim strip'],
  wall_art_milkshake: ['prop', 'wall art poster, milkshake'],
  wall_art_cola_truck_ad: ['prop', 'wall art poster, cola delivery ad'],
  wall_art_icecream_ad: ['prop', 'wall art poster, ice cream ad'],
  clock_pink: ['prop', 'wall clock, pink frame'],
  menu_board_dark: ['prop', 'dark menu/register display board'],
  wall_art_chart_teal: ['prop', 'wall art poster, teal chart'],
  wall_art_checklist_pink: ['prop', 'wall art poster, pink checklist'],
  wall_art_icecream_sundae: ['prop', 'wall art poster, ice cream sundae'],
  sign_cola_small: ['prop', 'small cola wall sign'],
  wall_art_cola_bottle: ['prop', 'wall art poster, cola bottle'],
  wall_art_burger: ['prop', 'wall art poster, burger'],
  cap_pepsi: ['prop', 'bottle cap, pepsi-style'],
  cap_cola: ['prop', 'bottle cap, cola-style'],
  record_pink: ['prop', 'vinyl record, pink label'],
  record_teal: ['prop', 'vinyl record, teal label'],
  record_plain: ['prop', 'vinyl record, plain black'],
  coffee_machine_2burner: ['prop', 'diner coffee machine, 2-burner'],
  coffee_pots_pair: ['prop', 'diner coffee pots (assorted, 4-up)'],
  espresso_machines_pair: ['prop', 'diner espresso/coffee machines (pair)'],
  soda_fountain_4flavor: ['prop', 'diner soda fountain dispenser, 4-flavor'],
  dispenser_side_buttons: ['prop', 'diner drink dispenser with side buttons'],
  food_hotdog_plate: ['served', 'assorted plated diner desserts (pie/waffle/hotdog, 4-up)'],
  drink_soda_bottle_pour: ['pickup', 'soda glass, pouring'],
  drink_bottle: ['pickup', 'glass soda bottle'],
  cup_white: ['pickup', 'white drink cup'],
  food_icecream_sundae: ['served', 'ice cream sundae, plated'],
  food_burger_plate: ['served', 'burger, plated'],
  cup_coffee_white: ['pickup', 'white coffee cup'],
  cup_coffee_brown: ['pickup', 'brown coffee cup'],
  bottle_ketchup_gray: ['prop', 'condiment bottle, gray'],
  bottle_mustard: ['prop', 'mustard bottle'],
  bottle_ketchup_red: ['prop', 'ketchup bottle'],
  food_pie_slice: ['served', 'pie slice, plated'],
  menu_receipt: ['ui', 'menu/receipt slip'],
  guitar_teal: ['prop', 'decorative guitar, teal'],
  guitar_red: ['prop', 'decorative guitar, red'],
  jukebox_yellow_brown: ['prop', 'jukebox, yellow/brown'],
  jukebox_classic: ['prop', 'jukebox, classic red/gold'],
  jukebox_brown_speaker: ['prop', 'jukebox, brown with speaker grille'],
};

const assets = [];

// ── Furniture (hand-sliced, 3 color variants for the reusable pieces) ──
const furnitureManifest = JSON.parse(fs.readFileSync(path.join(FURNITURE_DIR, 'manifest.json'), 'utf8'));
for (const it of furnitureManifest) {
  const file = `${it.id}.png`;
  const src = path.join(FURNITURE_DIR, file);
  if (!fs.existsSync(src)) continue;
  const meta = FURNITURE_ROLE[it.base] || SHARED_META[it.base];
  if (!meta) { console.warn(`⚠️  no role metadata for ${it.id}, skipping`); continue; }
  const [role, desc] = meta;
  let dim;
  try { const d = imageSize(fs.readFileSync(src)); dim = { width: d.width, height: d.height }; } catch { continue; }
  const key = `diner/furniture/${file}`;
  assets.push({
    id: key.replace(/\.png$/, ''), source: '50s-diner', url: R2_BASE + key, localPath: path.join('furniture', file),
    type: 'sprite', theme: ['cooking'], role,
    // Furniture/decor art is drawn front-on regardless of camera orientation (like Kenney's other
    // decor packs) — mark orientation-agnostic so it isn't filtered out of a top_down/iso game.
    orientation: 'n_a',
    description: it.color ? `${desc} (${it.color}) — 50s Diner` : `${desc} — 50s Diner`,
    width: dim.width, height: dim.height,
    tileable: role === 'ground', pack: '50s Diner',
  });
}

// ── Wall/door/room tiles (auto-sliced, connected components) ──
const wallManifest = JSON.parse(fs.readFileSync(path.join(WALLTILES_DIR, 'items.json'), 'utf8'));
let wallIdx = 0;
for (const it of wallManifest) {
  if (it.sheet === '50sdiner_set.png') continue; // failed auto-slice of the dense sheet, handled manually above
  const file = `${it.id}.png`;
  const src = path.join(WALLTILES_DIR, file);
  if (!fs.existsSync(src)) continue;
  let dim;
  try { const d = imageSize(fs.readFileSync(src)); dim = { width: d.width, height: d.height }; } catch { continue; }
  const key = `diner/walltiles/${file}`;
  assets.push({
    id: key.replace(/\.png$/, ''), source: '50s-diner', url: R2_BASE + key, localPath: path.join('walltiles', file),
    type: 'sprite', theme: ['cooking'], role: 'prop',
    orientation: 'n_a',
    description: `diner room wall/door/beam piece #${wallIdx} — 50s Diner`,
    width: dim.width, height: dim.height,
    tileable: false, pack: '50s Diner',
  });
  wallIdx++;
}

fs.writeFileSync(OUT, JSON.stringify({
  metadata: { source: '50s-diner', generatedAt: new Date().toISOString(), totalAssets: assets.length, r2Base: R2_BASE },
  assets,
}, null, 2));

const by = (f) => assets.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`✅ ingested ${assets.length} 50s Diner assets`);
console.log('   roles:', JSON.stringify(by((a) => a.role)));
console.log('→', OUT);
