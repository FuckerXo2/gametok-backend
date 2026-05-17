# GameTok Top-Down Action Template API

This is a working mobile-first top-down action starter. The builder should
customize theme, verbs, enemy rules, scoring, waves, generated assets, and
feedback while preserving the core loop.

## Files

- `index.html`: DOM shell and canvas mount.
- `src/styles.css`: mobile-safe layout and touch controls.
- `src/game.js`: player, enemies, projectiles, pickups, particles, collisions,
  wave pacing, drawing, and input.

## Required State

- `state.player`
- `state.enemies`
- `state.projectiles` or `state.attacks`
- `state.particles`
- `state.score`
- `state.combo` or `state.wave`
- `state.cooldowns`
- `state.gameOver`

## Required Functions

- `handleInput()`
- `updatePlayer(dt)`
- `spawnEnemies()`
- `updateEnemies(dt)`
- `resolveCollisions()`
- `performPrimaryAttack()`
- `applyHitFeedback(x, y)`
- `drawHud()`
- `resetGame()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available. The sandbox uses it to
verify that this is a real action game, not an empty arena.

Required probe methods:

- `snapshot()`
- `move(dx, dy, ms)`
- `attack()`
- `spawnEnemyNearPlayer()`
- `reset()`

## Customization Hooks

Safe edits:

- `GAME_THEME`: title, labels, palette, verb names, enemy names.
- `CONFIG`: movement speed, spawn timing, projectile speed, damage, arena tuning.
- `resolveThemeAssets()`: generated asset lookup.
- `drawPlayer()`, `drawEnemy()`, `drawProjectile()`, `drawBackground()`: visual
  style only.
- `spawnEnemies()`: enemy type selection and wave flavor.

Risky edits:

- Input state shape.
- Collision and damage resolution.
- Wave/score state reset.
- Probe API.

## Asset Contract

The maker writes an `asset-contract.json` for this template. The expected slots
are:

- `player_actor`: required transparent player sprite.
- `primary_enemy`: required transparent enemy sprite.
- `arena_background`: optional portrait mobile background.
- `primary_attack_effect`: optional transparent attack/effect sprite.

Consumption rules:

- `resolveThemeAssets()` maps `player` into `drawPlayer()`.
- `resolveThemeAssets()` maps `enemy` into `drawEnemy()`.
- `resolveThemeAssets()` maps `background`/`environment` into `drawBackground()`.
- `resolveThemeAssets()` maps `effect` into projectile/impact feedback.
- HUD, score, health, combo, wave labels, joystick, and attack button remain
  code-rendered.
- Enemy AI, collision circles, attack range, spawn logic, and scoring remain
  code-defined.

## First Frame Contract

The first frame must show:

- player visible inside the safe playfield
- at least one enemy or target visible within 10 seconds
- movement affordance visible
- primary attack affordance visible
- health/score/wave feedback visible

## Acceptance

- Player can move immediately.
- Primary attack creates a projectile/effect.
- Enemy approaches or threatens the player.
- Projectile/attack can damage enemy.
- Score/combo/wave or health changes live.
- Game can restart without reloading the webview.
