import express from 'express';
import { randomUUID } from 'crypto';
import pool from './db.js';

const router = express.Router();

async function getUserIdFromRequest(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }

  const result = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
  if (result.rows.length === 0) {
    const error = new Error('Invalid session');
    error.statusCode = 401;
    throw error;
  }
  return result.rows[0].id;
}

async function ensureOpenGameQueueSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      kind VARCHAR(32) NOT NULL DEFAULT 'dream',
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      prompt TEXT NOT NULL,
      payload JSONB DEFAULT '{}'::jsonb,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      progress INTEGER NOT NULL DEFAULT 0,
      phase VARCHAR(64) DEFAULT 'queued',
      status_message TEXT,
      locked_by TEXT,
      locked_at TIMESTAMP,
      run_after TIMESTAMP DEFAULT NOW(),
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      canceled_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_claim ON generation_jobs(status, run_after, created_at);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_created ON generation_jobs(user_id, created_at DESC);
  `);
}

router.post('/jobs', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    await ensureOpenGameQueueSchema();
    const jobId = req.body?.jobId || randomUUID();
    const title = req.body?.title || 'OpenGame Build';
    const payload = {
      title,
      source: 'opengame',
      requestedAt: new Date().toISOString(),
      ...(req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {}),
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ai_games (id, user_id, prompt, title, html_payload, raw_code, is_draft)
         VALUES ($1, $2, $3, $4, '', '', true)
         ON CONFLICT (id) DO UPDATE
         SET prompt = EXCLUDED.prompt,
             title = EXCLUDED.title,
             html_payload = '',
             raw_code = '',
             is_draft = true`,
        [jobId, userId, prompt, title]
      );
      await client.query(
        `INSERT INTO generation_jobs (id, user_id, kind, status, prompt, payload, max_attempts, progress, phase, status_message)
         VALUES ($1, $2, 'opengame', 'queued', $3, $4::jsonb, $5, 0, 'queued', 'Waiting for OpenGame worker...')
         ON CONFLICT (id) DO UPDATE
         SET kind = 'opengame',
             status = 'queued',
             prompt = EXCLUDED.prompt,
             payload = EXCLUDED.payload,
             max_attempts = EXCLUDED.max_attempts,
             progress = 0,
             phase = 'queued',
             status_message = 'Waiting for OpenGame worker...',
             error = NULL,
             run_after = NOW(),
             updated_at = NOW(),
             completed_at = NULL,
             canceled_at = NULL`,
        [jobId, userId, prompt, JSON.stringify(payload), Number(req.body?.maxAttempts || 1)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    res.json({ success: true, jobId });
  } catch (error) {
    console.error('[OpenGame Router] create job failed:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'OpenGame job failed' });
  }
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const result = await pool.query(
      `SELECT job.id,
              job.status,
              job.progress,
              job.phase,
              job.status_message,
              job.error,
              game.title,
              game.html_payload,
              game.game_url
       FROM generation_jobs job
       LEFT JOIN ai_games game ON game.id = job.id
       WHERE job.id = $1 AND job.user_id = $2 AND job.kind = 'opengame'`,
      [req.params.jobId, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'OpenGame job not found' });

    const row = result.rows[0];
    res.json({
      jobId: row.id,
      status: row.status,
      progress: row.progress,
      phase: row.phase,
      statusMessage: row.status_message,
      error: row.error,
      title: row.title,
      htmlPreview: row.status === 'complete' ? row.html_payload : undefined,
      gameUrl: row.status === 'complete' ? (row.game_url || null) : undefined,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'OpenGame status failed' });
  }
});

router.post('/jobs/:jobId/cancel', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const result = await pool.query(
      `UPDATE generation_jobs
       SET status = 'canceled',
           phase = 'canceled',
           status_message = 'OpenGame generation canceled',
           error = 'OpenGame generation canceled',
           updated_at = NOW(),
           canceled_at = NOW()
       WHERE id = $1 AND user_id = $2 AND kind = 'opengame'
       RETURNING id`,
      [req.params.jobId, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'OpenGame job not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'OpenGame cancel failed' });
  }
});

export default router;
