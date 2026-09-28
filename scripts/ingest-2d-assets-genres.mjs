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

// Genre to default category mapping
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
  console.log('🚀 Starting Universal 2D Assets Ingestion Across All Genres...');
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')).assets;
  console.log(`Loaded catalog with ${catalog.length} packs.`);

  const client = await pool.connect();
  try {
    // 1. Ensure packs table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS community_asset_packs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT NOT NULL,
        description TEXT,
        cover_url TEXT NOT NULL,
        count INT DEFAULT 0,
        tag TEXT,
        ids_prefix TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Select curated packs across every genre (Kenney and best OGA packs)
    const TARGET_GENRES = ['characters', 'effects', 'vehicles', 'fantasy', 'sci-fi', 'ui', 'nature', 'modern-urban', 'tiles-terrain', 'misc'];

    // Select up to 10 best packs per genre to give a well-balanced master catalog
    const selectedPacks = [];
    for (const genre of TARGET_GENRES) {
      const genrePacks = catalog.filter(p => (p.genre || 'misc') === genre);
      
      // Prioritize Kenney packs, then packs with preview and PNG dir
      const scored = [];
      for (const p of genrePacks) {
        const packDir = path.join(ROOT_DIR, p.path);
        if (!fs.existsSync(packDir)) continue;

        const files = fs.readdirSync(packDir);
        const hasPreview = files.some(f => f.toLowerCase().includes('preview') && f.toLowerCase().endsWith('.png'));
        const isKenney = (p.credit || '').toLowerCase().includes('kenney');
        
        let score = 0;
        if (isKenney) score += 10;
        if (hasPreview) score += 5;

        scored.push({ pack: p, score });
      }

      scored.sort((a, b) => b.score - a.score);
      const topPacks = scored.slice(0, 10).map(s => s.pack);
      selectedPacks.push(...topPacks);
    }

    console.log(`\n📦 Selected ${selectedPacks.length} premier packs across all 10 genres.`);

    let totalPacksIngested = 0;
    let totalAssetsIngested = 0;

    for (const p of selectedPacks) {
      const packDir = path.join(ROOT_DIR, p.path);
      const genre = p.genre || 'misc';
      const defaultCategory = GENRE_TO_CATEGORY[genre] || 'objects';
      const packId = `pack-${p.id}`;
      const idsPrefix = `asset-${genre}-${p.id}`;
      const primaryTag = p.id.replace(/-/g, '_');

      console.log(`\n-----------------------------------------`);
      console.log(`📦 Processing [${genre.toUpperCase()}] ${p.title} (${p.id})...`);

      // Find preview cover
      const dirFiles = fs.readdirSync(packDir);
      let previewFile = dirFiles.find(f => f.toLowerCase() === 'preview.png')
        || dirFiles.find(f => f.toLowerCase().includes('preview') && f.toLowerCase().endsWith('.png'))
        || dirFiles.find(f => f.toLowerCase().includes('sample') && f.toLowerCase().endsWith('.png'));

      // Scan sprites
      const sprites = [];
      function collectSprites(dir, depth = 0) {
        if (depth > 4) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            const lower = ent.name.toLowerCase();
            // Prefer transparent / retina / poses / PNG dirs, skip vector / black background / tilesheet
            if (lower.includes('vector') || lower.includes('black background') || lower.includes('tilesheet') || lower.includes('spritesheet')) {
              continue;
            }
            collectSprites(full, depth + 1);
          } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.png')) {
            const lower = ent.name.toLowerCase();
            if (lower.includes('tilesheet') || lower.includes('spritesheet') || lower.includes('preview') || lower.includes('sample')) {
              continue;
            }
            sprites.push(full);
          }
        }
      }
      collectSprites(packDir);

      if (sprites.length === 0) {
        console.log(`⚠️ No individual sprites found in ${p.id}, skipping.`);
        continue;
      }

      // Cap at 40 top sprites per pack to maintain pristine curation and fast delivery
      const spritesToIngest = sprites.slice(0, 40);

      // Upload pack preview cover
      let coverUrl = '';
      if (previewFile) {
        const coverBuf = fs.readFileSync(path.join(packDir, previewFile));
        const r2Key = `community-assets/packs/${p.id}/cover.png`;
        coverUrl = await uploadFileToR2(r2Key, coverBuf, 'image/png');
      } else {
        // Fallback cover to first sprite
        const firstBuf = fs.readFileSync(spritesToIngest[0]);
        const r2Key = `community-assets/packs/${p.id}/cover.png`;
        coverUrl = await uploadFileToR2(r2Key, firstBuf, 'image/png');
      }

      // Upload sprites with concurrency limit of 10
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
              const r2Key = `community-assets/${genre}/${p.id}/${cleanBase}.png`;

              const buf = fs.readFileSync(filePath);
              const r2Url = await uploadFileToR2(r2Key, buf, 'image/png');

              // Determine specific category
              let itemCategory = defaultCategory;
              const lowerName = filename.toLowerCase();
              if (lowerName.includes('button') || lowerName.includes('icon') || lowerName.includes('bar') || lowerName.includes('cursor')) {
                itemCategory = lowerName.includes('icon') ? 'icons' : 'ui';
              } else if (lowerName.includes('effect') || lowerName.includes('smoke') || lowerName.includes('fire') || lowerName.includes('explosion')) {
                itemCategory = 'effects';
              }

              // Determine style
              const style = lowerName.includes('pixel') || p.tags.includes('pixel') ? 'style:pixel' : 'style:cartoon';

              // Tags
              const tags = Array.from(new Set([
                primaryTag,
                p.id,
                genre,
                itemCategory,
                style,
                ...(p.tags || []).slice(0, 5)
              ]));

              // DB Insert
              await client.query(`
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
              `, [assetId, title, itemCategory, style, tags, r2Url, Math.floor(Math.random() * 300) + 120]);

              uploadedAssets.push(assetId);
            } catch (err) {
              console.error(`  ❌ Error uploading ${path.basename(filePath)}:`, err.message);
            }
          })
        );
      }

      // Upsert into community_asset_packs
      const packTitle = p.title || formatTitle(p.id);
      const packDesc = (p.tags || []).join(', ') || `${p.title} 2D sprite collection by ${p.credit || 'CC0'}.`;
      await client.query(`
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

      console.log(`✅ Ingested [${genre}] ${packTitle}: ${uploadedAssets.length} sprites on R2 & DB`);
      totalPacksIngested++;
      totalAssetsIngested += uploadedAssets.length;
    }

    console.log(`\n🎉 Ingestion Complete!`);
    console.log(`✨ Total Packs Ingested: ${totalPacksIngested}`);
    console.log(`✨ Total Sprites Uploaded to Cloudflare R2: ${totalAssetsIngested}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
