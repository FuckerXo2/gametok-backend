import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const BUCKET = process.env.R2_BUCKET_NAME || 'gametok-games-assets';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_R2_URL = process.env.R2_PUBLIC_URL || 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ROOT_DIR = path.resolve('../2d-assets-main');
const CATALOG_PATH = path.join(ROOT_DIR, 'catalog.json');

const GENRE_TO_CATEGORY = {
  characters: 'characters',
  effects: 'effects',
  vehicles: 'objects',
  fantasy: 'objects',
  'sci-fi': 'objects',
  ui: 'ui',
  nature: 'backgrounds',
  'modern-urban': 'objects',
  'tiles-terrain': 'backgrounds',
  misc: 'objects',
};

function formatTitle(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
}

async function uploadFileToR2(r2Key, buffer, contentType = 'image/png') {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_R2_URL}/${r2Key}`;
}

async function main() {
  console.log('🚀 Starting Ingestion of All Remaining Packs from 2D Assets Main...');
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')).assets;

  const client = await pool.connect();
  try {
    const existingPacksRes = await client.query('SELECT id FROM community_asset_packs');
    const existingIds = new Set(existingPacksRes.rows.map(r => r.id.replace('pack-', '')));
    console.log(`Packs already in DB: ${existingIds.size}`);

    const remainingPacks = catalog.filter(p => !existingIds.has(p.id));
    console.log(`Remaining candidate packs: ${remainingPacks.length}`);

    let totalPacksIngested = 0;
    let totalAssetsIngested = 0;

    for (const p of remainingPacks) {
      const packDir = path.join(ROOT_DIR, p.path);
      if (!fs.existsSync(packDir)) continue;

      const genre = p.genre || 'misc';
      const defaultCategory = GENRE_TO_CATEGORY[genre] || 'objects';
      const packId = `pack-${p.id}`;
      const idsPrefix = `asset-${genre}-${p.id}`;
      const primaryTag = p.id.replace(/-/g, '_');

      // Find preview cover
      const dirFiles = fs.readdirSync(packDir);
      let previewFile = dirFiles.find(f => f.toLowerCase() === 'preview.png')
        || dirFiles.find(f => f.toLowerCase().includes('preview') && (f.endsWith('.png') || f.endsWith('.jpg')))
        || dirFiles.find(f => f.toLowerCase().includes('sample') && (f.endsWith('.png') || f.endsWith('.jpg')));

      // Scan sprites
      const sprites = [];
      function collectSprites(dir, depth = 0) {
        if (depth > 4) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            const lower = ent.name.toLowerCase();
            if (lower.includes('vector') || lower.includes('black background') || lower.includes('tilesheet') || lower.includes('spritesheet')) {
              continue;
            }
            collectSprites(full, depth + 1);
          } else if (ent.isFile() && (ent.name.toLowerCase().endsWith('.png') || ent.name.toLowerCase().endsWith('.jpg'))) {
            const lower = ent.name.toLowerCase();
            if (lower.includes('tilesheet') || lower.includes('spritesheet') || lower.includes('preview') || lower.includes('sample')) {
              continue;
            }
            sprites.push(full);
          }
        }
      }
      collectSprites(packDir);

      if (sprites.length === 0 && !previewFile) continue;

      // Take up to 25 top sprites per pack to keep database brisk and responsive
      const spritesToIngest = sprites.slice(0, 25);

      // Upload pack preview cover
      let coverUrl = '';
      try {
        if (previewFile) {
          const coverBuf = fs.readFileSync(path.join(packDir, previewFile));
          const ext = previewFile.toLowerCase().endsWith('.jpg') ? '.jpg' : '.png';
          const r2Key = `community-assets/packs/${p.id}/cover${ext}`;
          coverUrl = await uploadFileToR2(r2Key, coverBuf, ext === '.jpg' ? 'image/jpeg' : 'image/png');
        } else if (spritesToIngest.length > 0) {
          const firstBuf = fs.readFileSync(spritesToIngest[0]);
          const r2Key = `community-assets/packs/${p.id}/cover.png`;
          coverUrl = await uploadFileToR2(r2Key, firstBuf, 'image/png');
        }
      } catch (err) {
        console.warn(`Could not upload cover for ${p.id}:`, err.message);
        continue;
      }

      // Upload sprites in batches of 10
      const uploadedAssets = [];
      const CONCURRENCY = 10;
      for (let i = 0; i < spritesToIngest.length; i += CONCURRENCY) {
        const batch = spritesToIngest.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (filePath) => {
            try {
              const filename = path.basename(filePath);
              const cleanBase = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
              const assetId = `${idsPrefix}-${cleanBase}`;
              const title = formatTitle(filename);
              const ext = filePath.toLowerCase().endsWith('.jpg') ? '.jpg' : '.png';
              const r2Key = `community-assets/${genre}/${p.id}/${cleanBase}${ext}`;

              const buf = fs.readFileSync(filePath);
              const r2Url = await uploadFileToR2(r2Key, buf, ext === '.jpg' ? 'image/jpeg' : 'image/png');

              let itemCategory = defaultCategory;
              const lowerName = filename.toLowerCase();
              if (lowerName.includes('button') || lowerName.includes('icon') || lowerName.includes('bar') || lowerName.includes('cursor')) {
                itemCategory = lowerName.includes('icon') ? 'icons' : 'ui';
              } else if (lowerName.includes('effect') || lowerName.includes('smoke') || lowerName.includes('fire') || lowerName.includes('explosion')) {
                itemCategory = 'effects';
              }

              const style = lowerName.includes('pixel') || p.tags.includes('pixel') ? 'style:pixel' : 'style:cartoon';
              const tags = Array.from(new Set([
                primaryTag,
                p.id,
                genre,
                itemCategory,
                style,
                ...(p.tags || []).slice(0, 5)
              ]));

              await pool.query(`
                INSERT INTO community_assets (id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent)
                VALUES ($1, $2, $3, $4, $5, $6, $6, $7, true)
                ON CONFLICT (id) DO UPDATE SET
                  title = EXCLUDED.title,
                  category = EXCLUDED.category,
                  style = EXCLUDED.style,
                  tags = EXCLUDED.tags,
                  image_url = EXCLUDED.image_url,
                  thumbnail_url = EXCLUDED.thumbnail_url,
                  is_transparent = true
              `, [assetId, title, itemCategory, style, tags, r2Url, Math.floor(Math.random() * 250) + 80]);

              uploadedAssets.push(assetId);
            } catch (err) {
              // Ignore single file error
            }
          })
        );
      }

      // Upsert into community_asset_packs
      const packTitle = p.title || formatTitle(p.id);
      const packDesc = (p.tags || []).join(', ') || `${p.title} 2D sprite collection by ${p.credit || 'CC0'}.`;
      await pool.query(`
        INSERT INTO community_asset_packs (id, title, genre, description, cover_url, count, tag, ids_prefix)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          genre = EXCLUDED.genre,
          description = EXCLUDED.description,
          cover_url = EXCLUDED.cover_url,
          count = EXCLUDED.count,
          tag = EXCLUDED.tag,
          ids_prefix = EXCLUDED.ids_prefix
      `, [packId, packTitle, genre, packDesc, coverUrl, uploadedAssets.length, primaryTag, idsPrefix]);

      totalPacksIngested++;
      totalAssetsIngested += uploadedAssets.length;
      if (totalPacksIngested % 10 === 0) {
        console.log(`✨ Progress: Ingested ${totalPacksIngested} packs (${totalAssetsIngested} sprites)...`);
      }
    }

    console.log(`\n🎉 Ingestion of All Remaining Packs Complete!`);
    console.log(`✨ Additional Packs Ingested: ${totalPacksIngested}`);
    console.log(`✨ Additional Sprites Uploaded to Cloudflare R2: ${totalAssetsIngested}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
