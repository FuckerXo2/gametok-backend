// @ts-nocheck
import './styles.css';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreReadout = document.getElementById('score-readout');
const waveReadout = document.getElementById('wave-readout');
const healthReadout = document.getElementById('health-readout');
const movePad = document.getElementById('move-pad');
const moveStick = document.getElementById('move-stick');
const restartButton = document.getElementById('restart-button');

const state = {
  width: 390,
  height: 560,
  player: { x: 195, y: 420, r: 18, health: 100, invuln: 0 },
  enemies: [],
  projectiles: [],
  pickups: [],
  particles: [],
  score: 0,
  wave: 1,
  health: 100,
  gameOver: false,
  input: { x: 0, y: 0, pointerId: null },
  cooldown: 0,
  spawnTimer: 0.25,
  lastTime: performance.now(),
  assets: {},
};

function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  state.width = rect.width || 362;
  state.height = rect.height || 560;
  canvas.width = Math.floor(state.width * dpr);
  canvas.height = Math.floor(state.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.player.x = Math.max(state.player.r, Math.min(state.width - state.player.r, state.player.x));
  state.player.y = Math.max(state.player.r, Math.min(state.height - state.player.r, state.player.y));
}

function handleInput(dt = 0) {
  const speed = 230;
  state.player.x += state.input.x * speed * dt;
  state.player.y += state.input.y * speed * dt;
  state.player.x = Math.max(state.player.r, Math.min(state.width - state.player.r, state.player.x));
  state.player.y = Math.max(state.player.r, Math.min(state.height - state.player.r, state.player.y));
}

function spawnEnemy(x = Math.random() * state.width, y = -30) {
  state.enemies.push({ x, y, r: 18, health: 38 + state.wave * 4, speed: 54 + state.wave * 8 });
  return snapshot();
}

function fireWeapon() {
  if (state.gameOver || state.cooldown > 0) return snapshot();
  state.projectiles.push({ x: state.player.x, y: state.player.y - 24, vx: 0, vy: -420, r: 5, damage: 30 });
  state.cooldown = 0.18;
  return snapshot();
}

function updateProjectiles(dt) {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
  }
  state.projectiles = state.projectiles.filter((projectile) => projectile.y > -30);
}

function updateEnemies(dt) {
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnEnemy();
    state.spawnTimer = Math.max(0.35, 1.1 - state.wave * 0.06);
  }
  for (const enemy of state.enemies) {
    const dx = state.player.x - enemy.x;
    enemy.x += Math.sign(dx) * Math.min(Math.abs(dx), enemy.speed * 0.35 * dt);
    enemy.y += enemy.speed * dt;
  }
  state.enemies = state.enemies.filter((enemy) => enemy.y < state.height + 50 && enemy.health > 0);
  if (state.score >= state.wave * 450) state.wave += 1;
}

function resolveCollisions() {
  for (const projectile of state.projectiles) {
    for (const enemy of state.enemies) {
      if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < projectile.r + enemy.r) {
        projectile.y = -999;
        enemy.health -= projectile.damage;
        state.particles.push({ x: enemy.x, y: enemy.y, life: 0.25 });
        if (enemy.health <= 0) state.score += 100;
      }
    }
  }
  for (const enemy of state.enemies) {
    if (state.player.invuln <= 0 && Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < enemy.r + state.player.r) {
      state.health -= 18;
      state.player.health = state.health;
      state.player.invuln = 0.9;
      enemy.health = 0;
      if (state.health <= 0) {
        state.gameOver = true;
        restartButton.hidden = false;
      }
    }
  }
}

function drawWorld() {
  const bg = getAssetImage('background');
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(1, '#172554');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
  if (bg) {
    ctx.globalAlpha = 0.24;
    ctx.drawImage(bg, 0, 0, state.width, state.height);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(125,211,252,.08)';
  for (let y = 24; y < state.height; y += 38) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.width, y);
    ctx.stroke();
  }
  const enemyImg = getAssetImage('enemy');
  for (const enemy of state.enemies) {
    if (enemyImg) {
      ctx.drawImage(enemyImg, enemy.x - 24, enemy.y - 24, 48, 48);
    } else {
      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#fef08a';
  for (const projectile of state.projectiles) {
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const playerImg = getAssetImage('player');
  if (playerImg) {
    if (state.player.invuln > 0) ctx.globalAlpha = 0.5;
    ctx.drawImage(playerImg, state.player.x - 28, state.player.y - 28, 56, 56);
    ctx.globalAlpha = 1.0;
  } else {
    ctx.fillStyle = state.player.invuln > 0 ? '#93c5fd' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, state.player.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const particle of state.particles) {
    ctx.fillStyle = `rgba(251, 191, 36, ${particle.life * 4})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 26 * (1 - particle.life), 0, Math.PI * 2);
    ctx.fill();
  }
  if (state.gameOver) {
    ctx.fillStyle = 'rgba(2,6,23,.72)';
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 32px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over', state.width / 2, state.height / 2);
  }
}

function updateHud() {
  scoreReadout.textContent = String(state.score);
  waveReadout.textContent = String(state.wave);
  healthReadout.textContent = String(Math.max(0, state.health));
}

function resetShooter() {
  state.player = { x: state.width / 2, y: state.height - 92, r: 18, health: 100, invuln: 0 };
  state.enemies = [];
  state.projectiles = [];
  state.pickups = [];
  state.particles = [];
  state.score = 0;
  state.wave = 1;
  state.health = 100;
  state.gameOver = false;
  state.cooldown = 0;
  state.spawnTimer = 0.2;
  restartButton.hidden = true;
  spawnEnemy(state.width / 2, 80);
  return snapshot();
}

function snapshot() {
  return {
    templateId: 'canvas-arcade-shooter',
    player: { ...state.player },
    enemyCount: state.enemies.length,
    projectileCount: state.projectiles.length,
    score: state.score,
    wave: state.wave,
    health: state.health,
    gameOver: state.gameOver,
  };
}

function loop(now) {
  const dt = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  for (const particle of state.particles) particle.life -= dt;
  state.particles = state.particles.filter((particle) => particle.life > 0);
  if (!state.gameOver) {
    handleInput(dt);
    updateProjectiles(dt);
    updateEnemies(dt);
    resolveCollisions();
  }
  drawWorld();
  updateHud();
  requestAnimationFrame(loop);
}

function setMoveFromPointer(event) {
  const rect = movePad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const len = Math.max(1, Math.hypot(dx, dy));
  const dist = Math.min(36, len);
  state.input.x = dx / len;
  state.input.y = dy / len;
  moveStick.style.left = `${36 + state.input.x * dist}px`;
  moveStick.style.top = `${36 + state.input.y * dist}px`;
}

movePad.addEventListener('pointerdown', (event) => {
  state.input.pointerId = event.pointerId;
  movePad.setPointerCapture(event.pointerId);
  setMoveFromPointer(event);
});
movePad.addEventListener('pointermove', (event) => {
  if (state.input.pointerId === event.pointerId) setMoveFromPointer(event);
});
movePad.addEventListener('pointerup', () => {
  state.input = { x: 0, y: 0, pointerId: null };
  moveStick.style.left = '36px';
  moveStick.style.top = '36px';
});
document.getElementById('fire-button').addEventListener('pointerdown', fireWeapon);
restartButton.addEventListener('click', resetShooter);
window.addEventListener('resize', resize);
window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'canvas-arcade-shooter',
  snapshot,
  move: async (x = 1, y = 0, ms = 220) => {
    state.input.x = x;
    state.input.y = y;
    handleInput(ms / 1000);
    state.input.x = 0;
    state.input.y = 0;
    return snapshot();
  },
  fire: fireWeapon,
  spawnEnemy,
  step: async (ms = 320) => {
    const dt = ms / 1000;
    updateProjectiles(dt);
    updateEnemies(dt);
    resolveCollisions();
    return snapshot();
  },
  reset: resetShooter,
};


resize();
resetShooter();
requestAnimationFrame(loop);
