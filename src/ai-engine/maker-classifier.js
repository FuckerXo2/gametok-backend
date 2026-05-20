function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function collectIntentText(qualityIntent = {}, prompt = '') {
    return [
        prompt,
        qualityIntent.title,
        qualityIntent.userIntent,
        qualityIntent.playableExperience?.coreLoop,
        qualityIntent.playableExperience?.primaryMechanic,
        qualityIntent.playableExperience?.firstTenSeconds,
        qualityIntent.technicalRequirements?.dimension,
        qualityIntent.technicalRequirements?.perspective,
        qualityIntent.technicalRequirements?.genre,
        qualityIntent.playerActions,
        qualityIntent.entityRules,
        qualityIntent.mustExist,
    ].flat(Infinity).map(normalizeText).filter(Boolean).join(' ');
}

function hasPhrase(text, phrase) {
    const normalized = normalizeText(phrase);
    if (!normalized) return false;
    return text.includes(normalized);
}

function hasWord(text, word) {
    return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function matchSignals(text, signals = []) {
    const matched = [];
    for (const signal of signals) {
        const ok = signal.includes(' ') ? hasPhrase(text, signal) : hasWord(text, signal);
        if (ok) matched.push(signal);
    }
    return matched;
}

const TEMPLATE_CLASSIFIERS = [
    {
        templateId: 'phaser-artillery',
        archetype: 'turn_based_artillery',
        profile: {
            dimension: '2D',
            perspective: 'side_view',
            physics: 'projectile_ballistics',
            movement: 'turn_based_aim_and_fire',
        },
        high: ['artillery', 'tank duel', 'tank tactics', 'cannon', 'shell', 'trajectory', 'wind direction', 'wind strength', 'angle and power'],
        medium: ['tank', 'turn based', 'turn-based', 'power', 'angle', 'projectile arc', 'hilly terrain', 'destructible terrain', 'explode on impact'],
        negative: ['powerup', 'powerups', 'power up', 'power ups', 'spaceship', 'bullet hell', 'endless runner'],
    },
    {
        templateId: 'phaser-top-down-action',
        archetype: 'top_down_action',
        profile: {
            dimension: '2D',
            perspective: 'top_down',
            physics: 'entity_collisions',
            movement: 'free_movement',
        },
        high: ['top down', 'top-down', 'rogue lite', 'roguelite', 'arena survival', 'survive waves', 'wave survival'],
        medium: ['dash', 'slime', 'enemy waves', 'melee', 'spell', 'combo', 'kite enemies', 'area control', 'zombies'],
        negative: ['turn based', 'turn-based', 'platformer', 'side scroller', 'side-scroller', 'swipe', 'fruit ninja'],
    },
    {
        templateId: 'phaser-platformer',
        archetype: 'platformer',
        profile: {
            dimension: '2D',
            perspective: 'side_view',
            physics: 'gravity_platform_collision',
            movement: 'run_jump',
        },
        high: ['platformer', 'side scroller', 'side-scroller', 'run and jump', 'jump on platforms'],
        medium: ['jump', 'platform', 'gravity', 'falling', 'collect coins', 'hazards', 'level goal'],
        negative: ['turn based', 'turn-based', 'top down', 'top-down'],
    },
    {
        templateId: 'canvas-runner',
        archetype: 'runner',
        profile: {
            dimension: '2D',
            perspective: 'side_view',
            physics: 'scrolling_obstacle_collision',
            movement: 'auto_run',
        },
        high: ['endless runner', 'auto runner', 'autorunner', 'dodge obstacles', 'runner game'],
        medium: ['run', 'jump', 'slide', 'distance', 'obstacles', 'collect coins'],
        negative: ['turn based', 'turn-based', 'tank', 'artillery'],
    },
    {
        templateId: 'canvas-arcade-shooter',
        archetype: 'arcade_shooter',
        profile: {
            dimension: '2D',
            perspective: 'arcade',
            physics: 'projectile_collision',
            movement: 'move_and_fire',
        },
        high: ['space shooter', 'arcade shooter', 'shoot enemies', 'bullet hell', 'asteroids', 'invaders'],
        medium: ['shooter', 'shoot', 'bullets', 'laser', 'ship', 'enemy wave', 'powerups', 'power ups', 'fire weapon'],
        negative: ['turn based', 'turn-based', 'artillery', 'tank', 'dialogue'],
    },
    {
        templateId: 'canvas-simulation',
        archetype: 'physics_simulation',
        profile: {
            dimension: '2D',
            perspective: 'side_view',
            physics: 'sandbox_rigid_body',
            movement: 'edit_then_simulate',
        },
        high: ['physics sandbox', 'construction sandbox', 'contraption', 'drag blocks', 'build zone', 'simulate physics'],
        medium: ['blocks', 'moving parts', 'gravity puzzle', 'start simulation', 'goal object', 'target zone', 'structure'],
        negative: ['shooter', 'platformer', 'dialogue'],
    },
    {
        templateId: 'canvas-grid-puzzle',
        archetype: 'grid_puzzle',
        profile: {
            dimension: '2D',
            perspective: 'grid',
            physics: 'discrete_grid_rules',
            movement: 'tile_selection',
        },
        high: ['grid puzzle', 'match 3', 'match-three', 'sokoban', 'sliding block', 'tile puzzle'],
        medium: ['grid', 'tile', 'board', 'swap', 'maze', 'chess', 'tetris', 'blocks'],
        negative: ['physics sandbox', 'tank', 'runner'],
    },
    {
        templateId: 'story-vignette',
        archetype: 'interactive_story',
        profile: {
            dimension: '2D',
            perspective: 'scene',
            physics: 'state_machine',
            movement: 'choice_navigation',
        },
        high: ['interactive narrative', 'branching story', 'choice dialogue', 'story nodes', 'visual novel'],
        medium: ['choice', 'choices', 'dialogue', 'dialog', 'narrative', 'reputation', 'ending', 'chapter'],
        negative: ['shooter', 'platformer', 'tank', 'runner'],
    },
    {
        templateId: 'three-first-person',
        archetype: 'first_person_3d',
        profile: {
            dimension: '3D',
            perspective: 'first_person',
            physics: '3d_collision',
            movement: 'first_person_move_look',
        },
        high: ['first person', 'first-person', '3d world', 'fps', 'walking simulator'],
        medium: ['3d', 'look around', 'camera', 'explore room'],
        negative: ['2d', 'top down', 'side scroller', 'turn based'],
    },
];

function scoreClassifier(text, classifier) {
    const high = matchSignals(text, classifier.high);
    const medium = matchSignals(text, classifier.medium);
    const negative = matchSignals(text, classifier.negative);
    const score = high.length * 5 + medium.length * 2 - negative.length * 4;
    return {
        templateId: classifier.templateId,
        archetype: classifier.archetype,
        profile: classifier.profile,
        score,
        signals: {
            high,
            medium,
            negative,
        },
    };
}

function applyTechnicalHints(scores, qualityIntent = {}) {
    const tech = qualityIntent.technicalRequirements || {};
    const perspective = normalizeText(tech.perspective);
    const dimension = normalizeText(tech.dimension);
    const genre = normalizeText(tech.genre);

    return scores.map((entry) => {
        let score = entry.score;
        const hints = [];
        if (dimension.includes('3d') && entry.profile.dimension === '3D') {
            score += 5;
            hints.push('phase1_dimension_3d');
        }
        if (perspective.includes('top') && entry.profile.perspective === 'top_down') {
            score += 4;
            hints.push('phase1_top_down');
        }
        if ((perspective.includes('side') || genre.includes('platform')) && entry.profile.perspective === 'side_view') {
            score += 2;
            hints.push('phase1_side_view');
        }
        if (genre.includes('puzzle') && entry.templateId === 'canvas-grid-puzzle') {
            score += 4;
            hints.push('phase1_puzzle');
        }
        return { ...entry, score, hints };
    });
}

export function classifyMakerGame(qualityIntent = {}, prompt = '') {
    const text = collectIntentText(qualityIntent, prompt);
    const scored = applyTechnicalHints(
        TEMPLATE_CLASSIFIERS.map((classifier) => scoreClassifier(text, classifier)),
        qualityIntent
    ).sort((a, b) => b.score - a.score);

    const winner = scored[0] || null;
    const runnerUp = scored[1] || null;
    const selectedTemplateId = winner && winner.score > 0 ? winner.templateId : 'canvas-arcade';
    const confidence = winner && winner.score > 0
        ? Math.max(0.35, Math.min(0.98, (winner.score - Math.max(0, runnerUp?.score || 0) + winner.score) / 24))
        : 0.2;

    const classification = {
        version: 1,
        source: 'gametok-maker-classifier',
        selectedTemplateId,
        selectedArchetype: winner?.archetype || 'arcade',
        confidence: Number(confidence.toFixed(2)),
        physicsProfile: winner?.profile || {
            dimension: '2D',
            perspective: 'arcade',
            physics: 'entity_collision',
            movement: 'direct_input',
        },
        reasoning: winner && winner.score > 0
            ? `Selected ${selectedTemplateId} from mechanics/perspective signals.`
            : 'No strong template signal found; falling back to canvas arcade.',
        scores: scored.map((entry) => ({
            templateId: entry.templateId,
            score: entry.score,
            signals: entry.signals,
            hints: entry.hints || [],
        })),
    };

    return classification;
}
