# GameTok Maker Roadmap

Living plan for DreamStream / native maker pipeline improvements.

---

## Active sprint — Alien Chef / Toybox lane

**Goal:** Prompts like Alien Chef land in the right bucket, boot with a cooking/toybox UI, and pass verification that tests **that loop** (not arcade movement).

### Done locally

| Item | File(s) | Notes |
|------|---------|-------|
| Juice runtime (particles, shake, score pop) | `src/ai-engine/juice.js` | Restored from May 23 |
| Manifest audio (real R2 clips, no synth) | `src/ai-engine/audio.js` | Restored from May 23; plays `DREAM_AUDIO_MANIFEST` only |

### In progress — `canvas-toybox`

| Step | What | Status |
|------|------|--------|
| 1 | New template `maker/templates/canvas-toybox/` — HUD, order bubble, slots, COOK, ingredient grid | ✅ |
| 2 | Route `simulation_toybox` lane → `canvas-toybox` in `selectMakerTemplateContract()` | ✅ |
| 3 | Archetype `simulation_toybox` in `maker-classifier.js` | ✅ |
| 4 | Template contract, asset slots, sandbox probe, template manual | ✅ |
| 5 | Deploy + re-run Alien Chef job on Railway | ⏳ pending deploy |

**Reference prompt:** Alien Chef space diner — drag/tap ingredients, fill slots, cook under timer, serve alien customers.

**Success criteria:**

- Logs show `Template: canvas-toybox (canvas-2d)`, not `canvas-arcade`
- First frame shows score/time/combo, order area, slots, COOK, ingredient grid
- Sandbox probe: fill order → cook → score increases
- Job completes or gets materially further than 63/100 acceptance failure

---

## Existing buckets (already built — route correctly, don’t rebuild)

| Bucket | Template | Example prompts |
|--------|----------|-----------------|
| Generic arcade | `canvas-arcade` | Simple action; fallback only |
| Arcade shooter | `canvas-arcade-shooter` | Shoot em ups |
| Endless runner | `canvas-runner` | Run, jump, dodge |
| Platformer | `phaser-platformer` | Jump, melee, levels |
| Top-down action | `phaser-top-down-action` | Move + attack hordes |
| Turn-based artillery | `phaser-artillery` | Aim + fire |
| Grid puzzle | `canvas-grid-puzzle` | Tile/board puzzles |
| Physics sandbox | `canvas-simulation` | Build machine → simulate |
| Interactive story | `story-vignette` | Choices, vignettes |
| First-person 3D | `three-first-person` | FPS-style 3D |

---

## Backlog (not in active sprint)

### Jigsaw / picture assembly puzzle

**Gap:** `canvas-grid-puzzle` is tile-on-board movement, not slot + loose pieces + reference image (competitor puzzle screenshot).

**Options:**

- A) Extend `canvas-grid-puzzle` with placement mode
- B) New `canvas-jigsaw` bucket

**When:** Puzzle games become a product priority.

### 1v1 fighting game

**Gap:** Platformer/top-down cover brawlers, not Street Fighter-style versus (two health bars, rounds, specials).

**When:** Versus fighter lane is prioritized.

### Spec-normalizer lanes not wired to maker templates

These exist in `spec-normalizer.js` but are not fully connected to `selectMakerTemplateContract()`:

- `endless_runner_vertical`
- `story_horror_vignette`
- `auto_battler_arena`
- `endless_flyer`
- `single_room_shooter`
- `topdown_arcade`
- `pixel_platformer`
- `first_person_threejs` / `third_person_threejs`

**Approach:** One wiring pass per lane when that product lane matters — not all at once.

### Acceptance / asset quality tweaks

- Hit animation “&lt; 2 frames” false positives on non-combat games
- Optional: require `arcade_background` for `canvas-arcade`

### Mobile preview

- `gametok` branch `fix-game-feed-swiping` — preview WebView blocker fix (not on main)

### Railway ops

- Main API: `npm start`, `MAKER_RUNTIME=gametok` (or unset)
- Disable or repoint separate OpenGame worker (`npm run opengame:worker`)
- Ensure `NIM_TEXT_API_KEYS` / `NIM_IMAGE_API_KEYS` set

---

## Architecture reminder

```
User prompt
  → Router picks ONE bucket (~10–12 total)
  → That bucket's scaffold boots with the right UI shape
  → File agent + assets reskin (Alien Chef vs Potion Lab)
  → Sandbox tests THAT bucket's loop
```

We add buckets when an **interaction shape** is not covered — not per game title, not per genre keyword list.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-26 | Created roadmap; started `canvas-toybox` for Alien Chef / simulation_toybox lane |
| 2026-05-26 | Implemented `canvas-toybox` template, routing, contracts, sandbox probe |
