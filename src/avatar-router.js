// The player's 3D avatar on their GameTok account: what they wear (a small record), the items they own,
// and their TokBux. Prices live here, not in the app, and every purchase is checked here.
// The record follows the player into games (it rides in the player session; see /api/games/:id/player-session).
// The 3D side: games/avatar-editor (js/avatar-core.js); the app's item list: gametok/src/avatar/catalog.ts.
//
//   GET  /api/avatar/me                 { avatar, owned, tokbux, prices }
//   PUT  /api/avatar/me   { avatar }    saves what they wear (only free or owned items)
//   POST /api/avatar/buy  { itemId }    spends TokBux on an item

import express from 'express';
import pool from './db.js';

// Like Robux and V-Bucks: everyone starts with none. TokBux are bought.
export const WELCOME_TOKBUX = 0;

// item id -> price in TokBux. Body types and skin tones aren't items: everyone has them.
const SETS = { Male_Peasant: 0, Male_Ranger: 0, Female_Peasant: 25, Female_Ranger: 40 };
const SLOTS = ['head', 'top', 'arms', 'legs', 'feet', 'acc'];
const RANGER_ONLY = ['head', 'acc'];
const HAIRS = { Hair_Buzzed: 0, Hair_BuzzedFemale: 15, Hair_SimpleParted: 20, Hair_Long: 35, Hair_Buns: 35 };
export const PRICES = { beard: 20 };
for (const [id, p] of Object.entries(HAIRS)) PRICES[`hair-${id}`] = p;
for (const [set, p] of Object.entries(SETS))
  for (const slot of SLOTS) if (!RANGER_ONLY.includes(slot) || set.endsWith('_Ranger')) PRICES[`${set}-${slot}`] = p;

const HEX = /^#[0-9a-f]{6}$/i;
// Checked field by field, so nothing else rides along (same rules as games/street-5s/server cleanAvatar).
export function cleanAvatar(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {
    body: v.body === 'Female' ? 'Female' : 'Male', skin: Math.max(0, Math.min(5, v.skin | 0)), beard: !!v.beard, fit: v.fit !== false,
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
    ALTER TABLE avatar_profiles ALTER COLUMN tokbux SET DEFAULT ${WELCOME_TOKBUX};
  `);
  console.log('✅ Avatar profiles + TokBux ready');
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
  return r.rows[0];
}

const view = (p) => ({ avatar: p.record ? cleanAvatar(p.record) : null, owned: p.owned, tokbux: p.tokbux, prices: PRICES });

const router = express.Router();
router.use(express.json({ limit: '8kb' }));

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

export default router;
