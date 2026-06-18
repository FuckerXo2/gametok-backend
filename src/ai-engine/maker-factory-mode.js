/** Factory policy: trust Phase 1.5 + compile + sandbox; block only asset-critical preflight. */

/** Preflight issue IDs that still block jobs when GAMETOK_FACTORY_MINIMAL is on. */
export const FACTORY_MINIMAL_BLOCKING_PREFLIGHT_IDS = new Set([
    'preflight_required_asset_slots_unreferenced',
    'preflight_asset_key_missing_from_pack',
    'preflight_background_not_wired',
    'preflight_item_not_wired',
    'preflight_prop_not_wired',
    'preflight_obstacle_not_wired',
    'preflight_threejs_phase2_todo_remaining',
    'preflight_threejs_runner_required_functions_missing',
    // Obstacle storage consistency (replaces the old refs-only / state-only ids,
    // which were removed when collectObstacleConsistencyIssues landed). Without
    // these entries the obstacle crash slipped past preflight into the sandbox.
    'preflight_threejs_obstacle_holder_uninitialized',
    'preflight_threejs_obstacle_storage_split',
    // 3D render-pipeline gate: the headless sandbox bypasses WebGL, so a broken
    // render pipeline (missing render call / loop / camera / lights) would
    // otherwise ship unverified. Static check: collectThreeRenderReadinessIssues.
    'preflight_threejs_render_pipeline_broken',
]);

/**
 * FREE BUILD experiment: when on (default), the threejs lane stops clamping the
 * model with the graft + runner-contract checks and lets DeepSeek V4 Pro build the
 * whole game freely (recipes + high reasoning). The universal "must actually
 * render" preflight floor still applies. Flip GAMETOK_FREE_BUILD=off to instantly
 * restore the templated/graft pipeline (no redeploy); archive/templated-pipeline
 * git tag is the full snapshot.
 */
export function isFreeBuildMode() {
    const raw = process.env.GAMETOK_FREE_BUILD;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return true;
    }
    const v = String(raw).trim().toLowerCase();
    return v !== 'off' && v !== 'false' && v !== '0' && v !== 'no';
}

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

export function resolveMakerAgentInspectionTurns(assetSlotCount = 0, { freeBuild3D = false } = {}) {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_INSPECTION_TURNS);
    let fallback = isMakerFactoryMinimalMode() ? 2 : 3;
    // Scale repair budget with game complexity (asset-slot count is a good proxy). A 15-slot game
    // has far more surface area for bugs than a 7-slot one but used to get the same 3 turns and die
    // at the buzzer. Bigger games get one extra repair turn; simple games stay at 2 and stay fast.
    const slots = Number(assetSlotCount) || 0;
    if (!Number.isFinite(envTurns)) {
        if (slots >= 12) fallback = 4;
        else if (slots >= 7) fallback = 3;
        // Free-build 3D games are multi-file TypeScript (8+ files) regardless of asset count —
        // the asset-slot proxy badly understates their complexity. A 0-slot procedural 3D racer
        // is harder to converge than a 12-slot 2D game, so it needs MORE repair budget, not the
        // minimum. Floor free-build 3D at 1 implement + 2 repair so a single bad rewrite isn't fatal.
        if (freeBuild3D) fallback = Math.max(fallback, 3);
    }
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(5, requested));
}

export function resolveMakerAgentImplementTurns(maxTurns = resolveMakerAgentInspectionTurns()) {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_TURNS);
    const fallback = isMakerFactoryMinimalMode() ? 2 : 2;
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(Math.max(1, maxTurns - 1), requested));
}
