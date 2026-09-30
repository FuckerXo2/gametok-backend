#!/usr/bin/env node
/** Build artifacts are uploaded atomically, then the catalog URL is switched to the new release. */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const gameId = value('--id');
const sourceDir = path.resolve(value('--dir') || '');
const title = value('--title');
const orientation = value('--orientation') || 'landscape';
const category = value('--category') || 'arcade';
const creator = value('--creator');
const description = value('--description');
const color = value('--color') || '#111827';
const thumbnailArg = value('--thumbnail');
const dryRun = args.includes('--dry-run');
const preserveMetadata = args.includes('--preserve-metadata');

if (!gameId || !sourceDir || (!title && !preserveMetadata)) {
  throw new Error('Usage: --id ID --dir DIST_DIR (--title TITLE | --preserve-metadata) [--orientation landscape] [--creator USERNAME]');
}
if (!fs.existsSync(path.join(sourceDir, 'index.html'))) {
  throw new Error(`No index.html in ${sourceDir}. Build the game before publishing.`);
}
if (!['portrait', 'landscape'].includes(orientation)) {
  throw new Error(`Unsupported orientation: ${orientation}`);
}

const required = ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL'];
if (!dryRun) {
  for (const name of [...required, 'DATABASE_URL']) {
    if (!process.env[name]) throw new Error(`Missing ${name}`);
  }
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function collectFiles(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? collectFiles(fullPath, base)
      : [{ fullPath, relativePath: path.relative(base, fullPath).split(path.sep).join('/') }];
  });
}

const files = collectFiles(sourceDir);
const releaseHash = crypto.createHash('sha256');
for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
  releaseHash.update(file.relativePath);
  releaseHash.update(fs.readFileSync(file.fullPath));
}
const release = releaseHash.digest('hex').slice(0, 12);
const prefix = `web-games/${gameId}/${release}`;
const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '') || 'https://example.invalid';
const embedUrl = `${publicBase}/${prefix}/index.html`;

console.log(`${gameId}: ${files.length} files, release ${release}`);
console.log(embedUrl);
if (dryRun) process.exit(0);

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

for (const file of files) {
  const extension = path.extname(file.fullPath).toLowerCase();
  const isEntryDocument = file.relativePath === 'index.html';
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${prefix}/${file.relativePath}`,
    Body: fs.readFileSync(file.fullPath),
    ContentType: mimeTypes[extension] || 'application/octet-stream',
    CacheControl: isEntryDocument ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable',
  }));
  process.stdout.write('.');
}
process.stdout.write('\n');

let uploadedThumbnailUrl = null;
if (thumbnailArg && fs.existsSync(thumbnailArg)) {
  const thumbExt = path.extname(thumbnailArg).toLowerCase() || '.jpg';
  const thumbKey = `web-games/${gameId}/thumb${thumbExt}`;
  if (!dryRun) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: thumbKey,
      Body: fs.readFileSync(thumbnailArg),
      ContentType: mimeTypes[thumbExt] || 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  uploadedThumbnailUrl = `${publicBase}/${thumbKey}`;
  console.log(`Thumbnail uploaded: ${uploadedThumbnailUrl}`);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const fileSize = files.reduce((total, file) => total + fs.statSync(file.fullPath).size, 0);
  if (preserveMetadata) {
    const result = await pool.query(
      `UPDATE games
       SET embed_url = $2, file_size = $3
       WHERE id = $1
       RETURNING id`,
      [gameId, embedUrl, fileSize],
    );
    if (!result.rowCount) {
      throw new Error(`Cannot preserve metadata: game ${gameId} does not exist`);
    }
    console.log(`Preserved catalog metadata for ${gameId}`);
  } else {
    let developer = null;
    if (creator) {
      const creatorResult = await pool.query('SELECT id::text FROM users WHERE username = $1', [creator]);
      if (!creatorResult.rowCount) throw new Error(`Creator @${creator} does not exist`);
      developer = creatorResult.rows[0].id;
    }

    await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category, embed_url, developer, orientation, file_size, thumbnail)
       VALUES ($1, $2, $3, '🎮', $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         color = EXCLUDED.color,
         category = EXCLUDED.category,
         embed_url = EXCLUDED.embed_url,
         developer = COALESCE(EXCLUDED.developer, games.developer),
         orientation = EXCLUDED.orientation,
         file_size = EXCLUDED.file_size,
         thumbnail = COALESCE(EXCLUDED.thumbnail, games.thumbnail)`,
      [gameId, title, description || `${title}, optimized for the GameTok web runtime.`, color, category, embedUrl, developer, orientation, fileSize, uploadedThumbnailUrl],
    );
  }
} finally {
  await pool.end();
}

console.log(`Published ${gameId} -> ${embedUrl}`);
