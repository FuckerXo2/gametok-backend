// (A copy of GTA Lagos's server/safety.mjs: No Rules FC uses the filter for names and the bans.)
// Keeping the streets civil: chat is filtered (insults and slurs starred out, links and phone
// numbers removed: the scams), nobody can flood it, anyone can block or report anyone, and we can
// ban a player for good. Reports and bans are kept in files (REPORTS_FILE, BANS_FILE) and seen at
// /reports and changed at /ban, /unban (ADMIN_KEY).
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');   // outside server/ (--watch)
const REPORTS_FILE = process.env.REPORTS_FILE || path.join(DIR, 'reports.json');
const BANS_FILE = process.env.BANS_FILE || path.join(DIR, 'bans.json');
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const save = (f, v) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); } catch (e) { console.error('[safety] save failed', f, e.message); } };

// ---- the filter. Whole words (and the usual spellings round it: f*ck, sh1t, fuuuck).
// Banter stays (mumu, olodo, werey): it's Lagos. Slurs, sexual insults and the worst curses go.
const WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bitch', 'bastard', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'asshole',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'rape', 'rapist', 'porn', 'nude', 'nudes',
  'ashawo', 'olosho', 'oloshi', 'dindinrin', 'ode buruku', 'pafuka', 'kerewa', 'gbola', 'didirin',
  'your mama', 'ur mama', 'your papa',
];
const leet = { a: '[a4@*]', e: '[e3*]', i: '[i1!*]', o: '[o0*]', s: '[s5$*]', u: '[uv*]', t: '[t7]', g: '[g9]' };
const pattern = (w) => w.split('').map((c) => (c === ' ' ? '\\s+' : (leet[c] || c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + '+')).join('');
const BAD = new RegExp(`(^|[^a-z0-9])(${WORDS.map(pattern).join('|')})(?=$|[^a-z0-9])`, 'gi');
const LINK = /\b((https?:\/\/|www\.)\S+|\S+\.(com|ng|net|org|io|co|xyz|link|me|ly)(\/\S*)?)\b/gi;
const PHONE = /(\+?\d[\d\s-]{8,}\d)/g;   // phone and account numbers
export function filterText(text) {
  return String(text)
    .replace(LINK, '[link]')
    .replace(PHONE, '[number]')
    .replace(BAD, (m, pre, w) => pre + w[0] + '*'.repeat(Math.max(2, w.length - 1)));
}

// ---- flooding: 5 lines in 10 s, then a minute of quiet (longer each time)
export function mayTalk(p) {
  const t = Date.now();
  if (p.mutedUntil > t) return false;
  p.lines = (p.lines || []).filter((q) => t - q < 10000); p.lines.push(t);
  if (p.lines.length > 5) { p.strikes = (p.strikes || 0) + 1; p.mutedUntil = t + 60000 * p.strikes; return false; }
  return true;
}
// what each player said lately: goes with a report so we can see what happened
export function remember(p, text) { (p.said || (p.said = [])).push([new Date().toISOString().slice(11, 19), text]); if (p.said.length > 20) p.said.shift(); }

// ---- reports
const reports = load(REPORTS_FILE, []);
export function report(from, target, why) {
  const r = { at: new Date().toISOString(), from: { id: from.id, name: from.name }, target: { id: target.id, name: target.name }, why: String(why || '').slice(0, 30), said: (target.said || []).slice(-12) };
  reports.push(r); if (reports.length > 2000) reports.shift();
  save(REPORTS_FILE, reports);
  console.warn(`[report] ${from.name} (${from.id}) -> ${target.name} (${target.id}): ${r.why}`);
}
export const recentReports = () => reports.slice(-200).reverse();

// ---- bans (by player id: the GameTok account, not the device)
const bans = load(BANS_FILE, {});
export const banned = (id) => bans[id] || null;
export function ban(id, why) { bans[id] = { why: String(why || 'Breaking the rules').slice(0, 80), at: new Date().toISOString() }; save(BANS_FILE, bans); }
export function unban(id) { delete bans[id]; save(BANS_FILE, bans); }
export const banList = () => bans;
