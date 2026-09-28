/**
 * Asset Intelligence, Procedural Fallback & Adaptive Camera Perspective Skill for Hermes Agent
 * 
 * Foundational skill loaded into Hermes Agent for EVERY game generation job.
 * Guides how Hermes and Gemini 3.8 Flash use explicitly selected assets, discover catalog assets,
 * fall back gracefully to procedural generation, align visual direction, and choose camera perspectives.
 */

export const ASSET_INTELLIGENCE_SKILL_ID = 'asset_intelligence_procedural_perspective';

export const ASSET_INTELLIGENCE_SKILL_CONTENT = `
# Skill: Asset Intelligence, Procedural Fallback & Adaptive Camera Rigging

## 1. Selected Asset Integration (Audio, Video, Memes, Sprites, 3D Models)

When the user has selected or attached assets, weave them directly into the core game loop:

### A. Audio Assets (BGM & SFX)
- **Background Music (BGM)**:
  - Create audio element: \`const bgm = new Audio(bgmUrl); bgm.loop = true; bgm.volume = 0.35;\`
  - Mobile Browser Autoplay Protection: NEVER call \`bgm.play()\` at script top level without user interaction.
  - Unlock on first user touch:
    \`\`\`js
    let audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        bgm.play().catch(() => {});
    }
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, { once: true }));
    \`\`\`
- **Sound Effects (SFX)**:
  - Wire SFX to exact game events: \`onJump()\`, \`onCollect()\`, \`onDamage()\`, \`onScore()\`, \`onGameOver()\`.
  - Clone or create instances so rapid sounds don't cut each other off:
    \`\`\`js
    function playSfx(url) {
        const sfx = new Audio(url);
        sfx.volume = 0.75;
        sfx.play().catch(() => {});
    }
    \`\`\`

### B. Video Backdrops (Brainrot, Parkour, Subway Surfers, Synthwave)
- When a background video is selected or attached:
  - Render an underlay \`<video>\` element with CSS:
    \`\`\`html
    <video id="bgVideo" src="..." autoplay loop muted playsinline 
           style="position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 0; pointer-events: none;"></video>
    \`\`\`
  - Make the Three.js or Canvas renderer completely transparent so the game action plays on top of the moving video:
    \`\`\`js
    renderer.setClearColor(0x000000, 0); // Transparent WebGL background
    \`\`\`

### C. 2D Sprites, Memes & Stickers
- When stickers, meme images, or character sprites are selected:
  - For Three.js: Load texture via \`new THREE.TextureLoader().load(url, texture => { ... })\` and apply to a \`THREE.Sprite\` or billboard plane mesh:
    \`\`\`js
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2, 2, 1);
    scene.add(sprite);
    \`\`\`
  - For 2D Canvas: Draw via \`ctx.drawImage(img, x, y, width, height)\`.

### D. 3D Models & Skeletal Animations (GLTF/GLB)
- When 3D model assets are provided:
  - Import GLTF Loader: \`<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>\`
  - Load and auto-normalize bounding box scale:
    \`\`\`js
    const loader = new THREE.GLTFLoader();
    loader.load(modelUrl, (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        model.scale.setScalar(2.0 / maxAxis); // Normalize to ~2 units
        scene.add(model);
        
        // Skeletal Animation Mixer
        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
            // Call mixer.update(dt) in animate()
        }
    }, undefined, (err) => {
        // Fallback to procedural mesh if 3D model fails to load
        createProceduralCharacter();
    });
    \`\`\`

---

## 2. Unselected Assets: Intelligent Catalog Matching
- If the user hasn't explicitly picked assets:
  - Inspect the game genre and theme.
  - Automatically match fitting catalog assets:
    - 8-Bit / Retro $\rightarrow$ Chiptune BGM + blip SFX.
    - Racing / Cyberpunk $\rightarrow$ Synthwave / Phonk BGM.
    - Relaxed / Zen / Puzzle $\rightarrow$ Lofi Ambient BGM.
    - Combat / Action $\rightarrow$ High-Energy arcade beat.

---

## 3. Pure Procedural Autonomy ("Do Its Own Shit") & Graceful Fallbacks

### A. Non-Blocking Asset Loading & Procedural Substitutes
- **NEVER let missing or slow assets break the game.**
- If an image, texture, sound, or 3D model fails to load, times out, or has CORS errors:
  - **Procedural Mesh Fallback**: Instantly substitute vibrant procedural Three.js primitives (\`THREE.BoxGeometry\`, \`THREE.SphereGeometry\`, \`THREE.CylinderGeometry\`) with stylish glowing materials (\`THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.2, metalness: 0.8 })\`).
  - **Procedural Sound Fallback**: Instantly synthesize Web Audio API tones:
    \`\`\`js
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function synthBeep(freq = 440, duration = 0.15, type = 'sine') {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }
    \`\`\`

### B. Purely Procedural Games (Zero External Assets)
- Concepts like geometry dash, abstract math puzzles, falling sand, wireframe vector arcade, Conway's Game of Life, or particle physics **do not need any external assets**.
- For these concepts, generate 100% pure procedural code:
  - Procedural vector lines, glowing canvas gradients, custom shader uniforms, and mathematical particle systems.
  - Generates zero network requests, loads instantly, and runs at locked 120 FPS.

---

## 4. Visual Direction Harmonization
- Visual directions and art styles must be designed around the active assets:
  - If a 16-bit pixel sprite is used, the visual direction must feature crisp pixel art, retro color banding, and arcade HUD styling.
  - If a sticker or cartoon meme is used, the visual direction should feature cel-shading, bold outlines, and playful vibrant colors.
  - If a dark cyberpunk highway video is used, the visual direction must emphasize glowing neon emissives, rain reflections, and dark contrast.

---

## 5. Adaptive Camera & Perspective Decision Matrix

### A. Rule 1: Explicit User Camera Intent
- If the user's prompt or title already mentions the perspective:
  - Examples: "top down shooter", "first-person runner", "side scroller platformer", "isometric village", "bird's eye view".
  - **LOCK THIS PERSPECTIVE IMMEDIATELY.** Do not suggest conflicting cameras or override user intent.

### B. Rule 2: Inherent 2D / Fixed-Grid Genres
- Genres such as:
  - **Match-3 / Candy Crush clones**
  - **2048 / Sliding Block puzzles**
  - **Sudoku, Crossword, Wordle, Trivia**
  - **Solitaire, Poker, Blackjack, Card Battlers**
  - **Tic-Tac-Toe, Connect Four, Chess, Checkers**
  - **Flappy Bird, Brick Breaker / Breakout, Pong**
- **ARE INHERENTLY 2D FLAT.**
- NEVER assign a 3D orbit or first-person camera to these games. Lock them to an **Orthographic 2D Camera / Flat Stage Viewport**.

### C. Rule 3: Dynamic 3D Action Games
- For dynamic 3D games (runners, racing, flight, 3D platformers):
  - **Third-Person Follow Cam**: Best for character/vehicle runners. Camera placed behind and slightly above the player (e.g. \`camera.position.set(player.x, player.y + 4, player.z + 8); camera.lookAt(player.x, player.y + 1, player.z - 5);\`).
  - **Isometric 3/4 Dihedral**: Best for tactical action, city building, and action RPGs. Camera tilted at 30° - 45° with orthographic or long telephoto projection.
  - **First-Person POV**: Best for cockpits, mazes, and FPS games. Camera placed at player eye level with smooth mouse/touch yaw-pitch rotation.
  - **Asset-Aware Framing**: Frame the camera angle specifically so character models and animations are centered and clearly readable.
`;
