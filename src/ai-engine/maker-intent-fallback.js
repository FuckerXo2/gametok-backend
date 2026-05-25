function hasAny(text, words) {
    return words.some((word) => text.includes(word));
}

function titleForPrompt(text) {
    if (hasAny(text, ['slice', 'fruit', 'blade', 'cut'])) return 'Slice Rush';
    if (hasAny(text, ['draw', 'doodle', 'sketch', 'paint'])) return 'Draw Duel';
    if (hasAny(text, ['quiz', 'trivia', 'question'])) return 'Quick Quiz';
    if (hasAny(text, ['jump', 'platform'])) return 'Jump Run';
    if (hasAny(text, ['shoot', 'laser', 'bullet', 'space'])) return 'Arcade Blast';
    return 'Arcade Rush';
}

function classifyPrompt(text) {
    if (hasAny(text, ['first person', 'fps', 'walking sim', '3d maze'])) {
        return {
            dimension: '3D',
            perspective: 'first_person',
            preferredEngine: 'THREE',
            archetype: 'first_person_3d',
            reasoning: 'The prompt asks for first-person 3D movement or inspection.',
        };
    }
    if (hasAny(text, ['platform', 'jump', 'side scroller', 'side-scroller'])) {
        return {
            dimension: '2D',
            perspective: 'side_view',
            preferredEngine: 'PHASER',
            archetype: 'platformer',
            reasoning: 'The prompt centers on side-view jumping and platform collision.',
        };
    }
    if (hasAny(text, ['runner', 'flappy', 'dino', 'auto scroll', 'auto-scroll'])) {
        return {
            dimension: '2D',
            perspective: 'side_view',
            preferredEngine: 'CANVAS',
            archetype: 'runner',
            reasoning: 'The prompt centers on continuous forward pressure and obstacle dodging.',
        };
    }
    if (hasAny(text, ['grid', 'match', 'sokoban', 'tetris', 'tile puzzle'])) {
        return {
            dimension: '2D',
            perspective: 'top_down',
            preferredEngine: 'CANVAS',
            archetype: 'grid_puzzle',
            reasoning: 'The prompt describes discrete board or tile interactions.',
        };
    }
    if (hasAny(text, ['story', 'choice', 'dating', 'roleplay', 'visual novel'])) {
        return {
            dimension: '2D',
            perspective: 'third_person',
            preferredEngine: 'CANVAS',
            archetype: 'interactive_story',
            reasoning: 'The prompt is driven by choices and stateful narrative progression.',
        };
    }
    if (hasAny(text, ['top down', 'top-down', 'survivor', 'arena', 'zombie'])) {
        return {
            dimension: '2D',
            perspective: 'top_down',
            preferredEngine: 'PHASER',
            archetype: 'top_down_action',
            reasoning: 'The prompt asks for live entity movement and collisions in an arena.',
        };
    }
    return {
        dimension: '2D',
        perspective: hasAny(text, ['slice', 'swipe', 'fruit', 'draw', 'tap']) ? 'third_person' : 'top_down',
        preferredEngine: 'CANVAS',
        archetype: 'arcade',
        reasoning: 'The prompt describes a direct mobile arcade interaction that does not require stricter physics templates.',
    };
}

function buildFallbackAssets(text, title) {
    const slicing = hasAny(text, ['slice', 'fruit', 'blade', 'cut']);
    const drawing = hasAny(text, ['draw', 'doodle', 'sketch', 'paint']);

    if (slicing) {
        return {
            player: {
                description: 'No visible player avatar; player presence is a code-rendered swipe blade trail with bright impact flashes.',
                type: 'character',
                size: 128,
                transparent: true,
            },
            enemies: [
                {
                    id: 'bomb',
                    description: 'Round black arcade bomb with short glowing fuse, thick outline, readable danger silhouette, front-facing.',
                    type: 'enemy',
                    size: 128,
                    transparent: true,
                },
            ],
            items: [
                {
                    id: 'fruit_apple',
                    description: 'Bright red glossy apple, thick outline, small leaf, readable circular silhouette, front-facing.',
                    type: 'item',
                    size: 128,
                    transparent: true,
                },
                {
                    id: 'fruit_watermelon',
                    description: 'Large striped watermelon with saturated green rind and red interior hint, thick outline, front-facing.',
                    type: 'item',
                    size: 128,
                    transparent: true,
                },
            ],
            backgrounds: [
                {
                    id: 'arcade_background',
                    description: 'Dark mobile arcade backdrop with subtle gradient and no text, no HUD, no buttons, no labels, no foreground gameplay objects.',
                    type: 'background',
                    width: 768,
                    height: 1344,
                    transparent: false,
                },
            ],
            ui: [],
            props: [
                {
                    id: 'slice_burst',
                    description: 'Radial juice and spark impact burst for successful cuts, transparent background, no text.',
                    type: 'prop',
                    size: 96,
                    transparent: true,
                },
            ],
        };
    }

    if (drawing) {
        return {
            player: {
                description: 'Nervous cartoon human artist with paint-splattered smock, oversized brush, expressive face, thick outline.',
                type: 'character',
                size: 128,
                transparent: true,
            },
            enemies: [
                {
                    id: 'robot_artist',
                    description: 'Boxy art robot with single screen face, brush gripper arms, smug expression, thick outline.',
                    type: 'enemy',
                    size: 128,
                    transparent: true,
                },
            ],
            items: [
                {
                    id: 'bonus_brush',
                    description: 'Sparkling magic paintbrush powerup with bright bristles and simple readable shape.',
                    type: 'item',
                    size: 64,
                    transparent: true,
                },
            ],
            backgrounds: [
                {
                    id: 'stage_background',
                    description: 'Dark game show stage with spotlight and audience silhouettes, no text, no HUD, no buttons, no labels, no foreground characters.',
                    type: 'background',
                    width: 768,
                    height: 1344,
                    transparent: false,
                },
            ],
            ui: [],
            props: [
                {
                    id: 'podium',
                    description: 'Small game show podium prop with blank display area for code-rendered score.',
                    type: 'prop',
                    size: 96,
                    transparent: true,
                },
            ],
        };
    }

    return {
        player: {
            description: `Main playable subject for ${title}, bold silhouette, thick outline, mobile-readable, transparent background.`,
            type: 'character',
            size: 128,
            transparent: true,
        },
        enemies: [
            {
                id: 'primary_threat',
                description: `Primary obstacle or enemy for ${title}, clear threat silhouette, thick outline, transparent background.`,
                type: 'enemy',
                size: 128,
                transparent: true,
            },
        ],
        items: [
            {
                id: 'primary_item',
                description: `Primary collectible or target for ${title}, bright readable arcade object, transparent background.`,
                type: 'item',
                size: 64,
                transparent: true,
            },
        ],
        backgrounds: [
            {
                id: 'game_background',
                description: 'Portrait mobile gameplay background with clear action area, no text, no HUD, no buttons, no labels, no foreground entities.',
                type: 'background',
                width: 768,
                height: 1344,
                transparent: false,
            },
        ],
        ui: [],
        props: [
            {
                id: 'impact_effect',
                description: 'Primary impact or feedback burst, transparent background, no text.',
                type: 'prop',
                size: 96,
                transparent: true,
            },
        ],
    };
}

export function buildHeuristicQualityIntent(userPrompt = '', options = {}) {
    const text = String(userPrompt || '').toLowerCase();
    const title = titleForPrompt(text);
    const classification = classifyPrompt(text);
    const slicing = hasAny(text, ['slice', 'fruit', 'blade', 'cut']);
    const drawing = hasAny(text, ['draw', 'doodle', 'sketch', 'paint']);

    const primaryMechanic = slicing
        ? 'Swipe through flying objects to split them, score combos, and avoid hazards.'
        : drawing
            ? 'Draw on the canvas under time pressure, then compare against a rival drawing.'
            : 'Use the primary touch action to affect live entities, score, and survive escalating pressure.';

    return {
        title,
        userIntent: `Fallback operational spec generated after Phase 1 JSON recovery failed: ${String(userPrompt || '').slice(0, 220)}`,
        playableExperience: {
            coreFantasy: slicing
                ? 'Feel like a precise arcade slicer landing satisfying cuts.'
                : drawing
                    ? 'Feel the pressure of a fast creative duel.'
                    : 'Feel immediate control over a compact arcade challenge.',
            coreLoop: slicing
                ? 'Objects enter the playfield -> player swipes -> cuts produce feedback and combo score -> missed objects or hazards add pressure -> repeat faster.'
                : drawing
                    ? 'Read prompt -> draw quickly -> rival result appears -> score/lives update -> next prompt begins.'
                    : 'Threats or targets appear -> player acts -> score/health/progress changes -> next wave increases pressure.',
            primaryMechanic,
            funFactor: 'Immediate input feedback, visible state changes, and escalating score pressure.',
            firstTenSeconds: [
                'A visible playfield, HUD, and at least one live entity are rendered on frame 1.',
                'The main goal and pressure are visible within 2 seconds.',
                'The player can use the primary touch input immediately.',
                'Successful input changes score/state and produces clear visual feedback.',
            ],
            winCondition: 'Earn a high score or survive the round target.',
            loseCondition: 'Lose all lives, miss too many objectives, or hit a fail hazard.',
        },
        technicalRequirements: {
            dimension: classification.dimension,
            perspective: classification.perspective,
            preferredEngine: classification.preferredEngine,
            archetype: classification.archetype,
            archetypeReasoning: classification.reasoning,
            screenComposition: 'Portrait mobile playfield with code-rendered HUD in the top safe area and primary action in the central screen.',
            hudPlan: 'Code-render score, lives/timer, combo/progress, and status text. Do not bake UI into generated images.',
        },
        artDirection: {
            styleName: slicing ? 'high-contrast kinetic arcade' : drawing ? 'messy cartoon game show' : 'clean mobile arcade',
            palette: slicing ? ['#0A0A0F', '#FF2D55', '#FF9500', '#FFD60A', '#00C7BE', '#F7FFF7'] : ['#111827', '#2563EB', '#F59E0B', '#EF4444', '#F8FAFC', '#10B981'],
            spriteStyle: 'Bold readable silhouettes, thick outlines, saturated colors, minimal detail that survives small mobile scale.',
            spriteCameraAngle: slicing ? 'front-facing' : 'three-quarter',
            backgroundStyle: 'Low-distraction portrait backdrop with a clear central action area and no text or UI.',
            terrainStyle: 'Code-rendered gameplay geometry with simple high-contrast shapes and clear collision boundaries.',
            uiStyle: 'Code-rendered mobile HUD with high contrast, compact spacing, and chrome-safe margins.',
            screenComposition: 'Top 10 percent HUD, middle 75 percent active gameplay, bottom safe area kept clear for gestures.',
            consistencyRules: [
                'Generated art is used for gameplay sprites and scenery only.',
                'HUD, controls, labels, and hitboxes stay code-rendered.',
                'Every live entity must have a code-owned state object and visible renderer.',
            ],
            avoid: [
                'blank first frame',
                'baked UI text in generated images',
                'decorative-only entities that do not affect score or lives',
                'offscreen controls',
            ],
        },
        mobileControls: [
            {
                action: slicing ? 'slice object' : drawing ? 'draw stroke' : 'primary action',
                input: slicing ? 'swipe' : drawing ? 'drag' : 'tap',
                feedback: 'Immediate visible effect, sound cue, and score/state change.',
            },
        ],
        playerActions: slicing ? ['swipe to cut', 'chain combos', 'avoid hazards'] : drawing ? ['draw strokes', 'submit drawing', 'survive judging'] : ['move or aim', 'perform primary action', 'collect or avoid entities'],
        entityRules: [
            {
                entity: slicing ? 'primary target' : drawing ? 'drawing canvas' : 'primary target',
                role: 'item',
                behavior: 'Appears in active play and can be affected by player input.',
                interaction: 'Successful interaction changes score/progress and triggers feedback.',
                feedback: 'Particles, animation, and HUD update.',
            },
            {
                entity: slicing ? 'hazard' : drawing ? 'robot rival' : 'primary threat',
                role: 'enemy',
                behavior: 'Creates failure pressure.',
                interaction: 'Bad interaction costs lives, time, or score.',
                feedback: 'Warning color, shake, or status text.',
            },
        ],
        mustExist: [
            'Visible gameplay on the first frame.',
            'A code-rendered HUD with score and lives/timer.',
            'At least one live item/target entity rendered from generated assets or fallback art.',
            'At least one threat or failure condition.',
            'Primary touch input mutates live game state.',
            'Score/progress changes after successful input.',
            'Failure state changes after mistakes or hazards.',
            'Mobile viewport fits 390x844 without horizontal overflow.',
        ],
        feelRules: [
            'Every successful action creates immediate visual feedback.',
            'HUD state updates in the same frame as gameplay state.',
            'Start the loop immediately, without waiting for user setup.',
            'Use code-rendered fallback shapes while generated images load.',
        ],
        failureModesToAvoid: [
            'Do not crash if Phase 1 art is generic.',
            'Do not render a blank canvas while waiting for assets.',
            'Do not ignore required generated asset roles.',
            'Do not use AI images for HUD text or buttons.',
            'Do not create non-interactive decorative objects as the only gameplay.',
        ],
        assetRoles: [
            { assetId: 'item1', roleInGameplay: 'Primary interactive target or collectible rendered in the live entity loop.' },
            { assetId: 'enemy1', roleInGameplay: 'Primary hazard or rival rendered in gameplay.' },
            { assetId: 'background1', roleInGameplay: 'Scenery layer only, never collision or UI.' },
        ],
        visualAssets: buildFallbackAssets(text, title),
        audioNeeds: {
            music: ['short looping arcade background music'],
            sfx: ['primary action hit', 'score increase', 'failure warning', 'round start'],
        },
        qualityTarget: {
            level: 'reliable',
            mood: 'responsive and playable',
            polishPriorities: ['visible first frame', 'live state changes', 'mobile-safe layout'],
        },
        fallback: {
            source: 'heuristic_opengame_style_spec',
            reason: options.reason || 'phase1_json_failed',
        },
    };
}

