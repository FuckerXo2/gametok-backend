/** Factory policy: trust Phase 1.5 + compile + sandbox; avoid preflight blocking and state auto-mutation. */

export function isMakerFactoryMinimalMode() {
    const raw = process.env.GAMETOK_FACTORY_MINIMAL;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return true;
    }
    return String(raw).toLowerCase() !== 'false';
}

export function resolveMakerAgentInspectionTurns() {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_INSPECTION_TURNS);
    const fallback = isMakerFactoryMinimalMode() ? 2 : 3;
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(4, requested));
}

export function resolveMakerAgentImplementTurns(maxTurns = resolveMakerAgentInspectionTurns()) {
    const envTurns = Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_TURNS);
    const fallback = isMakerFactoryMinimalMode() ? 1 : 2;
    const requested = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : fallback;
    return Math.max(1, Math.min(Math.max(1, maxTurns - 1), requested));
}
