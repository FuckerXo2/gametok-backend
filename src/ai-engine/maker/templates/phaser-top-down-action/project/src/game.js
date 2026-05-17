const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const movePad = document.getElementById('move-pad');
const moveStick = document.getElementById('move-stick');
const attackButton = document.getElementById('attack-button');
const restartButton = document.getElementById('restart-button');
const healthReadout = document.getElementById('health-readout');
const scoreReadout = document.getElementById('score-readout');
const waveReadout = document.getElementById('wave-readout');
const statusLine = document.getElementById('status-line');

const GAME_THEME = {
  title: 'Arcane Rush',
  subtitle: 'Move, cast, survive.',
  playerName: 'Hero',
  enemyName: 'Shade',
  backgroundA: '#10233f',
  backgroundB: '#14213d',
  grid: 'rgba(186, 230, 253, 0.08)',
  player: '#38bdf8',
  enemy: '#fb7185',
  projectile: '#fef08a',
  pickup: '#86efac',
  hit: '#f97316',
};

const CONFIG = {
  playerSpeed: 190,
  enemySpeed: 62,
  projectileSpeed: 360,
  attackCooldown: 0.32,
  enemySpawnEvery: 2.3,
  enemyRadius: 18,
  playerRadius: 18,
  projectileRadius: 6,
  enemyDamage: 12,
  projectileDamage: 34,
};

const state = {
  width: 390,
  height: 844,
  safeTop: 112,
  safeBottom: 170,
  playRect: { x: 14, y: 112, width: 362, height: 562 },
  player: { x: 195, y: 430, vx: 0, vy: 0, health: 100, invuln: 0 },
  enemies: [],
  projectiles: [],
  attacks: [],
  pickups: [],
  particles: [],
  score: 0,
  combo: 0,
  wave: 1,
  cooldowns: { attack: 0, spawn: 0.35 },
  gameOver: false,
  input: { moveX: 0, moveY: 0, pointerId: null },
  assets: {},
  lastTime: performance.now(),
  shake: 0,
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
  state.assets.enemy = byRole('enemy');
  state.assets.background = byRole('background') || byRole('environment');
  state.assets.effect = byRole('effect') || byRole('projectile') || byRole('prop');
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
  state.safeBottom = Math.max(158, state.height * 0.22);
  state.playRect = {
    x: 14,
    y: state.safeTop + 74,
    width: state.width - 28,
    height: Math.max(260, state.height - state.safeTop - state.safeBottom - 86),
  };
  clampPlayer();
}

function clampPlayer() {
  const rect = state.playRect;
  state.player.x = Math.max(rect.x + CONFIG.playerRadius, Math.min(rect.x + rect.width - CONFIG.playerRadius, state.player.x));
  state.player.y = Math.max(rect.y + CONFIG.playerRadius, Math.min(rect.y + rect.height - CONFIG.playerRadius, state.player.y));
}

function resetGame() {
  state.player = {
    x: state.width * 0.5,
    y: state.playRect.y + state.playRect.height * 0.62,
    vx: 0,
    vy: 0,
    health: 100,
    invuln: 0,
  };
  state.enemies = [];
  state.projectiles = [];
  state.attacks = [];
  state.pickups = [];
  state.particles = [];
  state.score = 0;
  state.combo = 0;
  state.wave = 1;
  state.cooldowns = { attack: 0, spawn: 0.2 };
  state.gameOver = false;
  state.shake = 0;
  restartButton.hidden = true;
  attackButton.disabled = false;
  spawnEnemies();
  updateHud();
}

function handleInput() {
  const length = Math.hypot(state.input.moveX, state.input.moveY);
  if (length > 1) {
    state.input.moveX /= length;
    state.input.moveY /= length;
  }
}

function updatePlayer(dt) {
  handleInput();
  state.player.vx = state.input.moveX * CONFIG.playerSpeed;
  state.player.vy = state.input.moveY * CONFIG.playerSpeed;
  state.player.x += state.player.vx * dt;
  state.player.y += state.player.vy * dt;
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  clampPlayer();
}

function spawnEnemies(forceNearPlayer = false) {
  const rect = state.playRect;
  const count = forceNearPlayer ? 1 : Math.min(2 + Math.floor(state.wave / 2), 5);
  for (let i = 0; i < count; i += 1) {
    const angle = forceNearPlayer ? Math.PI * 0.15 : Math.random() * Math.PI * 2;
    const distance = forceNearPlayer ? 84 : Math.max(rect.width, rect.height) * 0.45;
    const x = forceNearPlayer
      ? state.player.x + Math.cos(angle) * distance
      : rect.x + CONFIG.enemyRadius + Math.random() * (rect.width - CONFIG.enemyRadius * 2);
    const y = forceNearPlayer
      ? state.player.y + Math.sin(angle) * distance
      : rect.y + CONFIG.enemyRadius + Math.random() * (rect.height - CONFIG.enemyRadius * 2);
    state.enemies.push({
      x: Math.max(rect.x + CONFIG.enemyRadius, Math.min(rect.x + rect.width - CONFIG.enemyRadius, x)),
      y: Math.max(rect.y + CONFIG.enemyRadius, Math.min(rect.y + rect.height - CONFIG.enemyRadius, y)),
      health: 68 + state.wave * 8,
      radius: CONFIG.enemyRadius,
      wobble: Math.random() * Math.PI * 2,
    });
  }
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    enemy.wobble += dt * 6;
    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const speed = CONFIG.enemySpeed + state.wave * 4;
    enemy.x += (dx / distance) * speed * dt;
    enemy.y += (dy / distance) * speed * dt;
  }
  state.cooldowns.spawn -= dt;
  if (state.cooldowns.spawn <= 0) {
    spawnEnemies();
    state.cooldowns.spawn = Math.max(0.9, CONFIG.enemySpawnEvery - state.wave * 0.08);
  }
}

function nearestEnemyAngle() {
  if (state.enemies.length === 0) return -Math.PI / 2;
  let best = state.enemies[0];
  let bestDistance = Infinity;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
    if (distance < bestDistance) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return Math.atan2(best.y - state.player.y, best.x - state.player.x);
}

function performPrimaryAttack() {
  if (state.gameOver || state.cooldowns.attack > 0) return false;
  const angle = nearestEnemyAngle();
  const projectile = {
    x: state.player.x + Math.cos(angle) * 22,
    y: state.player.y + Math.sin(angle) * 22,
    vx: Math.cos(angle) * CONFIG.projectileSpeed,
    vy: Math.sin(angle) * CONFIG.projectileSpeed,
    life: 0,
    radius: CONFIG.projectileRadius,
  };
  state.projectiles.push(projectile);
  state.attacks.push({ x: state.player.x, y: state.player.y, radius: 18, age: 0 });
  state.cooldowns.attack = CONFIG.attackCooldown;
  statusLine.textContent = 'Cast fired';
  return true;
}

function updateProjectiles(dt) {
  const rect = state.playRect;
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life += dt;
  }
  state.projectiles = state.projectiles.filter((projectile) => (
    projectile.life < 1.6
    && projectile.x > rect.x - 20
    && projectile.x < rect.x + rect.width + 20
    && projectile.y > rect.y - 20
    && projectile.y < rect.y + rect.height + 20
  ));
}

function applyHitFeedback(x, y) {
  state.shake = 8;
  for (let i = 0; i < 12; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 130;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: 0.32 + Math.random() * 0.28,
      color: i % 2 ? GAME_THEME.hit : GAME_THEME.projectile,
    });
  }
}

function resolveCollisions() {
  for (const projectile of state.projectiles) {
    for (const enemy of state.enemies) {
      if (enemy.health <= 0) continue;
      const distance = Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y);
      if (distance < enemy.radius + projectile.radius) {
        enemy.health -= CONFIG.projectileDamage;
        projectile.life = 99;
        applyHitFeedback(enemy.x, enemy.y);
        if (enemy.health <= 0) {
          state.score += 100 + state.combo * 10;
          state.combo += 1;
          statusLine.textContent = `${GAME_THEME.enemyName} broken`;
        }
      }
    }
  }
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  if (state.enemies.length === 0 && !state.gameOver) {
    state.wave += 1;
    state.combo = Math.max(0, state.combo - 1);
    spawnEnemies();
    statusLine.textContent = `Wave ${state.wave}`;
  }
  if (state.player.invuln <= 0) {
    const touching = state.enemies.find((enemy) => Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < enemy.radius + CONFIG.playerRadius);
    if (touching) {
      state.player.health = Math.max(0, state.player.health - CONFIG.enemyDamage);
      state.combo = 0;
      state.player.invuln = 0.72;
      applyHitFeedback(state.player.x, state.player.y);
      statusLine.textContent = 'Hit';
      if (state.player.health <= 0) {
        state.gameOver = true;
        restartButton.hidden = false;
        attackButton.disabled = true;
        statusLine.textContent = 'Defeated';
      }
    }
  }
  updateHud();
}

function updateParticles(dt) {
  for (const particle of state.particles) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.92;
    particle.vy *= 0.92;
  }
  state.particles = state.particles.filter((particle) => particle.age < particle.life);
  for (const attack of state.attacks) {
    attack.age += dt;
    attack.radius += dt * 120;
  }
  state.attacks = state.attacks.filter((attack) => attack.age < 0.22);
}

function updateHud() {
  healthReadout.textContent = Math.round(state.player.health);
  scoreReadout.textContent = state.score;
  waveReadout.textContent = state.wave;
}

function drawHud() {
  updateHud();
}

function drawBackground() {
  const backgroundImage = getAssetImage(state.assets.background);
  if (backgroundImage?.complete && backgroundImage.naturalWidth > 0) {
    ctx.drawImage(backgroundImage, 0, 0, state.width, state.height);
    ctx.fillStyle = 'rgba(6, 12, 24, 0.32)';
    ctx.fillRect(0, 0, state.width, state.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, GAME_THEME.backgroundA);
    gradient.addColorStop(1, GAME_THEME.backgroundB);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
  }
  const rect = state.playRect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.strokeStyle = GAME_THEME.grid;
  ctx.lineWidth = 1;
  for (let x = rect.x; x <= rect.x + rect.width; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.height);
    ctx.stroke();
  }
  for (let y = rect.y; y <= rect.y + rect.height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawImageOrCircle(key, x, y, size, fill, flash = false) {
  const image = getAssetImage(key);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    if (flash) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    return;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const flash = state.player.invuln > 0 && Math.floor(state.player.invuln * 16) % 2 === 0;
  drawImageOrCircle(state.assets.player, state.player.x, state.player.y, 48, GAME_THEME.player, flash);
  ctx.strokeStyle = 'rgba(255,255,255,0.68)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, CONFIG.playerRadius + 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEnemy(enemy) {
  const pulse = 1 + Math.sin(enemy.wobble) * 0.08;
  drawImageOrCircle(state.assets.enemy, enemy.x, enemy.y, 44 * pulse, GAME_THEME.enemy);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(enemy.x - 20, enemy.y - 31, 40, 5);
  ctx.fillStyle = '#fb7185';
  ctx.fillRect(enemy.x - 20, enemy.y - 31, Math.max(0, 40 * enemy.health / (68 + state.wave * 8)), 5);
}

function drawProjectile(projectile) {
  const image = getAssetImage(state.assets.effect);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, projectile.x - 10, projectile.y - 10, 20, 20);
    return;
  }
  ctx.fillStyle = GAME_THEME.projectile;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
  ctx.fill();
}

function render(dt) {
  const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  state.shake = Math.max(0, state.shake - dt * 30);
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawBackground();
  state.attacks.forEach((attack) => {
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(attack.x, attack.y, attack.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  state.pickups.forEach((pickup) => drawImageOrCircle(null, pickup.x, pickup.y, 24, GAME_THEME.pickup));
  state.projectiles.forEach(drawProjectile);
  state.enemies.forEach(drawEnemy);
  state.particles.forEach((particle) => {
    ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  drawPlayer();
  ctx.restore();
  drawHud();
}

function tick(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  if (!state.gameOver) {
    state.cooldowns.attack = Math.max(0, state.cooldowns.attack - dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    resolveCollisions();
  }
  updateParticles(dt);
  render(dt);
  requestAnimationFrame(tick);
}

function setMoveFromPointer(event) {
  const rect = movePad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const max = rect.width * 0.36;
  const distance = Math.min(max, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  state.input.moveX = distance > 4 ? Math.cos(angle) * (distance / max) : 0;
  state.input.moveY = distance > 4 ? Math.sin(angle) * (distance / max) : 0;
  moveStick.style.transform = `translate(calc(-50% + ${state.input.moveX * max}px), calc(-50% + ${state.input.moveY * max}px))`;
}

function stopMove() {
  state.input.moveX = 0;
  state.input.moveY = 0;
  state.input.pointerId = null;
  moveStick.style.transform = 'translate(-50%, -50%)';
}

function bindInput() {
  movePad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.input.pointerId = event.pointerId;
    movePad.setPointerCapture(event.pointerId);
    setMoveFromPointer(event);
  });
  movePad.addEventListener('pointermove', (event) => {
    if (state.input.pointerId !== event.pointerId) return;
    event.preventDefault();
    setMoveFromPointer(event);
  });
  movePad.addEventListener('pointerup', stopMove);
  movePad.addEventListener('pointercancel', stopMove);
  attackButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    performPrimaryAttack();
  });
  restartButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resetGame();
  });
  window.addEventListener('resize', resize);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'phaser-top-down-action',
  snapshot() {
    return {
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y), health: state.player.health },
      enemyCount: state.enemies.length,
      projectileCount: state.projectiles.length,
      score: state.score,
      combo: state.combo,
      wave: state.wave,
      gameOver: state.gameOver,
    };
  },
  async move(dx, dy, ms = 160) {
    state.input.moveX = Math.max(-1, Math.min(1, Number(dx) || 0));
    state.input.moveY = Math.max(-1, Math.min(1, Number(dy) || 0));
    await new Promise((resolve) => setTimeout(resolve, ms));
    stopMove();
    return this.snapshot();
  },
  attack() {
    performPrimaryAttack();
    return this.snapshot();
  },
  spawnEnemyNearPlayer() {
    spawnEnemies(true);
    return this.snapshot();
  },
  reset() {
    resetGame();
    return this.snapshot();
  },
};

resolveThemeAssets();
bindInput();
resize();
resetGame();
requestAnimationFrame(tick);
