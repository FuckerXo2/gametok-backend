import pool from '../db.js';

const RAILWAY_GRAPHQL_URL = process.env.RAILWAY_GRAPHQL_URL || 'https://backboard.railway.com/graphql/v2';
const IS_RAILWAY = Boolean(
    process.env.RAILWAY_ENVIRONMENT
    || process.env.RAILWAY_REPLICA_ID
    || process.env.RAILWAY_ENVIRONMENT_ID
    || process.env.RAILWAY_SERVICE_ID
);
const FORGE_AUTOSCALE_ENABLED = process.env.FORGE_AUTOSCALE_ENABLED === 'false'
    ? false
    : (process.env.FORGE_AUTOSCALE_ENABLED === 'true' || IS_RAILWAY);
const FORGE_AUTOSCALE_APPLY = process.env.FORGE_AUTOSCALE_APPLY !== 'false';
const FORGE_AUTOSCALE_INTERVAL_MS = Math.max(15000, Number(process.env.FORGE_AUTOSCALE_INTERVAL_MS || 30000));
const FORGE_AUTOSCALE_JOBS_PER_REPLICA = Math.max(1, Number(process.env.FORGE_AUTOSCALE_JOBS_PER_REPLICA || 4));
const FORGE_AUTOSCALE_MIN_REPLICAS = Math.max(1, Number(process.env.FORGE_AUTOSCALE_MIN_REPLICAS || 1));
const FORGE_AUTOSCALE_MAX_REPLICAS = Math.max(
    FORGE_AUTOSCALE_MIN_REPLICAS,
    Number(process.env.FORGE_AUTOSCALE_MAX_REPLICAS || (IS_RAILWAY ? 64 : 12))
);
const FORGE_AUTOSCALE_SCALE_DOWN_AFTER_MS = Math.max(
    60000,
    Number(process.env.FORGE_AUTOSCALE_SCALE_DOWN_AFTER_MS || 10 * 60 * 1000)
);
const FORGE_AUTOSCALE_ADVISORY_LOCK_KEY = 8450921;

const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID
    || process.env.RAILWAY_ENVIRONMENT
    || '';
const RAILWAY_FORGE_SERVICE_ID = process.env.RAILWAY_FORGE_SERVICE_ID
    || process.env.RAILWAY_SERVICE_ID
    || '';
const RAILWAY_FORGE_REGION = process.env.RAILWAY_FORGE_REGION
    || process.env.RAILWAY_REPLICA_REGION
    || process.env.RAILWAY_REGION
    || 'us-west1';

export function isForgeAutoscaleEnabled() {
    return FORGE_AUTOSCALE_ENABLED;
}

export function getForgeAutoscaleConfig() {
    return {
        enabled: FORGE_AUTOSCALE_ENABLED,
        apply: FORGE_AUTOSCALE_APPLY,
        isRailway: IS_RAILWAY,
        hasApiToken: Boolean(RAILWAY_API_TOKEN),
        environmentId: RAILWAY_ENVIRONMENT_ID || null,
        forgeServiceId: RAILWAY_FORGE_SERVICE_ID || null,
        region: RAILWAY_FORGE_REGION,
        jobsPerReplica: FORGE_AUTOSCALE_JOBS_PER_REPLICA,
        minReplicas: FORGE_AUTOSCALE_MIN_REPLICAS,
        maxReplicas: FORGE_AUTOSCALE_MAX_REPLICAS,
        intervalMs: FORGE_AUTOSCALE_INTERVAL_MS,
    };
}

const autoscalerState = {
    lastDemandAt: Date.now(),
    lastAppliedReplicas: null,
    lastTickAt: null,
    lastError: null,
    timer: null,
    stopping: false,
};

export function computeForgeAutoscalePlan({
    running = 0,
    queued = 0,
    currentReplicas = 1,
    jobsPerReplica = FORGE_AUTOSCALE_JOBS_PER_REPLICA,
    minReplicas = FORGE_AUTOSCALE_MIN_REPLICAS,
    maxReplicas = FORGE_AUTOSCALE_MAX_REPLICAS,
    scaleDownAfterMs = FORGE_AUTOSCALE_SCALE_DOWN_AFTER_MS,
    lastDemandAt = Date.now(),
    now = Date.now(),
} = {}) {
    const demand = Math.max(0, Number(running || 0) + Number(queued || 0));
    const safeCurrent = Math.max(minReplicas, Number(currentReplicas || minReplicas));
    let desiredReplicas = minReplicas;

    if (demand > 0) {
        desiredReplicas = Math.max(
            minReplicas,
            Math.min(maxReplicas, Math.ceil(demand / jobsPerReplica))
        );
    } else if ((now - lastDemandAt) >= scaleDownAfterMs) {
        desiredReplicas = minReplicas;
    } else {
        desiredReplicas = safeCurrent;
    }

    const freeSlots = Math.max(0, (safeCurrent * jobsPerReplica) - Number(running || 0));
    const queueRisk = Number(queued || 0) > 0 || (demand > 0 && freeSlots < Number(queued || 0));

    return {
        running: Number(running || 0),
        queued: Number(queued || 0),
        demand,
        jobsPerReplica,
        minReplicas,
        maxReplicas,
        currentReplicas: safeCurrent,
        desiredReplicas,
        freeSlots,
        queueRisk,
        shouldScale: desiredReplicas !== safeCurrent,
        action: desiredReplicas > safeCurrent
            ? 'scale_up'
            : desiredReplicas < safeCurrent
                ? 'scale_down'
                : 'hold',
        reason: demand > 0
            ? `Serving ${demand} active build(s) with ${desiredReplicas} forge replica(s).`
            : ((now - lastDemandAt) >= scaleDownAfterMs
                ? 'Forge idle; scaling down to minimum.'
                : 'Forge idle; holding replicas during cooldown.'),
    };
}

export async function getForgeQueueMetrics() {
    const result = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'running' AND kind = 'dream')::int AS running,
            COUNT(*) FILTER (WHERE status = 'queued' AND kind = 'dream')::int AS queued
         FROM generation_jobs`
    );
    return {
        running: Number(result.rows[0]?.running || 0),
        queued: Number(result.rows[0]?.queued || 0),
    };
}

async function railwayGraphql(query, variables = {}) {
    if (!RAILWAY_API_TOKEN) {
        throw new Error('RAILWAY_API_TOKEN is not configured');
    }
    const response = await fetch(RAILWAY_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RAILWAY_API_TOKEN}`,
        },
        body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errors?.length) {
        const message = payload.errors?.map((entry) => entry.message).join('; ')
            || `Railway GraphQL failed (${response.status})`;
        throw new Error(message);
    }
    return payload.data;
}

export async function getRailwayForgeReplicaCount() {
    if (!RAILWAY_ENVIRONMENT_ID || !RAILWAY_FORGE_SERVICE_ID) {
        return null;
    }
    const data = await railwayGraphql(
        `query ForgeReplicaCount($environmentId: String!) {
            environment(id: $environmentId) {
                serviceInstances {
                    edges {
                        node {
                            serviceId
                            numReplicas
                        }
                    }
                }
            }
        }`,
        { environmentId: RAILWAY_ENVIRONMENT_ID }
    );
    const instances = data?.environment?.serviceInstances?.edges || [];
    const match = instances.find((edge) => edge?.node?.serviceId === RAILWAY_FORGE_SERVICE_ID);
    return Number(match?.node?.numReplicas || FORGE_AUTOSCALE_MIN_REPLICAS);
}

export async function scaleRailwayForgeReplicas(desiredReplicas, commitMessage = 'Forge autoscaler') {
    if (!RAILWAY_ENVIRONMENT_ID || !RAILWAY_FORGE_SERVICE_ID) {
        throw new Error('RAILWAY_ENVIRONMENT_ID and RAILWAY_FORGE_SERVICE_ID are required');
    }
    const safeDesired = Math.max(
        FORGE_AUTOSCALE_MIN_REPLICAS,
        Math.min(FORGE_AUTOSCALE_MAX_REPLICAS, Number(desiredReplicas || FORGE_AUTOSCALE_MIN_REPLICAS))
    );
    const patch = {
        services: {
            [RAILWAY_FORGE_SERVICE_ID]: {
                deploy: {
                    multiRegionConfig: {
                        [RAILWAY_FORGE_REGION]: {
                            numReplicas: safeDesired,
                        },
                    },
                },
            },
        },
    };
    await railwayGraphql(
        `mutation ForgeAutoscaleCommit($environmentId: String!, $patch: EnvironmentConfig!, $commitMessage: String) {
            environmentPatchCommit(
                environmentId: $environmentId
                patch: $patch
                commitMessage: $commitMessage
            )
        }`,
        {
            environmentId: RAILWAY_ENVIRONMENT_ID,
            patch,
            commitMessage,
        }
    );
    return safeDesired;
}

async function tryAcquireAutoscalerLock() {
    const result = await pool.query('SELECT pg_try_advisory_lock($1) AS acquired', [FORGE_AUTOSCALE_ADVISORY_LOCK_KEY]);
    return Boolean(result.rows[0]?.acquired);
}

async function releaseAutoscalerLock() {
    await pool.query('SELECT pg_advisory_unlock($1)', [FORGE_AUTOSCALE_ADVISORY_LOCK_KEY]).catch(() => {});
}

export async function buildForgeAutoscaleReport(options = {}) {
    const metrics = await getForgeQueueMetrics();
    if (metrics.running > 0 || metrics.queued > 0) {
        autoscalerState.lastDemandAt = Date.now();
    }
    let currentReplicas = autoscalerState.lastAppliedReplicas || FORGE_AUTOSCALE_MIN_REPLICAS;
    try {
        const remoteReplicas = await getRailwayForgeReplicaCount();
        if (Number.isFinite(remoteReplicas) && remoteReplicas > 0) {
            currentReplicas = remoteReplicas;
        }
    } catch (error) {
        autoscalerState.lastError = error.message;
    }

    const plan = computeForgeAutoscalePlan({
        ...metrics,
        currentReplicas,
        lastDemandAt: autoscalerState.lastDemandAt,
    });
    return {
        enabled: FORGE_AUTOSCALE_ENABLED,
        apply: FORGE_AUTOSCALE_APPLY,
        intervalMs: FORGE_AUTOSCALE_INTERVAL_MS,
        forgeServiceId: RAILWAY_FORGE_SERVICE_ID || null,
        environmentId: RAILWAY_ENVIRONMENT_ID || null,
        region: RAILWAY_FORGE_REGION,
        ...plan,
        lastTickAt: autoscalerState.lastTickAt,
        lastError: autoscalerState.lastError,
    };
}

export async function runForgeAutoscaleTick({ apply = FORGE_AUTOSCALE_APPLY } = {}) {
    if (!FORGE_AUTOSCALE_ENABLED) {
        return { skipped: true, reason: 'FORGE_AUTOSCALE_ENABLED is not true' };
    }

    const locked = await tryAcquireAutoscalerLock();
    if (!locked) {
        return { skipped: true, reason: 'Another autoscaler leader is already running' };
    }

    try {
        const report = await buildForgeAutoscaleReport();
        autoscalerState.lastTickAt = new Date().toISOString();

        if (!report.shouldScale) {
            console.log(`[Forge Autoscale] hold replicas=${report.currentReplicas} running=${report.running} queued=${report.queued}`);
            return { ...report, applied: false };
        }

        if (!apply) {
            console.log(`[Forge Autoscale] dry-run ${report.action} ${report.currentReplicas} -> ${report.desiredReplicas} (${report.reason})`);
            return { ...report, applied: false, dryRun: true };
        }

        if (!RAILWAY_API_TOKEN) {
            const message = 'RAILWAY_API_TOKEN not set; using in-box burst concurrency only (add one project token to enable replica autoscaling)';
            if (!autoscalerState.lastError || autoscalerState.lastError !== message) {
                autoscalerState.lastError = message;
                console.warn(`[Forge Autoscale] ${message}`);
            }
            return { ...report, applied: false, error: message, mode: 'burst_only' };
        }

        if (!RAILWAY_ENVIRONMENT_ID || !RAILWAY_FORGE_SERVICE_ID) {
            const message = 'Railway service/environment IDs unavailable; using in-box burst concurrency only';
            autoscalerState.lastError = message;
            console.warn(`[Forge Autoscale] ${message}`);
            return { ...report, applied: false, error: message, mode: 'burst_only' };
        }

        const appliedReplicas = await scaleRailwayForgeReplicas(
            report.desiredReplicas,
            `[Forge Autoscale] ${report.action} ${report.currentReplicas} -> ${report.desiredReplicas} (running=${report.running}, queued=${report.queued})`
        );
        autoscalerState.lastAppliedReplicas = appliedReplicas;
        autoscalerState.lastError = null;
        console.log(`[Forge Autoscale] applied ${report.action} replicas=${appliedReplicas} running=${report.running} queued=${report.queued}`);
        return { ...report, desiredReplicas: appliedReplicas, applied: true };
    } catch (error) {
        autoscalerState.lastError = error.message;
        console.error('[Forge Autoscale] tick failed:', error);
        throw error;
    } finally {
        await releaseAutoscalerLock();
    }
}

export function startForgeAutoscaler() {
    if (!FORGE_AUTOSCALE_ENABLED || autoscalerState.timer) {
        if (!FORGE_AUTOSCALE_ENABLED) {
            console.log('[Forge Autoscale] Disabled on this replica');
        }
        return;
    }
    autoscalerState.stopping = false;
    const config = getForgeAutoscaleConfig();
    console.log(
        `[Forge Autoscale] Leader loop started on Railway=${config.isRailway} interval=${FORGE_AUTOSCALE_INTERVAL_MS}ms jobsPerReplica=${FORGE_AUTOSCALE_JOBS_PER_REPLICA} min=${FORGE_AUTOSCALE_MIN_REPLICAS} max=${FORGE_AUTOSCALE_MAX_REPLICAS} env=${config.environmentId || 'auto-missing'} service=${config.forgeServiceId || 'auto-missing'} apiToken=${config.hasApiToken ? 'yes' : 'no'}`
    );
    if (!config.hasApiToken) {
        console.warn('[Forge Autoscale] Horizontal scale locked: add RAILWAY_API_TOKEN once at the Railway project level to spin up more forge boxes on demand.');
    } else {
        console.log(`[Forge Autoscale] Horizontal scale armed (up to ${FORGE_AUTOSCALE_MAX_REPLICAS} replicas, ${FORGE_AUTOSCALE_JOBS_PER_REPLICA} builds each).`);
    }

    const tick = () => {
        if (autoscalerState.stopping) return;
        void runForgeAutoscaleTick().catch((error) => {
            console.error('[Forge Autoscale] background tick failed:', error?.message || error);
        }).finally(() => {
            if (!autoscalerState.stopping) {
                autoscalerState.timer = setTimeout(tick, FORGE_AUTOSCALE_INTERVAL_MS);
                autoscalerState.timer.unref?.();
            }
        });
    };

    autoscalerState.timer = setTimeout(tick, 5000);
    autoscalerState.timer.unref?.();
}

export function stopForgeAutoscaler() {
    autoscalerState.stopping = true;
    if (autoscalerState.timer) {
        clearTimeout(autoscalerState.timer);
        autoscalerState.timer = null;
    }
}
