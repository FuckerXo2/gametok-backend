import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materializeMakerAssetsForProject } from '../src/ai-engine/maker-asset-materializer.js';
import { classifyMakerGame } from '../src/ai-engine/maker-classifier.js';
import { runMakerPreflightChecks } from '../src/ai-engine/maker-preflight-validator.js';

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const assetContract = {
  slots: [
    { id: 'arcade_primary_object', role: 'item', required: true },
    { id: 'arcade_primary_threat', role: 'enemy', required: true },
    { id: 'arcade_background', role: 'background', required: true },
  ],
};

{
  const routed = classifyMakerGame(
    { technicalRequirements: { archetype: 'arcade', archetypeReasoning: 'generic swipe arcade' } },
    'Swipe to slice fruit with bombs, combo, hit-stop, and screen shake'
  );
  assert.equal(routed.selectedTemplateId, 'phaser-top-down-action', 'action arcade prompts should route to Phaser-first template');
}

{
  const routed = classifyMakerGame(
    { technicalRequirements: { archetype: 'arcade', archetypeReasoning: 'freehand canvas game' } },
    'Draw a picture against a robot on a canvas'
  );
  assert.equal(routed.selectedTemplateId, 'canvas-arcade', 'freehand drawing prompts may keep canvas arcade');
}

function generatedAssetsFor(roles) {
  const assets = {};
  const assetPack = roles.map((role) => {
    const key = `${role}_asset`;
    assets[key] = PNG_1X1;
    return {
      key,
      id: key,
      role,
      category: role,
      type: role === 'background' ? 'background' : 'image',
      url: PNG_1X1,
      width: 16,
      height: 16,
    };
  });
  return {
    assets,
    assetPack,
    animations: [],
    audio: { sfx: [], music: [] },
    tilesets: [],
    makerAssetManifest: {
      version: 3,
      slots: assetContract.slots.map((slot) => ({
        id: slot.id,
        role: slot.role,
        required: true,
        status: roles.includes(slot.role) ? 'ready' : 'missing',
        runtimeKey: roles.includes(slot.role) ? `${slot.role}_asset` : null,
      })),
    },
  };
}

async function makeProject(source, generatedAssets, { indexHtml = '<div id="app"></div><script type="module" src="/src/main.ts"></script>' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maker-opengame-test-'));
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'index.html'), indexHtml, 'utf8');
  await fs.writeFile(path.join(projectRoot, 'src', 'main.ts'), source, 'utf8');
  await materializeMakerAssetsForProject(projectRoot, generatedAssets, { workspace: root });
  return { root, projectRoot };
}

const visibleSource = `
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
void fetch('assets/asset-pack.json');
console.log('asset keys', 'item_asset', 'enemy_asset', 'background_asset');
function draw() {
  canvas.width = 320;
  canvas.height = 480;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage((window as any).DREAM_IMAGES?.['background'] || new Image(), 0, 0, 10, 10);
  ctx.drawImage((window as any).DREAM_IMAGES?.['item'] || new Image(), 40, 40, 10, 10);
  ctx.drawImage((window as any).DREAM_IMAGES?.['enemy'] || new Image(), 80, 40, 10, 10);
  requestAnimationFrame(draw);
}
draw();
`;

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(visibleSource, generated);
  const packRaw = await fs.readFile(path.join(projectRoot, 'public', 'assets', 'asset-pack.json'), 'utf8');
  const pack = JSON.parse(packRaw);
  assert.equal(pack.meta.runtimeAssets.length, 3, 'materializer should write three runtime assets in meta');
  assert.ok(pack.images.files.some((asset) => asset.key === 'item_asset'), 'OpenGame image section should include item asset');
  assert.ok(pack.backgrounds.files.some((asset) => asset.key === 'background_asset'), 'OpenGame background section should include background asset');
  assert.ok(pack.meta.runtimeAssets.every((asset) => asset.url.startsWith('assets/')), 'runtime assets should use stable local urls');
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, true, `valid project should pass preflight: ${JSON.stringify(result.issues)}`);
}

{
  const generated = generatedAssetsFor(['enemy', 'background']);
  const { projectRoot } = await makeProject(visibleSource, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'missing item role should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_required_asset_slots_missing_runtime_key'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`${visibleSource}\n(window as any).DreamAssets.getImage('ghost_key');`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'unknown DreamAssets key should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_asset_key_missing_from_pack'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
void fetch('assets/asset-pack.json');
console.log((window as any).DREAM_IMAGES?.['item']);
console.log((window as any).DREAM_IMAGES?.['enemy']);
console.log((window as any).DREAM_IMAGES?.['background']);
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'blank canvas source should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_no_visible_first_frame_path'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
void fetch('assets/asset-pack.json');
canvas.addEventListener('touchend', (e: PointerEvent) => console.log(e.pointerId));
function draw() {
  const ctx = canvas.getContext('2d')!;
  ctx.fillRect(0, 0, 10, 10);
  requestAnimationFrame(draw);
}
draw();
console.log((window as any).DREAM_IMAGES?.['item'], (window as any).DREAM_IMAGES?.['enemy'], (window as any).DREAM_IMAGES?.['background']);
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'invalid touch/pointer listener typing should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_touch_pointer_event_mismatch'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
void fetch('assets/asset-pack.json');
const asset = (window as any).DREAM_ASSET_PACK?.find((entry: any) => entry.role === 'item');
function draw() {
  ctx.fillRect(0, 0, 10, 10);
  ctx.drawImage(asset, 0, 0, 10, 10);
  requestAnimationFrame(draw);
}
draw();
console.log((window as any).DREAM_IMAGES?.['item'], (window as any).DREAM_IMAGES?.['enemy'], (window as any).DREAM_IMAGES?.['background']);
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'unsafe canvas drawImage manifest object should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_unsafe_canvas_draw_image_source'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
void fetch('assets/asset-pack.json');
const state = { score: 0, bombsSliced: 0, lives: 3 };
function draw() {
  state.bombSliced += 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillRect(0, 0, 10, 10);
  requestAnimationFrame(draw);
}
draw();
console.log((window as any).DREAM_IMAGES?.['item'], (window as any).DREAM_IMAGES?.['enemy'], (window as any).DREAM_IMAGES?.['background']);
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'state property typo should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_state_property_missing'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
import Phaser from 'phaser';
class Play extends Phaser.Scene {
  constructor() { super('Play'); }
  create() {
    this.add.image(40, 40, 'ghost_texture');
  }
}
new Phaser.Game({ scene: [Play] });
void fetch('assets/asset-pack.json');
console.log('item_asset', 'enemy_asset', 'background_asset');
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'unknown Phaser texture key should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_asset_key_missing_from_pack'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
import Phaser from 'phaser';
class Play extends Phaser.Scene {
  constructor() { super('Play'); }
  create() {
    this.add.image(40, 40, 'item_asset');
    this.add.image(80, 40, 'enemy_asset');
    this.add.image(120, 40, 'background_asset');
  }
}
new Phaser.Game({ parent: 'missing-game-container', scene: [Play] });
void fetch('assets/asset-pack.json');
console.log('item_asset', 'enemy_asset', 'background_asset');
`, generated, { indexHtml: '<div id="game-container"></div><script type="module" src="/src/main.ts"></script>' });
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'missing Phaser parent target should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_dom_parent_missing'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
const canvas = document.createElement('canvas');
const mount = document.getElementById('missing-mount');
mount!.appendChild(canvas);
void fetch('assets/asset-pack.json');
console.log((window as any).DREAM_IMAGES?.['item'], (window as any).DREAM_IMAGES?.['enemy'], (window as any).DREAM_IMAGES?.['background']);
function draw() {
  const ctx = canvas.getContext('2d')!;
  ctx.fillRect(0, 0, 10, 10);
  requestAnimationFrame(draw);
}
draw();
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'appendChild to a missing DOM target should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_dom_append_target_missing'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
import Phaser from 'phaser';
class Play extends Phaser.Scene {
  constructor() { super('Play'); }
  create() {
    this.add.dom(0, 0, 'div', 'width: 100%; height: 100%;');
    this.add.image(40, 40, 'item_asset');
    this.add.image(80, 40, 'enemy_asset');
    this.add.image(120, 40, 'background_asset');
  }
}
new Phaser.Game({
  parent: 'game-container',
  scene: [Play],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
void fetch('assets/asset-pack.json');
`, generated, { indexHtml: '<div id="game-container"></div><script type="module" src="/src/main.ts"></script>' });
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'Phaser DOM objects without dom.createContainer should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_phaser_dom_container_missing'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
import Phaser from 'phaser';
class Play extends Phaser.Scene {
  constructor() { super('Play'); }
  create() {
    this.add.image(40, 40, 'item_asset');
    this.add.image(80, 40, 'enemy_asset');
    this.add.image(120, 40, 'background_asset');
  }
}
new Phaser.Game({
  parent: 'game-container',
  scene: [Play],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    maxWidth: 390,
  },
});
void fetch('assets/asset-pack.json');
`, generated, { indexHtml: '<div id="game-container"></div><script type="module" src="/src/main.ts"></script>' });
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'unsupported Phaser ScaleConfig keys should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_phaser_invalid_scale_config'));
}

{
  const generated = generatedAssetsFor(['item', 'enemy', 'background']);
  const { projectRoot } = await makeProject(`
import Phaser from 'phaser';
import { BaseArenaScene } from './scenes/BaseArenaScene';
type Fruit = { sprite: Phaser.GameObjects.Sprite };
export class GameScene extends BaseArenaScene {
  private enemies: Fruit[] = [];
  constructor() { super({ key: 'GameScene' }); }
  createBackground() {}
  createEntities() {
    this.add.image(40, 40, 'item_asset');
    this.add.image(80, 40, 'enemy_asset');
    this.add.image(120, 40, 'background_asset');
  }
  spawnEnemy() { return null as any; }
}
void fetch('assets/asset-pack.json');
`, generated);
  const result = await runMakerPreflightChecks({ projectRoot, generatedAssets: generated, assetContract });
  assert.equal(result.success, false, 'redeclaring inherited scene fields should fail preflight');
  assert.ok(result.issues.some((issue) => issue.id === 'preflight_inherited_scene_property_redeclared'));
}

console.log('maker opengame migration tests passed');
