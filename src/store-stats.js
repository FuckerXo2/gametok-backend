// App downloads from the App Store and Google Play, for the admin site. The stores only publish
// daily numbers a day or two late, so this fetches recent days every few hours and stores them
// in app_store_daily (one row per store per day).
//
// Apple: App Store Connect API daily Sales report (needs a key with the Sales role).
//   APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_VENDOR_NUMBER, and the .p8 key as APPLE_PRIVATE_KEY
//   (its text) or APPLE_PRIVATE_KEY_FILE (a path). APPLE_APP_ID picks GameTok's rows.
// Google: Play Console's monthly installs CSVs in its Cloud Storage bucket (needs a service
//   account invited with "View app information and download bulk reports").
//   GOOGLE_PLAY_BUCKET (gs://pubsite_prod_…), and the account's JSON key as
//   GOOGLE_PLAY_SERVICE_ACCOUNT (its text) or GOOGLE_PLAY_SERVICE_ACCOUNT_FILE (a path).
//   GOOGLE_PLAY_PACKAGE picks the app.
// Locally, the files can sit in gametok-backend/secrets/ (git-ignored).
import fs from 'fs';
import zlib from 'zlib';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from 'google-auth-library';

const APPLE_APP_ID = process.env.APPLE_APP_ID || '6757498584';
const PLAY_PACKAGE = process.env.GOOGLE_PLAY_PACKAGE || 'com.vogeza';
const readSecret = (text, file) => text || (file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

export function storeConfig() {
  const appleKey = readSecret(process.env.APPLE_PRIVATE_KEY, process.env.APPLE_PRIVATE_KEY_FILE);
  const playAccount = readSecret(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT, process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE);
  return {
    apple: process.env.APPLE_ISSUER_ID && process.env.APPLE_KEY_ID && process.env.APPLE_VENDOR_NUMBER && appleKey
      ? { issuer: process.env.APPLE_ISSUER_ID, keyId: process.env.APPLE_KEY_ID, vendor: process.env.APPLE_VENDOR_NUMBER, key: appleKey.replace(/\\n/g, '\n') }
      : null,
    google: process.env.GOOGLE_PLAY_BUCKET && playAccount
      ? { bucket: process.env.GOOGLE_PLAY_BUCKET.replace(/^gs:\/\//, '').replace(/\/.*$/, ''), account: JSON.parse(playAccount) }
      : null,
  };
}

const isoDay = (d) => d.toISOString().slice(0, 10);

// ---------- Apple ----------

// Product types in the Sales report: 1* = first-time downloads, 3* = re-downloads, 7* = updates.
const APPLE_KIND = (type) => (/^(1|1F|1T|F1|1E|1EP|1EU)$/.test(type) ? 'downloads' : /^(3|3F|3T|F3)$/.test(type) ? 'redownloads' : /^(7|7F|7T|F7)$/.test(type) ? 'updates' : null);

export function parseAppleSalesReport(tsv, appId = APPLE_APP_ID) {
  const [header, ...rows] = tsv.trim().split('\n');
  const col = header.split('\t');
  const at = (name) => col.indexOf(name);
  const totals = { downloads: 0, redownloads: 0, updates: 0 };
  for (const line of rows) {
    const f = line.split('\t');
    if (appId && f[at('Apple Identifier')] !== String(appId)) continue;
    const kind = APPLE_KIND(f[at('Product Type Identifier')]);
    if (kind) totals[kind] += parseInt(f[at('Units')], 10) || 0;
  }
  return totals;
}

async function appleDay(cfg, day) {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ iss: cfg.issuer, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }, cfg.key, {
    algorithm: 'ES256', header: { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' },
  });
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY', 'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': cfg.vendor, 'filter[reportDate]': day, 'filter[version]': '1_1',
  });
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
  });
  if (res.status === 404) {
    const detail = JSON.stringify(await res.json().catch(() => ({})));
    // "No sales for the date" is a real zero; "not available yet" means come back later.
    return /no sales/i.test(detail) ? { downloads: 0, redownloads: 0, updates: 0 } : null;
  }
  if (!res.ok) throw new Error(`Apple ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const tsv = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  return parseAppleSalesReport(tsv);
}

// ---------- Google ----------

// The Play CSVs are UTF-16 with a byte-order mark and quoted fields.
export function parsePlayInstallsCsv(buffer, pkg = PLAY_PACKAGE) {
  let text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.slice(2).toString('utf16le') : buffer.toString('utf8');
  text = text.replace(/^﻿/, '');
  const lines = text.trim().split(/\r?\n/).map((l) => l.split(',').map((v) => v.replace(/^"|"$/g, '').trim()));
  const [header, ...rows] = lines;
  const at = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const n = (row, name) => (at(name) >= 0 ? parseInt(row[at(name)], 10) || 0 : null);
  return rows
    .filter((r) => r.length > 1 && (!pkg || at('Package Name') < 0 || r[at('Package Name')] === pkg))
    .map((r) => ({
      day: r[at('Date')],
      downloads: n(r, 'Daily User Installs') ?? n(r, 'Install events') ?? 0,
      updates: n(r, 'Daily Device Upgrades') ?? n(r, 'Update events'),
      uninstalls: n(r, 'Daily User Uninstalls') ?? n(r, 'Uninstall events'),
      activeDevices: n(r, 'Active Device Installs'),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
}

async function playMonth(cfg, yyyymm) {
  const auth = new GoogleAuth({ credentials: cfg.account, scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] });
  const token = await auth.getAccessToken();
  const object = encodeURIComponent(`stats/installs/installs_${PLAY_PACKAGE}_${yyyymm}_overview.csv`);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${cfg.bucket}/o/${object}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parsePlayInstallsCsv(Buffer.from(await res.arrayBuffer()));
}

// ---------- Sync ----------

async function save(pool, store, day, v) {
  await pool.query(
    `INSERT INTO app_store_daily (store, day, downloads, redownloads, updates, uninstalls, active_devices, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (store, day) DO UPDATE SET downloads = EXCLUDED.downloads, redownloads = EXCLUDED.redownloads,
       updates = EXCLUDED.updates, uninstalls = EXCLUDED.uninstalls, active_devices = EXCLUDED.active_devices, updated_at = NOW()`,
    [store, day, v.downloads ?? 0, v.redownloads ?? null, v.updates ?? null, v.uninstalls ?? null, v.activeDevices ?? null]);
}

// Fetches recent days from each connected store. `days` is how far back Apple is asked (one
// request per day); Google sends whole months, so this month and last month are read.
export async function syncStoreStats(pool, { days = 14 } = {}) {
  const cfg = storeConfig();
  const result = { apple: cfg.apple ? { days: 0 } : 'not connected', google: cfg.google ? { days: 0 } : 'not connected' };
  if (cfg.apple) {
    try {
      for (let i = 1; i <= days; i++) {
        const day = isoDay(new Date(Date.now() - i * 864e5));
        const v = await appleDay(cfg.apple, day);
        if (v) { await save(pool, 'apple', day, v); result.apple.days++; }
      }
    } catch (err) { result.apple = { error: err.message }; }
  }
  if (cfg.google) {
    try {
      const now = new Date();
      const months = [0, 1].map((back) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      });
      for (const m of months) {
        for (const row of await playMonth(cfg.google, m)) { await save(pool, 'google', row.day, row); result.google.days++; }
      }
    } catch (err) { result.google = { error: err.message }; }
  }
  console.log('[StoreStats]', JSON.stringify(result));
  return result;
}

// Every 6 hours, by one instance only (the slot is claimed in the database).
export async function maybeSyncStoreStats(pool) {
  const cfg = storeConfig();
  if (!cfg.apple && !cfg.google) return;
  const claim = await pool.query(
    `INSERT INTO scheduled_job_runs (name, last_run_at) VALUES ('store_stats_sync', NOW())
     ON CONFLICT (name) DO UPDATE SET last_run_at = NOW()
       WHERE scheduled_job_runs.last_run_at < NOW() - INTERVAL '6 hours'
     RETURNING name`);
  if (claim.rowCount) await syncStoreStats(pool);
}
