// @ts-nocheck
import './styles.css';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const partButton = document.getElementById('part-button');
const startButton = document.getElementById('start-button');
const resetButton = document.getElementById('reset-button');
const modeReadout = document.getElementById('mode-readout');
const partsReadout = document.getElementById('parts-readout');
const resultReadout = document.getElementById('result-readout');
const statusLine = document.getElementById('status-line');

const GAME_THEME = {
  title: 'Physics Forge',
  backgroundA: '#101d30',
  backgroundB: '#18263a',
  grid: 'rgba(186, 230, 253, 0.08)',
  part: '#38bdf8',
  goal: '#fef08a',
  target: '#86efac',
  danger: '#fb7185',
};

const CONFIG = {
  gravity: 560,
  bounce: 0.22,
  friction: 0.985,
  partWidth: 54,
  partHeight: 24,
  goalRadius: 18,
};

const state = {
  width: 390,
  height: 844,
  safeTop: 112,
  safeBottom: 150,
  playRect: { x: 14, y: 210, width: 362, height: 450 },
  mode: 'edit',
  bodies: [],
  constraints: [],
  gravity: CONFIG.gravity,
  selectedTool: 'part',
  goalObject: { x: 84, y: 270, vx: 0, vy: 0, radius: CONFIG.goalRadius, settled: false },
  targetZone: { x: 292, y: 570, width: 70, height: 44 },
  running: false,
  result: null,
  dragGhost: null,
  assets: {},
  lastTime: performance.now(),
};

function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
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
  state.playRect = {
    x: 14,
    y: state.safeTop + 100,
    width: state.width - 28,
    height: Math.max(300, state.height - state.safeTop - state.safeBottom - 112),
  };
  state.targetZone.x = state.playRect.x + state.playRect.width - 92;
  state.targetZone.y = state.playRect.y + state.playRect.height - 76;
}

function makeBody(x, y, width = CONFIG.partWidth, height = CONFIG.partHeight) {
  return {
    x,
    y,
    width,
    height,
    vx: 0,
    vy: 0,
    static: state.mode === 'edit',
    angle: 0,
  };
}

function addBody(x = state.playRect.x + state.playRect.width * 0.45, y = state.playRect.y + state.playRect.height * 0.56) {
  if (state.mode !== 'edit') return null;
  const body = makeBody(x, y);
  state.bodies.push(body);
  statusLine.textContent = 'Part placed';
  updateHud();
  return body;
}

function startSimulation() {
  if (state.mode === 'run') return;
  state.mode = 'run';
  state.running = true;
  state.result = null;
  state.goalObject.vx = 82;
  state.goalObject.vy = -40;
  for (const body of state.bodies) {
    body.static = false;
    body.vx = 0;
    body.vy = 0;
  }
  statusLine.textContent = 'Simulation running';
  updateHud();
}

function resetSimulation() {
  state.mode = 'edit';
  state.running = false;
  state.result = null;
  state.bodies = [];
  state.constraints = [];
  state.goalObject = {
    x: state.playRect.x + 64,
    y: state.playRect.y + 62,
    vx: 0,
    vy: 0,
    radius: CONFIG.goalRadius,
    settled: false,
  };
  addBody(state.playRect.x + state.playRect.width * 0.48, state.playRect.y + state.playRect.height * 0.62);
  statusLine.textContent = 'Place parts, then simulate';
  updateHud();
}

function collideCircleRect(circle, body) {
  const nearestX = Math.max(body.x - body.width / 2, Math.min(body.x + body.width / 2, circle.x));
  const nearestY = Math.max(body.y - body.height / 2, Math.min(body.y + body.height / 2, circle.y));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function resolveCollisions() {
  const rect = state.playRect;
  const goal = state.goalObject;
  if (goal.y + goal.radius > rect.y + rect.height) {
    goal.y = rect.y + rect.height - goal.radius;
    goal.vy *= -CONFIG.bounce;
    goal.vx *= CONFIG.friction;
  }
  if (goal.x - goal.radius < rect.x) {
    goal.x = rect.x + goal.radius;
    goal.vx = Math.abs(goal.vx) * CONFIG.bounce;
  }
  if (goal.x + goal.radius > rect.x + rect.width) {
    goal.x = rect.x + rect.width - goal.radius;
    goal.vx = -Math.abs(goal.vx) * CONFIG.bounce;
  }
  for (const body of state.bodies) {
    if (collideCircleRect(goal, body)) {
      goal.y = body.y - body.height / 2 - goal.radius;
      goal.vy = -Math.abs(goal.vy) * 0.38;
      goal.vx += (goal.x - body.x) * 0.72;
    }
  }
}

function checkGoal() {
  const goal = state.goalObject;
  const target = state.targetZone;
  const inside = goal.x > target.x && goal.x < target.x + target.width && goal.y > target.y && goal.y < target.y + target.height;
  if (inside && Math.hypot(goal.vx, goal.vy) < 72) {
    state.result = 'success';
    state.running = false;
    state.mode = 'edit';
    statusLine.textContent = 'Goal reached';
  } else if (goal.y > state.playRect.y + state.playRect.height - goal.radius - 2 && Math.hypot(goal.vx, goal.vy) < 18 && state.running) {
    state.result = 'retry';
    state.running = false;
    state.mode = 'edit';
    statusLine.textContent = 'Try a new build';
  }
  updateHud();
}

function stepPhysics(dt) {
  if (!state.running) return;
  const goal = state.goalObject;
  goal.vy += state.gravity * dt;
  goal.x += goal.vx * dt;
  goal.y += goal.vy * dt;
  goal.vx *= CONFIG.friction;
  for (const body of state.bodies) {
    body.vy += state.gravity * dt;
    body.y += body.vy * dt;
    body.x += body.vx * dt;
    const floor = state.playRect.y + state.playRect.height - body.height / 2;
    if (body.y > floor) {
      body.y = floor;
      body.vy *= -0.18;
      body.vx *= 0.94;
    }
  }
  resolveCollisions();
  checkGoal();
}

function updateHud() {
  modeReadout.textContent = state.mode === 'run' ? 'Run' : 'Edit';
  partsReadout.textContent = state.bodies.length;
  resultReadout.textContent = state.result === 'success' ? 'Done' : state.result === 'retry' ? 'Retry' : 'Build';
}

function drawBackground() {
  const bg = getAssetImage('background');
  if (bg) {
    ctx.drawImage(bg, 0, 0, state.width, state.height);
    ctx.fillStyle = 'rgba(6, 12, 24, 0.3)';
    ctx.fillRect(0, 0, state.width, state.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, GAME_THEME.backgroundA);
    gradient.addColorStop(1, GAME_THEME.backgroundB);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
  }
  const rect = state.playRect;
  ctx.strokeStyle = GAME_THEME.grid;
  ctx.lineWidth = 1;
  for (let x = rect.x; x <= rect.x + rect.width; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.height);
    ctx.stroke();
  }
  for (let y = rect.y; y <= rect.y + rect.height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.width, y);
    ctx.stroke();
  }
}

function drawBody(body) {
  const image = getAssetImage('part');
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  if (image) {
    ctx.drawImage(image, -body.width / 2, -body.height / 2, body.width, body.height);
  } else {
    ctx.fillStyle = GAME_THEME.part;
    ctx.fillRect(-body.width / 2, -body.height / 2, body.width, body.height);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-body.width / 2 + 5, -body.height / 2 + 4, body.width - 10, 4);
  }
  ctx.restore();
}

function drawGoal() {
  const image = getAssetImage('goal');
  if (image) {
    ctx.drawImage(image, state.goalObject.x - 24, state.goalObject.y - 24, 48, 48);
    return;
  }
  ctx.fillStyle = GAME_THEME.goal;
  ctx.beginPath();
  ctx.arc(state.goalObject.x, state.goalObject.y, state.goalObject.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawEditor() {
  const rect = state.playRect;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  if (state.mode === 'edit') {
    ctx.fillStyle = 'rgba(248,250,252,0.72)';
    ctx.font = '700 13px system-ui';
    ctx.fillText('Tap the field to place parts', rect.x + 14, rect.y + 24);
  }
}

function drawSimulation() {
  const target = state.targetZone;
  ctx.fillStyle = 'rgba(134, 239, 172, 0.18)';
  ctx.fillRect(target.x, target.y, target.width, target.height);
  ctx.strokeStyle = GAME_THEME.target;
  ctx.lineWidth = 3;
  ctx.strokeRect(target.x, target.y, target.width, target.height);
  state.bodies.forEach(drawBody);
  drawGoal();
  drawEditor();
}

function render() {
  drawBackground();
  drawSimulation();
  updateHud();
}

function tick(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  stepPhysics(dt);
  render();
  requestAnimationFrame(tick);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function bindInput() {
  canvas.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'edit') return;
    const point = canvasPoint(event);
    const rect = state.playRect;
    if (point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height) return;
    addBody(point.x, point.y);
  });
  partButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    addBody();
  });
  startButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startSimulation();
  });
  resetButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resetSimulation();
  });
  window.addEventListener('resize', resize);
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'canvas-simulation',
  snapshot() {
    return {
      mode: state.mode,
      running: state.running,
      bodyCount: state.bodies.length,
      goal: {
        x: Math.round(state.goalObject.x),
        y: Math.round(state.goalObject.y),
        vx: Math.round(state.goalObject.vx),
        vy: Math.round(state.goalObject.vy),
      },
      result: state.result,
    };
  },
  addBody(x, y) {
    addBody(x || state.playRect.x + state.playRect.width * 0.5, y || state.playRect.y + state.playRect.height * 0.5);
    return this.snapshot();
  },
  start() {
    startSimulation();
    return this.snapshot();
  },
  async step(ms = 300) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this.snapshot();
  },
  reset() {
    resetSimulation();
    return this.snapshot();
  },
};


bindInput();
resize();
resetSimulation();
requestAnimationFrame(tick);
