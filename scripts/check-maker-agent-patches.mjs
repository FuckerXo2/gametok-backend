import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    applyPatchReplacements,
    getMakerPatchJsonSchemaExample,
    normalizeMakerPatchesFromParsed,
    validateMakerPatchProtocolPayload,
} from '../src/ai-engine/maker-agent-patches.js';
import { normalizeMakerProtocolResponse, validateMakerProtocolJsonPayload } from '../src/ai-engine/maker-agent-response.js';

const source = [
    'import "./styles.css";',
    '',
    'export function stepGame(dt = 16) {',
    '  if (state.gameOver) return;',
    '  // TODO: Phase 2 agent implements timed_order_cooking loop here.',
    '}',
    '',
].join('\n');

const patched = applyPatchReplacements(source, [{
    find: '// TODO: Phase 2 agent implements timed_order_cooking loop here.',
    replace: '  updateCustomers(dt);',
}], { path: 'src/main.ts' });
assert.match(patched.content, /updateCustomers\(dt\)/);

const parsed = normalizeMakerProtocolResponse({
    protocolVersion: 2,
    kind: 'maker_protocol_patch',
    patches: [{
        path: 'src/main.ts',
        replacements: [{
            find: '// TODO: Phase 2 agent implements timed_order_cooking loop here.',
            replace: '  updateCustomers(dt);',
        }],
    }],
});
assert.equal(parsed.patches.length, 1);

validateMakerPatchProtocolPayload({
    patches: getMakerPatchJsonSchemaExample().patches,
});

validateMakerProtocolJsonPayload({
    protocolVersion: 2,
    patches: getMakerPatchJsonSchemaExample().patches,
});

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gametok-patch-'));
try {
    await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'src/main.ts'), source, 'utf8');
    const { applyPatchReplacements: apply } = await import('../src/ai-engine/maker-agent-patches.js');
    const result = apply(source, normalizeMakerPatchesFromParsed({
        patches: [{
            path: 'src/main.ts',
            replacements: [{
                find: '// TODO: Phase 2 agent implements timed_order_cooking loop here.',
                replace: '  updateCustomers(dt);',
            }],
        }],
    })[0].replacements, { path: 'src/main.ts' });
    assert.match(result.content, /updateCustomers\(dt\)/);
} finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('check-maker-agent-patches: ok');
