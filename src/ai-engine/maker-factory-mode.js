/** Factory policy: trust Phase 1.5 + compile + sandbox; block only asset-critical preflight. */

/** Preflight issue IDs that still block jobs when GAMETOK_FACTORY_MINIMAL is on. */
export const FACTORY_MINIMAL_BLOCKING_PREFLIGHT_IDS = new Set([
    'preflight_required_asset_slots_unreferenced',
    'preflight_asset_key_missing_from_pack',
    'preflight_background_not_wired',
    'preflight_item_not_wired',
    'preflight_prop_not_wired',
    'preflight_obstacle_not_wired',
]);

export function isMakerFactoryMinimalMode() {
    const raw = process.env.GAMETOK_FACTORY_MINIMAL;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return true;
    }
    return String(raw).toLowerCase() !== 'false';
}

export function isFactoryMinimalBlockingPreflightIssue(issueId = '') {
    return FACTORY_MINIMAL_BLOCKING_PREFLIGHT_IDS.has(String(issueId || ''));
}

export function shouldBlockOnPreflight(preflight = {}, factoryMinimal = isMakerFactoryMinimalMode()) {
    if (!preflight?.success) {
        if (!factoryMinimal) return true;
        return (preflight.issues || []).some(
            (issue) => issue.severity === 'critical' && isFactoryMinimalBlockingPreflightIssue(issue.id),
        );
    }
    return false;
}

export function resolveMakerAgentInspectionTurns(assetSlotCount = 0) {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_INSPECTION_TURNS);
    let fallback = isMakerFactoryMinimalMode() ? 2 : 3;
    if (!Number.isFinite(envTurns) && Number(assetSlotCount) >= 7) {
        fallback = 3;
    }
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(4, requested));
}

export function resolveMakerAgentImplementTurns(maxTurns = resolveMakerAgentInspectionTurns()) {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_TURNS);
    const fallback = isMakerFactoryMinimalMode() ? 1 : 2;
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(Math.max(1, maxTurns - 1), requested));
}
