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
 * Free the GPU memory of an object and everything under it (geometry + materials + their textures),
 * then you scene.remove() it. CALL THIS whenever you discard an entity — recycled obstacles,
 * spent projectiles, cleared levels. Without it a runner/shooter that spawns + drops objects every
 * few seconds leaks geometry/material/texture handles until the phone GPU stalls.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
          (value as THREE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

/**
 * Procedural CanvasTexture — code-only surface detail (sand, water, panels, grids, polka) with NO
 * image files. kind: 'noise' | 'gradient' | 'checker' | 'stripes' | 'dots'. Returns a repeating sRGB
 * texture; assign to material.map (and reuse the same texture across many meshes). Tune colors/scale
 * per surface. This is the no-asset way to kill the flat-plastic single-color look.
 */
export function proceduralTexture(
  kind: 'noise' | 'gradient' | 'checker' | 'stripes' | 'dots' = 'noise',
  options: { size?: number; colorA?: string; colorB?: string; repeat?: number; scale?: number } = {},
): THREE.CanvasTexture {
  const size = options.size || 256;
  const colorA = options.colorA || '#7a7a7a';
  const colorB = options.colorB || '#b8b8b8';
  const scale = options.scale || 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  if (kind === 'noise') {
    const img = ctx.getImageData(0, 0, size, size);
    const a = new THREE.Color(colorA);
    const b = new THREE.Color(colorB);
    const tmp = new THREE.Color();
    for (let i = 0; i < size * size; i += 1) {
      tmp.copy(a).lerp(b, Math.random());
      img.data[i * 4] = tmp.r * 255;
      img.data[i * 4 + 1] = tmp.g * 255;
      img.data[i * 4 + 2] = tmp.b * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  } else if (kind === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, colorA);
    g.addColorStop(1, colorB);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else {
    const cell = size / scale;
    ctx.fillStyle = colorB;
    for (let y = 0; y < scale; y += 1) {
      for (let x = 0; x < scale; x += 1) {
        if (kind === 'checker' && (x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
        else if (kind === 'stripes' && x % 2 === 0) ctx.fillRect(x * cell, 0, cell, size);
        else if (kind === 'dots') {
          ctx.beginPath();
          ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(options.repeat || 1, options.repeat || 1);
  return texture;
}

/**
 * Lightweight pooled particle field for code-only VFX (impacts, pickups, thruster trails, bubbles,
 * sparks). Create ONE per effect-color, call update(dt) every frame, and burst(position) on events.
 * It's a single THREE.Points draw call (phone-safe). Emissive + the kernel bloom make sparks glow.
 */
export function createParticleField(
  scene: THREE.Scene,
  options: { max?: number; size?: number; color?: string; gravity?: number; additive?: boolean } = {},
): {
  points: THREE.Points;
  burst: (origin: THREE.Vector3, opts?: { count?: number; speed?: number; spread?: number; life?: number }) => void;
  update: (dt: number) => void;
  dispose: () => void;
} {
  const max = options.max || 240;
  const gravity = options.gravity ?? 6;
  const positions = new Float32Array(max * 3);
  const velocities = new Float32Array(max * 3);
  const life = new Float32Array(max);
  for (let i = 0; i < max; i += 1) positions[i * 3 + 1] = -9999;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const material = new THREE.PointsMaterial({
    size: options.size || 0.18,
    color: new THREE.Color(options.color || '#ffffff'),
    transparent: true,
    depthWrite: false,
    blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;
  return {
    points,
    burst(origin: THREE.Vector3, opts: { count?: number; speed?: number; spread?: number; life?: number } = {}) {
      const count = opts.count || 16;
      const speed = opts.speed || 3;
      const spread = opts.spread ?? 1;
      const ttl = opts.life || 0.6;
      for (let i = 0; i < count; i += 1) {
        const idx = cursor;
        cursor = (cursor + 1) % max;
        positions[idx * 3] = origin.x;
        positions[idx * 3 + 1] = origin.y;
        positions[idx * 3 + 2] = origin.z;
        velocities[idx * 3] = (Math.random() * 2 - 1) * spread * speed;
        velocities[idx * 3 + 1] = Math.random() * speed + speed * 0.3;
        velocities[idx * 3 + 2] = (Math.random() * 2 - 1) * spread * speed;
        life[idx] = ttl;
      }
    },
    update(dt: number) {
      for (let i = 0; i < max; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { positions[i * 3 + 1] = -9999; continue; }
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        velocities[i * 3 + 1] -= gravity * dt;
      }
      posAttr.needsUpdate = true;
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Procedural idle motion — gentle bob + sway so props/creatures/pickups feel alive without rigs or
 * assets. Call every frame with an increasing time t (seconds); pass a per-object phase so a field of
 * them doesn't move in lockstep. Remembers each object's base Y the first time it sees it.
 */
export function bobSway(
  object: THREE.Object3D,
  t: number,
  options: { bob?: number; bobSpeed?: number; sway?: number; swaySpeed?: number; phase?: number } = {},
): void {
  const bob = options.bob ?? 0.1;
  const bobSpeed = options.bobSpeed ?? 2;
  const sway = options.sway ?? 0.05;
  const swaySpeed = options.swaySpeed ?? 1.5;
  const phase = options.phase ?? 0;
  const ud = object.userData as { __bobBaseY?: number };
  if (ud.__bobBaseY === undefined) ud.__bobBaseY = object.position.y;
  object.position.y = ud.__bobBaseY + Math.sin(t * bobSpeed + phase) * bob;
  object.rotation.z = Math.sin(t * swaySpeed + phase) * sway;
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
