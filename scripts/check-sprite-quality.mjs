import assert from 'node:assert/strict';
import { inspectGeneratedAssetDataUri } from '../src/ai-engine/sprite-generator.js';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tiny = await inspectGeneratedAssetDataUri(tinyPng, { width: 128, height: 128, category: 'enemy' });
assert.equal(tiny.ok, false, '1x1 png should fail sprite quality inspection');

const sharp = (await import('sharp')).default;
const visibleBuffer = await sharp({
    create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 120, g: 40, b: 200, alpha: 255 },
    },
}).png().toBuffer();
const visibleUri = `data:image/png;base64,${visibleBuffer.toString('base64')}`;
const visible = await inspectGeneratedAssetDataUri(visibleUri, { width: 64, height: 64, category: 'enemy' });
assert.equal(visible.ok, true, 'solid visible png should pass');

console.log('✅ sprite quality inspection checks passed');
