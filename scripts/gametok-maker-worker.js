import pool, { initDB } from '../src/db.js';
import { startGenerationQueueWorker, stopGenerationQueueWorker } from '../src/ai.js';
import { summarizeNvidiaKeyPools } from '../src/ai-engine/nvidia-key-pool.js';

const WORKER_NAME = process.env.GAMETOK_MAKER_WORKER_ID || `${process.env.RAILWAY_SERVICE_ID || 'local'}-${process.pid}`;

async function main() {
  console.log(`[GameTok Maker Worker] Starting ${WORKER_NAME}`);
  const nvidiaPools = summarizeNvidiaKeyPools();
  console.log(`[GameTok Maker Worker] NVIDIA key pools text=${nvidiaPools.textKeyCount} image=${nvidiaPools.imageKeyCount} splitImage=${nvidiaPools.hasSplitImagePool} splitText=${nvidiaPools.hasSplitTextPool} legacy=${nvidiaPools.hasLegacyPool}`);
  await initDB();
  startGenerationQueueWorker();

  const shutdown = async (signal) => {
    console.log(`[GameTok Maker Worker] ${signal} received; pausing queue claims.`);
    stopGenerationQueueWorker(signal);
    await pool.end().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[GameTok Maker Worker] Fatal:', error);
  process.exit(1);
});
