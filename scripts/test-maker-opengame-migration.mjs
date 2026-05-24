import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materializeMakerAssetsForProject } from '../src/ai-engine/maker-asset-materializer.js';
import { runMakerPreflightChecks } from '../src/ai-engine/maker-preflight-validator.js';

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const assetContract = {
  slots: [
    { id: 'arcade_primary_object', role: 'item', required: true },
    { id: 'arcade_primary_threat', role: 'enemy', required: true },
    { id: 'arcade_background', role: 'background', required: true },
  ],
};

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

async function makeProject(source, generatedAssets) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maker-opengame-test-'));
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'src', 'main.ts'), source, 'utf8');
  await materializeMakerAssetsForProject(projectRoot, generatedAssets, { workspace: root });
  return { root, projectRoot };
}

const visibleSource = `
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
void fetch('assets/asset-pack.json');
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
  assert.equal(pack.runtimeAssets.length, 3, 'materializer should write three runtime assets');
  assert.ok(pack.runtimeAssets.every((asset) => asset.url.startsWith('assets/')), 'runtime assets should use stable local urls');
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

console.log('maker opengame migration tests passed');
