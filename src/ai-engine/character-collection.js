// Cross-pack character collection — 595 Kenney characters/enemies vision-labeled with semantic
// names + archetype/theme/role (built by the intake pipeline). Lets the resolver pick a character by
// MEANING ("wizard"/"orc"/"slime") across ALL packs, instead of grabbing whatever base sprite lives
// in the single chosen pack (the green-goblin bug). DORMANT until GAMETOK_2D_COLLECTION is enabled —
// see resolveCharacterFromCollection callers.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _collection = null;
export function loadCollection() {
  if (_collection) return _collection;
  try { _collection = JSON.parse(fs.readFileSync(path.join(__dirname, 'character-collection.json'), 'utf8')); }
  catch { _collection = []; }
  return _collection;
}

const toks = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));

// Query word -> archetypes/themes it should pull toward (bridges intent words to what's in the pool).
const SYN = {
  wizard: { a: ['humanoid'], t: ['fantasy'] }, mage: { a: ['humanoid'], t: ['fantasy'] }, sorcerer: { a: ['humanoid'], t: ['fantasy'] },
  knight: { a: ['humanoid'], t: ['fantasy'] }, warrior: { a: ['humanoid'], t: ['fantasy'] }, hero: { a: ['humanoid'], t: ['fantasy'] },
  adventurer: { a: ['humanoid'], t: ['fantasy'] }, orc: { a: ['humanoid'], t: ['fantasy'] }, goblin: { a: ['humanoid'], t: ['fantasy'] },
  zombie: { a: ['humanoid', 'monster'], t: ['horror', 'fantasy'] }, skeleton: { a: ['humanoid', 'monster'], t: ['horror'] },
  ghost: { a: ['ghost'], t: ['fantasy', 'horror'] }, demon: { a: ['demon', 'monster'], t: ['fantasy'] }, monster: { a: ['monster', 'creature'], t: ['fantasy'] },
  slime: { a: ['slime'], t: ['fantasy'] }, dragon: { a: ['creature'], t: ['fantasy'] }, spider: { a: ['creature'], t: ['nature'] },
  robot: { a: ['robot'], t: ['scifi'] }, mech: { a: ['robot'], t: ['scifi'] }, android: { a: ['robot'], t: ['scifi'] },
  alien: { a: ['alien'], t: ['scifi'] }, astronaut: { a: ['astronaut'], t: ['scifi'] }, spaceman: { a: ['astronaut'], t: ['scifi'] },
  spaceship: { a: ['vehicle'], t: ['scifi'] }, ship: { a: ['vehicle'], t: ['scifi'] }, starship: { a: ['vehicle'], t: ['scifi'] }, ufo: { a: ['vehicle'], t: ['scifi'] },
  car: { a: ['vehicle'], t: ['modern'] }, soldier: { a: ['humanoid'], t: ['modern'] }, gunman: { a: ['humanoid'], t: ['modern'] }, person: { a: ['humanoid'], t: ['modern'] },
  animal: { a: ['animal'], t: ['nature'] }, bird: { a: ['animal'], t: ['nature'] }, fish: { a: ['animal'], t: ['nature'] }, bug: { a: ['critter', 'animal'], t: ['nature'] },
  blob: { a: ['blob', 'slime'], t: [] }, worm: { a: ['creature'], t: ['nature'] },
};

/** Pick the best-matching collection character for a described entity. role: 'player' | 'enemy'. */
export function selectCharacter(query, role = 'either') {
  const pool = loadCollection();
  const qt = toks(query);
  let best = null, bestScore = 0; // require a positive match, else null (fall back to pack-based)
  for (const c of pool) {
    if (c.role === 'part') continue;
    if (role === 'player' && c.role === 'enemy') continue;
    if (role === 'enemy' && c.role === 'player') continue;
    const ct = toks(`${c.name} ${c.archetype} ${c.theme}`);
    let score = 0;
    for (const w of qt) if (ct.has(w)) score += 4;               // direct name/archetype/theme word hit
    for (const w of qt) { const s = SYN[w]; if (s) { if (s.a.includes(c.archetype)) score += 3; if (s.t.includes(c.theme)) score += 1; } }
    if (c.role === 'either') score += 0.5;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

const stripFrame = (n) => n.toLowerCase().replace(/[_-]?(walk|jump|run|climb|hurt|fall|idle|stand|duck|front|back|hang|dead|hit|attack|ready|swim|talk|cheer|kick|slide|roll)\d*$/i, '').replace(/[_-]?\d+$/, '');

/** Recover a collection character's animation frames from its source pack manifest (loaded via cb). */
export function resolveCharacterAnimations(entry, loadPackManifest) {
  const [packId, spriteName] = entry.id.split(/\/(.+)/);
  const m = loadPackManifest(packId);
  const anims = {};
  if (m && Array.isArray(m.animations)) {
    const base = stripFrame(spriteName);
    for (const a of m.animations) if (a.character && stripFrame(a.character) === base) anims[a.name] = a.frames;
  }
  return { key: entry.id, name: entry.name, archetype: entry.archetype, w: entry.w, h: entry.h, animations: anims };
}
