import assert from 'node:assert/strict';
import {
    decodeBase64FileContent,
    encodeMakerFileContent,
    getMakerFileJsonSchemaExample,
    normalizeMakerFileEdit,
    normalizeMakerProtocolResponse,
    repairBase64Payload,
    validateMakerFileContent,
    validateMakerProtocolJsonPayload,
} from '../src/ai-engine/maker-agent-response.js';

const sample = 'const x = "quotes\\n and \\ backslashes";\n';

const normalized = normalizeMakerFileEdit({
    path: 'src/main.ts',
    contentEncoding: 'base64',
    content: encodeMakerFileContent(sample),
});
assert.equal(normalized.path, 'src/main.ts');
assert.equal(normalized.content, sample);

const unpadded = encodeMakerFileContent('import "./styles.css";\n').replace(/=+$/, '');
const repaired = repairBase64Payload(unpadded);
assert.equal(decodeBase64FileContent(repaired, 'src/main.ts'), 'import "./styles.css";\n');

const fullB64 = encodeMakerFileContent('import "./styles.css";\n');
const chunked = normalizeMakerFileEdit({
    path: 'src/main.ts',
    contentEncoding: 'base64',
    contentParts: [fullB64.slice(0, 16), fullB64.slice(16)],
});
assert.equal(chunked.content, 'import "./styles.css";\n');

const legacy = normalizeMakerFileEdit({
    path: 'src/styles.css',
    content: 'body { margin: 0; }',
});
assert.equal(legacy.content, 'body { margin: 0; }');

const utf16Payload = Buffer.from('import "./styles.css";\n', 'utf16le').toString('base64');
const utf16Decoded = decodeBase64FileContent(utf16Payload, 'src/main.ts');
assert.equal(utf16Decoded, 'import "./styles.css";\n');

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

validateMakerProtocolJsonPayload({
    files: [{
        path: 'src/main.ts',
        contentEncoding: 'base64',
        content: encodeMakerFileContent('export {};\n'),
    }],
});

const roundTrip = JSON.parse(JSON.stringify(getMakerFileJsonSchemaExample()));
assert.equal(Array.isArray(roundTrip.files[0].contentParts), true);

assert.throws(
    () => validateMakerFileContent('src/main.ts', 'x'.repeat(300)),
    /single-line blob/,
);

console.log('check-maker-agent-response: ok');
