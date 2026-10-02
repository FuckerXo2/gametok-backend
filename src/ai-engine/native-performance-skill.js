/**
 * GameTok Native C++ QuickJS Performance & Engine Skill for Hermes Agent
 * 
 * Pre-bundled foundational skill loaded into Hermes Agent for EVERY game generation job.
 * Enforces zero-GC update loops, Native QuickJS C++ bindings, delta-time math,
 * entity lifecycle management, and Apple Metal / Filament rendering patterns.
 */

export const NATIVE_PERFORMANCE_SKILL_ID = 'gametok_native_quickjs_metal';

export const NATIVE_PERFORMANCE_SKILL_CONTENT = `
# Skill: GameTok Native C++ QuickJS / Metal High-Performance Engine

GameTok runs on a custom Native C++ QuickJS runtime with Apple Metal & Google Filament rendering at 120 FPS.
NEVER emit HTML, DOM, <canvas>, <script>, window, document, or Three.js code. The runtime is PURE JavaScript executed by QuickJS.

## 1. Zero Garbage Collection in Game Loop
- NEVER allocate new objects, arrays, or closures inside \`onGameEvent('update', data)\`.
- Pre-allocate all state variables, position trackers, velocity vectors, and projectile pools once during startup:
  \`\`\`js
  // PRE-ALLOCATE at global scope
  const player = { x: 0, y: 0, z: 0, vx: 0, vz: 0, entityId: -1, hp: 100 };
  const camera = { x: 0, y: 5, z: -10, targetX: 0, targetY: 1, targetZ: 0 };
  \`\`\`

## 2. Frame-Rate Independent Delta Time
- All velocity, physics, animations, and cooldowns MUST be multiplied by \`data.dt\` (delta time in seconds, e.g. 0.0083 at 120 FPS):
  \`\`\`js
  globalThis.onGameEvent = function(event, data) {
      if (event === 'update') {
          const dt = data.dt;
          player.x += player.vx * dt;
          player.z += player.vz * dt;
          engine.setPosition(player.entityId, player.x, player.y, player.z);
          engine.setCamera(player.x + camera.x, camera.y, player.z + camera.z, player.x, camera.targetY, player.z);
      }
  };
  \`\`\`

## 3. Native Engine C++ Global Bindings
The following functions are bound directly to the C++ runtime via \`engine\`:
- \`engine.spawnEntity(type, x, y, z, scale, r, g, b)\`: Spawns geometric 3D primitive. \`type\`: 'cube' | 'sphere' | 'plane'. Returns \`entityId\` (number).
- \`engine.spawnModel(assetUrl, x, y, z)\`: Spawns rigged 3D character or prop mesh (.glb). Returns \`entityId\` (number).
- \`engine.playAnimation(entityId, animUrl, options)\`: Plays skeletal animation from R2 (.glb). Options: \`{ loop: true/false, speed: 1.0, blendDuration: 0.2 }\`.
- \`engine.destroyEntity(id)\`: Removes entity from 3D scene and frees GPU memory.
- \`engine.setPosition(id, x, y, z)\`: Updates entity position in world space.
- \`engine.setRotation(id, rx, ry, rz)\`: Updates Euler angles (radians).
- \`engine.setScale(id, sx, sy, sz)\`: Updates 3D scale.
- \`engine.setColor(id, r, g, b, a)\`: Updates tint/color (values 0.0 to 1.0).
- \`engine.setCamera(eyeX, eyeY, eyeZ, targetX, targetY, targetZ)\`: Directs 3D perspective camera.
- \`engine.setVehicle(x, y, z, yaw, isDrifting)\`: (Optional) Controls player vehicle in racing modes.
- \`engine.getVehicle()\`: Returns \`{ x, y, z, yaw, speed, isDrifting }\`.
- \`engine.clearEntities()\`: Wipes all scene entities.
- \`engine.log(message)\`: Prints debug info to native console.

## 4. Entity Lifecycle & Object Pooling
- For bullets, particles, and obstacles, spawn a fixed pool of entities at init (e.g. 20 spheres).
- Store pool in a static array. When inactive, move them far off-screen (\`engine.setPosition(id, 0, -9999, 0)\`) instead of destroying and respawning.

## 5. Mobile Dynamic Touch Controls
- The game metadata MUST declare a themed \`controls\` configuration matching gameplay:
  - Combat / Fighting: layout "combat" with 4 buttons (PUNCH, KICK, BLOCK, SPECIAL) + directional d-pad.
  - Racing / Driving: layout "driving" with GAS, DRIFT + steering slider.
  - Platformer / Action: layout "platformer" with JUMP, ATTACK, DASH.
`;
