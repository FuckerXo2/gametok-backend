# GameTok Story Vignette Template API

This is a working mobile-first interactive story starter. The builder should
customize the setting, characters, choices, meters, consequences, and endings
while preserving real branching state and visual feedback.

## Files

- `index.html`: DOM story shell, canvas scene, HUD, and choice area.
- `src/styles.css`: mobile-safe story and choice layout.
- `src/game.js`: story graph, flags, meters, choices, consequences, drawing,
  restart, and probe API.

## Required State

- `state.currentNode`
- `state.flags`
- `state.meters`
- `state.choices`
- `state.history`
- `state.ending`

## Required Functions

- `renderScene()`
- `renderChoices()`
- `chooseOption()`
- `applyConsequence()`
- `unlockNodes()`
- `renderHud()`
- `restartStory()`

Do not rename or remove these functions. The sandbox checks for them.

## Probe API

Keep `window.__GAMETOK_TEMPLATE_PROBE__` available.

Required probe methods:

- `snapshot()`
- `choose(index)`
- `forceEnding()`
- `reset()`

## Asset Contract

Expected slots:

- `story_hero`: optional transparent character sprite.
- `story_scene_background`: optional portrait mobile background.
- `story_symbol`: optional prop/symbol sprite.

Consumption rules:

- Images decorate the story scene only.
- Choice text, HUD, meters, and buttons remain code-rendered.
- Branching, flags, consequences, and endings remain code-owned.

## Acceptance

- Choosing an option changes flags, meters, node, or ending state.
- Later choices or text reflect earlier choices.
- At least one ending/chapter resolution is reachable.
- Restart restores initial state without reloading the webview.
