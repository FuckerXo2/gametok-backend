#!/usr/bin/env node
// The avatar moved to v2 (Synty Sidekick): the old (v1, Quaternius) clothes, hair and beard don't exist on it. Agreed
// 2026-11-14: everyone gets back the TokBux they PAID for them (from tokbux_ledger, so sale prices count; items they
// got free are skipped). Heroes (characters) and game items stay owned and aren't touched. Run it the day the app build
// with the new avatar goes out, and set V1_ITEMS_ON_SALE = false in src/avatar-router.js in the same deploy.
//   node scripts/refund-v1-avatar-items.mjs          # dry run: who gets what
//   node scripts/refund-v1-avatar-items.mjs --go     # pays it (once: a player already refunded is skipped)
// The items stay in `owned` (harmless, and the record of what was bought); the ledger row 'v1_item_refund' marks it done.
import 'dotenv/config';
import pg from 'pg';
import { ITEMS } from '../src/avatar-items.js';

const GO = process.argv.includes('--go');
// what's refunded: v1 parts, hair and beard (not characters, not outfits, not game items like 'no-rules-fc:hulk')
const V1 = new Set(ITEMS.filter((i) => ['part', 'hair', 'beard'].includes(i.kind)).map((i) => i.id));
const isV1 = (id) => V1.has(id) || /^hair-Hair_/.test(id);   // (hair ids from before colours too)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false } });
const paid = await pool.query(`
  SELECT user_id, item_id, -SUM(amount)::int AS tokbux FROM tokbux_ledger
  WHERE reason = 'avatar_item' AND amount < 0 AND item_id IS NOT NULL
    AND user_id NOT IN (SELECT user_id FROM tokbux_ledger WHERE reason = 'v1_item_refund')
  GROUP BY user_id, item_id`);
const byUser = new Map();
for (const r of paid.rows) if (isV1(r.item_id)) {
  const u = byUser.get(r.user_id) || { tokbux: 0, items: [] };
  u.tokbux += r.tokbux; u.items.push(`${r.item_id} (${r.tokbux})`); byUser.set(r.user_id, u);
}
let total = 0;
for (const [user, u] of byUser) { total += u.tokbux; console.log(`${user}  +${u.tokbux}  ${u.items.join(', ')}`); }
console.log(`${byUser.size} players, ${total} TokBux in all${GO ? '' : '  (dry run: --go to pay)'}`);
if (GO) {
  for (const [user, u] of byUser) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const done = await c.query(`SELECT 1 FROM tokbux_ledger WHERE user_id = $1 AND reason = 'v1_item_refund' LIMIT 1`, [user]);
      if (!done.rowCount) {
        await c.query('UPDATE avatar_profiles SET tokbux = tokbux + $2, updated_at = NOW() WHERE user_id = $1', [user, u.tokbux]);
        await c.query(`INSERT INTO tokbux_ledger (user_id, amount, reason, item_id) VALUES ($1, $2, 'v1_item_refund', NULL)`, [user, u.tokbux]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error(user, e.message); } finally { c.release(); }
  }
  console.log('paid');
}
await pool.end();
