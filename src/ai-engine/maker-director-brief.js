// DIRECTOR PRE-PASS — turns a three-word game idea into a full art-directed brief.
//
// The problem this solves: a user types "boat racing game" and that is literally all the builder
// model ever sees, on top of a generic prompt whose strongest visual instruction is "environments
// must look visually appealing". With no committed art direction the model falls back to its
// defaults, and its defaults are untextured primitives on a flat plane.
//
// So we write the spec the user didn't. One cheap JSON call to the SAME model family that builds
// the game (Kimi) expands the idea into a structured brief, which renderDirectorBriefText() then
// prints as a long, numeric, committed design document — the kind a human writes by hand when they
// want a good result.
//
// Two rules make this work rather than just producing more slop:
//
//   1. NUMBERS, NOT ADJECTIVES. "3-band toon ramp at 0.30/0.62" is executable; "premium visuals"
//      is not. Every slot in the schema below asks for values, and the system prompt rejects
//      adjective-only answers.
//   2. FIXED PER-ARCHETYPE SKELETONS. The required systems for a racer are hardcoded here, not
//      invented per generation. The model only fills theme-specific values into slots we chose.
//      Without this the director itself becomes the variance and every game gets a different bar.
//
// Failure is always soft: if the call fails or returns junk, buildGamePrompt() proceeds exactly as
// it did before this file existed.

import { callKimiJson } from './moonshot-text-client.js';

/**
 * Per-archetype skeletons. `systems` is the non-negotiable list of things the game must actually
 * implement — it is injected into the director's prompt so the brief always covers them, and it is
 * reprinted in the final brief so the builder can't quietly drop one. These are deliberately
 * mechanical ("wave height sampled at N points"), not aspirational ("fun handling").
 */
export const DIRECTOR_ARCHETYPES = {
    racer: {
        label: 'Racer / driving',
        camera: 'chase camera, spring-damped, FOV widens with speed',
        systems: [
            'a closed circuit defined by a spline, with corner variety (at least one hairpin, one sweeper, one straight)',
            'lap counting, checkpoints, and wrong-way detection',
            'speed-dependent steering (turn radius tightens as speed rises)',
            'a drift or boost mechanic with a payoff',
            '3 AI opponents that follow the racing line with lookahead steering and make occasional mistakes',
            'a results screen with placement and times',
        ],
    },
    runner: {
        label: 'Endless runner / dodger',
        camera: 'follow camera trailing the player, slight lead in the direction of travel',
        systems: [
            'procedurally streamed terrain or track that never repeats visibly',
            'a difficulty curve that raises speed and obstacle density over distance',
            'at least 3 distinct obstacle types with different avoidance actions',
            'collectibles with a visible reward loop (score multiplier, shield, boost)',
            'a near-miss / close-call feedback moment',
            'run distance and best-distance persistence',
        ],
    },
    shooter: {
        label: 'Shooter / combat',
        camera: 'framing that keeps both the player and incoming threats readable at all times',
        systems: [
            'auto-fire or tap-fire with a clear rate-of-fire number',
            'at least 3 enemy types with distinct silhouettes, movement patterns, and telegraphs',
            'wave pacing with escalation and a breather between waves',
            'a weapon or power progression with visible model/effect changes on upgrade',
            'hit feedback: knockback, damage numbers or flash, and death effects',
            'a boss or climax encounter that ends the run',
        ],
    },
    arena: {
        label: 'Arena / brawler / survival',
        camera: 'framing that holds the whole arena or tracks the player with generous lookahead',
        systems: [
            'a bounded arena with readable landmarks and cover, not an empty plane',
            'enemy spawning that escalates in count and type',
            'a dodge, block, or movement skill with a cooldown',
            'health, damage, and a visible fail state',
            'pickups that change the moment-to-moment plan',
            'a score or survival-time loop that rewards replay',
        ],
    },
    platformer: {
        label: 'Platformer / traversal',
        camera: 'camera that leads the jump arc and eases rather than snapping',
        systems: [
            'jump tuning stated in numbers (apex height, time to apex, gravity, coyote time)',
            'at least 3 platform behaviours (static, moving, breaking or timed)',
            'hazards with clear telegraphs and fair recovery',
            'checkpoints and a respawn that does not punish over-harshly',
            'a collectible or goal that pulls the player through the level',
            'a level layout with a difficulty ramp and one memorable set piece',
        ],
    },
    puzzle: {
        label: 'Puzzle / grid',
        camera: 'fixed framing that keeps the whole board legible with no scrolling',
        systems: [
            'a rule set stated exactly, including what a legal move is',
            'a win condition and a lose or stuck condition',
            'move feedback: highlight, snap, and an illegal-move rejection cue',
            'escalating levels or a scoring curve',
            'undo or restart',
            'a satisfying resolve animation on a solve',
        ],
    },
    sim: {
        label: 'Simulation / toybox / builder',
        camera: 'framing that shows the system state and the thing the player is currently editing',
        systems: [
            'a simulation loop with stated tick behaviour',
            'at least 3 placeable or interactable element types that affect each other',
            'a visible resource, budget, or pressure that forces decisions',
            'clear cause-and-effect feedback when the player changes something',
            'a fail or overload state',
            'a reason to keep playing past two minutes',
        ],
    },
};

const ARCHETYPE_KEYS = Object.keys(DIRECTOR_ARCHETYPES);

/**
 * The director's own instructions. The worked example is load-bearing: it is the difference
 * between the model writing "a nice blue ocean" and "deep #123A5F / mid #1E6F9F / crest #DDF2FF,
 * banded hard at 0.35 and 0.70 of wave height".
 */
export function directorSystemPrompt(orientation) {
    const archetypeList = ARCHETYPE_KEYS
        .map((key) => `  - "${key}" — ${DIRECTOR_ARCHETYPES[key].label}`)
        .join('\n');

    return `You are the ART DIRECTOR and LEAD DESIGNER for a mobile web game studio. A player has given you a one-line game idea. Your job is to expand it into a complete, committed design brief that a builder can implement without asking a single question.

You are NOT writing marketing copy and you are NOT writing code. You are making decisions and stating them as values.

# THE ONE RULE: NUMBERS, NOT ADJECTIVES

Every choice must be concrete enough to type straight into code.
  BAD:  "a beautiful stylized ocean with nice lighting"
  GOOD: "cel-shaded ocean, 3 hard colour bands by wave height — deep #123A5F below 0.35, mid #1E6F9F to 0.70, crest #DDF2FF above; 4 summed sine waves, amplitudes 0.8/0.4/0.25/0.1, no smooth gradient anywhere"

  BAD:  "responsive controls that feel good"
  GOOD: "drag to steer, max turn rate 2.4 rad/s at low speed falling to 0.9 rad/s at top speed; throttle 0→max in 1.8s; drift engages above 70% speed and charges a boost worth 1.5x for 2s"

If a sentence in your brief contains no number, no hex colour, and no named technique, rewrite it.

# HARD CONSTRAINTS ON WHAT YOU CAN SPECIFY

- The game runs in a mobile WebView in ${orientation.toUpperCase()} orientation. Design for it.
- It must be playable with touch alone: drag and tap. No keyboard-only mechanics.
- Everything ships from one static folder. Any art is either drawn in code or pulled from free CC0 libraries at build time. Do not specify licensed assets, brands, or real-world IP.
- Pick a palette of exactly 5 hex colours and commit to it across world, entities, and HUD.
- Never specify: a flat single-colour background, a bare wireframe grid, default untextured primitives as the final look, or fog/bloom used to hide missing geometry.

# ARCHETYPE

Choose the single closest archetype from this list:
${archetypeList}

# OUTPUT

Return ONLY a JSON object with exactly these keys:

{
  "title": "short punchy game title",
  "archetype": "one of the keys above",
  "dimension": "2D" or "3D",
  "pitch": "one sentence describing the game as the player experiences it",
  "camera": "exact camera setup including distance, height, angle, and how it reacts to motion",
  "artDirection": {
    "style": "a named, committed visual style (e.g. 'anime cel-shaded', 'chunky voxel toy', 'neon vector minimalism') — never 'stylized' alone",
    "palette": { "deep": "#RRGGBB", "mid": "#RRGGBB", "light": "#RRGGBB", "accent": "#RRGGBB", "ink": "#RRGGBB" },
    "shading": "the exact shading model and its numbers (band count and thresholds, or lighting rig with intensities)",
    "outline": "outline/edge treatment and its width rule, or 'none' with a reason",
    "lighting": "key/fill/rim setup with intensities and colours",
    "sky": "sky, backdrop, or background treatment with colours",
    "banned": ["3-6 specific things that must NOT appear in this game's final look"]
  },
  "world": {
    "setting": "where this takes place, concretely",
    "layers": ["3-5 depth layers from foreground to background, each described"],
    "props": ["4-8 specific recurring props with rough dimensions or counts"],
    "density": "how much stuff is on screen at once, as a number or range"
  },
  "entities": [
    {
      "role": "player | enemy | obstacle | pickup | ally | boss",
      "name": "what it is called",
      "silhouette": "the readable shape, described so two entities can never be confused",
      "construction": "how it is built out of shapes/parts, specifically",
      "animation": "what moves on it and how, including timings"
    }
  ],
  "mechanics": [
    { "name": "mechanic name", "rule": "exactly what happens", "numbers": "the tuning values" }
  ],
  "gameFeel": "impact, weight, and responsiveness described in numbers (screen shake magnitude/duration, hitstop ms, easing, particle counts)",
  "hud": {
    "elements": ["each HUD element, where it sits, and what it shows"],
    "style": "how the HUD is drawn so it matches the art direction — never plain rectangular debug cards"
  },
  "audio": ["3-6 synthesized sounds with their character and when they fire"],
  "progression": {
    "winCondition": "exactly how a run is won, or how it ends",
    "loseCondition": "exactly how a run is lost",
    "curve": "how difficulty escalates, with numbers"
  }
}

Give 4-7 entities, 4-7 mechanics, 4-6 HUD elements. Be specific enough that two different builders reading this brief would produce recognisably the same game.`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Palette fallback — a neutral, cohesive 5-colour set used only when the model returns junk hexes. */
const FALLBACK_PALETTE = {
    deep: '#16213E',
    mid: '#2A6F97',
    light: '#E8F1F2',
    accent: '#F4A261',
    ink: '#0B1020',
};

function asString(value, fallback = '') {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback;
}

function asArray(value, { max = 12 } = {}) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter(Boolean)
        .slice(0, max);
}

/**
 * Normalize whatever the model returned into the shape renderDirectorBriefText() expects. The
 * builder prompt is assembled from this, so a missing key must degrade to a sane default rather
 * than printing "undefined" into the instructions the game is built from.
 */
export function normalizeDirectorBrief(raw, { userPrompt = '', orientation = 'portrait' } = {}) {
    if (!raw || typeof raw !== 'object') return null;

    const archetype = ARCHETYPE_KEYS.includes(String(raw.archetype || '').trim().toLowerCase())
        ? String(raw.archetype).trim().toLowerCase()
        : 'arena';

    const art = raw.artDirection && typeof raw.artDirection === 'object' ? raw.artDirection : {};
    const rawPalette = art.palette && typeof art.palette === 'object' ? art.palette : {};
    const palette = {};
    for (const [slot, fallback] of Object.entries(FALLBACK_PALETTE)) {
        const candidate = asString(rawPalette[slot]);
        palette[slot] = HEX.test(candidate) ? candidate.toUpperCase() : fallback;
    }

    const world = raw.world && typeof raw.world === 'object' ? raw.world : {};
    const hud = raw.hud && typeof raw.hud === 'object' ? raw.hud : {};
    const progression = raw.progression && typeof raw.progression === 'object' ? raw.progression : {};

    const entities = (Array.isArray(raw.entities) ? raw.entities : [])
        .filter((entity) => entity && typeof entity === 'object')
        .slice(0, 8)
        .map((entity) => ({
            role: asString(entity.role, 'entity'),
            name: asString(entity.name, 'unnamed'),
            silhouette: asString(entity.silhouette),
            construction: asString(entity.construction),
            animation: asString(entity.animation),
        }))
        .filter((entity) => entity.name !== 'unnamed' || entity.silhouette);

    const mechanics = (Array.isArray(raw.mechanics) ? raw.mechanics : [])
        .filter((mechanic) => mechanic && typeof mechanic === 'object')
        .slice(0, 8)
        .map((mechanic) => ({
            name: asString(mechanic.name, 'mechanic'),
            rule: asString(mechanic.rule),
            numbers: asString(mechanic.numbers),
        }))
        .filter((mechanic) => mechanic.rule);

    // A brief with no entities and no mechanics is not a brief — better to fall through to the
    // legacy prompt than to hand the builder an empty document that overrides its own instincts.
    if (entities.length === 0 && mechanics.length === 0) return null;

    return {
        title: asString(raw.title, 'Untitled Game'),
        archetype,
        dimension: String(raw.dimension || '').toUpperCase() === '3D' ? '3D' : '2D',
        orientation,
        sourceIdea: userPrompt,
        pitch: asString(raw.pitch),
        camera: asString(raw.camera, DIRECTOR_ARCHETYPES[archetype].camera),
        artDirection: {
            style: asString(art.style, 'bold flat-shaded arcade'),
            palette,
            shading: asString(art.shading),
            outline: asString(art.outline),
            lighting: asString(art.lighting),
            sky: asString(art.sky),
            banned: asArray(art.banned, { max: 8 }),
        },
        world: {
            setting: asString(world.setting),
            layers: asArray(world.layers, { max: 6 }),
            props: asArray(world.props, { max: 10 }),
            density: asString(world.density),
        },
        entities,
        mechanics,
        gameFeel: asString(raw.gameFeel),
        hud: {
            elements: asArray(hud.elements, { max: 8 }),
            style: asString(hud.style),
        },
        audio: asArray(raw.audio, { max: 8 }),
        progression: {
            winCondition: asString(progression.winCondition),
            loseCondition: asString(progression.loseCondition),
            curve: asString(progression.curve),
        },
    };
}

/**
 * Render the structured brief as the long-form design document the builder reads. Deterministic on
 * purpose: the LLM chooses the values, this function chooses the shape, so every game is briefed in
 * the same order with the same emphasis.
 */
export function renderDirectorBriefText(brief) {
    if (!brief) return '';
    const art = brief.artDirection;
    const palette = Object.entries(art.palette)
        .map(([slot, hex]) => `${slot} ${hex}`)
        .join(' · ');
    const skeleton = DIRECTOR_ARCHETYPES[brief.archetype] || DIRECTOR_ARCHETYPES.arena;

    const lines = [];
    const section = (heading, body) => {
        if (!body || (Array.isArray(body) && body.length === 0)) return;
        lines.push(`## ${heading}`);
        lines.push(Array.isArray(body) ? body.join('\n') : body);
        lines.push('');
    };

    lines.push(`# DESIGN BRIEF — ${brief.title}`);
    lines.push('');
    lines.push(`This brief is the specification. Implement what it says. Where it gives a number, use that number.`);
    lines.push(`Player's original idea: "${brief.sourceIdea}"`);
    lines.push('');

    section('PITCH', brief.pitch);
    section('FORMAT', [
        `- Archetype: ${skeleton.label}`,
        `- Dimension: ${brief.dimension}`,
        `- Orientation: ${brief.orientation}`,
        `- Camera: ${brief.camera}`,
    ]);

    section('ART DIRECTION — commit to this completely', [
        `- Style: ${art.style}`,
        `- Palette (use these exact hex values across world, entities, and HUD): ${palette}`,
        art.shading ? `- Shading: ${art.shading}` : '',
        art.outline ? `- Outlines / edges: ${art.outline}` : '',
        art.lighting ? `- Lighting: ${art.lighting}` : '',
        art.sky ? `- Sky / backdrop: ${art.sky}` : '',
    ].filter(Boolean));

    if (art.banned.length) {
        section('BANNED FROM THE FINAL LOOK', art.banned.map((item) => `- ${item}`));
    }

    section('WORLD', [
        brief.world.setting ? `- Setting: ${brief.world.setting}` : '',
        brief.world.density ? `- On-screen density: ${brief.world.density}` : '',
        brief.world.layers.length ? `- Depth layers:\n${brief.world.layers.map((l) => `    · ${l}`).join('\n')}` : '',
        brief.world.props.length ? `- Recurring props:\n${brief.world.props.map((p) => `    · ${p}`).join('\n')}` : '',
    ].filter(Boolean));

    if (brief.entities.length) {
        section('ENTITIES — every one of these must be visually distinct', brief.entities.map((entity) => {
            const parts = [`- **${entity.name}** (${entity.role})`];
            if (entity.silhouette) parts.push(`    · Silhouette: ${entity.silhouette}`);
            if (entity.construction) parts.push(`    · Built from: ${entity.construction}`);
            if (entity.animation) parts.push(`    · Animation: ${entity.animation}`);
            return parts.join('\n');
        }));
    }

    if (brief.mechanics.length) {
        section('MECHANICS — implement each one, with these values', brief.mechanics.map((mechanic) => {
            const parts = [`- **${mechanic.name}**: ${mechanic.rule}`];
            if (mechanic.numbers) parts.push(`    · Tuning: ${mechanic.numbers}`);
            return parts.join('\n');
        }));
    }

    // The archetype's required systems are printed verbatim from the skeleton, not from the model's
    // output, so the builder cannot end up with a "racer" that has no lap counting because the
    // director happened not to mention it.
    section(`REQUIRED SYSTEMS FOR A ${skeleton.label.toUpperCase()} — none of these are optional`,
        skeleton.systems.map((system) => `- ${system}`));

    section('GAME FEEL', brief.gameFeel);
    section('HUD', [
        brief.hud.elements.length ? brief.hud.elements.map((el) => `- ${el}`).join('\n') : '',
        brief.hud.style ? `- Drawing style: ${brief.hud.style}` : '',
    ].filter(Boolean));
    section('AUDIO (Web Audio, synthesized in code)', brief.audio.map((sound) => `- ${sound}`));
    section('WIN / LOSE / CURVE', [
        brief.progression.winCondition ? `- Win: ${brief.progression.winCondition}` : '',
        brief.progression.loseCondition ? `- Lose: ${brief.progression.loseCondition}` : '',
        brief.progression.curve ? `- Difficulty curve: ${brief.progression.curve}` : '',
    ].filter(Boolean));

    lines.push('## HOW THIS BRIEF IS JUDGED');
    lines.push('A screenshot of the running game will be graded against this brief by a visual critic.');
    lines.push('It will check that the palette above is actually on screen, that the named style is recognisable,');
    lines.push('that each entity is distinguishable by silhouette, and that nothing on the banned list appears.');
    lines.push('Untextured default primitives sitting on a flat plane fail that check automatically.');
    lines.push('');

    return lines.join('\n');
}

/**
 * Expand a raw user idea into a director brief. Returns null on any failure — every caller must
 * treat the brief as an enhancement, never a dependency.
 */
export async function buildDirectorBrief(userPrompt, { orientation = 'portrait', env = process.env } = {}) {
    const idea = String(userPrompt || '').trim();
    if (!idea) return null;
    if (String(env.GAMETOK_DIRECTOR_BRIEF || 'true').toLowerCase() === 'false') return null;

    const startedAt = Date.now();
    try {
        const raw = await callKimiJson({
            systemPrompt: directorSystemPrompt(orientation),
            messages: [{ role: 'user', content: `Game idea: "${idea}"\n\nWrite the full brief as JSON.` }],
            // The brief is the whole point of the call — it needs room to be long and specific.
            maxTokens: Number(env.GAMETOK_DIRECTOR_MAX_TOKENS || 6000),
            temperature: 0.7,
        }, env);

        const brief = normalizeDirectorBrief(raw, { userPrompt: idea, orientation });
        if (!brief) {
            console.warn('🎬 [Director] Brief rejected as too thin — falling back to the plain prompt.');
            return null;
        }

        const text = renderDirectorBriefText(brief);
        console.log(`🎬 [Director] "${brief.title}" — ${brief.archetype}/${brief.dimension}, ${brief.entities.length} entities, ${brief.mechanics.length} mechanics, ${text.length} chars (${Date.now() - startedAt}ms)`);
        return { brief, text };
    } catch (error) {
        console.warn(`🎬 [Director] Brief generation failed (${error?.message || error}) — falling back to the plain prompt.`);
        return null;
    }
}
