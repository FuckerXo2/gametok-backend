/** Post-Phase-1.5 safety only — no lane/template overrides. Trust foundation architect output. */

export const COOKING_ONLY_STATE_KEYS = [
    'pantry',
    'cauldronSlots',
    'cookingSlots',
    'orderQueue',
    'activeOrder',
    'currentCustomer',
    'customerPatience',
    'shiftTimer',
    'cookFeedback',
    'cookFeedbackTimer',
    'customerType',
    'customerExpression',
    'bubbleTimer',
    'orderCooldown',
];

export function foundationExpectsCookingState(foundation = {}) {
    const required = Array.isArray(foundation.requiredState) ? foundation.requiredState : [];
    return COOKING_ONLY_STATE_KEYS.some((key) => required.includes(key));
}

/** Remove cooking-only state.* references when the architect did not require those keys. */
export function stripCookingStateLeaksFromSource(source = '', foundation = {}) {
    if (foundationExpectsCookingState(foundation)) {
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
