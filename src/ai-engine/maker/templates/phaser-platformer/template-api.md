# GameTok Platformer Template API

This is a working mobile-first side-view platformer starter. The builder should
customize level shape, verbs, hazards, collectibles, goal, art, tuning, and
feedback while preserving the core collision and control loop.

## Files

- `index.html`: DOM shell and canvas mount.
- `src/styles.css`: mobile-safe HUD and controls.
- `src/game.js`: player physics, platforms, hazards, collectibles, goal,
  drawing, collision, restart, and input.

## Required State

- `state.player`
- `state.platforms`
- `state.hazards`
- `state.collectibles`
- `state.camera`
- `state.score`
- `state.lives` or `state.health`
- `state.goal`

## Required Functions

- `buildLevel()`
- `handleInput()`
- `updatePlayerPhysics(dt)`
- `resolvePlatformCollisions()`
- `collectItem()`
- `hitHazard()`
- `reachGoal()`
- `resetLevel()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available. The sandbox uses it to
verify that this is a real platformer.

Required probe methods:

- `snapshot()`
- `move(direction, ms)`
- `jump()`
- `collectNearest()`
- `reset()`

## Asset Contract

Expected slots:

- `platformer_player`: required transparent player sprite.
- `platformer_hazard`: optional transparent enemy/hazard sprite.
- `platformer_world_background`: optional portrait mobile background.

Consumption rules:

- Player sprite decorates the live player body.
- Hazard sprite decorates live hazards/enemies.
- Background is visual only.
- Platforms, collision, hazards, collectibles, goal, HUD, and controls remain
  code-defined.

## First Frame Contract

The first frame must show:

- player standing on solid ground
- at least one platform or hazard
- collectible or goal direction
- left/right/jump controls
- score/health or lives feedback

## Acceptance

- Left/right movement changes player position.
- Jumping and landing are physically readable.
- Player cannot fall through platforms.
- Collectibles or goal change state.
- Reset restores the level without reloading the webview.
