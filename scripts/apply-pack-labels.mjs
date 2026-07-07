#!/usr/bin/env node
// Generalized version of apply-iso-nature-labels.mjs: apply vision captions (cap-*.json, keyed by
// item idx from build-pack-montages.mjs) to every asset sharing that idx's exact-byte hash.
//
// cap-N.json format: [{ idx, name, role }, ...] OR [{ from, to, name, role }, ...] for a contiguous
// run of visually-similar tiles (e.g. autotile edge/corner variants of the same material) — role one
// of: vehicle/character/ground/obstacle/pickup/projectile/background/prop/ui
//
// Usage: node scripts/apply-pack-labels.mjs --pack "Roguelike City Pack"

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const CATALOG = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json');

const args = process.argv.slice(2);
const valOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PACK = valOf('--pack');
if (!PACK) { console.error('Usage: --pack "<Pack Name>"'); process.exit(1); }
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const OUT = `/private/tmp/claude-501/-Users-abiolalimitless-gameidea/scratchpad/pack-montages/${slugOf(PACK)}`;

const items = JSON.parse(fs.readFileSync(path.join(OUT, 'items.json'), 'utf8'));
const capByIdx = {};
let sheet = 0;
while (fs.existsSync(path.join(OUT, `cap-${sheet}.json`))) {
  for (const c of JSON.parse(fs.readFileSync(path.join(OUT, `cap-${sheet}.json`), 'utf8'))) {
    if (c.from !== undefined && c.to !== undefined) {
      for (let i = c.from; i <= c.to; i++) capByIdx[i] = c;
    } else {
      capByIdx[c.idx] = c;
    }
  }
  sheet++;
}
if (!sheet) { console.error(`No cap-*.json files found in ${OUT}`); process.exit(1); }

const memberToCap = new Map(); // asset id -> caption
for (const item of items) {
  const cap = capByIdx[item.idx];
  if (!cap) continue;
  for (const id of item.members) memberToCap.set(id, cap);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let updated = 0;
for (const a of catalog.assets) {
  if (a.pack !== PACK) continue;
  const cap = memberToCap.get(a.id);
  if (!cap) continue;
  a.role = cap.role;
  a.description = `${cap.name} — ${cap.role}${a.orientation && a.orientation !== 'unknown' ? ', ' + a.orientation.replace('_', '-') : ''} (Kenney ${PACK})`;
  a.visionLabeled = true;
  updated++;
}
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));

const inPack = catalog.assets.filter((a) => a.pack === PACK);
const by = (f) => inPack.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`✅ ${PACK}: labeled ${updated}/${inPack.length} assets from ${sheet} caption sheets (${items.length} unique items, ${Object.keys(capByIdx).length} captioned)`);
console.log('   roles now:', JSON.stringify(by((a) => a.role)));
