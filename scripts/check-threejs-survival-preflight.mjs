import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { shouldBlockOnPreflight } from '../src/ai-engine/maker-factory-mode.js';
import { runMakerPreflightChecks } from '../src/ai-engine/maker-preflight-validator.js';
import { buildThreeMainTsStubFromFoundation } from '../src/ai-engine/maker-threejs-stub.js';

async function makeProject(mainTs) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gametok-threejs-preflight-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'index.html'), '<div id="game-shell"><canvas id="game-canvas"></canvas></div>', 'utf8');
    await fs.writeFile(path.join(root, 'src', 'main.ts'), mainTs, 'utf8');
    return root;
}

async function checkPreflight(mainTs) {
    const projectRoot = await makeProject(mainTs);
    return runMakerPreflightChecks({
        projectRoot,
        generatedAssets: null,
        assetContract: { templateId: 'threejs-kernel', slots: [] },
        templateContract: {
            templateId: 'threejs-kernel',
            engine: 'threejs',
            foundation: { lane: 'snowboard_runner' },
        },
        foundationLane: 'snowboard_runner',
    });
}

const brokenSnowboard = `
// @ts-nocheck
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const stage = createThreeStage(document.getElementById('game-canvas'));
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const refs = { player: null };
const state = { score: 0, gameOver: false, started: true };

function setupScene(scene, camera) {
  // TODO Phase 2: create snowboarder and slope
}
function createObstacle(scene, playerZ) {
  // TODO Phase 2: create tree obstacle
}
function movePlayer(state, dt) {
  // TODO Phase 2: steer player
}
function checkCollisions(state) {
  refs.obstacles.forEach((obs) => console.log(obs));
}
function updateCamera(camera, state) {
  // TODO Phase 2: chase camera
}

export function stepGame(dt = 16) {
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}
export function renderAll() { renderer.render(scene, camera); }
export function resetGame() {}
window.__GAMETOK_TEMPLATE_PROBE__ = { snapshot(){ return state; }, step: stepGame, reset: resetGame };
requestAnimationFrame(() => renderAll());
`;

const broken = await checkPreflight(brokenSnowboard);
const brokenIds = broken.issues.map((issue) => issue.id);
assert.equal(broken.success, false, 'broken snowboard runner should fail preflight');
assert.ok(brokenIds.includes('preflight_threejs_phase2_todo_remaining'), 'should catch surviving TODO Phase 2 markers');
assert.ok(
    brokenIds.includes('preflight_threejs_obstacle_holder_uninitialized'),
    'should catch refs.obstacles read without refs.obstacles initialization',
);
assert.ok(
    broken.issues.some((issue) => issue.id === 'preflight_threejs_obstacle_holder_uninitialized'
        && issue.holders.includes('refs')),
    'uninitialized-holder issue should name the refs holder',
);
assert.equal(shouldBlockOnPreflight(broken, true), true, 'threejs survival failures should block in factory-minimal mode');

const missingRunnerFunction = brokenSnowboard.replace(/function updateCamera[\s\S]*?\n}\n\nexport function stepGame/, 'export function stepGame');
const missingFn = await checkPreflight(missingRunnerFunction);
assert.ok(
    missingFn.issues.some((issue) => issue.id === 'preflight_threejs_runner_required_functions_missing'
        && issue.missingKeys.includes('updateCamera')),
    'should catch missing required runner functions',
);

// A non-refs/non-state holder (world.obstacles) read but never initialized — the
// exact blind spot that let the first patch pass while the sandbox crashed.
const worldHolderUninit = `
// @ts-nocheck
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const stage = createThreeStage(document.getElementById('game-canvas'));
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const refs = { player: null };
let world;
const state = { score: 0, gameOver: false, started: true, playerZ: 0 };

function setupScene(scene, camera) { refs.player = new THREE.Group(); scene.add(refs.player); }
function createObstacle(scene, playerZ) {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#166534' }));
  scene.add(obstacle);
  return obstacle;
}
function movePlayer(state, dt) { state.playerZ -= dt / 1000; }
function checkCollisions(state) { world.obstacles.forEach((obs) => obs.position.z += 0); }
function updateCamera(camera, state) { camera.lookAt(0, 0, state.playerZ); }

setupScene(scene, camera);
export function stepGame(dt = 16) {
  world.obstacles.push(createObstacle(scene, state.playerZ));
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}
export function renderAll() { renderer.render(scene, camera); }
export function resetGame() {}
window.__GAMETOK_TEMPLATE_PROBE__ = { snapshot(){ return { obstacleCount: world.obstacles.length }; }, step: stepGame, reset: resetGame };
requestAnimationFrame(() => renderAll());
`;

const worldUninit = await checkPreflight(worldHolderUninit);
assert.equal(worldUninit.success, false, 'world.obstacles read without init should fail preflight');
assert.ok(
    worldUninit.issues.some((issue) => issue.id === 'preflight_threejs_obstacle_holder_uninitialized'
        && issue.holders.includes('world')),
    'should catch an uninitialized non-refs/non-state obstacle holder (world.obstacles)',
);

// Storage split: state.obstacles is initialized AND used by spawn/snapshot, but
// collision reads a second, uninitialized holder — must flag split + uninit.
const splitStorage = `
// @ts-nocheck
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const stage = createThreeStage(document.getElementById('game-canvas'));
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const refs = { player: null };
const state = { score: 0, gameOver: false, started: true, obstacles: [], playerZ: 0 };
let world;

function setupScene(scene, camera) { refs.player = new THREE.Group(); scene.add(refs.player); }
function createObstacle(scene, playerZ) {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#166534' }));
  scene.add(obstacle);
  return obstacle;
}
function movePlayer(state, dt) { state.playerZ -= dt / 1000; }
function checkCollisions(state) { world.obstacles.forEach((obs) => obs.position.z += 0); }
function updateCamera(camera, state) { camera.lookAt(0, 0, state.playerZ); }

setupScene(scene, camera);
export function stepGame(dt = 16) {
  state.obstacles.push(createObstacle(scene, state.playerZ));
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}
export function renderAll() { renderer.render(scene, camera); }
export function resetGame() { state.obstacles = []; renderAll(); }
window.__GAMETOK_TEMPLATE_PROBE__ = { snapshot(){ return { obstacleCount: state.obstacles.length }; }, step: stepGame, reset: resetGame };
renderAll();
requestAnimationFrame(() => renderAll());
`;

const split = await checkPreflight(splitStorage);
assert.equal(split.success, false, 'split obstacle storage should fail preflight');
assert.ok(
    split.issues.some((issue) => issue.id === 'preflight_threejs_obstacle_storage_split'),
    'should catch obstacle storage split across multiple holders',
);
assert.ok(
    split.issues.some((issue) => issue.id === 'preflight_threejs_obstacle_holder_uninitialized'
        && issue.holders.includes('world')),
    'split case should also flag the uninitialized world holder',
);

// state.obstacles initialized via post-construction assignment (not a literal key),
// used consistently everywhere — must PASS (guards the assignment false-positive).
const assignInitRunner = `
// @ts-nocheck
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const stage = createThreeStage(document.getElementById('game-canvas'));
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const refs = { player: null };
const state = { score: 0, gameOver: false, started: true, playerZ: 0 };
state.obstacles = [];

function setupScene(scene, camera) { refs.player = new THREE.Group(); scene.add(refs.player); }
function createObstacle(scene, playerZ) {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#166534' }));
  scene.add(obstacle);
  return obstacle;
}
function movePlayer(state, dt) { state.playerZ -= dt / 1000; }
function checkCollisions(state) { state.obstacles.forEach((obs) => obs.position.z += 0); }
function updateCamera(camera, state) { camera.lookAt(0, 0, state.playerZ); }

setupScene(scene, camera);
export function stepGame(dt = 16) {
  state.obstacles.push(createObstacle(scene, state.playerZ));
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}
export function renderAll() { renderer.render(scene, camera); }
export function resetGame() { state.obstacles = []; renderAll(); }
window.__GAMETOK_TEMPLATE_PROBE__ = { snapshot(){ return { obstacleCount: state.obstacles.length }; }, step: stepGame, reset: resetGame };
renderAll();
requestAnimationFrame(() => renderAll());
`;

const assignInit = await checkPreflight(assignInitRunner);
const assignInitThreeIssues = assignInit.issues.filter((issue) => issue.id.startsWith('preflight_threejs_'));
assert.deepEqual(
    assignInitThreeIssues,
    [],
    `assignment-initialized state.obstacles should not emit threejs survival issues: ${assignInitThreeIssues.map((issue) => issue.id).join(', ')}`,
);

const validRunner = `
// @ts-nocheck
import './styles.css';
import * as THREE from 'three';
import { createThreeStage } from './threeAssets.ts';

const stage = createThreeStage(document.getElementById('game-canvas'));
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const refs = { player: null };
const state = { score: 0, gameOver: false, started: true, obstacles: [], playerZ: 0 };

function setupScene(scene, camera) {
  refs.player = new THREE.Group();
  scene.add(refs.player);
}
function createObstacle(scene, playerZ) {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#166534' }));
  scene.add(obstacle);
  return obstacle;
}
function movePlayer(state, dt) { state.playerZ -= dt / 1000; }
function checkCollisions(state) { state.obstacles.forEach((obs) => obs.position.z += 0); }
function updateCamera(camera, state) { camera.lookAt(0, 0, state.playerZ); }

setupScene(scene, camera);
export function stepGame(dt = 16) {
  const obstacle = createObstacle(scene, state.playerZ);
  state.obstacles.push(obstacle);
  movePlayer(state, dt);
  checkCollisions(state);
  updateCamera(camera, state);
}
export function renderAll() { renderer.render(scene, camera); }
export function resetGame() { state.obstacles = []; renderAll(); }
window.__GAMETOK_TEMPLATE_PROBE__ = { snapshot(){ return { obstacleCount: state.obstacles.length }; }, step: stepGame, reset: resetGame };
renderAll();
requestAnimationFrame(() => renderAll());
`;

const valid = await checkPreflight(validRunner);
const validThreeIssues = valid.issues.filter((issue) => issue.id.startsWith('preflight_threejs_'));
assert.deepEqual(validThreeIssues, [], `valid runner should not emit threejs survival issues: ${validThreeIssues.map((issue) => issue.id).join(', ')}`);

// ── Experiment: runner sacred-region markers + non-blocking drift telemetry ──

// The pristine runner stub must carry all four region markers and report NO drift.
const pristineRunnerStub = buildThreeMainTsStubFromFoundation(
    { lane: 'snowboard_runner', title: 'Summit Slalom', cameraRig: 'third_person_chase', hudBlocks: ['Score'] },
    { title: 'Summit Slalom' },
);
assert.ok(pristineRunnerStub.includes('// ===== GAMETOK:SACRED START'), 'runner stub must contain the SACRED START marker');
assert.ok(pristineRunnerStub.includes('// ===== GAMETOK:SACRED END'), 'runner stub must contain the SACRED END marker');
assert.ok(pristineRunnerStub.includes('// ===== GAMETOK:EDIT START'), 'runner stub must contain the EDIT START marker');
assert.ok(pristineRunnerStub.includes('// ===== GAMETOK:EDIT END'), 'runner stub must contain the EDIT END marker');

const pristine = await checkPreflight(pristineRunnerStub);
assert.equal(pristine.evidence.sacredRegion.runner, true, 'pristine stub should be detected as a runner');
assert.equal(pristine.evidence.sacredRegion.markersPresent, true, 'pristine stub should have all region markers');
assert.equal(pristine.evidence.sacredRegion.drift, false, 'pristine stub should not report sacred drift');
assert.deepEqual(pristine.evidence.sacredRegionWarnings, [], 'pristine stub should emit no sacred-drift warning');

// A markerless rewrite (the existing validRunner fixture has no markers) must be
// flagged as drift — but the warning is telemetry-only: it must NOT block preflight
// and must NOT appear in issues.
assert.equal(valid.evidence.sacredRegion.runner, true, 'valid markerless runner should be detected as a runner');
assert.equal(valid.evidence.sacredRegion.drift, true, 'markerless rewrite should report sacred drift');
assert.ok(valid.evidence.sacredRegion.reasons.includes('sacred_markers_missing'), 'drift reasons should include missing sacred markers');
assert.equal(valid.evidence.sacredRegionWarnings[0].id, 'telemetry_threejs_runner_sacred_drift', 'drift warning should carry the telemetry id');
assert.equal(valid.evidence.sacredRegionWarnings[0].severity, 'warning', 'drift warning severity should be warning');
assert.equal(valid.success, true, 'sacred drift telemetry must be non-blocking (preflight still succeeds)');
assert.ok(
    !valid.issues.some((issue) => issue.id === 'telemetry_threejs_runner_sacred_drift'),
    'sacred drift must never appear in blocking issues',
);

console.log('✅ threejs survival preflight checks passed');
