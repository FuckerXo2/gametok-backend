// Background collection — 84 Kenney SCENE backdrops (parallax layers) biome-tagged (forest, desert,
// grassland, snow, castle, space, sky, mushroom). These are SIDE-SCROLLER parallax scenes — only apply
// to platformer/side-scroller games (a horizon backdrop behind a top-down arena looks wrong). Kenney
// has nothing for top-down/dungeon/city/painted scenes — those need sourced painted backdrops.
// DORMANT until wired behind GAMETOK_2D_COLLECTION.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _bg = null;
export function loadBackgrounds() {
  if (_bg) return _bg;
  try { _bg = JSON.parse(fs.readFileSync(path.join(__dirname, 'background-collection.json'), 'utf8')); }
  catch { _bg = []; }
  return _bg;
}

const BIOME_CUES = [
  [/forest|jungle|wood|\btree/i, 'forest'], [/desert|sand|dune/i, 'desert'],
  [/grass|meadow|\bhill|park|\bfield|nature|garden|plain/i, 'grassland'], [/snow|\bice\b|winter|frozen|arctic/i, 'snow'],
  [/castle|medieval|kingdom|knight|dungeon/i, 'castle'], [/space|galaxy|alien|cosmic|\bstar|sci.?fi|planet|astro/i, 'space'],
  [/mushroom|shroom/i, 'mushroom'], [/\bsky\b|cloud|flying|\bair\b/i, 'sky'],
];

/** Pick scene backdrop(s) for a side-scroller game by biome. Returns [] if no sensible match. */
export function selectBackground(query, n = 3) {
  const bgs = loadBackgrounds();
  if (!bgs.length) return [];
  const q = String(query || '').toLowerCase();
  let biome = null;
  for (const [re, b] of BIOME_CUES) if (re.test(q)) { biome = b; break; }
  let pool = biome ? bgs.filter((b) => b.biome === biome) : [];
  if (!pool.length) pool = bgs.filter((b) => b.biome === 'grassland' || b.biome === 'generic'); // safe default
  return pool.slice(0, n).map((b) => b.id);
}
