// No Rules FC online: the authority. One process serves the game files, runs every match, and
// keeps the social side: accounts (name#tag), friends, parties, invites, matchmaking, private
// matches and the WebRTC handshake for party voice chat (the voice itself goes player to player).
// Each room is one js/sim.js match at 60 Hz with 10 slots; humans take bots' slots and give them
// back when they leave. Clients send their inputs (one per tick, numbered) and actions; the room
// sends everyone a snapshot 20 times a second, with the last input of theirs it used (so each
// client can replay what the server hasn't seen yet). No dependencies (WebSockets by hand).
//
//   node server/server.mjs [port=8970]
// Live (Cloud Run, gametok-backend services/nrfc-online): PORT, DATA_DIR (a mounted bucket),
// GAMETOK_API_KEY (verifies GameTok player sessions), ADMIN_KEY (/stats, /ban, /unban).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterText, banned, ban, unban, banList } from './safety.mjs';
import { createSim, step, act, snapshot, roster, CHARS, HEROES, DT, MATCH, ARENAS } from '../js/sim.js';

const PORT = +process.argv[2] || +process.env.PORT || 8970;
const LIVE = process.env.NODE_ENV === 'production';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEND_EVERY = 3;                       // 60 Hz sim / 3 = 20 snapshots a second

// ── WebSocket plumbing (same as gta-lagos/server) ───────────────────────────────────────────
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
      if (len > 1 << 16) { onClose(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); data = Buffer.from(data.map((b, i) => b ^ m[i & 3])); }
      buf = buf.subarray(need);
      if (op === 0x8) { onClose(); return; }
      if (op === 0x9 || op === 0xa) continue;
      parts.push(data);
      if (fin) { const msg = Buffer.concat(parts).toString('utf8'); parts = []; onText(msg); }
    }
  };
}
const send = (c, msg) => { if (!c.socket.destroyed) c.socket.write(Buffer.isBuffer(msg) ? msg : frame(JSON.stringify(msg))); };
const clean = (t, n) => String(t || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

// ── Rooms ────────────────────────────────────────────────────────────────────────────────────
const rooms = new Map();                     // name -> { name, sim, clients: Set, tick }
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) { r = { name, sim: createSim(), clients: new Set(), tick: 0 }; rooms.set(name, r); }
  return r;
}
function broadcast(r, msg) { const f = frame(JSON.stringify(msg)); for (const c of r.clients) send(c, f); }

function join(c, m) {
  let base = clean(m.room, 24).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'public', name = base;
  if (!m.exact) for (let n = 2; getRoom(name).clients.size >= 10; n++) name = base + '-' + n;   // full: overflow
  const r = getRoom(name), P = r.sim.players;
  if (r.clients.size >= 10) return send(c, { t: 'toast', text: 'That match is full' });
  const humans = (t) => P.filter((p) => p.human && p.team === t).length;
  let team = m.team === 0 || m.team === 1 ? m.team : humans(0) <= humans(1) ? 0 : 1;
  if (humans(team) >= 5) team = 1 - team;
  const want = m.gk ? 'gk' : 'out';
  const free = P.filter((p) => p.team === team && !p.human);
  const slot = free.find((p) => p.role === want) || free.find((p) => p.role === 'out') || free[0];
  slot.human = true; slot.bot = false; slot.name = clean(m.name, 14) || 'Player';
  slot.char = CHARS.includes(m.char) && (!c.acct || owns(c.acct, m.char)) ? m.char : slot.char;
  slot.inq = []; slot.ack = 0; slot.input = { mx: 0, mz: 0, sprint: false, jump: false };
  c.room = r; c.slot = slot;
  r.clients.add(c);
  send(c, { t: 'w', you: slot.id, room: r.name, private: r.name.startsWith('p-') ? r.name.slice(2).toUpperCase() : null });
  setStatus(c, 'match');
  broadcast(r, { t: 'r', l: roster(r.sim) });
  broadcast(r, { t: 'n', text: slot.name + ' joined ' + (team === 0 ? 'HOME' : 'AWAY') });
}

function leave(c) {
  const r = c.room; if (!r) return;
  r.clients.delete(c);
  const p = c.slot;
  if (p) { p.human = false; p.inq = null; broadcast(r, { t: 'n', text: p.name + ' left' }); p.name = 'Bot ' + p.name; }
  c.room = null; c.slot = null;
  if (c.acct) setStatus(c, 'lobby');
  if (!r.clients.size) rooms.delete(r.name); else broadcast(r, { t: 'r', l: roster(r.sim) });
}

// ── Accounts: a name and a 4-digit tag (Abiola#4821), saved to data/accounts.json ──────
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data'); fs.mkdirSync(DATA, { recursive: true });   // locally outside server/ so --watch doesn't restart on every save
const AFILE = path.join(DATA, 'accounts.json');
let accounts = {}; try { accounts = JSON.parse(fs.readFileSync(AFILE, 'utf8')); } catch {}
const byToken = new Map(Object.values(accounts).map((a) => [a.token, a]));
let saveT = null;
const writeNow = () => { try { fs.writeFileSync(AFILE + '.tmp', JSON.stringify(accounts)); fs.renameSync(AFILE + '.tmp', AFILE); } catch (e) { console.error('[accounts] save failed', e.message); } };
const save = () => { clearTimeout(saveT); saveT = setTimeout(writeNow, 400); };
// Cloud Run stops the old instance on every deploy: write everything first
process.on('SIGTERM', () => { clearTimeout(saveT); writeNow(); process.exit(0); });
const byGt = new Map(Object.values(accounts).filter((a) => a.gt).map((a) => [a.gt, a]));
// Who's playing: a GameTok player session (inside GameTok, web or app), checked with the GameTok
// backend using our developer key. Without the key (testing) or outside GameTok, players use the
// game's own account token instead (made on sign-up, kept on their device).
const GT_API = process.env.GAMETOK_API_URL || 'https://gametok-backend-267787411422.us-central1.run.app/api';
const GT_KEY = process.env.GAMETOK_API_KEY || '';
async function verifySession(session) {
  if (!GT_KEY || !session) return null;
  try {
    const r = await fetch(GT_API + '/developer/sessions/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': GT_KEY }, body: JSON.stringify({ session }) });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.valid ? d.player : null;
  } catch { return null; }
}
// names: the chat filter (whole words) plus slurs and swears hidden inside a name (f4ckface, xXniggaXx)
const NAME_BAD = /(fuck|fuk|fck|shit|bitch|cunt|nigg|fag|rape|porn|pussy|whore|slut|retard|nazi|hitler|ashawo|olosho)/;
const deleet = (n) => n.toLowerCase().replace(/0/g, 'o').replace(/1|!/g, 'i').replace(/3/g, 'e').replace(/4|@/g, 'a').replace(/5|\$/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
const okName = (n) => { n = clean(n, 14).replace(/[^A-Za-z0-9_.-]/g, ''); return n && filterText(n) === n && !NAME_BAD.test(deleet(n)) ? n : ''; };
export const STARTERS = ['spiderman', 'baki', 'flash', 'goku'];      // everyone has these; the rest are bought
const owns = (a, ch) => STARTERS.includes(ch) || a.owned.includes(ch);
// coins: earned by playing matches, spent on heroes (prices live in HEROES); XP fills the level bar
const START_COINS = 500, XP_LEVEL = 500;
for (const a of Object.values(accounts)) { a.coins ??= START_COINS; a.xp ??= 0; }
const REWARD = { win: 150, draw: 90, loss: 60 }, GOAL_BONUS = 25;
function buy(c, ch) {
  const a = c.acct, h = HEROES[ch];
  if (!h || !h.ready) return;
  if (owns(a, ch)) return send(c, { t: 'toast', text: `You already have ${h.name}` });
  if (a.coins < h.price) return send(c, { t: 'toast', text: `Not enough coins: ${h.name} costs ${h.price}, you have ${a.coins}` });
  a.coins -= h.price; a.owned.push(ch); a.hero = ch; save();
  send(c, { t: 'bought', char: ch }); sendMe(c); partyUpdate(c.party);
}
function register(name, gt) {
  name = okName(name) || 'Player';
  let tag; do tag = String(1000 + ((Math.random() * 9000) | 0)); while (Object.values(accounts).some((a) => a.name.toLowerCase() === name.toLowerCase() && a.tag === tag));
  const a = { id: crypto.randomBytes(8).toString('hex'), name, tag, token: crypto.randomBytes(24).toString('hex'), friends: [], requests: [], owned: [], hero: 'spiderman', coins: START_COINS, xp: 0, created: Date.now() };
  if (gt) { a.gt = gt; byGt.set(gt, a); }
  accounts[a.id] = a; byToken.set(a.token, a); save(); return a;
}
const online = new Map();                    // account id -> connection
const pub = (a) => ({ id: a.id, name: a.name, tag: a.tag, hero: a.hero, online: online.has(a.id), status: online.get(a.id)?.status || 'offline' });
function sendMe(c) {
  const a = c.acct; if (!a) return;
  send(c, { t: 'me', id: a.id, name: a.name, tag: a.tag, token: a.token, hero: a.hero, coins: a.coins, xp: a.xp, level: 1 + Math.floor(a.xp / XP_LEVEL), xpLevel: XP_LEVEL, owned: [...new Set([...STARTERS, ...a.owned])], starters: STARTERS,
    friends: a.friends.map((id) => accounts[id]).filter(Boolean).map(pub), requests: a.requests.map((id) => accounts[id]).filter(Boolean).map(pub) });
}
function setStatus(c, status) {
  if (!c.acct) return;
  c.status = status;
  for (const fid of c.acct.friends) { const fc = online.get(fid); if (fc) send(fc, { t: 'presence', id: c.acct.id, online: true, status }); }
  if (c.party) partyUpdate(c.party);
}
function attach(c, a) {
  const old = online.get(a.id); if (old && old !== c) { send(old, { t: 'replaced' }); old.socket.destroy(); }
  c.acct = a; online.set(a.id, c); c.status = 'lobby';
  newParty(c);
  sendMe(c); setStatus(c, 'lobby');
}

// ── Friends ──────────────────────────────────────────────────────────────────────────────────
function findAcct(name, tag) { return Object.values(accounts).find((a) => a.name.toLowerCase() === String(name || '').toLowerCase() && a.tag === String(tag || '')); }
function friendAdd(c, m) {
  const me = c.acct, [name, tag] = String(m.who || '').split('#'), them = findAcct(name, tag);
  if (!them) return send(c, { t: 'toast', text: `No player called ${m.who}` });
  if (them.id === me.id) return send(c, { t: 'toast', text: "That's you" });
  if (me.friends.includes(them.id)) return send(c, { t: 'toast', text: `${them.name} is already your friend` });
  if (me.requests.includes(them.id)) return friendAccept(c, { id: them.id });   // they asked you first: friends
  if (!them.requests.includes(me.id)) them.requests.push(me.id);
  save(); send(c, { t: 'toast', text: `Friend request sent to ${them.name}#${them.tag}` });
  const tc = online.get(them.id); if (tc) { sendMe(tc); send(tc, { t: 'toast', text: `${me.name}#${me.tag} wants to be friends` }); }
}
function friendAccept(c, m) {
  const me = c.acct, them = accounts[m.id]; if (!them) return;
  me.requests = me.requests.filter((x) => x !== them.id); them.requests = them.requests.filter((x) => x !== me.id);
  if (!me.friends.includes(them.id)) me.friends.push(them.id);
  if (!them.friends.includes(me.id)) them.friends.push(me.id);
  save(); sendMe(c); const tc = online.get(them.id); if (tc) { sendMe(tc); send(tc, { t: 'toast', text: `${me.name} accepted your friend request` }); }
}
function friendDrop(c, m, decline) {
  const me = c.acct, them = accounts[m.id]; if (!them) return;
  me.requests = me.requests.filter((x) => x !== them.id);
  if (!decline) { me.friends = me.friends.filter((x) => x !== them.id); them.friends = them.friends.filter((x) => x !== me.id); }
  save(); sendMe(c); const tc = online.get(them.id); if (tc) sendMe(tc);
}

// ── Parties: up to 5, always the same team; the leader picks the mode ─────────────────────────
const parties = new Map();
function newParty(c) {
  const p = { id: crypto.randomBytes(5).toString('hex'), leader: c.acct.id, members: [c.acct.id], ready: new Set() };
  parties.set(p.id, p); c.party = p.id; partyUpdate(p.id); return p;
}
function partyUpdate(pid) {
  const p = parties.get(pid); if (!p) return;
  const msg = { t: 'party', id: p.id, leader: p.leader, members: p.members.map((id) => ({ ...pub(accounts[id]), ready: p.ready.has(id) || id === p.leader })) };
  for (const id of p.members) { const mc = online.get(id); if (mc) send(mc, msg); }
}
function leaveParty(c) {
  const p = parties.get(c.party); if (!p) return;
  unqueue(p.id, `${c.acct.name} left the party`);
  p.members = p.members.filter((x) => x !== c.acct.id); p.ready.delete(c.acct.id);
  for (const id of p.members) { const mc = online.get(id); if (mc) send(mc, { t: 'voice_left', id: c.acct.id }); }
  if (!p.members.length) parties.delete(p.id);
  else { if (p.leader === c.acct.id) p.leader = p.members[0]; partyUpdate(p.id); }
  c.party = null;
}
function joinParty(c, pid) {
  const p = parties.get(pid);
  if (!p) return send(c, { t: 'toast', text: 'That party has gone' });
  if (p.members.includes(c.acct.id)) return;
  if (p.members.length >= 5) return send(c, { t: 'toast', text: 'That party is full' });
  unqueue(p.id, `${c.acct.name} joined: search again`);
  leaveParty(c); p.members.push(c.acct.id); c.party = p.id; partyUpdate(p.id);
}
// the leader presses play: everyone in the party into one match, on one team
// ── Matchmaking: parties queue up and are packed into two teams (a party never splits). A full
// 10 starts at once; otherwise the search widens with time, and bots fill whatever is left.
const queue = [];                            // { pid, since }
const MM = {
  REAL: 10,        // s: start once both teams have at least one human
  MAX: 25,         // s: start with whoever was found, bots fill the rest
  ALONE: 4,        // s: nobody else is online in the lobby: don't make them wait for no one
  BACKFILL: 60,    // s: a running quick match can take a party into its bot spots during its first minute
};
const partyConns = (p) => p.members.map((id) => online.get(id)).filter((mc) => mc && !mc.room);
const partyMsg = (p, msg) => { for (const id of p.members) { const mc = online.get(id); if (mc) send(mc, msg); } };
function enqueue(p) {
  if (queue.some((q) => q.pid === p.id)) return;
  queue.push({ pid: p.id, since: Date.now() }); mmTick();
}
function unqueue(pid, why) {
  const i = queue.findIndex((q) => q.pid === pid); if (i < 0) return;
  queue.splice(i, 1);
  const p = parties.get(pid); if (p) partyMsg(p, { t: 'mm', on: false, why });
}
const humansOn = (r, t) => r.sim.players.filter((x) => x.human && x.team === t).length;
function startParty(p, room, team) {
  for (const mc of partyConns(p)) join(mc, { room, exact: true, team, name: mc.acct.name + '#' + mc.acct.tag, char: mc.acct.hero });
  partyMsg(p, { t: 'mm', on: false }); p.ready.clear(); partyUpdate(p.id);
}
function mmTick() {
  const now = Date.now();
  for (const q of [...queue]) { const p = parties.get(q.pid); if (!p || !partyConns(p).length) unqueue(q.pid); }
  queue.sort((a, b) => a.since - b.since);
  // 1. drop parties into the bot spots of a quick match that's only just started
  for (const q of [...queue]) {
    const p = parties.get(q.pid), n = partyConns(p).length;
    for (const r of rooms.values()) {
      if (!r.name.startsWith('q-') || r.sim.phase === 'end' || r.sim.overtime || MATCH - r.sim.clock > MM.BACKFILL) continue;
      const t = [0, 1].sort((a, b) => humansOn(r, a) - humansOn(r, b)).find((tt) => humansOn(r, tt) + n <= 5);
      if (t !== undefined && humansOn(r, 0) + humansOn(r, 1) > 0) { queue.splice(queue.indexOf(q), 1); startParty(p, r.name, t); break; }
    }
  }
  if (!queue.length) return;
  // 2. pack the rest into two teams: biggest parties first (so 3+2+1 becomes 3 v 3), the smaller team takes each next one
  const team = [[], []], size = [0, 0], cnt = (q) => partyConns(parties.get(q.pid)).length;
  for (const q of [...queue].sort((a, b) => cnt(b) - cnt(a) || a.since - b.since)) {
    const n = partyConns(parties.get(q.pid)).length;
    const t = size[0] <= size[1] ? [0, 1] : [1, 0];
    const fit = t.find((tt) => size[tt] + n <= 5);
    if (fit !== undefined) { team[fit].push(q); size[fit] += n; }
  }
  const wait = (now - queue[0].since) / 1000;
  const queued = new Set(queue.flatMap((q) => parties.get(q.pid).members));
  const othersAround = [...online.values()].some((oc) => oc.acct && !oc.room && !queued.has(oc.acct.id));
  const go = (size[0] === 5 && size[1] === 5) || (size[0] && size[1] && wait >= MM.REAL) || wait >= MM.MAX || (!othersAround && wait >= MM.ALONE);
  const found = size[0] + size[1];
  if (go) {
    const room = 'q-' + crypto.randomBytes(3).toString('hex');
    for (const t of [0, 1]) for (const q of team[t]) { queue.splice(queue.indexOf(q), 1); startParty(parties.get(q.pid), room, t); }
    return;
  }
  for (const q of queue) partyMsg(parties.get(q.pid), { t: 'mm', on: true, wait: Math.round((now - q.since) / 1000), found, max: MM.MAX });
}
setInterval(mmTick, 1000);

function partyPlay(c, m) {
  const p = parties.get(c.party); if (!p) return;
  if (p.leader !== c.acct.id) return send(c, { t: 'toast', text: 'Only the party leader can start' });
  const members = p.members.map((id) => online.get(id)).filter((mc) => mc && !mc.room);
  let room, team = 0;
  if (m.mode === 'private') {
    const code = p.code || (p.code = crypto.randomBytes(3).toString('hex').toUpperCase());
    room = 'p-' + code; team = 0;
    const r = getRoom(room);                 // the leader's arena (or a new one every match)
    if (!r.clients.size) { r.sim.fixedArena = ARENAS.includes(m.arena) ? m.arena : null; if (r.sim.fixedArena) r.sim.arena = r.sim.fixedArena; }
  } else {
    const waiting = p.members.filter((id) => id !== p.leader && !p.ready.has(id)).map((id) => accounts[id].name);
    if (waiting.length) return send(c, { t: 'toast', text: `Waiting for ${waiting.join(', ')} to ready up` });
    return enqueue(p);
  }
  for (const mc of members) join(mc, { room, exact: true, team, name: mc.acct.name + '#' + mc.acct.tag, char: mc.acct.hero });
  p.ready.clear(); partyUpdate(p.id);
}

const signups = new Map();                   // ip -> sign-up times (5 an hour)
function handle(c, raw) {
  // flood limit: inputs come 60 a second; far past that is a broken or hostile client
  const now = Date.now(); if (now - (c.winT || 0) > 1000) { c.winT = now; c.winN = 0; }
  if (++c.winN > 240) { if (c.winN === 241) console.warn('[flood]', c.acct?.id || c.ip); return; }
  let m; try { m = JSON.parse(raw); } catch { return; }
  // ── signing in ──
  if (m.t === 'hello') {
    if (c.acct || c.hello) return; c.hello = true;
    return verifySession(String(m.session || '')).then((gt) => {
      if (c.socket.destroyed) return;
      // signed in with GameTok: that's who you are (your account is made on your first visit, named after you)
      let a = gt && byGt.get(String(gt.id));
      if (gt && !a) a = register(gt.name, String(gt.id));
      if (!a) a = byToken.get(String(m.token || ''));
      if (!a) { c.hello = false; return send(c, { t: 'need_name', gametok: !!GT_KEY }); }
      const b = banned(a.id); if (b) { send(c, { t: 'denied', why: `You can't play No Rules FC online (${b.why}).` }); return c.socket.end(); }
      attach(c, a);
    });
  }
  if (m.t === 'register') {
    if (c.acct) return;
    const ip = c.ip, now = Date.now(), hits = (signups.get(ip) || []).filter((t) => now - t < 3600e3);
    if (hits.length >= 5) return send(c, { t: 'toast', text: 'Too many new players from here. Try again later.' });
    if (!okName(m.name)) return send(c, { t: 'toast', text: 'Pick another name: letters and numbers only, nothing rude' });
    hits.push(now); signups.set(ip, hits);
    return attach(c, register(m.name));
  }
  if (m.t === 'join' && !c.room) return join(c, m);   // old clients / practice links
  if (m.t === 'party_info') {                         // an invite link, before the new player has signed up
    const who = accounts[String(m.with || '')], wc = who && online.get(who.id), p = wc && parties.get(wc.party);
    if (!who) return send(c, { t: 'party_info', gone: true });
    return send(c, { t: 'party_info', leader: who.name + '#' + who.tag, hero: who.hero, size: p ? p.members.length : 0 });
  }
  if (!c.acct) return;
  // ── friends, party, lobby ──
  switch (m.t) {
    case 'friend_add': return friendAdd(c, m);
    case 'friend_accept': return friendAccept(c, m);
    case 'friend_decline': return friendDrop(c, m, true);
    case 'friend_remove': return friendDrop(c, m, false);
    case 'invite': {
      const tc = online.get(m.id); if (!tc || !c.acct.friends.includes(m.id)) return send(c, { t: 'toast', text: 'They are not online' });
      send(tc, { t: 'invite', from: pub(c.acct), party: c.party }); return send(c, { t: 'toast', text: `Invite sent to ${accounts[m.id].name}` });
    }
    case 'join_party': return joinParty(c, String(m.party || ''));
    case 'join_player': {                    // an invite link (?with=<their id>): become friends, land in their party
      const them = accounts[String(m.id || '')], me = c.acct; if (!them || them === me) return;
      if (!me.friends.includes(them.id)) me.friends.push(them.id);
      if (!them.friends.includes(me.id)) them.friends.push(me.id);
      save();
      me.requests = me.requests.filter((x) => x !== them.id); them.requests = them.requests.filter((x) => x !== me.id);
      sendMe(c); const tc = online.get(them.id);
      if (!tc) return send(c, { t: 'toast', text: `${them.name} is offline. You're friends now, join them when they're on.` });
      sendMe(tc); send(tc, { t: 'toast', text: `${me.name} joined from your invite link` });
      return joinParty(c, tc.party);
    }
    case 'join_friend': { const fc = online.get(m.id); if (fc && c.acct.friends.includes(m.id)) joinParty(c, fc.party); return; }
    case 'leave_party': leaveParty(c); newParty(c); return;
    case 'kick': { const p = parties.get(c.party); const kc = online.get(m.id); if (p && p.leader === c.acct.id && kc && kc !== c) { leaveParty(kc); newParty(kc); send(kc, { t: 'toast', text: 'You were removed from the party' }); } return; }
    case 'hero': {
      if (!HEROES[m.char]) return;
      if (!owns(c.acct, m.char)) return send(c, { t: 'toast', text: `${HEROES[m.char].name} is locked` });
      c.acct.hero = m.char; save(); partyUpdate(c.party); return sendMe(c);
    }
    case 'buy': return buy(c, String(m.char || ''));
    case 'ready': { const p = parties.get(c.party); if (p) { if (m.on) p.ready.add(c.acct.id); else p.ready.delete(c.acct.id); partyUpdate(p.id); } return; }
    case 'play': if (!c.room) partyPlay(c, m); return;
    case 'mm_cancel': return unqueue(c.party, `${c.acct.name} cancelled`);
    case 'join_code': {
      const code = clean(m.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!rooms.has('p-' + code.toLowerCase())) return send(c, { t: 'toast', text: `No private match ${code}` });
      return join(c, { room: 'p-' + code.toLowerCase(), exact: true, team: m.team, name: c.acct.name + '#' + c.acct.tag, char: c.acct.hero });
    }
    case 'leave_match': return leave(c);
    case 'rtc': {                            // voice: pass the WebRTC handshake to a party member
      const p = parties.get(c.party), tc = online.get(m.to);
      if (p && tc && p.members.includes(m.to)) send(tc, { t: 'rtc', from: c.acct.id, data: m.data });
      return;
    }
    case 'voice': { const p = parties.get(c.party); if (p) for (const id of p.members) { const mc = online.get(id); if (mc && mc !== c) send(mc, { t: 'voice', id: c.acct.id, on: !!m.on }); } return; }
  }
  const p = c.slot; if (!p) return;
  if (m.t === 'i' && Array.isArray(m.s)) {
    for (const s of m.s.slice(0, 12)) {
      if (!Array.isArray(s) || !(s[0] > p.ack)) continue;
      const mx = +s[1] || 0, mz = +s[2] || 0, l = Math.hypot(mx, mz);
      p.inq.push({ seq: s[0] | 0, mx: l > 1 ? mx / l : mx, mz: l > 1 ? mz / l : mz, sprint: !!s[3], jump: !!s[4], hold: !!s[5] });
    }
    if (p.inq.length > 8) p.inq.splice(0, p.inq.length - 4);   // fell behind (tab was hidden): catch up
  } else if (m.t === 'a' && ['shoot', 'pass', 'tackle', 'super', 'punch', 'skill'].includes(m.k)) {
    act(c.room.sim, p, m.k, +m.pw || 0, +m.yaw);
  } else if (m.t === 'ping') send(c, { t: 'pong', at: m.at });
}

// ── The loop ─────────────────────────────────────────────────────────────────────────────────
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
  while (acc >= DT) {
    acc -= DT;
    for (const r of rooms.values()) {
      for (const p of r.sim.players) {
        if (!p.human || !p.inq) continue;
        const i = p.inq.shift();
        if (i) { p.input = i; p.ack = i.seq; } else p.input.jump = false;   // no new input: keep the last
      }
      step(r.sim, DT);
      if (r.sim.phase === 'end' && r.sim.endT < 1 && !r.over) {   // full time: back to the lobby
        r.over = true;
        const score = r.sim.score.slice();
        for (const c of [...r.clients]) {
          let reward = null;
          if (c.acct && c.slot) {               // pay out: result + a bonus per goal the team scored
            const t = c.slot.team, us = score[t], them = score[1 - t];
            const res = us > them ? 'win' : us < them ? 'loss' : 'draw';
            const coins = REWARD[res] + GOAL_BONUS * us;
            c.acct.coins += coins; c.acct.xp += coins; save();
            reward = { res, coins, level: 1 + Math.floor(c.acct.xp / XP_LEVEL) };
          }
          send(c, { t: 'over', score, reward }); leave(c); sendMe(c);
        }
        continue;
      }
      if (++r.tick % SEND_EVERY === 0) {
        const s = snapshot(r.sim); r.sim.events = [];
        for (const c of r.clients) { s.ack = c.slot ? c.slot.ack : 0; send(c, s); }
      }
    }
  }
}, 1000 / 120);

// voice: how phones reach each other. Cloudflare's TURN relay (TURN_KEY_ID + TURN_KEY_TOKEN, the
// same keys as GTA Lagos) for the mobile networks that block phone-to-phone audio, plus Google's
// STUN; credentials last a day and are fetched again after an hour
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
let ice = { list: null, at: 0 };
async function iceServers() {
  const id = process.env.TURN_KEY_ID, token = process.env.TURN_KEY_TOKEN;
  if (!id || !token) return STUN;
  if (ice.list && Date.now() - ice.at < 3600e3) return ice.list;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) });
    const d = await r.json();
    if (!r.ok || !d.iceServers) throw new Error(JSON.stringify(d).slice(0, 200));
    ice = { list: [...STUN, ...(Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers])], at: Date.now() };
    return ice.list;
  } catch (e) { console.error('[ice] TURN credentials failed', e.message); return ice.list || STUN; }
}

// ── HTTP: the game itself ────────────────────────────────────────────────────────────────────
const MIME = { '.m4a': 'audio/mp4', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  // dev only (from this machine): the browser saves rendered UI art (hero portraits) into assets/ui
  if (u === '/dev/save' && req.method === 'POST' && !LIVE) {
    const ip = req.socket.remoteAddress || '';
    const name = String(new URL(req.url, 'http://x').searchParams.get('name') || '').replace(/[^a-z0-9_.-]/gi, '');
    if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip) || !/\.(png|jpg|webp)$/.test(name)) { res.writeHead(403); res.end(); return; }
    const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
      fs.mkdirSync(path.join(ROOT, 'assets', 'ui'), { recursive: true });
      fs.writeFile(path.join(ROOT, 'assets', 'ui', name), Buffer.concat(chunks), (e) => { res.writeHead(e ? 500 : 200); res.end(e ? 'fail' : 'ok'); });
    });
    return;
  }
  if (/^\/(stats|ban|unban|bans)$/.test(u)) {        // admin (ADMIN_KEY)
    const q = new URL(req.url, 'http://x').searchParams, ok = process.env.ADMIN_KEY && q.get('key') === process.env.ADMIN_KEY;
    let out = {};
    if (ok && u === '/stats') out = { accounts: Object.keys(accounts).length, online: online.size, queue: queue.length, rooms: [...rooms.values()].map((r) => ({ room: r.name, humans: r.clients.size, score: r.sim.score })) };
    if (ok && u === '/ban') { const id = q.get('id'); ban(id, q.get('why')); const bc = online.get(id); if (bc) { send(bc, { t: 'denied', why: 'You were removed from No Rules FC.' }); bc.socket.end(); } out = { banned: id }; }
    if (ok && u === '/unban') { unban(q.get('id')); out = { unbanned: q.get('id') }; }
    if (ok && u === '/bans') out = banList();
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out, null, 1)); return;
  }
  if (u === '/ice') {
    iceServers().then((list) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ iceServers: list })); });
    return;
  }
  if (u === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([...rooms.values()].map((r) => ({ room: r.name, players: r.clients.size })))); return; }
  const f = path.join(ROOT, path.normalize(u));
  if (!f.startsWith(ROOT + path.sep) || f.includes(path.sep + 'server' + path.sep) || f.includes(path.sep + 'Models' + path.sep) || f.startsWith(path.join(ROOT, 'data'))) { res.writeHead(404); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.on('upgrade', (req, socket) => {
  if (!accept(req, socket)) return;
  const c = { socket, room: null, slot: null, acct: null, party: null, status: 'offline', ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() };
  let gone = false;
  const bye = () => {
    if (gone) return; gone = true; leave(c);
    if (c.acct && online.get(c.acct.id) === c) { leaveParty(c); online.delete(c.acct.id); for (const fid of c.acct.friends) { const fc = online.get(fid); if (fc) send(fc, { t: 'presence', id: c.acct.id, online: false, status: 'offline' }); } }
    socket.destroy();
  };
  socket.on('data', reader((t) => handle(c, t), bye));
  socket.on('close', bye); socket.on('error', bye);
});
server.listen(PORT, () => console.log(`Street 5s on http://localhost:${PORT}`));
