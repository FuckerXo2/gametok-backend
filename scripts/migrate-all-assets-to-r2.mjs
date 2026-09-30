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
      'User-Agent': 'GameTok-Asset-Migrator/1.0',
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

async function main() {
  console.log('🚀 Starting Mass Asset Migration to Cloudflare R2...');
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, title, category, image_url
      FROM community_assets
      WHERE image_url NOT LIKE '%r2.dev%'
      ORDER BY id ASC
    `);

    const total = res.rows.length;
    console.log(`📦 Found ${total} assets to migrate to Cloudflare R2.`);

    let success = 0;
    let failed = 0;

    // Process in batches of 10 concurrently
    const CONCURRENCY = 10;
    for (let i = 0; i < total; i += CONCURRENCY) {
      const batch = res.rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (asset) => {
          try {
            const ext = asset.image_url.endsWith('.jpg') || asset.image_url.endsWith('.jpeg') ? '.jpg' : '.png';
            const r2Key = `community-assets/${asset.category}/${asset.id}${ext}`;
            const contentType = ext === '.jpg' ? 'image/jpeg' : 'image/png';

            const buf = await downloadBuffer(asset.image_url);
            const r2Url = await uploadToR2(r2Key, buf, contentType);

            await client.query(`
              UPDATE community_assets
              SET image_url = $1, thumbnail_url = $1
              WHERE id = $2
            `, [r2Url, asset.id]);

            success++;
            if (success % 25 === 0 || success === total) {
              console.log(`⚡ Migrated ${success}/${total} assets to R2...`);
            }
          } catch (err) {
            console.warn(`⚠️ Failed to migrate ${asset.id} (${asset.image_url}): ${err.message}`);
            failed++;
          }
        })
      );
    }

    console.log(`\n🎉 Migration Complete!`);
    console.log(`✅ Success: ${success}`);
    console.log(`⚠️ Failed: ${failed}`);

    const r2CountRes = await client.query(`
      SELECT count(*) FROM community_assets WHERE image_url LIKE '%r2.dev%'
    `);
    const totalCountRes = await client.query(`
      SELECT count(*) FROM community_assets
    `);
    console.log(`📊 Now on Cloudflare R2: ${r2CountRes.rows[0].count} / ${totalCountRes.rows[0].count} total assets!`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
