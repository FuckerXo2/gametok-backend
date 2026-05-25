#!/usr/bin/env node
// One-shot CLI to populate the app with bot accounts + activity.
// Usage:
//   npm run bots:bootstrap                                 # 2000 bots, 80 games, 2500 actions
//   node scripts/bots-bootstrap.mjs --count 1000           # custom bot count
//   node scripts/bots-bootstrap.mjs --count 2000 --games 100 --actions 3000
//   node scripts/bots-bootstrap.mjs --status               # just print current status
//   node scripts/bots-bootstrap.mjs --tick 1500            # run a one-off activity tick
//
// Env: requires DATABASE_URL (same one your backend uses).

import 'dotenv/config';
import process from 'process';
import {
  ensureBotTables,
  seedBots,
  createBotGames,
  runBotActivityTick,
  getBotStatus,
  dreamBotGames,
  regenerateBotGameHtml,
} from '../src/bot-engine.js';
import pool from '../src/db.js';

function parseArgs(argv) {
  const args = {
    count: 2000,
    games: 80,
    actions: 2500,
    statusOnly: false,
    tick: null,
    dream: null,
    dreamConcurrency: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--count': args.count = Number(next); i += 1; break;
      case '--games': args.games = Number(next); i += 1; break;
      case '--actions': args.actions = Number(next); i += 1; break;
      case '--status': args.statusOnly = true; break;
      case '--tick': args.tick = Number(next); i += 1; break;
      case '--dream': args.dream = Number(next); i += 1; break;
      case '--dream-concurrency': args.dreamConcurrency = Number(next); i += 1; break;
      case '--regenerate': args.regenerate = Number(next); i += 1; break;
      case '-h':
      case '--help':
        console.log('Usage: node scripts/bots-bootstrap.mjs [--count N] [--games N] [--actions N]');
        console.log('       node scripts/bots-bootstrap.mjs --status');
        console.log('       node scripts/bots-bootstrap.mjs --tick N');
        console.log('       node scripts/bots-bootstrap.mjs --dream N [--dream-concurrency C]');
        process.exit(0);
        break;
      default: break;
    }
  }
  return args;
}

function logStatus(label, status) {
  console.log(`\n📊 ${label}`);
  console.log(`   bots:        ${status.bots}`);
  console.log(`   bot users:   ${status.bot_users}`);
  console.log(`   bot games:   ${status.bot_games}`);
  console.log(`   plays/scrs:  ${status.bot_scores ?? 0} scores`);
  console.log(`   likes:       ${status.bot_likes}`);
  console.log(`   comments:    ${status.bot_comments}`);
  console.log(`   follows:     ${status.bot_follows}`);
  console.log(`   last run:    ${status.last_run_at || 'never'}`);
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add it to your .env or environment and retry.');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  await ensureBotTables();

  if (args.statusOnly) {
    logStatus('Current status', await getBotStatus());
    return;
  }

  if (args.tick != null && Number.isFinite(args.tick)) {
    const actions = Math.max(1, Math.min(10000, args.tick));
    console.log(`\n⚙️  Running ${actions} bot actions (single tick)...`);
    const result = await runBotActivityTick({ actions, createGames: false });
    console.log('   →', result);
    logStatus('Status after tick', await getBotStatus());
    return;
  }

  if (args.regenerate != null && Number.isFinite(args.regenerate)) {
    const limit = Math.max(1, Math.min(5000, args.regenerate));
    console.log(`\n🛠️  Regenerating html_payload for up to ${limit} bot games (V2 templates)...`);
    const result = await regenerateBotGameHtml({
      limit,
      onProgress: ({ updated, total }) => console.log(`   • ${updated}/${total}`),
    });
    console.log('   →', result);
    return;
  }

  if (args.dream != null && Number.isFinite(args.dream)) {
    const count = Math.max(1, Math.min(50, args.dream));
    const concurrency = Math.max(1, Math.min(3, args.dreamConcurrency || 1));
    console.log(`\n🌙 Generating ${count} REAL AI bot games via OpenGame (concurrency=${concurrency})...`);
    console.log('   Heads up: this calls the actual AI builder and can take ~30–90s per game.');
    const result = await dreamBotGames({ count, concurrency });
    console.log('   →', JSON.stringify(result, null, 2));
    logStatus('Status after dream', await getBotStatus());
    return;
  }

  const targetCount = Math.max(1, Math.min(100000, Number(args.count) || 2000));
  const gameCount = Math.max(0, Math.min(2000, Number(args.games) || 0));
  const activityCount = Math.max(0, Math.min(20000, Number(args.actions) || 0));

  logStatus('Before bootstrap', await getBotStatus());

  console.log(`\n🌱 Seeding bot accounts (target: ${targetCount})...`);
  const seedResult = await seedBots({
    targetCount,
    onProgress: ({ created, total }) => {
      const pct = Math.round((created / total) * 100);
      console.log(`   • ${created}/${total} (${pct}%)`);
    },
  });
  console.log('   →', seedResult);

  if (gameCount > 0) {
    console.log(`\n🎮 Creating ${gameCount} bot games...`);
    const gameResult = await createBotGames({ count: gameCount });
    console.log('   →', gameResult);
  }

  if (activityCount > 0) {
    console.log(`\n🤖 Running ${activityCount} initial actions...`);
    const tickResult = await runBotActivityTick({ actions: activityCount, createGames: false });
    console.log('   →', tickResult);
  }

  logStatus('After bootstrap', await getBotStatus());
  console.log('\n✅ Done. The backend scheduler will keep ticking activity automatically (in dev) or when BOT_ENGINE_ENABLED=true (in prod).');
}

run()
  .catch((error) => {
    console.error('\n❌ Bootstrap failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
