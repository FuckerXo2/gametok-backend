// The player's 3D avatar on their GameTok account: what they wear (a small record), the items they own,
// and their TokBux. Prices live here, not in the app, and every purchase is checked here.
// The record follows the player into games (it rides in the player session; see /api/games/:id/player-session).
// The 3D side: games/avatar-editor (js/avatar-core.js); the app's item list: gametok/src/avatar/catalog.ts.
//
//   GET  /api/avatar/me                 { avatar, owned, tokbux, prices }
//   PUT  /api/avatar/me   { avatar }    saves what they wear (only free or owned items)
//   POST /api/avatar/buy  { itemId }    spends TokBux on an item
//   PUT  /api/avatar/headshot { png }   the 3D avatar's head (rendered by the app's stage) becomes the profile picture

import crypto from 'crypto';
import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from './db.js';

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'gametok-games-assets';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/$/, '');
const s3 = process.env.R2_ACCOUNT_ID
  ? new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } })
  : null;

// Like Robux and V-Bucks: everyone starts with none. TokBux are bought.
export const WELCOME_TOKBUX = 0;

// item id -> price in TokBux. Body types and skin tones aren't items: everyone has them.
// The fantasy sets (Quaternius) are Shop items; the free starter clothes are street ones (STREET, price 0)
const SETS = { Male_Peasant: 25, Male_Ranger: 40, Female_Peasant: 25, Female_Ranger: 40 };
const SLOTS = ['head', 'top', 'arms', 'legs', 'feet', 'acc'];
const RANGER_ONLY = ['head', 'acc'];
const HAIRS = { Hair_Buzzed: 0, Hair_BuzzedFemale: 15, Hair_SimpleParted: 20, Hair_Long: 35, Hair_Buns: 35 };
export const PRICES = { beard: 20 };
for (const [id, p] of Object.entries(HAIRS)) PRICES[`hair-${id}`] = p;
for (const [set, p] of Object.entries(SETS))
  for (const slot of SLOTS) if (!RANGER_ONLY.includes(slot) || set.endsWith('_Ranger')) PRICES[`${set}-${slot}`] = p;
// clothing grown from the body (games/avatar-editor/tools/make_clothing.py): one item per garment and colour
const STREET = { top: { Tee: [25, 'White', 'Black', 'Red', 'Green'], Sweater: [40, 'Grey', 'Navy', 'Cream'] },
                 legs: { Jeans: [35, 'Blue', 'Black'], Shorts: [20, 'Khaki', 'Black'] },
                 feet: { Sneakers: [30, 'White', 'Black', 'Red'] } };
for (const [slot, garments] of Object.entries(STREET))
  for (const [g, [price, ...colours]] of Object.entries(garments)) for (const c of colours) PRICES[`Street_${g}${c}-${slot}`] = price;
// everyone's starter clothes
for (const id of ['Street_TeeWhite-top', 'Street_JeansBlue-legs', 'Street_ShortsKhaki-legs', 'Street_SneakersWhite-feet']) PRICES[id] = 0;
// Items that were free once and aren't now: whoever was wearing one keeps it (see profile)
const ONCE_FREE = new Set(['Male_Peasant', 'Male_Ranger'].flatMap((set) => SLOTS.map((k) => `${set}-${k}`)).filter((id) => id in PRICES));

// What games sell, in TokBux, owned on the GameTok account: '<game id>:<item>'. A game shows them and asks the app
// to buy (the player confirms in the app); its server sees what's owned in the player session.
// Prices live HERE: the game's own copy (e.g. No Rules FC's HEROES.price) is only for display.
export const GAME_ITEMS = {
  'no-rules-fc': { spiderman: 1000, baki: 800, goku: 1200, flash: 1000, yujiro: 2000, hulk: 2500, vegeta: 1200, superman: 1500, ironman: 1200, thor: 1500, batman: 1000, lantern: 1000 },
};
for (const [game, items] of Object.entries(GAME_ITEMS))
  for (const [id, p] of Object.entries(items)) PRICES[`${game}:${id}`] = p;

// What a player owns in one game (ids without the game prefix), and their TokBux: for the player session.
export async function gameEntitlements(userId, gameId) {
  const r = await pool.query('SELECT owned, tokbux FROM avatar_profiles WHERE user_id = $1', [userId]);
  const p = r.rows[0] || { owned: [], tokbux: WELCOME_TOKBUX };
  return { owned: p.owned.filter((id) => id.startsWith(`${gameId}:`)).map((id) => id.slice(gameId.length + 1)), tokbux: p.tokbux };
}

const HEX = /^#[0-9a-f]{6}$/i;
// Checked field by field, so nothing else rides along (same rules as games/street-5s/server cleanAvatar).
export function cleanAvatar(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {
    body: v.body === 'Female' ? 'Female' : 'Male', skin: Math.max(0, Math.min(5, v.skin | 0)), face: Math.max(0, Math.min(5, v.face | 0)), beard: !!v.beard, fit: v.fit !== false,
    hair: typeof v.hair === 'string' && v.hair in HAIRS ? v.hair : null,
    hairColor: HEX.test(v.hairColor) ? v.hairColor : '#2a1a12', parts: {}, colors: {},
  };
  for (const k of SLOTS) {
    const set = v.parts?.[k];
    out.parts[k] = typeof set === 'string' && `${set}-${k}` in PRICES ? set : null;
    out.colors[k] = HEX.test(v.colors?.[k]) ? v.colors[k] : '#ffffff';
  }
  return out;
}

// the items a record wears
function wornItems(a) {
  const ids = [];
  if (a.hair) ids.push(`hair-${a.hair}`);
  if (a.beard) ids.push('beard');
  for (const k of SLOTS) if (a.parts[k]) ids.push(`${a.parts[k]}-${k}`);
  return ids;
}

export async function runAvatarMigration() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS avatar_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      record JSONB,
      owned TEXT[] NOT NULL DEFAULT '{}',
      tokbux INTEGER NOT NULL DEFAULT ${WELCOME_TOKBUX} CHECK (tokbux >= 0),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tokbux_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      reason VARCHAR(40) NOT NULL,
      item_id VARCHAR(80),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tokbux_ledger_user ON tokbux_ledger (user_id, created_at);
    -- what a store purchase or refund was (its transaction id): the same one is never counted twice
    ALTER TABLE tokbux_ledger ADD COLUMN IF NOT EXISTS ref VARCHAR(160);
    CREATE UNIQUE INDEX IF NOT EXISTS tokbux_ledger_ref ON tokbux_ledger (ref) WHERE ref IS NOT NULL;
    ALTER TABLE avatar_profiles ALTER COLUMN tokbux SET DEFAULT ${WELCOME_TOKBUX};
  `);
  console.log('✅ Avatar profiles + TokBux ready');
}

// Add (or, for a refund, take back) TokBux, once per ref. Returns the new balance, or null if that ref was
// already counted. A refund never takes the balance below 0 (what was already spent stays spent).
export async function creditTokbux(userId, amount, reason, ref) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO avatar_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    const seen = await client.query('INSERT INTO tokbux_ledger (user_id, amount, reason, ref) VALUES ($1, $2, $3, $4) ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING RETURNING id',
      [userId, amount, reason, ref]);
    if (!seen.rowCount) { await client.query('ROLLBACK'); return null; }
    const r = await client.query('UPDATE avatar_profiles SET tokbux = GREATEST(0, tokbux + $2), updated_at = NOW() WHERE user_id = $1 RETURNING tokbux', [userId, amount]);
    await client.query('COMMIT');
    return r.rows[0].tokbux;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// the saved record (cleaned), or null: what the player session carries into games
export async function avatarRecordOf(userId) {
  const r = await pool.query('SELECT record FROM avatar_profiles WHERE user_id = $1', [userId]);
  return r.rows[0]?.record ? cleanAvatar(r.rows[0].record) : null;
}

async function userFrom(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const r = token ? await pool.query('SELECT id FROM users WHERE token = $1', [token]) : { rows: [] };
  if (!r.rows[0]) { res.status(401).json({ error: 'Sign in to save your avatar', code: 'SIGN_IN' }); return null; }
  return r.rows[0];
}

async function profile(client, userId, lock = false) {
  const fresh = await client.query('INSERT INTO avatar_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id', [userId]);
  if (fresh.rowCount && WELCOME_TOKBUX) await client.query('INSERT INTO tokbux_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, WELCOME_TOKBUX, 'welcome']);
  const r = await client.query(`SELECT record, owned, tokbux FROM avatar_profiles WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`, [userId]);
  const p = r.rows[0];
  const kept = p.record ? wornItems(cleanAvatar(p.record)).filter((id) => ONCE_FREE.has(id) && !p.owned.includes(id)) : [];
  if (kept.length) {
    await client.query('UPDATE avatar_profiles SET owned = owned || $2::text[] WHERE user_id = $1', [userId, kept]);
    p.owned = [...p.owned, ...kept];
  }
  return p;
}

const view = (p) => ({ avatar: p.record ? cleanAvatar(p.record) : null, owned: p.owned, tokbux: p.tokbux, prices: PRICES });

const router = express.Router();
router.use(express.json({ limit: '400kb' }));   // (a headshot PNG; everything else is tiny)

router.get('/me', async (req, res) => {
  try {
    const user = await userFrom(req, res); if (!user) return;
    res.json(view(await profile(pool, user.id)));
  } catch (err) {
    console.error('[Avatar] me:', err);
    res.status(500).json({ error: 'Could not load your avatar' });
  }
});

router.put('/me', async (req, res) => {
  try {
    const user = await userFrom(req, res); if (!user) return;
    const avatar = cleanAvatar(req.body?.avatar);
    if (!avatar) return res.status(400).json({ error: 'No avatar', code: 'BAD_AVATAR' });
    const p = await profile(pool, user.id);
    const missing = wornItems(avatar).filter((id) => PRICES[id] > 0 && !p.owned.includes(id));
    if (missing.length) return res.status(402).json({ error: 'Buy these first', code: 'NOT_OWNED', missing });
    await pool.query('UPDATE avatar_profiles SET record = $2, updated_at = NOW() WHERE user_id = $1', [user.id, avatar]);
    res.json(view({ ...p, record: avatar }));
  } catch (err) {
    console.error('[Avatar] save:', err);
    res.status(500).json({ error: 'Could not save your avatar' });
  }
});

router.post('/buy', async (req, res) => {
  const itemId = String(req.body?.itemId || '');
  const price = PRICES[itemId];
  if (price === undefined) return res.status(404).json({ error: 'No such item', code: 'NO_ITEM' });
  let client;
  try {
    const user = await userFrom(req, res); if (!user) return;
    client = await pool.connect();
    await client.query('BEGIN');
    const p = await profile(client, user.id, true);
    if (price === 0 || p.owned.includes(itemId)) { await client.query('ROLLBACK'); return res.json(view(p)); }
    if (p.tokbux < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: `You need ${price - p.tokbux} more TokBux`, code: 'NOT_ENOUGH_TOKBUX', tokbux: p.tokbux, price });
    }
    const r = await client.query(
      'UPDATE avatar_profiles SET tokbux = tokbux - $2, owned = array_append(owned, $3), updated_at = NOW() WHERE user_id = $1 RETURNING record, owned, tokbux',
      [user.id, price, itemId]);
    await client.query('INSERT INTO tokbux_ledger (user_id, amount, reason, item_id) VALUES ($1, $2, $3, $4)', [user.id, -price, 'avatar_item', itemId]);
    await client.query('COMMIT');
    res.json(view(r.rows[0]));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[Avatar] buy:', err);
    res.status(500).json({ error: 'Could not buy that' });
  } finally {
    client?.release();
  }
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
router.put('/headshot', async (req, res) => {
  try {
    const user = await userFrom(req, res); if (!user) return;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.png || ''));
    const png = m && Buffer.from(m[1], 'base64');
    if (!png || png.length > 300 * 1024 || !png.subarray(0, 8).equals(PNG)) return res.status(400).json({ error: 'Not a headshot', code: 'BAD_IMAGE' });
    if (!s3) return res.status(503).json({ error: 'Storage is not configured' });
    // named after its contents: the same look is the same file, and a new look is a new address (no stale caches)
    const key = `avatars/headshots/${user.id}/${crypto.createHash('sha256').update(png).digest('hex').slice(0, 16)}.png`;
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: png, ContentType: 'image/png', CacheControl: 'public, max-age=31536000, immutable' }));
    const avatar = `${R2_PUBLIC_URL}/${key}`;
    await pool.query('UPDATE users SET avatar = $2 WHERE id = $1', [user.id, avatar]);
    res.json({ avatar });
  } catch (err) {
    console.error('[Avatar] headshot:', err);
    res.status(500).json({ error: 'Could not save your picture' });
  }
});

export default router;
