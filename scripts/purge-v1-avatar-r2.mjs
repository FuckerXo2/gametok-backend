#!/usr/bin/env node
// Removes the old (v1) avatar from R2, 2026-11-25: everything under web-games/avatar/v1/ except the heroes'
// models (v1/assets/lite/characters/, which every game and the app stage load), and the old items' Shop pictures
// (web-games/avatar/assets/thumbs/<v1 item>.webp, plus the old face/build pictures). Heroes' pictures stay.
//   node scripts/purge-v1-avatar-r2.mjs          lists what would go
//   node scripts/purge-v1-avatar-r2.mjs --go     deletes it
//   ... --pictures-only                          just the old item pictures (v1/ stays: older game builds load its code)
import 'dotenv/config';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { ITEMS } from '../src/avatar-items.js';

const GO = process.argv.includes('--go');
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const Bucket = process.env.R2_BUCKET_NAME;
async function list(Prefix) {
  const out = []; let ContinuationToken;
  do { const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })); out.push(...(r.Contents || [])); ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined; } while (ContinuationToken);
  return out;
}
const HEROES = 'web-games/avatar/v1/assets/lite/characters/';
const keepIds = new Set(ITEMS.filter((i) => !['part', 'hair', 'beard'].includes(i.kind)).map((i) => i.id));   // characters, outfits of heroes, game items
const v1 = (await list('web-games/avatar/v1/')).filter((o) => !o.Key.startsWith(HEROES));
const thumbs = (await list('web-games/avatar/assets/thumbs/')).filter((o) => {
  const name = o.Key.split('/').pop(); if (name.startsWith('.')) return false;
  const id = name.replace(/\.webp$/, '');
  return !keepIds.has(id);
});
const gone = process.argv.includes('--pictures-only') ? thumbs : [...v1, ...thumbs];
const mb = (xs) => (xs.reduce((t, o) => t + o.Size, 0) / 1048576).toFixed(1);
console.log(`v1/: ${v1.length} files (${mb(v1)} MB), old item pictures: ${thumbs.length} (${mb(thumbs)} MB)`);
console.log('kept pictures:', [...keepIds].slice(0, 40).join(', '));
console.log('sample gone:', thumbs.slice(0, 8).map((o) => o.Key.split('/').pop()).join(', '), '|', v1.slice(0, 5).map((o) => o.Key.slice(21)).join(', '));
if (GO) {
  for (let i = 0; i < gone.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: gone.slice(i, i + 1000).map((o) => ({ Key: o.Key })), Quiet: true } }));
  console.log('deleted', gone.length);
} else console.log('(dry run: --go to delete)');
