// Buying TokBux: Apple / Google in-app purchases, through RevenueCat (it checks every receipt with the store,
// then calls this webhook). The app logs players in to RevenueCat with their GameTok user id, so the event's
// app_user_id is who gets the TokBux.
//
//   POST /api/tokbux/revenuecat   RevenueCat's webhook (Authorization: the secret set in its dashboard and in
//                                 REVENUECAT_WEBHOOK_AUTH here)
//   GET  /api/tokbux/packs        what each pack gives (the price comes from the store, in the player's currency)

import crypto from 'crypto';
import express from 'express';
import pool from './db.js';
import { creditTokbux } from './avatar-router.js';

// store product id (the same in App Store Connect and Google Play) -> TokBux it gives
export const TOKBUX_PACKS = { tokbux_80: 80, tokbux_500: 500, tokbux_1200: 1200, tokbux_3000: 3000, tokbux_8500: 8500 };

const router = express.Router();

router.get('/packs', (req, res) => res.json({ packs: TOKBUX_PACKS }));

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

router.post('/revenuecat', async (req, res) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!secret || !sameSecret(req.headers.authorization, secret)) return res.status(401).json({ error: 'Not RevenueCat' });
    const e = req.body?.event || {};
    const tokbux = TOKBUX_PACKS[e.product_id];
    const sandbox = e.environment === 'SANDBOX';
    // a purchase gives the pack; a refund (CANCELLATION of a one-off purchase) takes it back
    const refund = e.type === 'CANCELLATION';
    if (!tokbux || !e.transaction_id || !['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE', 'CANCELLATION'].includes(e.type)) {
      return res.json({ ok: true, ignored: e.type || 'unknown' });   // not ours: RevenueCat must still get a 200
    }
    const user = await pool.query('SELECT id FROM users WHERE id::text = $1', [String(e.app_user_id || '')]);
    if (!user.rows[0]) {
      console.warn('[TokBux] purchase for an unknown user', e.app_user_id, e.transaction_id);
      return res.json({ ok: true, ignored: 'unknown user' });
    }
    const amount = refund ? -tokbux : tokbux;
    const reason = (refund ? 'refund' : 'purchase') + (sandbox ? '_sandbox' : '');
    const balance = await creditTokbux(user.rows[0].id, amount, reason, `rc:${e.type === 'CANCELLATION' ? 'refund' : 'buy'}:${e.transaction_id}`);
    console.log(`[TokBux] ${reason} ${amount} for ${user.rows[0].id} (${e.transaction_id}) -> ${balance === null ? 'already counted' : balance}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[TokBux] webhook:', err);
    res.status(500).json({ error: 'Try again' });   // RevenueCat retries
  }
});

export default router;
