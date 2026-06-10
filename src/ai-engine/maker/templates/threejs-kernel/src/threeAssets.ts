// GameTok Three.js asset kernel — bridges the DreamAssets image pack (FLUX 2D art)
// into Three.js materials. Geometry is code-built; these helpers paint it.
// Read-only kernel file: Phase 2 agent consumes these, never edits them.
import * as THREE from 'three';

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
 * Standard mobile-safe renderer/scene/camera/lights boot. Lights are ALWAYS added
 * here so a generated game can never render pitch black.
 */
export function createThreeStage(canvas: HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
} {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    // Keep the drawn frame readable so the headless verifier can confirm the
    // scene actually rendered (drawImage/getImageData on a WebGL canvas returns
    // blank otherwise). Minor cost, big reliability win for the 3D verifier.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#9bbbd4', 30, 90);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 0, 0);

  // Mandatory lighting — hemisphere fills, directional shapes. Never remove both.
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#445566', 1.0);
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(6, 12, 4);
  scene.add(hemisphere, sun);

  const resize = () => {
    const width = window.innerWidth || 390;
    const height = window.innerHeight || 844;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
}
