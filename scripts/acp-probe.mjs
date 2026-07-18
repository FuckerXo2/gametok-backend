#!/usr/bin/env node
/**
 * EXPERIMENT 0 — ACP handshake reconnaissance.
 *
 * Spawns `kimi acp` (a stdio JSON-RPC server), sends `initialize`, then tries
 * `session/new`, and prints EVERY raw byte that comes back.
 *
 * WHAT THIS IS: reconnaissance. It tells us what Kimi's ACP *claims* about
 * itself, which tells us what to try next and in what order.
 *
 * WHAT THIS IS NOT: an answer. Advertised capability is a hypothesis, not
 * evidence — agents under-advertise things that work and advertise things that
 * are broken or shallow. Session resume, image support, and permission
 * behavior are only settled by the runtime experiments (1-4), which need a
 * funded key. Do not conclude anything from this output alone.
 *
 * Costs nothing to run: `initialize` is a protocol exchange, not a model call.
 * (It may still fail on auth — that itself is a finding worth having.)
 *
 * Usage:  node scripts/acp-probe.mjs
 *         KIMI_PATH=/custom/path/kimi node scripts/acp-probe.mjs
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

// ACP framing is newline-delimited JSON-RPC 2.0 over stdio (no Content-Length
// headers). If Kimi frames differently, the RAW dump below will show it — that
// is exactly the kind of thing we want to observe rather than assume.
const send = (proc, msg) => {
  const line = JSON.stringify(msg);
  console.log(`\n>>> SENT:\n${line}`);
  proc.stdin.write(line + '\n');
};

const main = async () => {
  console.log(`spawning: ${kimiCmd} acp`);
  const proc = spawn(kimiCmd, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'] });

  let rawOut = '';
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    rawOut += text;
    // Raw first — never let parsing hide what actually arrived.
    console.log(`\n<<< RAW STDOUT:\n${text.trimEnd()}`);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        console.log(`<<< PARSED:\n${JSON.stringify(JSON.parse(trimmed), null, 2)}`);
      } catch {
        // Non-JSON line: framing differs from newline-delimited, or it's a log.
      }
    }
  });

  proc.stderr.on('data', (c) => console.log(`\n<<< STDERR:\n${c.toString().trimEnd()}`));
  proc.on('error', (err) => { console.error(`FAILED TO SPAWN: ${err.message}`); process.exit(1); });
  proc.on('close', (code) => console.log(`\n[kimi acp exited: ${code}]`));

  // 1. initialize — the handshake. Declares what WE support and asks what it does.
  send(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    },
  });

  // 2. session/new — does a session even open without auth? What shape is the id?
  await new Promise((r) => setTimeout(r, 2500));
  send(proc, {
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: { cwd: process.cwd(), mcpServers: [] },
  });

  // Let anything late arrive, then report and exit.
  await new Promise((r) => setTimeout(r, 4000));

  console.log('\n' + '='.repeat(60));
  console.log('OBSERVED (not concluded):');
  console.log(`  bytes received on stdout: ${rawOut.length}`);
  console.log(`  mentions "loadSession":   ${/loadSession/i.test(rawOut)}`);
  console.log(`  mentions "image":         ${/image/i.test(rawOut)}`);
  console.log(`  mentions "auth":          ${/auth/i.test(rawOut)}`);
  console.log('');
  console.log('These are hypotheses about what to test at runtime — NOT answers.');
  console.log('Resume, images, and permissions are settled by experiments 1-4 only.');
  console.log('='.repeat(60));

  proc.kill();
  process.exit(0);
};

main();
