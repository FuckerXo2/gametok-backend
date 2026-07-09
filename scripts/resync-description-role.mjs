#!/usr/bin/env node
/**
 * Fix role/description desync: the bulk rerole-batch{N}.mjs scripts (today's 76-pack pass) set
 * `a.role = 'character'` etc but never touched `a.description`, which still says "— prop (Pack)"
 * from the original ingest. This is a real bug, not cosmetic: the description TEXT is what gets
 * embedded (both pack- and item-level) AND what the blind generator model directly reads in its
 * prompt — so even when role-based filtering correctly finds the right item, the model sees "prop"
 * on a character sprite and can reason it's decoration. Confirmed measurable: a Sports Pack
 * character scored 0.587 against "player character" with the stale "prop" text; description holds
 * real embedding weight, not just cosmetic labeling.
 *
 * Fix: for every asset where the description's role-word segment ("— X (Pack)" or "— X,
 * orientation (Pack)") disagrees with the current a.role field, rewrite just that word in place.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

const VALID_ROLES = new Set(['character', 'vehicle', 'ground', 'obstacle', 'pickup', 'projectile', 'background', 'prop', 'ui', 'served']);
const ROLE_WORD_RE = /(—\s*)([a-z]+)(\s*[,(])/i;

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let fixed = 0;
const byPack = {};
for (const a of data.assets) {
  const desc = String(a.description || '');
  const m = desc.match(ROLE_WORD_RE);
  if (!m) continue;
  const descRole = m[2].toLowerCase();
  if (!VALID_ROLES.has(descRole) || descRole === a.role) continue;
  a.description = desc.replace(ROLE_WORD_RE, `$1${a.role}$3`);
  fixed++;
  byPack[a.pack] = (byPack[a.pack] || 0) + 1;
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
console.log(`✅ Resynced ${fixed} descriptions to match their current role`);
console.log('Top packs affected:');
Object.entries(byPack).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, c]) => console.log(`  ${p}: ${c}`));
