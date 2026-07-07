#!/usr/bin/env node
// Apply vision captions (cap-*.json, keyed by Isometric-Nature item number) to every rotation of
// that item in kenney2d-catalog.json: set a real role (tree/rock -> obstacle, terrain -> ground) and
// a descriptive name so the blind model can pick "pine tree" vs "white rock" vs "grass tile".

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const CAPS = '/private/tmp/claude-501/-Users-abiolalimitless-gameidea/iso-nature';
const CATALOG = path.join(repoRoot, 'src', 'ai-engine', 'kenney2d-catalog.json');

const capByItem = {};
for (let s = 0; s <= 5; s++) {
  const f = path.join(CAPS, `cap-${s}.json`);
  if (!fs.existsSync(f)) continue;
  for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) capByItem[c.item] = c;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let updated = 0, foliage = 0;
for (const a of catalog.assets) {
  if (a.pack !== 'Isometric Nature') continue;
  const m = (a.localPath || '').match(/naturepack_(\d+)_\d+/i);
  const item = m ? m[1] : null;
  const cap = item && capByItem[item];
  if (cap) {
    a.role = cap.role;
    a.description = `${cap.name} — ${cap.role}, isometric (Kenney Isometric Nature)`;
    a.orientationVerified = true;
    updated++;
  } else {
    // uncaptioned items (176-226) = tiny flowers/sprouts/bushes -> decorative foliage
    a.role = 'prop';
    a.description = `small plant/foliage — prop, isometric (Kenney Isometric Nature)`;
    foliage++;
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));

const nat = catalog.assets.filter((a) => a.pack === 'Isometric Nature');
const by = (f) => nat.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`✅ labeled ${updated} Isometric Nature sprites from captions, ${foliage} as generic foliage`);
console.log('   roles now:', JSON.stringify(by((a) => a.role)));
console.log('   trees:', nat.filter((a) => /tree|palm/.test(a.description)).length, '| rocks:', nat.filter((a) => /rock|boulder|stone/.test(a.description)).length, '| ground:', nat.filter((a) => a.role === 'ground').length);
