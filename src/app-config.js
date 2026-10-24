// What the app checks when it opens: the oldest version still allowed (older ones must update first).
// Change it with SQL when a release that must be forced is in both stores, e.g.
//   UPDATE app_config SET value = '2.2.0' WHERE key = 'min_version_ios';
//   UPDATE app_config SET value = 'https://apps.apple.com/app/id…' WHERE key = 'store_url_ios';
//
//   GET /api/app/config   { minVersion: { ios, android }, storeUrl: { ios, android } }

import express from 'express';
import pool from './db.js';

const DEFAULTS = {
  min_version_ios: '0.0.0',
  min_version_android: '0.0.0',
  store_url_ios: '',   // set to the App Store page (https://apps.apple.com/app/id…); empty: the app searches the App Store
  store_url_android: 'https://play.google.com/store/apps/details?id=com.olasubomi.gametok',
};

export async function runAppConfigMigration() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_config (key VARCHAR(60) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())`);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

const router = express.Router();
router.get('/config', async (req, res) => {
  try {
    const rows = (await pool.query('SELECT key, value FROM app_config')).rows;
    const c = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    res.set('Cache-Control', 'no-store');
    res.json({ minVersion: { ios: c.min_version_ios, android: c.min_version_android }, storeUrl: { ios: c.store_url_ios, android: c.store_url_android } });
  } catch (err) {
    console.error('[AppConfig]', err);
    res.json({ minVersion: { ios: '0.0.0', android: '0.0.0' }, storeUrl: { ios: DEFAULTS.store_url_ios, android: DEFAULTS.store_url_android } });
  }
});

export default router;
