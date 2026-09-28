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
 * Detect if a game concept is best executed purely procedurally without external assets
 * (e.g. minimalist geometry, math puzzles, sandbox physics, wireframe, particles)
 */
export function isConceptPureProcedural(prompt = '') {
    const p = String(prompt || '').toLowerCase();
    const proceduralKeywords = [
        'procedural', 'pure code', 'wireframe', 'vector', 'geometry dash', 'geometric',
        'math game', 'calculator', 'falling sand', 'conway', 'game of life', 'particle toy',
        'abstract', 'minimalist', 'clean shapes', 'neon lines', 'oscilloscope', 'fractal',
        'cube puzzle', '2048', 'sliding tile', 'sudoku', 'matrix effect'
    ];
    return proceduralKeywords.some(kw => p.includes(kw));
}

/**
 * Intelligently match catalog assets when the user hasn't explicitly picked assets
 * @param {string} prompt 
 * @param {object} context 
 * @returns {{ audio: object | null, video: object | null, sprite: object | null, model3d: object | null, isPureProcedural: boolean }}
 */
export function matchAssetsForPrompt(prompt = '', context = {}) {
    const p = String(prompt || '').toLowerCase();

    // Check if the game should be purely procedural
    if (isConceptPureProcedural(p)) {
        return {
            audio: null,
            video: null,
            sprite: null,
            model3d: null,
            isPureProcedural: true,
            guidance: 'Purely procedural game. Synthesize all graphics (shapes, gradients, particles) and Web Audio tones procedurally with zero external asset dependencies.'
        };
    }

    // 1. Audio Match
    let matchedAudio = null;
    if (p.includes('pixel') || p.includes('8-bit') || p.includes('retro') || p.includes('arcade') || p.includes('platformer')) {
        matchedAudio = CURATED_AUDIO_CATALOG.find(a => a.genre === 'arcade');
    } else if (p.includes('race') || p.includes('car') || p.includes('drift') || p.includes('cyber') || p.includes('synth') || p.includes('neon') || p.includes('phonk')) {
        matchedAudio = CURATED_AUDIO_CATALOG.find(a => a.genre === 'synthwave');
    } else if (p.includes('fight') || p.includes('battle') || p.includes('combat') || p.includes('action') || p.includes('boss') || p.includes('shoot')) {
        matchedAudio = CURATED_AUDIO_CATALOG.find(a => a.genre === 'action');
    } else if (p.includes('puzzle') || p.includes('match') || p.includes('zen') || p.includes('chill') || p.includes('relax') || p.includes('lofi') || p.includes('board') || p.includes('card')) {
        matchedAudio = CURATED_AUDIO_CATALOG.find(a => a.genre === 'chill');
    } else {
        matchedAudio = CURATED_AUDIO_CATALOG[0]; // Default energetic chiptune
    }

    // 2. Video Backdrop Match (only if prompt asks for runner, parkour, brainrot, highway, or space background)
    let matchedVideo = null;
    if (p.includes('subway') || p.includes('train') || p.includes('parkour') || p.includes('brainrot') || p.includes('skibidi') || p.includes('sigma')) {
        matchedVideo = CURATED_VIDEO_CATALOG[0]; // Subway parkour
    } else if (p.includes('minecraft') || p.includes('speedrun') || p.includes('roblox')) {
        matchedVideo = CURATED_VIDEO_CATALOG[1]; // Minecraft parkour
    } else if (p.includes('highway') || p.includes('neon drive') || p.includes('synthwave')) {
        matchedVideo = CURATED_VIDEO_CATALOG[2]; // Synthwave highway
    } else if (p.includes('space warp') || p.includes('hyperspace') || p.includes('galaxy run')) {
        matchedVideo = CURATED_VIDEO_CATALOG[3]; // Hyperspace tunnel
    }

    // 3. 2D Sprite Match
    let matchedSprite = null;
    if (p.includes('frog') || p.includes('ninja') || p.includes('hop')) {
        matchedSprite = CURATED_SPRITE_PACKS[0];
    } else if (p.includes('fox') || p.includes('foxy') || p.includes('cute animal') || p.includes('forest')) {
        matchedSprite = CURATED_SPRITE_PACKS[1];
    } else if (p.includes('robot') || p.includes('brawler') || p.includes('fighter')) {
        matchedSprite = CURATED_SPRITE_PACKS[2];
    }

    // 4. 3D Model Match (if 3D game indicated)
    let matched3DModel = null;
    if (p.includes('car') || p.includes('drive') || p.includes('racing') || p.includes('sedan') || p.includes('drift')) {
        matched3DModel = CURATED_3D_MODELS[0];
    } else if (p.includes('space') || p.includes('ship') || p.includes('flight') || p.includes('fly') || p.includes('jet')) {
        matched3DModel = CURATED_3D_MODELS[2];
    } else if (p.includes('3d runner') || p.includes('adventurer') || p.includes('humanoid')) {
        matched3DModel = CURATED_3D_MODELS[1];
    }

    return {
        audio: matchedAudio,
        video: matchedVideo,
        sprite: matchedSprite,
        model3d: matched3DModel,
        isPureProcedural: false,
        guidance: 'Intelligently matched catalog assets based on concept theme. Blend these assets with procedural fallback support.'
    };
}
