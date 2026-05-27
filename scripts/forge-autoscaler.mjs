import { buildForgeAutoscaleReport, runForgeAutoscaleTick } from '../src/ai-engine/forge-autoscale.js';

const dryRun = process.argv.includes('--dry-run');
const reportOnly = process.argv.includes('--report');

if (reportOnly) {
    const report = await buildForgeAutoscaleReport();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
}

const result = await runForgeAutoscaleTick({ apply: !dryRun });
console.log(JSON.stringify(result, null, 2));
