#!/usr/bin/env node
/**
 * Publish a big web game by sending only what changed. The game lives in one fixed folder
 * (web-games/<id>/live/) with a manifest of every file's hash; each publish uploads the files whose
 * hash changed (and removes the ones that are gone), index.html last. Scripts in index.html get
 * ?v=<hash> so phones fetch a new one at once; everything else is cached for a day at most.
 *
 *   node scripts/publish-web-game-incremental.mjs --id gta-lagos --dir ../games/gta-lagos/dist
 *   (first time, to fill live/ from an existing release without uploading it again:
 *    --seed-from web-games/gta-lagos/<release>   copies those files inside R2)
 * Then the catalog's embed_url points at live/index.html.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const gameId = value('--id'), sourceDir = path.resolve(value('--dir') || ''), seedFrom = value('--seed-from');
const dryRun = args.includes('--dry-run');
if (!gameId || !fs.existsSync(path.join(sourceDir, 'index.html'))) throw new Error('Usage: --id ID --dir DIST_DIR [--seed-from web-games/ID/RELEASE] [--dry-run]');
for (const name of ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL', 'DATABASE_URL']) if (!process.env[name]) throw new Error(`Missing ${name}`);

const MIME = { '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.html': 'text/html; charset=utf-8', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const Bucket = process.env.R2_BUCKET_NAME, prefix = `web-games/${gameId}/live`;
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

// what's here
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === '.DS_Store') return [];
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [path.relative(sourceDir, p).split(path.sep).join('/')];
});
const local = {};
for (const rel of walk(sourceDir)) local[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(sourceDir, rel))).digest('hex');

// what's there (the manifest of the last publish)
let remote = {};
try { const r = await s3.send(new GetObjectCommand({ Bucket, Key: `${prefix}/.manifest.json` })); remote = JSON.parse(await r.Body.transformToString()); } catch (e) { remote = {}; }
const changed = Object.keys(local).filter((f) => f !== 'index.html' && remote[f] !== local[f]);
const gone = Object.keys(remote).filter((f) => !(f in local));
console.log(`${gameId}: ${Object.keys(local).length} files; ${changed.length} new or changed, ${gone.length} removed${seedFrom ? ` (seeding from ${seedFrom})` : ''}`);
if (dryRun) { console.log(changed.slice(0, 30).join('\n')); process.exit(0); }

const put = (key, body, rel) => s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream',
  CacheControl: rel === 'index.html' ? 'no-cache, max-age=0' : rel.endsWith('.js') ? 'public, max-age=300' : 'public, max-age=86400' }));
const copy = (rel) => s3.send(new CopyObjectCommand({ Bucket, Key: `${prefix}/${rel}`, CopySource: encodeURI(`${Bucket}/${seedFrom}/${rel}`), MetadataDirective: 'REPLACE',
  ContentType: MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', CacheControl: rel.endsWith('.js') ? 'public, max-age=300' : 'public, max-age=86400' }));
async function retry(fn) { for (let a = 1; ; a++) { try { return await fn(); } catch (e) { if (a >= 4) throw e; await new Promise((r) => setTimeout(r, 500 * a)); } } }

const queue = [...changed]; let done = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  while (queue.length) {
    const rel = queue.shift();
    await retry(() => (seedFrom && !(rel in remote) && !rel.endsWith('.js') ? copy(rel) : put(`${prefix}/${rel}`, fs.readFileSync(path.join(sourceDir, rel)), rel)));
    if (++done % 1000 === 0) console.log(`${done}/${changed.length}`);
  }
}));
for (let i = 0; i < gone.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: gone.slice(i, i + 1000).map((f) => ({ Key: `${prefix}/${f}` })) } }));

// index.html last, its scripts tagged with their hash so a new one is fetched straight away
const html = fs.readFileSync(path.join(sourceDir, 'index.html'), 'utf8').replace(/(<script[^>]+src=")(js\/[^"?]+\.js)(")/g, (m, a, src, b) => (local[src] ? `${a}${src}?v=${local[src].slice(0, 10)}${b}` : m));
await retry(() => put(`${prefix}/index.html`, html, 'index.html'));
await retry(() => s3.send(new PutObjectCommand({ Bucket, Key: `${prefix}/.manifest.json`, Body: JSON.stringify(local), ContentType: 'application/json', CacheControl: 'no-cache' })));

const embedUrl = `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${prefix}/index.html`;
const fileSize = Object.keys(local).reduce((t, f) => t + fs.statSync(path.join(sourceDir, f)).size, 0);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const r = await pool.query('UPDATE games SET embed_url = $2, file_size = $3 WHERE id = $1 RETURNING id', [gameId, embedUrl, fileSize]);
  if (!r.rowCount) throw new Error(`Game ${gameId} is not in the catalog yet: publish it once with publish-gamesz-web-game.mjs`);
} finally { await pool.end(); }
console.log(`Published ${gameId} -> ${embedUrl} (${changed.length} files sent)`);
