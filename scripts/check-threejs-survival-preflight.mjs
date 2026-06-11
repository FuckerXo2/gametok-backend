import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { shouldBlockOnPreflight } from '../src/ai-engine/maker-factory-mode.js';
import { runMakerPreflightChecks } from '../src/ai-engine/maker-preflight-validator.js';

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
assert.ok(brokenIds.includes('preflight_threejs_refs_obstacles_uninitialized'), 'should catch refs.obstacles read without refs.obstacles initialization');
assert.ok(brokenIds.includes('preflight_threejs_runner_obstacle_state_missing'), 'should catch missing runner obstacle state');
assert.equal(shouldBlockOnPreflight(broken, true), true, 'threejs survival failures should block in factory-minimal mode');

const missingRunnerFunction = brokenSnowboard.replace(/function updateCamera[\s\S]*?\n}\n\nexport function stepGame/, 'export function stepGame');
const missingFn = await checkPreflight(missingRunnerFunction);
assert.ok(
    missingFn.issues.some((issue) => issue.id === 'preflight_threejs_runner_required_functions_missing'
        && issue.missingKeys.includes('updateCamera')),
    'should catch missing required runner functions',
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

console.log('✅ threejs survival preflight checks passed');
