// GTA Lagos online: one small server, no dependencies (WebSockets by hand on Node's http).
//
// Everyone shares the map, but each player only hears about players within INTEREST metres
// (a grid of cells makes "who's near me" cheap), which is what lets a district hold thousands.
// It relays: positions (10 a second), chat said out loud (heard within SAY metres), direct texts
// between connections, connection requests, and the WebRTC handshake for proximity voice (the
// voice itself goes player to player, not through here). Nothing is stored: connections live
// on each player's device.
//
//   node server/server.mjs [port=8951]
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { walletFor, change, recentFlags, flushWallets } from './economy.mjs';
import { filterText, mayTalk, remember, report, recentReports, banned, ban, unban, banList } from './safety.mjs';

const PORT = +process.env.PORT || +process.argv[2] || 8951;   // (Cloud Run says which port in PORT)
const INTEREST = 300, SAY = 60, CELL = 300, TICK = 100;

// ---------------------------------------------------------------- WebSocket plumbing
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
  socket.setNoDelay(true);
  return socket;
}
function frame(text) {
  const data = Buffer.from(text), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, data]);
}
// Reads client frames (always masked); calls onText for each text message
function reader(onText, onClose) {
  let buf = Buffer.alloc(0), parts = [];
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { onClose(); return; }                       // nothing we send is that big
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); data = Buffer.from(data.map((b, i) => b ^ m[i & 3])); }
      buf = buf.subarray(need);
      if (op === 0x8) { onClose(); return; }
      if (op === 0x9 || op === 0xa) continue;                          // ping/pong
      parts.push(data);
      if (fin) { const msg = Buffer.concat(parts).toString('utf8'); parts = []; onText(msg); }
    }
  };
}

// ---------------------------------------------------------------- the players
const players = new Map();        // id -> { id, name, recipe, socket, s: state, cell, known: Set }
const grid = new Map();           // "cx,cz" -> Set of players
const cellKey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
function place(p) {
  const k = cellKey(p.s.x, p.s.z);
  if (k === p.cell) return;
  if (p.cell && grid.has(p.cell)) grid.get(p.cell).delete(p);
  if (!grid.has(k)) grid.set(k, new Set());
  grid.get(k).add(p); p.cell = k;
}
function near(p, radius) {
  const out = [], cx = Math.floor(p.s.x / CELL), cz = Math.floor(p.s.z / CELL), r = Math.ceil(radius / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const set = grid.get((cx + i) + ',' + (cz + j)); if (!set) continue;
    for (const o of set) if (o !== p && o.s && Math.hypot(o.s.x - p.s.x, o.s.z - p.s.z) < radius) out.push(o);
  }
  return out;
}
const send = (p, msg) => { if (!p.socket.destroyed) p.socket.write(frame(JSON.stringify(msg))); };
const clean = (t, n = 200) => String(t || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// Open jobs (story missions others can join): host id -> { id, host, name, title, act, crew, max, x, z }.
// Everyone online hears the whole list whenever it changes.
const jobs = new Map();
function jobList() { return [...jobs.values()]; }
function broadcastJobs() { const msg = frame(JSON.stringify({ t: 'jobs', l: jobList() })); for (const o of players.values()) if (!o.socket.destroyed) o.socket.write(msg); }

// Who's playing: a GameTok player session, checked with the GameTok backend using our developer
// key (GAMETOK_API_KEY, never sent to players). With no key set (local testing) players are
// taken at their word, as before.
const GT_API = process.env.GAMETOK_API_URL || 'https://gametok-backend-267787411422.us-central1.run.app/api';
const GT_KEY = process.env.GAMETOK_API_KEY || '';
async function verifySession(session) {
  if (!GT_KEY) return { dev: true };
  if (!session) return null;
  try {
    const r = await fetch(GT_API + '/developer/sessions/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': GT_KEY }, body: JSON.stringify({ session }) });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.valid ? d.player : null;
  } catch (e) { return null; }
}
// someone either of you blocked: no chat, texts, requests or voice between you (you still see them in the street)
const blocks = (a, b) => (a.blocked && a.blocked.has(b.id)) || (b.blocked && b.blocked.has(a.id));
function join(p, m) {
  const id = /^[a-z0-9]{8,32}$/.test(m.id || '') ? m.id : crypto.randomBytes(8).toString('hex');
  const b = banned(id); if (b) { send(p, { t: 'denied', why: `You don't have access to GTA Lagos online (${b.why}).`, banned: true }); p.socket.end(); return false; }
  p.blocked = new Set((Array.isArray(m.blocked) ? m.blocked : []).slice(0, 300).map((q) => clean(q, 40)));
  const old = players.get(id); if (old && old !== p) old.socket.destroy();   // the same player opening a second tab
  p.id = id; p.name = clean(m.name, 16) || 'Stranger'; p.recipe = m.recipe && typeof m.recipe === 'object' ? m.recipe : null;
  players.set(id, p);
  send(p, { t: 'welcome', id, online: players.size, guest: !!p.guest });
  send(p, { t: 'jobs', l: jobList() });
}

function handle(p, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  switch (m.t) {
    case 'hello': {
      if (p.joining || p.id) break;
      p.joining = true;
      verifySession(String(m.session || '')).then((gt) => {
        if (p.socket.destroyed) return;
        if (!gt) { send(p, { t: 'denied', why: 'Sign in to GameTok to play online.' }); p.socket.end(); return; }
        // signed in: your GameTok player id and name for this game, not what the page claims
        if (!gt.dev) { m.id = 'gt' + String(gt.id).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 28); p.guest = !!gt.guest; m.name = p.guest ? 'Guest ' + m.id.slice(-4) : gt.name; }   // (guests: told apart by the end of their id)
        if (join(p, m) === false) return;
        // the money lives here for signed-in players (and for everyone when testing with ECONOMY=1)
        p.econ = !gt.dev || process.env.ECONOMY === '1';
        if (p.econ) { const w = walletFor(p.id, m.saved || {}); send(p, { t: 'wallet', ok: true, money: w.money, bank: w.bank, story: w.story, first: true }); }
      });
      break;
    }
    case 'cash': {   // a money change from the game: checked, then the true balance goes back
      if (!p.id || !p.econ) break;
      const r = change(p.id, m); if (r) send(p, { t: 'wallet', seq: m.seq, ...r });
      break;
    }
    case 's': if (p.id) {
      // how fast you're moving: faster than anything in the game can go is noted for review
      // (teleports the game makes itself, entering a building or joining a crew, aren't counted)
      if (p.s && m.in === p.s.in) { const dt = (Date.now() - (p.sAt || 0)) / 1000, v = Math.hypot((+m.x || 0) - p.s.x, (+m.z || 0) - p.s.z) / Math.max(dt, 0.05); if (dt < 1 && v > 95) { p.fast = (p.fast || 0) + 1; if (p.fast === 20) console.warn(`[speed] ${p.id} ${p.name}: ${Math.round(v)} m/s, repeatedly`); } else if (v < 60) p.fast = 0; }
      p.sAt = Date.now(); p.s = { x: +m.x || 0, y: +m.y || 0, z: +m.z || 0, h: +m.h || 0, m: clean(m.m, 10), k: clean(m.k, 10), a: clean(m.a, 16), in: clean(m.in, 32), g: m.g ? 1 : 0 }; place(p); } break;
    case 'look': if (p.id) { p.name = clean(m.name, 16) || p.name; p.recipe = m.recipe; p.known.clear(); for (const o of players.values()) o.known.delete(p.id); } break;   // changed clothes: everyone re-meets you
    case 'say': {
      if (!p.s) break;
      let text = clean(m.text); if (!text) break;
      if (!mayTalk(p)) { send(p, { t: 'note', text: 'You dey talk too fast. Wait small.' }); break; }
      remember(p, text); text = filterText(text);   // (the report keeps what they really typed)
      const msg = { t: 'say', from: p.id, name: p.name, text };
      send(p, msg); near(p, SAY).forEach((o) => { if (o.s.in === p.s.in && !blocks(p, o)) send(o, msg); });
      break;
    }
    case 'find': {   // an invite link: where is the friend who sent it (if they're playing)
      if (!p.id || typeof m.pid !== 'string') break;
      const o = players.get(m.pid);
      send(p, o && o.s && !blocks(p, o) ? { t: 'found', pid: o.id, name: o.name, x: o.s.x, z: o.s.z, inside: !!o.s.in } : { t: 'found', pid: m.pid, gone: true });
      break;
    }
    case 'block': {   // stop (or start again) hearing from someone
      if (!p.id || typeof m.pid !== 'string') break;
      if (m.on === false) p.blocked.delete(m.pid); else if (p.blocked.size < 300) p.blocked.add(clean(m.pid, 40));
      break;
    }
    case 'report': {   // someone broke the rules: what they said lately goes with it
      if (!p.id || typeof m.pid !== 'string' || Date.now() - (p.reportedAt || 0) < 15000) break;
      p.reportedAt = Date.now();
      report(p, players.get(m.pid) || { id: clean(m.pid, 40), name: clean(m.name, 16) || '?' }, clean(m.why, 30));
      break;
    }
    case 'ev': {   // a game event (a race starting, a shot landing) for the players near you
      if (!p.s || typeof m.e !== 'string') break;
      const d = JSON.stringify(m.d === undefined ? null : m.d); if (d.length > 8000) break;
      const msg = { t: 'ev', from: p.id, name: p.name, e: clean(m.e, 16), d: m.d };
      near(p, Math.min(5000, Math.max(10, +m.r || 150))).forEach((o) => { if (o.s.in === p.s.in) send(o, msg); });
      break;
    }
    case 'job': {   // the host's mission: posted, updated (crew, where), or closed (open: false)
      if (!p.id) break;
      if (!m.open) { if (jobs.delete(p.id)) broadcastJobs(); break; }
      jobs.set(p.id, { id: p.id, host: p.id, name: p.name, title: clean(m.title, 40), act: clean(m.act, 30), crew: (Array.isArray(m.crew) ? m.crew : []).slice(0, 3).map((c) => clean(c, 32)), max: 4, x: +m.x || 0, z: +m.z || 0 });
      broadcastJobs();
      break;
    }
    case 'ads': {   // seconds each billboard ad was on someone's screen (what advertisers pay for)
      if (!p.id || !m.s || typeof m.s !== 'object') break;
      Object.entries(m.s).slice(0, 40).forEach(([id, sec]) => { const k = clean(id, 40), v = Math.min(120, Math.max(0, +sec || 0)); if (!k || !v) return; const a = adStats[k] || (adStats[k] = { seconds: 0, views: 0 }); a.seconds += v; a.views++; adsDirty = true; });
      break;
    }
    case 'x': {   // a crew message, straight to the crew (wherever they are in the city)
      if (!p.id || typeof m.e !== 'string') break;
      const d = JSON.stringify(m.d === undefined ? null : m.d); if (d.length > 12000) break;
      const msg = { t: 'x', from: p.id, name: p.name, e: clean(m.e, 16), d: m.d };
      (Array.isArray(m.to) ? m.to : [m.to]).slice(0, 4).forEach((pid) => { const to = players.get(pid); if (to) send(to, msg); });
      break;
    }
    case 'dm': case 'add': case 'accept': case 'rtc': case 'talk': {
      const to = players.get(m.to);
      if (to && blocks(p, to)) break;
      if (m.t === 'dm' && !mayTalk(p)) { send(p, { t: 'note', text: 'You dey text too fast. Wait small.' }); break; }
      if (!to) { if (m.t !== 'rtc' && m.t !== 'talk') send(p, { t: 'offline', to: m.to, what: m.t }); break; }
      const out = { t: m.t, from: p.id, name: p.name };
      if (m.t === 'dm') { remember(p, '(text) ' + clean(m.text)); out.text = filterText(clean(m.text)); }
      if (m.t === 'rtc') out.data = m.data;
      if (m.t === 'talk') out.on = !!m.on;
      send(to, out);
      break;
    }
  }
}

// Ten times a second: each player hears where the players near them are (and meets new ones).
// Mobile data is money in Lagos, so: the 12 nearest every tick, the rest of the crowd 3 times a
// second (beyond 120 m twice), nobody who hasn't moved, and positions to 10 cm.
let tickN = 0;
const row = (o) => {
  if (o.rowAt !== tickN) { o.rowAt = tickN; o.row = [o.id, +o.s.x.toFixed(1), +o.s.y.toFixed(1), +o.s.z.toFixed(1), +o.s.h.toFixed(2), o.s.m, o.s.k, o.s.a, o.s.g]; o.rowKey = o.row.join(); }
  return o.row;
};
setInterval(() => {
  tickN++;
  for (const p of players.values()) {
    if (!p.s) continue;
    // inside a building you only see who's in there with you; in a crowd, only the nearest 40 (no one's phone needs 400 at once)
    const list = near(p, INTEREST).filter((o) => o.s.in === p.s.in).sort((a, b) => Math.hypot(a.s.x - p.s.x, a.s.z - p.s.z) - Math.hypot(b.s.x - p.s.x, b.s.z - p.s.z)).slice(0, 40);
    const now = new Set(list.map((o) => o.id));
    for (const o of list) if (!p.known.has(o.id)) { p.known.add(o.id); if (p.sent) p.sent.delete(o.id); send(p, { t: 'meet', id: o.id, name: o.name, recipe: o.recipe }); }   // (met again: where they are goes again, moving or not)
    for (const id of p.known) if (!now.has(id)) { p.known.delete(id); send(p, { t: 'gone', id }); }
    p.sent = p.sent || new Map(); const sent = p.sent, out = [];
    list.forEach((o, i) => {
      const every = !p.sent.has(o.id) ? 1 : i < 12 ? 1 : Math.hypot(o.s.x - p.s.x, o.s.z - p.s.z) < 120 ? 3 : 5;
      if ((tickN + o.id.charCodeAt(o.id.length - 1)) % every) return;   // (staggered, so the crowd doesn't all arrive on one tick)
      const r = row(o); if (sent.get(o.id) === o.rowKey) return;
      sent.set(o.id, o.rowKey); out.push(r);
    });
    for (const id of sent.keys()) if (!now.has(id)) sent.delete(id);
    if (out.length) send(p, { t: 'p', l: out });
  }
}, TICK);

// Every few seconds: how many people are playing right now (everyone sees the total)
setInterval(() => { const msg = frame(JSON.stringify({ t: 'count', n: players.size })); for (const p of players.values()) if (!p.socket.destroyed) p.socket.write(msg); }, 5000);

// Billboard ads: seconds on screen per ad, kept in a file (ADS_FILE) and shown at /ads?key=ADMIN_KEY
const ADS_FILE = process.env.ADS_FILE || path.join(process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data'), 'ads.json');
let adStats = {}, adsDirty = false;
try { adStats = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8')); } catch (e) { adStats = {}; }
function flushAds() { if (!adsDirty) return; adsDirty = false; try { fs.mkdirSync(path.dirname(ADS_FILE), { recursive: true }); fs.writeFileSync(ADS_FILE + '.tmp', JSON.stringify(adStats)); fs.renameSync(ADS_FILE + '.tmp', ADS_FILE); } catch (e) { console.error('[ads] save failed', e.message); } }
setInterval(flushAds, 10000);

const server = http.createServer((req, res) => {
  // reports, bans (ADMIN_KEY): /reports, /bans, /ban?id=…&why=…, /unban?id=…
  if (/^\/(reports|bans|ban|unban)\b/.test(req.url)) {
    const u = new URL(req.url, 'http://x'), ok = process.env.ADMIN_KEY && u.searchParams.get('key') === process.env.ADMIN_KEY;
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); if (!ok) { res.end('{}'); return; }
    const id = clean(u.searchParams.get('id'), 40);
    if (u.pathname === '/ban' && id) { ban(id, u.searchParams.get('why')); const o = players.get(id); if (o) { send(o, { t: 'denied', why: 'You have been removed from GTA Lagos online.', banned: true }); o.socket.end(); } }
    if (u.pathname === '/unban' && id) unban(id);
    res.end(JSON.stringify(u.pathname === '/reports' ? recentReports() : banList(), null, 1)); return;
  }
  if (req.url.startsWith('/ads')) { const ok = process.env.ADMIN_KEY && new URL(req.url, 'http://x').searchParams.get('key') === process.env.ADMIN_KEY; res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); res.end(ok ? JSON.stringify(adStats, null, 1) : '{}'); return; }
  // money claims the server refused, for us to review (ADMIN_KEY)
  if (req.url.startsWith('/flags')) { const ok = process.env.ADMIN_KEY && new URL(req.url, 'http://x').searchParams.get('key') === process.env.ADMIN_KEY; res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); res.end(ok ? JSON.stringify(recentFlags(), null, 1) : '{}'); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(`GTA Lagos online · ${players.size} playing\n`); });
server.on('upgrade', (req, socket) => {
  if (!accept(req, socket)) return;
  const p = { id: null, name: '', recipe: null, socket, s: null, cell: null, known: new Set() };
  const bye = () => {
    if (p.cell && grid.has(p.cell)) grid.get(p.cell).delete(p);
    if (p.id && players.get(p.id) === p) players.delete(p.id);
    if (p.id && jobs.delete(p.id)) broadcastJobs();   // a host who leaves takes the job with them
    for (const o of players.values()) if (o.known.delete(p.id)) send(o, { t: 'gone', id: p.id });
    socket.destroy();
  };
  socket.on('data', reader((t) => handle(p, t), bye));
  socket.on('close', bye); socket.on('error', bye);
});
server.listen(PORT, () => console.log(`GTA Lagos online on ws://localhost:${PORT}`));
// shutting down (a new version going up): the money and the ad counts are written first
process.on('SIGTERM', () => { flushWallets(); flushAds(); process.exit(0); });
