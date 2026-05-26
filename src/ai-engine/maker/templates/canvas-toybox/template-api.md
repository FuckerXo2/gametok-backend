# GameTok Canvas Toybox Template API

Mobile-first drag/tap toybox starter for cooking, alchemy, merge, and craft loops.
The builder should reskin ingredients, customer, background, copy, and pacing while
preserving the order -> slots -> action -> score loop.

## Files

- `index.html`: DOM shell with HUD, order panel, slots, COOK button, ingredient grid.
- `src/styles.css`: mobile-safe toybox layout.
- `src/main.ts`: order generation, slot filling, cook validation, timer, score/combo.

## Required State

- `state.score`
- `state.combo`
- `state.timeLeft`
- `state.orderTimeLeft`
- `state.slots[]`
- `state.currentOrder[]`
- `state.ingredients[]`
- `state.ordersCompleted`
- `state.gameOver`

## Required Functions

- `generateOrder()`
- `selectIngredient(index)`
- `fillOrderSlots()`
- `cookOrder()`
- `stepGame(dt)`
- `resetGame()`
- `renderAll()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available.

Required probe methods:

- `snapshot()`
- `selectIngredient(index)`
- `fillOrderSlots()`
- `cook()`
- `step(ms)`
- `reset()`

## Asset Contract

Expected slots:

- `toybox_customer`: alien/customer portrait (role enemy or customer)
- `toybox_ingredient`: primary ingredient sprite (role item)
- `toybox_station`: cooking station / workbench prop (role prop)
- `toybox_background`: portrait diner/lab background (role background)

Consumption rules:

- Background decorates the canvas layer only.
- Customer avatar uses enemy/customer role art.
- Ingredient cards use item role art.
- HUD, slots, buttons, timers, and labels remain code-rendered.

## First Frame Contract

The first frame must show:

- score, time, and combo HUD
- customer/order bubble with required icons
- three empty slots and COOK button
- ingredient grid with at least four choices

## Acceptance

- Selecting ingredients fills slots in order.
- Cooking a matched order increases score and combo.
- Order timer and round timer decrease during `step()`.
- Reset restores a fresh playable shift without reload.
