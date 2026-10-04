/**
 * Asset Catalog & Semantic Discovery for Hermes + Gemini
 * 
 * Provides fast access to curated audio tracks, video backdrops, 2D character sprites,
 * and 3D GLB model kits. Enables intelligent catalog selection when assets haven't been
 * explicitly chosen by the user, while recognizing purely procedural concepts.
 */

export const CURATED_AUDIO_CATALOG = [
    // Arcade / 8-Bit
    {
        id: 'fs-397469',
        title: 'Chiptune Loop Episode 03',
        url: 'https://cdn.freesound.org/previews/397/397469_2635357-hq.mp3',
        genre: 'arcade',
        type: 'bgm',
        tags: ['8bit', 'chiptune', 'retro', 'arcade', 'pixel', 'nostalgic', 'level', 'jump', 'runner'],
        volume: 0.35,
    },
    {
        id: 'fs-396960',
        title: 'Chiptune Loop Episode 01',
        url: 'https://cdn.freesound.org/previews/396/396960_2635357-hq.mp3',
        genre: 'arcade',
        type: 'bgm',
        tags: ['8bit', 'chiptune', 'retro', 'arcade', 'fast', 'upbeat', 'platformer'],
        volume: 0.35,
    },
    // Synthwave / Cyberpunk / Racing
    {
        id: 'fs-synthwave-1',
        title: 'Retro Neon Synthwave Runner',
        url: 'https://games.gametok.co/audio/retro-drift-loop.mp3',
        genre: 'synthwave',
        type: 'bgm',
        tags: ['synthwave', 'cyberpunk', 'neon', 'racing', 'car', 'drift', 'speed', 'future', 'phonk', '80s'],
        volume: 0.38,
    },
    // Action / Combat / Energy
    {
        id: 'fs-action-1',
        title: 'High-Energy Arcade Beat',
        url: 'https://games.gametok.co/audio/arcade-action-beat.mp3',
        genre: 'action',
        type: 'bgm',
        tags: ['action', 'combat', 'battle', 'boss', 'intense', 'fight', 'hyper', 'shooter'],
        volume: 0.35,
    },
    // Chill / Lofi / Puzzle
    {
        id: 'fs-chill-1',
        title: 'Lofi Cozy Ambient Loop',
        url: 'https://games.gametok.co/audio/lofi-relax-loop.mp3',
        genre: 'chill',
        type: 'bgm',
        tags: ['chill', 'lofi', 'ambient', 'calm', 'puzzle', 'relax', 'zen', 'match3', '2048', 'board'],
        volume: 0.32,
    },
    // Sound Effects
    {
        id: 'fs-sfx-jump',
        title: 'Retro Arcade Jump',
        url: 'https://cdn.freesound.org/previews/397/397469_2635357-hq.mp3', // fallback audio
        genre: 'sfx-arcade',
        type: 'sfx',
        role: 'jump',
        tags: ['jump', 'bounce', 'hop', 'spring', 'action'],
        volume: 0.7,
    },
    {
        id: 'fs-sfx-coin',
        title: 'Coin Collect Blip',
        url: 'https://games.gametok.co/audio/sfx-coin.mp3',
        genre: 'sfx-arcade',
        type: 'sfx',
        role: 'collect',
        tags: ['coin', 'collect', 'gem', 'pickup', 'point', 'score', 'star'],
        volume: 0.75,
    },
    {
        id: 'fs-sfx-impact',
        title: 'Impact Hit Sound',
        url: 'https://games.gametok.co/audio/sfx-hit.mp3',
        genre: 'sfx-combat',
        type: 'sfx',
        role: 'impact',
        tags: ['hit', 'impact', 'smash', 'crash', 'damage', 'hurt', 'explosion'],
        volume: 0.8,
    }
];

export const CURATED_VIDEO_CATALOG = [
    {
        id: 'vid-subway-parkour',
        title: 'Subway Surfers Infinite Run',
        url: 'https://games.gametok.co/community-assets/videos/subway-surfers-loop.mp4',
        category: 'parkour',
        tags: ['subway', 'parkour', 'runner', 'speed', 'rail', 'train', 'surfer', 'brainrot'],
    },
    {
        id: 'vid-minecraft-parkour',
        title: 'Minecraft Speedrun Parkour',
        url: 'https://games.gametok.co/community-assets/videos/minecraft-parkour-loop.mp4',
        category: 'parkour',
        tags: ['minecraft', 'parkour', 'blocks', 'speedrun', 'jump', 'runner', 'brainrot'],
    },
    {
        id: 'vid-synthwave-highway',
        title: 'Retro Neon Grid Highway',
        url: 'https://games.gametok.co/community-assets/videos/synthwave-loop.mp4',
        category: 'synthwave',
        tags: ['synthwave', 'neon', 'highway', 'cyberpunk', 'retro', '80s', 'grid', 'drift', 'car', 'outrun'],
    },
    {
        id: 'vid-hyperspace-tunnel',
        title: 'Hyperspace Warp Tunnel',
        url: 'https://games.gametok.co/community-assets/videos/space-warp-loop.mp4',
        category: 'space',
        tags: ['space', 'warp', 'tunnel', 'stars', 'hyperspace', 'speed', 'sci-fi', 'flight'],
    }
];

export const CURATED_SPRITE_PACKS = [
    {
        id: 'pack-ninja-frog',
        title: 'Ninja Frog Animated Hero',
        category: 'character',
        idleUrl: 'https://games.gametok.co/community-assets/characters/asset-pixelfrog-ninja-frog-idle.png',
        tags: ['frog', 'ninja', 'pixel', 'hero', 'platformer', 'runner', 'jump', 'cute'],
    },
    {
        id: 'pack-foxy',
        title: 'SunnyLand Foxy Character',
        category: 'character',
        idleUrl: 'https://games.gametok.co/community-assets/characters/asset-ansimuz-foxy-idle-1.png',
        tags: ['fox', 'foxy', 'cute', 'animal', 'forest', 'platformer', 'runner'],
    },
    {
        id: 'pack-2d-fighter',
        title: 'Toon Fighter Character',
        category: 'character',
        idleUrl: 'https://games.gametok.co/community-assets/characters/asset-kenney-toon-robot-attack0.png',
        tags: ['robot', 'fighter', 'action', 'brawler', 'mech', 'toon'],
    }
];

export const CURATED_3D_MODELS = [
    {
        id: 'kenney-car-racer',
        name: 'Sedan Sports Racer',
        category: 'vehicle',
        url: 'https://games.gametok.co/3d/kenney/vehicle/sedan.glb',
        tags: ['car', 'racing', 'vehicle', 'drive', 'speed', 'sports', 'traffic'],
    },
    {
        id: 'kenney-character-toon',
        name: 'Blocky Adventurer',
        category: 'character',
        url: 'https://games.gametok.co/3d/kenney/character/character-a.glb',
        tags: ['character', 'humanoid', 'player', 'hero', 'runner', 'blocky'],
    },
    {
        id: 'kenney-space-ship',
        name: 'Star Fighter Scout',
        category: 'space',
        url: 'https://games.gametok.co/3d/kenney/space/craft-speeder-a.glb',
        tags: ['spaceship', 'aircraft', 'fly', 'space', 'shooter', 'galaxy', 'sci-fi'],
    },
    {
        id: 'char-scorpion',
        name: 'Scorpion (Mortal Kombat)',
        category: 'character',
        archetype: 'fighters',
        url: 'https://games.gametok.co/characters/scorpion_rigged.glb',
        rawUrl: 'https://games.gametok.co/characters/scorpion.glb',
        tags: ['scorpion', 'ninja', 'fighter', 'mortal kombat', 'warrior', 'combat', 'martial arts', 'fighters'],
    },
    {
        id: 'char-green-lantern',
        name: 'Hal Jordan (Green Lantern)',
        category: 'character',
        archetype: 'superheroes',
        url: 'https://games.gametok.co/characters/hal_jordan_green_lantern_rigged.glb',
        rawUrl: 'https://games.gametok.co/characters/hal_jordan_green_lantern.glb',
        tags: ['green lantern', 'hal jordan', 'superhero', 'dc', 'fighter', 'energy', 'hero', 'superheroes'],
    }
];

/**
 * Filter 3D humanoid characters by gameplay archetype
 * @param {'superheroes'|'villains'|'street_citizens_npcs'|'fighters'|'monsters_creatures'} archetype 
 */
export function getCharactersByArchetype(archetype) {
    if (!archetype) return CURATED_3D_MODELS.filter(m => m.category === 'character');
    return CURATED_3D_MODELS.filter(m => m.category === 'character' && (m.archetype === archetype || m.tags.includes(archetype)));
}

/**
 * Format catalog summary for Hermes and Gemini AI reasoning
 * The AI evaluates the prompt and dynamically selects fitting catalog assets,
 * plans the game loop around them, or chooses pure procedural generation.
 */
export function getCatalogSummary() {
    return `
AVAILABLE ASSET CATALOG (Use if appropriate to the concept; or build 100% procedurally if concept is abstract/pure code):
- Audio BGM:
  * Chiptune Retro Loop: "https://cdn.freesound.org/previews/397/397469_2635357-hq.mp3" (Genre: 8-bit arcade platformer)
  * Synthwave Neon Drift: "https://games.gametok.co/audio/retro-drift-loop.mp3" (Genre: Cyberpunk / racing / phonk)
  * High-Energy Combat Beat: "https://games.gametok.co/audio/arcade-action-beat.mp3" (Genre: Action / shooter / boss)
  * Lofi Ambient Loop: "https://games.gametok.co/audio/lofi-relax-loop.mp3" (Genre: Chill / puzzle / zen)
- Video Backdrops (for background underlay video runner/parkour):
  * Subway Surfers Parkour: "https://games.gametok.co/community-assets/videos/subway-surfers-loop.mp4"
  * Minecraft Parkour Speedrun: "https://games.gametok.co/community-assets/videos/minecraft-parkour-loop.mp4"
  * Synthwave Neon Highway: "https://games.gametok.co/community-assets/videos/synthwave-loop.mp4"
  * Hyperspace Warp Tunnel: "https://games.gametok.co/community-assets/videos/space-warp-loop.mp4"
- 2D Character Sprites:
  * Ninja Frog: "https://games.gametok.co/community-assets/characters/asset-pixelfrog-ninja-frog-idle.png"
  * SunnyLand Foxy: "https://games.gametok.co/community-assets/characters/asset-ansimuz-foxy-idle-1.png"
  * Toon Robot Fighter: "https://games.gametok.co/community-assets/characters/asset-kenney-toon-robot-attack0.png"
- 3D Humanoid Characters by Archetype (100% Pre-Rigged with Master Skeleton):
  * Superheroes (Green Lantern / Hal Jordan): "https://games.gametok.co/characters/hal_jordan_green_lantern_rigged.glb"
  * Fighters & Martial Artists (Scorpion): "https://games.gametok.co/characters/scorpion_rigged.glb"
- 3D Skeletal Animation Clips (Mixamo / UE5 Standard Skeleton):
  * Idle: "https://games.gametok.co/animations/core/idle.glb"
  * Fight Idle: "https://games.gametok.co/animations/core/fight_idle.glb"
  * Walk: "https://games.gametok.co/animations/core/walk.glb"
  * Run: "https://games.gametok.co/animations/core/run.glb"
  * Punch: "https://games.gametok.co/animations/core/punch.glb"
  * Cross Punch: "https://games.gametok.co/animations/core/cross_punch.glb"
  * Kick: "https://games.gametok.co/animations/core/kick.glb"
  * Block: "https://games.gametok.co/animations/core/block.glb"
  * Hit Reaction: "https://games.gametok.co/animations/core/hit.glb"
  * Death/Defeat: "https://games.gametok.co/animations/core/death.glb"
- Usage in Three.js:
  1. Add GLTFLoader: <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
  2. Load model:
     const gltfLoader = new THREE.GLTFLoader();
     let mixer = null;
     gltfLoader.load(characterUrl, (gltf) => {
       const model = gltf.scene;
       scene.add(model);
       mixer = new THREE.AnimationMixer(model);
       // Load & play animation clip:
       gltfLoader.load(animUrl, (animGltf) => {
         if (animGltf.animations.length > 0) {
           const action = mixer.clipAction(animGltf.animations[0]);
           action.play();
         }
       });
     }, undefined, (err) => console.warn('GLB load error, using procedural fallback'));
  3. In update loop: if (mixer) mixer.update(dt);
  4. Always spawn a procedural placeholder/fallback so game is immediately playable even before GLB network load completes!
`;
}
