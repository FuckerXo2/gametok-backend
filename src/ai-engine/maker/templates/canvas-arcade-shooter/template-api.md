# GameTok Arcade Shooter Template API

Working mobile-first 2D shooter starter. Customize theme, weapons, enemies,
waves, pickups, and feedback while preserving live entities and combat state.

## Required State

- `state.player`
- `state.enemies`
- `state.projectiles`
- `state.pickups`
- `state.score`
- `state.wave`
- `state.health`
- `state.gameOver`

## Required Functions

- `handleInput()`
- `spawnEnemy()`
- `fireWeapon()`
- `updateProjectiles()`
- `updateEnemies()`
- `resolveCollisions()`
- `drawWorld()`
- `resetShooter()`

## Probe API

- `window.__GAMETOK_TEMPLATE_PROBE__.snapshot`
- `window.__GAMETOK_TEMPLATE_PROBE__.move`
- `window.__GAMETOK_TEMPLATE_PROBE__.fire`
- `window.__GAMETOK_TEMPLATE_PROBE__.spawnEnemy`
- `window.__GAMETOK_TEMPLATE_PROBE__.step`
- `window.__GAMETOK_TEMPLATE_PROBE__.reset`

## Rules

- HUD and controls are code-rendered.
- Enemies and projectiles are live entities.
- First frame shows player, threat, fire control, score/health, and movement affordance.
