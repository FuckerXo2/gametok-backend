#!/usr/bin/env node
// Re-tag the existing Phaser CDN catalog with the FIXED word-boundary matcher and normalize each
// entry into the unified catalog schema (source:"phaser"). No source images or R2 creds needed —
// this just re-derives labels from the paths already in phaser-cdn-catalog.json.
//
// Output: src/ai-engine/phaser-catalog-normalized.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractThemes } from '../src/ai-engine/categorize-asset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SRC = path.join(repoRoot, 'src', 'ai-engine', 'phaser-cdn-catalog.json');
const OUT = path.join(repoRoot, 'src', 'ai-engine', 'phaser-catalog-normalized.json');
const R2_BASE = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Same role heuristic as the Kenney ingest, applied to the phaser path.
function roleFor(p) {
  const s = p.toLowerCase();
  if (/\b(car|cars|vehicle|tank|racer|ship|boat|plane|jet)\b/.test(s)) return 'vehicle';
  if (/\b(road|asphalt|dirt|grass|sand|tile|tiles|terrain|ground|floor|water|track)\b/.test(s)) return 'ground';
  if (/\b(coin|gem|star|key|heart|diamond|fruit|pickup|powerup|potion|treasure)\b/.test(s)) return 'pickup';
  if (/\b(character|player|hero|zombie|alien|robot|monster|enemy|soldier|adventurer)\b/.test(s)) return 'character';
  if (/\b(bullet|laser|missile|projectile|arrow)\b/.test(s)) return 'projectile';
  if (/\b(object|prop|rock|tree|barrel|cone|crate|box|fence|barrier|obstacle)\b/.test(s)) return 'obstacle';
  if (/\b(ui|button|panel|icon|hud|cursor|crosshair)\b/.test(s)) return 'ui';
  if (/\b(background|sky|bg)\b/.test(s)) return 'background';
  if (/\b(music|bgm|sfx|sound|audio)\b/.test(s)) return 'audio';
  return 'prop';
}
const typeFor = (a) => {
  if (['audio'].includes(a.type) || /\.(mp3|wav|ogg)$/i.test(a.path)) return 'audio';
  if (a.type === 'spritesheet' || /atlas|spritesheet/i.test(a.path)) return 'spritesheet';
  return 'sprite';
};

let flipped = 0;
const assets = raw.assets.map((a) => {
  const name = path.basename(a.path).replace(/\.[^.]+$/, '').toLowerCase();
  const newThemes = extractThemes(a.path.toLowerCase(), name);
  if (JSON.stringify(newThemes) !== JSON.stringify(a.themes)) flipped += 1;
  const role = roleFor(a.path);
  return {
    id: `phaser/${a.path.replace(/\.[^.]+$/, '')}`,
    source: 'phaser',
    url: R2_BASE + a.path,
    localPath: a.path,
    type: typeFor(a),
    theme: newThemes,
    role,
    orientation: 'unknown',          // phaser art un-vision-checked; unknown, not asserted
    description: `${name.replace(/[_-]+/g, ' ')} — ${role} (phaser cdn)`,
    width: a.dimensions?.width ?? null,
    height: a.dimensions?.height ?? null,
    tileable: false,
    pack: 'phaser-cdn',
  };
});

fs.writeFileSync(OUT, JSON.stringify({
  metadata: { source: 'phaser', generatedAt: new Date().toISOString(), totalAssets: assets.length, retaggedFrom: 'phaser-cdn-catalog.json', r2Base: R2_BASE },
  assets,
}, null, 2));

const by = (f) => assets.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join('  ');
const realRacing = assets.filter((a) => a.theme.includes('racing'));
console.log(`✅ retagged ${assets.length} phaser assets (${flipped} themes changed by the fix)`);
console.log('THEMES ', top(by((a) => a.theme[0])));
console.log(`racing bucket: ${realRacing.length} (was 61 of garbage) →`, realRacing.slice(0, 8).map((a) => a.localPath).join(', '));
console.log('→', OUT);
