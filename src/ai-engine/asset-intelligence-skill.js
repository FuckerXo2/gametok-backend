/**
 * Asset Intelligence, Procedural Fallback & Adaptive Camera Perspective Skill for Hermes Agent
 * 
 * Foundational skill loaded into Hermes Agent for EVERY game generation job.
 * Guides how Hermes and Gemini 3.8 Flash use explicitly selected assets, discover catalog assets,
 * fall back gracefully to procedural generation, align visual direction, and choose camera perspectives
 * inside the GameTok Native C++ QuickJS / Metal / Filament Engine.
 */

export const ASSET_INTELLIGENCE_SKILL_ID = 'asset_intelligence_procedural_perspective';

export const ASSET_INTELLIGENCE_SKILL_CONTENT = `
# Skill: Asset Intelligence, Procedural Fallback & Adaptive Camera Rigging

## 1. Selected Asset Integration (Audio, 3D Characters, Animations)

When the user has selected or attached assets, weave them directly into the GameTok Native Engine lifecycle:

### A. 3D Character Models & R2 GLB Assets
- When 3D model assets are provided (e.g., characters from R2 or local vault):
  - Spawn the character mesh via \`engine.spawnModel(modelUrl, x, y, z)\`:
    \`\`\`js
    const playerEntityId = engine.spawnModel(characterGlbUrl, 0, 0, 0);
    engine.setScale(playerEntityId, 1.0, 1.0, 1.0);
    \`\`\`
  - Rigged humanoid characters are weighted to the UE5 Master Skeleton and support all standard Mixamo animations.

### B. MoCap Skeletal Animations (.glb)
- Bind animations from the GameTok Core Animation Library directly to the spawned entity:
  \`\`\`js
  // Play idle on spawn
  engine.playAnimation(playerEntityId, 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/fight_idle.glb', { loop: true });

  // Switch to attack / walk / hit when actions occur
  function triggerAttack() {
      engine.playAnimation(playerEntityId, 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/punch.glb', { loop: false, blendDuration: 0.1 });
  }
  \`\`\`

### C. Procedural Primitives & Arena Construction
- Build world geometry (floors, arena walls, platforms, obstacles, projectiles) using \`engine.spawnEntity\`:
  \`\`\`js
  // Arena floor: large flat plane
  const floorId = engine.spawnEntity('plane', 0, 0, 0, 20.0, 0.1, 0.1, 0.15);
  
  // Neon boundary walls: scaled cubes
  const wallLeft = engine.spawnEntity('cube', -10, 2, 0, 4.0, 0.0, 0.8, 1.0);
  \`\`\`

---

## 2. Unselected Assets: Intelligent Catalog Matching
- If the user hasn't explicitly picked assets:
  - Inspect the game genre and theme.
  - Automatically match fitting catalog characters and animations by Archetype:
    - **superheroes**: Spider-Man, Homelander (flying, leaping, combat)
    - **fighters**: Scorpion, Hal Jordan (martial arts, special moves, netherrealm clash)
    - **street_citizens_npcs**: Franklin GTA V (urban open world, NPC pedestrians, driving)
    - **villains**: Green Goblin, Venom (boss battles, nemesis showdowns)
    - **monsters_creatures**: Zombies (survival horror, wave defense)

---

## 3. Pure Procedural Autonomy & Graceful Fallbacks

### A. Non-Blocking Asset Resilience
- **NEVER let missing or slow assets break the game.**
- If an asset URL is unreachable or loading fails:
  - **Procedural Mesh Fallback**: Instantly substitute with vibrant procedural engine primitives (\`cube\`, \`sphere\`, \`plane\`) with glowing colors:
    \`\`\`js
    // Fallback: procedural combat dummy
    const fallbackPlayerId = engine.spawnEntity('cube', 0, 1, 0, 1.5, 0.0, 1.0, 0.8);
    \`\`\`

### B. Purely Procedural Games (Zero External Assets)
- Concepts like geometry dodgers, abstract neon arenas, physics puzzles, or wireframe vector combat can be built 100% procedurally with \`engine.spawnEntity\`.
- Generates zero network requests, loads instantly, and runs at locked 120 FPS on Metal / Filament.

---

## 4. Autonomous Camera Perspective Skill & Decision Matrix

Hermes possesses full creative autonomy to determine whether a game concept needs user camera selection or has an inherent fixed view:

### A. Autonomous Evaluation of Perspective Need
1. **Fixed Perspective Concepts (NO camera choice needed)**:
   - When the game mechanics strictly require a flat 2D plane or fixed vantage point:
     - Match-3 / Candy Crush / Tile Connect (swapping grid tiles)
     - Card / Deck / Tabletop games (Poker, Blackjack, Solitaire)
     - Board games & Puzzles (Chess, Checkers, Wordle, Trivia)
     - Explicit 2D platformers or endless side-scrollers
   - **Hermes Action**: Hermes immediately locks \`requiresPerspectiveSelection = false\`. Hermes configures the optimal fixed 2D/top-down viewport (\`engine.setCamera(0, 10, 0, 0, 0, 0)\`), does NOT prompt the user with a redundant camera picker, and builds the game directly.

2. **Variable Perspective Concepts (ASK the user)**:
   - When the gameplay space has 3D depth, spatial navigation, or where different viewports fundamentally offer distinct gameplay experiences (e.g. 3D racing, third-person action, first-person cockpit, isometric diorama, or creative puzzle concepts like connecting neon dots in 3D):
   - **Hermes Action**: Hermes flags \`requiresPerspectiveSelection = true\`. Hermes conceptualizes 4 distinct camera angles tailored to the game, generates 4 preview images anchored strictly to the user's chosen visual style and color scheme, sends them to the user, and once the user selects their favorite angle, builds the game from that exact POV.

### B. Core Camera Rigs in Native Engine
1. **Fighting Games (Side-View Dynamic Framing)**:
   \`\`\`js
   const midX = (p1.x + p2.x) * 0.5;
   const dist = Math.max(6, Math.abs(p1.x - p2.x) + 3);
   engine.setCamera(midX, 2.5, dist, midX, 1.5, 0);
   \`\`\`

2. **Third-Person Chase Cam (Runners, Action, Racing)**:
   \`\`\`js
   engine.setCamera(player.x, player.y + 3.5, player.z - 7.0, player.x, player.y + 1.0, player.z + 5.0);
   \`\`\`

3. **Top-Down / Isometric Arena (Tactical, Arcade, Survival)**:
   \`\`\`js
   engine.setCamera(player.x, player.y + 12.0, player.z - 10.0, player.x, player.y, player.z);
   \`\`\`

4. **Fixed 2D / Grid Viewport (Match-3, Candy Crush, Puzzles)**:
   \`\`\`js
   engine.setCamera(0, 14.0, 0.001, 0, 0, 0);
   \`\`\`
`;
