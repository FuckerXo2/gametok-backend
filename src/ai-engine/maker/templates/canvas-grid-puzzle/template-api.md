# GameTok Grid Puzzle Template API

This is a working mobile-first board/grid puzzle starter. The builder should
customize tile verbs, board rules, goals, theme, feedback, and level shape while
preserving the real board state and probe API.

## Files

- `index.html`: DOM shell, canvas, HUD, and touch controls.
- `src/styles.css`: mobile-safe board and controls layout.
- `src/game.js`: grid state, tile selection, movement, matching, scoring,
  level progression, drawing, reset, and probe API.

## Required State

- `state.grid`
- `state.selected`
- `state.moves`
- `state.score`
- `state.goal`
- `state.level`
- `state.status`

## Required Functions

- `buildLevel()`
- `renderBoard()`
- `selectTile()`
- `moveTile()`
- `resolveMatches()`
- `applyGoalProgress()`
- `resetPuzzle()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available.

Required probe methods:

- `snapshot()`
- `select(row, col)`
- `move(direction)`
- `resolve()`
- `reset()`

## Asset Contract

Expected slots:

- `grid_tile_primary`: optional transparent tile/icon sprite.
- `grid_tile_special`: optional transparent special tile sprite.
- `grid_world_background`: optional portrait mobile background.

Consumption rules:

- Tile sprites decorate live code-owned grid cells.
- Board positions, legal moves, matches, score, and goal remain code-owned.
- HUD and controls remain code-rendered.

## Acceptance

- Tapping/selecting a tile changes selection state.
- Moving or swapping changes the board state.
- Resolving matches changes score/goal state.
- Reset restores the board without reloading the webview.
