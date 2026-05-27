import assert from 'node:assert/strict';
import {
    encodeMakerFileContent,
    getMakerFileJsonSchemaExample,
    normalizeMakerFileEdit,
    normalizeMakerProtocolResponse,
    validateMakerFileContent,
    validateMakerProtocolJsonPayload,
} from '../src/ai-engine/maker-agent-response.js';

const sample = 'const x = "quotes\\n and \\ backslashes";\n';

const normalized = normalizeMakerFileEdit({
    path: 'src/main.ts',
    contentEncoding: 'base64',
    content: encodeMakerFileContent(sample),
});
assert.equal(normalized.content, sample);

const schema = getMakerFileJsonSchemaExample();
assert.equal(schema.protocolVersion, 2);
assert.equal(Array.isArray(schema.patches), true);

const parsed = normalizeMakerProtocolResponse({
    protocolVersion: 2,
    patches: schema.patches,
    notes: ['ok'],
});
assert.equal(parsed.patches.length, 1);

validateMakerProtocolJsonPayload({
    protocolVersion: 2,
    patches: schema.patches,
});

assert.throws(
    () => validateMakerFileContent('src/main.ts', 'x'.repeat(300)),
    /single-line blob/,
);

console.log('check-maker-agent-response: ok');
