const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const angleSlider = document.getElementById('angle-slider');
const powerSlider = document.getElementById('power-slider');
const fireButton = document.getElementById('fire-button');
const restartButton = document.getElementById('restart-button');
const angleReadout = document.getElementById('angle-readout');
const powerReadout = document.getElementById('power-readout');
const windReadout = document.getElementById('wind-readout');
const playerHealth = document.getElementById('player-health');
const enemyHealth = document.getElementById('enemy-health');
const playerLabel = document.getElementById('player-label');
const enemyLabel = document.getElementById('enemy-label');
const statusLine = document.getElementById('status-line');

const GAME_THEME = {
  title: 'Tank Duel',
  subtitle: 'Angle, power, wind, fire.',
  playerName: 'Player',
  enemyName: 'Enemy',
  skyTop: '#73c7f3',
  skyBottom: '#dff7ff',
  terrainTop: '#6b8f3a',
  terrainBody: '#7a4a2d',
  playerTank: '#2563eb',
  enemyTank: '#dc2626',
  projectile: '#111827',
  explosionA: '#f97316',
  explosionB: '#fef08a',
};

const CONFIG = {
  gravity: 280,
  windScale: 46,
  maxWind: 2.4,
  tankWidth: 38,
  tankHeight: 20,
  cannonLength: 28,
  explosionRadius: 46,
  maxDamage: 45,
  terrainStep: 6,
  terrainBase: 0.72,
  terrainAmplitude: 0.2,
};

const state = {
  width: 390,
  height: 844,
  safeTop: 112,
  safeBottom: 164,
  currentTurn: 0,
  wind: 0,
  angle: 45,
  power: 62,
  tanks: [],
  terrainHeights: [],
  projectile: null,
  explosion: null,
  shake: 0,
  winner: null,
  lastTime: performance.now(),
  assets: {},
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
  state.assets.projectile = byRole('projectile') || byRole('shell') || byRole('prop');
  state.assets.explosion = byRole('effect') || byRole('explosion');
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
  state.safeBottom = Math.max(148, state.height * 0.22);
  if (state.terrainHeights.length > 0) {
    generateTerrain(false);
    placeTanks();
  }
}

function seededNoise(x) {
  return Math.sin(x * 0.018) * 0.5 + Math.sin(x * 0.041 + 1.7) * 0.32 + Math.sin(x * 0.009 + 2.8) * 0.18;
}

function generateTerrain(resetDamage = true) {
  const points = Math.ceil(state.width / CONFIG.terrainStep) + 2;
  const base = state.height * CONFIG.terrainBase;
  const amplitude = state.height * CONFIG.terrainAmplitude;
  state.terrainHeights = Array.from({ length: points }, (_, index) => {
    const x = index * CONFIG.terrainStep;
    const slope = seededNoise(x) * amplitude;
    return Math.max(state.safeTop + 160, Math.min(state.height - 68, base + slope));
  });
  const padWidth = Math.max(78, state.width * 0.18);
  flattenPad(state.width * 0.18, padWidth);
  flattenPad(state.width * 0.82, padWidth);
  if (resetDamage) state.explosion = null;
}

function flattenPad(centerX, width) {
  const y = sampleTerrainY(centerX);
  for (let x = centerX - width / 2; x <= centerX + width / 2; x += CONFIG.terrainStep) {
    const index = Math.max(0, Math.min(state.terrainHeights.length - 1, Math.round(x / CONFIG.terrainStep)));
    state.terrainHeights[index] = y;
  }
}

function sampleTerrainY(x) {
  const clampedX = Math.max(0, Math.min(state.width - 1, x));
  const raw = clampedX / CONFIG.terrainStep;
  const left = Math.floor(raw);
  const right = Math.min(state.terrainHeights.length - 1, left + 1);
  const t = raw - left;
  return state.terrainHeights[left] * (1 - t) + state.terrainHeights[right] * t;
}

function placeTanks() {
  const leftX = state.width * 0.18;
  const rightX = state.width * 0.82;
  state.tanks = [
    {
      id: 'player',
      name: GAME_THEME.playerName,
      x: leftX,
      y: sampleTerrainY(leftX),
      health: state.tanks[0]?.health ?? 100,
      color: GAME_THEME.playerTank,
      direction: 1,
    },
    {
      id: 'enemy',
      name: GAME_THEME.enemyName,
      x: rightX,
      y: sampleTerrainY(rightX),
      health: state.tanks[1]?.health ?? 100,
      color: GAME_THEME.enemyTank,
      direction: -1,
    },
  ];
}

function randomizeWind() {
  state.wind = Number(((Math.random() * 2 - 1) * CONFIG.maxWind).toFixed(1));
}

function resetRound() {
  state.currentTurn = 0;
  state.angle = Number(angleSlider.value || 45);
  state.power = Number(powerSlider.value || 62);
  state.projectile = null;
  state.explosion = null;
  state.shake = 0;
  state.winner = null;
  randomizeWind();
  generateTerrain(true);
  state.tanks = [
    { health: 100 },
    { health: 100 },
  ];
  placeTanks();
  restartButton.hidden = true;
  fireButton.disabled = false;
  updateHud();
}

function getMuzzle(tank = state.tanks[state.currentTurn]) {
  const angle = (state.angle * Math.PI) / 180;
  const aimAngle = tank.direction === 1 ? -angle : Math.PI + angle;
  return {
    x: tank.x + Math.cos(aimAngle) * CONFIG.cannonLength,
    y: tank.y - CONFIG.tankHeight + Math.sin(aimAngle) * CONFIG.cannonLength,
    angle: aimAngle,
  };
}

function drawTrajectoryPreview() {
  if (state.projectile || state.winner) return;
  const points = computeTrajectoryPoints();
  ctx.save();
  ctx.setLineDash([8, 9]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function computeTrajectoryPoints() {
  if (state.winner) return [];
  const tank = state.tanks[state.currentTurn];
  const muzzle = getMuzzle(tank);
  const speed = 1.9 * state.power;
  let x = muzzle.x;
  let y = muzzle.y;
  let vx = Math.cos(muzzle.angle) * speed;
  let vy = Math.sin(muzzle.angle) * speed;
  const points = [{ x, y }];
  for (let i = 0; i < 80; i += 1) {
    vx += state.wind * CONFIG.windScale * 0.016;
    vy += CONFIG.gravity * 0.016;
    x += vx * 0.016;
    y += vy * 0.016;
    if (x < 0 || x > state.width || y > state.height || y >= sampleTerrainY(x)) {
      points.push({ x, y });
      break;
    }
    points.push({ x, y });
  }
  return points;
}

function trajectorySignature() {
  return computeTrajectoryPoints()
    .filter((_, index) => index % 8 === 0)
    .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
    .join('|');
}

function fireProjectile() {
  if (state.projectile || state.winner) return;
  const tank = state.tanks[state.currentTurn];
  const muzzle = getMuzzle(tank);
  const speed = 1.9 * state.power;
  state.projectile = {
    x: muzzle.x,
    y: muzzle.y,
    vx: Math.cos(muzzle.angle) * speed,
    vy: Math.sin(muzzle.angle) * speed,
    life: 0,
  };
  fireButton.disabled = true;
  statusLine.textContent = `${tank.name} fired`;
}

function updateProjectile(dt) {
  if (!state.projectile) return;
  const shell = state.projectile;
  shell.life += dt;
  shell.vx += state.wind * CONFIG.windScale * dt;
  shell.vy += CONFIG.gravity * dt;
  shell.x += shell.vx * dt;
  shell.y += shell.vy * dt;

  const out = shell.x < -40 || shell.x > state.width + 40 || shell.y > state.height + 60;
  const hitTerrain = shell.x >= 0 && shell.x <= state.width && shell.y >= sampleTerrainY(shell.x);
  const hitTank = state.tanks.find((tank) => Math.hypot(shell.x - tank.x, shell.y - (tank.y - 12)) < 24);
  if (out || hitTerrain || hitTank || shell.life > 7) {
    const impactX = Math.max(0, Math.min(state.width, shell.x));
    const impactY = Math.max(state.safeTop, Math.min(state.height, shell.y));
    if (!out) {
      deformTerrain(impactX, impactY, CONFIG.explosionRadius);
      applyExplosionDamage(impactX, impactY, CONFIG.explosionRadius);
      state.explosion = { x: impactX, y: impactY, radius: 8, age: 0 };
      state.shake = 12;
    }
    state.projectile = null;
    placeTanks();
    setTimeout(endTurn, 640);
  }
}

function applyExplosionDamage(x, y, radius) {
  for (const tank of state.tanks) {
    const distance = Math.hypot(tank.x - x, tank.y - y);
    if (distance < radius * 1.45) {
      const damage = Math.ceil(CONFIG.maxDamage * (1 - distance / (radius * 1.45)));
      tank.health = Math.max(0, tank.health - damage);
    }
  }
  const winner = state.tanks.find((tank) => tank.health > 0);
  const loser = state.tanks.find((tank) => tank.health <= 0);
  if (winner && loser) {
    state.winner = winner.name;
    statusLine.textContent = `${winner.name} wins`;
    restartButton.hidden = false;
    fireButton.disabled = true;
  }
  updateHud();
}

function deformTerrain(x, y, radius) {
  for (let i = 0; i < state.terrainHeights.length; i += 1) {
    const pointX = i * CONFIG.terrainStep;
    const dx = pointX - x;
    const distance = Math.abs(dx);
    if (distance < radius) {
      const curve = Math.cos((distance / radius) * Math.PI * 0.5);
      const craterY = y + curve * radius * 0.62;
      state.terrainHeights[i] = Math.max(state.terrainHeights[i], Math.min(state.height - 34, craterY));
    }
  }
}

function endTurn() {
  if (state.winner) return;
  state.currentTurn = state.currentTurn === 0 ? 1 : 0;
  randomizeWind();
  fireButton.disabled = false;
  updateHud();
}

function updateHud() {
  playerLabel.textContent = state.tanks[0]?.name || GAME_THEME.playerName;
  enemyLabel.textContent = state.tanks[1]?.name || GAME_THEME.enemyName;
  playerHealth.textContent = Math.round(state.tanks[0]?.health ?? 100);
  enemyHealth.textContent = Math.round(state.tanks[1]?.health ?? 100);
  windReadout.textContent = state.wind > 0 ? `+${state.wind}` : `${state.wind}`;
  angleReadout.textContent = `${state.angle} deg`;
  powerReadout.textContent = `${state.power}%`;
  if (!state.winner && !state.projectile) {
    statusLine.textContent = `${state.tanks[state.currentTurn]?.name || 'Player'} turn`;
  }
}

function drawBackground() {
  const backgroundImage = getAssetImage(state.assets.background);
  if (backgroundImage?.complete && backgroundImage.naturalWidth > 0) {
    ctx.drawImage(backgroundImage, 0, 0, state.width, state.height);
    ctx.fillStyle = 'rgba(8, 13, 28, 0.22)';
    ctx.fillRect(0, 0, state.width, state.height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, GAME_THEME.skyTop);
  gradient.addColorStop(0.58, GAME_THEME.skyBottom);
  gradient.addColorStop(1, '#fef3c7');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  for (let i = 0; i < 4; i += 1) {
    const x = (i * 111 + 38) % state.width;
    const y = state.safeTop + 34 + (i % 2) * 36;
    ctx.beginPath();
    ctx.ellipse(x, y, 32, 13, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 24, y + 4, 24, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrain() {
  ctx.beginPath();
  ctx.moveTo(0, state.height);
  ctx.lineTo(0, state.terrainHeights[0]);
  for (let i = 0; i < state.terrainHeights.length; i += 1) {
    ctx.lineTo(i * CONFIG.terrainStep, state.terrainHeights[i]);
  }
  ctx.lineTo(state.width, state.height);
  ctx.closePath();
  ctx.fillStyle = GAME_THEME.terrainBody;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = GAME_THEME.terrainTop;
  ctx.stroke();
}

function drawTank(tank, index) {
  const key = index === 0 ? state.assets.player : state.assets.enemy;
  const image = getAssetImage(key);
  ctx.save();
  ctx.translate(tank.x, tank.y - 12);
  if (image?.complete && image.naturalWidth > 0) {
    const flip = tank.direction === -1 ? -1 : 1;
    ctx.scale(flip, 1);
    ctx.drawImage(image, -25, -32, 50, 50);
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 13, 28, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tank.color;
  ctx.fillRect(-CONFIG.tankWidth / 2, -CONFIG.tankHeight, CONFIG.tankWidth, CONFIG.tankHeight);
  ctx.fillStyle = '#111827';
  ctx.fillRect(-CONFIG.tankWidth / 2 + 4, -5, CONFIG.tankWidth - 8, 8);
  const muzzle = getMuzzle(tank);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -CONFIG.tankHeight + 5);
  ctx.lineTo(muzzle.x - tank.x, muzzle.y - (tank.y - 12));
  ctx.stroke();
  ctx.restore();
}

function drawExplosion(dt) {
  if (!state.explosion) return;
  state.explosion.age += dt;
  state.explosion.radius += dt * 110;
  const alpha = Math.max(0, 1 - state.explosion.age / 0.55);
  ctx.save();
  ctx.globalAlpha = alpha;
  const explosionImage = getAssetImage(state.assets.explosion);
  if (explosionImage?.complete && explosionImage.naturalWidth > 0) {
    const size = Math.max(38, state.explosion.radius * 2.2);
    ctx.drawImage(explosionImage, state.explosion.x - size / 2, state.explosion.y - size / 2, size, size);
  } else {
    const gradient = ctx.createRadialGradient(state.explosion.x, state.explosion.y, 4, state.explosion.x, state.explosion.y, state.explosion.radius);
    gradient.addColorStop(0, GAME_THEME.explosionB);
    gradient.addColorStop(0.45, GAME_THEME.explosionA);
    gradient.addColorStop(1, 'rgba(17,24,39,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(state.explosion.x, state.explosion.y, state.explosion.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (state.explosion.age > 0.58) state.explosion = null;
}

function render(dt) {
  const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  state.shake = Math.max(0, state.shake - dt * 28);
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawBackground();
  drawTrajectoryPreview();
  drawTerrain();
  state.tanks.forEach(drawTank);
  if (state.projectile) {
    const projectileImage = getAssetImage(state.assets.projectile);
    if (projectileImage?.complete && projectileImage.naturalWidth > 0) {
      ctx.save();
      ctx.translate(state.projectile.x, state.projectile.y);
      ctx.rotate(Math.atan2(state.projectile.vy, state.projectile.vx));
      ctx.drawImage(projectileImage, -8, -8, 16, 16);
      ctx.restore();
    } else {
      ctx.fillStyle = GAME_THEME.projectile;
      ctx.beginPath();
      ctx.arc(state.projectile.x, state.projectile.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawExplosion(dt);
  ctx.restore();
}

function loop(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  updateProjectile(dt);
  render(dt);
  requestAnimationFrame(loop);
}

function bindInput() {
  angleSlider.addEventListener('input', () => {
    state.angle = Number(angleSlider.value);
    updateHud();
  });
  powerSlider.addEventListener('input', () => {
    state.power = Number(powerSlider.value);
    updateHud();
  });
  fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    fireProjectile();
  });
  restartButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resetRound();
  });
  window.addEventListener('resize', resize);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'phaser-artillery',
  snapshot() {
    return {
      currentTurn: state.currentTurn,
      wind: state.wind,
      angle: state.angle,
      power: state.power,
      projectileActive: Boolean(state.projectile),
      winner: state.winner,
      tanks: state.tanks.map((tank) => ({
        id: tank.id,
        x: tank.x,
        y: tank.y,
        health: tank.health,
      })),
      terrainSample: state.terrainHeights.slice(0, 12).map((value) => Math.round(value)),
      trajectorySignature: trajectorySignature(),
    };
  },
  setAim(angle, power) {
    angleSlider.value = String(angle);
    powerSlider.value = String(power);
    state.angle = Number(angle);
    state.power = Number(power);
    updateHud();
    return this.snapshot();
  },
  fire() {
    fireProjectile();
    return this.snapshot();
  },
  probeDeformTerrain() {
    const before = Math.round(sampleTerrainY(state.width * 0.5));
    deformTerrain(state.width * 0.5, before, CONFIG.explosionRadius);
    const after = Math.round(sampleTerrainY(state.width * 0.5));
    return { before, after, changed: before !== after };
  },
  reset() {
    resetRound();
    return this.snapshot();
  },
};

resolveThemeAssets();
bindInput();
resize();
resetRound();
requestAnimationFrame(loop);
