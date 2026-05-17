# GameTok Artillery Template API

This is a working mobile-first artillery starter. The builder should customize
theme, tuning, copy, colors, particles, and generated asset usage while keeping
the core systems intact.

## Files

- `index.html`: DOM shell and canvas mount.
- `src/styles.css`: mobile-safe layout and controls.
- `src/game.js`: game state, terrain, tanks, projectile physics, explosions,
  drawing, and input.

## Required State

- `state.currentTurn`
- `state.wind`
- `state.angle`
- `state.power`
- `state.tanks`
- `state.terrainHeights`
- `state.projectile`
- `state.winner`

## Required Functions

- `generateTerrain()`
- `sampleTerrainY(x)`
- `computeTrajectoryPoints()`
- `trajectorySignature()`
- `drawTrajectoryPreview()`
- `fireProjectile()`
- `updateProjectile(dt)`
- `applyExplosionDamage(x, y, radius)`
- `deformTerrain(x, y, radius)`
- `endTurn()`
- `resetRound()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available. The sandbox uses it to
verify that this is a real artillery game, not a static imitation.

Required probe methods:

- `snapshot()`
- `setAim(angle, power)`
- `fire()`
- `probeDeformTerrain()`
- `reset()`

## Customization Hooks

Safe edits:

- `GAME_THEME`: title, subtitle, palette, tank labels, projectile/explosion names.
- `CONFIG`: gravity, wind range, explosion radius, damage, terrain roughness.
- `drawTank()`: visual style only, not tank coordinates or health logic.
- `drawBackground()`: background art only.
- `drawExplosion()`: particle and screen shake style.
- `resolveThemeAssets()`: generated asset lookup.

Risky edits:

- Terrain sampling/collision.
- Projectile state machine.
- Turn resolution.
- Pointer event wiring.

## Asset Rules

Generated assets are available through:

- `window.DREAM_ASSETS`
- `window.DREAM_ASSET_PACK`
- `window.DreamAssets`

Use generated images for tanks, props, scenery, projectiles, and background
decoration. Do not use images for HUD text, sliders, buttons, health bars,
wind labels, or terrain collision.

## First Frame Contract

The first frame must show:

- both tanks on terrain
- wind indicator
- angle and power controls
- projectile arc preview
- health bars
- fire button

## Acceptance

- Angle changes the arc preview.
- Power changes the arc preview.
- Wind affects projectile flight.
- Fire launches one shell.
- Impact creates explosion feedback.
- Terrain data deforms.
- Tank health changes when hit.
- Turn switches after resolution.
