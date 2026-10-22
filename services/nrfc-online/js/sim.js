// Street 5s: the match itself. Pure logic, no three.js, no DOM — the online server runs it
// (server/server.mjs, the authority), the browser runs it for practice vs bots, and the client
// runs movePlayer() on its own player to predict ahead of the server.
//
// No rules: no fouls, no offside, no throw-ins (the arena is a closed bowl, the ball rolls up the
// walls). Anime and comic heroes: slide anyone, barge anyone, and every hero has a super —
// Kamehameha the ball through the keeper, heat-vision it across the pitch.

export const HZ = 60, DT = 1 / HZ;
export const HL = 36, HW = 23;                 // half length / half width of the arena floor plan (m)
export const GOAL_W = 4.6, GOAL_H = 3.4, GOAL_D = 3;   // half width, height, depth
export const CEIL = 18, BALL_R = 0.34, PR = 0.45;
export const RC = 12, RR = 4.2;                 // Rocket League shape: corner radius (plan), floor-to-wall ramp radius

// The arena is a rounded box: rounded corners in plan, and every wall meets the floor (and the
// ceiling) in a quarter-pipe the ball rolls up. Signed distances, negative inside.
export function sdPlan(x, z) {
  const qx = Math.abs(x) - (HL - RC), qz = Math.abs(z) - (HW - RC);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - RC;
}
export function sdArena(x, y, z) {
  const qx = sdPlan(x, z) + RR, qy = Math.abs(y - CEIL / 2) - (CEIL / 2 - RR);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RR;
}
const inMouth = (x, z) => Math.abs(z) < GOAL_W && Math.abs(x) > HL - RR - 0.5;
// how high the floor is here (players run a little way up the ramps)
export function groundAt(x, z) {
  if (inMouth(x, z)) return 0;
  const u = Math.min(RR, sdPlan(x, z) + RR);
  return u > 0 ? RR - Math.sqrt(RR * RR - u * u) : 0;
}
function planNormal(x, z) {
  const e = 0.01, nx = sdPlan(x + e, z) - sdPlan(x - e, z), nz = sdPlan(x, z + e) - sdPlan(x, z - e), l = Math.hypot(nx, nz) || 1;
  return [nx / l, nz / l];
}
export const MATCH = 180;
export const ARENAS = ['city', 'island', 'pit', 'asgard'];   // a different one every match
const pickArena = (not) => { const l = ARENAS.filter((a) => a !== not); return l[(Math.random() * l.length) | 0]; };
const G = 16, RUN = 8, SPRINT = 11.5, ACC = 46;

// how good the bots are, 0 (clumsy) .. 1 (the old bots: instant tackles, pinpoint shots, faster
// turns). They should be beatable by someone who just picked the game up.
export const BOT_LEVEL = 0.3;
const lvl = (sim) => sim.botLevel ?? BOT_LEVEL;
const BOT_NAMES = ['Kaizo_77', 'vortexx', 'PixelPunter', 'zoomies', 'frostbyte_', 'LilChipper', 'turbo_tim', 'nova.kicks', 'Glitchy', 'OnyxFox', 'slidetackl3r', 'Reboot', 'cobalt_k', 'MintyWing', 'Rizzler99', 'dropshot'];
// ready: the hero's rigged model is in assets/fighters (the rest are waiting on Mixamo)
// Stats: spd/spr = run/sprint speed, shot = shot power, tough = chance a normal hit (barge,
// slide, body check) only staggers them, jump = jump speed. Movement: fly (hold jump to rise
// and hover), dbl (double jump), glide (hold jump to fall slowly), swing (in the air, hold
// jump: a web to the roof ahead, swing on it, let go to fling off).
// Names are our own takes (Svperman, Hvlk, Iron Male, …); the ids stay the same everywhere.
export const HEROES = {
  spiderman: { name: 'Spyder-Man', price: 0, role: 'AGILE', sdesc: 'Yanks the ball into your hands from 34 m and webs up the two nearest opponents', kdesc: 'Zip onto an opponent and drop-kick them', power: 'web', label: 'WEB PULL', color: '#ff3b3b', ready: true, spd: 1.12, spr: 1.18, shot: 1.12, tough: 0.35, jump: 8.6, dbl: true, swing: true, move: 'WEB SWING', skill: 'zip', skillName: 'WEB ZIP', skillCd: 4, h: 1.76, girth: 0.97, acc: 36, turn: 12 },
  baki: { name: 'Bakki', price: 0, role: 'TANK', sdesc: 'Charge through everyone in your path', kdesc: '5 s: can’t be floored, every punch floors', power: 'rampage', label: 'DEMON RUSH', color: '#ff7a2a', ready: true, spd: 1.02, spr: 1.08, shot: 1.1, tough: 0.65, jump: 7.2, move: 'TANK', skill: 'rage', skillName: 'DEMON RAGE', skillCd: 12, h: 1.8, girth: 1.08, acc: 24, turn: 8.5 },
  yujiro: { name: 'Yujirho', price: 2000, role: 'TANK', sdesc: 'Launches everyone within 9 m', kdesc: 'Pick one up and throw them', power: 'quake', label: 'OGRE STOMP', color: '#ff2a50', ready: true, spd: 0.95, spr: 0.95, shot: 1.3, tough: 0.92, jump: 6.6, move: 'UNSTOPPABLE', skill: 'grab', skillName: 'OGRE THROW', skillCd: 7, h: 2.15, girth: 1.12, acc: 22, turn: 7.5 },
  hulk: { name: 'Hvlk', price: 2500, role: 'GIANT', sdesc: 'One clap: a shockwave that blows everyone ahead away, the ball too', kdesc: 'A huge leap that smashes down where he lands', power: 'clap', label: 'THUNDERCLAP', color: '#5fd84a', ready: true, spd: 0.92, spr: 1.04, shot: 1.4, tough: 0.97, jump: 7, move: 'GIANT', skill: 'leap', skillName: 'HVLK SMASH', skillCd: 7, h: 2.75, girth: 1.2, acc: 20, turn: 7, giant: true },
  goku: { name: 'Gokv', price: 0, role: 'BEAM', sdesc: 'Charge, then fire the ball through the keeper', kdesc: 'Appear right behind the ball', power: 'beam', label: 'KAME WAVE', color: '#5fd8ff', ready: true, spd: 1.05, spr: 1.12, shot: 1.15, tough: 0.5, jump: 7, fly: true, move: 'FLIGHT', skill: 'tp', skillName: 'INSTANT STEP', skillCd: 9, h: 1.78, girth: 1.0, acc: 30, turn: 10 },
  vegeta: { name: 'Vejeta', price: 1200, role: 'BEAM', sdesc: 'A wider beam that launches everyone', kdesc: 'An exploding energy shot', power: 'beam', label: 'FINAL BLAST', color: '#ffe45a', ready: true, spd: 1.05, spr: 1.12, shot: 1.18, tough: 0.5, jump: 7, fly: true, move: 'FLIGHT', skill: 'bigbang', skillName: 'BIG BANG', skillCd: 8, h: 1.66, girth: 1.0, acc: 30, turn: 10 },
  superman: { name: 'Svperman', price: 1500, role: 'POWER', sdesc: 'Burn the ball across the pitch', kdesc: 'A flying punch, ground or air', power: 'heat', label: 'HEAT VISION', color: '#ff3a20', ready: true, spd: 1.0, spr: 1.12, shot: 1.22, tough: 0.85, jump: 7, fly: true, move: 'FLIGHT', skill: 'dash', skillName: 'SUPER PUNCH', skillCd: 6, h: 1.93, girth: 1.04, acc: 30, turn: 10 },
  ironman: { name: 'Iron Male', price: 1200, role: 'TECH', sdesc: 'A chest beam that fires the ball', kdesc: 'Three homing missiles', power: 'heat', label: 'CHEST BEAM', color: '#9fe8ff', ready: true, spd: 0.95, spr: 1.0, shot: 1.1, tough: 0.6, jump: 6.6, fly: true, move: 'FLIGHT', skill: 'missiles', skillName: 'MICRO MISSILES', skillCd: 9, h: 1.95, girth: 1.05, acc: 27, turn: 9 },
  thor: { name: 'Thorr', price: 1500, role: 'POWER', sdesc: 'Lightning on the ball, it fires at goal', kdesc: 'Hits everyone on the way out and back', power: 'lightning', label: 'THUNDER STRIKE', color: '#a8d0ff', ready: true, spd: 0.95, spr: 1.0, shot: 1.22, tough: 0.7, jump: 6.8, fly: true, move: 'FLIGHT', skill: 'hammer', skillName: 'HAMMER THROW', skillCd: 7, h: 1.98, girth: 1.06, acc: 26, turn: 9 },
  flash: { name: 'The Flazh', price: 0, role: 'SPEED', sdesc: 'Double speed for 4 seconds', kdesc: 'Run straight through tackles', power: 'speed', label: 'SPEED SURGE', color: '#ffd23a', ready: true, spd: 1.55, spr: 1.9, shot: 0.95, tough: 0.1, jump: 6.6, move: 'FASTEST', skill: 'phase', skillName: 'PHASE', skillCd: 8, h: 1.83, girth: 0.96, acc: 60, turn: 16 },
  batman: { name: 'Batmvn', price: 1000, role: 'TACTICS', sdesc: 'Drops one opponent, they lose the ball', kdesc: 'Reel in to the ball', power: 'batarang', label: 'BAT-BLADE', color: '#c8ccd8', ready: true, spd: 1.0, spr: 1.02, shot: 1.0, tough: 0.35, jump: 7.2, glide: true, move: 'CAPE GLIDE', skill: 'grapple', skillName: 'GRAPPLE', skillCd: 7, h: 1.9, girth: 1.03, acc: 29, turn: 10 },
  lantern: { name: 'Green Lanturn', price: 1000, role: 'CONTROL', sdesc: 'Seal your goal for 5 seconds', kdesc: 'A wall of light wherever you need it', power: 'construct', label: 'CONSTRUCT WALL', color: '#3aff6a', ready: true, spd: 1.0, spr: 1.02, shot: 1.05, tough: 0.4, jump: 7, fly: true, move: 'FLIGHT', skill: 'shield', skillName: 'CONSTRUCT SHIELD', skillCd: 9, h: 1.86, girth: 1.0, acc: 30, turn: 10 },
};
const NOHERO = { spd: 1, spr: 1, shot: 1, tough: 0, jump: 6.4, h: 1.8, girth: 1, acc: 30, turn: 10 };
export const heroOf = (p) => HEROES[p.char] || NOHERO;
export const FLY_TOP = 11;                      // flyers go this high at most (m)
export const CHARS = Object.keys(HEROES).filter((k) => HEROES[k].ready);
const SUPER_RATE = 3.2;                         // super meter per second (full in ~30 s, faster with touches and hits)

const hyp = Math.hypot, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fwdX = (p) => Math.sin(p.yaw), fwdZ = (p) => Math.cos(p.yaw);

export function createSim() {
  const sim = {
    phase: 'kickoff', phaseT: 3, clock: MATCH, score: [0, 0], overtime: false, endT: 0,
    kickTeam: Math.random() < 0.5 ? 0 : 1, events: [],
    ball: { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, last: -1 },
    players: [], cons: [], proj: [], walls: [], arena: pickArena(),
  };
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < 10; i++) {
    sim.players.push({
      id: i, team: i < 5 ? 0 : 1, role: i % 5 === 0 ? 'gk' : 'out',
      name: names[i], char: CHARS[(Math.random() * CHARS.length) | 0], human: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0,
      st: 'free', stT: 0, stam: 100, cd: 0, touchCd: 0, sp: 40, boost: 0, aimYaw: 0, hitWall: false,
      input: { mx: 0, mz: 0, sprint: false, jump: false, hold: false }, ack: 0, ai: { react: 0, hold: 0, aimZ: 0 },
    });
  }
  resetKickoff(sim);
  return sim;
}

// team 0 defends -x and attacks +x
const SPOTS = [[-HL + 1.5, 0], [-22, -8], [-22, 8], [-8, -11], [-8, 11]];
export function resetKickoff(sim) {
  const b = sim.ball;
  Object.assign(b, { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, last: -1 });
  for (const p of sim.players) {
    const s = SPOTS[p.id % 5], m = p.team === 0 ? 1 : -1;
    p.x = s[0] * m; p.z = s[1] * m; p.y = 0;
    if (p.id % 5 === 4 && p.team === sim.kickTeam) { p.x = -1.2 * m; p.z = 0; }   // the kick-off taker
    p.vx = p.vy = p.vz = 0; p.yaw = m > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.st = 'free'; p.stT = 0; p.cd = 0; p.touchCd = 0; p.stam = 100; p.boost = 0; p.web = null; p.phaseT = 0; p.rageT = 0; p.skCd = 0;
  }
  sim.phase = 'kickoff'; sim.phaseT = 3; sim.cons = []; sim.proj = []; sim.walls = [];
  sim.events.push({ k: 'kickoff' });
}

export function resetMatch(sim) {
  sim.score = [0, 0]; sim.clock = MATCH; sim.overtime = false; sim.arena = sim.fixedArena || pickArena(sim.arena);   // a private room keeps the arena its leader picked
  sim.kickTeam = Math.random() < 0.5 ? 0 : 1;
  resetKickoff(sim);
}

// ── Movement (shared with the client's prediction, so it may only touch the player itself) ──
export function movePlayer(p, inp, dt, frozen) {
  p.stT -= dt; p.cd -= dt; p.touchCd -= dt; if (p.boost > 0) p.boost -= dt; if (p.webCatch > 0) p.webCatch -= dt;
  if (p.phaseT > 0) p.phaseT -= dt; if (p.rageT > 0) p.rageT -= dt;
  if (p.stT <= 0 && p.st !== 'free' && p.st !== 'hold') {
    if (p.st === 'down') { p.st = 'getup'; p.stT = 1.0; } else p.st = 'free';
  }
  const mx = inp.mx || 0, mz = inp.mz || 0, ml = Math.min(1, hyp(mx, mz)), st = p.st, H = heroOf(p);
  const air = p.y > 0.02;
  if (!air) { p.dbl = false; p.airT = 0; } else p.airT = (p.airT || 0) + dt;
  if (H.swing && webSwing(p, inp, dt, air, frozen, mx, mz, ml)) return;
  // flyers: hold jump to rise and hover; Batman: hold to glide down
  // flyers: once off the ground they're flying (no stamina cost) — hold jump to climb,
  // let go and they drift down slowly, so a tap now and then keeps them up
  const flying = H.fly && air && st === 'free' && !frozen;
  p.flying = flying;
  if (st === 'free' || st === 'hold' || st === 'kick' || st === 'pass' || st === 'cheer' || st === 'sad' || st === 'punch' || st === 'hit' || st === 'skill') {
    let cap = 0;
    if (st === 'free') {
      const sprint = inp.sprint && p.stam > 1 && ml > 0.1;
      const drain = sprint && !(p.boost > 0) ? 26 : 0;
      p.stam = drain ? Math.max(0, p.stam - drain * dt) : air && !flying ? p.stam : Math.min(100, p.stam + 14 * dt);
      cap = (sprint ? SPRINT * H.spr : RUN * H.spd) * ml * (p.boost > 0 ? 1.9 : 1) * (flying ? (p.carry ? 1.0 : 1.25) : 1) * (p.rageT > 0 ? 1.25 : 1) * (p.phaseT > 0 ? 1.15 : 1);
    } else {
      p.stam = Math.min(100, p.stam + 14 * dt);
      cap = st === 'hold' ? 3 * ml : st === 'cheer' || st === 'sad' ? 0 : st === 'hit' ? 0.8 * ml : 2.5 * ml;
    }
    if (frozen) cap = 0;
    const tx = ml > 0.01 ? mx / (hyp(mx, mz) || 1) * cap : 0, tz = ml > 0.01 ? mz / (hyp(mx, mz) || 1) * cap : 0;
    const sp0 = hyp(p.vx, p.vz), rev = sp0 > 5 && (tx * p.vx + tz * p.vz) < -0.2 * sp0 * hyp(tx, tz);   // reversing at speed: dig in and skid
    const a = (air && !flying ? (H.acc || ACC) * 0.25 : (H.acc || ACC) * (rev ? 1.6 : 1)) * dt;
    const dx = tx - p.vx, dz = tz - p.vz, dl = hyp(dx, dz);
    if (dl <= a) { p.vx = tx; p.vz = tz; } else { p.vx += dx / dl * a; p.vz += dz / dl * a; }
    if (ml > 0.1 && (st === 'free' || st === 'hold') && !frozen) {
      const want = Math.atan2(mx, mz);
      let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = (H.turn || 10) * (p.bot ? 0.85 + 0.45 * (p.lvl ?? BOT_LEVEL) : 1) * dt; p.yaw += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    }
    if (inp.jump && st === 'free' && !frozen) {
      if (!air) p.vy = H.fly && inp.hold ? 9 : H.jump;     // flyers take off hard
      else if (H.dbl && !p.dbl && p.vy < 4) { p.vy = H.jump * 0.85; p.dbl = true; }
    }
  } else if (st === 'slide' || st === 'dive') {
    const k = Math.max(0, 1 - (air ? 0.5 : 2.4) * dt); p.vx *= k; p.vz *= k;
  } else if (st === 'rush' || st === 'zip' || st === 'dash') {
    // a straight-line charge / a web zip / a flying punch: keeps its speed until it ends
    if (st === 'zip' || st === 'dash') { p.y += p.vy * dt; p.x += p.vx * dt; p.z += p.vz * dt; if (p.y < 0) p.y = 0; clampPlayer(p); return; }
  } else {
    const k = Math.max(0, 1 - (st === 'header' || st === 'bicycle' || (st === 'down' && air) ? 0.5 : 7) * dt);   // keep momentum in the air
    p.vx *= k; p.vz *= k;
  }
  if (flying) {
    const top = p.carry ? 4.5 : FLY_TOP;                  // with the ball you fly low enough to be caught
    const want = inp.hold ? (p.y < top - 0.5 ? 7 : (top - p.y) * 3) : -3;   // let go and you come down
    p.vy += (want - p.vy) * Math.min(1, (p.vy > want ? 3 : 6) * dt);
  }
  else {
    p.vy -= G * dt;
    if (H.glide && inp.hold && air && st === 'free' && p.vy < -1.6) p.vy = -1.6;
  }
  p.y += p.vy * dt;
  if (p.y < 0) {
    if (p.leapT > 0 && p.vy < -2) { p.leapT = 0; p.smash = true; }   // Hulk Smash lands (the match step does the damage)
    p.y = 0; p.vy = 0;
  }
  if (p.leapT > 0) p.leapT -= dt;
  p.x += p.vx * dt; p.z += p.vz * dt;
  clampPlayer(p);
}

// Spider-Man on a web: a pendulum from an anchor up on the roof ahead of him
function webSwing(p, inp, dt, air, frozen, mx, mz, ml) {
  if (!p.web) {
    if (!(air && inp.hold && p.st === 'free' && !frozen && p.airT > 0.18 && p.stam > 5)) return false;
    const l = hyp(mx, mz), dx = l > 0.1 ? mx / l : fwdX(p), dz = l > 0.1 ? mz / l : fwdZ(p);
    let ax = p.x + dx * 10, az = p.z + dz * 10;
    if (sdPlan(ax, az) > -2) { ax = p.x + dx * 4; az = p.z + dz * 4; }   // near a wall: anchor closer
    p.web = [ax, Math.min(CEIL - 1.5, p.y + 11), az]; p.webL = hyp(ax - p.x, p.web[1] - p.y, az - p.z);
  }
  const [ax, ay, az] = p.web;
  if (!inp.hold || p.st !== 'free' || p.stam <= 0 || p.y < 0.25 && p.airT > 0.6 || frozen) {   // let go: fling off
    p.web = null; p.vy += 3; p.flip = 0.7;
    return false;
  }
  p.stam = Math.max(0, p.stam - 12 * dt);
  if (ml > 0.1) { p.vx += mx / ml * 12 * dt; p.vz += mz / ml * 12 * dt; }   // pump the swing
  p.vy -= G * dt;
  const sp = hyp(p.vx, p.vy, p.vz); if (sp > 24) { p.vx *= 24 / sp; p.vy *= 24 / sp; p.vz *= 24 / sp; }
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  const rx = p.x - ax, ry = p.y - ay, rz = p.z - az, d = hyp(rx, ry, rz);
  if (d > p.webL) {                                        // the web is taut: back onto the circle
    const nx = rx / d, ny = ry / d, nz = rz / d;
    p.x = ax + nx * p.webL; p.y = ay + ny * p.webL; p.z = az + nz * p.webL;
    const vr = p.vx * nx + p.vy * ny + p.vz * nz;
    if (vr > 0) { p.vx -= vr * nx; p.vy -= vr * ny; p.vz -= vr * nz; }
  }
  if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }
  if (hyp(p.vx, p.vz) > 1) p.yaw = Math.atan2(p.vx, p.vz);
  clampPlayer(p);
  return true;
}

function clampPlayer(p) {
  const R = PR, ax = Math.abs(p.x), sx = Math.sign(p.x);
  if (ax > HL) {                                     // in the goal: its sides and back net
    if (Math.abs(p.z) > GOAL_W - R) { p.z = Math.sign(p.z) * (GOAL_W - R); p.vz = 0; }
    if (ax > HL + GOAL_D - R) { p.x = sx * (HL + GOAL_D - R); p.vx = 0; }
    return;
  }
  if (Math.abs(p.z) < GOAL_W - R && ax > HL - RR - 0.5) return;   // the goal mouth: walk in
  const w = sdPlan(p.x, p.z), wMax = -RR * 0.3;    // a third of the way up the ramp, no further
  if (w > wMax) {
    const [nx, nz] = planNormal(p.x, p.z), o = w - wMax;
    p.x -= nx * o; p.z -= nz * o;
    const vn = p.vx * nx + p.vz * nz; if (vn > 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
  }
}

// ── Actions (authority only) ─────────────────────────────────────────────────────────────────
const inOwnBox = (p, x = p.x, z = p.z) => Math.abs(z) < 8.5 && (p.team === 0 ? x < -HL + 7.5 : x > HL - 7.5);
const wy = (p) => p.y + groundAt(p.x, p.z);         // a player's feet in world height

function kickBall(sim, p, dx, dz, speed, lift) {
  const b = sim.ball, l = hyp(dx, dz) || 1;
  b.vx = dx / l * speed + p.vx * 0.25; b.vz = dz / l * speed + p.vz * 0.25; b.vy = lift;
  if (b.y < BALL_R + 0.05) b.y = BALL_R + 0.05;
  b.owner = -1; b.last = p.id; p.touchCd = 0.3;
}

function bestMate(sim, p, aheadOnly) {
  const fx = fwdX(p), fz = fwdZ(p), dir = p.team === 0 ? 1 : -1;
  let best = null, bs = -1e9;
  for (const q of sim.players) {
    if (q === p || q.team !== p.team || q.st === 'down') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = hyp(dx, dz) || 1;
    if (d < 3 || d > 32) continue;
    const align = (dx * fx + dz * fz) / d;
    let s = aheadOnly ? (dx * dir) / d * 1.2 - d * 0.02 : align * 2 - d * 0.015;
    if (!aheadOnly && align < 0.35) continue;
    if (q.role === 'gk' && !aheadOnly) s -= 0.6;
    for (const f of sim.players) if (f.team !== p.team && hyp(f.x - q.x, f.z - q.z) < 2.5) s -= 0.6;   // marked
    if (s > bs) { bs = s; best = q; }
  }
  return best;
}

// ── Player assists: humans get the same help the bots get (bots face their target exactly) ──
// the teammate nearest to where you're aiming, played ahead of them
function mateInAim(sim, p, fx, fz) {
  let best = null, bs = -1e9;
  for (const q of sim.players) {
    if (q === p || q.team !== p.team || q.st === 'down') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = hyp(dx, dz) || 1;
    if (d < 2.5 || d > 40) continue;
    const align = (dx * fx + dz * fz) / d;
    if (align < 0.15) continue;
    let s = align * 3 - d * 0.02 - (q.role === 'gk' ? 0.8 : 0);
    for (const f of sim.players) if (f.team !== p.team && hyp(f.x - q.x, f.z - q.z) < 2.5) s -= 0.4;
    if (s > bs) { bs = s; best = q; }
  }
  return best;
}
// the opponent to hit: nearest one roughly the way you're facing
function lockOn(sim, p, fx, fz, range, cone = -0.3, prefer) {
  let best = null, bs = 1e9;
  for (const q of sim.players) {
    if (q.team === p.team || q.st === 'down' || q.st === 'getup') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = hyp(dx, dz);
    if (d > range || (dx * fx + dz * fz) / (d || 1) < cone) continue;
    const s = d - (q.id === prefer ? 3 : 0);
    if (s < bs) { bs = s; best = q; }
  }
  return best;
}
// shot help: pull towards the goal, at the corner the keeper isn't covering
function shotAim(sim, p, fx, fz) {
  const gx = (p.team === 0 ? HL : -HL) - p.x, gz = -p.z, gl = hyp(gx, gz);
  if (gl > 44 || (gx * fx + gz * fz) / gl < 0.4) return [fx, fz, gl];
  const keeper = sim.players.find((q) => q.team !== p.team && q.role === 'gk');
  const hitZ = p.z + fz * (gx / (fx || 1e-6));
  let aimZ = Math.abs(hitZ) < GOAL_W - 0.7 && Math.abs(gx) > 1 ? hitZ : (keeper && keeper.z > 0 ? -1 : 1) * (GOAL_W - 0.9);
  if (keeper && Math.abs(aimZ - keeper.z) < 1.2) aimZ = (keeper.z > 0 ? -1 : 1) * (GOAL_W - 0.9);
  const ax = gx, az = aimZ - p.z, al = hyp(ax, az);
  const k = 0.7, nx = fx * (1 - k) + ax / al * k, nz = fz * (1 - k) + az / al * k, nl = hyp(nx, nz);
  return [nx / nl, nz / nl, gl];
}

export function act(sim, p, k, pw = 0, yaw) {
  if (sim.phase !== 'play' && sim.phase !== 'goal') return;
  if (typeof yaw === 'number' && isFinite(yaw) && (p.st === 'free' || p.st === 'hold')) p.yaw = yaw;
  const b = sim.ball, holding = p.st === 'hold';
  if (!(p.st === 'free' || holding) || (p.cd > 0 && !holding)) return;
  pw = clamp(+pw || 0, 0, 1);
  let fx = fwdX(p), fz = fwdZ(p);
  const dx = b.x - p.x, dz = b.z - p.z, dH = hyp(dx, dz), front = (dx * fx + dz * fz) / (dH || 1);
  const ev = (o) => sim.events.push(o);
  const carrying = b.owner === p.id && p.y > 0.3;            // a flyer with the ball up in the air
  const human = !p.bot;
  // humans: reach the ball anywhere near them, not only dead in front
  const reach = human ? dH < 2.3 && b.y < 1.7 : dH < 1.7 && b.y < 1.5 && front > -0.3;

  if (holding) {                                           // keeper lets go: throw or punt
    p.st = k === 'shoot' ? 'kick' : 'pass'; p.stT = 0.5; p.cd = 0.4;
    b.owner = -1; b.x = p.x + fx * 0.8; b.z = p.z + fz * 0.8; b.y = 1.2;
    if (k === 'shoot') kickBall(sim, p, fx, fz, 20 + 8 * pw, 9);
    else {
      const m = bestMate(sim, p, false);
      if (m) { const d = hyp(m.x - p.x, m.z - p.z); kickBall(sim, p, m.x - p.x, m.z - p.z, clamp(8 + d * 0.55, 10, 22), d > 14 ? 4.5 : 2.5); }
      else kickBall(sim, p, fx, fz, 14, 3);
    }
    ev({ k: 'kick', p: p.id, pw: 0.6 });
    return;
  }

  if (k === 'super') { superMove(sim, p); return; }
  if (k === 'skill') { skillMove(sim, p); return; }
  if (k === 'shoot') {
    if (carrying) {                                        // shoot from the air: aimed down at the goal
      p.st = 'kick'; p.stT = 0.5; p.cd = 0.35;
      const sp = (16 + 20 * pw) * heroOf(p).shot, gx = (p.team === 0 ? HL : -HL) - b.x, dist = Math.max(4, Math.abs(gx) / Math.max(0.3, Math.abs(fx)));
      kickBall(sim, p, fx, fz, sp, (1.4 - b.y) / (dist / sp) + 8 * (dist / sp) * 0.5);
      ev({ k: 'kick', p: p.id, pw }); return;
    }
    if (p.y > 0.35) {                                      // in the air: volley / bicycle
      const d3 = hyp(dx, b.y - (wy(p) + 1.2), dz);
      p.st = 'bicycle'; p.stT = 0.6; p.cd = 0.5;
      if (d3 < 1.8) { kickBall(sim, p, fx, fz, (22 + 8 * pw) * heroOf(p).shot, 1.5); ev({ k: 'kick', p: p.id, pw: 1, fancy: 1 }); }
      return;
    }
    p.st = 'kick'; p.stT = 0.5; p.cd = 0.35;
    if (reach) {
      let lift = 1 + 6.5 * pw * pw;
      if (human) {                                          // aim help, and keep close-range shots under the bar
        const [ax, az, gl] = shotAim(sim, p, fx, fz); fx = ax; fz = az; p.yaw = Math.atan2(fx, fz);
        lift = Math.min(lift, 1.6 + gl * 0.22);
      }
      kickBall(sim, p, fx, fz, (12 + 20 * pw) * heroOf(p).shot, lift);
      ev({ k: 'kick', p: p.id, pw });
    }
  } else if (k === 'pass') {
    p.st = 'pass'; p.stT = 0.45; p.cd = 0.3;
    if (reach || carrying) {
      const m = human ? mateInAim(sim, p, fx, fz) || bestMate(sim, p, false) : bestMate(sim, p, false);
      if (m && human) p.yaw = Math.atan2(m.x - p.x, m.z - p.z);
      if (m) {
        const lx = m.x + m.vx * 0.45, lz = m.z + m.vz * 0.45, d = hyp(lx - p.x, lz - p.z);
        kickBall(sim, p, lx - p.x, lz - p.z, clamp(7 + d * 0.65, 9, 24), d > 16 ? 4 : 1.2);
      } else kickBall(sim, p, fx, fz, 13, 1.2);
      ev({ k: 'kick', p: p.id, pw: 0.3 });
    }
  } else if (k === 'punch') {
    if (human) { const q = lockOn(sim, p, fx, fz, 3, -0.3); if (q) { p.yaw = Math.atan2(q.x - p.x, q.z - p.z); fx = fwdX(p); fz = fwdZ(p); } }
    punch(sim, p, fx, fz);
  } else if (k === 'tackle') {
    const sp = hyp(p.vx, p.vz);
    if (p.role === 'gk' && inOwnBox(p)) {                  // keeper: dive at the ball
      const tx = b.x + b.vx * 0.25 - p.x, tz = b.z + b.vz * 0.25 - p.z, tl = hyp(tx, tz) || 1;
      p.st = 'dive'; p.stT = 0.9; p.cd = 1.2;
      p.vx = tx / tl * 8; p.vz = tz / tl * 8; p.vy = 2.8; p.yaw = Math.atan2(tx, tz);
      ev({ k: 'dive', p: p.id });
    } else if (sp > 4.5) {
      if (human) {                                          // slide at the nearest opponent ahead (the ball carrier first)
        const q = lockOn(sim, p, fx, fz, 7, 0.3, b.owner);
        if (q) { const tx = q.x + q.vx * 0.2 - p.x, tz = q.z + q.vz * 0.2 - p.z, tl = hyp(tx, tz) || 1; fx = tx / tl; fz = tz / tl; p.yaw = Math.atan2(fx, fz); }
      }
      p.st = 'slide'; p.stT = 0.75; p.cd = 1.3;
      const s = Math.max(sp, 10) * 1.1; p.vx = fx * s; p.vz = fz * s;
      ev({ k: 'slide', p: p.id });
    } else {
      p.st = 'barge'; p.stT = 0.45; p.cd = 0.9;
      if (human) { const q = lockOn(sim, p, fx, fz, 2.6, -0.3); if (q) { p.yaw = Math.atan2(q.x - p.x, q.z - p.z); fx = fwdX(p); fz = fwdZ(p); } }
      for (const q of sim.players) {
        if (q.team === p.team) continue;
        const qx = q.x - p.x, qz = q.z - p.z, d = hyp(qx, qz);
        if (d < 1.6 && (qx * fx + qz * fz) / (d || 1) > 0.4) knockDown(sim, q, p, 6, false, 'shoulder');
      }
      ev({ k: 'barge', p: p.id });
    }
  }
}

// Punches: tap for a jab → hook → uppercut combo (the uppercut floors them); punch on the run for a
// flying knee. Light hits stagger and can shake the ball loose.
function punch(sim, p, fx, fz) {
  const now = sim.t || 0, sp = hyp(p.vx, p.vz);
  p.combo = now - (p.lastPunch ?? -9) < 0.9 && (p.combo || 0) < 3 ? (p.combo || 0) + 1 : 1;
  if (sp > 6) p.combo = 4;                                  // running strike
  p.lastPunch = now;
  p.st = 'punch'; p.pk = p.combo; p.stT = p.combo >= 3 ? 0.55 : 0.32; p.cd = p.combo >= 3 ? 0.6 : 0.18;
  const reach = p.combo === 4 ? 2.0 : 1.55, hits = [];
  for (const q of sim.players) {
    if (q.team === p.team || q.st === 'down' || q.st === 'getup') continue;
    const qx = q.x - p.x, qz = q.z - p.z, d = hyp(qx, qz);
    if (d > reach || Math.abs(wy(q) - wy(p)) > 1.4 || (qx * fx + qz * fz) / (d || 1) < 0.35) continue;
    hits.push(q.id);
    if (p.combo >= 3 || p.rageT > 0) {
      if (p.combo === 3 || (p.rageT > 0 && p.combo < 3)) launch(sim, q, p, qx, qz, 7, 5, 'ko'); else knockDown(sim, q, p, 9, false, 'shoulder');
    } else {
      q.st = 'hit'; q.stT = 0.45; q.rx = p.combo === 1 ? 'head' : 'gut'; q.vx = qx / (d || 1) * 2.5; q.vz = qz / (d || 1) * 2.5;
      const b = sim.ball;
      if (b.owner === q.id && Math.random() < 0.45) { b.owner = -1; b.vx = fx * 5; b.vz = fz * 5; b.vy = 2; }
      p.sp = Math.min(100, p.sp + 3);
    }
  }
  sim.events.push({ k: 'punch', p: p.id, pk: p.combo, hits });
}

// Spider-Man: a web onto the nearest opponent ahead, then zip in feet first
function webZip(sim, p, fx, fz) {
  let best = null, bs = -1e9;
  for (const q of sim.players) {
    if (q.team === p.team || q.st === 'down') continue;
    const qx = q.x - p.x, qz = q.z - p.z, d = hyp(qx, qz);
    if (d < 4 || d > 26 || (qx * fx + qz * fz) / d < 0.55) continue;
    const s = (sim.ball.owner === q.id ? 10 : 0) - d;
    if (s > bs) { bs = s; best = q; }
  }
  if (!best) return false;
  p.st = 'zip'; p.stT = 1.3; p.cd = 4; p.zipT = best.id; p.web = null;
  p.zip = [best.x, wy(best) + 1.2, best.z];
  sim.events.push({ k: 'zip', p: p.id, v: best.id });
  return true;
}

function knockDown(sim, v, by, push, force, rx = 'shoulder') {
  if (v.st === 'down' || v.st === 'getup') return false;
  if (v.phaseT > 0) return false;                             // the Flash phases straight through
  v.carry = false;
  if (v.rageT > 0 && !force) { v.st = 'stagger'; v.stT = 0.2; return false; }   // Baki in a rage doesn't go down
  if (!force && Math.random() < heroOf(v).tough) {          // shrugs it off
    if (v.st !== 'stagger') { v.st = 'stagger'; v.stT = 0.35; v.vx *= 0.3; v.vz *= 0.3; sim.events.push({ k: 'shrug', a: by.id, v: v.id }); }
    return false;
  }
  by.sp = Math.min(100, by.sp + 12); v.hitWall = false; v.web = null;
  const dx = v.x - by.x, dz = v.z - by.z, d = hyp(dx, dz) || 1;
  const b = sim.ball;
  if (b.owner === v.id) {                                  // the ball spills
    b.owner = -1; b.vx = dx / d * 4 + by.vx * 0.5; b.vz = dz / d * 4 + by.vz * 0.5; b.vy = 3;
    b.y = Math.max(b.y, 0.6);
  }
  v.st = 'down'; v.stT = 1.5; v.rx = rx; v.vx = dx / d * push; v.vz = dz / d * push;
  v.yaw = Math.atan2(-dx, -dz);                            // fall backwards, away from the hit
  sim.events.push({ k: 'ko', a: by.id, v: v.id });
  return true;
}
// sent flying: knocked down, thrown along (dx, dz) and up
function launch(sim, v, by, dx, dz, speed, up, rx = 'launch') {
  if (!knockDown(sim, v, by, 0, true, rx)) return;
  const l = hyp(dx, dz) || 1;
  v.vx = dx / l * speed; v.vz = dz / l * speed; v.vy = up; v.y = Math.max(v.y, 0.05); v.stT = 2.2;
  v.yaw = Math.atan2(-dx, -dz);
}

// ── Supers ───────────────────────────────────────────────────────────────────────────────────
// distance from (px, pz) to the segment a→b on the ground, and how far along it (0..1)
function segDist(px, pz, ax, az, bx, bz) {
  const ux = bx - ax, uz = bz - az, l = ux * ux + uz * uz || 1;
  const t = clamp(((px - ax) * ux + (pz - az) * uz) / l, 0, 1);
  return [hyp(px - (ax + ux * t), pz - (az + uz * t)), t];
}
// how far a ray gets before it meets the arena's wall
function rayLen(ox, oy, oz, dx, dy, dz, max = 80) {
  for (let t = 1; t < max; t += 0.5) { const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t; if (Math.abs(x) > HL + 0.3 || sdArena(x, y, z) > -0.2) return t; }
  return max;
}
// the facing direction, pulled towards the goal when roughly facing it (humans only)
function aim(p) {
  let fx = fwdX(p), fz = fwdZ(p);
  if (p.bot) return [fx, fz];
  const gx = (p.team === 0 ? HL : -HL) - p.x, gz = -p.z, gl = hyp(gx, gz);
  if ((gx * fx + gz * fz) / gl > 0.6) { fx = fx * 0.4 + gx / gl * 0.6; fz = fz * 0.4 + gz / gl * 0.6; const l = hyp(fx, fz); fx /= l; fz /= l; }
  return [fx, fz];
}
const foes = (sim, p) => sim.players.filter((q) => q.team !== p.team);
function blastBall(sim, p, dx, dy, dz, speed, ng) {
  const b = sim.ball, l = hyp(dx, dy, dz) || 1;
  b.owner = -1; b.last = p.id; b.vx = dx / l * speed; b.vy = dy / l * speed; b.vz = dz / l * speed; b.ng = ng;
  if (b.y < BALL_R + 0.05) b.y = BALL_R + 0.05;
}

function superMove(sim, p) {
  const h = HEROES[p.char];
  if (!h || p.sp < 100 || p.st !== 'free' || sim.phase !== 'play') return;
  p.sp = 0;
  const b = sim.ball, [fx, fz] = aim(p), ev = { k: 'power', p: p.id, type: h.power };
  const ox = p.x, oz = p.z, gy = wy(p);
  switch (h.power) {
    case 'beam':                                           // charge up, then fire (see step)
      p.st = 'charge'; p.stT = 1.0; p.aimYaw = Math.atan2(fx, fz); p.yaw = p.aimYaw; p.vx = p.vz = 0;
      ev.type = 'charge'; break;
    case 'heat': {
      const d = hyp(b.x - ox, b.y - (gy + 1.7), b.z - oz);
      let ex, ey, ez;
      if (d < 45) {                                         // burn the ball where it is, it flies where you aim
        ex = b.x; ey = b.y; ez = b.z;
        blastBall(sim, p, fx, 0.08, fz, 44, 0.6);            // harder than any shot
      } else { const L = rayLen(ox, gy + 1.7, oz, fx, 0, fz, 35); ex = ox + fx * L; ey = gy + 1.7; ez = oz + fz * L; }
      for (const q of foes(sim, p)) if (segDist(q.x, q.z, ox, oz, ex, ez)[0] < 1.4) launch(sim, q, p, ex - ox, ez - oz, 11, 5);
      p.st = 'power'; p.stT = 0.7; p.yaw = Math.atan2(ex - ox, ez - oz);
      Object.assign(ev, { o: [ox, gy + 1.7, oz], e: [ex, ey, ez] }); break;
    }
    case 'rampage':
      p.st = 'rush'; p.stT = 1.1; p.yaw = Math.atan2(fx, fz); p.vx = fx * 20; p.vz = fz * 20; break;
    case 'quake':
      p.st = 'power'; p.stT = 0.9;
      for (const q of foes(sim, p)) { const dx = q.x - ox, dz = q.z - oz, d = hyp(dx, dz); if (d < 9) launch(sim, q, p, dx, dz, 15 - d, 9 - d * 0.4, 'thrown'); }
      if (hyp(b.x - ox, b.z - oz) < 9) { b.owner = -1; b.vy = 13; b.vx += (b.x - ox) * 0.8; b.vz += (b.z - oz) * 0.8; b.last = p.id; }
      ev.o = [ox, gy, oz]; break;
    case 'clap': {                                       // Hulk: a shockwave ahead, everyone and the ball blown away
      p.st = 'power'; p.stT = 0.8;
      for (const q of foes(sim, p)) {
        const dx = q.x - ox, dz = q.z - oz, d = hyp(dx, dz);
        if (d < 15 && (dx * fx + dz * fz) / (d || 1) > 0.55) launch(sim, q, p, dx, dz, 20 - d * 0.7, 7 - d * 0.25, 'launch');
      }
      const bx = b.x - ox, bz = b.z - oz, bd = hyp(bx, bz);
      if (bd < 15 && (bx * fx + bz * fz) / (bd || 1) > 0.5) blastBall(sim, p, fx, 0.16, fz, 34, 0);
      ev.o = [ox, gy, oz]; break;
    }
    case 'web': {
      const hx = ox + fx * 0.8, hy = gy + 1.2, hz = oz + fz * 0.8, d = hyp(b.x - hx, b.y - hy, b.z - hz);
      p.st = 'power'; p.stT = 0.6;
      if (d < 34 && b.owner !== p.id) {
        blastBall(sim, p, hx - b.x, hy - b.y + d * 0.05, hz - b.z, Math.min(38, 12 + d * 2.6), 0); p.yaw = Math.atan2(b.x - ox, b.z - oz);
        p.webCatch = 1.6; b.webTo = p.id;                   // on the web: it flies past everyone and sticks to him
      }
      // the two opponents nearest him are webbed where they stand
      const near = foes(sim, p).filter((q) => q.st !== 'down').sort((q1, q2) => hyp(q1.x - ox, q1.z - oz) - hyp(q2.x - ox, q2.z - oz)).slice(0, 2).filter((q) => hyp(q.x - ox, q.z - oz) < 14);
      for (const q of near) { if (b.owner === q.id) b.owner = -1; q.st = 'stagger'; q.stT = 1.4; q.vx = q.vz = 0; q.carry = false; }
      Object.assign(ev, { o: [hx, hy, hz], e: [b.x, b.y, b.z], w: near.map((q) => q.id) }); break;
    }
    case 'lightning': {
      p.st = 'power'; p.stT = 0.8;
      for (const q of foes(sim, p)) { const dx = q.x - b.x, dz = q.z - b.z, d = hyp(dx, dz); if (d < 5) launch(sim, q, p, dx, dz, 3, 2, 'shock'); }
      const gx = (p.team === 0 ? HL + 1 : -HL - 1) - b.x, gz = -b.z;
      blastBall(sim, p, gx, hyp(gx, gz) * 0.18, gz, 30, 0);
      Object.assign(ev, { e: [b.x, b.y, b.z] }); break;
    }
    case 'speed': p.boost = 4; ev.o = [ox, gy, oz]; break;
    case 'batarang': {
      let best = null, bd = 30;
      for (const q of foes(sim, p)) { const d = hyp(q.x - ox, q.z - oz); if (q.st !== 'down' && d < bd && ((q.x - ox) * fx + (q.z - oz) * fz) / (d || 1) > 0.2) { bd = d; best = q; } }
      p.st = 'power'; p.stT = 0.5;
      if (best) { launch(sim, best, p, best.x - ox, best.z - oz, 6, 3); Object.assign(ev, { o: [ox, gy + 1.4, oz], e: [best.x, wy(best) + 1.2, best.z] }); }
      else Object.assign(ev, { o: [ox, gy + 1.4, oz], e: [ox + fx * 25, gy + 1.4, oz + fz * 25] });
      break;
    }
    case 'construct':
      p.st = 'power'; p.stT = 0.6; sim.cons = sim.cons.filter((c) => c.team !== p.team); sim.cons.push({ team: p.team, t: 5 }); break;
  }
  sim.events.push(ev);
}

// ── Signature skills (the SKILL button; each hero has their own, on a cooldown) ──────────────
function skillMove(sim, p) {
  const h = heroOf(p);
  if (!h.skill || p.skCd > 0 || p.st !== 'free' || sim.phase !== 'play') return;
  const b = sim.ball, [fx, fz] = aim(p), gy = wy(p), ev = { k: 'skill', p: p.id, type: h.skill };
  const foesNear = (r, cone) => foes(sim, p).filter((q) => q.st !== 'down' && hyp(q.x - p.x, q.z - p.z) < r && (!cone || ((q.x - p.x) * fx + (q.z - p.z) * fz) / (hyp(q.x - p.x, q.z - p.z) || 1) > cone))
    .sort((a, c) => hyp(a.x - p.x, a.z - p.z) - hyp(c.x - p.x, c.z - p.z));
  switch (h.skill) {
    case 'zip': if (!webZip(sim, p, fx, fz)) return; break;
    case 'tp': {                                           // Goku: appear right behind the ball, facing their goal
      const dir = p.team === 0 ? 1 : -1;
      ev.o = [p.x, gy + 1, p.z];
      p.x = b.x - dir * 1.1; p.z = b.z; p.y = b.y > 1.6 ? b.y - 0.6 : 0; p.vx = p.vz = 0; p.vy = 0;
      clampPlayer(p); p.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      ev.e = [p.x, wy(p) + 1, p.z]; break;
    }
    case 'bigbang': case 'missiles': case 'hammer': {
      p.st = 'skill'; p.stT = 0.5;
      const o = [p.x + fx * 0.8, gy + 1.3, p.z + fz * 0.8];
      if (h.skill === 'bigbang') sim.proj.push({ kind: 'bang', x: o[0], y: o[1], z: o[2], vx: fx * 30, vy: 0, vz: fz * 30, t: 1.1, by: p.id, team: p.team });
      else if (h.skill === 'hammer') sim.proj.push({ kind: 'hammer', x: o[0], y: o[1], z: o[2], vx: fx * 28, vy: 0, vz: fz * 28, t: 1.6, out: 0.6, by: p.id, team: p.team, hit: [] });
      else {
        const ts = foesNear(32, -0.2).slice(0, 3);
        for (let i = 0; i < 3; i++) { const a = p.yaw + (i - 1) * 0.5; sim.proj.push({ kind: 'missile', x: o[0], y: o[1] + 0.4, z: o[2], vx: Math.sin(a) * 14, vy: 6, vz: Math.cos(a) * 14, t: 2.6, by: p.id, team: p.team, tgt: ts.length ? ts[i % ts.length].id : -1 }); }
      }
      break;
    }
    case 'dash':                                           // Superman: a flying punch, ground or air
      p.st = 'dash'; p.stT = 0.55; p.vx = fx * 26; p.vz = fz * 26; p.vy = p.y > 0.3 ? 0 : 1.5; p.yaw = Math.atan2(fx, fz); break;
    case 'grapple':                                        // Batman: grapple gun to the ball
      if (hyp(b.x - p.x, b.z - p.z) > 28 || b.owner === p.id) return;
      p.st = 'zip'; p.zipBall = true; p.stT = 1.2; p.zip = [b.x, b.y, b.z]; break;
    case 'grab': {                                         // Yujiro: pick one up and throw them
      const q = foesNear(2.4, 0.2)[0];
      p.st = 'skill'; p.stT = 0.6;
      if (!q) return void sim.events.push(ev);
      launch(sim, q, p, fx, fz, 22, 9, 'thrown'); ev.v = q.id; break;
    }
    case 'shield': {                                       // Green Lantern: a wall of light in front of him
      const cx = p.x + fx * 3, cz = p.z + fz * 3, rx = -fz * 2.6, rz = fx * 2.6;
      sim.walls.push({ x1: cx - rx, z1: cz - rz, x2: cx + rx, z2: cz + rz, h: 3.2, t: 4.5, team: p.team });
      p.st = 'skill'; p.stT = 0.5; break;
    }
    case 'phase': p.phaseT = 2.6; break;
    case 'rage': p.rageT = 5; break;
    case 'leap': p.vy = 13; p.vx = fx * 17; p.vz = fz * 17; p.leapT = 2; break;   // Hulk: up, and smash where he lands
  }
  p.skCd = h.skillCd;
  sim.events.push(ev);
}

// projectiles: Vegeta's Big Bang, Iron Man's missiles, Thor's hammer
function stepProjectiles(sim, dt) {
  const P = sim.players, b = sim.ball;
  for (const q of sim.proj) {
    q.t -= dt;
    const by = P[q.by];
    if (q.kind === 'missile') {                            // home in
      const t = P[q.tgt];
      if (t && t.st !== 'down') {
        const dx = t.x - q.x, dy = wy(t) + 1 - q.y, dz = t.z - q.z, d = hyp(dx, dy, dz) || 1, sp = 24, k = Math.min(1, dt * 4);
        q.vx += (dx / d * sp - q.vx) * k; q.vy += (dy / d * sp - q.vy) * k; q.vz += (dz / d * sp - q.vz) * k;
      } else q.vy -= 6 * dt;
    }
    if (q.kind === 'hammer' && q.t < 1.6 - q.out && by) {   // fly back to Thor's hand
      const dx = by.x - q.x, dy = wy(by) + 1.3 - q.y, dz = by.z - q.z, d = hyp(dx, dy, dz) || 1;
      q.vx = dx / d * 30; q.vy = dy / d * 30; q.vz = dz / d * 30;
      if (d < 1.2) q.t = 0;
    }
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    let boom = q.y < 0.2 || sdArena(q.x, q.y, q.z) > -0.2;
    for (const v of P) {
      if (v.team === q.team || v.st === 'down' || (q.hit && q.hit.includes(v.id))) continue;
      if (hyp(v.x - q.x, wy(v) + 1 - q.y, v.z - q.z) > 1.1) continue;
      if (q.kind === 'hammer') { q.hit.push(v.id); launch(sim, v, by || v, q.vx, q.vz, 10, 4, 'shoulder'); sim.events.push({ k: 'skillhit', p: q.by, v: v.id, type: 'hammer' }); }
      else if (q.kind === 'missile') { launch(sim, v, by || v, q.vx, q.vz, 8, 5, 'launch'); q.t = 0; sim.events.push({ k: 'skillhit', p: q.by, v: v.id, type: 'missile', x: q.x, y: q.y, z: q.z }); }
      else boom = true;
    }
    if (q.kind !== 'bang' && hyp(b.x - q.x, b.y - q.y, b.z - q.z) < 1.2 && b.owner < 0) { b.vx = q.vx * 0.8; b.vy = Math.max(3, q.vy * 0.5); b.vz = q.vz * 0.8; b.last = q.by; }
    if (q.kind === 'bang' && (boom || q.t <= 0)) {         // Big Bang: blow everyone away
      for (const v of P) { const dx = v.x - q.x, dz = v.z - q.z, d = hyp(dx, wy(v) - q.y, dz); if (v.team !== q.team && d < 5.5) launch(sim, v, by || v, dx, dz, 15 - d, 9, 'thrown'); }
      const bd = hyp(b.x - q.x, b.y - q.y, b.z - q.z);
      if (bd < 5.5) { b.owner = -1; b.last = q.by; const l = bd || 1; b.vx = (b.x - q.x) / l * 22; b.vy = 8; b.vz = (b.z - q.z) / l * 22; }
      sim.events.push({ k: 'skillhit', p: q.by, type: 'bang', x: q.x, y: q.y, z: q.z });
      q.t = 0;
    } else if (q.kind === 'missile' && boom) q.t = 0;
  }
  sim.proj = sim.proj.filter((q) => q.t > 0);
}
// push something (a player or the ball) out of a construct wall; true when it bounced
function wallPush(w, o, r) {
  const ux = w.x2 - w.x1, uz = w.z2 - w.z1, L = hyp(ux, uz) || 1, nx = -uz / L, nz = ux / L;
  const t = ((o.x - w.x1) * ux + (o.z - w.z1) * uz) / (L * L);
  if (t < 0 || t > 1 || o.y > w.h) return false;
  const d = (o.x - w.x1) * nx + (o.z - w.z1) * nz;
  if (Math.abs(d) > r + 0.25) return false;
  const s = Math.sign(d) || 1, push = r + 0.25 - Math.abs(d);
  o.x += nx * s * push; o.z += nz * s * push;
  const vn = o.vx * nx + o.vz * nz;
  if (vn * s < 0) { o.vx -= 1.7 * vn * nx; o.vz -= 1.7 * vn * nz; return true; }
  return false;
}

// the Kamehameha / Final Flash leaves the hands at the end of the charge
function fireBeam(sim, p) {
  const b = sim.ball, fx = Math.sin(p.aimYaw), fz = Math.cos(p.aimYaw), gy = wy(p);
  const ox = p.x + fx * 0.9, oy = gy + 1.3, oz = p.z + fz * 0.9, L = rayLen(ox, oy, oz, fx, 0, fz);
  const ex = ox + fx * L, ez = oz + fz * L, wide = HEROES[p.char].label === 'FINAL FLASH' ? 2.2 : 1.7;
  for (const q of sim.players) if (q.team !== p.team && segDist(q.x, q.z, ox, oz, ex, ez)[0] < wide) launch(sim, q, p, fx, fz, 22, 9);
  const [bd, bt] = segDist(b.x, b.z, ox, oz, ex, ez);
  if (bd < wide + 0.8 && Math.abs(b.y - oy) < 3.5 && bt * L < 50) {   // the ball rides the beam
    if (b.owner >= 0 && sim.players[b.owner].st === 'hold') sim.players[b.owner].st = 'free';
    b.y = Math.max(b.y, 0.9); blastBall(sim, p, fx, 0, fz, 48, 1.4);
  }
  p.st = 'power'; p.stT = 0.6;
  sim.events.push({ k: 'power', p: p.id, type: 'beam', o: [ox, oy, oz], e: [ex, oy, ez], w: wide });
}

// ── The step ─────────────────────────────────────────────────────────────────────────────────
export function step(sim, dt = DT) {
  const P = sim.players, b = sim.ball;
  sim.t = (sim.t || 0) + dt;
  if (sim.phase === 'kickoff') { sim.phaseT -= dt; if (sim.phaseT <= 0) { sim.phase = 'play'; sim.events.push({ k: 'whistle' }); } }
  else if (sim.phase === 'play') {
    if (!sim.overtime) {
      sim.clock -= dt;
      if (sim.clock <= 0) {
        sim.clock = 0;
        if (sim.score[0] === sim.score[1]) { sim.overtime = true; sim.events.push({ k: 'overtime' }); }
        else endMatch(sim);
      }
    }
  } else if (sim.phase === 'goal') {
    sim.phaseT -= dt;
    if (sim.phaseT <= 0) {
      if (sim.overtime || (sim.clock <= 0)) endMatch(sim); else resetKickoff(sim);
    }
  } else if (sim.phase === 'end') { sim.endT -= dt; if (sim.endT <= 0) resetMatch(sim); }

  const frozen = sim.phase === 'kickoff' || sim.phase === 'end';
  for (const p of P) {
    if (!p.human) think(sim, p, dt);
    if (sim.phase === 'play') p.sp = Math.min(100, p.sp + SUPER_RATE * dt);
    if (p.st === 'charge' && p.stT - dt <= 0) fireBeam(sim, p);
    movePlayer(p, p.input, dt, frozen);
    p.input.jump = false;
    if (p.smash) {                                         // Hulk Smash: everyone near the landing is thrown, the ball pops up
      p.smash = false;
      for (const q of foes(sim, p)) { const dx = q.x - p.x, dz = q.z - p.z, d = hyp(dx, dz); if (d < 6.5) launch(sim, q, p, dx, dz, 14 - d, 8 - d * 0.6, 'thrown'); }
      const b = sim.ball, bo = b.owner >= 0 ? P[b.owner] : null;
      if ((!bo || bo.team !== p.team) && hyp(b.x - p.x, b.z - p.z) < 6.5) { b.owner = -1; b.vy = 11; b.last = p.id; }
      sim.events.push({ k: 'smash', p: p.id, o: [p.x, 0, p.z] });
    }
    if (p.st === 'dash') {                                 // Superman's flying punch: the first one in the way gets it
      for (const q of P) if (q.team !== p.team && q.st !== 'down' && hyp(q.x - p.x, q.z - p.z) < 1.5 && Math.abs(wy(q) - wy(p)) < 1.8) {
        launch(sim, q, p, p.vx, p.vz, 18, 8, 'ko'); p.st = 'punch'; p.pk = 3; p.stT = 0.4; p.vx *= 0.15; p.vz *= 0.15;
        sim.events.push({ k: 'skillhit', p: p.id, v: q.id, type: 'dash' }); break;
      }
      if (hyp(b.x - p.x, b.y - wy(p) - 1, b.z - p.z) < 1.6) blastBall(sim, p, p.vx, 1, p.vz, 30, 0);
    }
    if (p.st === 'zip' && p.zipBall) {                     // Batman's grapple: reel in to the ball
      const tx = b.x - p.x, ty = b.y - 0.3 - wy(p), tz = b.z - p.z, d = hyp(tx, ty, tz);
      p.zip = [b.x, b.y, b.z];
      if (d < 1.3 || p.stT < 0.05) { p.st = 'free'; p.zipBall = false; p.zip = null; p.vx *= 0.3; p.vz *= 0.3; p.vy = Math.min(p.vy, 1); p.touchCd = 0; }
      else { p.vx = tx / d * 24; p.vy = ty / d * 24; p.vz = tz / d * 24; p.yaw = Math.atan2(tx, tz); }
    } else if (p.st === 'zip') {                           // steer the zip at the target; kick them on arrival
      const q = P[p.zipT];
      if (!q || q.st === 'down') { p.st = 'free'; p.zip = null; }
      else {
        const tx = q.x - p.x, ty = wy(q) + 0.9 - wy(p), tz = q.z - p.z, d = hyp(tx, ty, tz);
        p.zip = [q.x, wy(q) + 1.2, q.z];
        if (d < 1.4) {
          launch(sim, q, p, tx, tz, 14, 6, 'launch');
          p.st = 'dropkick'; p.stT = 0.7; p.vx *= 0.2; p.vz *= 0.2; p.vy = 2; p.zip = null;
          sim.events.push({ k: 'zipkick', p: p.id, v: q.id });
        } else { p.vx = tx / d * 26; p.vy = ty / d * 26; p.vz = tz / d * 26; p.yaw = Math.atan2(tx, tz); }
      }
    }
    if (p.st !== 'zip' && p.zip) p.zip = null;
    if (p.st === 'rush') {                                 // Baki's charge flattens everyone in the way
      for (const q of P) if (q.team !== p.team && hyp(q.x - p.x, q.z - p.z) < 1.5) {
        const side = (q.x - p.x) * p.vz - (q.z - p.z) * p.vx > 0 ? 1 : -1;
        launch(sim, q, p, p.vx + side * p.vz * 0.6, p.vz - side * p.vx * 0.6, 24, 8, 'thrown');
      }
      if (hyp(b.x - p.x, b.z - p.z) < 1.6 && b.y < 1.5) blastBall(sim, p, p.vx, 2, p.vz, 32, 0);
    }
    // thrown into the barrier
    if ((p.st === 'down' || p.st === 'rush') && !p.hitWall && hyp(p.vx, p.vz) > 5 && !(Math.abs(p.z) < GOAL_W && Math.abs(p.x) > HL - RR) && sdPlan(p.x, p.z) > -RR * 0.3 - 0.15) {
      p.hitWall = true;
      sim.events.push({ k: 'barrier', x: p.x, y: wy(p) + 1, z: p.z, s: hyp(p.vx, p.vy, p.vz) });
      if (p.st === 'rush') p.stT = 0;
    }
    if (p.st === 'free') p.hitWall = false;
  }
  for (const p of P) if (p.skCd > 0) p.skCd -= dt;
  stepProjectiles(sim, dt);
  for (const w of sim.walls) w.t -= dt;
  sim.walls = sim.walls.filter((w) => w.t > 0);
  for (const w of sim.walls) for (const p of P) if (p.team !== w.team) wallPush(w, p, PR);
  for (const c of sim.cons) c.t -= dt;
  sim.cons = sim.cons.filter((c) => c.t > 0);
  // bodies
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], c = P[j];
    const dx = c.x - a.x, dz = c.z - a.z, d = hyp(dx, dz), ga = heroOf(a).giant, gc = heroOf(c).giant;
    const rsum = PR * (ga ? 1.6 : 1) + PR * (gc ? 1.6 : 1);
    if (d >= rsum || d < 1e-4 || Math.abs(a.y - c.y) > (ga || gc ? 2 : 1.2) || a.phaseT > 0 || c.phaseT > 0) continue;
    const nx = dx / d, nz = dz / d, o = rsum - d, wa = ga && !gc ? 0.15 : gc && !ga ? 0.85 : 0.5;   // the giant barely moves
    a.x -= nx * o * wa; a.z -= nz * o * wa; c.x += nx * o * (1 - wa); c.z += nz * o * (1 - wa);
    if (a.team !== c.team) {                               // run someone over (a giant only needs a jog)
      const ra = a.vx * nx + a.vz * nz, rc = -(c.vx * nx + c.vz * nz);
      if (a.st === 'slide' || (ra > (ga ? 5.5 : 8.6) && ra > rc + 3)) knockDown(sim, c, a, ga ? 10 : 7, false, a.st === 'slide' ? 'trip' : 'shoulder');
      else if (c.st === 'slide' || (rc > (gc ? 5.5 : 8.6) && rc > ra + 3)) knockDown(sim, a, c, gc ? 10 : 7, false, c.st === 'slide' ? 'trip' : 'shoulder');
    }
    clampPlayer(a); clampPlayer(c);
  }
  if (sim.phase !== 'kickoff' && sim.phase !== 'end') stepBall(sim, dt);
}

function endMatch(sim) {
  sim.phase = 'end'; sim.endT = 9;
  sim.events.push({ k: 'end', score: sim.score.slice() });
}

function stepBall(sim, dt) {
  const b = sim.ball, P = sim.players;
  // a keeper holding it
  if (b.owner >= 0 && P[b.owner].st === 'hold') {
    const p = P[b.owner];
    p.ai.holdT = (p.ai.holdT || 0) + dt;
    if (p.ai.holdT > 5) { p.ai.holdT = 0; act(sim, p, 'shoot', 0.5); }   // can't hold it forever
    else { b.x = p.x + fwdX(p) * 0.45; b.z = p.z + fwdZ(p) * 0.45; b.y = wy(p) + 1.1; b.vx = p.vx; b.vz = p.vz; b.vy = 0; return; }
  }
  if (b.owner >= 0 && P[b.owner].st !== 'free') b.owner = -1;

  // who has it at their feet
  let ctrl = null, cd = 1e9;
  for (const p of P) p.carry = false;
  for (const p of P) {
    if ((p.st !== 'free' && !(p.webCatch > 0 && p.st === 'power')) || p.touchCd > 0) continue;
    const air = p.y > 0.3;
    if (air && !heroOf(p).fly) continue;
    if (air) {                                             // a flyer picks it up mid-air
      const d3 = hyp(b.x - p.x, Math.max(0, b.y - (wy(p) + 0.6)) + Math.max(0, wy(p) - 0.2 - b.y) * 0.6, b.z - p.z);   // anywhere from the feet to the chest
      if (d3 < 1.6 && d3 - (p.id === b.owner ? 0.35 : 0) < cd) { cd = d3 - (p.id === b.owner ? 0.35 : 0); ctrl = p; }
      continue;
    }
    const wc = p.webCatch > 0;                             // Spider-Man reeling in his web pull
    if (b.y >= (wc ? 2.4 : p.bot ? 0.95 : 1.3)) continue;  // humans can trap a bouncing ball up to the chest
    const d = hyp(b.x - p.x, b.z - p.z);
    if (d > (wc ? 2.6 : p.bot ? 1.05 : 1.35)) continue;    // humans pick it up from a little further
    const rel = hyp(b.vx - p.vx, b.vz - p.vz);
    if (rel > 15 && !wc) continue;
    let s = d - (p.id === b.owner ? 0.35 : 0);
    // challenging the carrier: stay on the ball for a moment and you win it (bodies can't
    // overlap, so without this a carrier who stands still could never lose it)
    const carrier = b.owner >= 0 ? P[b.owner] : null;
    if (carrier && carrier !== p && carrier.team !== p.team && d < 1.15) {
      p.contest = (p.contest || 0) + dt;
      if (p.contest > 0.25 * (1 + heroOf(carrier).tough * 0.6)) s -= 2;   // tougher carriers hold on a bit longer
    } else p.contest = 0;
    if (s < cd) { cd = s; ctrl = p; }
  }
  if (ctrl) {
    if (ctrl.st === 'power') { ctrl.st = 'free'; ctrl.stT = 0; ctrl.webCatch = 0; }   // caught his web pull: straight on the ball
    if (b.owner !== ctrl.id) {
      if (b.owner >= 0 && P[b.owner].team !== ctrl.team) sim.events.push({ k: 'steal', p: ctrl.id, v: b.owner });
      sim.events.push({ k: 'touch', p: ctrl.id }); ctrl.sp = Math.min(100, ctrl.sp + 6); ctrl.contest = 0;
    }
    b.owner = ctrl.id; b.last = ctrl.id;
    if (ctrl.y > 0.3) {                                    // carried in the air: held just in front of the feet
      ctrl.carry = true;
      b.x = ctrl.x + fwdX(ctrl) * 0.6; b.z = ctrl.z + fwdZ(ctrl) * 0.6; b.y = Math.max(BALL_R, wy(ctrl) + 0.35);
      b.vx = ctrl.vx; b.vy = ctrl.vy; b.vz = ctrl.vz; b.ng = Math.max(b.ng || 0, dt * 1.5);
    }
    const tx = ctrl.x + fwdX(ctrl) * 0.75, tz = ctrl.z + fwdZ(ctrl) * 0.75;
    const glue = ctrl.bot ? 9 : 15;                      // a human's ball stays stuck in front of them through turns
    const wx = ctrl.vx + (tx - b.x) * glue, wz = ctrl.vz + (tz - b.z) * glue, k = Math.min(1, (ctrl.bot ? 16 : 26) * dt);
    if (!ctrl.carry) { b.vx += (wx - b.vx) * k; b.vz += (wz - b.vz) * k; }
  } else if (b.owner >= 0) b.owner = -1;

  // keepers catch loose balls in their box
  if (b.owner < 0 && !(b.ng > 0)) for (const p of P) {
    if (p.role !== 'gk' || !(p.st === 'free' || p.st === 'dive') || !inOwnBox(p)) continue;
    const r = p.st === 'dive' ? 1.6 : 1.1, d = hyp(b.x - p.x, b.y - (wy(p) + 1.0), b.z - p.z);
    if (d > r || b.y > 2.7 || p.touchCd > 0) continue;
    const sp = hyp(b.vx, b.vy, b.vz);
    if (sp > 30) {                                         // too hot to hold: parry
      const nx = (b.x - p.x) / (d || 1), nz = (b.z - p.z) / (d || 1);
      b.vx = nx * sp * 0.35 + (p.team === 0 ? 6 : -6); b.vz = nz * sp * 0.35; b.vy = 4; p.touchCd = 0.4;
      sim.events.push({ k: 'save', p: p.id });
    } else {
      p.st = 'hold'; p.stT = 0; p.ai.holdT = 0; p.vx *= 0.3; p.vz *= 0.3;
      b.owner = p.id; b.last = p.id;
      p.yaw = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
      sim.events.push({ k: 'save', p: p.id, caught: 1 });
      return;
    }
  }

  // bodies, sliding feet and headers
  if (b.webTo !== undefined && !(P[b.webTo]?.webCatch > 0)) delete b.webTo;
  for (const p of P) {
    if (b.webTo !== undefined && p.id !== b.webTo) continue;
    if (p.id === b.owner || b.ng > 0) continue;            // power shots go straight through
    if (p.st === 'slide' && hyp(b.x - p.x, b.z - p.z) < 1.2 && b.y < 0.8 && p.touchCd <= 0) {
      kickBall(sim, p, fwdX(p), fwdZ(p), 11, 2); sim.events.push({ k: 'kick', p: p.id, pw: 0.4 }); continue;
    }
    if (p.y > 0.25 && (p.st === 'free') && p.touchCd <= 0) {
      const d = hyp(b.x - p.x, b.y - (wy(p) + 1.65), b.z - p.z);
      if (d < 0.8) {
        p.st = 'header'; p.stT = 0.5;
        kickBall(sim, p, fwdX(p), fwdZ(p), 13 + hyp(p.vx, p.vz) * 0.3, b.y > wy(p) + 1.75 ? 3 : 0.5);
        sim.events.push({ k: 'kick', p: p.id, pw: 0.5, head: 1 }); continue;
      }
    }
    // capsule from feet to head
    const top = p.st === 'down' || p.st === 'slide' || p.st === 'dive' ? 0.5 : 1.7;
    const py = wy(p), cy = clamp(b.y, py + 0.2, py + top);
    const dx = b.x - p.x, dy = b.y - cy, dz = b.z - p.z, d = hyp(dx, dy, dz), rr = BALL_R + 0.33;
    if (p.webCatch > 0 && d < rr + 0.6 && b.owner < 0) {   // his web pull lands in his hands, not off his chest
      b.owner = p.id; b.vx = p.vx; b.vy = 0; b.vz = p.vz; p.st = 'free'; p.stT = 0; p.webCatch = 0; p.touchCd = 0; delete b.webTo; continue;
    }
    if (d < rr && d > 1e-4) {
      const nx = dx / d, ny = dy / d, nz = dz / d;
      b.x = p.x + nx * rr; b.y = cy + ny * rr; b.z = p.z + nz * rr;
      const rvx = b.vx - p.vx, rvy = b.vy - p.vy, rvz = b.vz - p.vz, rn = rvx * nx + rvy * ny + rvz * nz;
      if (rn < 0) { b.vx -= 1.4 * rn * nx; b.vy -= 1.4 * rn * ny; b.vz -= 1.4 * rn * nz; }
      b.last = p.id;
    }
  }

  // flight
  const ground = b.y <= BALL_R + 0.01;
  if (b.ng > 0) b.ng -= dt;                                // a power shot flies dead straight for a moment
  else {
    const drag = ground ? 1 - 0.9 * dt : 1 - 0.12 * dt;
    b.vx *= drag; b.vz *= drag; if (!ground) b.vy *= 1 - 0.12 * dt;
    b.vy -= G * dt;
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < 0) { b.vy = -b.vy * 0.55; if (b.vy < 1.2) b.vy = 0; } }
  const ax = Math.abs(b.x), sx = Math.sign(b.x);
  if (ax > HL) {                                           // in the goal: the net
    if (Math.abs(b.z) > GOAL_W - BALL_R) { b.z = Math.sign(b.z) * (GOAL_W - BALL_R); b.vz = -b.vz * 0.25; }
    if (ax > HL + GOAL_D - BALL_R) { b.x = sx * (HL + GOAL_D - BALL_R); b.vx = -b.vx * 0.2; }
    if (b.y > GOAL_H - BALL_R) { b.y = GOAL_H - BALL_R; b.vy = -Math.abs(b.vy) * 0.2; }
  } else if (inMouth(b.x, b.z) && b.y < GOAL_H) {
    // in front of the goal the floor runs flat into the net
  } else if (inMouth(b.x, b.z)) {                          // the wall above the goal
    if (ax > HL - BALL_R) { b.x = sx * (HL - BALL_R); if (b.vx * sx > 0) { b.vx = -b.vx * 0.6; wallHit(sim); } }
    if (b.y > CEIL - BALL_R) { b.y = CEIL - BALL_R; b.vy = -Math.abs(b.vy) * 0.6; }
  } else {                                                 // walls, ramps, corners, ceiling
    const d = sdArena(b.x, b.y, b.z);
    if (d > -BALL_R) {
      const e = 0.01;
      let nx = sdArena(b.x + e, b.y, b.z) - sdArena(b.x - e, b.y, b.z);
      let ny = sdArena(b.x, b.y + e, b.z) - sdArena(b.x, b.y - e, b.z);
      let nz = sdArena(b.x, b.y, b.z + e) - sdArena(b.x, b.y, b.z - e);
      const l = hyp(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const o = d + BALL_R; b.x -= nx * o; b.y -= ny * o; b.z -= nz * o;
      const vn = b.vx * nx + b.vy * ny + b.vz * nz;
      if (vn > 0) {
        const k = vn > 3 ? 1.6 : 1.0;                     // soft touch: roll along the curve; hard: bounce
        b.vx -= k * vn * nx; b.vy -= k * vn * ny; b.vz -= k * vn * nz;
        if (vn > 6) wallHit(sim);
      }
    }
  }
  for (const w of sim.walls) if (wallPush(w, b, BALL_R) && hyp(b.vx, b.vz) > 6) sim.events.push({ k: 'barrier', x: b.x, y: b.y, z: b.z, s: 10, con: w.team });
  // Green Lantern's wall across the goal
  for (const c of sim.cons) {
    const s = c.team === 0 ? -1 : 1, wx = s * (HL - 0.8);
    if (Math.abs(b.z) < GOAL_W + 1 && b.y < GOAL_H + 1 && b.x * s > wx * s - BALL_R && b.x * s < HL * s + 0.5) {
      b.x = wx - s * BALL_R; if (b.vx * s > 0) { b.vx = -b.vx * 0.7; sim.events.push({ k: 'barrier', x: wx, y: b.y, z: b.z, s: 10, con: c.team }); }
    }
  }
  // posts and bar
  for (const s of [1, -1]) for (const zs of [1, -1]) segBounce(sim, b, s * HL, 0, zs * GOAL_W, s * HL, GOAL_H, zs * GOAL_W);
  for (const s of [1, -1]) segBounce(sim, b, s * HL, GOAL_H, -GOAL_W, s * HL, GOAL_H, GOAL_W);

  // goal?
  if (sim.phase === 'play' && Math.abs(b.x) > HL + BALL_R && Math.abs(b.z) < GOAL_W && b.y < GOAL_H) {
    const team = b.x > 0 ? 0 : 1;
    sim.score[team]++;
    const sc = b.last >= 0 ? P[b.last] : null;
    sim.events.push({ k: 'goal', team, p: sc ? sc.id : -1, own: sc && sc.team !== team ? 1 : 0 });
    sim.phase = 'goal'; sim.phaseT = 3.5; sim.kickTeam = 1 - team;
    for (const p of P) if (p.st === 'free' || p.st === 'hold') { if (p.team === team) { p.st = 'cheer'; p.stT = 3; } else if (!p.human) { p.st = 'sad'; p.stT = 3; } }
  }
}

function wallHit(sim) { const b = sim.ball, s = hyp(b.vx, b.vy, b.vz); if (s > 6) sim.events.push({ k: 'wall', s, x: b.x, y: b.y, z: b.z }); }

function segBounce(sim, b, ax, ay, az, bx, by, bz) {
  const R = BALL_R + 0.06;
  const ux = bx - ax, uy = by - ay, uz = bz - az, ul = ux * ux + uy * uy + uz * uz;
  const t = clamp(((b.x - ax) * ux + (b.y - ay) * uy + (b.z - az) * uz) / ul, 0, 1);
  const cx = ax + ux * t, cy = ay + uy * t, cz = az + uz * t;
  const dx = b.x - cx, dy = b.y - cy, dz = b.z - cz, d = hyp(dx, dy, dz);
  if (d >= R || d < 1e-5) return;
  const nx = dx / d, ny = dy / d, nz = dz / d, vn = b.vx * nx + b.vy * ny + b.vz * nz;
  b.x = cx + nx * R; b.y = cy + ny * R; b.z = cz + nz * R;
  if (vn < 0) { b.vx -= 1.75 * vn * nx; b.vy -= 1.75 * vn * ny; b.vz -= 1.75 * vn * nz; if (vn < -4) sim.events.push({ k: 'post' }); }
}

// ── Bots ─────────────────────────────────────────────────────────────────────────────────────
function think(sim, p, dt) {
  const inp = p.input, ai = p.ai;
  inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.jump = false; inp.hold = false;
  ai.react -= dt * (0.45 + 0.55 * lvl(sim));               // weaker bots think slower
  p.bot = true; p.lvl = lvl(sim);
  if (sim.phase !== 'play') return;
  const b = sim.ball, dir = p.team === 0 ? 1 : -1, own = -dir * HL, opp = dir * HL;
  if (p.sp >= 100 && p.st === 'free' && ai.react <= 0 && Math.random() < 0.25 + 0.75 * lvl(sim) && botSuper(sim, p, dir, own, opp)) return;
  if (!(p.skCd > 0) && p.st === 'free' && ai.react <= 0 && Math.random() < 0.3 + 0.7 * lvl(sim) && botSkill(sim, p, dir, own, opp)) return;
  const bx = b.x + b.vx * 0.3, bz = b.z + b.vz * 0.3;
  const goTo = (x, z, sprint, slow = 1) => {
    const dx = x - p.x, dz = z - p.z, d = hyp(dx, dz);
    if (d < 0.35) return;
    const s = Math.min(1, d / 1.5) * slow;
    inp.mx = dx / d * s; inp.mz = dz / d * s; inp.sprint = sprint && d > 3 && p.stam > 25;
  };
  const owner = b.owner >= 0 ? sim.players[b.owner] : null;

  if (p.role === 'gk') {
    if (p.st === 'hold') {
      ai.hold += dt;
      if (ai.hold > 1.2) {
        ai.hold = 0;
        const m = bestMate(sim, p, true);
        if (m) p.yaw = Math.atan2(m.x - p.x, m.z - p.z);
        act(sim, p, Math.random() < 0.3 ? 'shoot' : 'pass', 0.6);
      }
      return;
    }
    const nearBall = Math.abs(b.x - own) < 7.5 && Math.abs(b.z) < 8;
    const sp = hyp(b.vx, b.vz);
    if (nearBall && (sp < 9 || (owner && owner.team !== p.team))) goTo(bx, bz, true);
    else goTo(own + dir * 1.0, clamp(bz * 0.45, -GOAL_W + 0.5, GOAL_W - 0.5), false);
    if (b.owner < 0 && Math.sign(b.vx) === -dir && Math.abs(b.vx) > 7 && p.cd <= 0 && ai.react <= 0) {
      const t = (p.x - b.x) / b.vx;
      if (t > 0 && t < 0.6) {
        const zAt = b.z + b.vz * t;
        ai.react = 0.4;
        if (Math.abs(zAt) < GOAL_W + 0.6 && Math.abs(zAt - p.z) > 0.9 && Math.random() < 0.4 + 0.4 * lvl(sim)) act(sim, p, 'tackle');
      }
    }
    return;
  }

  if (owner === p) {
    const gz = clamp(ai.aimZ, -GOAL_W + 0.7, GOAL_W - 0.7);
    const dG = hyp(opp - p.x, gz - p.z);
    let press = null;
    for (const f of sim.players) if (f.team !== p.team && f.st !== 'down' && hyp(f.x - p.x, f.z - p.z) < 2.6 && (f.x - p.x) * dir > -0.5) press = f;
    if (ai.react <= 0) {
      ai.react = 0.25;
      if (dG < 22 && Math.random() < 0.6) {
        p.yaw = Math.atan2(opp - p.x, gz - p.z) + (Math.random() - 0.5) * (0.12 + 0.5 * (1 - lvl(sim)));   // weaker bots miss more
        act(sim, p, 'shoot', clamp(dG / 22, 0.45, 0.95)); ai.react = 0.8; ai.aimZ = (Math.random() - 0.5) * 4; return;
      }
      if (press && Math.random() < 0.45) {
        const m = bestMate(sim, p, true);
        if (m) { p.yaw = Math.atan2(m.x - p.x, m.z - p.z); act(sim, p, 'pass'); ai.react = 0.8; return; }
      }
    }
    let tz = gz;
    if (press) tz = p.z + (p.z > press.z ? 4 : -4);
    goTo(opp, clamp(tz, -HW + 1.5, HW - 1.5), p.stam > 35);
    return;
  }

  const outs = sim.players.filter((q) => q.team === p.team && q.role !== 'gk' && q.st !== 'down')
    .sort((a, c) => hyp(a.x - bx, a.z - bz) - hyp(c.x - bx, c.z - bz));
  const rank = outs.indexOf(p), dB = hyp(b.x - p.x, b.z - p.z);
  const ours = owner && owner.team === p.team;
  if ((rank === 0 && !ours) || dB < 2.2) {
    goTo(bx, bz, p.stam > 60 || Math.random() < 0.4 + 0.6 * lvl(sim));
    const dO = owner && owner.team !== p.team ? hyp(owner.x - p.x, owner.z - p.z) : 99;
    if (dO < 1.8 + 0.8 * lvl(sim) && p.cd <= 0 && ai.react <= 0) {
      ai.react = 0.35 + 0.6 * (1 - lvl(sim));
      const r = Math.random(), go = 0.3 + 0.5 * lvl(sim); p.yaw = Math.atan2(owner.x - p.x, owner.z - p.z);
      if (dO < 1.5 && r < go * 0.6) act(sim, p, 'punch'); else if (r < go) act(sim, p, 'tackle');
    } else if (heroOf(p).swing && dO > 6 && dO < 24 && p.cd <= 0 && ai.react <= 0) {
      ai.react = 0.6;
      if (Math.random() < 0.35) { p.yaw = Math.atan2(owner.x - p.x, owner.z - p.z); act(sim, p, 'skill'); }
    }
    if (b.y > 1.3 && b.y < 2.8 && dB < 1.8 && b.vy < 0) inp.jump = true;
    if (heroOf(p).fly && b.y > 2.6 && dB < 6) { inp.hold = true; if (p.y < 0.05) inp.jump = true; }
    return;
  }
  const r = rank < 0 ? 3 : rank;
  if (ours) {                                              // spread out, get ahead
    const zs = [0, -6, 6, 0][r] + (r === 3 ? 0 : 0);
    goTo(clamp(b.x + dir * [0, 8, 6, -6][r], -HL + 3, HL - 3), clamp(zs || -b.z * 0.4, -HW + 2, HW - 2), r !== 3);
  } else if (r === 1) {
    goTo((b.x + own) / 2, b.z * 0.5, true);               // cover the goal
  } else if (r === 2) {
    goTo(clamp(b.x - dir * 4, -HL + 3, HL - 3), clamp(b.z > 0 ? b.z - 6 : b.z + 6, -HW + 2, HW - 2), false);
  } else {
    goTo(clamp(own + dir * 9, -HL + 3, HL - 3), clamp(b.z * 0.4, -5, 5), false);
  }
}

// when a bot should use its signature skill
function botSkill(sim, p, dir, own, opp) {
  const b = sim.ball, h = heroOf(p); if (!h.skill || p.role === 'gk') return false;
  const owner = b.owner >= 0 ? sim.players[b.owner] : null, dB = hyp(b.x - p.x, b.z - p.z);
  const foeOwner = owner && owner.team !== p.team ? owner : null, dO = foeOwner ? hyp(foeOwner.x - p.x, foeOwner.z - p.z) : 99;
  const face = (x, z) => { p.yaw = Math.atan2(x - p.x, z - p.z); };
  let go = false;
  switch (h.skill) {
    case 'tp': go = !owner && dB > 14; break;
    case 'bigbang': case 'missiles': case 'hammer': go = dO < 24; if (go) face(foeOwner.x, foeOwner.z); break;
    case 'dash': go = dO < 12; if (go) face(foeOwner.x, foeOwner.z); break;
    case 'grapple': go = !owner && dB > 8 && dB < 26; break;
    case 'grab': go = dO < 2.2; if (go) face(foeOwner.x, foeOwner.z); break;
    case 'shield': go = Math.abs(b.x - own) < 22 && Math.sign(b.vx) === -dir && Math.abs(b.vx) > 8; if (go) face(b.x, b.z); break;
    case 'phase': go = owner === p && foes(sim, p).some((q) => hyp(q.x - p.x, q.z - p.z) < 3); break;
    case 'rage': go = foes(sim, p).filter((q) => hyp(q.x - p.x, q.z - p.z) < 6).length >= 2; break;
    case 'leap': go = dO > 6 && dO < 15; if (go) face(foeOwner.x, foeOwner.z); break;
  }
  p.ai.react = go ? 0.6 : 0.25;
  if (go) act(sim, p, 'skill');
  return go;
}

// when a bot should use its super (and turned the right way first)
function botSuper(sim, p, dir, own, opp) {
  const b = sim.ball, h = HEROES[p.char]; if (!h) return false;
  const owner = b.owner >= 0 ? sim.players[b.owner] : null, dB = hyp(b.x - p.x, b.z - p.z), dG = hyp(opp - p.x, p.z);
  const face = (x, z) => { p.yaw = Math.atan2(x - p.x, z - p.z); };
  const near = (r) => foes(sim, p).filter((q) => q.st !== 'down' && hyp(q.x - p.x, q.z - p.z) < r);
  let go = false;
  switch (h.power) {
    case 'beam': go = (owner === p || dB < 2.5) && dG < 45; if (go) face(opp, (Math.random() - 0.5) * 3); break;
    case 'heat': go = dB < 40 && (!owner || owner.team !== p.team) && hyp(opp - b.x, b.z) < 50; if (go) face(opp, 0); break;
    case 'rampage': go = owner && owner.team !== p.team && hyp(owner.x - p.x, owner.z - p.z) < 12; if (go) face(owner.x, owner.z); break;
    case 'quake': go = near(8).length >= 2 || (owner && owner.team !== p.team && hyp(owner.x - p.x, owner.z - p.z) < 6); break;
    case 'web': go = !owner && dB > 7 && dB < 30; break;
    case 'clap': { const ahead = near(12).filter((q) => ((q.x - p.x) * dir) > 0).length; go = ahead >= 2 || (owner === p && hyp(opp - p.x, p.z) < 26); if (go && owner === p) face(opp, 0); break; }
    case 'lightning': go = hyp(opp - b.x, b.z) < 30 || (owner && owner.team !== p.team && dB < 30); break;
    case 'speed': go = dB > 15; break;
    case 'batarang': go = owner && owner.team !== p.team && dB < 28; if (go) face(owner.x, owner.z); break;
    case 'construct': go = Math.abs(b.x - own) < 25 && Math.sign(b.vx) === -dir && Math.abs(b.vx) > 6; break;
  }
  if (!go) { p.ai.react = 0.3; return false; }
  act(sim, p, 'super');
  p.ai.react = 0.8;
  return true;
}

// ── Wire format ──────────────────────────────────────────────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100;
export function snapshot(sim) {
  const b = sim.ball;
  return {
    t: 's', ar: sim.arena, ph: sim.phase, pt: r2(sim.phaseT), ck: r2(sim.clock), ot: sim.overtime ? 1 : 0, sc: sim.score,
    b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.owner],
    p: sim.players.map((p) => [r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz), r2(p.yaw), p.st, r2(p.stT), Math.round(p.stam), r2(p.cd), Math.floor(p.sp), r2(p.boost), p.web ? [r2(p.web[0]), r2(p.web[1]), r2(p.web[2]), r2(p.webL)] : 0, p.rx || 0, p.pk || 0, p.zip ? p.zip.map(r2) : 0, Math.max(0, r2(p.skCd || 0)), p.phaseT > 0 ? 1 : 0, p.rageT > 0 ? 1 : 0, p.carry ? 1 : 0]),
    proj: sim.proj.map((q) => [q.kind, r2(q.x), r2(q.y), r2(q.z)]),
    walls: sim.walls.map((w) => [r2(w.x1), r2(w.z1), r2(w.x2), r2(w.z2), w.h, w.team]),
    cons: sim.cons.map((c) => [c.team, r2(c.t)]),
    ev: sim.events,
  };
}
export function roster(sim) {
  return sim.players.map((p) => ({ id: p.id, name: p.name, char: p.char, team: p.team, role: p.role, human: p.human }));
}
