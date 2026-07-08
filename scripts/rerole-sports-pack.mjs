#!/usr/bin/env node
/**
 * Re-role the Sports Pack in kenney2d-catalog.json.
 * The whole pack was ingested as role:'prop', so a sports game got 187 undifferentiated
 * props and empty character/pickup roles. Fix by folder:
 *   Blue|Green|Red|White|Special  -> character (top-down team players)
 *   Equipment/ball_*               -> pickup    (the ball you play/score with)
 *   Equipment (bats/rackets/etc.)  -> prop      (held equipment, unchanged)
 *   Elements (goals/nets/lines)    -> prop      (field infrastructure, unchanged)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'src', 'ai-engine', 'kenney2d-catalog.json');

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const CHAR_FOLDERS = /Sports Pack\/PNG\/(Blue|Green|Red|White|Special)\//;
const BALL = /Sports Pack\/PNG\/Equipment\/ball_/i;

let toChar = 0, toPickup = 0;
for (const a of data.assets) {
  if ((a.pack || '') !== 'Sports Pack') continue;
  const lp = a.localPath || '';
  if (CHAR_FOLDERS.test(lp)) { a.role = 'character'; toChar++; }
  else if (BALL.test(lp)) { a.role = 'pickup'; toPickup++; }
  // else: Equipment non-ball + Elements stay 'prop'
}

fs.writeFileSync(CATALOG, JSON.stringify(data));
console.log(`✅ Sports Pack re-roled: ${toChar} -> character, ${toPickup} -> pickup (rest stay prop)`);
