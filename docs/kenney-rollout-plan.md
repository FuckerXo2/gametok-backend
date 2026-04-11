# Kenney Rollout Plan

This is the sane way to use the full Kenney dump without turning asset work into chaos.

## Rule One

Do not ingest all 81k usable files into the live generator at once.

Start with a small curated wave by lane, prove the retrieval and packaging flow, then expand.

## What We Indexed

- Source pack: `/Users/abiolalimitless/gameidea/Kenney Game Assets All-in-1 3`
- Inventory summary: [kenney-library-summary.json](/Users/abiolalimitless/gameidea/gametok-backend/docs/kenney-library-summary.json)
- Totals:
  - `255` packs
  - `81,092` usable files
  - `54,435` images
  - `4,978` 3D model files
  - `1,342` audio files

## Wave 1 Lanes

### Endless Flyer / Flappy

Use:
- `Tappy Plane`
- `Jumper Pack`
- `Mobile Controls`
- `UI Pack`
- `Particle Pack`
- `Music Jingles`
- `Interface Sounds`

Why:
- Tight, highly readable set
- Immediate fit for Flappy-style prompts
- Low integration risk

### Top-Down Shooter / Zombie Survival

Use:
- `Topdown Shooter`
- `Desert Shooter Pack`
- `Topdown Shooter (Pixel)`
- `Mobile Controls`
- `UI Pack - Sci-fi`
- `Impact Sounds`
- `Interface Sounds`

Why:
- Directly supports survivor/zombie loops
- Includes humans, zombies, weapons, and readable tiles
- Strong candidate for your current Kimi wins

### Pixel Platformer

Use:
- `New Platformer Pack`
- `Platformer Assets Pixel`
- `Platformer Assets Base`
- `Platformer Assets Tile Extensions`
- `UI Pack - Pixel Adventure`
- `Particle Pack`
- `Music Jingles`

Why:
- Best 2D lane for reliable generation
- Biggest upside for polished competitor-style outputs

### Tiny Battle / Auto-Battler / Fantasy Arena

Use:
- `Tiny Battle`
- `RTS Medieval (Pixel)`
- `Tower Defense`
- `Fantasy UI Borders`
- `Impact Sounds`
- `Music Loops`

Why:
- Better match than generic “largest medieval pack”
- Keeps the lane readable and toy-like
- Good fit for battlers without pretending to be Total War

### First-Person 3D Test Lane

Use:
- `Mini Dungeon`
- `Graveyard Kit`
- `Survival Kit`
- `Weapon Pack`
- `Mobile Controls`
- `Impact Sounds`
- `Interface Sounds`

Why:
- This is the most believable first playable 3D lane
- `Mini Dungeon` and `Graveyard Kit` are much better thematic fits than giant generic kits
- `Weapon Pack` gives the camera-view combat language we actually need

## What Not To Do Yet

- Do not feed giant generic kits directly into the builder prompt.
- Do not copy every file into `/public/uploads/kenney` first.
- Do not compute embeddings for the whole library before curation.
- Do not try to unify 2D, 3D, UI, icons, and audio in one retrieval pass.

## Next Engineering Steps

1. Build a lane-aware staging manifest from the Wave 1 packs only.
2. Copy only those staged assets into a clean self-hosted folder structure.
3. Replace the old hardcoded Phaser-era catalog with the staged Kenney catalog.
4. Add per-lane retrieval rules:
   - 2D lanes prefer sprites, tiles, UI, particles
   - 3D lane prefers GLB + matching preview images + mobile controls
5. Only after that, add embeddings/RAG on top of the staged manifest.
