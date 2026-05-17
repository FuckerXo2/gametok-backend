const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const leftButton = document.getElementById('left-button');
const rightButton = document.getElementById('right-button');
const jumpButton = document.getElementById('jump-button');
const restartButton = document.getElementById('restart-button');
const scoreReadout = document.getElementById('score-readout');
const healthReadout = document.getElementById('health-readout');
const goalReadout = document.getElementById('goal-readout');
const statusLine = document.getElementById('status-line');

const GAME_THEME = {
  title: 'Skybound Run',
  backgroundA: '#0f2442',
  backgroundB: '#6dd5ed',
  platform: '#31572c',
  platformTop: '#86efac',
  player: '#38bdf8',
  hazard: '#fb7185',
  collectible: '#fef08a',
  goal: '#c084fc',
};

const CONFIG = {
  gravity: 1150,
  moveSpeed: 220,
  jumpVelocity: -520,
  playerWidth: 34,
  playerHeight: 42,
  coyoteTime: 0.08,
};

const state = {
  width: 390,
  height: 844,
  safeTop: 112,
  safeBottom: 150,
  player: { x: 80, y: 380, vx: 0, vy: 0, grounded: false, coyote: 0, health: 3, invuln: 0 },
  platforms: [],
  hazards: [],
  collectibles: [],
  camera: { x: 0, y: 0 },
  score: 0,
  lives: 3,
  health: 3,
  goal: { x: 860, y: 330, width: 44, height: 70, reached: false },
  input: { left: false, right: false, jumpQueued: false },
  assets: {},
  gameOver: false,
  lastTime: performance.now(),
  worldWidth: 980,
};

function resolveThemeAssets() {
  const helper = window.DreamAssets;
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  const byRole = (role) => {
    if (helper && typeof helper.firstByRole === 'function') {
      const asset = helper.firstByRole(role);
      if (asset?.key) return asset.key;
      if (typeof asset === 'string') return asset;
    }
    const entry = pack.find((asset) => asset.role === role || asset.category === role);
    return entry?.key || null;
  };
  state.assets.player = byRole('player');
  state.assets.hazard = byRole('enemy') || byRole('hazard');
  state.assets.background = byRole('background') || byRole('environment');
}

function getAssetImage(key) {
  if (!key) return null;
  if (state.assets[key] instanceof Image) return state.assets[key];
  const dataUrl = window.DreamAssets?.getImage?.(key) || window.DREAM_ASSETS?.[key];
  if (!dataUrl) return null;
  const image = new Image();
  image.src = dataUrl;
  state.assets[key] = image;
  return image;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  state.width = Math.max(320, Math.floor(window.innerWidth || 390));
  state.height = Math.max(560, Math.floor(window.innerHeight || 844));
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  canvas.width = Math.floor(state.width * dpr);
  canvas.height = Math.floor(state.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.safeTop = 116;
  state.safeBottom = Math.max(150, state.height * 0.2);
}

function buildLevel() {
  const floorY = state.height - state.safeBottom - 24;
  state.platforms = [
    { x: 0, y: floorY, width: 260, height: 32 },
    { x: 310, y: floorY - 78, width: 150, height: 28 },
    { x: 520, y: floorY - 142, width: 150, height: 28 },
    { x: 730, y: floorY - 92, width: 190, height: 28 },
    { x: 900, y: floorY, width: 120, height: 32 },
  ];
  state.hazards = [
    { x: 380, y: floorY - 112, width: 34, height: 28 },
    { x: 780, y: floorY - 126, width: 34, height: 28 },
  ];
  state.collectibles = [
    { x: 350, y: floorY - 126, collected: false },
    { x: 590, y: floorY - 190, collected: false },
    { x: 840, y: floorY - 142, collected: false },
  ];
  state.goal = { x: 910, y: floorY - 70, width: 44, height: 70, reached: false };
}

function resetLevel() {
  state.player = { x: 80, y: state.height - state.safeBottom - 92, vx: 0, vy: 0, grounded: false, coyote: 0, health: 3, invuln: 0 };
  state.score = 0;
  state.lives = 3;
  state.health = 3;
  state.camera = { x: 0, y: 0 };
  state.gameOver = false;
  restartButton.hidden = true;
  buildLevel();
  statusLine.textContent = 'Reach the gate';
  updateHud();
}

function handleInput() {
  const direction = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  state.player.vx = direction * CONFIG.moveSpeed;
  if (state.input.jumpQueued && (state.player.grounded || state.player.coyote > 0)) {
    state.player.vy = CONFIG.jumpVelocity;
    state.player.grounded = false;
    state.player.coyote = 0;
  }
  state.input.jumpQueued = false;
}

function playerRect() {
  return {
    x: state.player.x - CONFIG.playerWidth / 2,
    y: state.player.y - CONFIG.playerHeight,
    width: CONFIG.playerWidth,
    height: CONFIG.playerHeight,
  };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function resolvePlatformCollisions() {
  const rect = playerRect();
  state.player.grounded = false;
  for (const platform of state.platforms) {
    if (!intersects(rect, platform)) continue;
    const previousBottom = rect.y + rect.height - state.player.vy * 0.016;
    if (state.player.vy >= 0 && previousBottom <= platform.y + 8) {
      state.player.y = platform.y;
      state.player.vy = 0;
      state.player.grounded = true;
      state.player.coyote = CONFIG.coyoteTime;
    }
  }
  if (!state.player.grounded) {
    state.player.coyote = Math.max(0, state.player.coyote - 0.016);
  }
}

function updatePlayerPhysics(dt) {
  if (state.gameOver) return;
  handleInput();
  state.player.vy += CONFIG.gravity * dt;
  state.player.x += state.player.vx * dt;
  state.player.y += state.player.vy * dt;
  state.player.x = Math.max(18, Math.min(state.worldWidth - 18, state.player.x));
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  resolvePlatformCollisions();
  if (state.player.y > state.height + 80) {
    hitHazard();
  }
  state.camera.x = Math.max(0, Math.min(state.worldWidth - state.width, state.player.x - state.width * 0.42));
}

function collectItem(item = null) {
  const rect = playerRect();
  const target = item || state.collectibles.find((collectible) => !collectible.collected && Math.hypot(collectible.x - state.player.x, collectible.y - state.player.y) < 34);
  if (!target || target.collected) return false;
  target.collected = true;
  state.score += 100;
  statusLine.textContent = 'Collected';
  updateHud();
  return true;
}

function hitHazard() {
  if (state.player.invuln > 0 || state.gameOver) return;
  state.health = Math.max(0, state.health - 1);
  state.player.health = state.health;
  state.player.invuln = 0.9;
  state.player.x = Math.max(60, state.player.x - 90);
  state.player.y = state.height - state.safeBottom - 120;
  state.player.vx = 0;
  state.player.vy = 0;
  statusLine.textContent = 'Ouch';
  if (state.health <= 0) {
    state.gameOver = true;
    restartButton.hidden = false;
    statusLine.textContent = 'Try again';
  }
  updateHud();
}

function reachGoal() {
  if (state.goal.reached) return;
  state.goal.reached = true;
  state.score += 500;
  state.gameOver = true;
  restartButton.hidden = false;
  statusLine.textContent = 'Goal reached';
  updateHud();
}

function updateWorld() {
  const rect = playerRect();
  for (const hazard of state.hazards) {
    if (intersects(rect, hazard)) hitHazard();
  }
  for (const collectible of state.collectibles) {
    if (!collectible.collected && Math.hypot(collectible.x - state.player.x, collectible.y - (state.player.y - 22)) < 30) {
      collectItem(collectible);
    }
  }
  if (intersects(rect, state.goal)) reachGoal();
}

function updateHud() {
  scoreReadout.textContent = state.score;
  healthReadout.textContent = state.health;
  goalReadout.textContent = state.goal.reached ? 'Done' : 'Run';
}

function drawBackground() {
  const bg = getAssetImage(state.assets.background);
  if (bg?.complete && bg.naturalWidth > 0) {
    ctx.drawImage(bg, 0, 0, state.width, state.height);
    ctx.fillStyle = 'rgba(6, 12, 24, 0.25)';
    ctx.fillRect(0, 0, state.width, state.height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, GAME_THEME.backgroundA);
  gradient.addColorStop(1, GAME_THEME.backgroundB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  for (let i = 0; i < 5; i += 1) {
    const x = (i * 132 - state.camera.x * 0.18) % (state.width + 90);
    const y = state.safeTop + 80 + (i % 2) * 54;
    ctx.beginPath();
    ctx.ellipse(x, y, 38, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlatforms() {
  for (const platform of state.platforms) {
    const x = platform.x - state.camera.x;
    ctx.fillStyle = GAME_THEME.platform;
    ctx.fillRect(x, platform.y, platform.width, platform.height);
    ctx.fillStyle = GAME_THEME.platformTop;
    ctx.fillRect(x, platform.y, platform.width, 6);
  }
}

function drawPlayer() {
  const image = getAssetImage(state.assets.player);
  const rect = playerRect();
  const x = rect.x - state.camera.x;
  const flash = state.player.invuln > 0 && Math.floor(state.player.invuln * 16) % 2 === 0;
  if (image?.complete && image.naturalWidth > 0) {
    ctx.globalAlpha = flash ? 0.52 : 1;
    ctx.drawImage(image, x - 8, rect.y - 12, rect.width + 16, rect.height + 16);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = flash ? '#ffffff' : GAME_THEME.player;
  ctx.fillRect(x, rect.y, rect.width, rect.height);
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.fillRect(x + 7, rect.y + 6, rect.width - 14, 8);
}

function drawHazards() {
  const image = getAssetImage(state.assets.hazard);
  for (const hazard of state.hazards) {
    const x = hazard.x - state.camera.x;
    if (image?.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x - 6, hazard.y - 10, hazard.width + 12, hazard.height + 12);
    } else {
      ctx.fillStyle = GAME_THEME.hazard;
      ctx.fillRect(x, hazard.y, hazard.width, hazard.height);
    }
  }
}

function drawCollectiblesAndGoal() {
  for (const collectible of state.collectibles) {
    if (collectible.collected) continue;
    ctx.fillStyle = GAME_THEME.collectible;
    ctx.beginPath();
    ctx.arc(collectible.x - state.camera.x, collectible.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = state.goal.reached ? '#86efac' : GAME_THEME.goal;
  ctx.fillRect(state.goal.x - state.camera.x, state.goal.y, state.goal.width, state.goal.height);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(state.goal.x - state.camera.x + 8, state.goal.y + 8, state.goal.width - 16, 8);
}

function render() {
  drawBackground();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, state.safeTop + 74, state.width, state.height - state.safeTop - state.safeBottom - 68);
  ctx.clip();
  drawCollectiblesAndGoal();
  drawPlatforms();
  drawHazards();
  drawPlayer();
  ctx.restore();
  updateHud();
}

function tick(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  updatePlayerPhysics(dt);
  updateWorld();
  render();
  requestAnimationFrame(tick);
}

function bindHold(button, key) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.input[key] = true;
    button.setPointerCapture(event.pointerId);
  });
  const release = () => {
    state.input[key] = false;
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

function bindInput() {
  bindHold(leftButton, 'left');
  bindHold(rightButton, 'right');
  jumpButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.input.jumpQueued = true;
  });
  restartButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resetLevel();
  });
  window.addEventListener('resize', () => {
    resize();
    buildLevel();
  });
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'phaser-platformer',
  snapshot() {
    return {
      player: {
        x: Math.round(state.player.x),
        y: Math.round(state.player.y),
        vy: Math.round(state.player.vy),
        grounded: state.player.grounded,
      },
      score: state.score,
      health: state.health,
      collectibleCount: state.collectibles.filter((item) => !item.collected).length,
      goalReached: state.goal.reached,
      gameOver: state.gameOver,
    };
  },
  async move(direction, ms = 220) {
    state.input.left = Number(direction) < 0;
    state.input.right = Number(direction) > 0;
    await new Promise((resolve) => setTimeout(resolve, ms));
    state.input.left = false;
    state.input.right = false;
    return this.snapshot();
  },
  async jump() {
    state.input.jumpQueued = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    return this.snapshot();
  },
  collectNearest() {
    const item = state.collectibles.find((collectible) => !collectible.collected);
    if (item) {
      state.player.x = item.x;
      state.player.y = item.y + CONFIG.playerHeight;
      collectItem(item);
    }
    return this.snapshot();
  },
  reset() {
    resetLevel();
    return this.snapshot();
  },
};

resolveThemeAssets();
bindInput();
resize();
resetLevel();
requestAnimationFrame(tick);
