# Authentic Lagos Street Props & Architectural Kit (Procedural Three.js)

## Purpose
Enables the AI to generate authentic, culturally rich Lagos street environments instantly without waiting for or depending entirely on external 3D prop assets.

```javascript
export class LagosPropFactory {
    constructor(materials) {
        this.mat = materials;
    }

    /**
     * Iconic Lagos Danfo Minibus (Volkswagen T3 / LT style)
     */
    createDanfoBus() {
        const bus = new THREE.Group();

        // Main Yellow Body
        const bodyGeo = new THREE.BoxGeometry(2.3, 1.8, 5.0);
        const bodyMesh = new THREE.Mesh(bodyGeo, this.mat.danfoYellow);
        bodyMesh.position.y = 1.35;
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bus.appendChild ? bus.add(bodyMesh) : bus.add(bodyMesh);

        // Twin Black Waist Stripes (Danfo Signature)
        const stripeGeo = new THREE.BoxGeometry(2.32, 0.12, 4.9);
        const stripe1 = new THREE.Mesh(stripeGeo, this.mat.danfoStripe);
        stripe1.position.y = 1.2;
        const stripe2 = new THREE.Mesh(stripeGeo, this.mat.danfoStripe);
        stripe2.position.y = 0.95;
        bus.add(stripe1, stripe2);

        // Windshield and Windows
        const windshieldGeo = new THREE.BoxGeometry(2.1, 0.8, 0.1);
        const windshield = new THREE.Mesh(windshieldGeo, this.mat.glass);
        windshield.position.set(0, 1.6, 2.5);
        bus.add(windshield);

        // 4 Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheelPositions = [
            [-1.15, 0.42, 1.6],
            [1.15, 0.42, 1.6],
            [-1.15, 0.42, -1.6],
            [1.15, 0.42, -1.6],
        ];
        wheelPositions.forEach(([wx, wy, wz]) => {
            const wheel = new THREE.Mesh(wheelGeo, this.mat.danfoStripe);
            wheel.position.set(wx, wy, wz);
            wheel.castShadow = true;
            bus.add(wheel);
        });

        // Headlights
        const lightGeo = new THREE.CircleGeometry(0.18, 8);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff0aa });
        const leftLight = new THREE.Mesh(lightGeo, lightMat);
        leftLight.position.set(-0.75, 0.95, 2.51);
        const rightLight = new THREE.Mesh(lightGeo, lightMat);
        rightLight.position.set(0.75, 0.95, 2.51);
        bus.add(leftLight, rightLight);

        return bus;
    }

    /**
     * Lagos Open Drainage Gutter & Concrete Slabs
     */
    createGutterDrain(length = 60) {
        const drain = new THREE.Group();
        const ditchMat = new THREE.MeshStandardMaterial({ color: 0x181a1c, roughness: 0.95 });
        const ditchGeo = new THREE.BoxGeometry(1.2, 0.6, length);
        const ditch = new THREE.Mesh(ditchGeo, ditchMat);
        ditch.position.y = -0.3;
        drain.add(ditch);

        // Occasional concrete crossing slabs for pedestrians
        const slabGeo = new THREE.BoxGeometry(1.4, 0.15, 2.5);
        const slabMat = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.85 });
        for (let z = -length / 2 + 5; z < length / 2; z += 12) {
            const slab = new THREE.Mesh(slabGeo, slabMat);
            slab.position.set(0, 0.05, z);
            slab.castShadow = true;
            drain.add(slab);
        }
        return drain;
    }

    /**
     * Roadside Market Stall with Striped Canopy
     */
    createMarketStall() {
        const stall = new THREE.Group();

        // Wooden Table / Counter
        const tableGeo = new THREE.BoxGeometry(3.0, 0.9, 1.8);
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4827, roughness: 0.9 });
        const table = new THREE.Mesh(tableGeo, woodMat);
        table.position.y = 0.45;
        table.castShadow = true;
        stall.add(table);

        // Canopy Poles
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
        const poleOffsets = [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]];
        poleOffsets.forEach(([px, pz]) => {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(px, 1.25, pz);
            stall.add(pole);
        });

        // Slanted Canopy Roof (Blue or Green Tarpaulin)
        const roofGeo = new THREE.ConeGeometry(2.4, 0.8, 4);
        roofGeo.rotateY(Math.PI / 4);
        const roof = new THREE.Mesh(roofGeo, this.mat.tarpBlue);
        roof.position.y = 2.6;
        roof.castShadow = true;
        stall.add(roof);

        return stall;
    }

    /**
     * Street Lamp with Warm Sodium Night Lighting
     */
    createStreetLamp() {
        const lamp = new THREE.Group();
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6.5, 8);
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.7 });
        const pole = new THREE.Mesh(poleGeo, metalMat);
        pole.position.y = 3.25;
        pole.castShadow = true;
        lamp.add(pole);

        // Curved Arm
        const armGeo = new THREE.BoxGeometry(1.2, 0.08, 0.08);
        const arm = new THREE.Mesh(armGeo, metalMat);
        arm.position.set(0.6, 6.4, 0);
        lamp.add(arm);

        // Fixture & Bulb
        const bulb = new THREE.PointLight(0xffbe6b, 1.2, 18, 1.5);
        bulb.position.set(1.1, 6.2, 0);
        lamp.add(bulb);

        return lamp;
    }
}
```
