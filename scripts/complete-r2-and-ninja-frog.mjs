import 'dotenv/config';
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

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadToR2(key, buffer, contentType = 'image/png') {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_R2_URL}/${key}`;
}

const NINJA_FROG_ADDITIONS = [
  {
    id: 'asset-pixelfrog-ninja-frog-fall',
    title: 'Ninja Frog (Fall)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ninja_frog', 'pixel_frog', 'hero', 'player', 'ninja', 'frog', 'fall', 'air'],
    source_url: 'https://raw.githubusercontent.com/marpor/PixelAdventure/master/PixelAdventure/Main%20Characters/Ninja%20Frog/Fall%20(32x32).png',
    uses_count: 480,
  },
  {
    id: 'asset-pixelfrog-ninja-frog-hit',
    title: 'Ninja Frog (Hit)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ninja_frog', 'pixel_frog', 'hero', 'player', 'ninja', 'frog', 'hit', 'damage', 'hurt'],
    source_url: 'https://raw.githubusercontent.com/marpor/PixelAdventure/master/PixelAdventure/Main%20Characters/Ninja%20Frog/Hit%20(32x32).png',
    uses_count: 460,
  },
  {
    id: 'asset-pixelfrog-ninja-frog-double-jump',
    title: 'Ninja Frog (Double Jump)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ninja_frog', 'pixel_frog', 'hero', 'player', 'ninja', 'frog', 'jump', 'double_jump', 'acrobat'],
    source_url: 'https://raw.githubusercontent.com/marpor/PixelAdventure/master/PixelAdventure/Main%20Characters/Ninja%20Frog/Double%20Jump%20(32x32).png',
    uses_count: 510,
  },
  {
    id: 'asset-pixelfrog-ninja-frog-wall-jump',
    title: 'Ninja Frog (Wall Jump)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ninja_frog', 'pixel_frog', 'hero', 'player', 'ninja', 'frog', 'wall_jump', 'parkour'],
    source_url: 'https://raw.githubusercontent.com/marpor/PixelAdventure/master/PixelAdventure/Main%20Characters/Ninja%20Frog/Wall%20Jump%20(32x32).png',
    uses_count: 495,
  },
];

async function main() {
  console.log('🐸 Completing Ninja Frog Animation Suite & Final R2 Migration...');
  const client = await pool.connect();
  try {
    // 1. Ingest Ninja Frog animation states
    for (const item of NINJA_FROG_ADDITIONS) {
      try {
        console.log(`Uploading ${item.title} to R2...`);
        const buf = await downloadBuffer(item.source_url);
        const r2Key = `community-assets/characters/${item.id}.png`;
        const r2Url = await uploadToR2(r2Key, buf, 'image/png');

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
            uses_count = EXCLUDED.uses_count,
            is_transparent = true
        `, [item.id, item.title, item.category, item.style, item.tags, r2Url, item.uses_count]);
        console.log(`✅ Ninja Frog: ${item.title} saved to DB and R2 (${r2Url})`);
      } catch (err) {
        console.error(`❌ Failed Ninja Frog ${item.title}:`, err.message);
      }
    }

    // 2. Ensure all existing Ninja Frog rows have 'ninja_frog' tag
    await client.query(`
      UPDATE community_assets
      SET tags = array_append(tags, 'ninja_frog')
      WHERE (id ILIKE '%ninja-frog%' OR title ILIKE '%ninja frog%')
        AND NOT ('ninja_frog' = ANY(tags))
    `);

    // 3. Migrate the remaining 11 non-R2 assets
    const remainingRes = await client.query(`
      SELECT id, title, category, image_url
      FROM community_assets
      WHERE image_url NOT LIKE '%r2.dev%'
    `);

    console.log(`\n📦 Migrating ${remainingRes.rows.length} remaining assets to R2...`);
    for (const asset of remainingRes.rows) {
      try {
        const ext = asset.image_url.endsWith('.jpg') || asset.image_url.endsWith('.jpeg') ? '.jpg' : '.png';
        const r2Key = `community-assets/${asset.category}/${asset.id}${ext}`;
        const contentType = ext === '.jpg' ? 'image/jpeg' : 'image/png';

        console.log(`Downloading: ${asset.title} (${asset.image_url})...`);
        const buf = await downloadBuffer(asset.image_url);
        const r2Url = await uploadToR2(r2Key, buf, contentType);

        await client.query(`
          UPDATE community_assets
          SET image_url = $1, thumbnail_url = $1
          WHERE id = $2
        `, [r2Url, asset.id]);

        console.log(`✅ Migrated: ${asset.title} -> ${r2Url}`);
      } catch (err) {
        console.error(`❌ Failed to migrate ${asset.title}:`, err.message);
      }
    }

    // 4. Check total assets and R2 ratio
    const totalRes = await client.query(`SELECT COUNT(*) as total FROM community_assets`);
    const r2Res = await client.query(`SELECT COUNT(*) as r2_count FROM community_assets WHERE image_url LIKE '%r2.dev%'`);
    console.log(`\n🎉 Migration Complete! Total Assets: ${totalRes.rows[0].total}, On R2: ${r2Res.rows[0].r2_count} (100%)`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
