# Web Game Upload Inventory

Updated September 8, 2026. This is the post-legacy-catalog inventory. The retired
33 browser-bundle games are intentionally excluded.

## Validate First

| Game | Local entry point | Notes |
| --- | --- | --- |
| Neon Drift | `games/Fable5-Neon-drift-game--claude-eager-dijkstra-d0qzg9/index.html` | 764 KB, Canvas, MIT. Best first upload. |
| Endless Dungeon Runner | `Dungeon Run/Dungeon Run Game/index.html` | Self-contained static game. |
| Sky Strike | `K fighter/K Fighter Game/index.html` | Self-contained static game. |
| Zombie Survival | `gametok-backend/generated-games/game-2026-07-06T14-35-26/index.html` | Generated Vite project. |
| HexGL | `games/hexgl/index.html` | 22 MB WebGL racer, MIT. |
| Bridge Horror House | `games/bridge-horror-house-main/dist/index.html` | 47 MB Three.js, MIT. |
| Apex Formula | `games/apex-formula-main/dist/index.html` | 100 MB Three.js racer, MIT. |
| Turbo Kart Rush | `games/turbo-kart-rush-main/dist/index.html` | 100 MB Three.js racer, MIT. |
| Tideline | `games/tideline-main/index.html` | Small Three.js fishing game, MIT; audit CDN dependencies first. |
| WorldCreator | `games/WorldCreator-main/dist/index.html` | 122 MB Three.js, MIT; high-end lane after device profiling. |
| The Long Silence | `games/TheLongSilence-main/dist/index.html` | 202 MB WebGL, MIT; high-end lane after device profiling. |

## Already In Backend Catalog

These records exist in the live database and need player/device validation before
being treated as released: Apex Formula, Turbo Kart Rush, Neon Drift, HexGL,
The Long Silence, Bridge Horror House, FPS Arena Shooter, Fable RPG, Knight
Combat Blending, Cyberpunk Littlest Tokyo, Fable Mario, and Portal Dimension.

## Package Pools Needing Provenance Review

- `gametok-games/loops-games/`: 36 self-contained packages, IDs `206` through
  `958`. Titles include Tower Building, Gold Miner, Karting, Real Moto Race,
  AgentsVsZombies, and IdleMiner.
- `gametok-games/openpigeon-games/`: Anagrams, Archery, Basketball, Cup Pong,
  Word Bites, Darts, Dots & Boxes, Filler, 20 Questions, and Sea Battle.

Do not publish either pool until each package's license and asset provenance are
recorded.

## Do Not Publish Unchanged

- `game-extractor/soccer-dash`: scraped third-party page.
- `games/fable-5.1-mario-main`: Nintendo character/IP.
- `games/opus-5-minecraft-one-shot-main` and `games/voxelcraft-main`: Minecraft
  branding and likeness risk.
- `games/leonida-main`: GTA-style fan project.
- `games/fps-arena-shooter`, `games/fps-shooter`, `games/tokyo-keyframes`, and
  `games/voxel-builder`: framework/example demos, not GameTok-ready titles.

## External Sources Worth Evaluating

- Phaser templates/examples: MIT browser-game tooling.
- melonJS: MIT engine with WebGPU/WebGL 2/Canvas fallback.
- Edelweiss: open-source Three.js WebGL platformer; inspect its license before
  importing content.
- Caesor Racing Game: MIT WebGL racing project.

Every candidate must pass: local build, mobile WebView run, landscape/portrait
layout check, offline asset audit, performance profile, and rights/provenance
review before R2 upload.
