#!/usr/bin/env node
/**
 * Sports Pack "Elements" (81 items) were 100% generic `element (N)` — a field-marking kit
 * (court lines, basketball hoop+backboard, goal posts, net-mesh panels, corner flags, direction
 * arrows) with zero readable labels. A blind model couldn't tell a hoop from a line segment, so
 * basketball/soccer/tennis games shipped with balls + players but no hoop/goal/net — an empty
 * court. Identified via a numbered contact-sheet montage (Claude read all 81 directly).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

// idx -> description. Only the clearly-identifiable, high-value single-placeable pieces are named;
// plain line/corner segments (not listed) stay generic prop — still usable as court borders, just
// lower value to call out individually.
const LABELS = {
  26: 'backboard block (grey)', 27: 'goal block (grey)',
  37: 'corner flag post (white)', 38: 'corner flag post (white)', 39: 'corner flag post with ball',
  40: 'corner flag post with ball',
  43: 'net mesh panel', 44: 'net mesh panel', 45: 'net mesh panel', 46: 'net mesh panel',
  51: 'net mesh panel', 52: 'net mesh panel', 53: 'net mesh panel', 54: 'net mesh panel', 55: 'net mesh panel',
  56: 'direction arrow marker (grey)', 57: 'direction arrow marker (grey)', 58: 'direction arrow marker (grey)',
  59: 'direction arrow marker (grey)', 60: 'direction arrow marker (grey)',
  64: 'basketball hoop and backboard (orange rim)', 65: 'basketball hoop and backboard (orange rim)',
  66: 'basketball hoop and backboard (orange rim)', 67: 'basketball hoop rim (white)',
  68: 'basketball hoop rim (white)', 69: 'basketball hoop rim (white)',
  73: 'basketball hoop and backboard (orange rim)', 74: 'basketball hoop and backboard (orange rim)',
  75: 'basketball hoop and backboard (orange rim)', 76: 'basketball hoop and backboard (orange rim)',
  78: 'goalkeeper glove/mitt (blue)', 79: 'goal post flag (blue)', 80: 'goal post flag (blue)',
};

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
let n = 0;
for (const a of data.assets) {
  if (a.pack !== 'Sports Pack') continue;
  const m = (a.localPath || '').match(/element[\s-]*\((\d+)\)/i);
  if (!m) continue;
  const idx = Number(m[1]);
  const label = LABELS[idx];
  if (!label) continue;
  a.description = `${label} — prop (Kenney Sports Pack)`;
  n++;
}
fs.writeFileSync(CATALOG, JSON.stringify(data));
console.log(`Sports Pack Elements: ${n} labeled (hoops/goals/flags/nets/arrows)`);
