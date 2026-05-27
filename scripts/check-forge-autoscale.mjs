import assert from 'node:assert/strict';
import { computeForgeAutoscalePlan } from '../src/ai-engine/forge-autoscale.js';

const busy = computeForgeAutoscalePlan({
    running: 3,
    queued: 5,
    currentReplicas: 2,
    jobsPerReplica: 4,
    minReplicas: 1,
    maxReplicas: 12,
});
assert.equal(busy.desiredReplicas, 2, '8 demand / 4 per replica = 2 replicas');
assert.equal(busy.action, 'hold');

const spike = computeForgeAutoscalePlan({
    running: 8,
    queued: 4,
    currentReplicas: 2,
    jobsPerReplica: 4,
    minReplicas: 1,
    maxReplicas: 12,
});
assert.equal(spike.desiredReplicas, 3, '12 demand needs 3 replicas');
assert.equal(spike.action, 'scale_up');

const idle = computeForgeAutoscalePlan({
    running: 0,
    queued: 0,
    currentReplicas: 4,
    jobsPerReplica: 4,
    minReplicas: 1,
    maxReplicas: 12,
    lastDemandAt: Date.now() - (11 * 60 * 1000),
});
assert.equal(idle.desiredReplicas, 1);
assert.equal(idle.action, 'scale_down');

console.log('✅ forge autoscale checks passed');
