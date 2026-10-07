# 3D Coordinate Chunk Streaming Recipe for Mobile WebGL

## Goal
Implement a 3x3 bounding grid that streams chunks in and out as the player moves across the coordinate plane, keeping draw calls under 60 and memory footprint below 80MB.

## Complete Implementation Pattern

```javascript
class ChunkWorldManager {
    constructor(scene, chunkSize = 60) {
        this.scene = scene;
        this.chunkSize = chunkSize;
        this.loadedChunks = new Map(); // key "x,z" -> THREE.Group
        this.objectPool = [];
        this.sharedMaterials = this.initSharedMaterials();
        this.sharedGeometries = this.initSharedGeometries();
    }

    initSharedMaterials() {
        return {
            road: new THREE.MeshStandardMaterial({ color: 0x242529, roughness: 0.85 }),
            roadStripe: new THREE.MeshBasicMaterial({ color: 0xebb400 }),
            curb: new THREE.MeshStandardMaterial({ color: 0x8a8a8e, roughness: 0.9 }),
            sidewalk: new THREE.MeshStandardMaterial({ color: 0xb0b0b5, roughness: 0.8 }),
            grass: new THREE.MeshStandardMaterial({ color: 0x3d5a2f, roughness: 0.95 }),
            danfoYellow: new THREE.MeshStandardMaterial({ color: 0xfcb003, roughness: 0.35, metalness: 0.2 }),
            danfoStripe: new THREE.MeshBasicMaterial({ color: 0x111111 }),
            glass: new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.1, transmission: 0.85 }),
            wallCream: new THREE.MeshStandardMaterial({ color: 0xd9cca9, roughness: 0.7 }),
            wallBrick: new THREE.MeshStandardMaterial({ color: 0x9e523f, roughness: 0.85 }),
            rustRoof: new THREE.MeshStandardMaterial({ color: 0x7c493a, roughness: 0.9 }),
            tarpBlue: new THREE.MeshStandardMaterial({ color: 0x1d5ab8, roughness: 0.6 }),
        };
    }

    initSharedGeometries() {
        return {
            roadTile: new THREE.PlaneGeometry(this.chunkSize, this.chunkSize),
            curbBox: new THREE.BoxGeometry(0.6, 0.4, this.chunkSize),
            poleCylinder: new THREE.CylinderGeometry(0.12, 0.15, 7, 8),
            danfoBody: new THREE.BoxGeometry(2.3, 2.0, 5.0),
            danfoWheel: new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12),
        };
    }

    update(playerPosition) {
        const cx = Math.floor((playerPosition.x + this.chunkSize / 2) / this.chunkSize);
        const cz = Math.floor((playerPosition.z + this.chunkSize / 2) / this.chunkSize);
        const activeKeys = new Set();

        // 3x3 window around player
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const qx = cx + dx;
                const qz = cz + dz;
                const key = `${qx},${qz}`;
                activeKeys.add(key);

                if (!this.loadedChunks.has(key)) {
                    const group = this.buildChunk(qx, qz);
                    group.position.set(qx * this.chunkSize, 0, qz * this.chunkSize);
                    this.scene.add(group);
                    this.loadedChunks.set(key, group);
                }
            }
        }

        // Cleanly cull out-of-range chunks
        for (const [key, group] of this.loadedChunks.entries()) {
            if (!activeKeys.has(key)) {
                this.scene.remove(group);
                this.disposeChunk(group);
                this.loadedChunks.delete(key);
            }
        }
    }

    disposeChunk(group) {
        group.traverse((obj) => {
            // Note: Keep shared materials and geometries intact! Only dispose unique geometries.
            if (obj.isMesh && obj.userData.uniqueGeo) {
                obj.geometry.dispose();
            }
        });
    }
}
```
