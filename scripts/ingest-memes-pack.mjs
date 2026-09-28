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

// Iconic Internet Memes Suite matching Sekai's Memes tab
const MEMES_DATA = [
  {
    id: 'asset-meme-awesome-face',
    title: 'Awesome Face',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'style:cartoon', 'style:flat_vector', 'smile', 'awesome_face'],
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Awesome_Face.png',
  },
  {
    id: 'asset-meme-trollface',
    title: 'Trollface Classic',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'style:cartoon', 'trollface', 'horror', 'classic'],
    url: 'https://upload.wikimedia.org/wikipedia/en/9/9a/Trollface_non-free.png',
  },
  {
    id: 'asset-meme-doge',
    title: 'Doge Shiba Inu',
    category: 'memes',
    style: 'style:realistic',
    tags: ['meme', 'sticker', 'animal', 'character', 'style:realistic', 'doge', 'shiba'],
    url: 'https://upload.wikimedia.org/wikipedia/en/5/5f/Original_Doge_meme.jpg',
  },
  {
    id: 'asset-meme-pop-cat',
    title: 'Pop Cat (El Gato)',
    category: 'memes',
    style: 'style:realistic',
    tags: ['meme', 'sticker', 'animal', 'cat', 'character', 'style:realistic', 'el_gato', 'popcat'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f63a.png', // Fallback or direct
  },
  {
    id: 'asset-meme-pepe-frog',
    title: 'Pepe Feels Good',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'style:cartoon', 'style:flat_vector', 'pepe', 'frog'],
    url: 'https://upload.wikimedia.org/wikipedia/en/0/05/Pepe_the_Frog.jpg',
  },
  {
    id: 'asset-meme-this-is-fine',
    title: 'This Is Fine Dog',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'animal', 'character', 'style:cartoon', 'fire', 'dog'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f436.png',
  },
  {
    id: 'asset-meme-stonks',
    title: 'Stonks Guy',
    category: 'memes',
    style: 'style:3d_render',
    tags: ['meme', 'sticker', 'character', 'style:3d_render', 'stonks', 'arrow'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f4c8.png',
  },
  {
    id: 'asset-meme-smiling-imp',
    title: 'Smug Devil Smile',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'style:cartoon', 'horror', 'imp'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f608.png',
  },
  {
    id: 'asset-meme-clown-face',
    title: 'Clown Face Meme',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'style:cartoon', 'clown'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f921.png',
  },
  {
    id: 'asset-meme-skull-cursed',
    title: 'Cursed Skull',
    category: 'memes',
    style: 'style:realistic',
    tags: ['meme', 'sticker', 'horror', 'style:realistic', 'skull', 'dead'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f480.png',
  },
  {
    id: 'asset-meme-alien-invader',
    title: '8-Bit Alien Invader',
    category: 'memes',
    style: 'style:flat_vector',
    tags: ['meme', 'sticker', 'style:flat_vector', 'arcade', 'retro'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f47e.png',
  },
  {
    id: 'asset-meme-ghost-spooky',
    title: 'Spooky Boo Ghost',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'character', 'horror', 'style:cartoon', 'ghost'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f47b.png',
  },
  {
    id: 'asset-meme-fire-hot',
    title: 'Lit Fire Meme',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'fire', 'hot', 'style:cartoon'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f525.png',
  },
  {
    id: 'asset-meme-hundred-score',
    title: '100 Percent Lit',
    category: 'memes',
    style: 'style:flat_vector',
    tags: ['meme', 'sticker', 'style:flat_vector', 'score', '100'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f4af.png',
  },
  {
    id: 'asset-meme-eyes-stare',
    title: 'Suspicious Side Eyes',
    category: 'memes',
    style: 'style:cartoon',
    tags: ['meme', 'sticker', 'style:cartoon', 'eyes', 'sus'],
    url: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f440.png',
  }
];

async function main() {
  console.log('🐸 Ingesting Meme Collection to Cloudflare R2 and PostgreSQL...');
  const client = await pool.connect();
  try {
    let uploaded = 0;
    for (const item of MEMES_DATA) {
      try {
        console.log(`Downloading ${item.title}...`);
        const buf = await downloadBuffer(item.url);
        const ext = item.url.endsWith('.jpg') ? '.jpg' : '.png';
        const contentType = ext === '.jpg' ? 'image/jpeg' : 'image/png';
        const r2Key = `community-assets/memes/${item.id}${ext}`;
        const r2Url = await uploadToR2(r2Key, buf, contentType);

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
        `, [item.id, item.title, item.category, item.style, item.tags, r2Url, Math.floor(Math.random() * 6000) + 1800]);

        console.log(`✅ Ingested Meme: ${item.title} -> ${r2Url}`);
        uploaded++;
      } catch (err) {
        console.error(`❌ Failed ${item.title}:`, err.message);
      }
    }

    // Also add Meme pack to community_asset_packs
    const coverUrl = `${PUBLIC_R2_URL}/community-assets/memes/asset-meme-awesome-face.png`;
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
    `, ['pack-memes-vault', 'Internet Memes & Stickers', 'memes', 'Iconic internet reaction memes, awesome faces, cursed stickers, and pop culture emojis.', coverUrl, uploaded, 'meme', 'asset-meme-']);

    console.log(`\n🎉 Ingested ${uploaded} Memes to Cloudflare R2!`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
