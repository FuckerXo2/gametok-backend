// @ts-nocheck
// Arcade physics for 3D games (cannon-es). Pairs a three.js mesh with a rigid body and syncs them
// every step, so physics-driven games (ball sports, racers, pinball, ragdoll, launch/fling) feel
// RIGHT instead of hand-rolled. Tune gravity/friction/restitution for FUN, not realism.
//
// Usage:
//   const P = createPhysics({ gravity: -30 });
//   const ball = P.sphere(ballMesh, 1, { mass: 1, restitution: 0.85 });   // bouncy ball
//   P.staticPlane();                                                       // ground
//   P.staticBox({ x: 40, y: 5, z: 0.5 }, { x: 0, y: 2.5, z: -20 });        // a wall
//   // each frame:  P.step(dt);   ball.applyImpulse(new P.Vec3(0, 8, 0));
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export function createPhysics({ gravity = -30, friction = 0.4, restitution = 0.3 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = friction;
  world.defaultContactMaterial.restitution = restitution;

  const links = [];
  function attach(mesh, body) { world.addBody(body); if (mesh) links.push({ mesh, body }); return body; }
  const opt = (o, def) => new CANNON.Vec3(o?.x ?? def, o?.y ?? def, o?.z ?? def);

  return {
    world,
    Vec3: CANNON.Vec3,
    bodies: links,

    // Dynamic sphere linked to a mesh (ball, projectile, wheel).
    sphere(mesh, radius = 1, { mass = 1, restitution, friction: fr, position, linearDamping = 0.05, angularDamping = 0.1 } = {}) {
      const body = new CANNON.Body({ mass, shape: new CANNON.Sphere(radius), linearDamping, angularDamping });
      if (restitution != null || fr != null) body.material = new CANNON.Material({ restitution: restitution ?? 0.3, friction: fr ?? friction });
      body.position.copy(position || mesh.position);
      return attach(mesh, body);
    },
    // Dynamic box linked to a mesh (crate, car chassis, block).
    box(mesh, size = { x: 1, y: 1, z: 1 }, { mass = 1, position, linearDamping = 0.05, angularDamping = 0.3 } = {}) {
      const body = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3((size.x || 1) / 2, (size.y || 1) / 2, (size.z || 1) / 2)), linearDamping, angularDamping });
      body.position.copy(position || mesh.position);
      return attach(mesh, body);
    },
    // Static infinite ground plane at y=0 (no mesh — pair with a big visual floor).
    staticPlane(y = 0) {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      body.position.set(0, y, 0);
      return attach(null, body);
    },
    // Static box (arena wall / ramp / platform). Pass a mesh to also render it.
    staticBox(size = { x: 1, y: 1, z: 1 }, position = { x: 0, y: 0, z: 0 }, mesh = null) {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((size.x || 1) / 2, (size.y || 1) / 2, (size.z || 1) / 2)) });
      body.position.set(position.x || 0, position.y || 0, position.z || 0);
      return attach(mesh, body);
    },

    // Advance the sim and sync every linked mesh to its body. dt in seconds.
    step(dt) {
      world.step(1 / 60, Math.min(0.05, dt), 3);
      for (const { mesh, body } of links) { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
    },
  };
}
