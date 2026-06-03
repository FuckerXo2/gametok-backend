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

export function isRunnerOrHighwayLane(foundation = {}) {
    const lane = asString(foundation.lane, '').toLowerCase();
    const loops = asArray(foundation.interactionLoops).join(' ').toLowerCase();
    const text = `${lane} ${loops}`;
    return /runner|highway|freeway|endless_run|lane_swipe|fuel_rush|road_rush|traffic/i.test(text)
        || (asString(foundation.perspective, '').toLowerCase() === 'top_down'
            && /lane|fuel|distance|highway|swipe/i.test(text));
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

export const COOKING_ONLY_STATE_KEYS = [
    'pantry',
    'cauldronSlots',
    'cookingSlots',
    'orderQueue',
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
];

export function stripCookingStateLeaksFromSource(source = '', foundation = {}) {
    if (isTimedOrderCookingLane(foundation)) {
        return { content: source, changed: false, removed: [] };
    }
    const removed = [];
    const lines = String(source || '').split('\n');
    const kept = lines.filter((line) => {
        const hit = COOKING_ONLY_STATE_KEYS.find((key) => new RegExp(`\\bstate\\.${key}\\b`).test(line));
        if (hit) {
            removed.push(hit);
            return false;
        }
        return true;
    });
    const content = kept.join('\n');
    return {
        content,
        changed: content !== source,
        removed: [...new Set(removed)],
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
    if (isRunnerOrHighwayLane(foundation)) {
        return {
            lane: foundation.lane,
            hudAuthority: 'agent',
            agentOwnsLayout: [
                'Highway HUD example: fuel meter top-left, distance top-right — pixel-framed panels, not three kernel chips',
                'Implement hudDesign in #hud + styles.css + drawHud(); gameplay on canvas only',
            ],
        };
    }
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
