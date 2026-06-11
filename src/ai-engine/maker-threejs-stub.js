// 3D (three.js) main.ts stub generator for the threejs-kernel template.
// Mirrors the canvas-kernel stub contract: foundation-driven state, HUD chips,
// __GAMETOK_TEMPLATE_PROBE__ with snapshot/step/reset, validator-safe dedupe.

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

export function isThreeFoundation(foundation = {}) {
    const dimension = String(foundation?.dimension || '').toUpperCase();
    const lane = String(foundation?.lane || '').toLowerCase();
    return dimension === '3D' || lane.includes('threejs') || lane.includes('voxel_world');
}

export function buildThreeMainTsStubFromFoundation(foundation = {}, qualityIntent = {}) {
    const title = asString(foundation.title, qualityIntent.title || 'GameTok 3D Game');
    const cameraRig = asString(foundation.cameraRig, 'third_person_chase');
    const hudBlocks = [];
    const hudSeen = new Set();
    for (const block of asArray(foundation.hudBlocks)) {
        const id = slugify(block);
        if (hudSeen.has(id)) continue;
        hudSeen.add(id);
        hudBlocks.push({ id, label: String(block) });
    }
    const useHud = hudBlocks.length > 0;
    const hudRefs = hudBlocks
        .filter((block) => block.id !== 'score')
        .map((block) => `  ${block.id}: document.getElementById('${block.id}-value'),`)
        .join('\n');

    const stateKeys = [...new Set(asArray(foundation.requiredState).filter((key) => !['width', 'height'].includes(key)))];
    const coveredKeys = new Set(stateKeys);
    const stateInit = stateKeys.map((key) => {
        if (key === 'score' || key.endsWith('Count')) return `  ${key}: 0,`;
        if (key === 'combo' || key === 'comboMultiplier') return `  ${key}: 1,`;
        if (key === 'timeLeft' || key === 'time' || key === 'dayTimer') return `  ${key}: 120,`;
        if (key === 'gameOver' || key.startsWith('is') || key.startsWith('has')) return `  ${key}: false,`;
        if (key.endsWith('s') && !['status', 'progress', 'radius'].includes(key)) return `  ${key}: [],`;
        return `  ${key}: 0,`;
    }).join('\n');
    const hudStateInit = hudBlocks
        .filter((block) => block.id !== 'score' && !coveredKeys.has(block.id))
        .map((block) => {
            coveredKeys.add(block.id);
            if (block.id.includes('time')) return `  ${block.id}: 120,`;
            return `  ${block.id}: 0,`;
        })
        .join('\n');
    const scoreInit = coveredKeys.has('score') ? '' : '  score: 0,';
    const gameOverInit = coveredKeys.has('gameOver') ? '' : '  gameOver: false,';
    const combinedStateInit = [scoreInit, gameOverInit, stateInit, hudStateInit].filter(Boolean).join('\n');

    const reservedProbes = new Set(['snapshot', 'step', 'reset']);
    const extraProbes = [];
    for (const probe of asArray(foundation.probeMethods)) {
        const name = asString(probe?.name);
        if (!name || reservedProbes.has(name)) continue;
        reservedProbes.add(name);
        extraProbes.push(`  ${name}(...args) {
    // Foundation probe stub — Phase 2 agent implements ${name}(): ${asString(probe?.description, name)}
    return null;
  },`);
    }
    const implNotes = asArray(foundation.implementationNotes).slice(0, 8)
        .map((note) => `// ${note}`)
        .join('\n');

    return `// @ts-nocheck
// GameTok 3D foundation stub — Phase 2 file agent: implement the full game loop below.
// Foundation: ${foundation.foundationId || 'dynamic'} (${foundation.lane || 'threejs_world'}) — camera rig: ${cameraRig}
// Kernel rules: createThreeStage() owns renderer/camera/lights/sky/resize — extend, never delete.
// Geometry is code-built (boxes, planes, buildVoxelField) and FLAT-COLORED — no image textures.
${implNotes}
import './styles.css';
import * as THREE from 'three';
import {
  createThreeStage,
  buildVoxelField,
} from './threeAssets.ts';

const canvasEl = document.getElementById('game-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game-canvas element');
}
const stage = createThreeStage(canvasEl);
const renderer = stage.renderer;
const scene = stage.scene;
const camera = stage.camera;
const statusLine = document.getElementById('status-line');
const hudMount = document.getElementById('hud');
${useHud ? `const hud = {
  score: document.getElementById('score-value'),
${hudRefs}
};` : '// Phase 2: design minimal game-specific HUD in #hud (see foundation hudDesign).'}

// Sky is set by createThreeStage(); the ground is a flat-colored plane.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshLambertMaterial({ color: '#6fae5c' }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Placeholder player — Phase 2 replaces with the real player entity.
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: '#38bdf8' }),
);
player.position.set(0, 0.5, 0);
scene.add(player);

const state = {
  width: window.innerWidth || 390,
  height: window.innerHeight || 844,
${combinedStateInit}
  lastTick: performance.now(),
  started: false,
};

${useHud ? `function syncHud() {
  if (hud.score) hud.score.textContent = String(state.score ?? 0);
${hudBlocks.filter((block) => block.id !== 'score').map((block) => `  if (hud.${block.id}) hud.${block.id}.textContent = String(state.${block.id} ?? 0);`).join('\n')}
}` : `function syncHud() {
  // TODO Phase 2: implement minimal HUD per foundation hudDesign.
}`}

export function renderAll() {
  syncHud();
  renderer.render(scene, camera);
  if (statusLine && !state.started) {
    statusLine.textContent = ${jsString(asString(foundation.statusCopy, 'Tap to play!'))};
  }
}

export function stepGame(dt = 16) {
  if (state.gameOver) return;
  // TODO: Phase 2 agent implements the ${foundation.lane || 'threejs_world'} loop here
  // (player movement, camera ${cameraRig} follow, collisions, scoring).
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
      lane: ${jsString(foundation.lane || 'threejs_world')},
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      cameraY: camera.position.y,
    }));
  },
  step(dt = 16) {
    stepGame(dt);
    renderAll();
    return this.snapshot();
  },
  reset() {
    resetGame();
    return this.snapshot();
  },
${extraProbes.join('\n')}
};

renderAll();
requestAnimationFrame(gameLoop);
`;
}
