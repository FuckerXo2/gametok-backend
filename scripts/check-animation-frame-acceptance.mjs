import assert from 'node:assert/strict';
import {
    isAnimationFrameAssetKey,
    isBlockingAssetQualityIssue,
    softenAnimationFrameIssue,
} from '../src/ai-engine/maker-asset-quality.js';

assert.equal(isAnimationFrameAssetKey('player_idle_01'), true);
assert.equal(isAnimationFrameAssetKey('player'), false);
assert.equal(isAnimationFrameAssetKey('enemy1', { kind: 'animation_frame' }), true);

const blankFrame = {
    id: 'asset_blank_or_transparent',
    severity: 'fatal',
    key: 'player_idle_01',
    message: 'player_idle_01 appears blank or fully transparent.',
};
const softened = softenAnimationFrameIssue(blankFrame, { kind: 'animation_frame' }, 'player_idle_01');
assert.equal(softened.severity, 'warning');
assert.equal(isBlockingAssetQualityIssue(blankFrame), false);

const blankPlayer = {
    id: 'asset_blank_or_transparent',
    severity: 'fatal',
    key: 'player',
    message: 'player appears blank or fully transparent.',
};
assert.equal(isBlockingAssetQualityIssue(blankPlayer), true);

console.log('✅ animation frame acceptance checks passed');
