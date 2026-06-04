#!/usr/bin/env node
/**
 * Maker reliability auditor.
 *
 * Turns a raw Railway log export (one or many Dream jobs) into a clean reliability report:
 * per-job pass/fail, failure class, phase timings, loopObserved, lane/foundation, slot count —
 * plus aggregate pass rate and a failure-class histogram.
 *
 * Usage:
 *   npm run audit:reliability -- path/to/railway.log
 *   pbpaste | npm run audit:reliability          (read from stdin)
 *   npm run audit:reliability -- railway.log --json
 */
import fs from 'fs/promises';

const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/;

function ts(line) {
    const m = line.match(TS);
    return m ? Date.parse(m[1]) : null;
}

function classifyFailure(message = '') {
    const m = String(message);
    // Root cause first — "finished without a passing project" is a generic wrapper that usually
    // contains the real reason (a preflight or gate). Only fall back to phase2_exhausted when no
    // specific cause is recognizable inside it.
    if (/asset keys that are not in/i.test(m)) return 'preflight_asset_key';
    if (/persistent asset slots not rendered|background art not rendered|required roles were only|asset slots are not connected/i.test(m)) return 'boot_render_gate';
    if (/required contract art incomplete|PHASE2_ASSET_PACK_INCOMPLETE|art generation failed/i.test(m)) return 'art_gate';
    if (/state properties not declared/i.test(m)) return 'preflight_state';
    if (/Phase 1\.5 foundation architect failed/i.test(m)) return 'phase1_5_llm';
    if (/Phase 1 spec extraction failed/i.test(m)) return 'phase1_llm';
    if (/Stream stalled|provider_queue|connect_hang|provider_empty_response/i.test(m)) return 'provider_timeout';
    if (/finished without a passing project/i.test(m)) return 'phase2_exhausted';
    if (m) return 'other';
    return 'unknown';
}

function splitJobs(text) {
    const lines = text.split(/\r?\n/);
    const jobs = [];
    let current = null;
    let pendingConcept = null;
    let pendingTitle = null;

    for (const line of lines) {
        const conceptMatch = line.match(/Creating job for [^>]*->\s*Concept:\s*"?(.+)$/);
        if (conceptMatch) pendingConcept = conceptMatch[1].replace(/"$/, '').slice(0, 90);
        const titleMatch = line.match(/^\s*(?:\S+\s+)?Title:\s*(.+?)\s*$/) || line.match(/Title:\s*(.+?)\s*$/);
        if (titleMatch && !/foundation=/.test(line)) pendingTitle = titleMatch[1].slice(0, 50);

        const start = line.match(/\[DREAM JOB\] Started DreamStream structured pipeline for job:\s*([0-9a-f-]+)/);
        if (start) {
            current = {
                id: start[1],
                concept: pendingConcept,
                title: pendingTitle,
                startTs: ts(line),
                lines: [],
                ttfbs: [],
                phase15Ts: null,
                artistTs: null,
                phase2Ts: null,
                endTs: null,
                lane: null,
                foundation: null,
                slots: null,
                maxTurns: null,
                turnsUsed: 0,
                loopObserved: null,
                probePass: null,
                result: 'incomplete',
                failure: null,
                failureClass: null,
            };
            jobs.push(current);
            pendingConcept = null;
            pendingTitle = null;
            continue;
        }
        if (!current) continue;
        current.lines.push(line);

        let m;
        if ((m = line.match(/first chunk ttfbMs=(\d+)/))) current.ttfbs.push({ ms: Number(m[1]), t: ts(line) });
        if (/🏗️ Phase 1\.5\/3:/.test(line)) current.phase15Ts = ts(line);
        if (/🎨 Artist Agent: (Planning|Generating)/.test(line) && !current.artistTs) current.artistTs = ts(line);
        if (/🔨 Phase 2\/3:/.test(line)) current.phase2Ts = ts(line);
        if ((m = line.match(/Phase 1\.5:\s*".*?"\s*foundation=(\S+)\s*lane=(\S+)/))) {
            current.foundation = m[1];
            current.lane = m[2];
        }
        if ((m = line.match(/Asset contract:\s*(\d+)\s*slots/))) current.slots = Number(m[1]);
        if ((m = line.match(/Agent loop policy:.*maxTurns=(\d+)/))) current.maxTurns = Number(m[1]);
        if ((m = line.match(/Phase 2 File Agent Turn (\d+)/))) current.turnsUsed = Math.max(current.turnsUsed, Number(m[1]));
        if ((m = line.match(/\[Sandbox Probe\].*?(pass|FAIL).*?loopObserved=(true|false)/))) {
            current.probePass = m[1] === 'pass';
            current.loopObserved = m[2] === 'true';
        }
        if (/\[DREAM JOB\] Complete!/.test(line)) {
            current.result = 'completed';
            current.endTs = ts(line);
        }
        if ((m = line.match(/(?:\[GEN QUEUE\] Job \S+ failed|\[DREAM JOB\] Error):\s*(?:Error:\s*)?(.+)$/))) {
            if (current.result !== 'completed') {
                current.result = 'failed';
                current.failure = m[1].slice(0, 160);
                current.failureClass = classifyFailure(m[1]);
                current.endTs = current.endTs || ts(line);
            }
        }
    }
    return jobs;
}

function secs(a, b) {
    if (a == null || b == null) return null;
    const d = Math.round((b - a) / 1000);
    return d < 0 ? null : d;
}

function fmt(n, unit = 's') {
    return n == null ? '—' : `${n}${unit}`;
}

function median(values) {
    const v = values.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function report(jobs) {
    if (!jobs.length) {
        console.log('No Dream jobs found in input. (Looking for "[DREAM JOB] Started DreamStream ... for job:")');
        return;
    }
    console.log(`\n=== Maker Reliability Audit — ${jobs.length} job(s) ===\n`);
    for (const j of jobs) {
        const p1ttfb = j.ttfbs[0]?.ms != null ? Math.round(j.ttfbs[0].ms / 1000) : null;
        const total = secs(j.startTs, j.endTs);
        const artist = secs(j.artistTs, j.phase2Ts);
        const phase2 = secs(j.phase2Ts, j.endTs);
        const icon = j.result === 'completed' ? '✅' : j.result === 'failed' ? '❌' : '⏳';
        const label = j.title || j.concept || j.id.slice(0, 8);
        console.log(`${icon} ${label}`);
        console.log(`   lane=${j.lane || '?'} slots=${fmt(j.slots, '')} turns=${j.turnsUsed}/${fmt(j.maxTurns, '')} loopObserved=${j.loopObserved ?? '?'}`);
        console.log(`   time: total=${fmt(total)} phase1_ttfb=${fmt(p1ttfb)} artist=${fmt(artist)} phase2=${fmt(phase2)}`);
        if (j.result === 'failed') console.log(`   FAILURE [${j.failureClass}]: ${j.failure}`);
        console.log('');
    }

    const completed = jobs.filter((j) => j.result === 'completed');
    const failed = jobs.filter((j) => j.result === 'failed');
    const rate = Math.round((completed.length / jobs.length) * 100);
    console.log('--- Aggregate ---');
    console.log(`pass rate: ${completed.length}/${jobs.length} (${rate}%)`);
    console.log(`median total time: ${fmt(median(completed.map((j) => secs(j.startTs, j.endTs))))}`);
    console.log(`median phase1 first-byte: ${fmt(median(jobs.map((j) => (j.ttfbs[0]?.ms != null ? Math.round(j.ttfbs[0].ms / 1000) : null))))}`);
    const loopTrue = completed.filter((j) => j.loopObserved === true).length;
    console.log(`completed with loopObserved=true: ${loopTrue}/${completed.length}`);
    if (failed.length) {
        const hist = {};
        for (const j of failed) hist[j.failureClass] = (hist[j.failureClass] || 0) + 1;
        console.log('failure classes: ' + Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
    }
    console.log('');
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const file = args.find((a) => !a.startsWith('--'));
    let text;
    if (file) {
        text = await fs.readFile(file, 'utf8');
    } else {
        text = await new Promise((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (c) => { data += c; });
            process.stdin.on('end', () => resolve(data));
        });
    }
    const jobs = splitJobs(text);
    if (json) {
        console.log(JSON.stringify(jobs.map(({ lines, ...rest }) => rest), null, 2));
    } else {
        report(jobs);
    }
}

main().catch((err) => {
    console.error('audit failed:', err.message);
    process.exit(1);
});
