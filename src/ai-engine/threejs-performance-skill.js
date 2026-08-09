/**
 * Three.js Performance & Rapier WASM Physics Skill for Hermes Agent
 * 
 * Pre-bundled foundational skill loaded into Hermes Agent for EVERY game generation job.
 * Enforces zero-GC render loops, object pooling, InstancedMesh, delta-time math,
 * and Rapier WASM physics integration.
 */

export const THREEJS_PERFORMANCE_SKILL_ID = 'threejs_performance_rapier_wasm';

export const THREEJS_PERFORMANCE_SKILL_CONTENT = `
# Skill: Three.js High-Performance Mobile Patterns & Rapier WASM Physics

## 1. Zero Garbage Collection in Game Loop
- NEVER call \`new THREE.Vector3()\`, \`new THREE.Matrix4()\`, \`new THREE.Quaternion()\`, or \`new THREE.Mesh()\` inside \`requestAnimationFrame\` or loop functions.
- Pre-allocate all temporary calculation vectors, matrices, and rays once during setup:
  \`\`\`js
  const tempVec = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  function animate() {
      // Reuse tempVec instead of allocating new Vector3
      tempVec.set(x, y, z);
  }
  \`\`\`

## 2. Object Pooling for Dynamic Entities
- For bullets, particles, projectiles, and spawned enemies, allocate an array pool at boot.
- Toggle \`mesh.visible = true/false\` and reset positions instead of calling \`scene.remove()\` and \`scene.add()\`.

## 3. InstancedMesh for Repeated Scenery & Props
- Use \`THREE.InstancedMesh\` for trees, rocks, coins, terrain blocks, or crowds.
- Set transform matrices via \`dummy.position.set(...); dummy.updateMatrix(); instancedMesh.setMatrixAt(i, dummy.matrix);\`.

## 4. Frame-Rate Independent Delta Time
- Always calculate delta time with cap protection against tab backgrounding lag spikes:
  \`\`\`js
  let lastTime = performance.now();
  function animate(now) {
      requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      updateGameLogic(dt);
      renderer.render(scene, camera);
  }
  \`\`\`

## 5. Mobile Device Pixel Ratio & Texture Caps
- Cap \`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))\`.
- Texture maps must not exceed 1024x1024 resolution. Set \`texture.minFilter = THREE.LinearFilter\`.

## 6. Rapier WASM 3D Physics Engine Integration
- For platformers, sports games, combat, or collision-heavy games, import Rapier WASM physics via CDN:
  \`\`\`html
  <script src="https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.js"></script>
  \`\`\`
- Initialize Rapier asynchronously before starting the render loop:
  \`\`\`js
  RAPIER.init().then(() => {
      const gravity = { x: 0.0, y: -9.81, z: 0.0 };
      const world = new RAPIER.World(gravity);
      
      // Rigid body setup
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
      const body = world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.ball(0.5);
      world.createCollider(colliderDesc, body);
      
      function physicsLoop(dt) {
          world.step();
          const position = body.translation();
          mesh.position.set(position.x, position.y, position.z);
      }
  });
  \`\`\`
`;
