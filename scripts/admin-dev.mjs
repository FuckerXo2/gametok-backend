// Previews gametok.co/admin locally on the real numbers, READ ONLY: only the dashboard's routers, no jobs, no
// sockets, and every query runs in a read-only transaction. node scripts/admin-dev.mjs [port=8097]
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url).pathname });
const { default: express } = await import('express');
const { default: pool } = await import('../src/db.js');
// (the pooler ignores connection-level options, so each query gets its own read-only transaction)
pool.query = async (text, params) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    return await client.query(text, params);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
};
const { default: insights } = await import('../src/admin-insights.js');
const { revenueReport } = await import('../src/tokbux-store.js');
const app = express();
app.use('/api/admin/insights', insights);
app.get('/api/admin/revenue', async (req, res) => res.json(await revenueReport(req.query.days)));
app.use('/admin', express.static(new URL('../../gametok-landing/public/admin', import.meta.url).pathname));
const port = +process.argv[2] || 8097;
app.listen(port, () => console.log('read-only admin preview on', port));
