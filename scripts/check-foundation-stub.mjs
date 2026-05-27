#!/usr/bin/env node
import { runFoundationStubFixtureChecks } from '../src/ai-engine/maker-foundation-stub-validator.js';

const compile = process.argv.includes('--compile');
const results = await runFoundationStubFixtureChecks({ compile });

let failed = 0;
for (const result of results) {
    if (result.ok) {
        console.log(`✅ ${result.id}${compile ? ' (static + tsc)' : ' (static)'}`);
        continue;
    }
    failed += 1;
    console.error(`❌ ${result.id}: ${result.message}`);
    if (result.note) console.error(`   ${result.note}`);
}

if (failed > 0) {
    console.error(`\nFoundation stub preflight failed for ${failed}/${results.length} fixture(s).`);
    process.exit(1);
}

console.log(`\nFoundation stub preflight passed for ${results.length} fixture(s).`);
