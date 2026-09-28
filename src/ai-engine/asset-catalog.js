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
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/audio/retro-drift-loop.mp3',
        genre: 'synthwave',
        type: 'bgm',
        tags: ['synthwave', 'cyberpunk', 'neon', 'racing', 'car', 'drift', 'speed', 'future', 'phonk', '80s'],
        volume: 0.38,
    },
    // Action / Combat / Energy
    {
        id: 'fs-action-1',
        title: 'High-Energy Arcade Beat',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/audio/arcade-action-beat.mp3',
        genre: 'action',
        type: 'bgm',
        tags: ['action', 'combat', 'battle', 'boss', 'intense', 'fight', 'hyper', 'shooter'],
        volume: 0.35,
    },
    // Chill / Lofi / Puzzle
    {
        id: 'fs-chill-1',
        title: 'Lofi Cozy Ambient Loop',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/audio/lofi-relax-loop.mp3',
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
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/audio/sfx-coin.mp3',
        genre: 'sfx-arcade',
        type: 'sfx',
        role: 'collect',
        tags: ['coin', 'collect', 'gem', 'pickup', 'point', 'score', 'star'],
        volume: 0.75,
    },
    {
        id: 'fs-sfx-impact',
        title: 'Impact Hit Sound',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/audio/sfx-hit.mp3',
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
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/videos/subway-surfers-loop.mp4',
        category: 'parkour',
        tags: ['subway', 'parkour', 'runner', 'speed', 'rail', 'train', 'surfer', 'brainrot'],
    },
    {
        id: 'vid-minecraft-parkour',
        title: 'Minecraft Speedrun Parkour',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/videos/minecraft-parkour-loop.mp4',
        category: 'parkour',
        tags: ['minecraft', 'parkour', 'blocks', 'speedrun', 'jump', 'runner', 'brainrot'],
    },
    {
        id: 'vid-synthwave-highway',
        title: 'Retro Neon Grid Highway',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/videos/synthwave-loop.mp4',
        category: 'synthwave',
        tags: ['synthwave', 'neon', 'highway', 'cyberpunk', 'retro', '80s', 'grid', 'drift', 'car', 'outrun'],
    },
    {
        id: 'vid-hyperspace-tunnel',
        title: 'Hyperspace Warp Tunnel',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/videos/space-warp-loop.mp4',
        category: 'space',
        tags: ['space', 'warp', 'tunnel', 'stars', 'hyperspace', 'speed', 'sci-fi', 'flight'],
    }
];

export const CURATED_SPRITE_PACKS = [
    {
        id: 'pack-ninja-frog',
        title: 'Ninja Frog Animated Hero',
        category: 'character',
        idleUrl: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/characters/asset-pixelfrog-ninja-frog-idle.png',
        tags: ['frog', 'ninja', 'pixel', 'hero', 'platformer', 'runner', 'jump', 'cute'],
    },
    {
        id: 'pack-foxy',
        title: 'SunnyLand Foxy Character',
        category: 'character',
        idleUrl: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/characters/asset-ansimuz-foxy-idle-1.png',
        tags: ['fox', 'foxy', 'cute', 'animal', 'forest', 'platformer', 'runner'],
    },
    {
        id: 'pack-2d-fighter',
        title: 'Toon Fighter Character',
        category: 'character',
        idleUrl: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/community-assets/characters/asset-kenney-toon-robot-attack0.png',
        tags: ['robot', 'fighter', 'action', 'brawler', 'mech', 'toon'],
    }
];

export const CURATED_3D_MODELS = [
    {
        id: 'kenney-car-racer',
        name: 'Sedan Sports Racer',
        category: 'vehicle',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/3d/kenney/vehicle/sedan.glb',
        tags: ['car', 'racing', 'vehicle', 'drive', 'speed', 'sports', 'traffic'],
    },
    {
        id: 'kenney-character-toon',
        name: 'Blocky Adventurer',
        category: 'character',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/3d/kenney/character/character-a.glb',
        tags: ['character', 'humanoid', 'player', 'hero', 'runner', 'blocky'],
    },
    {
        id: 'kenney-space-ship',
        name: 'Star Fighter Scout',
        category: 'space',
        url: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/3d/kenney/space/craft-speeder-a.glb',
        tags: ['spaceship', 'aircraft', 'fly', 'space', 'shooter', 'galaxy', 'sci-fi'],
    }
];

/**
 * Format catalog summary for Hermes and Gemini AI reasoning
 * The AI evaluates the prompt and dynamically selects fitting catalog assets,
 * plans the game loop around them, or chooses pure procedural generation.
 */
export function getCatalogSummary() {
    return `
AVAILABLE ASSET CATALOG (Use if appropriate to the concept; or build 100% procedurally if concept is abstract/pure code):
- Audio BGM:
  * Chiptune Retro Loop: "${CURATED_AUDIO_CATALOG[0].url}" (Genre: 8-bit arcade platformer)
  * Synthwave Neon Drift: "${CURATED_AUDIO_CATALOG[2].url}" (Genre: Cyberpunk / racing / phonk)
  * High-Energy Combat Beat: "${CURATED_AUDIO_CATALOG[3].url}" (Genre: Action / shooter / boss)
  * Lofi Ambient Loop: "${CURATED_AUDIO_CATALOG[4].url}" (Genre: Chill / puzzle / zen)
- Video Backdrops (for background underlay video runner/parkour):
  * Subway Surfers Parkour: "${CURATED_VIDEO_CATALOG[0].url}"
  * Minecraft Parkour Speedrun: "${CURATED_VIDEO_CATALOG[1].url}"
  * Synthwave Neon Highway: "${CURATED_VIDEO_CATALOG[2].url}"
  * Hyperspace Warp Tunnel: "${CURATED_VIDEO_CATALOG[3].url}"
- 2D Character Sprites:
  * Ninja Frog: "${CURATED_SPRITE_PACKS[0].idleUrl}"
  * SunnyLand Foxy: "${CURATED_SPRITE_PACKS[1].idleUrl}"
  * Toon Robot Fighter: "${CURATED_SPRITE_PACKS[2].idleUrl}"
- 3D GLB Models:
  * Sports Sedan Racer: "${CURATED_3D_MODELS[0].url}"
  * Blocky Character: "${CURATED_3D_MODELS[1].url}"
  * Star Fighter Scout: "${CURATED_3D_MODELS[2].url}"
`;
}
