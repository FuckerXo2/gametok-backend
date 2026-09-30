import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const JSON_PATH = path.resolve('public/uploads/community-assets.json');

async function main() {
  console.log('🚀 Ingesting 479 Brainrot, Parkour & Viral Meme Videos into PostgreSQL...');

  const rawData = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  const client = await pool.connect();

  try {
    let count = 0;
    for (const v of rawData) {
      if (v.type !== 'video' || !v.url) continue;

      const rawTag = (v.tag || '').toLowerCase();
      let category = 'brainrot';
      if (rawTag.includes('parkour') || rawTag.includes('subway') || rawTag.includes('minecraft') || rawTag.includes('roblox') || rawTag.includes('fortnite')) {
        category = 'parkour';
      } else if (rawTag.includes('meme') || rawTag.includes('compilation') || rawTag.includes('cursed')) {
        category = 'memes';
      }

      const tags = [
        category,
        v.tag || 'brainrot',
        ...(v.title || '').toLowerCase().match(/#([a-z0-9_]+)/g)?.map(t => t.slice(1)) || []
      ];

      const cleanTitle = (v.title || v.label || 'Viral Brainrot Video')
        .replace(/#\w+/g, '')
        .replace(/\s+/g, ' ')
        .trim() || `${v.tag || 'Brainrot'} Video`;

      const thumbUrl = v.thumbnail || v.thumb || v.url;
      const duration = v.duration || '00:15';

      await client.query(`
        INSERT INTO community_background_videos (id, title, category, tags, video_url, thumbnail_url, duration, aspect_ratio, uses_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          tags = EXCLUDED.tags,
          video_url = EXCLUDED.video_url,
          thumbnail_url = EXCLUDED.thumbnail_url,
          duration = EXCLUDED.duration
      `, [
        v.id,
        cleanTitle.slice(0, 120),
        category,
        tags.slice(0, 10),
        v.url,
        thumbUrl,
        duration,
        '9:16',
        100 + Math.floor(Math.random() * 900)
      ]);

      count++;
    }

    console.log(`🎉 Ingested ${count} Brainrot & Parkour Videos into community_background_videos!`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
