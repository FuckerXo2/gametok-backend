const MAKER_BENCHMARK_SUITE = [
    {
        id: 'artillery-tank-duel',
        templateId: 'phaser-artillery',
        title: 'Tank Duel',
        difficulty: 'core',
        prompt: 'Create a turn-based artillery tank game where I control a tank on hilly terrain and take turns firing at an enemy tank. Let me adjust angle and power, show wind direction and strength, draw a clear projectile arc preview, and make shells explode on impact. The terrain should be destructible, the tanks should have health bars, and the round ends when one tank is destroyed. Make it polished for mobile with big readable controls, satisfying explosions, screen shake, and a clean tactical HUD.',
        acceptance: [
            'Changing angle or power changes the trajectory preview.',
            'Firing creates one projectile that follows an arc and explodes on terrain or tank impact.',
            'Explosion damage changes tank health and removes terrain pixels or terrain samples.',
            'Turns alternate after a shot resolves.',
            'HUD is code-rendered, readable, and does not use image-generated text.',
        ],
    },
    {
        id: 'spell-survival-loop',
        templateId: 'phaser-top-down-action',
        title: 'Magic Strike',
        difficulty: 'core',
        prompt: 'Create a top-down spell-survival game where I control a wizard who kites slime enemies. Drawing a circle creates a temporary earth shield area, swiping casts a fire wall, slimes split into smaller slimes when killed, and combos reward aggressive positioning. The first 10 seconds must show movement, enemies, casting, impacts, score feedback, and clear mobile controls.',
        acceptance: [
            'Player can move immediately on mobile controls.',
            'At least one enemy pursues the player within the first 10 seconds.',
            'Gesture or fallback buttons create visible spells with gameplay collision.',
            'Killed large slimes split into smaller enemies.',
            'Combo or score feedback changes after impacts.',
        ],
    },
    {
        id: 'physics-contraption-sandbox',
        templateId: 'canvas-simulation',
        title: 'Block Blast',
        difficulty: 'core',
        prompt: 'Create a construction sandbox puzzle where I drag blocks from a palette into a build zone, press START, and gravity activates. Blocks should fall, rotate, collide, and help a goal object reach a target zone. Include edit and retry flow, readable mobile controls, and obvious win or fail feedback.',
        acceptance: [
            'Dragging from the palette creates placeable blocks.',
            'START changes the simulation state from edit mode to physics mode.',
            'Blocks move or collide under gravity after simulation starts.',
            'Goal object reaching target zone triggers a win state.',
            'Retry returns to edit mode without reloading the page.',
        ],
    },
    {
        id: 'grid-puzzle-sokoban',
        templateId: 'canvas-grid-puzzle',
        title: 'Crate Path',
        difficulty: 'core',
        prompt: 'Create a mobile grid puzzle where I push crates onto glowing targets. The board needs walls, undo, restart, move counter, clear win feedback, and tap or swipe controls. Make the grid fit the screen without clipping.',
        acceptance: [
            'Player movement is grid-aligned and blocked by walls.',
            'Crates can be pushed but not pulled.',
            'Undo restores the previous board state.',
            'All crates on targets triggers a win state.',
            'Grid remains fully visible on a tall phone viewport.',
        ],
    },
    {
        id: 'runner-obstacle-loop',
        templateId: 'canvas-runner',
        title: 'Neon Dash',
        difficulty: 'breadth',
        prompt: 'Create a fast mobile runner where I jump, slide, collect coins, and dodge obstacles. Include speed ramping, readable score, restart after collision, satisfying pickup feedback, and controls that work with taps and swipes.',
        acceptance: [
            'Runner moves continuously without user holding a button.',
            'Jump and slide states visibly affect collision.',
            'Coins increase score when collected.',
            'Obstacle collision ends the run and shows restart.',
            'Difficulty ramps over time.',
        ],
    },
    {
        id: 'arcade-shooter-wave',
        templateId: 'canvas-arcade-shooter',
        title: 'Star Barrage',
        difficulty: 'breadth',
        prompt: 'Create a mobile arcade shooter where I drag a ship, fire projectiles, dodge enemies, and survive waves. Include enemy spawning, player health, score, pickups, explosion feedback, and a boss warning after a short time.',
        acceptance: [
            'Dragging changes the ship position.',
            'Player shots spawn and collide with enemies.',
            'Enemy waves spawn without manual triggers.',
            'Health or lives change after enemy collision.',
            'Score changes when enemies are destroyed.',
        ],
    },
    {
        id: 'story-dolphin-choices',
        templateId: 'story-vignette',
        title: 'Echoes of the Deep',
        difficulty: 'breadth',
        prompt: 'Create a polished interactive narrative game about a dolphin exploring ocean mysteries. Use echolocation pulses to reveal story nodes, present 2-3 meaningful choices, show immediate consequences, and track reputation with three dolphin pods. Make the UI readable and emotionally clear on mobile.',
        acceptance: [
            'At least two choices are presented to the player.',
            'Choosing an option changes visible story state.',
            'Reputation or relationship values change after decisions.',
            'Echolocation pulse reveals or highlights nodes.',
            'Text fits inside mobile UI containers.',
        ],
    },
    {
        id: 'platformer-rescue',
        templateId: 'phaser-platformer',
        title: 'Sky Rescue',
        difficulty: 'breadth',
        prompt: 'Create a side-scrolling platformer where I run, jump, collect gems, avoid enemies, and rescue a trapped friend at the end of the level. Include coyote-time-feeling jump forgiveness, checkpoints, damage feedback, mobile buttons, and a clear level-complete screen.',
        acceptance: [
            'Player can move left and right and jump.',
            'Platforms collide correctly with the player.',
            'Collectibles increase score.',
            'Enemy or hazard contact damages the player.',
            'Reaching the goal triggers level completion.',
        ],
    },
];

export function getMakerBenchmarkSuite() {
    return MAKER_BENCHMARK_SUITE.map((benchmark) => ({
        ...benchmark,
        acceptance: [...benchmark.acceptance],
    }));
}

export function filterMakerBenchmarkSuite({ ids = [], templates = [], difficulty = null, limit = null } = {}) {
    const wantedIds = new Set(ids.filter(Boolean));
    const wantedTemplates = new Set(templates.filter(Boolean));
    const normalizedDifficulty = difficulty ? String(difficulty).toLowerCase() : null;
    let selected = getMakerBenchmarkSuite().filter((benchmark) => {
        if (wantedIds.size > 0 && !wantedIds.has(benchmark.id)) return false;
        if (wantedTemplates.size > 0 && !wantedTemplates.has(benchmark.templateId)) return false;
        if (normalizedDifficulty && benchmark.difficulty !== normalizedDifficulty) return false;
        return true;
    });

    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
        selected = selected.slice(0, Number(limit));
    }

    return selected;
}

export function summarizeMakerBenchmark(benchmark) {
    if (!benchmark) return null;
    return {
        id: benchmark.id,
        templateId: benchmark.templateId,
        title: benchmark.title,
        difficulty: benchmark.difficulty,
        acceptanceCount: Array.isArray(benchmark.acceptance) ? benchmark.acceptance.length : 0,
        promptPreview: `${String(benchmark.prompt || '').slice(0, 180)}${String(benchmark.prompt || '').length > 180 ? '...' : ''}`,
    };
}
