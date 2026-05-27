import assert from 'node:assert/strict';
import { analyzeAnimations } from '../src/ai-engine/maker-asset-quality.js';

const hitOnly = analyzeAnimations({
    assets: { player_hit_05: 'data:image/png;base64,abc' },
    animations: [{
        key: 'player_hit',
        type: 'frame_sequence',
        frames: ['player_hit_05'],
    }],
});
const hitFrameIssue = hitOnly.issues.find((entry) => entry.id === 'animation_too_few_frames');
assert.ok(hitFrameIssue, 'expected animation_too_few_frames issue');
assert.equal(hitFrameIssue.severity, 'warning', 'legacy single-frame hit should warn, not fail');

const idleOnly = analyzeAnimations({
    assets: { player_idle_01: 'data:image/png;base64,abc' },
    animations: [{
        key: 'player_idle',
        type: 'frame_sequence',
        frames: ['player_idle_01'],
    }],
});
const idleFrameIssue = idleOnly.issues.find((entry) => entry.id === 'animation_too_few_frames');
assert.ok(idleFrameIssue, 'expected animation_too_few_frames issue');
assert.equal(idleFrameIssue.severity, 'fatal', 'single-frame idle should still fail');

const hitPair = analyzeAnimations({
    assets: {
        player_hit_05: 'data:image/png;base64,abc',
        player_hit_06: 'data:image/png;base64,def',
    },
    animations: [{
        key: 'player_hit',
        type: 'frame_sequence',
        frames: ['player_hit_05', 'player_hit_06'],
    }],
});
assert.equal(hitPair.issues.length, 0, 'two-frame hit animation should pass');

console.log('✅ sandbox probe / animation quality checks passed');
