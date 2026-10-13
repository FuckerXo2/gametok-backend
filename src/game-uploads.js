// Developer game uploads: a .zip of a built web game (index.html + its JS, images, sounds…)
// is unpacked and hosted on R2. The result is a plain game URL that goes through the normal
// link publish (same checks as any hosted game). R2's public domain is a different origin from
// games.gametok.co, so uploaded game code can't touch dashboard sessions.
import crypto from 'crypto';
import { unzipSync } from 'fflate';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from './db.js';
import { decidePlatform } from './mobile-fit.js';

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'gametok-games-assets';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/$/, '');
const s3 = process.env.R2_ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

// Cloud Run rejects request bodies over 32 MiB, so that's the real ceiling for the zip.
export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 2000;

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json',
  wasm: 'application/wasm', txt: 'text/plain; charset=utf-8', xml: 'application/xml', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', ktx2: 'image/ktx2',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', weba: 'audio/webm', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', fbx: 'application/octet-stream',
  data: 'application/octet-stream', bin: 'application/octet-stream', unityweb: 'application/octet-stream',
};
const contentTypeFor = (name) => CONTENT_TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream';

class UploadError extends Error {}

// Returns { files: [{ path, data }] } rooted at the folder holding the game's index.html.
export function unpackGameZip(buffer) {
  let declared = 0;
  let count = 0;
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (f.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store$|Thumbs\.db$)/.test(f.name)) return false;
        count += 1;
        declared += f.originalSize;
        if (count > MAX_FILES) throw new UploadError(`The zip has more than ${MAX_FILES} files.`);
        if (declared > MAX_UNPACKED_BYTES) throw new UploadError(`The game is over ${MAX_UNPACKED_BYTES / 1024 / 1024} MB unzipped.`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError('That file isn\'t a readable .zip.');
  }

  const names = Object.keys(entries).map((n) => n.replace(/\\/g, '/'));
  if (names.some((n) => n.startsWith('/') || n.split('/').includes('..'))) throw new UploadError('The zip contains unsafe file paths.');

  // The game's entry is the shallowest index.html (zips often wrap everything in one folder).
  const indexes = names.filter((n) => /(^|\/)index\.html?$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
  if (!indexes.length) throw new UploadError('No index.html in the zip. Zip the folder your build tool outputs (the one with index.html in it).');
  const entry = indexes[0];
  const root = entry.slice(0, entry.length - entry.split('/').pop().length);

  const files = Object.entries(entries)
    .map(([name, data]) => ({ path: name.replace(/\\/g, '/'), data }))
    .filter((f) => f.path.startsWith(root))
    .map((f) => ({ path: f.path.slice(root.length), data: f.data }));
  for (const f of files) {
    if (/\.html?$/i.test(f.path)) f.data = relativizeRootPaths(f.data, f.path);
  }
  return { files, entry: entry.slice(root.length) };
}

// Build tools default to root-absolute asset paths (Vite's "/assets/index-x.js"), which would
// point at the bucket root once the game lives in a folder. Rewrite them relative to the page.
function relativizeRootPaths(data, filePath) {
  const depth = filePath.split('/').length - 1;
  const prefix = depth ? '../'.repeat(depth) : './';
  const html = Buffer.from(data).toString('utf8');
  const fixed = html.replace(/(\s(?:src|href|poster|data)\s*=\s*["'])\/(?!\/)/gi, `$1${prefix}`);
  return fixed === html ? data : Buffer.from(fixed, 'utf8');
}

export async function handleGameUpload(req, res) {
  try {
    if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) {
      return res.status(400).json({ error: 'Send the game as a .zip (Content-Type: application/zip) in the request body.' });
    }
    const { files, entry } = unpackGameZip(body);

    const uploadId = crypto.randomUUID();
    const prefix = `uploads/${req.developer.id}/${uploadId}`;
    const queue = [...files];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: `${prefix}/${f.path}`,
          Body: f.data,
          ContentType: contentTypeFor(f.path),
          // Every upload gets a fresh folder, so files never change at a URL.
          CacheControl: 'public, max-age=31536000, immutable',
        }));
      }
    };
    await Promise.all(Array.from({ length: 12 }, worker));

    const url = `${R2_PUBLIC_URL}/${prefix}/${entry.split('/').map(encodeURIComponent).join('/')}`;
    const bytes = files.reduce((n, f) => n + f.data.length, 0);
    console.log(`[GameUpload] ${req.developer.id} uploaded ${files.length} files (${Math.round(bytes / 1024)} KB) → ${url}`);
    // Publish reads this to size the game before the headless check measures what it loads.
    await pool.query(
      `INSERT INTO game_uploads (url, developer_id, bytes, files) VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO NOTHING`,
      [url, String(req.developer.id), bytes, files.length]);
    const { platform, reasons, warnings } = decidePlatform({ bytes });
    return res.json({ success: true, url, files: files.length, bytes, platform, reasons, warnings });
  } catch (err) {
    if (err instanceof UploadError) return res.status(400).json({ error: err.message });
    console.error('[GameUpload] Error:', err);
    return res.status(500).json({ error: 'Could not host the game. Try again.' });
  }
}
