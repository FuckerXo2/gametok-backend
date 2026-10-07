---
name: threejs-open-world-builder
description: "Architect and build high-performance 3D open-world games (GTA/Lagos style) in Three.js for mobile WebKit & desktop. Implements 3x3 coordinate chunk streaming (hero block + dynamic neighbor streaming), 100-bone rigged humanoid loading with Mixamo locomotion blending, responsive mobile touch joystick, third-person lerp follow camera, and a declarative WORLD_CHUNKS manifest enabling WishStudio / Creator AI live edits."
---

# Three.js Open-World & District Builder

## Purpose
Build robust, crash-free 3D open-world browser games running on mobile phones and desktop. Eliminates Out-Of-Memory (OOM) crashes by streaming chunks dynamically around the player, loads user-attached 100-bone rigged GLTF characters, blends Mixamo animations, and organizes city geometry into modular coordinate chunks that can be live-edited through Creator AI prompts.

---

## Core Architecture Pillars

### 1. The 3×3 Coordinate Chunk Streaming Engine
Mobile browsers (iOS Safari, Android Chrome WebKit) crash when rendering massive monolithic city models. The open-world engine solves this using coordinate-based chunk streaming:
- **Chunk Size**: Standard square block (e.g. `CHUNK_SIZE = 60` units / meters).
- **Active Grid**: Only the 9 chunks immediately surrounding the player `(playerChunkX ± 1, playerChunkZ ± 1)` exist in the scene.
- **Hero Block `(0, 0)`**: The handcrafted starter district block where the player spawns. It contains dense street props, roadside kiosks, traffic barriers, streetlights, and ambient vehicles.
- **Dynamic Streaming**: As the player moves across chunk boundaries:
  - Entering a new coordinate triggers instantiating entering chunks and culling exiting chunks into an object pool or disposing geometries/materials cleanly.
  - Draw calls remain strictly bounded ($< 60$ draw calls on screen).

```javascript
const CHUNK_SIZE = 60;
const loadedChunks = new Map(); // key: "x,z" -> THREE.Group

function updateWorldChunks(playerPos) {
    const cx = Math.floor((playerPos.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const cz = Math.floor((playerPos.z + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const activeKeys = new Set();

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const key = `${cx + dx},${cz + dz}`;
            activeKeys.add(key);
            if (!loadedChunks.has(key)) {
                const chunkGroup = spawnChunk(cx + dx, cz + dz);
                scene.add(chunkGroup);
                loadedChunks.set(key, chunkGroup);
            }
        }
    }

    // Cull chunks outside the 3x3 window
    for (const [key, group] of loadedChunks.entries()) {
        if (!activeKeys.has(key)) {
            scene.remove(group);
            disposeHierarchy(group);
            loadedChunks.delete(key);
        }
    }
}
```

---

### 2. Rigged Humanoid Character Controller (100-Bone UE5 Rig)
When user attachments include rigged characters (`is_rigged: true`, e.g. `street_hustler_rigged.glb`, `tech_bro_rigged.glb`, `veteran_rigged.glb`):
1. **Load via GLTFLoader**:
   ```javascript
   const loader = new THREE.GLTFLoader();
   let mixer = null;
   let characterMesh = null;
   let currentAction = null;
   const animations = {};

   loader.load(heroGlbUrl, (gltf) => {
       characterMesh = gltf.scene;
       characterMesh.traverse((child) => {
           if (child.isMesh) {
               child.castShadow = true;
               child.receiveShadow = true;
           }
       });
       characterMesh.position.set(0, 0, 0);
       scene.add(characterMesh);

       mixer = new THREE.AnimationMixer(characterMesh);
       // Register loaded clips (or Mixamo GLB clips)
       if (gltf.animations && gltf.animations.length > 0) {
           gltf.animations.forEach((clip) => {
               animations[clip.name.toLowerCase()] = mixer.clipAction(clip);
           });
       }
   }, undefined, (err) => {
       console.warn('Hero GLB load failed, falling back to procedural stylized hero', err);
       characterMesh = createProceduralHero();
       scene.add(characterMesh);
   });
   ```

2. **Locomotion State Blending (`idle` -> `walk` -> `run`)**:
   - Drive blend weight directly by thumbstick magnitude ($0.0 \dots 1.0$).
   - Rotate the character smoothly toward the movement vector:
     ```javascript
     const moveAngle = Math.atan2(inputDir.x, inputDir.z);
     characterMesh.rotation.y = THREE.MathUtils.lerp(
         characterMesh.rotation.y,
         moveAngle,
         0.18
     );
     ```

3. **Zero-Crash Resilience**:
   - If network latency delays the GLB or an external animation clip, the game renders a procedural stylized proxy runner and transitions seamlessly once the GLB parses. Never freeze the render loop!

---

### 3. Mobile Touch Controls & Third-Person Follow Camera

1. **Virtual Touch Joystick (Left Thumb)**:
   - Dynamic or fixed touch zone in bottom-left 35% of screen.
   - Outputs normalized `vector2` (`{ x: -1..1, y: -1..1 }`).
   - Smooth deadband filter ($< 0.08$ ignored).

2. **Action Buttons (Right Thumb)**:
   - Sprint / Dodge / Punch / Enter Vehicle floating action circles.
   - Injects `window.GameTOK?.haptic('medium')` on press.

3. **Smooth Follow Camera**:
   ```javascript
   const cameraOffset = new THREE.Vector3(0, 3.8, -6.5);
   const currentTarget = new THREE.Vector3();

   function updateCamera(delta) {
       if (!characterMesh) return;
       // Target position behind character aligned with camera angle
       const desiredPosition = characterMesh.position.clone().add(
           cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), characterYaw)
       );
       camera.position.lerp(desiredPosition, 0.12);
       currentTarget.lerp(
           characterMesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
           0.15
       );
       camera.lookAt(currentTarget);
   }
   ```

---

### 4. Declarative `WORLD_CHUNKS` Manifest (WishStudio / Creator Edit Integration)
To enable live prompt-driven editing in WishStudio (e.g. *"add a police checkpoint with yellow Danfo buses on the next block"*), define all chunk configurations in a clean, declarative registry:

```javascript
const WORLD_CHUNKS = {
    "0,0": {
        theme: "lagos_downtown_starter",
        name: "Broad Street Starter",
        hasExpressway: true,
        props: [
            { type: "danfo_bus", x: 6, z: 12, rotY: 0.2 },
            { type: "street_stall", x: -8, z: 5, rotY: 1.57 },
            { type: "street_lamp", x: 7, z: 0 },
            { type: "street_lamp", x: -7, z: 0 },
            { type: "gutter_drain", x: -6.5, z: 0, length: 50 },
        ],
        buildings: [
            { type: "commercial_kiosk", x: -14, z: 10, floors: 2 },
            { type: "bank_tower", x: 16, z: -10, floors: 5 },
        ]
    },
    "0,1": {
        theme: "expressway_bridge",
        name: "Lekki-Ikoyi Toll Expressway",
        hasExpressway: true,
        props: [
            { type: "police_checkpoint", x: 0, z: 20 },
            { type: "danfo_bus", x: -4, z: 25, rotY: 0.05 },
            { type: "danfo_bus", x: 4, z: 40, rotY: 3.14 }
        ]
    }
};

function getChunkData(cx, cz) {
    const key = `${cx},${cz}`;
    if (WORLD_CHUNKS[key]) return WORLD_CHUNKS[key];
    // Procedural fallback district generator for unscripted coordinates
    return generateProceduralLagosChunk(cx, cz);
}
```

When the user enters a prompt in WishStudio:
- The AI locates the targeted chunk coordinate `(cx, cz)` in `WORLD_CHUNKS`.
- It inserts or modifies props (e.g. adding `{ type: "suya_spot", x: -5, z: 8 }` or `{ type: "police_checkpoint" }`).
- Code changes remain surgical, localized, and instantly hot-reloadable without breaking the rest of the game!

---

## Lagos Environmental Kit & Authenticity Guidelines
When authoring the Lagos starter district:
1. **Asphalt & Pavements**:
   - Dark asphalt road (`#222327`) with faded yellow central road dividing lines (`#e6b800`).
   - Sidewalk curbs with alternating black and white hazard striping or raw concrete texture.
   - Concrete open drainage gutters flanking pedestrian walkways.
2. **Iconic Props**:
   - **Danfo Buses**: Distinctive bright yellow (`#f5b301`) commercial minibuses with twin black horizontal stripes running along the waistline.
   - **Market Umbrellas & Kiosks**: Colorful striped canopies (blue/white, green/white), wooden plank fruit/suya stands.
   - **Overhead Infrastructure**: Concrete utility poles with transformer boxes and sagging low-voltage cables overhead.
   - **Street Billboards**: Colorful advertising boards along expressways.
3. **Lighting & Atmosphere**:
   - High-sun tropical daylight (`#fff2db`, intensity 1.4) or humid twilight golden hour (`#ff8533`, intensity 1.6) with deep ambient shadow fill (`#3a4b66`, intensity 0.55).
   - Atmospheric haze/fog (`#c9b097`, near: 40, far: 180) to naturally veil chunk loading at the horizon.
