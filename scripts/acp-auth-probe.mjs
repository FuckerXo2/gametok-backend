#!/usr/bin/env node
/**
 * EXPERIMENT 1a — Does ACP accept credentials NON-INTERACTIVELY?
 *
 * This runs WITHOUT a valid key, and still produces a real answer.
 *
 * Method: send `session/new` under different env configurations and compare the
 * error. We are not trying to authenticate — we are trying to find out whether
 * the env var is READ AT ALL.
 *
 *   error stays "Authentication required"  → env var IGNORED. ACP wants the
 *                                            stored device-login credential.
 *                                            => blocked on Railway (no terminal).
 *   error CHANGES (invalid key / 401 / …)  → env var IS READ. A non-interactive
 *                                            path exists; it just needs a real key.
 *
 * Either outcome is decisive for the architecture, and neither costs money:
 * a rejected key never reaches the model.
 *
 * Usage: node scripts/acp-auth-probe.mjs
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CANDIDATES = [
  process.env.KIMI_PATH,
  path.join(os.homedir(), '.kimi-code', 'bin', 'kimi'),
  '/usr/local/bin/kimi',
].filter(Boolean);
const kimiCmd = CANDIDATES.find((p) => { try { fs.accessSync(p); return true; } catch { return false; } }) || 'kimi';

const FAKE = 'sk-probe-0000000000000000000000000000000000000000';

// Env shapes to try. Same fake key, different variable names — whichever one
// the ACP path reads will produce a DIFFERENT error than the others.
const TRIALS = [
  { label: 'baseline (no credentials at all)', env: {} },
  { label: 'MOONSHOT_API_KEY', env: { MOONSHOT_API_KEY: FAKE } },
  { label: 'KIMI_API_KEY', env: { KIMI_API_KEY: FAKE } },
  { label: 'MOONSHOT_API_KEY + BASE_URL', env: { MOONSHOT_API_KEY: FAKE, MOONSHOT_BASE_URL: 'https://api.moonshot.ai/v1' } },
  { label: 'KIMI_API_KEY + MOONSHOT_API_KEY', env: { KIMI_API_KEY: FAKE, MOONSHOT_API_KEY: FAKE } },
];

const runTrial = ({ label, env }) =>
  new Promise((resolve) => {
    const proc = spawn(kimiCmd, ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let out = '';
    let err = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch {}
      resolve({ label, ...result });
    };

    proc.stdout.on('data', (c) => {
      out += c.toString();
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const msg = JSON.parse(t);
          if (msg.id === 2) {
            finish({
              error: msg.error ? `${msg.error.code}: ${msg.error.message}` : null,
              ok: !msg.error,
              sessionId: msg.result?.sessionId ?? null,
            });
          }
        } catch {}
      }
    });
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('error', () => finish({ error: 'spawn failed', ok: false }));

    const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true } },
    });
    setTimeout(() => send({
      jsonrpc: '2.0', id: 2, method: 'session/new',
      params: { cwd: process.cwd(), mcpServers: [] },
    }), 1200);

    setTimeout(() => finish({ error: `no response (stderr: ${err.trim().slice(0, 120)})`, ok: false }), 9000);
  });

const main = async () => {
  console.log(`kimi: ${kimiCmd}\nsending session/new under ${TRIALS.length} env shapes (fake key — never reaches the model)\n`);
  const results = [];
  for (const trial of TRIALS) {
    process.stdout.write(`  ${trial.label} … `);
    const r = await runTrial(trial);
    console.log(r.ok ? 'SESSION OPENED' : r.error);
    results.push(r);
  }

  const baseline = results[0].error;
  const changed = results.slice(1).filter((r) => r.ok || r.error !== baseline);

  console.log('\n' + '='.repeat(64));
  console.log(`baseline error: ${baseline}`);
  if (changed.length === 0) {
    console.log('\nOBSERVED: every env shape produced the IDENTICAL error.');
    console.log('=> No evidence ACP reads a key from the environment.');
    console.log('   Hypothesis: ACP wants the stored device-login credential,');
    console.log('   which would be a real problem for headless deploys.');
    console.log('   NOT proven — a correct var name we did not try could exist.');
  } else {
    console.log('\nOBSERVED: the error CHANGED for:');
    for (const r of changed) console.log(`   - ${r.label}: ${r.ok ? 'SESSION OPENED' : r.error}`);
    console.log('=> That variable IS being read. A non-interactive path exists;');
    console.log('   it needs a valid key, not an interactive login.');
  }
  console.log('='.repeat(64));
};

main();
