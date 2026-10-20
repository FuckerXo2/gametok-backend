// The money, on the server. A signed-in player's cash, bank and story progress live here, not on
// their phone: every earning and spend the game makes is checked against what's possible before it
// counts. A claim that doesn't fit is refused and the player gets the true balance back.
//
// Rules (₦):
// - spending: anything you can afford
// - story missions: exactly what that mission pays, once, in story order (the finale pays by your choice)
// - a crew member's share of someone else's story mission: up to that mission's pay, every 5 minutes at most
// - businesses: up to the business's safe cap, every 30 minutes at most
// - races ≤ 50,000 (every minute), jobs ≤ 25,000 (every 15 s), bets ≤ 500,000 (every minute)
// - everything else (loot, robbery, selling, Yahoo, cards, kills): together no faster than a bucket of
//   ₦600,000 that refills at ₦120,000 a minute
// - bank: moving cash in and out of the bank, only what's there; paying from it; Yahoo paid into it (the bucket)
//
// Wallets are kept in one JSON file (WALLETS_FILE) for now; at launch this moves to the GameTok
// database so it survives server restarts and many server instances.
import fs from 'node:fs';
import path from 'node:path';

const STORY_PAY = [[5000, 8000, 25000], [12000, 20000, 30000], [15000, 22000, 50000], [20000, 25000, 250000], [20000, 25000, [500000, 3000000]]];
const BIZ_CAP = { park: 90000, office: 250000, club: 400000 };
const LIMITS = { race: [50000, 60], job: [25000, 15], bet: [500000, 60] };
const BUCKET = { cap: 600000, perMin: 120000 };
const START_CAP = 1000000;   // a returning player's saved cash, taken on trust once, up to this

const FILE = process.env.WALLETS_FILE || path.join(process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data'), 'wallets.json');
let wallets = {};
try { wallets = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { wallets = {}; }
let dirty = false;
export function flushWallets() { if (!dirty) return; dirty = false; try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(wallets)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('[economy] save failed', e.message); } }
setInterval(flushWallets, 3000);

const now = () => Date.now() / 1000;
const flags = [];
function flag(id, why, d) { flags.push({ id, why, d, at: new Date().toISOString() }); if (flags.length > 500) flags.shift(); console.warn(`[economy] refused ${id}: ${why}`, JSON.stringify(d)); }

// A player's wallet; the first time we see them, their saved cash (capped) and story progress
export function walletFor(id, saved = {}) {
  let w = wallets[id];
  if (!w) {
    const s = saved.story && typeof saved.story.act === 'number' ? { act: Math.max(0, Math.min(4, saved.story.act | 0)), m: Math.max(0, Math.min(3, saved.story.m | 0)), done: !!saved.story.done } : { act: 0, m: 0, done: false };
    w = wallets[id] = { money: Math.max(0, Math.min(START_CAP, Math.round(+saved.money || 0))), bank: Math.max(0, Math.min(START_CAP, Math.round(+saved.bank || 0))), story: s, last: {}, bucket: BUCKET.cap, bucketAt: now() };
    dirty = true;
  }
  return w;
}

// One money change from the game: { d: amount (+ earn, - spend), why: 'story:1.2' | 'crew:1.2' |
// 'biz:park' | 'race' | 'job' | 'bet' | 'bank' | 'spend' | anything else }. Returns
// { ok, money, bank, story } — the balance after, whether it counted or not.
export function change(id, msg) {
  const w = wallets[id]; if (!w) return null;
  const d = Math.round(+msg.d || 0), why = String(msg.why || '');
  const done = (ok) => { if (ok) dirty = true; return { ok, money: w.money, bank: w.bank, story: w.story }; };
  if (!d) return done(true);
  // the bank: cash in (d < 0) or out (d > 0)
  if (why === 'bank') {
    if (d < 0 && w.money + d >= 0) { w.money += d; w.bank -= d; return done(true); }
    if (d > 0 && w.bank >= d) { w.bank -= d; w.money += d; return done(true); }
    flag(id, 'bank', { d }); return done(false);
  }
  // paying from the bank (part of a big purchase, a loss), or money paid straight into it (Yahoo)
  if (why === 'bankspend') { if (d > 0 || w.bank + d < 0) { flag(id, 'bankspend', { d, bank: w.bank }); return done(false); } w.bank += d; return done(true); }
  if (why.startsWith('bankearn')) {
    w.bucket = Math.min(BUCKET.cap, w.bucket + (now() - w.bucketAt) / 60 * BUCKET.perMin); w.bucketAt = now();
    if (d < 0 || d > w.bucket) { flag(id, 'bankearn', { d }); return done(false); }
    w.bucket -= d; w.bank += d; return done(true);
  }
  // spending
  if (d < 0) { if (w.money + d < 0) { flag(id, 'overspend', { d, money: w.money }); return done(false); } w.money += d; return done(true); }
  const t = now(), since = (k) => t - (w.last[k] || 0);
  // the story, in order, at its price
  let m = /^story:(\d)\.(\d)$/.exec(why);
  if (m) {
    const a = +m[1], i = +m[2], pay = STORY_PAY[a] && STORY_PAY[a][i];
    const okPay = Array.isArray(pay) ? pay.includes(d) : pay === d;
    if (!okPay || w.story.done || w.story.act !== a || w.story.m !== i) { flag(id, 'story', { why, d, at: w.story }); return done(false); }
    w.money += d; w.story.m++;
    if (w.story.m >= 3) { if (a < 4) { w.story.act++; w.story.m = 0; } else w.story.done = true; }
    return done(true);
  }
  m = /^crew:(\d)\.(\d)$/.exec(why);
  if (m) {
    const pay = STORY_PAY[+m[1]] && STORY_PAY[+m[1]][+m[2]], max = Array.isArray(pay) ? Math.max(...pay) : pay;
    if (!max || d > max || since('crew') < 300) { flag(id, 'crew', { why, d }); return done(false); }
    w.money += d; w.last.crew = t; return done(true);
  }
  m = /^biz:(\w+)$/.exec(why);
  if (m) {
    const k = m[1];
    if (!BIZ_CAP[k] || d > BIZ_CAP[k] || since('biz:' + k) < 1800) { flag(id, 'biz', { why, d }); return done(false); }
    w.money += d; w.last['biz:' + k] = t; return done(true);
  }
  if (LIMITS[why]) {
    const [max, every] = LIMITS[why];
    if (d > max || since(why) < every) { flag(id, why, { d }); return done(false); }
    w.money += d; w.last[why] = t; return done(true);
  }
  // everything else: the bucket
  w.bucket = Math.min(BUCKET.cap, w.bucket + (t - w.bucketAt) / 60 * BUCKET.perMin); w.bucketAt = t;
  if (d > w.bucket) { flag(id, 'too fast', { why, d, bucket: Math.round(w.bucket) }); return done(false); }
  w.bucket -= d; w.money += d; return done(true);
}

export const recentFlags = () => flags.slice(-100);
