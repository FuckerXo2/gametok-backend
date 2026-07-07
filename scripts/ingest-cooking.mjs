#!/usr/bin/env node
// Ingest cooking/food asset packs into cooking-catalog.json (unified schema, theme:cooking).
// Ghost Pixels food = 102 individual, self-named PNGs (raw + _dish plated variants). No slicing.
// (50s Diner is a 16x16 tilesheet handled separately.)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const GHOST = path.resolve(repoRoot, '..', 'Ghostpixxells_pixelfood');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const OUT = path.join(repoRoot, 'src', 'ai-engine', 'cooking-catalog.json');

const assets = [];

// ── Ghost Pixels food ──
for (const file of fs.readdirSync(GHOST)) {
  if (!file.toLowerCase().endsWith('.png')) continue;
  const nameNoExt = file.replace(/\.png$/i, '');
  const cleaned = nameNoExt.replace(/^\d+_/, '');          // strip leading "15_"
  const isDish = /_dish$/i.test(cleaned) || /^dish$/i.test(cleaned);
  const foodName = cleaned.replace(/_dish$/i, '').replace(/_/g, ' ');
  const isDishware = /^(dish|bowl|plate|dish pile)$/i.test(foodName);

  let role, desc;
  if (isDishware) { role = 'prop'; desc = `${foodName} (empty dishware)`; }
  else if (isDish) { role = 'served'; desc = `${foodName} plated/served on a dish`; }
  else { role = 'pickup'; desc = `${foodName} (raw food / ingredient)`; }

  let dim = null;
  try { const d = imageSize(fs.readFileSync(path.join(GHOST, file))); dim = { width: d.width, height: d.height }; } catch { continue; }

  const key = `cooking/ghostpixels/${file.toLowerCase()}`;
  assets.push({
    id: key.replace(/\.png$/, ''), source: 'ghostpixels', url: R2_BASE + key, localPath: file,
    type: 'sprite', theme: ['cooking'], role, orientation: 'n_a',
    description: `${desc} (Ghost Pixels pixel food)`, width: dim.width, height: dim.height,
    tileable: false, pack: 'Ghost Pixels Food',
  });
}

fs.writeFileSync(OUT, JSON.stringify({
  metadata: { source: 'cooking', generatedAt: new Date().toISOString(), totalAssets: assets.length, r2Base: R2_BASE },
  assets,
}, null, 2));

const by = (f) => assets.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`✅ ingested ${assets.length} cooking assets`);
console.log('   roles:', JSON.stringify(by((a) => a.role)));
console.log('   sample raw:', assets.filter((a) => a.role === 'pickup').slice(0, 6).map((a) => a.localPath).join(', '));
console.log('   sample served:', assets.filter((a) => a.role === 'served').slice(0, 6).map((a) => a.localPath).join(', '));
console.log('→', OUT);
