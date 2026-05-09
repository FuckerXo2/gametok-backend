import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeDreamSpec } from '../src/ai-engine/spec-normalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const benchmarkPath = path.resolve(__dirname, '../docs/dreamstream-capability-benchmark.json');
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

let failures = 0;

for (const item of benchmark) {
  const spec = normalizeDreamSpec({
    title: item.id,
    genre: 'Benchmark',
    summary: item.prompt,
    coreMechanics: [],
    visualStyle: 'STYLIZED_3D',
    atmosphere: 'Bright & Cheerful',
    cameraPerspective: 'AUTO',
    environmentType: 'ARENA',
    preferredEngine: 'AUTO',
    entities: {},
    capabilityIntents: [],
  }, item.prompt);

  const actual = new Set((spec.capabilities || []).map((capability) => capability.id));
  const missing = (item.expectedCapabilities || []).filter((id) => !actual.has(id));

  if (missing.length > 0) {
    failures += 1;
    console.error(`FAIL ${item.id}: missing ${missing.join(', ')}`);
    console.error(`  actual: ${Array.from(actual).join(', ') || '(none)'}`);
  } else {
    console.log(`PASS ${item.id}: ${Array.from(actual).join(', ')}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} capability benchmark(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${benchmark.length} capability benchmarks passed.`);
