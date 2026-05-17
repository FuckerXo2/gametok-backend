const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreReadout = document.getElementById('score-readout');
const movesReadout = document.getElementById('moves-readout');
const goalReadout = document.getElementById('goal-readout');
const statusLine = document.getElementById('status-line');
const restartButton = document.getElementById('restart-button');

const THEME = {
  title: 'Rune Grid',
  backgroundA: '#0f172a',
  backgroundB: '#1e3a8a',
  board: '#111827',
  selected: '#fde68a',
  matched: '#86efac',
  tiles: ['#38bdf8', '#f472b6', '#a3e635', '#facc15', '#c084fc'],
};

const state = {
  rows: 6,
  cols: 6,
  grid: [],
  selected: { row: 2, col: 2 },
  moves: 18,
  score: 0,
  goal: { target: 6, progress: 0 },
  level: 1,
  status: 'playing',
  cellSize: 48,
  boardRect: { x: 0, y: 0, width: 288, height: 288 },
  particles: [],
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
  state.assets.tile = byRole('item') || byRole('prop');
  state.assets.special = byRole('effect');
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
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(320, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width || 362;
  const height = rect.height || 420;
  state.cellSize = Math.floor(Math.min((width - 28) / state.cols, (height - 36) / state.rows));
  const boardWidth = state.cellSize * state.cols;
  const boardHeight = state.cellSize * state.rows;
  state.boardRect = {
    x: Math.round((width - boardWidth) / 2),
    y: Math.round((height - boardHeight) / 2),
    width: boardWidth,
    height: boardHeight,
  };
  renderBoard();
}

function seededTile(row, col) {
  return (row * 2 + col * 3 + state.level) % THEME.tiles.length;
}

function buildLevel() {
  state.grid = Array.from({ length: state.rows }, (_, row) =>
    Array.from({ length: state.cols }, (_, col) => ({
      type: seededTile(row, col),
      matched: false,
      pulse: 0,
    }))
  );
  state.grid[2][1].type = 1;
  state.grid[2][2].type = 1;
  state.grid[2][3].type = 2;
  state.selected = { row: 2, col: 3 };
  state.moves = 18;
  state.score = 0;
  state.goal = { target: 6, progress: 0 };
  state.status = 'playing';
  state.particles = [];
  restartButton.hidden = true;
  updateHud();
}

function updateHud() {
  scoreReadout.textContent = String(state.score);
  movesReadout.textContent = String(state.moves);
  goalReadout.textContent = `${state.goal.progress}/${state.goal.target}`;
  if (state.status === 'won') {
    statusLine.textContent = 'Puzzle cleared';
    restartButton.hidden = false;
  } else if (state.status === 'lost') {
    statusLine.textContent = 'No moves left';
    restartButton.hidden = false;
  } else {
    statusLine.textContent = 'Match three bright runes';
  }
}

function cellAtPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - state.boardRect.x;
  const y = clientY - rect.top - state.boardRect.y;
  const col = Math.floor(x / state.cellSize);
  const row = Math.floor(y / state.cellSize);
  if (row < 0 || col < 0 || row >= state.rows || col >= state.cols) return null;
  return { row, col };
}

function selectTile(row, col) {
  if (state.status !== 'playing') return snapshot();
  if (row < 0 || col < 0 || row >= state.rows || col >= state.cols) return snapshot();
  state.selected = { row, col };
  renderBoard();
  return snapshot();
}

function swapCells(a, b) {
  const tile = state.grid[a.row][a.col];
  state.grid[a.row][a.col] = state.grid[b.row][b.col];
  state.grid[b.row][b.col] = tile;
}

function moveTile(direction) {
  if (state.status !== 'playing') return snapshot();
  const offsets = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1],
  };
  const [dr, dc] = offsets[direction] || [0, 0];
  const next = { row: state.selected.row + dr, col: state.selected.col + dc };
  if (next.row < 0 || next.col < 0 || next.row >= state.rows || next.col >= state.cols) return snapshot();
  swapCells(state.selected, next);
  state.selected = next;
  state.moves = Math.max(0, state.moves - 1);
  const resolved = resolveMatches();
  if (!resolved.changed && state.moves <= 0) state.status = 'lost';
  updateHud();
  renderBoard();
  return snapshot();
}

function findMatches() {
  const matched = new Set();
  for (let row = 0; row < state.rows; row += 1) {
    let runStart = 0;
    for (let col = 1; col <= state.cols; col += 1) {
      const same = col < state.cols && state.grid[row][col].type === state.grid[row][runStart].type;
      if (!same) {
        if (col - runStart >= 3) {
          for (let c = runStart; c < col; c += 1) matched.add(`${row},${c}`);
        }
        runStart = col;
      }
    }
  }
  for (let col = 0; col < state.cols; col += 1) {
    let runStart = 0;
    for (let row = 1; row <= state.rows; row += 1) {
      const same = row < state.rows && state.grid[row][col].type === state.grid[runStart][col].type;
      if (!same) {
        if (row - runStart >= 3) {
          for (let r = runStart; r < row; r += 1) matched.add(`${r},${col}`);
        }
        runStart = row;
      }
    }
  }
  return matched;
}

function resolveMatches() {
  const matches = findMatches();
  if (matches.size === 0) {
    updateHud();
    renderBoard();
    return { changed: false, count: 0, ...snapshot() };
  }
  for (const key of matches) {
    const [row, col] = key.split(',').map(Number);
    const tile = state.grid[row][col];
    tile.matched = true;
    tile.pulse = 1;
    state.particles.push({
      x: state.boardRect.x + col * state.cellSize + state.cellSize / 2,
      y: state.boardRect.y + row * state.cellSize + state.cellSize / 2,
      life: 0.5,
      color: THEME.tiles[tile.type],
    });
  }
  state.score += matches.size * 100;
  applyGoalProgress(matches.size);
  refillMatchedTiles(matches);
  updateHud();
  renderBoard();
  return { changed: true, count: matches.size, ...snapshot() };
}

function refillMatchedTiles(matches) {
  for (const key of matches) {
    const [row, col] = key.split(',').map(Number);
    state.grid[row][col] = {
      type: (state.grid[row][col].type + row + col + 1) % THEME.tiles.length,
      matched: false,
      pulse: 0,
    };
  }
}

function applyGoalProgress(amount) {
  state.goal.progress = Math.min(state.goal.target, state.goal.progress + amount);
  if (state.goal.progress >= state.goal.target) {
    state.status = 'won';
  } else if (state.moves <= 0) {
    state.status = 'lost';
  }
}

function drawBackground(width, height) {
  const image = getAssetImage(state.assets.background);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.globalAlpha = 0.28;
    ctx.drawImage(image, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, THEME.backgroundA);
  gradient.addColorStop(1, THEME.backgroundB);
  ctx.globalCompositeOperation = image?.complete ? 'source-atop' : 'source-over';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

function drawTile(tile, row, col) {
  const x = state.boardRect.x + col * state.cellSize;
  const y = state.boardRect.y + row * state.cellSize;
  const pad = 5;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.fillRect(x + 2, y + 2, state.cellSize - 4, state.cellSize - 4);
  ctx.fillStyle = THEME.tiles[tile.type];
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, state.cellSize - pad * 2, state.cellSize - pad * 2, 8);
  ctx.fill();
  const image = getAssetImage(tile.type === 0 ? state.assets.special : state.assets.tile);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.globalAlpha = 0.65;
    ctx.drawImage(image, x + pad, y + pad, state.cellSize - pad * 2, state.cellSize - pad * 2);
    ctx.globalAlpha = 1;
  }
  if (state.selected.row === row && state.selected.col === col) {
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 3, y + 3, state.cellSize - 6, state.cellSize - 6);
  }
}

function renderBoard() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 362;
  const height = rect.height || 420;
  drawBackground(width, height);
  ctx.fillStyle = THEME.board;
  ctx.fillRect(state.boardRect.x - 8, state.boardRect.y - 8, state.boardRect.width + 16, state.boardRect.height + 16);
  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      drawTile(state.grid[row][col], row, col);
    }
  }
}

function resetPuzzle() {
  buildLevel();
  renderBoard();
  return snapshot();
}

function snapshot() {
  return {
    templateId: 'canvas-grid-puzzle',
    selected: { ...state.selected },
    score: state.score,
    moves: state.moves,
    goal: { ...state.goal },
    status: state.status,
    gridSignature: state.grid.map((row) => row.map((tile) => tile.type).join('')).join('|'),
  };
}

function bindButton(id, direction) {
  const button = document.getElementById(id);
  button.addEventListener('click', () => moveTile(direction));
}

canvas.addEventListener('pointerdown', (event) => {
  const cell = cellAtPoint(event.clientX, event.clientY);
  if (cell) selectTile(cell.row, cell.col);
});

bindButton('up-button', 'up');
bindButton('down-button', 'down');
bindButton('left-button', 'left');
bindButton('right-button', 'right');
document.getElementById('resolve-button').addEventListener('click', () => resolveMatches());
restartButton.addEventListener('click', () => resetPuzzle());
window.addEventListener('resize', resize);

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'canvas-grid-puzzle',
  snapshot,
  select: selectTile,
  move: moveTile,
  resolve: resolveMatches,
  reset: resetPuzzle,
};

resolveThemeAssets();
buildLevel();
resize();
