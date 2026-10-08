---
name: threejs-open-world-builder
description: "Architect and build high-performance 3D open-world and free-roam games in Three.js for mobile WebKit & desktop. Implements 3x3 coordinate chunk streaming (hero block + dynamic neighbor streaming), memory-safe mesh pooling, third-person follow camera, responsive mobile touch controls, and a declarative WORLD_CHUNKS manifest enabling live Creator AI edits."
---

# Three.js Open-World & District Builder

## Purpose
Build robust, crash-free 3D open-world browser games running on mobile phones and desktop. Eliminates Out-Of-Memory (OOM) crashes on mobile WebViews by streaming modular coordinate chunks dynamically around the player, pooling meshes, and organizing world geometry into a declarative chunk manifest.

---

## Core Architecture Pillars

### 1. The 3×3 Coordinate Chunk Streaming Engine
Mobile browsers (iOS Safari, Android Chrome WebKit) crash when rendering massive monolithic world models. The open-world engine solves this using coordinate-based chunk streaming:
- **Chunk Size**: Standard square block (e.g. `CHUNK_SIZE = 60` meters).
- **Active Grid**: Only the 9 chunks immediately surrounding the player `(playerChunkX ± 1, playerChunkZ ± 1)` exist in the scene.
- **Hero Block `(0, 0)`**: The handcrafted starter block where the player spawns. It contains primary roads, starter props, and landmarks.
- **Dynamic Streaming**: As the player moves across chunk boundaries:
  - Entering a new coordinate instantiates adjacent chunks and culls exiting chunks into an object pool or disposes geometries/materials cleanly.
  - Draw calls remain strictly bounded (< 60 draw calls on screen).

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

### 2. Rigged Humanoid & Vehicle Controller

1. **Character Locomotion / Vehicle Controller**:
   - Drive movement via normalized input vector (`inputDir.x`, `inputDir.z`).
   - Rotate the entity smoothly toward the movement vector:
     ```javascript
     const moveAngle = Math.atan2(inputDir.x, inputDir.z);
     entity.rotation.y = THREE.MathUtils.lerp(entity.rotation.y, moveAngle, 0.18);
     ```

2. **Smooth Follow Camera**:
   ```javascript
   const cameraOffset = new THREE.Vector3(0, 3.8, -6.5);
   const currentTarget = new THREE.Vector3();

   function updateCamera(delta) {
       if (!playerEntity) return;
       const desiredPosition = playerEntity.position.clone().add(
           cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw)
       );
       camera.position.lerp(desiredPosition, 0.12);
       currentTarget.lerp(
           playerEntity.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
           0.15
       );
       camera.lookAt(currentTarget);
   }
   ```

---

### 3. Declarative `WORLD_CHUNKS` Manifest (Creator AI Live Edits)
To enable prompt-driven editing in WishStudio (e.g. *"add a police checkpoint with roadblocks on the next block"*), define all chunk configurations in a clean, declarative registry:

```javascript
const WORLD_CHUNKS = {
    "0,0": {
        theme: "downtown_starter",
        name: "Main District Starter",
        hasRoads: true,
        props: [
            { type: "vehicle", x: 6, z: 12, rotY: 0.2 },
            { type: "street_lamp", x: 7, z: 0 },
            { type: "street_lamp", x: -7, z: 0 },
        ],
        buildings: [
            { type: "retail_shop", x: -14, z: 10, floors: 2 },
            { type: "office_tower", x: 16, z: -10, floors: 5 },
        ]
    },
    "0,1": {
        theme: "expressway",
        name: "North Highway",
        hasRoads: true,
        props: [
            { type: "checkpoint", x: 0, z: 20 },
            { type: "traffic_vehicle", x: -4, z: 25 },
        ]
    }
};

function getChunkData(cx, cz) {
    const key = `${cx},${cz}`;
    if (WORLD_CHUNKS[key]) return WORLD_CHUNKS[key];
    return generateProceduralChunk(cx, cz);
}
```

---

### 4. Environmental Kit & Mobile Graphics Optimization
- **Instanced Props**: Use `THREE.InstancedMesh` for repetitive items (streetlights, trees, barriers, parked cars) to keep draw calls low.
- **Atmospheric Fog**: Use exponential or linear distance fog matching the sky color to naturally conceal chunk loading at the horizon.
- **Shadow Performance**: Bound shadow maps (1024×1024 PCFSoftShadowMap) and track the shadow camera directly above the player rather than across the entire world.
