// Creates the TokBux packs in App Store Connect (consumable in-app purchases, US price, every territory, an English
// name and description), through the App Store Connect API. Safe to run again: packs that already exist are only
// checked. Without --go it just reports what's there and what it would make.
//
//   node scripts/setup-tokbux-appstore.mjs [--go]
//   needs: AuthKey_<KEY ID>.p8 in this folder (App Store Connect → Users and Access → Integrations → App Store
//   Connect API, access App Manager) and ASC_ISSUER_ID (that page's Issuer ID) in the environment or .env

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { TOKBUX_PACKS } from '../src/tokbux-store.js';

const BUNDLE_ID = 'com.olasubomi.gametok';
const PRICES = { tokbux_80: '0.99', tokbux_500: '4.99', tokbux_1200: '9.99', tokbux_3000: '19.99', tokbux_8500: '49.99' };
const GO = process.argv.includes('--go');

const root = path.dirname(new URL(import.meta.url).pathname) + '/..';
const keyFile = fs.readdirSync(root).find((f) => /^AuthKey_\w+\.p8$/.test(f));
const issuer = process.env.ASC_ISSUER_ID;
if (!keyFile || !issuer) { console.error('Needs AuthKey_<id>.p8 in gametok-backend and ASC_ISSUER_ID'); process.exit(1); }
const keyId = keyFile.slice(8, -3), key = fs.readFileSync(path.join(root, keyFile), 'utf8');

// a 15-minute token signed with the key (ES256)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' }), body = b64({ iss: issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}
async function api(method, url, data) {
  const r = await fetch(url.startsWith('http') ? url : `https://api.appstoreconnect.apple.com${url}`, {
    method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify({ data }) : undefined });
  const j = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${(j.errors || []).map((e) => e.detail || e.title).join('; ')}`);
  return j;
}
const all = async (url) => { const out = []; for (let u = url; u;) { const j = await api('GET', u); out.push(...j.data); u = j.links?.next; } return out; };

const app = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
if (!app) throw new Error(`No app with bundle id ${BUNDLE_ID}`);
console.log(`App: ${app.attributes.name} (${app.id})`);
const existing = await all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`);
const territories = (await all('/v1/territories?limit=200')).map((t) => ({ type: 'territories', id: t.id }));

for (const [productId, n] of Object.entries(TOKBUX_PACKS)) {
  const name = `${n.toLocaleString('en-US')} TokBux`;
  let iap = existing.find((x) => x.attributes.productId === productId);
  if (iap) { console.log(`✓ ${productId}: exists (${iap.attributes.state})`); continue; }
  if (!GO) { console.log(`+ ${productId}: would create "${name}" at $${PRICES[productId]}`); continue; }
  iap = (await api('POST', '/v2/inAppPurchases', {
    type: 'inAppPurchases',
    attributes: { name, productId, inAppPurchaseType: 'CONSUMABLE', reviewNote: 'TokBux are GameTok\'s currency, spent on avatar items and in-game heroes. Buy from Profile → TokBux.' },
    relationships: { app: { data: { type: 'apps', id: app.id } } },
  })).data;
  await api('POST', '/v1/inAppPurchaseLocalizations', {
    type: 'inAppPurchaseLocalizations', attributes: { locale: 'en-US', name, description: `${n.toLocaleString('en-US')} TokBux to spend in GameTok` },
    relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } },
  });
  // the US price; Apple sets every other country's from it
  const points = await all(`/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=USA&limit=200`);
  const point = points.find((p) => p.attributes.customerPrice === PRICES[productId]);
  if (!point) throw new Error(`No $${PRICES[productId]} price point`);
  await fetch('https://api.appstoreconnect.apple.com/v1/inAppPurchasePriceSchedules', {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { type: 'inAppPurchasePriceSchedules', relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price}' }] } } },
      included: [{ type: 'inAppPurchasePrices', id: '${price}', attributes: { startDate: null },
        relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: point.id } } } }],
    }),
  }).then(async (r) => { if (!r.ok) throw new Error(`price ${productId} → ${r.status}: ${JSON.stringify((await r.json()).errors?.map((e) => e.detail))}`); });
  await api('POST', '/v1/inAppPurchaseAvailabilities', {
    type: 'inAppPurchaseAvailabilities', attributes: { availableInNewTerritories: true },
    relationships: { inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } }, availableTerritories: { data: territories } },
  });
  console.log(`+ ${productId}: created "${name}" at $${PRICES[productId]}, all ${territories.length} territories`);
}
if (!GO) console.log('\n(dry run: add --go to create)');
