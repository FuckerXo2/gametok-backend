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
    for (const name of ['placeIngredient', 'triggerCooking', 'serveOrder', 'spawnCustomer']) {
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
    if (key === 'screenPhase' || key === 'screenState') return "'PLAYING'";
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

/** Guidance-only summary for Phase 2 — no pre-built DOM/layout shell. */
export function summarizeLaneScaffoldForImplement(foundation = {}) {
    if (!isTimedOrderCookingLane(foundation)) return null;
    return {
        lane: foundation.lane,
        mechanicalRequirements: [
            'Pantry ingredient picker, 3 cauldron slots, cook/serve action, customer order bubble',
            'Order matching, patience timer, shift timer, scoring, feedback particles',
            'Probes: placeIngredient, triggerCooking, serveOrder, spawnCustomer',
        ],
        requiredStateKeys: TIMED_ORDER_COOKING_STATE_DEFAULTS,
        agentOwnsLayout: [
            'Design index.html structure and src/styles.css for pantry, slots, bubble, HUD',
            'Wire touch/drag from pantry into slots; hide gameplay chrome on end states',
            'Use layoutComposition from foundation — do not duplicate UI on canvas and DOM',
        ],
    };
}
