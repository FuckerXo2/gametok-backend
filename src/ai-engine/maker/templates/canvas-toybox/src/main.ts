// @ts-nocheck
import './styles.css';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score-value');
const timeEl = document.getElementById('time-value');
const comboEl = document.getElementById('combo-value');
const orderIconsEl = document.getElementById('order-icons');
const orderTimerFillEl = document.getElementById('order-timer-fill');
const customerAvatarEl = document.getElementById('customer-avatar');
const slotEls = Array.from(document.querySelectorAll('.slot'));
const cookButton = document.getElementById('cook-button');
const ingredientGridEl = document.getElementById('ingredient-grid');
const statusLine = document.getElementById('status-line');

const GAME_THEME = {
  title: 'Cosmic Kitchen',
  backgroundA: '#1a0a2e',
  backgroundB: '#2b1055',
  accent: '#00f5d4',
  danger: '#fb7185',
};

const DEFAULT_INGREDIENTS = [
  { id: 'steak', label: 'Space Steak', color: '#fb7185', emoji: '🥩' },
  { id: 'fish', label: 'Nebula Fish', color: '#22d3ee', emoji: '🐟' },
  { id: 'meteor', label: 'Meteor Meat', color: '#f97316', emoji: '☄️' },
  { id: 'lettuce', label: 'Star Lettuce', color: '#4ade80', emoji: '🥬' },
  { id: 'tomato', label: 'Space Tomato', color: '#ef4444', emoji: '🍅' },
  { id: 'cheese', label: 'Moon Cheese', color: '#fde047', emoji: '🧀' },
];

const ORDER_TIME = 18;
const ROUND_TIME = 120;

const state = {
  width: 390,
  height: 844,
  score: 0,
  combo: 1,
  timeLeft: ROUND_TIME,
  orderTimeLeft: ORDER_TIME,
  orderTimeMax: ORDER_TIME,
  slots: [null, null, null],
  currentOrder: [],
  ingredients: [...DEFAULT_INGREDIENTS],
  ordersCompleted: 0,
  cooksAttempted: 0,
  gameOver: false,
  shiftStarted: false,
  audioStarted: false,
  lastTick: performance.now(),
  assets: {},
};

function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

function listPackAssetKeys(filterFn) {
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  return pack
    .filter((asset) => asset && filterFn(asset))
    .map((asset) => asset.key || asset.id || asset.runtimeKey)
    .filter(Boolean);
}

function listItemAssetKeys() {
  const keys = [];
  const seen = new Set();
  for (let index = 1; index <= 6; index += 1) {
    const key = `item${index}`;
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  for (const key of listPackAssetKeys((asset) => {
    const role = String(asset.role || asset.category || '').toLowerCase();
    const type = String(asset.type || asset.assetType || '').toLowerCase();
    return role === 'item' || /^item\d+$/i.test(String(asset.key || asset.id || ''));
  })) {
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  return keys;
}

function ingredientAssetKey(ingredient, index) {
  const itemKeys = listItemAssetKeys();
  const namedKey = `item${index + 1}`;
  if (getAssetImage(namedKey)) return namedKey;
  if (itemKeys[index] && getAssetImage(itemKeys[index])) return itemKeys[index];
  if (itemKeys.length > index && getAssetImage(itemKeys[index])) return itemKeys[index];
  return null;
}

function resolveBackgroundImage() {
  const candidates = [
    'toybox_background',
    'background1',
    'background',
    'environment',
    ...listPackAssetKeys((asset) => {
      const role = String(asset.role || asset.category || '').toLowerCase();
      const type = String(asset.type || asset.assetType || '').toLowerCase();
      return type === 'background' || role === 'background' || role === 'environment';
    }),
  ];
  const seen = new Set();
  for (const key of candidates) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const img = getAssetImage(key);
    if (img) return img;
  }
  return null;
}

function playGameSound(key) {
  try {
    if (!window.DreamAudio) return;
    window.DreamAudio.unlock?.();
    window.DreamAudio.play?.(key);
  } catch (error) {
    console.warn('DreamAudio play failed:', error);
  }
}

function ensureAudioStarted() {
  if (state.audioStarted) return;
  state.audioStarted = true;
  try {
    window.DreamAudio?.unlock?.();
    if (window.DreamAudio?.startMusic?.()) return;
    window.DreamAudio?.play?.('ui_tap');
  } catch (error) {
    console.warn('DreamAudio boot failed:', error);
  }
}

function startShiftIfNeeded() {
  if (state.shiftStarted) return;
  state.shiftStarted = true;
  ensureAudioStarted();
}

function ingredientById(id) {
  return state.ingredients.find((entry) => entry.id === id) || null;
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
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateOrder() {
  const picks = shuffle(state.ingredients).slice(0, 3).map((entry) => entry.id);
  state.currentOrder = picks;
  state.orderTimeLeft = ORDER_TIME;
  state.orderTimeMax = ORDER_TIME;
  state.slots = [null, null, null];
}

function resetGame() {
  state.score = 0;
  state.combo = 1;
  state.timeLeft = ROUND_TIME;
  state.ordersCompleted = 0;
  state.cooksAttempted = 0;
  state.gameOver = false;
  state.shiftStarted = false;
  generateOrder();
  statusLine.textContent = 'Tap ingredients to fill slots, then cook!';
}

function slotsMatchOrder() {
  if (state.slots.some((slot) => !slot)) return false;
  const sortedSlots = [...state.slots].sort();
  const sortedOrder = [...state.currentOrder].sort();
  return sortedSlots.every((value, index) => value === sortedOrder[index]);
}

function nextEmptySlotIndex() {
  return state.slots.findIndex((slot) => slot === null);
}

function selectIngredient(index) {
  if (state.gameOver) return snapshot();
  startShiftIfNeeded();
  const ingredient = state.ingredients[index];
  if (!ingredient) return snapshot();
  const slotIndex = nextEmptySlotIndex();
  if (slotIndex === -1) {
    statusLine.textContent = 'Slots full — cook or clear by serving wrong order.';
    playGameSound('failure');
    return snapshot();
  }
  state.slots[slotIndex] = ingredient.id;
  playGameSound('ui_tap');
  statusLine.textContent = `Added ${ingredient.label}. ${slotsMatchOrder() ? 'Ready to cook!' : 'Keep building the order.'}`;
  renderAll();
  return snapshot();
}

function fillOrderSlots() {
  state.slots = [...state.currentOrder];
  renderAll();
  return snapshot();
}

function clearSlots() {
  state.slots = [null, null, null];
  renderAll();
  return snapshot();
}

function cookOrder() {
  if (state.gameOver) return snapshot();
  startShiftIfNeeded();
  if (state.slots.some((slot) => !slot)) {
    statusLine.textContent = 'Fill all three slots before cooking.';
    playGameSound('failure');
    return snapshot();
  }
  state.cooksAttempted += 1;
  if (slotsMatchOrder()) {
    state.score += 10 * state.combo;
    state.combo = Math.min(10, state.combo + 1);
    state.ordersCompleted += 1;
    statusLine.textContent = `Perfect dish! +${10 * Math.max(1, state.combo - 1)} combo bonus.`;
    playGameSound('success');
    playGameSound('collect');
    generateOrder();
  } else {
    state.combo = 1;
    state.score = Math.max(0, state.score - 5);
    statusLine.textContent = 'Wrong recipe — combo reset.';
    playGameSound('failure');
    clearSlots();
  }
  renderAll();
  return snapshot();
}

function stepGame(dt) {
  if (state.gameOver || !state.shiftStarted) return;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  state.orderTimeLeft = Math.max(0, state.orderTimeLeft - dt);
  if (state.orderTimeLeft <= 0) {
    state.combo = 1;
    state.score = Math.max(0, state.score - 8);
    statusLine.textContent = 'Customer lost patience — new order incoming.';
    playGameSound('failure');
    generateOrder();
  }
  if (state.timeLeft <= 0) {
    state.gameOver = true;
    statusLine.textContent = `Shift over! Final score ${state.score}.`;
  }
  renderAll();
}

function renderIngredientThumb(container, ingredient, index = 0) {
  container.innerHTML = '';
  container.style.background = '';
  const assetKey = ingredientAssetKey(ingredient, index);
  const itemAsset = assetKey ? getAssetImage(assetKey) : null;
  if (itemAsset) {
    const img = document.createElement('img');
    img.src = itemAsset.src;
    img.alt = ingredient.label;
    container.appendChild(img);
    return;
  }
  container.textContent = ingredient.emoji;
  container.style.background = `linear-gradient(180deg, ${ingredient.color}33, ${ingredient.color}88)`;
}

function renderSlot(slotEl, ingredientId) {
  slotEl.innerHTML = '';
  slotEl.classList.toggle('filled', Boolean(ingredientId));
  if (!ingredientId) return;
  const ingredient = ingredientById(ingredientId);
  if (!ingredient) return;
  const index = state.ingredients.findIndex((entry) => entry.id === ingredientId);
  const assetKey = ingredientAssetKey(ingredient, Math.max(0, index));
  const itemAsset = assetKey ? getAssetImage(assetKey) : null;
  if (itemAsset) {
    const img = document.createElement('img');
    img.src = itemAsset.src;
    img.alt = ingredient.label;
    slotEl.appendChild(img);
    return;
  }
  slotEl.textContent = ingredient.emoji;
}

function renderOrderIcons() {
  orderIconsEl.innerHTML = '';
  for (const ingredientId of state.currentOrder) {
    const ingredient = ingredientById(ingredientId);
    const icon = document.createElement('div');
    icon.className = 'order-icon';
    if (ingredient) {
      const index = state.ingredients.findIndex((entry) => entry.id === ingredientId);
      renderIngredientThumb(icon, ingredient, Math.max(0, index));
    }
    orderIconsEl.appendChild(icon);
  }
}

function renderIngredientGrid() {
  ingredientGridEl.innerHTML = '';
  state.ingredients.forEach((ingredient, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ingredient-card';
    card.dataset.index = String(index);
    const thumb = document.createElement('div');
    thumb.className = 'ingredient-thumb';
    renderIngredientThumb(thumb, ingredient, index);
    const label = document.createElement('div');
    label.className = 'ingredient-label';
    label.textContent = ingredient.label;
    card.append(thumb, label);
    card.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      selectIngredient(index);
    });
    ingredientGridEl.appendChild(card);
  });
}

function renderHud() {
  scoreEl.textContent = String(state.score);
  timeEl.textContent = String(Math.ceil(state.timeLeft));
  comboEl.textContent = `x${state.combo}`;
  const pct = state.orderTimeMax > 0 ? (state.orderTimeLeft / state.orderTimeMax) * 100 : 0;
  orderTimerFillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  cookButton.disabled = state.gameOver || state.slots.some((slot) => !slot);
}

function drawBackground() {
  const bg = resolveBackgroundImage();
  if (bg) {
    ctx.drawImage(bg, 0, 0, state.width, state.height);
    ctx.fillStyle = 'rgba(10, 8, 24, 0.12)';
    ctx.fillRect(0, 0, state.width, state.height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, GAME_THEME.backgroundA);
  gradient.addColorStop(1, GAME_THEME.backgroundB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let y = 0; y < state.height; y += 28) {
    ctx.fillRect(0, y, state.width, 1);
  }
}

function renderCustomer() {
  const customerKeys = ['enemy1', 'enemy2', 'enemy3', 'toybox_customer', 'enemy', 'customer'];
  let customerImg = null;
  for (const key of customerKeys) {
    customerImg = getAssetImage(key);
    if (customerImg) break;
  }
  if (customerImg) {
    customerAvatarEl.classList.add('has-image');
    customerAvatarEl.style.backgroundImage = `url("${customerImg.src}")`;
  } else {
    customerAvatarEl.classList.remove('has-image');
    customerAvatarEl.style.backgroundImage = '';
  }
}

function renderAll() {
  drawBackground();
  renderCustomer();
  renderOrderIcons();
  slotEls.forEach((slotEl, index) => renderSlot(slotEl, state.slots[index]));
  renderHud();
}

function snapshot() {
  return {
    templateId: 'canvas-toybox',
    score: state.score,
    combo: state.combo,
    timeLeft: Number(state.timeLeft.toFixed(2)),
    orderTimeLeft: Number(state.orderTimeLeft.toFixed(2)),
    slots: [...state.slots],
    currentOrder: [...state.currentOrder],
    slotsFilled: state.slots.filter(Boolean).length,
    ordersCompleted: state.ordersCompleted,
    cooksAttempted: state.cooksAttempted,
    gameOver: state.gameOver,
    readyToCook: state.slots.every(Boolean),
    orderMatched: slotsMatchOrder(),
  };
}

function tick(now) {
  const dt = Math.min(0.05, (now - state.lastTick) / 1000 || 0.016);
  state.lastTick = now;
  stepGame(dt);
  requestAnimationFrame(tick);
}

function bindInput() {
  cookButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    cookOrder();
  });
  document.getElementById('game-shell')?.addEventListener('pointerdown', () => {
    ensureAudioStarted();
  }, { passive: true });
  window.addEventListener('resize', () => {
    resize();
    renderAll();
  });
}

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'canvas-toybox',
  snapshot() {
    return snapshot();
  },
  selectIngredient(index) {
    return selectIngredient(Number(index) || 0);
  },
  fillOrderSlots() {
    return fillOrderSlots();
  },
  cook() {
    return cookOrder();
  },
  async step(ms = 300) {
    const seconds = Math.max(0, Number(ms) || 0) / 1000;
    stepGame(seconds);
    await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50)));
    return snapshot();
  },
  reset() {
    resetGame();
    renderAll();
    return snapshot();
  },
};

bindInput();
resize();
renderIngredientGrid();
resetGame();
renderAll();
requestAnimationFrame(tick);
