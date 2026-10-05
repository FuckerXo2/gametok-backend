import 'dotenv/config';
import pool from './src/db.js';

async function run() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log('Tables:', res.rows.map(r => r.table_name));
    const jobsRes = await pool.query("SELECT id, prompt, status, created_at, completed_at, error FROM generation_jobs ORDER BY created_at DESC LIMIT 5");
    console.log('TOP 5 JOBS:');
    for (const r of jobsRes.rows) {
      console.log(`- ID: ${r.id}, Status: ${r.status}, Created: ${r.created_at}, Completed: ${r.completed_at}, Prompt: ${r.prompt.slice(0, 60)}... Error: ${r.error}`);
    }
  } catch (err) {
    console.error('DB error:', err);
  } finally {
    process.exit(0);
  }
}

run();
