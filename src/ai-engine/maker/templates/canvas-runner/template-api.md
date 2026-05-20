# GameTok Runner Template API

Working mobile-first endless/level runner starter. Customize theme, obstacles,
collectibles, pacing, scoring, and goal while preserving live movement state.

## Required State

- `state.player`
- `state.obstacles`
- `state.collectibles`
- `state.speed`
- `state.distance`
- `state.score`
- `state.lives`
- `state.gameOver`

## Required Functions

- `spawnObstacle()`
- `spawnCollectible()`
- `jump()`
- `slide()`
- `updateRunner()`
- `resolveCollisions()`
- `drawWorld()`
- `resetRun()`

## Probe API

- `window.__GAMETOK_TEMPLATE_PROBE__.snapshot`
- `window.__GAMETOK_TEMPLATE_PROBE__.jump`
- `window.__GAMETOK_TEMPLATE_PROBE__.slide`
- `window.__GAMETOK_TEMPLATE_PROBE__.spawnObstacle`
- `window.__GAMETOK_TEMPLATE_PROBE__.step`
- `window.__GAMETOK_TEMPLATE_PROBE__.reset`

## Rules

- HUD and controls are code-rendered.
- Obstacles and collectibles are live objects, not background art.
- First frame shows player, track, obstacle/collectible, score, and jump/slide controls.
