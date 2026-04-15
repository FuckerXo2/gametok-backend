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

function wantsCockpitDriving(promptText = '', rawSpec = {}) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary}`.toLowerCase();

  const hasVehicleIntent = includesAny(text, [
    'drive',
    'driving',
    'driver',
    'car',
    'vehicle',
    'steering',
    'wheel',
    'cockpit',
    'dashboard',
    'highway',
    'road',
    'night drive',
    'retro drive',
    'racing cockpit',
  ]);

  const hasFirstPersonIntent = includesAny(text, [
    'first-person',
    'first person',
    'fps',
    'cockpit',
    'dashboard',
    'behind the wheel',
  ]);

  return hasVehicleIntent && (hasFirstPersonIntent || includesAny(text, ['3d', 'three.js', 'threejs']));
}

function wantsStoryHorrorVignette(promptText = '', rawSpec = {}) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const atmosphere = safeText(rawSpec.atmosphere, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary} ${atmosphere}`.toLowerCase();

  const horrorIntent = includesAny(text, [
    'horror',
    'creepy',
    'eerie',
    'scary',
    'psychological',
    'haunted',
    'void',
    'watching',
    'unsettling',
    'dark story',
    'survey horror',
  ]);

  const vignetteIntent = includesAny(text, [
    'story',
    'interactive story',
    'dialogue',
    'question',
    'choice',
    'yes or no',
    'yes/no',
    'note',
    'message',
    'letter',
    'confession',
    'prompt',
    'single scene',
  ]);

  return horrorIntent && vignetteIntent;
}

function wantsSimulationToybox(promptText = '', rawSpec = {}) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const environmentType = safeText(rawSpec.environmentType, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary} ${environmentType}`.toLowerCase();

  const toyIntent = includesAny(text, [
    'toybox',
    'simulation',
    'sandbox',
    'alchemy',
    'fusion',
    'combine',
    'mix',
    'craft',
    'cook',
    'kitchen',
    'cauldron',
    'merge',
    'lab',
    'brewing',
    'recipe',
  ]);

  const systemIntent = includesAny(text, [
    'ingredients',
    'drag',
    'drop',
    'slots',
    'zones',
    'machine',
    'experiment',
    'stir',
    'reveal',
    'result',
  ]);

  return toyIntent && systemIntent;
}

function pickLane(promptText, rawSpec) {
  const genre = safeText(rawSpec.genre, '').toLowerCase();
  const summary = safeText(rawSpec.summary, '').toLowerCase();
  const cameraPerspective = safeText(rawSpec.cameraPerspective, '').toLowerCase();
  const environmentType = safeText(rawSpec.environmentType, '').toLowerCase();
  const preferredEngine = safeText(rawSpec.preferredEngine, '').toLowerCase();
  const text = `${promptText} ${genre} ${summary} ${cameraPerspective} ${environmentType} ${preferredEngine}`.toLowerCase();

  if (wantsCockpitDriving(text, rawSpec)) {
    return 'first_person_threejs';
  }

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

  if (wantsStoryHorrorVignette(text, rawSpec)) {
    return 'story_horror_vignette';
  }

  if (wantsSimulationToybox(text, rawSpec)) {
    return 'simulation_toybox';
  }

  if (includesAny(text, ['platformer', 'plumber', 'jump', 'coins', 'pixel'])) {
    return 'pixel_platformer';
  }

  if (includesAny(text, ['bunker', 'room', 'single room', 'cover shooter', 'fire button', 'soldier', 'joystick']) ||
    (includesAny(text, ['shooter', 'survival shooter']) && includesAny(text, ['fire button', 'joystick', 'single-room', 'single room', 'room']))) {
    return 'single_room_shooter';
  }

  if (includesAny(text, ['top-down', 'car', 'road', 'traffic', 'pistol', 'shooter'])) {
    return 'topdown_arcade';
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
      if (wantsCockpitDriving(promptText, spec)) {
        return {
          ...spec,
          runtimeLane: lane,
          preferredEngine: 'THREE_JS',
          preferredPerspective: 'FIRST_PERSON',
          genre: 'First-Person Arcade Driver',
          levelDesign: 'Linear Levels',
          summary: safeText(
            spec.summary,
            'A compact first-person arcade driving experience with a visible cockpit, strong steering controls, readable road depth, and bold speed feedback.'
          ),
          coreMechanics: uniqueList([
            'steer with a wheel or left-right control pad',
            'accelerate and brake with large on-screen pedals',
            'keep the vehicle centered through readable road hazards and pickups',
            'sell speed with horizon motion, lane lines, and cockpit feedback',
            ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
          ]).slice(0, 6),
          entities: {
            hero: safeText(baseEntities.hero, 'a drivable vehicle viewed from a first-person cockpit with dashboard instruments and steering controls'),
            enemy: safeText(baseEntities.enemy, 'traffic, barriers, rival vehicles, or road hazards threatening the driving line'),
            collectible: safeText(baseEntities.collectible, 'boost pickups, coins, or checkpoints floating ahead on the road'),
            obstacle: safeText(baseEntities.obstacle, 'road blocks, traffic cones, lane barricades, tunnel pillars, and dangerous turns'),
          },
          renderManifest: clampManifest(spec.renderManifest, [
            'drawCockpitHud',
            'drawSpeedEffects',
            'drawRoadHazardIndicator',
            'drawBoostPickupGlow',
            'drawDamageOverlay',
            'drawRearviewAccent',
          ]),
          playableSlice:
            'One strong cockpit-driving run with steering, throttle, brake, lane hazards, and a visible road stretching into the distance.',
          sceneBlueprint:
            'First-person road or synth runway with visible cockpit/dashboard foreground, repeated road markings, skyline silhouettes, roadside props, and readable hazards ahead.',
          controlModel:
            'Use a visible steering wheel or left-right steering pad for turning, plus large accelerate and brake controls. The player should feel like they are driving, not walking.',
          controlRig: 'cockpit_driver',
          spectacleFocus: [
            'dashboard glow',
            'speed streaks',
            'brake flashes',
            'horizon motion',
            'steering feedback',
          ],
          playabilityRules: [
            'This must feel like driving from a cockpit or dashboard perspective, not like a walking camera with car art pasted on top.',
            'The steering and pedal controls must be visible and central to the fantasy.',
            'Use clear road reads, lane cues, and horizon depth instead of a flat box with a car sprite.',
          ],
        visualTargets: [
          'cockpit foreground framing',
          'deep road perspective',
          'bold readable dashboard UI',
          'strong horizon silhouettes',
        ],
        firstFrameChecklist: [
          'visible cockpit or dashboard foreground',
          'road or runway stretching into depth',
          'steering plus accelerate/brake controls already on screen',
          'speed or dashboard HUD cue visible immediately',
        ],
        environmentScale: 'deep_forward_roadway',
          compositionTargets: [
            'show the road stretching far into the distance',
            'the cockpit or dashboard should anchor the foreground so the scene feels embodied',
            'use skyline, roadside props, and lane lines to sell motion and scale',
          ],
          promptEcho: promptText,
        };
      }

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
        controlRig: 'first_person_joystick',
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
        firstFrameChecklist: [
          'visible 3D floor and walls on first frame',
          'one readable landmark, enemy, or pickup immediately visible',
          'movement/look controls readable immediately',
          'hud or crosshair visible immediately',
        ],
        environmentScale: 'expansive_but_compact_3d',
        compositionTargets: [
          'show horizon depth or long corridor depth within the first second',
          'avoid boxed-in flat rooms unless the prompt explicitly wants claustrophobia',
          'use landmarks, vertical variation, and negative space so the world feels traversable',
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
        controlRig: 'prep_and_battle_button',
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
        firstFrameChecklist: [
          'prep grid or battlefield visible immediately',
          'at least one allied unit silhouette visible immediately',
          'at least one enemy or enemy gate visible immediately',
          'battle button or prep control visible immediately',
        ],
        environmentScale: 'wide_arena_stage',
        compositionTargets: [
          'the battlefield should feel like a stage, not a cramped box',
          'use long horizontal reads, distant gates, banners, or background structures to imply scale',
          'leave readable combat space between squads instead of stacking everything in one muddy cluster',
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
        sceneBlueprint: 'Small pixel character, crisp sky or tile background, grass/dirt platforms, coin arcs, and one or two enemy patterns per screen.',
        controlModel: 'Hold left/right touch zones to move and tap to jump.',
        controlRig: 'platformer_touch_zones',
        spectacleFocus: ['coin pops', 'jump dust', 'screen shake on stomp', 'sparkle pickups'],
        playabilityRules: [
          'Prefer tight platform spacing and readable jumps over giant map ambition.',
          'If the user asked for pixel art, treat that as a hard visual rule, not a loose retro suggestion.',
          'Keep all gameplay sprites, tiles, pickups, and HUD readable on a phone without mixing in glossy smooth art.',
        ],
        visualTargets: [
          '8-bit or 16-bit readability',
          'clean tile silhouettes',
          'simple enemy tells',
          'integer-aligned movement and camera framing',
          'nearest-neighbor sprite scaling with no blurry filtering',
          'self-generated pixel-looking sprites and tiles instead of smooth modern illustration',
        ],
        firstFrameChecklist: [
          'player sprite visible at readable size immediately',
          'terrain or platform silhouettes visible immediately',
          'at least one pickup or enemy visible immediately',
          'pixel-readable hud text visible immediately',
        ],
        environmentScale: 'readable_side_scroll_space',
        compositionTargets: [
          'avoid giant empty smooth skies with tiny sprites',
          'build stronger horizon layers and tile rhythm so the world feels authored',
          'the level should read wider than one trapped room even when the playable slice is compact',
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
        controlRig: 'single_tap_arcade',
        spectacleFocus: ['soft squash and stretch', 'cute impact puffs', 'parallax clouds'],
        playabilityRules: ['Keep obstacle count low and timing crisp; the fun should come from rhythm and feel.'],
        visualTargets: ['cute mascot silhouette', 'soft toy-like props', 'very readable spacing'],
        firstFrameChecklist: [
          'player mascot visible immediately',
          'first obstacle gap or hazard visible immediately',
          'sky depth layer or cloud band visible immediately',
          'score cue visible immediately',
        ],
        environmentScale: 'open_air_vertical_space',
        compositionTargets: [
          'the player should feel suspended in a wider sky space, not boxed into a tiny rectangle',
          'use horizon layers, cloud bands, or distant silhouettes for depth',
        ],
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
        controlRig: 'lane_swipe_runner',
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
        firstFrameChecklist: [
          'three readable lanes visible immediately',
          'runner visible at readable size immediately',
          'first obstacle or coin line visible immediately',
          'runner hud or distance/score cue visible immediately',
        ],
        environmentScale: 'deep_forward_runway',
        compositionTargets: [
          'the track should feel like it extends far into the distance',
          'use horizon silhouettes, repeated lane markers, and depth cues instead of a boxed playfield',
          'keep the runner zone readable but not claustrophobic',
        ],
        promptEcho: promptText,
      };

    case 'story_horror_vignette':
      return {
        ...spec,
        runtimeLane: lane,
        genre: safeText(spec.genre, 'Interactive Horror Vignette'),
        levelDesign: 'Single Screen Arena',
        preferredEngine: 'DOM_UI',
        cameraPerspective: 'SIDE_VIEW',
        summary: safeText(
          spec.summary,
          'A minimal interactive horror vignette built around one unsettling prompt, a few deliberate choices, and strong typography-driven atmosphere.'
        ),
        coreMechanics: uniqueList([
          'present one unsettling prompt or reveal',
          'offer one or two high-stakes choices',
          'advance the scene through taps, swipes, or button presses',
          'use atmosphere, timing, and typography as the main dramatic tools',
          ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
        ]).slice(0, 6),
        entities: {
          hero: safeText(baseEntities.hero, 'the player as an unseen participant responding to a disturbing message or presence'),
          enemy: safeText(baseEntities.enemy, 'an implied watcher, message, memory, or unseen force creating dread'),
          collectible: safeText(baseEntities.collectible, 'fragments of text, clues, or symbolic reveals'),
          obstacle: safeText(baseEntities.obstacle, 'choice pressure, ominous prompts, and psychological escalation'),
        },
        renderManifest: clampManifest(spec.renderManifest, [
          'drawQuestionCard',
          'drawChoiceButtons',
          'drawVignetteOverlay',
          'drawTextReveal',
          'drawGlitchAccent',
        ]),
        playableSlice:
          'A single mood-heavy scene with one strong prompt, one or two deliberate choices, and a clear reveal or escalation.',
        sceneBlueprint:
          'Sparse centered composition, dark or restrained background, focused text block, minimal choice UI, and one atmospheric motion layer such as noise, vignette, flicker, or a reveal panel.',
        controlModel:
          'Tap clearly labeled choices or continue prompts. If swipe is used, it should be explicitly taught and tied to the scene reveal.',
        controlRig: 'binary_choice_story',
        spectacleFocus: [
          'type reveal timing',
          'ambient flicker',
          'choice hover/tap response',
          'vignette or grain',
          'single strong reveal transition',
        ],
        playabilityRules: [
          'Minimal horror should feel intentionally composed, not like an empty black screen with forgotten UI.',
          'Typography, spacing, and one interaction gimmick should carry the experience.',
          'Keep the interaction count low, but make every state change legible and dramatic.',
        ],
        visualTargets: [
          'strong centered focal text',
          'designed darkness or restrained palette',
          'readable choice buttons',
          'subtle atmospheric texture instead of noisy clutter',
        ],
        firstFrameChecklist: [
          'main prompt or focal text visible immediately',
          'choice or continue controls visible immediately',
          'atmospheric background treatment visible immediately',
          'one strong focal panel, note, or card visible immediately',
        ],
        environmentScale: 'focused_negative_space_stage',
        compositionTargets: [
          'use negative space on purpose so the scene feels ominous, not unfinished',
          'anchor the eye with one strong text block, card, note, or reveal panel',
          'if the scene is dark, support it with vignette, texture, glow, or depth cues so it feels designed',
        ],
        promptEcho: promptText,
      };

    case 'simulation_toybox':
      return {
        ...spec,
        runtimeLane: lane,
        genre: safeText(spec.genre, 'Interactive Simulation Toybox'),
        levelDesign: 'Single Screen Arena',
        preferredEngine: 'DOM_UI',
        cameraPerspective: 'TOP_DOWN',
        summary: safeText(
          spec.summary,
          'A tactile toybox simulation with a central machine or vessel, multiple interaction zones, draggable ingredients or tools, and a satisfying reveal loop.'
        ),
        coreMechanics: uniqueList([
          'drag or tap ingredients/tools into a central interaction zone',
          'track a small recipe, fusion, or state-building system',
          'trigger a combine, cook, stir, or reveal phase',
          'show a satisfying result card or transformation',
          ...(Array.isArray(spec.coreMechanics) ? spec.coreMechanics : []),
        ]).slice(0, 6),
        entities: {
          hero: safeText(baseEntities.hero, 'the player as an unseen maker operating a playful machine, kitchen, lab, or cauldron'),
          enemy: safeText(baseEntities.enemy, 'time pressure, wrong combinations, unstable reactions, or playful system chaos'),
          collectible: safeText(baseEntities.collectible, 'ingredients, tools, fragments, reagents, or unlockable fusion parts'),
          obstacle: safeText(baseEntities.obstacle, 'limited slots, recipe constraints, failed mixes, or hazard states'),
        },
        renderManifest: clampManifest(spec.renderManifest, [
          'drawWorkbench',
          'drawIngredientCard',
          'drawMixingVessel',
          'drawResultCard',
          'drawBubbleFx',
          'drawProgressIndicator',
        ]),
        playableSlice:
          'A single rich toybox scene with a pantry or source area, a central combine zone, a progress/reaction phase, and a reveal result.',
        sceneBlueprint:
          'One central machine, pot, altar, desk, or device anchored in the middle, ingredient/tool shelf or tray on one edge, clear action button, and a celebratory result modal or reveal card.',
        controlModel:
          'Use drag-and-drop or large tap targets across a few clear zones: source shelf, central combine area, and reveal/result controls.',
        controlRig: 'drag_drop_toybox',
        spectacleFocus: [
          'ingredient pops',
          'reaction bubbles or sparks',
          'mix progress feedback',
          'result reveal flourish',
          'delightful hover/tap motion',
        ],
        playabilityRules: [
          'This lane should feel like a toy with multiple purposeful interaction zones, not a flat menu with one button.',
          'Keep the system count small but make each zone clear and satisfying.',
          'A central object plus a source shelf plus a reveal state is usually enough to feel rich.',
        ],
        visualTargets: [
          'strong central machine or vessel silhouette',
          'clear shelf/tray/source area',
          'multi-zone layout that reads instantly',
          'playful simulation polish without visual chaos',
        ],
        firstFrameChecklist: [
          'central machine or vessel visible immediately',
          'source shelf, tray, or ingredient area visible immediately',
          'combine or readiness control visible immediately',
          'one reaction or result affordance visible immediately',
        ],
        environmentScale: 'centerpiece_workbench_stage',
        compositionTargets: [
          'anchor the experience around one central object that everything feeds into',
          'separate source, interaction, and result zones clearly so the system feels understandable',
          'the screen should feel like a designed workstation or play table, not floating controls over empty space',
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
        controlRig: 'drag_move_arcade',
        spectacleFocus: ['skid shadows', 'hit sparks', 'pickup flashes'],
        playabilityRules: ['Use a compact scene and clear road geometry rather than sprawling maps.'],
        visualTargets: ['toy-car shapes', 'high-contrast HUD', 'flat vector arcade styling'],
        firstFrameChecklist: [
          'player or vehicle visible immediately',
          'map surface or road geometry visible immediately',
          'first threat or pickup visible immediately',
          'hud cue visible immediately',
        ],
        environmentScale: 'wide_board_view',
        compositionTargets: [
          'show enough map surface that the action feels situated in a real space',
          'avoid making the world look like tiny props floating in a boxed frame',
        ],
        promptEcho: promptText,
      };

    case 'single_room_shooter':
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'A single-room combat vignette with one controllable hero, a few enemies, and one strong fire-button loop.',
        sceneBlueprint: 'Static room backdrop, compact combat area, clear cover pieces, and direct button-driven attacks.',
        controlModel: 'Tap or hold a large on-screen fire button plus a movement zone or drag control.',
        controlRig: 'move_and_fire',
        spectacleFocus: ['muzzle flashes', 'hit markers', 'shell sparks'],
        playabilityRules: ['Focus on a tight combat room and strong feedback rather than a sprawling shooter campaign.'],
        visualTargets: ['clear hero silhouette', 'room props with depth', 'short readable effects'],
        firstFrameChecklist: [
          'hero visible immediately',
          'room backdrop and cover pieces visible immediately',
          'fire control and movement control visible immediately',
          'one enemy or threat visible immediately',
        ],
        environmentScale: 'contained_but_designed_room',
        compositionTargets: [
          'if the game is room-based, make the room feel intentionally staged, not accidentally cramped',
          'use foreground, midground, and back wall detail so the room has depth',
        ],
        promptEcho: promptText,
      };

    default:
      return {
        ...spec,
        runtimeLane: lane,
        playableSlice: 'One self-contained mobile arcade scene with a clear first interaction and a short satisfying core loop.',
        sceneBlueprint: 'A compact, readable stage with one hero, one main threat type, and a strong score loop.',
        controlModel: 'Use one-gesture mobile input with immediate feedback.',
        controlRig: 'single_gesture',
        spectacleFocus: ['hit flashes', 'particles', 'score pops'],
        playabilityRules: ['Prefer one polished gameplay loop over sprawling feature lists.'],
        visualTargets: ['clean readable silhouettes', 'strong contrast', 'responsive feedback'],
        firstFrameChecklist: [
          'main playable object visible immediately',
          'main threat or target visible immediately',
          'clear background contrast visible immediately',
          'score or interaction cue visible immediately',
        ],
        environmentScale: 'scene_with_breathing_room',
        compositionTargets: [
          'do not trap the entire game inside a tiny boxed composition unless the prompt explicitly wants that',
          'give the scene breathing room, depth layers, and a clear focal area',
        ],
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
    firstFrameChecklist: Array.isArray(rawSpec.firstFrameChecklist) ? rawSpec.firstFrameChecklist : [],
  };

  const lane = pickLane(promptText, baseSpec);
  return buildLaneSpec(lane, baseSpec, promptText);
}
