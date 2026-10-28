// Creates the TokBux packs in Google Play (one-time products, bought with the 'buy' purchase option, a US price that Play converts for every other
// country, an English name and description), through the Play Developer API. Safe to run again: packs that already
// exist are only checked. Without --go it just reports what's there and what it would make.
//
//   node scripts/setup-tokbux-play.mjs [--go]
//   needs: play-service-account.json in this folder (service account revenuecat@gametok1, invited in Play Console
//   with Manage store presence on the app)

import path from 'path';
import { GoogleAuth } from 'google-auth-library';
import { TOKBUX_PACKS } from '../src/tokbux-store.js';

const PACKAGE = 'com.vogeza';
const PRICES = { tokbux_80: '0.99', tokbux_500: '4.99', tokbux_1200: '9.99', tokbux_3000: '19.99', tokbux_8500: '49.99' };
const GO = process.argv.includes('--go');

const root = path.dirname(new URL(import.meta.url).pathname) + '/..';
const client = await new GoogleAuth({ keyFile: path.join(root, 'play-service-account.json'), scopes: ['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
async function api(method, url, data) {
  try { return (await client.request({ method, url: url.startsWith('http') ? url : BASE + url, data })).data; }
  catch (e) { throw new Error(`${method} ${url} → ${e.response?.status}: ${e.response?.data?.error?.message || e.message}`); }
}

const existing = (await api('GET', '/oneTimeProducts?pageSize=100')).oneTimeProducts || [];
for (const [productId, n] of Object.entries(TOKBUX_PACKS)) {
  const name = `${n.toLocaleString('en-US')} TokBux`;
  const have = existing.find((x) => x.productId === productId);
  if (have) { console.log(`✓ ${productId}: exists (${have.purchaseOptions?.map((o) => o.state).join(', ')})`); continue; }
  if (!GO) { console.log(`+ ${productId}: would create "${name}" at $${PRICES[productId]}`); continue; }
  // the US price, converted by Play for every country it sells in (and for countries it adds later)
  const [units, cents] = PRICES[productId].split('.');
  const conv = await api('POST', '/pricing:convertRegionPrices', { price: { currencyCode: 'USD', units, nanos: Number(cents) * 1e7 } });
  await api('POST', '/oneTimeProducts:batchUpdate', { requests: [{ allowMissing: true, updateMask: 'listings,purchaseOptions', regionsVersion: { version: '2026/01' }, oneTimeProduct: {
    packageName: PACKAGE, productId,
    listings: [{ languageCode: 'en-US', title: name, description: `${n.toLocaleString('en-US')} TokBux to spend in GameTok` }],
    purchaseOptions: [{
      purchaseOptionId: 'buy', buyOption: { legacyCompatible: true },
      regionalPricingAndAvailabilityConfigs: Object.values(conv.convertedRegionPrices).map((r) => ({ regionCode: r.regionCode, price: r.price, availability: 'AVAILABLE' })),
      newRegionsConfig: { usdPrice: conv.convertedOtherRegionsPrice.usdPrice, eurPrice: conv.convertedOtherRegionsPrice.eurPrice, availability: 'AVAILABLE' },
    }],
  } }] });
  await api('POST', `/oneTimeProducts/${productId}/purchaseOptions:batchUpdateStates`, {
    requests: [{ activatePurchaseOptionRequest: { packageName: PACKAGE, productId, purchaseOptionId: 'buy' } }] });
  console.log(`+ ${productId}: created "${name}" at $${PRICES[productId]}, ${Object.keys(conv.convertedRegionPrices).length} countries, active`);
}
if (!GO) console.log('\n(dry run: add --go to create)');
