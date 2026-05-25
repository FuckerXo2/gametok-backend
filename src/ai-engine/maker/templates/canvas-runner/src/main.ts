// @ts-nocheck
import './styles.css';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreReadout = document.getElementById('score-readout');
const distanceReadout = document.getElementById('distance-readout');
const livesReadout = document.getElementById('lives-readout');
const restartButton = document.getElementById('restart-button');

const state = {
  width: 390,
  height: 600,
  groundY: 440,
  player: { x: 84, y: 360, w: 38, h: 54, vy: 0, grounded: true, sliding: 0, invuln: 0 },
  obstacles: [],
  collectibles: [],
  speed: 230,
  distance: 0,
  score: 0,
  lives: 3,
  gameOver: false,
  spawn: { obstacle: 0.8, collectible: 1.2 },
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
  state.groundY = state.height - 88;
  if (state.player.grounded) state.player.y = state.groundY - state.player.h;
}

function spawnObstacle(x = state.width + 42) {
  state.obstacles.push({ x, y: state.groundY - 42, w: 34, h: 42, passed: false });
  return snapshot();
}

function spawnCollectible(x = state.width + 120) {
  state.collectibles.push({ x, y: state.groundY - 120, r: 12, collected: false });
  return snapshot();
}

function jump() {
  if (state.gameOver) return snapshot();
  if (state.player.grounded) {
    state.player.vy = -520;
    state.player.grounded = false;
  }
  return snapshot();
}

function slide() {
  if (!state.gameOver && state.player.grounded) state.player.sliding = 0.42;
  return snapshot();
}

function updateRunner(dt) {
  if (state.gameOver) return;
  state.distance += state.speed * dt * 0.08;
  state.score += Math.floor(dt * 12);
  state.speed = Math.min(430, state.speed + dt * 4);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  state.player.sliding = Math.max(0, state.player.sliding - dt);
  state.player.vy += 1320 * dt;
  state.player.y += state.player.vy * dt;
  const playerHeight = state.player.sliding > 0 ? 30 : 54;
  state.player.h = playerHeight;
  if (state.player.y + state.player.h >= state.groundY) {
    state.player.y = state.groundY - state.player.h;
    state.player.vy = 0;
    state.player.grounded = true;
  }
  state.spawn.obstacle -= dt;
  state.spawn.collectible -= dt;
  if (state.spawn.obstacle <= 0) {
    spawnObstacle();
    state.spawn.obstacle = 1.05 + Math.random() * 0.85;
  }
  if (state.spawn.collectible <= 0) {
    spawnCollectible();
    state.spawn.collectible = 1.2 + Math.random() * 1.1;
  }
  for (const obstacle of state.obstacles) obstacle.x -= state.speed * dt;
  for (const item of state.collectibles) item.x -= state.speed * dt;
  state.obstacles = state.obstacles.filter((item) => item.x + item.w > -30);
  state.collectibles = state.collectibles.filter((item) => item.x + item.r > -30 && !item.collected);
  resolveCollisions();
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions() {
  const p = state.player;
  for (const obstacle of state.obstacles) {
    if (!obstacle.passed && obstacle.x + obstacle.w < p.x) {
      obstacle.passed = true;
      state.score += 25;
    }
    if (p.invuln <= 0 && rectsOverlap(p, obstacle)) {
      state.lives -= 1;
      p.invuln = 1.1;
      if (state.lives <= 0) {
        state.gameOver = true;
        restartButton.hidden = false;
      }
    }
  }
  for (const item of state.collectibles) {
    if (Math.hypot(item.x - (p.x + p.w / 2), item.y - (p.y + p.h / 2)) < item.r + 24) {
      item.collected = true;
      state.score += 100;
    }
  }
}

function drawWorld() {
  const bg = getAssetImage('background');
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, '#0f2d52');
  gradient.addColorStop(1, '#07111f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
  if (bg) {
    ctx.globalAlpha = 0.28;
    ctx.drawImage(bg, 0, 0, state.width, state.height);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, state.groundY, state.width, state.height - state.groundY);
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, state.groundY);
  ctx.lineTo(state.width, state.groundY);
  ctx.stroke();

  const enemyImg = getAssetImage('enemy');
  for (const obstacle of state.obstacles) {
    if (enemyImg) {
      ctx.drawImage(enemyImg, obstacle.x - 10, obstacle.y - 12, obstacle.w + 20, obstacle.h + 20);
    } else {
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }
  }
  const itemImg = getAssetImage('item');
  for (const item of state.collectibles) {
    if (itemImg) {
      ctx.drawImage(itemImg, item.x - 16, item.y - 16, 32, 32);
    } else {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const playerImg = getAssetImage('player');
  if (playerImg) {
    if (state.player.invuln > 0) ctx.globalAlpha = 0.5;
    ctx.drawImage(playerImg, state.player.x - 12, state.player.y - 14, state.player.w + 24, state.player.h + 22);
    ctx.globalAlpha = 1.0;
  } else {
    ctx.fillStyle = state.player.invuln > 0 ? '#93c5fd' : '#38bdf8';
    ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);
  }
  if (state.gameOver) {
    ctx.fillStyle = 'rgba(2,6,23,.72)';
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 34px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Run Over', state.width / 2, state.height / 2);
  }
}

function updateHud() {
  scoreReadout.textContent = String(state.score);
  distanceReadout.textContent = `${Math.floor(state.distance)}m`;
  livesReadout.textContent = String(state.lives);
}

function resetRun() {
  state.player = { x: 84, y: state.groundY - 54, w: 38, h: 54, vy: 0, grounded: true, sliding: 0, invuln: 0 };
  state.obstacles = [];
  state.collectibles = [];
  state.speed = 230;
  state.distance = 0;
  state.score = 0;
  state.lives = 3;
  state.gameOver = false;
  state.spawn = { obstacle: 0.25, collectible: 0.55 };
  restartButton.hidden = true;
  spawnObstacle(state.width + 180);
  spawnCollectible(state.width + 260);
  return snapshot();
}

function snapshot() {
  return {
    templateId: 'canvas-runner',
    player: { ...state.player },
    obstacleCount: state.obstacles.length,
    collectibleCount: state.collectibles.length,
    speed: state.speed,
    distance: state.distance,
    score: state.score,
    lives: state.lives,
    gameOver: state.gameOver,
  };
}

function loop(now) {
  const dt = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;
  updateRunner(dt);
  drawWorld();
  updateHud();
  requestAnimationFrame(loop);
}

document.getElementById('jump-button').addEventListener('pointerdown', jump);
document.getElementById('slide-button').addEventListener('pointerdown', slide);
restartButton.addEventListener('click', resetRun);
window.addEventListener('resize', resize);
window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'canvas-runner',
  snapshot,
  jump,
  slide,
  spawnObstacle,
  step: async (ms = 240) => {
    updateRunner(ms / 1000);
    drawWorld();
    updateHud();
    return snapshot();
  },
  reset: resetRun,
};


resize();
resetRun();
requestAnimationFrame(loop);
