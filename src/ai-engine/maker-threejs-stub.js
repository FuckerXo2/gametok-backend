// 3D (three.js) main.ts stub generator for the threejs-kernel template.
// Produces a lane-aware skeleton so the Phase 2 agent only fills in
// game-specific functions — not a full engine from scratch.

function asString(value, fallback = '') {
    const str = String(value ?? '').trim();
    return str || fallback;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-/g, '_') || 'value';
}

function jsString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

// Region markers (runner lane only — experiment scoped to threejs_runner). They
// fence the pre-wired runtime (state/input/loop/render/reset/probe) the Phase 2
// agent must reproduce verbatim from the gameplay it may re-theme. Comments only:
// no behavior change. Drift away from these is telemetry, not yet enforced.
export const RUNNER_SACRED_START_MARKER = '// ===== GAMETOK:SACRED START — do not edit (pre-wired runtime: state, input, loop, render, reset, probe) =====';
export const RUNNER_SACRED_END_MARKER = '// ===== GAMETOK:SACRED END =====';
export const RUNNER_EDIT_START_MARKER = '// ===== GAMETOK:EDIT START — themed gameplay only (setupScene/createObstacle/movePlayer/checkCollisions/updateCamera; keep names + params) =====';
export const RUNNER_EDIT_END_MARKER = '// ===== GAMETOK:EDIT END =====';

export function isThreeFoundation(foundation = {}) {
    const dimension = String(foundation?.dimension || '').toUpperCase();
    const lane = String(foundation?.lane || '').toLowerCase();
    return dimension === '3D' || lane.includes('threejs') || lane.includes('voxel_world');
}

export function buildThreeMainTsStubFromFoundation(foundation = {}, qualityIntent = {}) {
    const title = asString(foundation.title, qualityIntent.title || 'GameTok 3D Game');
    const lane = asString(foundation.lane, 'threejs_world');
    const cameraRig = asString(foundation.cameraRig, 'third_person_chase');
    const statusCopy = asString(foundation.statusCopy, 'Tap to play!');
    const implNotes = asArray(foundation.implementationNotes).slice(0, 8)
        .map((note) => `// ${note}`)
        .join('\n');

    const reservedProbes = new Set(['snapshot', 'step', 'reset']);
    const extraProbes = [];
    for (const probe of asArray(foundation.probeMethods)) {
        const name = asString(probe?.name);
        if (!name || reservedProbes.has(name)) continue;
        reservedProbes.add(name);
        extraProbes.push(`  ${name}(...args) { return null; },`);
    }
    const extraProbeStr = extraProbes.join('\n');

    // Lane-specific skeleton — runner is the most common 3D lane
    const isRunner = lane.includes('runner') || lane.includes('surfer') || lane.includes('dash');
    const isRacer = lane.includes('racer') || lane.includes('racing') || lane.includes('kart');
    const isVoxel = lane.includes('voxel');

    if (isRunner) {
        return buildRunnerStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString });
    }
    if (isRacer) {
        return buildRacerStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString });
    }
    // Generic fallback for voxel_world, threejs_world, etc.
    return buildGenericStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString });
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNNER skeleton (subway surfers, snowboard, endless runner, etc.)
// main.ts is fully pre-wired. AI writes ONLY src/scene.ts + src/mechanics.ts.
// ─────────────────────────────────────────────────────────────────────────────
function buildRunnerStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString }) {
    const hudBlocks = [];
    const hudSeen = new Set();
    for (const block of asArray(foundation.hudBlocks)) {
        const id = slugify(block);
        if (hudSeen.has(id)) continue;
        hudSeen.add(id);
        hudBlocks.push({ id, label: String(block) });
    }
    const extraHudRefs = hudBlocks
        .filter((b) => b.id !== 'score')
        .map((b) => `  ${b.id}: document.getElementById('${b.id}-value'),`)
        .join('\n');
    const extraHudSync = hudBlocks
        .filter((b) => b.id !== 'score')
        .map((b) => `  if (hud.${b.id}) hud.${b.id}.textContent = String(state.${b.id} ?? 0);`)
        .join('\n');

    return `// @ts-nocheck
// GameTok 3D runner — SINGLE FILE. Everything (state, refs, loop, probe, and the
// five game functions) lives in this one file and ALREADY RUNS as a playable game.
// Foundation: ${foundation.foundationId || 'dynamic'} (${lane}) — camera: ${cameraRig}
//
// Phase 2: ENHANCE the five functions (setupScene, createObstacle, movePlayer,
//   checkCollisions, updateCamera) to match the game's theme — better player shape,
//   themed obstacles, colors, fog. Keep their names + parameters, keep refs.player
//   set in setupScene, keep createObstacle returning a mesh. Leave the pre-wired
//   state, input, game loop, and probe exactly as they are.
${implNotes}
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

${RUNNER_SACRED_START_MARKER}
// ─── KERNEL SETUP ────────────────────────────────────────────────────────────
const canvasEl = document.getElementById('game-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('Missing #game-canvas');
const stage = createThreeStage(canvasEl);
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;

// ─── HUD ─────────────────────────────────────────────────────────────────────
const statusLine = document.getElementById('status-line');
const hud = {
  score: document.getElementById('score-value'),
${extraHudRefs}
};

// ─── SHARED PLAYER REFERENCE (set by setupScene, read by movePlayer/collisions) ──
const refs = { player: null };

// ─── GAME STATE ───────────────────────────────────────────────────────────────
const state = {
  score: 0,
  gameOver: false,
  started: false,
  playerX: 0,
  playerZ: 0,
  targetX: 0,
  speed: 8,
  spawnTimer: 0,
  spawnInterval: 2.2,
  obstacles: [],
  inputDir: 0,
  lastTick: performance.now(),
};

// ─── INPUT (pre-wired — touch + keyboard) ────────────────────────────────────
let _touchX = 0;
window.addEventListener('touchstart', (e) => {
  _touchX = e.touches[0].clientX;
  if (!state.started && !state.gameOver) state.started = true;
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  const dx = e.touches[0].clientX - _touchX;
  state.inputDir = dx > 18 ? 1 : dx < -18 ? -1 : 0;
}, { passive: true });
window.addEventListener('touchend', () => { state.inputDir = 0; _touchX = 0; }, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') state.inputDir = -1;
  if (e.key === 'ArrowRight' || e.key === 'd') state.inputDir =  1;
  if (!state.started && !state.gameOver) state.started = true;
});
window.addEventListener('keyup', (e) => {
  if (['ArrowLeft','ArrowRight','a','d'].includes(e.key)) state.inputDir = 0;
});
window.addEventListener('pointerdown', () => { if (state.gameOver) resetGame(); });
${RUNNER_SACRED_END_MARKER}

${RUNNER_EDIT_START_MARKER}
// ════════════════════════════════════════════════════════════════════════════
//  These five functions ALREADY WORK — the game is playable as-is. Phase 2 should
//  ENHANCE the visuals to match the theme (player shape/colors, obstacle props,
//  scenery, fog), keeping each function's name, parameters, and core behavior:
//    • setupScene MUST still set refs.player and add a ground.
//    • createObstacle MUST still return a mesh added to the scene.
//    • movePlayer/checkCollisions/updateCamera keep their (param) signatures.
//  Flat colors only (MeshLambertMaterial hex). Never import anything; never
//  redeclare state; never rename these functions or change their parameters.
// ════════════════════════════════════════════════════════════════════════════

/** Build the slope, the player character, and environment. Sets refs.player.
 *  ENHANCE: give the player a themed shape and color the world to fit the game. */
function setupScene(scene, camera) {
  scene.background = new THREE.Color('#bfe3f2');
  scene.fog = new THREE.Fog('#bfe3f2', 30, 130);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 1200),
    new THREE.MeshLambertMaterial({ color: '#eef6fb' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -560;
  scene.add(ground);
  const player = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.85, 0.42),
    new THREE.MeshLambertMaterial({ color: '#2563eb' }),
  );
  body.position.y = 0.6;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshLambertMaterial({ color: '#fcd9b6' }),
  );
  head.position.y = 1.18;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.12, 1.5),
    new THREE.MeshLambertMaterial({ color: '#f59e0b' }),
  );
  board.position.y = 0.08;
  player.add(body); player.add(head); player.add(board);
  player.position.set(0, 0, 0);
  scene.add(player);
  refs.player = player;
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, -6);
}

/** Build and return ONE obstacle ahead of the player (added to the scene).
 *  ENHANCE: make the obstacle a themed prop (tree, rock, sign…). Must return it. */
function createObstacle(scene, playerZ) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 1.0, 6),
    new THREE.MeshLambertMaterial({ color: '#92400e' }),
  );
  trunk.position.y = 0.5;
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 1.7, 7),
    new THREE.MeshLambertMaterial({ color: '#166534' }),
  );
  top.position.y = 1.55;
  tree.add(trunk); tree.add(top);
  tree.position.set((Math.random() - 0.5) * 9, 0, playerZ - 50 - Math.random() * 28);
  scene.add(tree);
  return tree;
}

/** Steer + advance the player. ENHANCE: add lean/animation, keep the (state, dt) shape. */
function movePlayer(state, dt) {
  const dtSec = dt / 1000;
  state.targetX = Math.max(-4.2, Math.min(4.2, state.targetX + state.inputDir * 7 * dtSec));
  state.playerX = THREE.MathUtils.lerp(state.playerX, state.targetX, 0.14);
  state.playerZ -= state.speed * dtSec;
  if (refs.player) {
    refs.player.position.set(state.playerX, refs.player.position.y, state.playerZ);
    refs.player.rotation.z = THREE.MathUtils.lerp(refs.player.rotation.z, -state.inputDir * 0.3, 0.2);
  }
}

/** AABB: player vs every mesh in state.obstacles. Sets state.gameOver on hit. */
function checkCollisions(state) {
  if (!refs.player) return;
  const pb = new THREE.Box3().setFromObject(refs.player);
  pb.expandByScalar(-0.15);
  for (const obs of state.obstacles) {
    if (pb.intersectsBox(new THREE.Box3().setFromObject(obs))) { state.gameOver = true; break; }
  }
}

/** Smooth third-person chase cam behind and above the player. */
function updateCamera(camera, state) {
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, state.playerX * 0.6, 0.1);
  camera.position.y = 5;
  camera.position.z = state.playerZ + 10;
  camera.lookAt(state.playerX, 1, state.playerZ - 6);
}
${RUNNER_EDIT_END_MARKER}

${RUNNER_SACRED_START_MARKER}
// ─── SCENE INIT ──────────────────────────────────────────────────────────────
setupScene(scene, camera);

// ─── GAME LOOP (pre-wired — do not modify) ────────────────────────────────────
export function stepGame(dt = 16) {
  if (!state.started || state.gameOver) return;
  const dtSec = dt / 1000;
  state.score += dtSec * state.speed * 0.1;
  state.speed = Math.min(28, 8 + state.score * 0.025);
  state.spawnTimer -= dtSec;
  if (state.spawnTimer <= 0) {
    const obs = createObstacle(scene, state.playerZ);
    if (obs) state.obstacles.push(obs);
    state.spawnTimer = state.spawnInterval * (0.7 + Math.random() * 0.6);
    state.spawnInterval = Math.max(0.7, state.spawnInterval - 0.015);
  }
  state.obstacles = state.obstacles.filter((obs) => {
    if (obs.position.z > state.playerZ + 8) { scene.remove(obs); obs.geometry?.dispose(); return false; }
    return true;
  });
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}

function syncHud() {
  if (hud.score) hud.score.textContent = String(Math.floor(state.score));
${extraHudSync}
}

export function renderAll() {
  syncHud();
  renderer.render(scene, camera);
  if (statusLine && !state.started && !state.gameOver) {
    statusLine.textContent = ${jsString(statusCopy)};
  }
}

export function resetGame() {
  state.obstacles.forEach((o) => { scene.remove(o); o.geometry?.dispose(); });
  state.obstacles = [];
  state.score = 0;
  state.gameOver = false;
  state.started = false;
  state.playerX = 0;
  state.playerZ = 0;
  state.targetX = 0;
  state.speed = 8;
  state.spawnTimer = 0;
  state.spawnInterval = 2.2;
  state.inputDir = 0;
  state.lastTick = performance.now();
  if (refs.player) refs.player.position.set(0, refs.player.position.y, 0);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, -6);
  renderAll();
}

function gameLoop(now) {
  const dt = Math.min(32, now - state.lastTick);
  state.lastTick = now;
  stepGame(dt);
  renderAll();
  requestAnimationFrame(gameLoop);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  snapshot() {
    return JSON.parse(JSON.stringify({
      score: state.score ?? 0,
      gameOver: state.gameOver ?? false,
      started: state.started ?? false,
      lane: ${jsString(lane)},
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      cameraY: camera.position.y,
      obstacleCount: state.obstacles.length,
    }));
  },
  step(dt = 16) { stepGame(dt); renderAll(); return this.snapshot(); },
  reset() { resetGame(); return this.snapshot(); },
${extraProbeStr}
};

renderAll();
camera.position.set(0, 5, 10);
camera.lookAt(0, 1, -6);
requestAnimationFrame(gameLoop);
${RUNNER_SACRED_END_MARKER}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RACER skeleton (circuit racer, kart, etc.)
// AI fills in: buildTrack(), spawnRival(), steerCar(), checkLapProgress()
// ─────────────────────────────────────────────────────────────────────────────
function buildRacerStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString }) {
    return `// @ts-nocheck
// GameTok 3D racer stub — Phase 2: implement the 4 game-specific functions below.
// Foundation: ${foundation.foundationId || 'dynamic'} (${lane}) — camera: ${cameraRig}
// ALL geometry is code-built with flat colors. No external image loading.
${implNotes}
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const canvasEl = document.getElementById('game-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('Missing #game-canvas');
const stage = createThreeStage(canvasEl);
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;

const statusLine = document.getElementById('status-line');
const hud = { score: document.getElementById('score-value') };

// ─── GROUND ──────────────────────────────────────────────────────────────────
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: '#4a7c4e' }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ─── PLAYER CAR ──────────────────────────────────────────────────────────────
const car = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.5, 2.2),
  new THREE.MeshLambertMaterial({ color: '#e63946' }),
);
car.position.set(0, 0.25, 0);
scene.add(car);

const state = {
  score: 0, gameOver: false, started: false,
  speed: 0, maxSpeed: 22, steer: 0,
  carAngle: 0, rivals: [], lapProgress: 0,
  inputLeft: false, inputRight: false, inputAccel: false,
  lastTick: performance.now(),
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') state.inputLeft  = true;
  if (e.key === 'ArrowRight' || e.key === 'd') state.inputRight = true;
  if (e.key === 'ArrowUp'    || e.key === 'w') state.inputAccel = true;
  if (!state.started) state.started = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') state.inputLeft  = false;
  if (e.key === 'ArrowRight' || e.key === 'd') state.inputRight = false;
  if (e.key === 'ArrowUp'    || e.key === 'w') state.inputAccel = false;
});
let _tX = 0;
window.addEventListener('touchstart', (e) => { _tX = e.touches[0].clientX; if (!state.started) state.started = true; }, { passive: true });
window.addEventListener('touchmove', (e) => {
  const dx = e.touches[0].clientX - _tX;
  state.inputLeft = dx < -15; state.inputRight = dx > 15; state.inputAccel = true;
}, { passive: true });
window.addEventListener('touchend', () => { state.inputLeft = state.inputRight = state.inputAccel = false; }, { passive: true });
window.addEventListener('pointerdown', () => { if (state.gameOver) resetGame(); });

// ════════════════════════════════════════════════════════════════════════════
//  Phase 2: implement ONLY these 4 functions
// ════════════════════════════════════════════════════════════════════════════

/** Build the track geometry and add it to the scene. Called once on init. */
export function buildTrack() {
  // TODO Phase 2: create road surface, barriers, start line.
  // Use flat-colored boxes/planes. E.g. a looping oval or figure-8 track.
}

/** Spawn rival cars at track positions. Push meshes into state.rivals[]. */
export function spawnRivals() {
  // TODO Phase 2: create 2-3 rival car meshes (different colors), add to scene + state.rivals.
}

/** Steer and accelerate the player car. dt = ms since last frame. */
export function steerCar(dt) {
  // TODO Phase 2: apply acceleration/braking to state.speed,
  // rotate car by steer amount, move car forward in its facing direction.
}

/** Check lap/checkpoint progress and update state.score. */
export function checkLapProgress() {
  // TODO Phase 2: detect when car crosses checkpoints, increment score/laps.
}

// ─── GAME LOOP (pre-wired) ────────────────────────────────────────────────────
export function stepGame(dt = 16) {
  if (!state.started || state.gameOver) return;
  steerCar(dt);
  checkLapProgress();
  state.score += dt / 1000 * state.speed * 0.05;
  camera.position.set(
    car.position.x - Math.sin(state.carAngle) * 8,
    4,
    car.position.z - Math.cos(state.carAngle) * 8,
  );
  camera.lookAt(car.position.x, 1, car.position.z);
}

export function renderAll() {
  if (hud.score) hud.score.textContent = String(Math.floor(state.score));
  renderer.render(scene, camera);
  if (statusLine && !state.started) statusLine.textContent = ${jsString(statusCopy)};
}

export function resetGame() {
  state.score = 0; state.gameOver = false; state.started = false;
  state.speed = 0; state.carAngle = 0; state.lapProgress = 0;
  state.lastTick = performance.now();
  car.position.set(0, 0.25, 0); car.rotation.y = 0;
  renderAll();
}

function gameLoop(now) {
  const dt = Math.min(32, now - state.lastTick);
  state.lastTick = now;
  stepGame(dt);
  renderAll();
  requestAnimationFrame(gameLoop);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  snapshot() {
    return JSON.parse(JSON.stringify({
      score: state.score ?? 0, gameOver: state.gameOver ?? false,
      started: state.started ?? false, lane: ${jsString(lane)},
      renderCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      cameraY: camera.position.y, speed: state.speed,
    }));
  },
  step(dt = 16) { stepGame(dt); renderAll(); return this.snapshot(); },
  reset() { resetGame(); return this.snapshot(); },
${extraProbeStr}
};

buildTrack();
spawnRivals();
renderAll();
camera.position.set(0, 4, 8);
camera.lookAt(0, 1, 0);
requestAnimationFrame(gameLoop);
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC skeleton (voxel world, open world, sandbox, etc.)
// ─────────────────────────────────────────────────────────────────────────────
function buildGenericStub({ foundation, lane, cameraRig, statusCopy, implNotes, extraProbeStr, jsString }) {
    const hudBlocks = [];
    const hudSeen = new Set();
    for (const block of asArray(foundation.hudBlocks)) {
        const id = slugify(block);
        if (hudSeen.has(id)) continue;
        hudSeen.add(id);
        hudBlocks.push({ id, label: String(block) });
    }
    const stateKeys = [...new Set(asArray(foundation.requiredState).filter((k) => !['width', 'height'].includes(k)))];
    const stateInit = stateKeys.map((key) => {
        if (key === 'score' || key.endsWith('Count')) return `  ${key}: 0,`;
        if (key === 'gameOver' || key.startsWith('is') || key.startsWith('has')) return `  ${key}: false,`;
        if (key.endsWith('s') && !['status', 'progress', 'radius'].includes(key)) return `  ${key}: [],`;
        return `  ${key}: 0,`;
    }).join('\n');

    return `// @ts-nocheck
// GameTok 3D stub — Phase 2: implement the full game loop below.
// Foundation: ${foundation.foundationId || 'dynamic'} (${lane}) — camera: ${cameraRig}
// Kernel rules: createThreeStage() owns renderer/camera/lights/resize — extend, never delete.
// ALL geometry is code-built with flat colors. No external image loading.
${implNotes}
import './styles.css';
import * as THREE from 'three';
import { createThreeStage, buildVoxelField } from './threeAssets.ts';

const canvasEl = document.getElementById('game-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('Missing #game-canvas');
const stage = createThreeStage(canvasEl);
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;

const statusLine = document.getElementById('status-line');
const hud = {
  score: document.getElementById('score-value'),
${hudBlocks.filter((b) => b.id !== 'score').map((b) => `  ${b.id}: document.getElementById('${b.id}-value'),`).join('\n')}
};

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshLambertMaterial({ color: '#6fae5c' }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: '#38bdf8' }),
);
player.position.set(0, 0.5, 0);
scene.add(player);

const state = {
  score: 0,
  gameOver: false,
  started: false,
${stateInit}
  lastTick: performance.now(),
};

window.addEventListener('pointerdown', () => { if (!state.started) state.started = true; if (state.gameOver) resetGame(); });

// ════════════════════════════════════════════════════════════════════════════
//  Phase 2: implement the game loop, controls, and mechanics below.
// ════════════════════════════════════════════════════════════════════════════

export function stepGame(dt = 16) {
  if (!state.started || state.gameOver) return;
  // TODO Phase 2: implement ${lane} loop
  // (player movement, camera ${cameraRig} follow, collisions, scoring).
}

function syncHud() {
  if (hud.score) hud.score.textContent = String(Math.floor(state.score ?? 0));
${hudBlocks.filter((b) => b.id !== 'score').map((b) => `  if (hud.${b.id}) hud.${b.id}.textContent = String(state.${b.id} ?? 0);`).join('\n')}
}

export function renderAll() {
  syncHud();
  renderer.render(scene, camera);
  if (statusLine && !state.started && !state.gameOver) {
    statusLine.textContent = ${jsString(statusCopy)};
  }
}

export function resetGame() {
  state.score = 0;
  state.gameOver = false;
  state.started = false;
  state.lastTick = performance.now();
  player.position.set(0, 0.5, 0);
  renderAll();
}

function gameLoop(now) {
  const dt = Math.min(32, now - state.lastTick);
  state.lastTick = now;
  stepGame(dt);
  renderAll();
  requestAnimationFrame(gameLoop);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  snapshot() {
    return JSON.parse(JSON.stringify({
      score: state.score ?? 0,
      gameOver: state.gameOver ?? false,
      started: state.started ?? false,
      lane: ${jsString(lane)},
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      cameraY: camera.position.y,
    }));
  },
  step(dt = 16) { stepGame(dt); renderAll(); return this.snapshot(); },
  reset() { resetGame(); return this.snapshot(); },
${extraProbeStr}
};

renderAll();
requestAnimationFrame(gameLoop);
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SACRED re-stamp (runner lane). The Phase 2 model keeps the GAMETOK:SACRED
// markers but still edits inside them — breaking the loop/reset/probe. Rather than
// only detecting that, we physically restore the pre-wired runtime: replace each
// SACRED region in the generated file with the canonical stub's SACRED region,
// byte-for-byte, while leaving everything between the GAMETOK:EDIT markers (the
// model's themed gameplay) untouched. This is the enforcement the prose contract
// could not provide.
// ─────────────────────────────────────────────────────────────────────────────

/** Char-offset spans of each full SACRED block (marker line → marker line, inclusive). */
function findSacredRegionSpans(source = '') {
    const spans = [];
    const lines = String(source).split('\n');
    let offset = 0;
    let regionStart = -1;
    for (const line of lines) {
        if (line.includes('GAMETOK:SACRED START')) regionStart = offset;
        if (line.includes('GAMETOK:SACRED END') && regionStart >= 0) {
            spans.push({ start: regionStart, end: offset + line.length });
            regionStart = -1;
        }
        offset += line.length + 1; // + newline
    }
    return spans;
}

/**
 * Replace the SACRED regions in `generatedSource` with the SACRED regions from
 * `canonicalSource` (same order). Returns the original source unchanged (changed:
 * false) when the two files disagree on how many SACRED regions exist — e.g. the
 * model deleted a marker — so we never splice blindly. The EDIT regions and any
 * code outside SACRED blocks are preserved exactly.
 */
export function restampRunnerSacredRegions(generatedSource = '', canonicalSource = '') {
    const genSpans = findSacredRegionSpans(generatedSource);
    const canonSpans = findSacredRegionSpans(canonicalSource);
    if (genSpans.length === 0 || genSpans.length !== canonSpans.length) {
        return {
            content: generatedSource,
            changed: false,
            regions: 0,
            reason: genSpans.length === 0 ? 'no_sacred_markers' : 'sacred_marker_count_mismatch',
        };
    }
    let out = generatedSource;
    let changed = 0;
    // Splice from last region to first so earlier offsets stay valid.
    for (let i = genSpans.length - 1; i >= 0; i -= 1) {
        const g = genSpans[i];
        const canonText = canonicalSource.slice(canonSpans[i].start, canonSpans[i].end);
        const genText = generatedSource.slice(g.start, g.end);
        if (canonText !== genText) {
            out = out.slice(0, g.start) + canonText + out.slice(g.end);
            changed += 1;
        }
    }
    return { content: out, changed: changed > 0, regions: changed, reason: changed > 0 ? 'restamped' : 'already_canonical' };
}

/** Char-offset span of the single EDIT region (marker line → marker line, inclusive). */
function findEditRegionSpan(source = '') {
    const lines = String(source).split('\n');
    let offset = 0;
    let start = -1;
    let end = -1;
    for (const line of lines) {
        if (start < 0 && line.includes('GAMETOK:EDIT START')) start = offset;
        if (start >= 0 && line.includes('GAMETOK:EDIT END')) { end = offset + line.length; break; }
        offset += line.length + 1;
    }
    return (start >= 0 && end >= 0) ? { start, end } : null;
}

/**
 * Assemble the final runner main.ts from the CANONICAL stub with only the model's
 * EDIT region (the five themed gameplay functions + their local helpers) grafted
 * in. Everything outside the EDIT markers — state, input, loop, render, reset,
 * probe, and any stray code the model added in the gaps or at the top/bottom — is
 * the canonical engine, so the model physically cannot ship a broken loop/reset or
 * a duplicate probe. Falls back to in-place sacred restore if the EDIT markers are
 * missing (so we still recover something rather than nothing).
 */
export function regraftRunnerEditRegion(generatedSource = '', canonicalSource = '') {
    const genEdit = findEditRegionSpan(generatedSource);
    const canonEdit = findEditRegionSpan(canonicalSource);
    if (!genEdit || !canonEdit) {
        const fallback = restampRunnerSacredRegions(generatedSource, canonicalSource);
        return { ...fallback, mode: 'sacred_restore_fallback' };
    }
    const modelEditText = generatedSource.slice(genEdit.start, genEdit.end);
    const content = canonicalSource.slice(0, canonEdit.start) + modelEditText + canonicalSource.slice(canonEdit.end);
    return {
        content,
        changed: content !== generatedSource,
        mode: 'edit_graft',
        reason: content !== generatedSource ? 'regrafted_edit_region_into_canonical' : 'already_canonical',
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-file 3D: every lane keeps all state + functions inside main.ts, so the
// model never has to wire an invisible cross-file contract (which it cannot do
// reliably — it would put movePlayer in scene.ts while main.ts imports it from
// mechanics.ts). No extra files are injected. Kept as a stable export so the
// scaffold builder can call it unconditionally.
// ─────────────────────────────────────────────────────────────────────────────
export function buildThreeExtraFiles() {
    return [];
}
