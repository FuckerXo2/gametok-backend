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

const CATEGORY_QUERIES = [
  {
    category: 'synthwave',
    queries: ['retro', 'grid', 'neon'],
    chips: ['neon', 'grid', 'retro', '80s', 'outrun', 'horizon'],
  },
  {
    category: 'space',
    queries: ['space', 'galaxy', 'tunnel'],
    chips: ['warp', 'stars', 'galaxy', 'nebula', 'hyperspace', 'orbit'],
  },
  {
    category: 'cyberpunk',
    queries: ['cyberpunk', 'speed'],
    chips: ['rain', 'city', 'matrix', 'tunnel', 'hologram', 'speed'],
  },
  {
    category: 'particles',
    queries: ['particles', 'fire'],
    chips: ['dust', 'sparks', 'fire', 'light', 'magic', 'energy'],
  },
  {
    category: 'atmosphere',
    queries: ['fog', 'clouds', 'night'],
    chips: ['fog', 'dungeon', 'underwater', 'torches', 'clouds', 'dark'],
  },
  {
    category: 'nature',
    queries: ['forest', 'waterfall', 'rain'],
    chips: ['forest', 'waterfall', 'mountains', 'night', 'ocean', 'sunset'],
  },
  {
    category: 'abstract',
    queries: ['abstract', 'loop'],
    chips: ['fluid', 'gradient', 'waves', 'geometric', 'minimal', 'vj'],
  },
];

function cleanTitle(str) {
  if (!str) return 'Ambient Game Loop';
  let t = str
    .replace(/^mixkit[-_]/i, '')
    .replace(/[-_]\d+[-_]hd[-_]ready/i, '')
    .replace(/[-_]\d+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function uploadToR2(r2Key, buffer, contentType = 'video/mp4') {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    })
  );
  return `${PUBLIC_R2_URL}/${r2Key}`;
}

async function fetchBuffer(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        Referer: 'https://mixkit.co/',
      },
    });
    if (!res.ok) return null;
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      disposition: res.headers.get('content-disposition') || '',
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('🚀 Starting Ingestion of Premium Looping Game Backgrounds...');

  const seenIds = new Set();
  let totalIngested = 0;

  for (const catConfig of CATEGORY_QUERIES) {
    console.log(`\n📂 Processing category: ${catConfig.category.toUpperCase()}...`);
    let catCount = 0;
    const TARGET_PER_CAT = 12;

    for (const q of catConfig.queries) {
      if (catCount >= TARGET_PER_CAT) break;
      const url = `https://mixkit.co/free-stock-video/${q}/`;
      let html = '';
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) continue;
        html = await res.text();
      } catch (e) {
        continue;
      }

      const matches = [...html.matchAll(/https:\/\/assets\.mixkit\.co\/videos\/(\d+)\//g)];
      const pageIds = [...new Set(matches.map((m) => m[1]))];

      for (const id of pageIds) {
        if (seenIds.has(id) || catCount >= TARGET_PER_CAT) continue;
        seenIds.add(id);

        const video720Url = `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`;
        const video360Url = `https://assets.mixkit.co/videos/${id}/${id}-360.mp4`;
        const thumbUrl = `https://assets.mixkit.co/videos/${id}/${id}-thumb-720-0.jpg`;

        // 1. Download video
        let vidRes = await fetchBuffer(video720Url);
        let quality = '720p';
        if (!vidRes || vidRes.buffer.length === 0) {
          vidRes = await fetchBuffer(video360Url);
          quality = '360p';
        }
        if (!vidRes || vidRes.buffer.length === 0) continue;

        // Skip files that are unreasonably large (> 12MB) for mobile web game loops
        if (vidRes.buffer.length > 12 * 1024 * 1024) {
          continue;
        }

        // 2. Download thumbnail
        const thumbRes = await fetchBuffer(thumbUrl);
        if (!thumbRes || thumbRes.buffer.length === 0) continue;

        // Extract filename from disposition or query
        const dispMatch = vidRes.disposition.match(/filename="?([^";]+)"?/);
        const rawName = dispMatch ? dispMatch[1].replace(/\.[^/.]+$/, '') : `${q} loop ${id}`;
        const title = cleanTitle(rawName);

        const r2VideoKey = `videos/loops/loop-${id}.mp4`;
        const r2ThumbKey = `videos/loops/loop-${id}-thumb.jpg`;

        try {
          const r2VideoUrl = await uploadToR2(r2VideoKey, vidRes.buffer, 'video/mp4');
          const r2ThumbUrl = await uploadToR2(r2ThumbKey, thumbRes.buffer, 'image/jpeg');

          const tags = [catConfig.category, q, 'loop', 'background', '60fps', ...catConfig.chips.slice(0, 3)];

          await pool.query(
            `
            INSERT INTO community_background_videos (id, title, category, tags, video_url, thumbnail_url, duration, aspect_ratio, uses_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              category = EXCLUDED.category,
              tags = EXCLUDED.tags,
              video_url = EXCLUDED.video_url,
              thumbnail_url = EXCLUDED.thumbnail_url
          `,
            [`loop-${id}`, title, catConfig.category, tags, r2VideoUrl, r2ThumbUrl, '00:10', '16:9', 10 + Math.floor(Math.random() * 50)]
          );

          catCount++;
          totalIngested++;
          console.log(`   ✨ [${catCount}/${TARGET_PER_CAT}] ${title} (${(vidRes.buffer.length / 1024 / 1024).toFixed(1)}MB, ${quality})`);
        } catch (uploadErr) {
          console.error(`   ⚠️ Failed to upload ${id}:`, uploadErr.message);
        }
      }
    }
  }

  console.log(`\n🎉 Ingestion Complete! Total Premium Game Background Loops: ${totalIngested}`);
  await pool.end();
}

main().catch(console.error);
