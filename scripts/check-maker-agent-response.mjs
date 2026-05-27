import assert from 'node:assert/strict';
import {
    encodeMakerFileContent,
    getMakerFileJsonSchemaExample,
    normalizeMakerFileEdit,
    normalizeMakerProtocolResponse,
} from '../src/ai-engine/maker-agent-response.js';

const sample = 'const x = "quotes\\n and \\ backslashes";\n';

const normalized = normalizeMakerFileEdit({
    path: 'src/main.ts',
    contentEncoding: 'base64',
    content: encodeMakerFileContent(sample),
});
assert.equal(normalized.path, 'src/main.ts');
assert.equal(normalized.content, sample);

const legacy = normalizeMakerFileEdit({
    path: 'src/styles.css',
    content: 'body { margin: 0; }',
});
assert.equal(legacy.content, 'body { margin: 0; }');

const parsed = normalizeMakerProtocolResponse({
    files: [
        {
            path: 'src/main.ts',
            contentEncoding: 'base64',
            content: encodeMakerFileContent('export {};\n'),
        },
    ],
    notes: ['ok'],
});
assert.equal(parsed.files.length, 1);
assert.equal(parsed.files[0].content, 'export {};\n');

const roundTrip = JSON.parse(JSON.stringify(getMakerFileJsonSchemaExample()));
assert.equal(typeof roundTrip.files[0].content, 'string');

console.log('check-maker-agent-response: ok');
