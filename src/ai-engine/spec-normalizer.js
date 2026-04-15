function clampManifest(manifest, fallback) {
  const source = Array.isArray(manifest) ? manifest : fallback;
  const clean = [];
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || clean.includes(trimmed)) continue;
    clean.push(trimmed);
  }
  return clean.slice(0, 8);
}

function safeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))];
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function wantsStrictPixelArt(promptText = '', rawSpec = {}) {
  const visualStyle = safeText(rawSpec.visualStyle, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const text = `${promptText} ${visualStyle} ${summary} ${genre}`.toLowerCase();

  return includesAny(text, [
    'pixel',
    'pixel art',
    'pixel-art',
    '8-bit',
    '16-bit',
    'retro sprite',
    'sprite sheet',
    'tileset',
  ]);
}

export function wantsFirstPerson3D(promptText = '', rawSpec = {}) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const cameraPerspective = safeText(rawSpec.cameraPerspective, '').toLowerCase();
  const preferredEngine = safeText(rawSpec.preferredEngine, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary}`.toLowerCase();

  const hasPerspectiveIntent = includesAny(text, [
    'first-person',
    'first person',
    'fps',
    'three.js',
    'threejs',
    '3d',
    'voxel',
    'block world',
  ]);

  const hasDirect3DIntent =
    includesAny(promptText.toLowerCase(), ['first-person', 'first person', 'fps']) &&
    includesAny(promptText.toLowerCase(), ['3d', 'three.js', 'threejs']);

  const hasSpec3DIntent = includesAny(`${cameraPerspective} ${preferredEngine}`, [
    'first_person',
    'first-person',
    'three_js',
    'three.js',
    'threejs',
  ]);

  const hasWorldIntent = includesAny(text, [
    'dungeon',
    'maze',
    'corridor',
    'zombie',
    'wave',
    'waves',
    'survival',
    'first-person survival',
    'survival shooter',
    'shooter',
    'crawler',
    'explore',
    'arena',
    'wasteland',
  ]);

  return hasDirect3DIntent || hasSpec3DIntent || (hasPerspectiveIntent && hasWorldIntent);
}

function pickLane(promptText, rawSpec) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const cameraPerspective = safeText(rawSpec.cameraPerspective, '').toLowerCase();
  const environmentType = safeText(rawSpec.environmentType, '').toLowerCase();
  const preferredEngine = safeText(rawSpec.preferredEngine, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary} ${cameraPerspective} ${environmentType} ${preferredEngine}`.toLowerCase();

  if (wantsFirstPerson3D(text, rawSpec)) {
    return 'first_person_threejs';
  }

  if (
    includesAny(text, ['auto-battler', 'autobattler', 'knight', 'archer', 'wizard', 'goblin', 'battle grid']) ||
    (includesAny(text, ['battle']) && includesAny(text, ['grid', 'strategy']))
  ) {
    return 'auto_battler_arena';
  }

  if (includesAny(text, ['flappy', 'bird', 'penguin', 'endless flyer', 'flying']) && includesAny(text, ['jump', 'tap', 'pipe', 'cloud'])) {
    return 'endless_flyer';
  }

  if (
    includesAny(text, ['subway surfers', 'subway', 'endless runner', 'runner', 'temple run']) &&
    includesAny(text, ['lane', 'lanes', 'swipe', 'run', 'running', 'train', 'track', 'coin', 'coins', 'endless'])
  ) {
    return 'endless_runner_vertical';
  }

  if (includesAny(text, ['platformer', 'plumber', 'jump', 'coins', 'pixel'])) {
    return 'pixel_platformer';
  }

  if (includesAny(text, ['top-down', 'car', 'road', 'traffic', 'pistol', 'shooter'])) {
    return 'topdown_arcade';
  }

  if (includesAny(text, ['bunker', 'room', 'single room', 'cover shooter', 'fire button', 'soldier'])) {
    return 'single_room_shooter';
  }

  return 'arcade_canvas';
}

export function inferRuntimeLaneFromPrompt(promptText = '') {
  return pickLane(promptText, {});
}

function buildLaneSpec(lane, spec, promptText) {
  const baseEntities = spec.entities || {};
  const strictPixelArt = wantsStrictPixelArt(promptText, spec);

  switch (lane) {
    case 'first_person_threejs':
      return {
        ...spec,
        runtimeLane: lane,
        preferredEngine: 'THREE_JS',
        preferredPerspective: 'FIRST_PERSON',
        genre: 'First-Person 3D Adventure',
        levelDesign: 'Linear Levels',
        summary: safeText(
          spec.summary,
          'A compact mobile first-person 3D adventure built with Three.js, featuring touch controls, readable combat, loot, and a clear objective.'
        ),
        coreMechanics: uniqueList([
          'virtual joystick movement',
          'drag-to-look first-person camera',
          'tap attack or interact',
          'explore compact 3D spaces with readable landmarks',
          ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
        ]).slice(0, 6),
        entities: {
          hero: safeText(baseEntities.hero, 'a first-person adventurer represented through weapon, hands, HUD, and camera motion'),
          enemy: safeText(baseEntities.enemy, 'skeletons, monsters, or hostile drones roaming a compact 3D environment'),
          collectible: safeText(baseEntities.collectible, 'gold, keys, potions, or glowing loot pickups'),
          obstacle: safeText(baseEntities.obstacle, 'stone walls, doors, columns, hazards, and simple environmental props'),
        },
        renderManifest: clampManifest(spec.renderManifest, [
          'drawWeaponHud',
          'drawEnemyIndicator',
          'drawPickupGlow',
          'drawHitFlash',
          'drawCrosshair',
          'drawDamageOverlay',
        ]),
        playableSlice:
          'One compact first-person 3D level with a real sense of depth, a few enemies, pickups, and a clear exit or survive objective.',
        sceneBlueprint:
          'Three.js corridor, dungeon, or arena space with floor, walls, props, enemy patrols, pickup placement, and a visible goal landmark.',
        controlModel:
          'Left-side virtual joystick moves the player, right-side drag rotates the camera, and a tap button attacks or interacts.',
        spectacleFocus: [
          'torch glow or atmospheric lighting',
          'weapon bob and hit flash',
          'pickup glows',
          'enemy impact feedback',
          'subtle camera kick',
        ],
        playabilityRules: [
          'This must remain first-person and truly 3D. Do not downgrade to a top-down maze or flat 2D map.',
          'Use a compact, highly readable world instead of pretending to be an endless open world.',
          'Prefer simple low-poly or blocky geometry and clean lighting over complex asset needs.',
        ],
        visualTargets: [
          'clear perspective depth',
          'chunky readable low-poly forms',
          'strong landmark lighting',
          'mobile-friendly first-person HUD',
        ],
        promptEcho: promptText,
      };

    case 'auto_battler_arena':
      return {
        ...spec,
        runtimeLane: lane,
        genre: 'Auto-Battler Arena',
        levelDesign: 'Single Screen Arena',
        summary: safeText(
          spec.summary,
          'A single-screen fantasy auto-battler where the player arranges a small squad on a prep grid, taps BATTLE, and watches them crash into escalating goblin waves.'
        ),
        coreMechanics: uniqueList([
          'drag-and-drop unit placement on a prep grid',
          'tap BATTLE to begin the wave',
          'units auto-attack the nearest threat',
          'waves escalate spectacle through hit flashes, knockback, and spell bursts',
          ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
        ]).slice(0, 6),
        entities: {
          hero: safeText(baseEntities.hero, 'a chunky fantasy roster of heavy knights, rapid-fire archers, and area-of-effect wizards'),
          enemy: safeText(baseEntities.enemy, 'small green goblins with exaggerated silhouettes, crude weapons, and comedic knockback poses'),
          collectible: safeText(baseEntities.collectible, 'gold coins and mana shards dropped between waves'),
          obstacle: safeText(baseEntities.obstacle, 'banners, barricades, and impact craters around the battlefield'),
        },
        renderManifest: clampManifest(spec.renderManifest, [
          'drawKnight',
          'drawArcher',
          'drawWizard',
          'drawGoblin',
          'drawExplosion',
          'drawDamageNumber',
        ]),
        playableSlice:
          'One preparation grid feeding into a single-screen battlefield with staged goblin waves and escalating audiovisual chaos.',
        sceneBlueprint:
          'The player drops three unit classes into a short prep phase, taps BATTLE, then watches autonomous combat play out in one readable arena.',
        controlModel:
          'Drag units into open slots during preparation. Tap the BATTLE button to start the wave. After victory or defeat, reset back to prep.',
        spectacleFocus: [
          'floating damage numbers',
          'broad weapon trails',
          'fireball bursts',
          'critical-hit screenshake',
          'dust clouds and corpse decals',
        ],
        playabilityRules: [
          'Sell the fantasy of a giant war using staged wave spawns and layered effects instead of simulating a true hundred-body ragdoll crowd.',
          'Use squash, knockback arcs, spin-outs, and hit flashes instead of expensive full ragdoll chains.',
          'Keep the battlefield readable: distinct lanes, chunky silhouettes, and a clear BATTLE button.',
        ],
        visualTargets: [
          'chunky fantasy toy-soldier silhouettes',
          'bright attack trails',
          'clear class color coding',
          'goblin crowds that feel numerous without becoming visual mush',
        ],
        promptEcho: promptText,
      };

    case 'pixel_platformer':
      return {
        ...spec,
        runtimeLane: lane,
        preferredEngine: 'CANVAS_2D',
        visualStyle: strictPixelArt ? 'PIXEL_RETRO' : safeText(spec.visualStyle, 'PIXEL_RETRO'),
        pixelArtStrict: strictPixelArt,
        playableSlice: 'A compact vertical or side-scrolling pixel platformer with a few platform modules, enemy hops, and coin routes.',
        sceneBlueprint: 'Small pixel character, low-resolution sky or tile background, crisp grass/dirt platforms, coin arcs, and one or two enemy patterns per screen.',
        controlModel: 'Hold left/right touch zones to move and tap to jump.',
        spectacleFocus: ['coin pops', 'jump dust', 'screen shake on stomp', 'sparkle pickups'],
        playabilityRules: [
          'Prefer tight platform spacing and readable jumps over giant map ambition.',
          'If the user asked for pixel art, treat that as a hard visual rule, not a loose retro suggestion.',
          'Keep all gameplay sprites, tiles, pickups, and HUD readable on a phone without mixing in glossy smooth art.',
          'Render the game at a deliberately low internal resolution and upscale it crisply, instead of drawing a smooth full-resolution scene.',
        ],
        visualTargets: [
          '8-bit or 16-bit readability',
          'clean tile silhouettes',
          'simple enemy tells',
          'integer-aligned movement and camera framing',
          'nearest-neighbor sprite scaling with no blurry filtering',
          'low-resolution internal canvas upscaled sharply to the phone screen',
        ],
        promptEcho: promptText,
      };

    case 'endless_flyer':
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'A single-tap endless flyer with a mascot, drifting clouds, obstacle gaps, and a highly readable score chase.',
        sceneBlueprint: 'One character, a looping sky backdrop, repeating obstacle modules, and floating score text.',
        controlModel: 'Tap anywhere to flap or hop upward.',
        spectacleFocus: ['soft squash and stretch', 'cute impact puffs', 'parallax clouds'],
        playabilityRules: ['Keep obstacle count low and timing crisp; the fun should come from rhythm and feel.'],
        visualTargets: ['cute mascot silhouette', 'soft toy-like props', 'very readable spacing'],
        promptEcho: promptText,
      };

    case 'endless_runner_vertical':
      return {
        ...spec,
        runtimeLane: lane,
        genre: safeText(spec.genre, 'Endless Lane Runner'),
        levelDesign: 'Endless Run',
        cameraPerspective: 'THIRD_PERSON',
        preferredEngine: 'CANVAS_2D',
        summary: safeText(
          spec.summary,
          'A fast vertical endless runner where the player dashes forward through three lanes, swipes to dodge, jump, and slide, and chases high scores through coin lines and obstacle patterns.'
        ),
        coreMechanics: uniqueList([
          'constant forward movement',
          'three-lane switching',
          'swipe up to jump',
          'swipe down to slide',
          'collect coin lines',
          'dodge trains, barricades, and obstacles',
          ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
        ]).slice(0, 6),
        entities: {
          hero: safeText(baseEntities.hero, 'a runner sprinting away from danger down a bright multi-lane track'),
          enemy: safeText(baseEntities.enemy, 'oncoming trains, barricades, or track obstacles that punish bad lane choices'),
          collectible: safeText(baseEntities.collectible, 'coins lined up in readable arcs and rows'),
          obstacle: safeText(baseEntities.obstacle, 'barriers, trains, signs, and low slide-under hazards'),
        },
        renderManifest: clampManifest(spec.renderManifest, [
          'drawRunner',
          'drawTrain',
          'drawBarrier',
          'drawCoin',
          'drawDustTrail',
          'drawLaneMarkers',
        ]),
        playableSlice:
          'A vertical portrait endless runner with three clear lanes, constant forward speed, readable coins, and escalating obstacle cadence.',
        sceneBlueprint:
          'Portrait-oriented runner track moving toward the player with three vertical lanes, lane markers, trains or barricades ahead, and coin lines guiding the best path.',
        controlModel:
          'Swipe left/right to change lanes, swipe up to jump, swipe down to slide. The runner should always move forward automatically.',
        spectacleFocus: [
          'speed streaks',
          'coin pop sparkles',
          'near-miss flashes',
          'dust trails',
          'lane-switch swooshes',
        ],
        playabilityRules: [
          'This must read as a portrait endless runner, not a side-scrolling platformer.',
          'The runner should move toward the top of the screen or the world should scroll downward toward the player to preserve the Subway Surfers feel.',
          'Always keep three clear readable lanes and obstacles that occupy lane space cleanly.',
          'Never make the primary movement horizontal unless the prompt explicitly asks for that.',
        ],
        visualTargets: [
          'strong lane readability',
          'portrait runner composition',
          'clear obstacle telegraphing',
          'fast arcadey motion',
        ],
        promptEcho: promptText,
      };

    case 'topdown_arcade':
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'A single-screen top-down arcade scene with simple roads, clear traffic or enemies, and a compact HUD.',
        sceneBlueprint: 'Road lane markings, chunky vehicles, readable pickups, and one-touch weapon or dodge interactions.',
        controlModel: 'Drag to steer or move in a top-down lane space.',
        spectacleFocus: ['skid shadows', 'hit sparks', 'pickup flashes'],
        playabilityRules: ['Use a compact scene and clear road geometry rather than sprawling maps.'],
        visualTargets: ['toy-car shapes', 'high-contrast HUD', 'flat vector arcade styling'],
        promptEcho: promptText,
      };

    case 'single_room_shooter':
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'A single-room combat vignette with one controllable hero, a few enemies, and one strong fire-button loop.',
        sceneBlueprint: 'Static room backdrop, compact combat area, clear cover pieces, and direct button-driven attacks.',
        controlModel: 'Tap or hold a large on-screen fire button plus a movement zone or drag control.',
        spectacleFocus: ['muzzle flashes', 'hit markers', 'shell sparks'],
        playabilityRules: ['Focus on a tight combat room and strong feedback rather than a sprawling shooter campaign.'],
        visualTargets: ['clear hero silhouette', 'room props with depth', 'short readable effects'],
        promptEcho: promptText,
      };

    default:
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'One self-contained mobile arcade scene with a clear first interaction and a short satisfying core loop.',
        sceneBlueprint: 'A compact, readable stage with one hero, one main threat type, and a strong score loop.',
        controlModel: 'Use one-gesture mobile input with immediate feedback.',
        spectacleFocus: ['hit flashes', 'particles', 'score pops'],
        playabilityRules: ['Prefer one polished gameplay loop over sprawling feature lists.'],
        visualTargets: ['clean readable silhouettes', 'strong contrast', 'responsive feedback'],
        promptEcho: promptText,
      };
  }
}

export function normalizeDreamSpec(rawSpec, userPrompt = '') {
  const promptText = safeText(userPrompt, '');
  const baseSpec = {
    ...rawSpec,
    title: safeText(rawSpec.title, 'DreamStream Game'),
    genre: safeText(rawSpec.genre, 'Arcade'),
    summary: safeText(rawSpec.summary, 'A compact mobile arcade game with one satisfying core loop.'),
    levelDesign: safeText(rawSpec.levelDesign, 'Single Screen Arena'),
    visualStyle: safeText(rawSpec.visualStyle, 'FLAT_VECTOR'),
    atmosphere: safeText(rawSpec.atmosphere, 'Bright & Cheerful'),
    backgroundColor: safeText(rawSpec.backgroundColor, '#1d2433'),
    accentColor: safeText(rawSpec.accentColor, '#f7c948'),
    cameraPerspective: safeText(rawSpec.cameraPerspective, 'AUTO'),
    environmentType: safeText(rawSpec.environmentType, 'ARENA'),
    preferredEngine: safeText(rawSpec.preferredEngine, 'AUTO'),
    coreMechanics: Array.isArray(rawSpec.coreMechanics) ? rawSpec.coreMechanics : [],
    entities: rawSpec.entities || {},
    renderManifest: clampManifest(rawSpec.renderManifest, ['drawHero', 'drawEnemy', 'drawObstacle', 'drawProjectile']),
  };

  const lane = pickLane(promptText, baseSpec);
  return buildLaneSpec(lane, baseSpec, promptText);
}
