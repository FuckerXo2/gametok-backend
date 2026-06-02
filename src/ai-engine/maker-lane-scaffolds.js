function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

export function isTimedOrderCookingLane(foundation = {}) {
    const lane = asString(foundation.lane, '').toLowerCase();
    return lane.includes('timed_order')
        || lane.includes('order_cooking')
        || lane.includes('cooking')
        || lane.includes('chef')
        || lane.includes('diner');
}

const TIMED_ORDER_COOKING_STATE_DEFAULTS = [
    'pantry',
    'cauldronSlots',
    'activeOrder',
    'currentCustomer',
    'customerPatience',
    'shiftTimer',
    'drag',
    'cookFeedback',
    'cookFeedbackTimer',
    'customerType',
    'customerExpression',
    'bubbleTimer',
    'orderCooldown',
    'particles',
    'successFlash',
];

export function mergeLaneRequiredState(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return foundation;
    const requiredState = [...new Set([
        ...asArray(foundation.requiredState),
        ...TIMED_ORDER_COOKING_STATE_DEFAULTS,
    ])];
    const requiredFunctions = [...new Set([
        ...asArray(foundation.requiredFunctions),
        'handlePantryInput',
        'tryCookOrder',
        'spawnCustomer',
    ])];
    const probeNames = new Set(asArray(foundation.probeMethods).map((entry) => (
        typeof entry === 'string' ? entry : entry?.name
    )).filter(Boolean));
    const probeMethods = [...asArray(foundation.probeMethods)];
    for (const name of ['placeIngredient', 'triggerCooking', 'serveOrder']) {
        if (!probeNames.has(name)) {
            probeMethods.push({ name, description: `${name} gameplay probe` });
        }
    }
    return {
        ...foundation,
        requiredState,
        requiredFunctions,
        probeMethods,
    };
}

export function inferFoundationStateInitializer(key = '', foundation = {}) {
    if (key === 'pantry' || key === 'particles' || key === 'customers' || key === 'ingredients') return '[]';
    if (key === 'cauldronSlots' || key === 'slots') return '[null, null, null]';
    if (key === 'drag') return 'null';
    if (key === 'activeOrder' || key === 'currentCustomer') return 'null';
    if (key === 'customerExpression' || key === 'customerType' || key === 'cookFeedback') return "''";
    if (key === 'gameOver' || key.startsWith('is')) return 'false';
    if (key === 'combo' || key === 'comboMultiplier') return '1';
    if (key === 'score' || key.endsWith('Count')) return '0';
    if (/Flash|Cooldown|Timer|Patience|shift|order|bubble|time|Time|Remaining|Duration/i.test(key)) return '0';
    if (key.endsWith('[]')) return '[]';
    if (isTimedOrderCookingLane(foundation) && /pantry|slot|order|customer|particle/i.test(key)) {
        if (/slot|pantry|customer|particle|order/i.test(key) && !/Timer|Cooldown|Patience|Flash/i.test(key)) {
            return key.endsWith('s') && !key.endsWith('Slots') ? '[]' : (key.includes('slot') ? '[null, null, null]' : 'null');
        }
    }
    return 'null';
}

export function buildLaneIndexHtmlExtras(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return '';
    return `
    <section id="order-ui" class="order-ui" aria-label="Order station">
      <div id="customer-bubble" class="customer-bubble" data-customer-bubble></div>
      <div id="slot-row" class="slot-row" data-slots>
        <div class="slot-well" data-slot="0"></div>
        <div class="slot-well" data-slot="1"></div>
        <div class="slot-well" data-slot="2"></div>
      </div>
      <button id="cook-button" type="button" class="cook-button">COOK</button>
    </section>
    <section id="pantry-grid" class="pantry-grid" data-pantry aria-label="Ingredient pantry"></section>`;
}

export function buildLaneStylesCssExtras(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return '';
    return `
#order-ui {
  position: fixed;
  left: 50%;
  top: 42%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  z-index: 4;
  pointer-events: none;
}
.customer-bubble {
  min-width: 8rem;
  min-height: 3rem;
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.72);
  border: 2px solid rgba(56, 189, 248, 0.5);
}
.slot-row {
  display: flex;
  gap: 0.5rem;
}
.slot-well {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 0.75rem;
  border: 2px dashed rgba(248, 250, 252, 0.45);
  background: rgba(15, 23, 42, 0.35);
}
.cook-button {
  pointer-events: auto;
  border: 0;
  border-radius: 999px;
  padding: 0.65rem 1.4rem;
  font-weight: 700;
  background: #ff4081;
  color: #fff;
}
#pantry-grid {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.75rem;
  z-index: 5;
  pointer-events: auto;
}
.pantry-card {
  min-height: 4.5rem;
  border-radius: 0.75rem;
  border: 2px solid rgba(248, 250, 252, 0.35);
  background: rgba(15, 23, 42, 0.55);
  touch-action: none;
}
#hud {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  right: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  z-index: 6;
  pointer-events: none;
}
.hud-chip {
  background: rgba(15, 23, 42, 0.72);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
}
#status-line {
  position: fixed;
  left: 50%;
  bottom: 5.5rem;
  transform: translateX(-50%);
  z-index: 6;
  pointer-events: none;
}
`;
}

export function buildLaneMainTsExtras(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return '';
    return `
const pantryGrid = document.getElementById('pantry-grid');
const slotRow = document.getElementById('slot-row');
const cookButton = document.getElementById('cook-button');
const customerBubble = document.getElementById('customer-bubble');

function ensurePantryCards(count = 6) {
  if (!pantryGrid) return;
  if (pantryGrid.childElementCount >= count) return;
  pantryGrid.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement('div');
    card.className = 'pantry-card';
    card.dataset.ingredientIndex = String(i);
    pantryGrid.appendChild(card);
  }
}

function ensureCookingUi() {
  ensurePantryCards(6);
  if (!Array.isArray(state.pantry)) state.pantry = [];
  if (!Array.isArray(state.cauldronSlots) || state.cauldronSlots.length !== 3) {
    state.cauldronSlots = [null, null, null];
  }
}

export function spawnNextCustomer() {
  ensureCookingUi();
  state.currentCustomer = state.currentCustomer || { id: 'customer_0', order: [] };
  state.customerPatience = state.customerPatience || 30;
  state.customerExpression = state.customerExpression || 'waiting';
  return state.currentCustomer;
}

export function handlePantryInput() {
  ensureCookingUi();
  return { pantry: state.pantry.length, slots: state.cauldronSlots.slice() };
}

export function tryCookOrder() {
  ensureCookingUi();
  const filled = state.cauldronSlots.filter(Boolean).length;
  state.cookFeedback = filled > 0 ? 'cooking' : 'empty';
  state.cookFeedbackTimer = 0.5;
  return { cooked: filled > 0, slots: state.cauldronSlots.slice() };
}

function wireCookingControls() {
  if (cookButton) {
    cookButton.addEventListener('click', () => {
      tryCookOrder();
      renderAll();
    });
  }
}
`;
}

export function buildLaneProbeExtras(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return '';
    return `
  placeIngredient(slotIndex = 0, ingredientId = 'item') {
    ensureCookingUi();
    const idx = Math.max(0, Math.min(2, Number(slotIndex) || 0));
    state.cauldronSlots[idx] = ingredientId;
    return { placed: true, slotIndex: idx, ingredientId, slots: state.cauldronSlots.slice() };
  },
  triggerCooking() {
    return tryCookOrder();
  },
  serveOrder() {
    const result = tryCookOrder();
    if (result.cooked) {
      state.score = (state.score || 0) + 10;
      state.cauldronSlots = [null, null, null];
      state.cookFeedback = 'success';
      state.successFlash = 0.35;
    }
    return { served: result.cooked, score: state.score || 0 };
  },
  spawnCustomer() {
    return spawnNextCustomer();
  },`;
}

export function buildLaneLifecycleExtras(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return '';
    return `
ensureCookingUi();
wireCookingControls();
spawnNextCustomer();`;
}

export function summarizeLaneScaffoldForImplement(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return null;
    return {
        lane: foundation.lane,
        scaffoldOwned: [
            'pantry grid DOM (#pantry-grid)',
            '3 cauldron slot wells (#slot-row)',
            'COOK button (#cook-button)',
            'customer bubble shell (#customer-bubble)',
            'state.pantry, state.cauldronSlots, timers, drag, customer fields',
            'spawnCustomer / handlePantryInput / tryCookOrder helpers',
            'placeIngredient / triggerCooking / serveOrder probe stubs',
        ],
        agentScope: [
            'Wire drag-and-drop from pantry cards into slot wells',
            'Render ingredient/customer sprites with getAssetImage',
            'Implement order matching, patience timer, shift timer, scoring',
            'Fill customer bubble icons and feedback animations',
            'Do NOT redeclare scaffold state keys or duplicate DOM ids',
        ],
    };
}
