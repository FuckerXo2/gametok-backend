// Developer game uploads: a .zip of a built web game (index.html + its JS, images, sounds…)
// is unpacked and hosted on R2. Browsers upload the game's files one by one straight to R2 with
// signed URLs (files/start → PUT each → files/finish): no size limit, nothing held in our
// memory. API clients can instead send a zip (POST it directly up to 32 MiB, or via a signed URL
// up to 200 MB); zips are unpacked in memory, so those keep their caps. The result is a plain game URL that goes through the normal
// link publish (same checks as any hosted game). R2's public domain is a different origin from
// games.gametok.co, so uploaded game code can't touch dashboard sessions.
import crypto from 'crypto';
import { unzipSync } from 'fflate';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

// Cloud Run rejects request bodies over 32 MiB: the ceiling for a zip POSTed to this server.
export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
// Zips uploaded straight to R2. Unpacking holds the whole game in memory (instance has 2 GiB).
export const MAX_DIRECT_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;
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

// Unpacks a zip, hosts every file under a fresh folder and records its size for publish.
async function hostGameZip(buffer, developerId) {
  const { files, entry } = unpackGameZip(buffer);
  const prefix = `uploads/${developerId}/${crypto.randomUUID()}`;
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
  console.log(`[GameUpload] ${developerId} uploaded ${files.length} files (${Math.round(bytes / 1024)} KB) → ${url}`);
  // Publish reads this to size the game before the headless check measures what it loads.
  await pool.query(
    `INSERT INTO game_uploads (url, developer_id, bytes, files) VALUES ($1, $2, $3, $4)
     ON CONFLICT (url) DO NOTHING`,
    [url, String(developerId), bytes, files.length]);
  const { platform, reasons, warnings } = decidePlatform({ bytes });
  return { success: true, url, files: files.length, bytes, platform, reasons, warnings };
}

function sendUploadError(res, err) {
  if (err instanceof UploadError) return res.status(400).json({ error: err.message });
  console.error('[GameUpload] Error:', err);
  return res.status(500).json({ error: 'Could not host the game. Try again.' });
}

// POST /api/developer/uploads — the zip as the request body (up to 32 MB).
export async function handleGameUpload(req, res) {
  try {
    if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) {
      return res.status(400).json({ error: 'Send the game as a .zip (Content-Type: application/zip) in the request body.' });
    }
    return res.json(await hostGameZip(body, req.developer.id));
  } catch (err) {
    return sendUploadError(res, err);
  }
}

// Incoming zips live under the developer's own prefix, so an upload id can't reach anyone else's.
const incomingKey = (developerId, uploadId) => `incoming/${developerId}/${uploadId}.zip`;
const UPLOAD_ID = /^[0-9a-f-]{36}$/;

// POST /api/developer/uploads/start { size } → { uploadId, uploadUrl }. PUT the zip to uploadUrl.
export async function handleGameUploadStart(req, res) {
  try {
    if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
    const size = Number(req.body?.size);
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'Send the zip\'s size in bytes as "size".' });
    if (size > MAX_DIRECT_ZIP_BYTES) {
      return res.status(400).json({ error: `The zip is over ${MAX_DIRECT_ZIP_BYTES / 1024 / 1024} MB. Host the game yourself and publish its link.` });
    }
    const uploadId = crypto.randomUUID();
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: incomingKey(req.developer.id, uploadId),
      ContentType: 'application/zip',
    }), { expiresIn: 3600 });
    return res.json({ uploadId, uploadUrl, contentType: 'application/zip', maxBytes: MAX_DIRECT_ZIP_BYTES });
  } catch (err) {
    return sendUploadError(res, err);
  }
}

// POST /api/developer/uploads/:uploadId/finish → same result as a direct upload.
export async function handleGameUploadFinish(req, res) {
  if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
  if (!UPLOAD_ID.test(req.params.uploadId)) return res.status(404).json({ error: 'Upload not found' });
  const Key = incomingKey(req.developer.id, req.params.uploadId);
  try {
    // A signed URL doesn't cap the size, so check what actually arrived before reading it.
    const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key })).catch(() => null);
    if (!head) return res.status(404).json({ error: 'Upload not found. Upload the zip again.' });
    if (head.ContentLength > MAX_DIRECT_ZIP_BYTES) throw new UploadError(`The zip is over ${MAX_DIRECT_ZIP_BYTES / 1024 / 1024} MB.`);
    const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key }));
    const buffer = Buffer.from(await obj.Body.transformToByteArray());
    return res.json(await hostGameZip(buffer, req.developer.id));
  } catch (err) {
    return sendUploadError(res, err);
  } finally {
    s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key })).catch(() => {});
  }
}

// ---- File-by-file upload (the browser's path; any size) ----

const MAX_UPLOAD_FILES = 50000;
const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024 * 1024; // R2's limit for one PUT
const SIGNED_URL_SECONDS = 12 * 60 * 60;             // a big game on a slow connection takes a while
const uploadPrefix = (developerId, uploadId) => `uploads/${developerId}/${uploadId}`;

// POST /api/developer/uploads/files/start { files: [{ path, size }] }
// → { uploadId, files: [{ path, url }] }. PUT each file to its url with its Content-Type.
// Paths are relative to the folder the developer chose; files outside the folder holding the
// shallowest index.html are dropped, so the game's index.html ends up at the upload's root.
export async function handleGameFilesStart(req, res) {
  try {
    if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
    const list = Array.isArray(req.body?.files) ? req.body.files : null;
    if (!list || !list.length) return res.status(400).json({ error: 'Send the game\'s files as "files": [{ path, size }].' });
    if (list.length > MAX_UPLOAD_FILES) throw new UploadError(`The game has more than ${MAX_UPLOAD_FILES} files.`);
    const files = list.map((f) => ({ path: String(f?.path || '').replace(/\\/g, '/'), size: Number(f?.size) }));
    for (const f of files) {
      if (!f.path || f.path.startsWith('/') || f.path.split('/').some((p) => p === '..' || p === '')) throw new UploadError(`Unsafe file path: ${f.path}`);
      if (!Number.isFinite(f.size) || f.size < 0) throw new UploadError(`Missing size for ${f.path}.`);
      if (f.size > MAX_SINGLE_FILE_BYTES) throw new UploadError(`${f.path} is over 5 GB, the most one file can be.`);
    }
    const entry = files.map((f) => f.path).filter((p) => /(^|\/)index\.html?$/i.test(p))
      .sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!entry) throw new UploadError('No index.html. Choose the folder your build makes (the one with index.html in it).');
    const root = entry.slice(0, entry.length - entry.split('/').pop().length);

    const uploadId = crypto.randomUUID();
    const prefix = uploadPrefix(req.developer.id, uploadId);
    const signed = await Promise.all(files.filter((f) => f.path.startsWith(root)).map(async (f) => {
      const path = f.path.slice(root.length);
      const contentType = contentTypeFor(path);
      const url = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: R2_BUCKET, Key: `${prefix}/${path}`, ContentType: contentType,
      }), { expiresIn: SIGNED_URL_SECONDS });
      return { path: root + path, url, contentType };
    }));
    return res.json({ uploadId, files: signed });
  } catch (err) {
    return sendUploadError(res, err);
  }
}

// POST /api/developer/uploads/files/:uploadId/finish → same result as a zip upload.
export async function handleGameFilesFinish(req, res) {
  try {
    if (!s3) return res.status(503).json({ error: 'Game hosting is not configured on this server.' });
    if (!UPLOAD_ID.test(req.params.uploadId)) return res.status(404).json({ error: 'Upload not found' });
    const developerId = req.developer.id;
    const prefix = uploadPrefix(developerId, req.params.uploadId);

    const objects = [];
    let token;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: `${prefix}/`, ContinuationToken: token }));
      objects.push(...(page.Contents || []));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    const paths = objects.map((o) => o.Key.slice(prefix.length + 1));
    const entry = paths.filter((p) => /^index\.html?$/i.test(p))[0];
    if (!entry) throw new UploadError('The upload didn\'t finish (index.html is missing). Upload the game again.');

    // Same fix as zips: root-absolute asset paths in pages become relative to the page.
    for (const path of paths.filter((p) => /\.html?$/i.test(p))) {
      const Key = `${prefix}/${path}`;
      const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key }));
      const data = Buffer.from(await obj.Body.transformToByteArray());
      const fixed = relativizeRootPaths(data, path);
      if (fixed !== data) {
        await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key, Body: fixed, ContentType: contentTypeFor(path) }));
      }
    }

    const url = `${R2_PUBLIC_URL}/${prefix}/${entry}`;
    const bytes = objects.reduce((n, o) => n + (o.Size || 0), 0);
    console.log(`[GameUpload] ${developerId} uploaded ${objects.length} files (${Math.round(bytes / 1024)} KB, file by file) → ${url}`);
    await pool.query(
      `INSERT INTO game_uploads (url, developer_id, bytes, files) VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO NOTHING`,
      [url, String(developerId), bytes, objects.length]);
    return res.json({ success: true, url, files: objects.length, bytes });
  } catch (err) {
    return sendUploadError(res, err);
  }
}
