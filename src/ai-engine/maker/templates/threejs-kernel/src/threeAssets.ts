// GameTok Three.js asset kernel — bridges the DreamAssets image pack (FLUX 2D art)
// into Three.js materials. Geometry is code-built; these helpers paint it.
// Read-only kernel file: Phase 2 agent consumes these, never edits them.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const textureCache: Record<string, THREE.Texture> = {};

function dreamImage(roleOrKey: string): HTMLImageElement | null {
  const images = (window as any).DREAM_IMAGES || {};
  const img = images[roleOrKey];
  if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) return img;
  return null;
}

/** First image whose pack role/category matches (e.g. 'texture', 'skybox', 'billboard'). */
export function firstImageByRole(role: string): HTMLImageElement | null {
  const pack: any[] = Array.isArray((window as any).DREAM_ASSET_PACK) ? (window as any).DREAM_ASSET_PACK : [];
  for (const asset of pack) {
    const assetRole = String(asset?.role || asset?.category || '').toLowerCase();
    if (assetRole === role.toLowerCase()) {
      const img = dreamImage(asset.key || asset.id || asset.runtimeKey);
      if (img) return img;
    }
  }
  return dreamImage(role);
}

/**
 * A THREE.Texture from a DreamAssets image key/role. Returns null if the image
 * is missing — always branch to a solid-color material fallback.
 */
export function getDreamTexture(roleOrKey: string): THREE.Texture | null {
  if (textureCache[roleOrKey]) return textureCache[roleOrKey];
  const img = dreamImage(roleOrKey) || firstImageByRole(roleOrKey);
  if (!img) return null;
  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache[roleOrKey] = texture;
  return texture;
}

/** A repeating (tileable) texture for ground planes / walls / voxel faces. */
export function getTileTexture(roleOrKey: string, repeatX = 8, repeatY = 8): THREE.Texture | null {
  const base = getDreamTexture(roleOrKey);
  if (!base) return null;
  const texture = base.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  // Crisp Minecraft-style pixels when the source texture is small.
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Wraps the scene in a sky: equirect image if a 'skybox' asset exists, else a vertical gradient. */
export function applySkybox(scene: THREE.Scene, roleOrKey = 'skybox', fallbackTop = '#79b7ff', fallbackBottom = '#dff1ff'): void {
  const texture = getDreamTexture(roleOrKey);
  if (texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    scene.background = new THREE.Color(fallbackTop);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, fallbackTop);
  gradient.addColorStop(1, fallbackBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const gradientTexture = new THREE.CanvasTexture(canvas);
  gradientTexture.colorSpace = THREE.SRGBColorSpace;
  scene.background = gradientTexture;
}

/** A camera-facing flat sprite (tree / pickup / character art) standing in the 3D world. */
export function makeBillboard(roleOrKey: string, width = 1, height = 1): THREE.Sprite | null {
  const texture = getDreamTexture(roleOrKey);
  if (!texture) return null;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.2 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  return sprite;
}

export type VoxelCell = { x: number; y: number; z: number; color?: string };

/**
 * Voxel/Minecraft-style block field as ONE InstancedMesh — thousands of blocks,
 * one draw call, phone-friendly. Pass a 'texture' role for block skins; per-cell
 * color tints (grass green, stone grey) work with or without the texture.
 */
export function buildVoxelField(
  scene: THREE.Scene,
  cells: VoxelCell[],
  options: { textureRole?: string; blockSize?: number } = {},
): THREE.InstancedMesh {
  const blockSize = options.blockSize || 1;
  const geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
  const texture = options.textureRole ? getDreamTexture(options.textureRole) : null;
  if (texture) texture.magFilter = THREE.NearestFilter;
  const material = new THREE.MeshLambertMaterial(texture ? { map: texture } : { color: '#ffffff' });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  cells.forEach((cell, i) => {
    matrix.setPosition(cell.x * blockSize, cell.y * blockSize, cell.z * blockSize);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.set(cell.color || '#ffffff'));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/**
 * Build a small VOXEL MODEL (ship, character, asteroid, gem, prop) from a list of colored grid
 * cells — the no-asset way to make models that read as PREMIUM instead of smooth-blob primitives.
 * Returns ONE InstancedMesh (one draw call, phone-safe) lit by MeshStandardMaterial, NOT added to
 * the scene: parent it to your entity Group and move/rotate that. Keep a model ~12-60 cells with a
 * recognizable silhouette. For glowing parts (engines, eyes, windows) add a few SEPARATE emissive
 * MeshStandardMaterial boxes on top — instanced cells can't be per-cell emissive, but the kernel
 * bloom will light those accent boxes. For big terrain/fields use buildVoxelField instead.
 */
export function voxelModel(
  cells: VoxelCell[],
  options: { size?: number; metalness?: number; roughness?: number } = {},
): THREE.InstancedMesh {
  const size = options.size || 0.25;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshStandardMaterial({
    metalness: options.metalness ?? 0.3,
    roughness: options.roughness ?? 0.55,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  cells.forEach((cell, i) => {
    matrix.setPosition((cell.x || 0) * size, (cell.y || 0) * size, (cell.z || 0) * size);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.set(cell.color || '#ffffff'));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/**
 * Standard mobile-safe renderer/scene/camera/lights boot. Lights are ALWAYS added
 * here so a generated game can never render pitch black.
 */
export function createThreeStage(canvas: HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  resize: () => void;
  render: () => void;
} {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // Premium defaults: smooth edges. (~Their scaffold quality — GameTok now matches it.)
      antialias: true,
      powerPreference: 'high-performance',
      // Keep the drawn frame readable so the headless verifier can confirm the
      // scene actually rendered (drawImage/getImageData on a WebGL canvas returns
      // blank otherwise). Minor cost, big reliability win for the 3D verifier.
      preserveDrawingBuffer: true,
    });
  } catch (err) {
    // Headless verifiers (and rare devices) can fail to allocate a WebGL context.
    // Rethrow with a stable "WebGL context" message so the sandbox recognizes this
    // as an environment limitation and bypasses, instead of it surfacing later as a
    // misleading uninitialized-state crash. Real devices have WebGL and never hit this.
    throw new Error('Error creating WebGL context: ' + ((err as Error)?.message || String(err)));
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Filmic tone mapping + exposure: richer, less flat colors (matches a premium renderer).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // Soft shadows. Free to leave on — meshes only cast/receive when they opt in
  // (mesh.castShadow / receiveShadow), so it never costs anything until used.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Code-colored sky (no image skybox in GameTok 3D) + matching distance fog.
  scene.background = new THREE.Color('#aacbe8');
  scene.fog = new THREE.Fog('#aacbe8', 30, 90);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 0, 0);

  // Mandatory lighting stack (key + fill + rim) — the premium-graphics recipe: a key light
  // defines form, hemisphere fills so nothing is pure black, and a RIM/back light separates
  // players and hazards from the background so silhouettes read. All free until meshes opt into
  // shadows. (key = sun, fill = hemisphere, rim = backLight.)
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#445566', 0.9);
  const sun = new THREE.DirectionalLight('#ffffff', 1.5);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0004;
  // Rim/back light: cool, low, from behind-opposite the key — edge-lights silhouettes so the
  // player/obstacles pop off the background. Cheap (no shadow).
  const backLight = new THREE.DirectionalLight('#bcd4ff', 0.55);
  backLight.position.set(-7, 6, -9);
  scene.add(hemisphere, sun, backLight);

  // PBR reflections (procedural, no asset files): a soft neutral environment so
  // MeshStandardMaterial / MeshPhysicalMaterial surfaces — metal, glass, car
  // paint, polished balls — catch real reflections even with few lights.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch { /* env is a bonus; never block rendering on it */ }

  // Bloom post-processing: emissive / bright parts GLOW (neon, engines, signs,
  // crystals, lights). The single biggest "AAA" lever — and pure Three.js.
  // High threshold so only intentionally-bright (emissive) things bloom.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // strength 0.55, radius 0.4, threshold 0.9 — only genuinely bright (emissive accent) pixels
  // bloom, and gently, so a too-emissive body glows instead of blowing out to a white blob.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const width = window.innerWidth || 390;
    const height = window.innerHeight || 844;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // Render through the composer so bloom is applied. Games should call
  // stage.render() (NOT renderer.render) so glow/tone-mapping are included.
  const render = () => composer.render();

  return { renderer, scene, camera, composer, bloom, resize, render };
}
