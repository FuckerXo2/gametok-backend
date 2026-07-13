#!/usr/bin/env node
// v2 upload to R2: pushes {sheet PNG, atlas JSON} per labeled item into
//   assets/v2/{asset_type}/{pack_slug}/{basename}.{png,json}
// Also rewrites _labeled.json to add `r2` block with sheet/atlas public URLs so the retrieval
// layer never touches disk paths. Full HEAD verification runs at the end and aborts on any miss.
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
for (const k of REQUIRED_ENV) if (!process.env[k]) { console.error(`Missing env: ${k}`); process.exit(1); }

const STAGING = 'v2-catalog/staging/kenney-all';
const LABELED = path.join(STAGING, '_labeled.json');
const labeledBundle = JSON.parse(fs.readFileSync(LABELED));

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/, '');

function slugify(s) { return s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase(); }

// Deterministic R2 key builder — no randomness, re-runs produce identical keys, no overwrites of
// unrelated content because the {asset_type}/{pack_slug} prefix is unique to each catalog entry.
function r2KeysFor(item) {
  const packSlug = slugify(item.source_pack);
  const basename = path.basename(item.atlas_ref.sheet, '.png');
  const dir = `assets/v2/${item.asset_type}/${packSlug}`;
  return {
    sheetKey: `${dir}/${basename}.png`,
    atlasKey: `${dir}/${basename}.json`,
    sheetLocal: item.atlas_ref.sheet_path,
    atlasLocal: item.atlas_ref.sheet_path.replace(/\.png$/, '.json'),
  };
}

async function putObject(localPath, key, contentType) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { key, size: body.length };
}

async function uploadItem(item) {
  const keys = r2KeysFor(item);
  await Promise.all([
    putObject(keys.sheetLocal, keys.sheetKey, 'image/png'),
    putObject(keys.atlasLocal, keys.atlasKey, 'application/json'),
  ]);
  return { id: item.id, sheetKey: keys.sheetKey, atlasKey: keys.atlasKey };
}

async function runBatches(items, concurrency = 12) {
  const results = [];
  const errors = [];
  const t0 = Date.now();
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(uploadItem));
    settled.forEach((s, idx) => {
      if (s.status === 'fulfilled') results.push(s.value);
      else errors.push({ id: batch[idx].id, error: s.reason.message });
    });
    process.stdout.write(`\r  uploaded ${results.length}/${items.length} (${errors.length} errors, ${((Date.now()-t0)/1000).toFixed(1)}s)   `);
  }
  console.log();
  return { results, errors };
}

async function headObject(key) {
  const url = `${PUBLIC_URL}/${key}`;
  const res = await fetch(url, { method: 'HEAD' });
  return { key, url, ok: res.ok, status: res.status };
}

async function verifyAll(uploadResults, concurrency = 24) {
  const allKeys = [];
  for (const r of uploadResults) { allKeys.push(r.sheetKey, r.atlasKey); }
  const misses = [];
  const t0 = Date.now();
  let checked = 0;
  for (let i = 0; i < allKeys.length; i += concurrency) {
    const batch = allKeys.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(headObject));
    for (const r of results) if (!r.ok) misses.push(r);
    checked += batch.length;
    process.stdout.write(`\r  verified ${checked}/${allKeys.length} (${misses.length} misses, ${((Date.now()-t0)/1000).toFixed(1)}s)   `);
  }
  console.log();
  return misses;
}

async function main() {
  const items = labeledBundle.items;
  console.log(`v2 upload → bucket: ${BUCKET}`);
  console.log(`Items to upload: ${items.length} (× 2 objects each = ${items.length * 2} total puts)`);

  console.log('\n=== UPLOAD ===');
  const { results, errors } = await runBatches(items);
  if (errors.length) {
    console.error(`❌ ${errors.length} uploads failed — aborting before verification.`);
    for (const e of errors.slice(0, 10)) console.error(`  ${e.id}: ${e.error}`);
    process.exit(1);
  }

  console.log('\n=== FULL HEAD VERIFICATION ===');
  const misses = await verifyAll(results);
  if (misses.length) {
    console.error(`❌ ${misses.length} objects failed HEAD verification.`);
    for (const m of misses.slice(0, 10)) console.error(`  ${m.status} ${m.url}`);
    process.exit(1);
  }
  console.log(`✅ All ${results.length * 2} objects live on R2.`);

  console.log('\n=== REWRITING LABELED MANIFEST WITH R2 URLS ===');
  const keyIndex = new Map(results.map(r => [r.id, r]));
  for (const item of items) {
    const r = keyIndex.get(item.id);
    item.r2 = {
      sheet_url: `${PUBLIC_URL}/${r.sheetKey}`,
      atlas_url: `${PUBLIC_URL}/${r.atlasKey}`,
      sheet_key: r.sheetKey,
      atlas_key: r.atlasKey,
    };
  }
  fs.writeFileSync(LABELED, JSON.stringify(labeledBundle, null, 2));
  console.log(`Wrote r2 URLs to ${LABELED}`);
  console.log(`\nSample sheet URL: ${items[0].r2.sheet_url}`);
  console.log(`Sample atlas URL: ${items[0].r2.atlas_url}`);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
