// Buying TokBux: Apple / Google in-app purchases, checked here (no middleman). The app buys a pack through the
// store, then sends the purchase to /verify: Apple's comes signed by Apple (checked against Apple's root
// certificate), Google's is looked up with the Play Developer API. Each store transaction is credited once
// (tokbux_ledger.ref) to the signed-in player who sent it. Refunds take the TokBux back: Apple calls
// /apple-notifications; Google's are polled from Play's voided-purchases list (at most once an hour, on the next
// purchase or admin visit).
//
//   POST /api/tokbux/verify               { platform: 'ios'|'android', productId, token }   (signed-in player)
//   POST /api/tokbux/apple-notifications  App Store Server Notifications V2 (URL set in App Store Connect)
//   GET  /api/tokbux/packs                what each pack gives (the price comes from the store, in the player's currency)
//   GET  /api/admin/revenue               the admin revenue page's numbers (index.js, behind requireAdmin)
//
// Google needs the Play service account key (revenuecat@gametok1, invited in Play Console) in PLAY_SERVICE_ACCOUNT
// (its JSON), or play-service-account.json in the backend folder when running locally.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import pool from './db.js';
import { creditTokbux } from './avatar-router.js';

// store product id (the same in App Store Connect and Google Play) -> TokBux it gives
export const TOKBUX_PACKS = { tokbux_80: 80, tokbux_500: 500, tokbux_1200: 1200, tokbux_3000: 3000, tokbux_8500: 8500 };
// the US list price, for the revenue page (the stores charge local prices; this is what a pack is worth in dollars)
const PACK_USD = { tokbux_80: 0.99, tokbux_500: 4.99, tokbux_1200: 9.99, tokbux_3000: 19.99, tokbux_8500: 49.99 };

const BUNDLE_ID = 'com.olasubomi.gametok';
const PACKAGE = 'com.vogeza';
// Apple Root CA - G3 (www.apple.com/certificateauthority), the root every App Store signature chains up to
const APPLE_ROOT_G3_SHA256 = '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';
// marker extensions Apple puts in the signing certificate and its intermediate (DER-encoded OIDs)
const OID_LEAF = Buffer.from('060a2a864886f76364060b01', 'hex');          // 1.2.840.113635.100.6.11.1
const OID_INTERMEDIATE = Buffer.from('060a2a864886f76364060201', 'hex'); // 1.2.840.113635.100.6.2.1

export async function runTokbuxStoreMigration() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokbux_purchases (
      store VARCHAR(10) NOT NULL,
      transaction_id VARCHAR(200) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      product_id VARCHAR(60) NOT NULL,
      tokbux INTEGER NOT NULL,
      usd NUMERIC(8,2) NOT NULL,
      sandbox BOOLEAN NOT NULL DEFAULT FALSE,
      refunded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (store, transaction_id)
    );
    CREATE INDEX IF NOT EXISTS tokbux_purchases_time ON tokbux_purchases (created_at);
  `);
}

// ---- Apple: a JWS signed by Apple; the certificate chain in its header must end at Apple's root
function appleSigned(jws) {
  const [h, p, s] = String(jws || '').split('.');
  if (!s) throw new Error('not a signed transaction');
  const head = JSON.parse(Buffer.from(h, 'base64url'));
  const [leaf, mid, root] = (head.x5c || []).map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  if (head.alg !== 'ES256' || !root) throw new Error('bad header');
  if (root.fingerprint256.replace(/:/g, '') !== APPLE_ROOT_G3_SHA256) throw new Error('not Apple');
  if (!mid.verify(root.publicKey) || !leaf.verify(mid.publicKey)) throw new Error('broken chain');
  if (!leaf.raw.includes(OID_LEAF) || !mid.raw.includes(OID_INTERMEDIATE)) throw new Error('not an App Store certificate');
  const now = Date.now();
  if (Date.parse(leaf.validTo) < now || Date.parse(mid.validTo) < now) throw new Error('expired certificate');
  if (!crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  return JSON.parse(Buffer.from(p, 'base64url'));
}

// ---- Google: the Play Developer API, as the Play service account
let play = null;
function playClient() {
  if (play) return play;
  const local = path.join(path.dirname(fileURLToPath(import.meta.url)), '../play-service-account.json');
  const credentials = process.env.PLAY_SERVICE_ACCOUNT ? JSON.parse(process.env.PLAY_SERVICE_ACCOUNT)
    : fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : null;
  if (!credentials) throw new Error('PLAY_SERVICE_ACCOUNT not set');
  play = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
  return play;
}
const PLAY = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
async function playApi(method, url) {
  try { return (await (await playClient()).request({ method, url: PLAY + url })).data; }
  catch (e) { const err = new Error(`Play ${e.response?.status}: ${e.response?.data?.error?.message || e.message}`); err.status = e.response?.status; throw err; }
}

// credit a checked purchase once; null when this transaction was already counted
async function credit(store, transactionId, userId, productId, sandbox) {
  const tokbux = TOKBUX_PACKS[productId];
  const balance = await creditTokbux(userId, tokbux, sandbox ? 'purchase_sandbox' : 'purchase', `${store}:buy:${transactionId}`);
  if (balance !== null) {
    await pool.query(`INSERT INTO tokbux_purchases (store, transaction_id, user_id, product_id, tokbux, usd, sandbox)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`, [store, transactionId, userId, productId, tokbux, PACK_USD[productId], sandbox]);
  }
  console.log(`[TokBux] ${store} purchase ${productId} for ${userId} (${transactionId}${sandbox ? ', sandbox' : ''}) -> ${balance === null ? 'already counted' : balance}`);
  return balance;
}

// a refund: take the pack back from whoever got it (once)
async function refund(store, transactionId) {
  const r = await pool.query('UPDATE tokbux_purchases SET refunded_at = NOW() WHERE store = $1 AND transaction_id = $2 AND refunded_at IS NULL RETURNING user_id, tokbux, sandbox',
    [store, transactionId]);
  const p = r.rows[0];
  if (!p?.user_id) return;
  const balance = await creditTokbux(p.user_id, -p.tokbux, p.sandbox ? 'refund_sandbox' : 'refund', `${store}:refund:${transactionId}`);
  console.log(`[TokBux] ${store} refund ${transactionId}: -${p.tokbux} for ${p.user_id} -> ${balance}`);
}

// Google's refunds and chargebacks: Play keeps a list of voided purchases (30 days); checked at most once an hour
let voidedAt = 0;
export async function checkPlayRefunds() {
  if (Date.now() - voidedAt < 3600e3) return;
  voidedAt = Date.now();
  try {
    const since = Date.now() - 29 * 86400e3;   // Play keeps 30 days
    for (let token = ''; ;) {
      const r = await playApi('GET', `/purchases/voidedpurchases?startTime=${since}&maxResults=1000${token ? `&token=${encodeURIComponent(token)}` : ''}`);
      for (const v of r.voidedPurchases || []) if (v.orderId) await refund('play', v.orderId);
      token = r.tokenPagination?.nextPageToken;
      if (!token) break;
    }
  } catch (e) { console.warn('[TokBux] Play refunds check:', e.message); }
}

const router = express.Router();

router.get('/packs', (req, res) => res.json({ packs: TOKBUX_PACKS }));

router.post('/verify', async (req, res) => {
  try {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const u = bearer ? await pool.query('SELECT id FROM users WHERE token = $1', [bearer]) : { rows: [] };
    if (!u.rows[0]) return res.status(401).json({ error: 'Sign in to buy TokBux', code: 'SIGN_IN' });
    const userId = u.rows[0].id;
    const { platform, productId, token } = req.body || {};
    if (!TOKBUX_PACKS[productId] || !token) return res.status(400).json({ error: 'Unknown pack' });

    if (platform === 'ios') {
      let t;
      try { t = appleSigned(token); } catch (e) { console.warn('[TokBux] Apple purchase rejected:', e.message); return res.status(400).json({ error: 'That purchase could not be checked' }); }
      if (t.bundleId !== BUNDLE_ID || t.productId !== productId || t.revocationDate) return res.status(400).json({ error: 'That purchase could not be checked' });
      const balance = await credit('apple', t.transactionId, userId, productId, t.environment !== 'Production');
      return res.json({ ok: true, credited: balance !== null });
    }
    if (platform === 'android') {
      let p;
      try { p = await playApi('GET', `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`); }
      catch (e) { console.warn('[TokBux] Play purchase rejected:', e.message); return res.status(e.status >= 500 ? 502 : 400).json({ error: 'That purchase could not be checked' }); }
      if (p.purchaseState !== 0) return res.status(400).json({ error: p.purchaseState === 2 ? 'That purchase is still pending' : 'That purchase was cancelled' });
      if (p.obfuscatedExternalAccountId && p.obfuscatedExternalAccountId !== userId) return res.status(400).json({ error: 'That purchase belongs to another account' });
      const balance = await credit('play', p.orderId, userId, productId, p.purchaseType === 0);   // purchaseType 0: a license tester
      // consumed, so the pack can be bought again (the app also finishes it; whichever is first)
      if (p.consumptionState === 0) await playApi('POST', `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`).catch(() => {});
      checkPlayRefunds();
      return res.json({ ok: true, credited: balance !== null });
    }
    res.status(400).json({ error: 'Unknown platform' });
  } catch (err) {
    console.error('[TokBux] verify:', err);
    res.status(500).json({ error: 'Try again' });
  }
});

// App Store Server Notifications V2: Apple signs these too. A refund takes the TokBux back; a purchase is credited
// to the player in its appAccountToken (the app sets it to their user id), in case the app never got to /verify.
router.post('/apple-notifications', async (req, res) => {
  try {
    const n = appleSigned(req.body?.signedPayload);
    if (n.data?.bundleId !== BUNDLE_ID) return res.json({ ok: true });
    if (n.notificationType === 'REFUND' && n.data.signedTransactionInfo) {
      const t = appleSigned(n.data.signedTransactionInfo);
      await refund('apple', t.transactionId);
    }
    if (n.notificationType === 'ONE_TIME_CHARGE' && n.data.signedTransactionInfo) {
      const t = appleSigned(n.data.signedTransactionInfo);
      const u = TOKBUX_PACKS[t.productId] && t.appAccountToken
        ? await pool.query('SELECT id FROM users WHERE id::text = $1', [String(t.appAccountToken).toLowerCase()]) : { rows: [] };
      if (u.rows[0]) await credit('apple', t.transactionId, u.rows[0].id, t.productId, t.environment !== 'Production');
    }
    res.json({ ok: true });
  } catch (err) {
    console.warn('[TokBux] Apple notification:', err.message);
    res.status(400).json({ error: 'Not from Apple' });
  }
});

// the admin revenue page: totals, per day, per pack, latest purchases (real money only; sandbox counted apart)
export async function revenueReport(days = 30) {
  const since = `NOW() - INTERVAL '${Math.max(1, Math.min(365, Number(days) || 30))} days'`;
  const [tot, daily, packs, recent] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE NOT sandbox AND refunded_at IS NULL)::int AS purchases,
        COALESCE(SUM(usd) FILTER (WHERE NOT sandbox AND refunded_at IS NULL), 0)::float AS usd,
        COUNT(DISTINCT user_id) FILTER (WHERE NOT sandbox AND refunded_at IS NULL)::int AS buyers,
        COUNT(*) FILTER (WHERE refunded_at IS NOT NULL AND NOT sandbox)::int AS refunds,
        COUNT(*) FILTER (WHERE sandbox)::int AS sandbox
      FROM tokbux_purchases WHERE created_at > ${since}`),
    pool.query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS purchases, SUM(usd)::float AS usd
      FROM tokbux_purchases WHERE created_at > ${since} AND NOT sandbox AND refunded_at IS NULL GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT product_id, store, COUNT(*)::int AS purchases, SUM(usd)::float AS usd
      FROM tokbux_purchases WHERE created_at > ${since} AND NOT sandbox AND refunded_at IS NULL GROUP BY 1, 2 ORDER BY usd DESC`),
    pool.query(`SELECT p.store, p.product_id, p.tokbux, p.usd::float, p.sandbox, p.refunded_at, p.created_at, u.username
      FROM tokbux_purchases p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50`),
  ]);
  const spent = await pool.query(`SELECT COALESCE(-SUM(amount), 0)::int AS tokbux FROM tokbux_ledger WHERE amount < 0 AND reason NOT LIKE 'refund%' AND created_at > ${since}`);
  return { days: Number(days) || 30, totals: { ...tot.rows[0], tokbuxSpent: spent.rows[0].tokbux }, daily: daily.rows, packs: packs.rows, recent: recent.rows };
}

export default router;
