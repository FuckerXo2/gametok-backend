// Props/items collection — 1055 Kenney items name-classified into types (food, currency, weapon,
// key, container, building, boardgame, powerup, tool, furniture, decoration, nature-item). Lets the
// items role be filled with pickups that match the game (a cooking game gets food, a dungeon gets
// keys/chests) instead of whatever the single pack happened to have. DORMANT until wired behind
// GAMETOK_2D_COLLECTION.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _props = null;
export function loadProps() {
  if (_props) return _props;
  try { _props = JSON.parse(fs.readFileSync(path.join(__dirname, 'props-collection.json'), 'utf8')); }
  catch { _props = []; }
  return _props;
}

const toks = (s) => new Set(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
// Query cue -> item type it should pull toward.
const TYPE_CUES = [
  [/\bfood\b|cook|kitchen|restaurant|\beat\b|serve|meal|recipe|snack|fruit/, 'food'],
  [/coin|collect|treasure|\bgold\b|loot|score|currency/, 'currency'],
  [/dungeon|\bkey\b|chest|unlock|vault/, ['key', 'container']],
  [/build|city|town|strategy|kingdom|village|castle/, 'building'],
  [/board|casino|\bcard\b|\bdice\b|poker|tabletop/, 'boardgame'],
  [/weapon|combat|fight|arsenal|shoot/, 'weapon'],
  [/potion|power.?up|health|magic|heart/, 'powerup'],
];

/** Return up to n item sprite ids that fit the game. Empty array = no strong match (keep pack items). */
export function selectItems(query, n = 12) {
  const pool = loadProps();
  const qt = toks(query);
  const q = String(query || '').toLowerCase();
  const wantTypes = new Set();
  for (const [re, t] of TYPE_CUES) if (re.test(q)) (Array.isArray(t) ? t : [t]).forEach((x) => wantTypes.add(x));
  const scored = [];
  for (const it of pool) {
    const it_t = toks(`${it.name} ${it.type}`);
    let s = 0;
    for (const w of qt) if (it_t.has(w)) s += 3;
    if (wantTypes.has(it.type)) s += 4;
    if (s > 0) scored.push({ it, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set(); const out = [];
  for (const { it } of scored) { if (seen.has(it.name)) continue; seen.add(it.name); out.push(it.id); if (out.length >= n) break; }
  return out;
}
