# GameTok Canvas Simulation Template API

This is a working mobile-first physics/editor starter. The builder should
customize the parts, goal, art, physics tuning, copy, and challenge rules while
preserving the edit -> simulate -> result loop.

## Files

- `index.html`: DOM shell and canvas mount.
- `src/styles.css`: mobile-safe editor controls.
- `src/game.js`: bodies, simple physics, collisions, goal checks, drawing, input.

## Required State

- `state.mode`
- `state.bodies`
- `state.constraints`
- `state.gravity`
- `state.selectedTool`
- `state.goalObject`
- `state.targetZone`
- `state.running`
- `state.result`

## Required Functions

- `addBody()`
- `startSimulation()`
- `stepPhysics(dt)`
- `resolveCollisions()`
- `checkGoal()`
- `resetSimulation()`
- `drawEditor()`
- `drawSimulation()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available. The sandbox uses it to
verify that this is a real editable simulation.

Required probe methods:

- `snapshot()`
- `addBody(x, y)`
- `start()`
- `step(ms)`
- `reset()`

## Asset Contract

The maker writes an `asset-contract.json` for this template. Expected slots:

- `goal_object`: required transparent goal/controlled object sprite.
- `build_part`: optional transparent construction part sprite.
- `simulation_background`: optional portrait mobile background.

Consumption rules:

- `goal_object` decorates the live simulated goal object.
- `build_part` decorates placed bodies/parts.
- Background is visual only.
- Bodies, constraints, collision, target zones, and win/loss checks remain
  code-defined.
- Editor controls, labels, buttons, and result messages remain code-rendered.

## First Frame Contract

The first frame must show:

- editable build area
- goal object
- target zone
- part selector or add-part affordance
- start/simulate button

## Acceptance

- User can place or modify a part.
- Start changes mode from edit to run.
- Physics visibly moves bodies under gravity.
- Goal success/failure is computed from live state.
- Reset returns to edit mode without reloading the webview.
