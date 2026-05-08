function safeText(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function includesAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

export const CAPABILITY_GRAPH = Object.freeze({
  chase_camera_driver: {
    label: 'Chase Camera Driver',
    family: 'camera_control',
    requires: ['visible_player_vehicle', 'road_depth_world', 'touch_driving_controls'],
    promptRules: [
      'Render a visible vehicle/player body in the lower third with a camera following from behind.',
      'Acceleration, braking, steering, and drift/boost must visibly change vehicle motion.',
      'The road or route must show depth, lane lines, horizon cues, and hazards within the first frame.',
    ],
    firstFrame: ['visible vehicle', 'road depth', 'driving controls', 'distance/speed HUD'],
  },
  visible_player_vehicle: {
    label: 'Visible Player Body Or Vehicle',
    family: 'embodiment',
    promptRules: [
      'Do not make the player an invisible camera or tiny marker.',
      'Build the player/vehicle as grouped meshes, sprites, or a same-origin model with readable silhouette.',
    ],
    firstFrame: ['player body or vehicle visible immediately'],
  },
  road_depth_world: {
    label: 'Road/Route Depth World',
    family: 'world',
    promptRules: [
      'Use lane markings, horizon fade, roadside landmarks, traffic, checkpoints, or barriers to sell forward depth.',
      'Avoid a flat single-screen road rectangle unless the prompt explicitly asks for a toy diagram.',
    ],
    firstFrame: ['horizon or route depth visible', 'at least one hazard or checkpoint visible'],
  },
  touch_driving_controls: {
    label: 'Touch Driving Controls',
    family: 'input',
    promptRules: [
      'Show large mobile controls for steering plus ACCEL/GAS, BRAKE, and optional DRIFT/BOOST.',
      'Controls must be clamped into safe mobile bounds and large enough for thumbs.',
    ],
    firstFrame: ['steer/accel/brake controls visible'],
  },
  speed_hud: {
    label: 'Speed/Distance HUD',
    family: 'hud',
    promptRules: [
      'Show speed, distance, timer, lap, or checkpoint progress as diegetic or arcade HUD.',
    ],
    firstFrame: ['speed/distance HUD visible'],
  },
  projectile_ballistics: {
    label: 'Projectile Ballistics',
    family: 'physics',
    promptRules: [
      'Implement angle and power controls that affect projectile trajectory through gravity.',
      'Draw the predicted arc before firing when possible.',
      'Resolve terrain, enemy, and projectile collisions with visible impact feedback.',
    ],
    firstFrame: ['angle control', 'power control', 'projectile arc or aim cue'],
  },
  terrain_profile: {
    label: 'Terrain Profile',
    family: 'world',
    promptRules: [
      'Use a real terrain silhouette or heightfield that affects placement, aiming, and collision.',
      'Terrain should be visually readable, not just a flat line.',
    ],
    firstFrame: ['terrain silhouette visible'],
  },
  weapon_cards: {
    label: 'Weapon Cards',
    family: 'meta_ui',
    promptRules: [
      'Represent weapon choices as readable cards with names, counts/costs, and selected state.',
      'Changing selected weapon must alter projectile behavior or impact.',
    ],
    firstFrame: ['weapon cards or selector visible'],
  },
  turn_based_duel: {
    label: 'Turn-Based Duel',
    family: 'rules',
    promptRules: [
      'Maintain explicit player/enemy turns and scoreboard/state text.',
      'Only the active side should fire or act; transition turns after the shot resolves.',
    ],
    firstFrame: ['player and enemy positions visible', 'turn label visible'],
  },
  rope_path_puzzle: {
    label: 'Rope/Path Drawing Puzzle',
    family: 'puzzle_input',
    promptRules: [
      'Let the player draw, drag, or bend a path/rope/arm through obstacles toward a goal.',
      'The path must collide with blockers or be constrained by them.',
    ],
    firstFrame: ['start character visible', 'goal visible', 'obstacles visible'],
  },
  obstacle_layout: {
    label: 'Obstacle Layout',
    family: 'puzzle_world',
    promptRules: [
      'Stage obstacles as a level layout with clear gaps, blockers, and solution space.',
      'Avoid random scattered rectangles; the layout should look authored.',
    ],
    firstFrame: ['authored obstacle arrangement visible'],
  },
  level_title_card: {
    label: 'Level Title Card',
    family: 'progression',
    promptRules: [
      'Show level number/title and one short objective line without covering gameplay-critical objects.',
    ],
    firstFrame: ['level title and objective visible'],
  },
  isometric_actor_world: {
    label: 'Isometric Actor World',
    family: 'camera_world',
    promptRules: [
      'Use isometric or 2.5D staging with characters, props, ground tiles, and depth-sorted objects.',
      'The camera should imply a larger world through off-screen continuation, landmarks, and prop scale.',
    ],
    firstFrame: ['isometric ground visible', 'actor group visible', 'depth props visible'],
  },
  survival_stats: {
    label: 'Survival Stats',
    family: 'systems',
    promptRules: [
      'Track survival meters such as health, hunger, fire, stamina, sanity, thirst, or day count.',
      'Stats must change because of player actions or time pressure.',
    ],
    firstFrame: ['multiple survival meters visible'],
  },
  inventory_hotbar: {
    label: 'Inventory Hotbar',
    family: 'meta_ui',
    promptRules: [
      'Provide 3-5 item slots with selected item state, item icons, and a reason to use the selected item.',
    ],
    firstFrame: ['hotbar visible in safe lower area'],
  },
  resource_node: {
    label: 'Resource Nodes',
    family: 'world_system',
    promptRules: [
      'Place resource nodes or interactable props that can be harvested, collected, repaired, or upgraded.',
      'Use arrows, glows, or proximity cues to make the next interaction obvious.',
    ],
    firstFrame: ['resource or objective marker visible'],
  },
  creator_tool_ui: {
    label: 'Creator Tool UI',
    family: 'tool',
    promptRules: [
      'Build a real tool surface with tabs, palettes, undo/redo, save/new, and a clear editable target.',
      'The tool must be usable immediately, not just decorative.',
    ],
    firstFrame: ['editable target visible', 'tool tabs or palette visible'],
  },
  brush_canvas: {
    label: 'Brush Canvas',
    family: 'tool',
    promptRules: [
      'Implement pointer drawing/painting with selected color/brush size and clear/reset behavior.',
      'Drawing should persist on the canvas until cleared or sold/saved.',
    ],
    firstFrame: ['blank drawing surface visible', 'selected brush/color visible'],
  },
  decorate_surface: {
    label: 'Decorate Surface',
    family: 'tool',
    promptRules: [
      'Show a large target surface such as nail, canvas, outfit, room, car, cake, or phone case.',
      'User selections must visibly alter that target surface.',
    ],
    firstFrame: ['large decorate target visible'],
  },
  palette_unlocks: {
    label: 'Palette Unlocks',
    family: 'economy',
    promptRules: [
      'Show locked and unlocked cosmetics/colors/patterns with clear selected state.',
      'Locked options should be visible but disabled; unlocked options should be usable.',
    ],
    firstFrame: ['locked and unlocked options visible'],
  },
  shop_economy: {
    label: 'Shop Economy',
    family: 'economy',
    promptRules: [
      'Track coins/cash/score and connect it to selling, buying, unlocking, or upgrading.',
      'Buttons like sell/buy must update the economy state.',
    ],
    firstFrame: ['currency HUD visible', 'buy/sell/unlock affordance visible'],
  },
  bubble_grid: {
    label: 'Bubble Grid',
    family: 'puzzle_world',
    promptRules: [
      'Create a staggered bubble grid with multiple colors and stable collision targets.',
      'Matching bubbles should pop or detach according to clear rules.',
    ],
    firstFrame: ['bubble grid visible'],
  },
  aim_trajectory: {
    label: 'Aim Trajectory',
    family: 'input_feedback',
    promptRules: [
      'Show an aim line, bounce guide, arc, or targeting reticle before firing.',
      'The guide must react to pointer/drag direction.',
    ],
    firstFrame: ['aim guide visible'],
  },
  projectile_launcher: {
    label: 'Projectile Launcher',
    family: 'input',
    promptRules: [
      'Provide a visible launcher/projectile source and next projectile preview.',
      'Firing must move a projectile through the world and resolve collision.',
    ],
    firstFrame: ['launcher and next projectile visible'],
  },
  image_slice_puzzle: {
    label: 'Image Slice Puzzle',
    family: 'puzzle_world',
    promptRules: [
      'Split one focal image into movable/revealable slices or panels.',
      'Progress must be visible through completed fraction, puzzle count, or next puzzle affordance.',
    ],
    firstFrame: ['focal image or image slot visible', 'slice boundary or puzzle piece visible'],
  },
});

const CAPABILITY_KEYWORDS = [
  ['chase_camera_driver', ['chase camera', 'behind the car', 'behind car', 'third-person driving', 'third person driving', 'drift', 'racing', 'highway']],
  ['visible_player_vehicle', ['visible car', 'visible vehicle', 'third-person', 'third person', 'behind the player', 'behind the car']],
  ['road_depth_world', ['road', 'highway', 'traffic', 'lane', 'lanes', 'checkpoint', 'km', 'lap']],
  ['touch_driving_controls', ['gas', 'brake', 'drift', 'steer', 'steering', 'accelerate', 'pedal']],
  ['speed_hud', ['speed', 'km/h', 'distance', 'lap', 'timer', 'checkpoint']],
  ['projectile_ballistics', ['angle', 'power', 'trajectory', 'projectile', 'cannon', 'tank', 'artillery', 'slingshot']],
  ['terrain_profile', ['hill', 'terrain', 'mountain', 'slope', 'ground curve']],
  ['weapon_cards', ['weapon card', 'choose weapon', 'hail stone', 'wrecking ball', 'ammo card']],
  ['turn_based_duel', ['turn', 'your turn', 'enemy turn', 'duel', 'versus', 'player enemy']],
  ['rope_path_puzzle', ['rope', 'draw path', 'stretch arm', 'tight squeeze', 'navigate through', 'narrow gap']],
  ['obstacle_layout', ['obstacle', 'blocker', 'maze', 'gap', 'level']],
  ['level_title_card', ['level', 'level 4', 'objective']],
  ['isometric_actor_world', ['isometric', '2.5d', 'survival day', 'campfire', 'voxel', 'blocky survival']],
  ['survival_stats', ['health meter', 'hunger', 'fire meter', 'campfire', 'thirst', 'stamina', 'day 1', 'survival']],
  ['inventory_hotbar', ['inventory', 'hotbar', 'item slot', 'item slots', 'axe']],
  ['resource_node', ['tree', 'rock', 'campfire', 'harvest', 'chop', 'collect resource', 'arrow marker']],
  ['creator_tool_ui', ['paint studio', 'painting studio', 'drawing tool', 'nail salon', 'decorate', 'decorating tool', 'customizer', 'gallery']],
  ['brush_canvas', ['brush', 'paint', 'draw', 'canvas', 'clear drawing']],
  ['decorate_surface', ['nails', 'painting', 'decorate', 'decorating', 'customize', 'dress up', 'canvas']],
  ['palette_unlocks', ['locked colors', 'unlock', 'palette', 'patterns', 'finishes', 'decor']],
  ['shop_economy', ['sell', 'buy', 'coins', 'shop', 'earn money', 'currency', 'upgrade']],
  ['bubble_grid', ['bubble shooter', 'bubbles', 'match bubbles', 'pop bubbles']],
  ['aim_trajectory', ['aim', 'trajectory', 'bounce guide', 'dashed line', 'arc']],
  ['projectile_launcher', ['launcher', 'shoot', 'fire projectile', 'next ball', 'cannon']],
  ['image_slice_puzzle', ['image puzzle', 'slice puzzle', 'jigsaw', 'next puzzle', 'complete picture']],
];

const LANE_DEFAULT_CAPABILITIES = {
  third_person_threejs: ['visible_player_vehicle'],
  endless_runner_vertical: ['road_depth_world', 'speed_hud'],
  simulation_toybox: ['creator_tool_ui'],
  story_horror_vignette: ['level_title_card'],
};

const CONTROL_RIG_CAPABILITIES = {
  chase_camera_driver: ['chase_camera_driver', 'visible_player_vehicle', 'road_depth_world', 'touch_driving_controls', 'speed_hud'],
  cockpit_driver: ['road_depth_world', 'touch_driving_controls', 'speed_hud'],
  third_person_joystick: ['visible_player_vehicle'],
  lane_swipe_runner: ['road_depth_world', 'speed_hud'],
  drag_drop_toybox: ['creator_tool_ui'],
};

function expandCapabilities(ids = []) {
  const expanded = [];
  const visit = (id) => {
    if (!id || expanded.includes(id)) return;
    expanded.push(id);
    const requires = CAPABILITY_GRAPH[id]?.requires || [];
    requires.forEach(visit);
  };
  ids.forEach(visit);
  return expanded;
}

export function inferCapabilities(promptText = '', specSheet = {}) {
  const text = [
    promptText,
    specSheet?.title,
    specSheet?.genre,
    specSheet?.summary,
    specSheet?.cameraPerspective,
    specSheet?.environmentType,
    specSheet?.entities?.hero,
    specSheet?.entities?.enemy,
    specSheet?.entities?.collectible,
    specSheet?.entities?.obstacle,
    ...(Array.isArray(specSheet?.coreMechanics) ? specSheet.coreMechanics : []),
  ].filter(Boolean).join(' ').toLowerCase();

  const requested = Array.isArray(specSheet?.capabilityIntents)
    ? specSheet.capabilityIntents.map((id) => safeText(id).toLowerCase()).filter((id) => CAPABILITY_GRAPH[id])
    : [];

  const inferred = CAPABILITY_KEYWORDS
    .filter(([, keywords]) => includesAny(text, keywords))
    .map(([id]) => id);

  const laneDefaults = LANE_DEFAULT_CAPABILITIES[specSheet?.runtimeLane] || [];
  const rigDefaults = CONTROL_RIG_CAPABILITIES[specSheet?.controlRig] || [];
  const ids = expandCapabilities([...requested, ...inferred, ...laneDefaults, ...rigDefaults]).slice(0, 10);

  return ids.map((id) => ({
    id,
    label: CAPABILITY_GRAPH[id].label,
    family: CAPABILITY_GRAPH[id].family,
    promptRules: CAPABILITY_GRAPH[id].promptRules,
    firstFrame: CAPABILITY_GRAPH[id].firstFrame,
  }));
}

export function capabilityIds(capabilities = []) {
  return capabilities.map((capability) => capability?.id).filter(Boolean);
}

export function buildCapabilityPromptBlock(capabilities = []) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return 'No special capability modules were inferred. Preserve the prompt intent and build the smallest polished playable system that satisfies it.';
  }

  return capabilities.map((capability) => {
    const rules = (capability.promptRules || []).map((rule) => `  - ${rule}`).join('\n');
    const firstFrame = (capability.firstFrame || []).map((item) => `  - ${item}`).join('\n');
    return [
      `CAPABILITY: ${capability.id} — ${capability.label}`,
      rules ? `Rules:\n${rules}` : null,
      firstFrame ? `First-frame obligations:\n${firstFrame}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
