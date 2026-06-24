// GameTok Three.js asset kernel — bridges the DreamAssets image pack (FLUX 2D art)
// into Three.js materials. Geometry is code-built; these helpers paint it.
// Read-only kernel file: Phase 2 agent consumes these, never edits them.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
 * GUARANTEED one-thumb mobile controls. Builds a visible left joystick + (optional) right action
 * button inside #controls-layer so controls ALWAYS render, and reads WASD/arrows/space as a desktop
 * fallback. This is THE control scheme — call it instead of hand-rolling input, and never require
 * tapping the player/entity. move() = normalized intent (x = right, y = screen-up). One-handed.
 */
export function touchControls(
  options: { actionLabel?: string; joystick?: boolean; actionButton?: boolean; lookDrag?: boolean } = {},
): {
  move: () => THREE.Vector2;
  look: () => THREE.Vector2;
  actionHeld: () => boolean;
  consumeAction: () => boolean;
  dispose: () => void;
} {
  const layer = (document.getElementById('controls-layer') as HTMLElement) || document.body;
  const keys = new Set<string>();
  const moveOut = new THREE.Vector2();
  const lookOut = new THREE.Vector2();
  const stick = new THREE.Vector2();
  const lookAccum = new THREE.Vector2();
  const stickCenter = new THREE.Vector2();
  const radius = 55;
  let stickId = -1;
  let lookId = -1;
  let lookLastX = 0;
  let lookLastY = 0;
  let actionDown = false;
  let actionLatched = false;
  let base: HTMLElement | null = null;
  let knob: HTMLElement | null = null;
  let button: HTMLElement | null = null;

  if (options.joystick !== false) {
    base = document.createElement('div');
    base.setAttribute('data-control', 'joystick');
    base.style.cssText = 'position:absolute;left:24px;bottom:28px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);touch-action:none;';
    knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.55);';
    base.appendChild(knob);
    layer.appendChild(base);
  }
  if (options.actionButton) {
    button = document.createElement('button');
    button.setAttribute('data-control', 'action');
    button.textContent = options.actionLabel || '●';
    button.style.cssText = 'position:absolute;right:28px;bottom:40px;width:84px;height:84px;border-radius:50%;background:rgba(255,255,255,0.18);border:2px solid rgba(255,255,255,0.5);color:#fff;font-size:26px;touch-action:none;';
    layer.appendChild(button);
    button.addEventListener('pointerdown', (e: PointerEvent) => { e.preventDefault(); if (!actionDown) actionLatched = true; actionDown = true; });
    button.addEventListener('pointerup', (e: PointerEvent) => { e.preventDefault(); actionDown = false; });
    button.addEventListener('pointercancel', () => { actionDown = false; });
  }

  const onDown = (e: PointerEvent) => {
    const half = window.innerWidth / 2;
    if (options.joystick !== false && e.clientX < half && stickId === -1) {
      stickId = e.pointerId;
      if (base) {
        const r = base.getBoundingClientRect();
        stickCenter.set(r.left + r.width / 2, r.top + r.height / 2);
      } else {
        stickCenter.set(e.clientX, e.clientY);
      }
    } else if (options.lookDrag && lookId === -1) {
      lookId = e.pointerId;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
    }
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - stickCenter.x;
      let dy = e.clientY - stickCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, radius);
      dx = (dx / len) * clamped;
      dy = (dy / len) * clamped;
      stick.set(dx / radius, -dy / radius);
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === lookId) {
      lookAccum.x += e.clientX - lookLastX;
      lookAccum.y += e.clientY - lookLastY;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = -1;
      stick.set(0, 0);
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    } else if (e.pointerId === lookId) {
      lookId = -1;
    }
  };
  const kd = (e: KeyboardEvent) => { keys.add(e.code); if (e.code === 'Space') { if (!actionDown) actionLatched = true; actionDown = true; } };
  const ku = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Space') actionDown = false; };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  return {
    move() {
      let x = stick.x;
      let y = stick.y;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      moveOut.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      return moveOut;
    },
    look() { lookOut.copy(lookAccum); lookAccum.set(0, 0); return lookOut; },
    actionHeld() { return actionDown; },
    consumeAction() { const v = actionLatched; actionLatched = false; return v; },
    dispose() {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      if (base) base.remove();
      if (button) button.remove();
    },
  };
}

/**
 * Chase / orbit follow camera that ALWAYS keeps the target framed — a clamped, frame-rate-independent
 * lerp that physically CANNOT lose the player off-screen (the recurring 3D camera bug). Call
 * update(targetPosition, dt) every frame. addYaw(input.look().x * 0.005) to aim/orbit. shake(amount)
 * on impacts for built-in screen shake.
 */
export function followCamera(
  camera: THREE.PerspectiveCamera,
  options: { distance?: number; height?: number; stiffness?: number; lookHeight?: number } = {},
): {
  update: (target: THREE.Vector3, dt: number) => void;
  addYaw: (delta: number) => void;
  setYaw: (yaw: number) => void;
  shake: (amount: number) => void;
  dispose: () => void;
} {
  const distance = options.distance ?? 8;
  const height = options.height ?? 4;
  const stiffness = options.stiffness ?? 6;
  const lookHeight = options.lookHeight ?? 1;
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const off = new THREE.Vector3();
  let yaw = 0;
  let trauma = 0;
  return {
    update(target: THREE.Vector3, dt: number) {
      desired.set(
        target.x + Math.sin(yaw) * distance,
        target.y + height,
        target.z + Math.cos(yaw) * distance,
      );
      const t = 1 - Math.exp(-stiffness * Math.max(dt, 0.0001));
      camera.position.lerp(desired, t);
      // Hard clamp: never drift further than ~1.8x the rig distance — the player can't be lost.
      const maxDist = distance * 1.8 + height;
      off.copy(camera.position).sub(target);
      if (off.length() > maxDist) {
        off.setLength(maxDist);
        camera.position.copy(target).add(off);
      }
      trauma = Math.max(0, trauma - dt * 1.5);
      if (trauma > 0) {
        const s = trauma * trauma;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        camera.position.z += (Math.random() * 2 - 1) * s;
      }
      lookAt.set(target.x, target.y + lookHeight, target.z);
      camera.lookAt(lookAt);
    },
    addYaw(delta: number) { yaw += delta; },
    setYaw(y: number) { yaw = y; },
    shake(amount: number) { trauma = Math.min(1, trauma + amount); },
    dispose() { /* no listeners to clean */ },
  };
}

/**
 * Tiny solid-collision world. Register boxes/spheres/meshes as solids, then resolve(playerPos, radius)
 * every frame so the player CANNOT pass through them (the recurring walk-through-walls bug), and
 * hits(pos) to test projectile/pickup impacts. Pure AABB/sphere math — phone-cheap, no physics engine.
 */
export function collisionWorld(): {
  addBox: (center: THREE.Vector3, size: THREE.Vector3) => void;
  addSphere: (center: THREE.Vector3, radius: number) => void;
  addMesh: (mesh: THREE.Object3D, padding?: number) => void;
  resolve: (position: THREE.Vector3, radius: number) => boolean;
  hits: (position: THREE.Vector3, radius?: number) => boolean;
  clear: () => void;
} {
  const boxes: { c: THREE.Vector3; h: THREE.Vector3 }[] = [];
  const spheres: { c: THREE.Vector3; r: number }[] = [];
  const box3 = new THREE.Box3();
  const v = new THREE.Vector3();
  return {
    addBox(center: THREE.Vector3, size: THREE.Vector3) { boxes.push({ c: center.clone(), h: size.clone().multiplyScalar(0.5) }); },
    addSphere(center: THREE.Vector3, radius: number) { spheres.push({ c: center.clone(), r: radius }); },
    addMesh(mesh: THREE.Object3D, padding = 0) {
      box3.setFromObject(mesh);
      const c = box3.getCenter(new THREE.Vector3());
      const s = box3.getSize(new THREE.Vector3()).addScalar(padding * 2);
      boxes.push({ c, h: s.multiplyScalar(0.5) });
    },
    resolve(position: THREE.Vector3, radius: number) {
      let hit = false;
      for (const b of boxes) {
        const cx = Math.max(b.c.x - b.h.x, Math.min(position.x, b.c.x + b.h.x));
        const cy = Math.max(b.c.y - b.h.y, Math.min(position.y, b.c.y + b.h.y));
        const cz = Math.max(b.c.z - b.h.z, Math.min(position.z, b.c.z + b.h.z));
        v.set(position.x - cx, position.y - cy, position.z - cz);
        const d = v.length();
        if (d < radius) {
          hit = true;
          if (d > 1e-4) { v.setLength(radius - d); position.add(v); }
          else { position.x += radius; }
        }
      }
      for (const s of spheres) {
        v.copy(position).sub(s.c);
        const d = v.length();
        const min = radius + s.r;
        if (d < min && d > 1e-4) { hit = true; v.setLength(min - d); position.add(v); }
      }
      return hit;
    },
    hits(position: THREE.Vector3, radius = 0.15) {
      for (const b of boxes) {
        const cx = Math.max(b.c.x - b.h.x, Math.min(position.x, b.c.x + b.h.x));
        const cy = Math.max(b.c.y - b.h.y, Math.min(position.y, b.c.y + b.h.y));
        const cz = Math.max(b.c.z - b.h.z, Math.min(position.z, b.c.z + b.h.z));
        const dx = position.x - cx;
        const dy = position.y - cy;
        const dz = position.z - cz;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) return true;
      }
      for (const s of spheres) {
        if (position.distanceTo(s.c) <= radius + s.r) return true;
      }
      return false;
    },
    clear() { boxes.length = 0; spheres.length = 0; },
  };
}

/**
 * Photoreal procedural sky (atmospheric scattering) — the cinematic "movie sky", pure shader, NO
 * image/HDR. Adds the sky dome to the scene and returns { sky, sun, setSun }. sun is a direction
 * Vector3 — point stage.sunLight at it (e.g. stage.sunLight.position.copy(sky.sun).multiplyScalar(80))
 * so your shadows match the sky. Low elevation (~3-8) = golden sunset; high (~40) = midday.
 */
export function createSky(
  scene: THREE.Scene,
  options: { elevation?: number; azimuth?: number; turbidity?: number; rayleigh?: number } = {},
): { sky: Sky; sun: THREE.Vector3; setSun: (elevationDeg: number, azimuthDeg: number) => THREE.Vector3 } {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  scene.add(sky);
  const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
  uniforms['turbidity'].value = options.turbidity ?? 8;
  uniforms['rayleigh'].value = options.rayleigh ?? 2;
  uniforms['mieCoefficient'].value = 0.005;
  uniforms['mieDirectionalG'].value = 0.8;
  const sun = new THREE.Vector3();
  const setSun = (elevationDeg: number, azimuthDeg: number) => {
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    sun.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(sun);
    return sun.clone();
  };
  setSun(options.elevation ?? 25, options.azimuth ?? 180);
  return { sky, sun, setSun };
}

/**
 * Reflective, rippling water plane — code-only (procedural normal map, NO image files). Reflects the
 * sky/scene via the kernel's PBR environment. Add once, call update(t) each frame for moving ripples.
 * Great for oceans, lakes, pools, underwater surface. Tune color/opacity/size per game.
 */
export function createWater(
  scene: THREE.Scene,
  options: { size?: number; color?: string; opacity?: number; roughness?: number; metalness?: number; height?: number; normalRepeat?: number } = {},
): { mesh: THREE.Mesh; update: (t: number) => void; dispose: () => void } {
  const size = options.size ?? 400;
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const normalMap = proceduralTexture('noise', { size: 128, colorA: '#7f7fff', colorB: '#8f8fff', repeat: options.normalRepeat ?? 24 });
  normalMap.colorSpace = THREE.NoColorSpace;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.color || '#2f6fb0'),
    metalness: options.metalness ?? 0.2,
    roughness: options.roughness ?? 0.15,
    transparent: true,
    opacity: options.opacity ?? 0.85,
    normalMap,
    envMapIntensity: 1.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = options.height ?? 0;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return {
    mesh,
    update(t: number) { normalMap.offset.set((t * 0.02) % 1, (t * 0.015) % 1); },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); normalMap.dispose(); },
  };
}

/**
 * Procedural rolling terrain (multi-octave noise heightfield) — a flat plane is the #1 "cheap" tell;
 * this gives hills/dunes instead. Returns { mesh, heightAt(x,z) } so you can sit the player and props
 * ON the ground. Set flatShading:true for the faceted low-poly look. NO assets.
 */
export function createTerrain(
  scene: THREE.Scene,
  options: { size?: number; segments?: number; amplitude?: number; frequency?: number; color?: string; flatShading?: boolean } = {},
): { mesh: THREE.Mesh; heightAt: (x: number, z: number) => number } {
  const size = options.size ?? 200;
  const segments = options.segments ?? 100;
  const amplitude = options.amplitude ?? 6;
  const frequency = options.frequency ?? 0.04;
  const noise = (x: number, z: number) => {
    let n = Math.sin(x * frequency) * Math.cos(z * frequency);
    n += 0.5 * Math.sin(x * frequency * 2.3 + 1.7) * Math.cos(z * frequency * 1.9 + 0.5);
    n += 0.25 * Math.sin(x * frequency * 4.1 + 4.2) * Math.cos(z * frequency * 3.7 + 2.1);
    return (n / 1.75) * amplitude;
  };
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) pos.setY(i, noise(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.color || '#5a8f4a'),
    roughness: 0.95,
    metalness: 0,
    flatShading: !!options.flatShading,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, heightAt: (x: number, z: number) => noise(x, z) };
}

/**
 * Scatter an InstancedMesh of one geometry/material across an area (grass, rocks, trees, debris,
 * crowd) — one draw call for thousands, the cheap way to make a world feel DENSE instead of empty.
 * Pass options.heightAt (e.g. from createTerrain) to plant them on the ground. Random yaw + scale.
 */
export function scatter(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: { count?: number; area?: number; minScale?: number; maxScale?: number; heightAt?: (x: number, z: number) => number } = {},
): THREE.InstancedMesh {
  const count = options.count ?? 200;
  const area = options.area ?? 200;
  const minScale = options.minScale ?? 0.7;
  const maxScale = options.maxScale ?? 1.4;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() - 0.5) * area;
    const z = (Math.random() - 0.5) * area;
    const y = options.heightAt ? options.heightAt(x, z) : 0;
    const sc = minScale + Math.random() * (maxScale - minScale);
    quat.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    scale.set(sc, sc, sc);
    pos.set(x, y, z);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/**
 * Tiny tween — eased value 0->1 over duration. Keep the returned handle in an array and call
 * update(dt) each frame; drop it when it returns true. Use for squash-stretch on spawn/collect, UI
 * pops, door slides. ease: 'linear' | 'in' | 'out' | 'outBack' (springy).
 */
export function tween(options: { duration?: number; ease?: 'linear' | 'in' | 'out' | 'outBack'; onUpdate: (v: number) => void; onComplete?: () => void }): { update: (dt: number) => boolean } {
  const duration = options.duration ?? 0.3;
  let t = 0;
  let done = false;
  const ease = (x: number) => {
    if (options.ease === 'in') return x * x;
    if (options.ease === 'out') return 1 - (1 - x) * (1 - x);
    if (options.ease === 'outBack') { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
    return x;
  };
  return {
    update(dt: number) {
      if (done) return true;
      t = Math.min(1, t + dt / duration);
      options.onUpdate(ease(t));
      if (t >= 1) { done = true; if (options.onComplete) options.onComplete(); }
      return done;
    },
  };
}

/**
 * Damage/impact flash — briefly pulses a mesh's emissive then restores it. Returns a handle; call
 * update(dt) each frame until it returns true. Pure material tween (no assets), reads great with bloom.
 */
export function hitFlash(object: THREE.Object3D, options: { color?: string; duration?: number; intensity?: number } = {}): { update: (dt: number) => boolean } {
  const color = new THREE.Color(options.color || '#ffffff');
  const duration = options.duration ?? 0.15;
  const intensity = options.intensity ?? 1;
  const targets: { mat: THREE.MeshStandardMaterial; baseEmissive: THREE.Color; baseIntensity: number }[] = [];
  object.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : (mesh.material ? [mesh.material] : []);
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && sm.emissive) targets.push({ mat: sm, baseEmissive: sm.emissive.clone(), baseIntensity: sm.emissiveIntensity ?? 1 });
    }
  });
  for (const tg of targets) { tg.mat.emissive.copy(color); tg.mat.emissiveIntensity = intensity * 2; }
  let elapsed = 0;
  let done = false;
  return {
    update(dt: number) {
      if (done) return true;
      elapsed += dt;
      const k = Math.max(0, 1 - elapsed / duration);
      for (const tg of targets) {
        tg.mat.emissive.copy(tg.baseEmissive).lerp(color, k);
        tg.mat.emissiveIntensity = tg.baseIntensity + (intensity * 2 - tg.baseIntensity) * k;
      }
      if (elapsed >= duration) {
        done = true;
        for (const tg of targets) { tg.mat.emissive.copy(tg.baseEmissive); tg.mat.emissiveIntensity = tg.baseIntensity; }
      }
      return done;
    },
  };
}

/**
 * Ribbon trail behind a moving object (projectiles, swimmers, thrusters). Add once, call push(worldPos)
 * every frame with the object's position. One Line, no assets.
 */
export function trail(scene: THREE.Scene, options: { length?: number; color?: string } = {}): { line: THREE.Line; push: (point: THREE.Vector3) => void; dispose: () => void } {
  const length = options.length ?? 30;
  const positions = new Float32Array(length * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(options.color || '#66ccff'), transparent: true, opacity: 0.8 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  let inited = false;
  return {
    line,
    push(point: THREE.Vector3) {
      if (!inited) { for (let i = 0; i < length; i += 1) { positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z; } inited = true; }
      for (let i = length - 1; i > 0; i -= 1) { positions[i * 3] = positions[(i - 1) * 3]; positions[i * 3 + 1] = positions[(i - 1) * 3 + 1]; positions[i * 3 + 2] = positions[(i - 1) * 3 + 2]; }
      positions[0] = point.x; positions[1] = point.y; positions[2] = point.z;
      posAttr.needsUpdate = true;
    },
    dispose() { scene.remove(line); geometry.dispose(); material.dispose(); },
  };
}

/**
 * Floating world-anchored popup text (score +10, "NICE!", combo) that rises and fades. Projects a 3D
 * point to screen and drops a DOM node into #hud. Returns a handle; call update(dt) until it returns
 * true (then it removes itself).
 */
export function floatingText(text: string, worldPos: THREE.Vector3, camera: THREE.Camera, options: { color?: string; duration?: number } = {}): { update: (dt: number) => boolean } {
  const layer = (document.getElementById('hud') as HTMLElement) || document.body;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;pointer-events:none;font-weight:800;font-family:inherit;color:${options.color || '#ffffff'};text-shadow:0 2px 6px rgba(0,0,0,0.6);transform:translate(-50%,-50%);`;
  layer.appendChild(el);
  const duration = options.duration ?? 1;
  const start = worldPos.clone();
  const v = new THREE.Vector3();
  let elapsed = 0;
  let done = false;
  return {
    update(dt: number) {
      if (done) return true;
      elapsed += dt;
      const k = elapsed / duration;
      v.copy(start);
      v.y += k * 1.2;
      v.project(camera);
      el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
      el.style.opacity = String(Math.max(0, 1 - k));
      if (elapsed >= duration) { done = true; el.remove(); }
      return done;
    },
  };
}

/**
 * Stylized low-poly creature from a blueprint — the code-only "rough dragon / beast" path. Composes
 * primitives (body, head+snout+horns, legs, optional wings/tail/back-spikes, belly) into ONE Group you
 * move/rotate. flatShading defaults on for the faceted look. Recolor via body/belly/accent. Pair with
 * bobSway()/walk motion for life. Not a sculpted hero mesh — a readable stylized silhouette, no assets.
 */
export function composedCreature(options: {
  bodyColor?: string; bellyColor?: string; accentColor?: string;
  bodyLength?: number; bodyRadius?: number;
  head?: boolean; legs?: number; wings?: boolean; tail?: boolean; spikes?: boolean; flatShading?: boolean;
} = {}): THREE.Group {
  const group = new THREE.Group();
  const flat = options.flatShading !== false;
  const len = options.bodyLength ?? 2;
  const rad = options.bodyRadius ?? 0.5;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(options.bodyColor || '#4a7c4a'), roughness: 0.7, metalness: 0.05, flatShading: flat });
  const bellyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(options.bellyColor || '#d8c89a'), roughness: 0.8, flatShading: flat });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(options.accentColor || '#caa05a'), roughness: 0.6, flatShading: flat });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 8), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  if (options.head !== false) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.8, 8, 6), bodyMat);
    head.position.set(0, rad * 0.4, len / 2 + rad * 0.5);
    head.castShadow = true;
    group.add(head);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.45, rad * 0.9, 6), bodyMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, rad * 0.3, len / 2 + rad * 1.1);
    group.add(snout);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.12, rad * 0.6, 5), accentMat);
      horn.position.set(sx * rad * 0.35, rad * 1.0, len / 2 + rad * 0.3);
      horn.rotation.x = -0.3;
      group.add(horn);
    }
  }

  const legCount = options.legs ?? 4;
  const legLen = rad * 1.4;
  const legGeo = new THREE.CylinderGeometry(rad * 0.18, rad * 0.14, legLen, 6);
  for (let i = 0; i < legCount; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const front = i < 2 ? 1 : -1;
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(side * rad * 0.7, -rad - legLen * 0.5 + rad * 0.5, front * len * 0.28);
    leg.castShadow = true;
    group.add(leg);
  }

  if (options.wings) {
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(len * 0.9, len * 0.5);
      shape.lineTo(len * 0.9, -len * 0.1);
      shape.lineTo(len * 0.4, -len * 0.2);
      shape.lineTo(0, 0);
      const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }), accentMat);
      wing.position.set(sx * rad * 0.6, rad * 0.6, -len * 0.05);
      wing.rotation.y = sx > 0 ? -0.4 : Math.PI + 0.4;
      group.add(wing);
    }
  }

  if (options.tail !== false) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.4, len * 0.9, 6), bodyMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, rad * 0.1, -len / 2 - len * 0.35);
    group.add(tail);
  }

  if (options.spikes) {
    for (let i = 0; i < 5; i += 1) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.14, rad * 0.5, 5), accentMat);
      sp.position.set(0, rad + rad * 0.2, len * 0.4 - i * (len * 0.8 / 4));
      group.add(sp);
    }
  }

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(rad * 0.7, len * 0.9, 3, 6), bellyMat);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, -rad * 0.35, 0);
  belly.scale.set(1, 0.6, 1);
  group.add(belly);

  return group;
}

const _modelLoader = new GLTFLoader();
const _modelCache: Record<string, THREE.Group> = {};

/**
 * Solid, neutrally-shaded stand-in returned when a model fails to load (bad/invented key, missing
 * URL, or no WebGL). A plain lit box reads as a placeholder prop — never a broken magenta wireframe —
 * and lets the rest of the scene finish initializing instead of the await throwing. ~1 unit; the
 * caller scales/positions it like any real model.
 */
function _fallbackModel(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.7, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.6), mat);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.8), mat);
  cabin.position.set(0, 0.4, -0.1);
  group.add(body, cabin);
  return group;
}

/**
 * Load a GLB/GLTF model (a Kenney CC0 kit piece, etc.) from a URL or inline data-URI. Returns a fresh
 * cloned Group you can position/add — the loaded source is cached so cloning more is cheap. The model
 * opts into shadows automatically. await it during init (use preloadModels first so the await resolves
 * instantly). Register solids with collisionWorld().addMesh(model).
 *
 * SIZING (important — Kenney kits do NOT share a scale, so a raw model can import 10x too big/small):
 *   - options.fitSize: normalize so the model's LARGEST dimension == fitSize world units. This is the
 *     reliable way to size a piece to your scene — prefer it over guessing options.scale. e.g. a player
 *     car ~2 units long -> { fitSize: 2 }.
 *   - options.scale: raw uniform multiplier (only used if fitSize is not given).
 *   - options.recenter: center the piece on X/Z and rest it on the ground (y=0) so it never floats/sinks.
 * THEMING:
 *   - options.tint: multiply every material toward this color (preserves the model's shading + multi-part
 *     variety while shifting its palette). Works best on neutral/white kit pieces. Materials are cloned,
 *     so tinting one instance never affects others.
 */
export async function loadModel(
  source: string,
  options: { scale?: number; fitSize?: number; recenter?: boolean; tint?: string } = {},
): Promise<THREE.Group> {
  let template = _modelCache[source];
  if (!template) {
    // Materialized models are inlined as base64 data-URIs in window.DREAM_MODELS (keyed by the same
    // key, e.g. 'kenney3d/car_kit/van.glb'); fall back to treating source as a plain URL/path.
    const inlined = (window as any).DREAM_MODELS || {};
    const resolved: string = typeof inlined[source] === 'string' ? inlined[source] : source;
    try {
      const gltf = await _modelLoader.loadAsync(resolved);
      template = gltf.scene;
    } catch (err) {
      // Never let a bad key take down init. Warn loudly (with the real keys so the cause is
      // obvious in logs), substitute a solid placeholder, and cache it under this key so repeated
      // loadModel(badKey) calls clone the stand-in instead of re-fetching + re-warning.
      const keys = Object.keys(inlined);
      console.warn(
        `[loadModel] could not load "${source}" — using a procedural placeholder. ` +
          (keys.length ? `Available model keys: ${keys.join(', ')}` : 'window.DREAM_MODELS is empty (no models inlined).'),
      );
      template = _fallbackModel();
    }
    _modelCache[source] = template;
  }
  const model = template.clone(true);

  // Tint: clone each material first (clone(true) shares materials with the cached template, so mutating
  // in place would recolor every instance), then multiply its color toward the requested tint.
  if (options.tint) {
    const tint = new THREE.Color(options.tint);
    model.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        const c = (m as THREE.Material).clone() as THREE.Material & { color?: THREE.Color };
        if (c.color) c.color.multiply(tint);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
  }

  // Auto-fit beats guessing: normalize so the largest dimension == fitSize. Falls back to raw scale.
  if (options.fitSize && options.fitSize > 0) {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(options.fitSize / maxDim);
  } else if (options.scale) {
    model.scale.setScalar(options.scale);
  }

  // Recenter on X/Z and drop onto the ground plane (uses the post-scale bounding box).
  if (options.recenter) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  model.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  return model;
}

/** Pre-load several models up front (await once in init) so later loadModel() calls clone instantly. */
export async function preloadModels(sources: string[]): Promise<void> {
  await Promise.all(sources.map((s) => loadModel(s).catch(() => null)));
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
  sunLight: THREE.DirectionalLight;
  hemisphereLight: THREE.HemisphereLight;
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
  // 1.1 — richer highlights so lit windows/engines/signs pop against a moody scene. The
  // white-out problem was never this number; it was bright daytime themes + bodies set
  // fully emissive (see the NO-WHITE-OUT rule). Fix those and 1.1 reads cinematic, not washed.
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
  // strength 0.55, radius 0.4, threshold 0.9 — emissive accents (lights, engines, signs, neon
  // trims) glow with real presence against a dark/moody scene, the look that read as "premium"
  // pre-regression. The threshold still gates out non-emissive surfaces, so this only blows out
  // if the builder makes whole bodies/ground emissive — which the NO-WHITE-OUT rule forbids.
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

  return { renderer, scene, camera, composer, bloom, sunLight: sun, hemisphereLight: hemisphere, resize, render };
}

/**
 * Attach ANY fullscreen fragment shader as an animated background behind the gameplay. This is the
 * primitive that makes "draw the whole backdrop from math" cheap and SAFE — it owns all the kernel
 * plumbing so you can't get the integration wrong: a fullscreen quad, depthTest/depthWrite off +
 * renderOrder -1000 (always behind your scene), and `u_time` (seconds) + `u_res` (pixels) uniforms
 * updated every frame on its own rAF (never touches your render loop).
 *
 * YOU write the creative part — the fragment shader — matched to whatever the game's setting calls for:
 * a neon city skyline, an ocean horizon, a canyon, a warp tunnel, a starfield, raymarched hills,
 * anything. Your shader gets `varying vec2 vUv` (0..1) plus any uniforms you pass in. See
 * createSDFBackground below for a complete worked example of the pattern. Returns { mesh, material, dispose }.
 */
export function createShaderBackground(
  stage: { scene: THREE.Scene; renderer: THREE.WebGLRenderer },
  config: { fragmentShader: string; uniforms?: Record<string, { value: any }> },
): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; dispose: () => void } {
  const uniforms: Record<string, { value: any }> = {
    u_time: { value: 0 },
    u_res: { value: new THREE.Vector2(1, 1) },
    ...(config.uniforms || {}),
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: config.fragmentShader,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  stage.scene.add(mesh);
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let raf = 0;
  let alive = true;
  const size = new THREE.Vector2();
  const tick = () => {
    if (!alive) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    uniforms.u_time.value = (now - start) / 1000;
    stage.renderer.getSize(size);
    uniforms.u_res.value.set(size.x || 1, size.y || 1);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const dispose = () => {
    alive = false;
    cancelAnimationFrame(raf);
    stage.scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
  };
  return { mesh, material, dispose };
}

/**
 * WORKED EXAMPLE on top of createShaderBackground: a raymarched SDF dusk-hills vista. This is a
 * REFERENCE for the pattern, not a one-size-fits-all backdrop — don't ship hills for an ocean game.
 * Copy the structure (write a fragment shader, hand it to createShaderBackground) and author the scene
 * the prompt actually wants. Colors here are tunable via options (all 0..1 RGB): skyTop, skyHorizon,
 * sun, ground.
 */
export function createSDFBackground(
  stage: { scene: THREE.Scene; renderer: THREE.WebGLRenderer },
  options: {
    skyTop?: [number, number, number];
    skyHorizon?: [number, number, number];
    sun?: [number, number, number];
    ground?: [number, number, number];
    speed?: number;
  } = {},
): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; dispose: () => void } {
  const uniforms = {
    u_time: { value: 0 },
    u_res: { value: new THREE.Vector2(1, 1) },
    u_speed: { value: options.speed ?? 1.0 },
    u_skyTop: { value: new THREE.Color().fromArray(options.skyTop ?? [0.04, 0.06, 0.16]) },
    u_skyHorizon: { value: new THREE.Color().fromArray(options.skyHorizon ?? [0.95, 0.45, 0.28]) },
    u_sun: { value: new THREE.Color().fromArray(options.sun ?? [1.0, 0.8, 0.5]) },
    u_ground: { value: new THREE.Color().fromArray(options.ground ?? [0.16, 0.10, 0.22]) },
  };

  const fragmentShader = `
    varying vec2 vUv;
    uniform float u_time, u_speed;
    uniform vec2 u_res;
    uniform vec3 u_skyTop, u_skyHorizon, u_sun, u_ground;

    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p){ float v=0.,a=0.55; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<4;i++){ v+=a*noise(p); p=m*p; a*=0.5; } return v; }
    float terrain(vec2 p){ return fbm(p*0.22)*3.2 - 1.4; }

    void main(){
      vec2 p = vUv*2.0 - 1.0;
      p.x *= u_res.x / max(u_res.y, 1.0);
      vec3 ro = vec3(0.0, 1.7, 0.0);
      vec3 rd = normalize(vec3(p.x, p.y - 0.08, 1.6));
      float fwd = u_time * u_speed * 1.4;

      float sky_t = clamp(rd.y*1.3 + 0.25, 0.0, 1.0);
      vec3 col = mix(u_skyHorizon, u_skyTop, sky_t);
      vec3 sunDir = normalize(vec3(0.0, 0.05, 1.0));
      float sd = max(dot(rd, sunDir), 0.0);
      col += u_sun * pow(sd, 5.0) * 0.6;
      col += u_sun * pow(sd, 200.0) * 2.0;
      float st = step(0.86, sky_t) * step(0.997, noise(rd.xy*140.0));
      col += vec3(st) * sky_t;

      float t = 0.0, hit = -1.0;
      for(int i=0;i<90;i++){
        vec3 pos = ro + rd*t;
        float h = pos.y - terrain(vec2(pos.x, pos.z + fwd));
        if(h < 0.0018*t){ hit = t; break; }
        t += h*0.42;
        if(t > 48.0) break;
      }
      if(hit > 0.0){
        vec3 pos = ro + rd*hit;
        float e = 0.04;
        float h0 = terrain(vec2(pos.x, pos.z+fwd));
        float hx = terrain(vec2(pos.x+e, pos.z+fwd));
        float hz = terrain(vec2(pos.x, pos.z+fwd+e));
        vec3 n = normalize(vec3(h0-hx, e, h0-hz));
        float diff = clamp(dot(n, sunDir)*0.5+0.5, 0.0, 1.0);
        vec3 land = mix(u_ground*0.6, u_ground, diff);
        land += u_sun * pow(diff, 4.0) * 0.5;
        float fog = 1.0 - exp(-hit*hit*0.0042);
        col = mix(land, col, fog);
      }

      col = pow(max(col, 0.0), vec3(0.86));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  return createShaderBackground(stage, { fragmentShader, uniforms });
}
