import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('sslmode=require') || process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('render.com'))) || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const DICEBEAR_BACKGROUNDS = [
  '1b1b1f',
  '20262f',
  '2c1f38',
  '1e2e27',
  '312419',
  '4a2338',
  '13343b',
  '4d3428',
];

const DICEBEAR_SKIN_TONES = ['f2d3b1', 'eac393', 'd08b5b', '9c5a3c', '6b3d2a'];
const DICEBEAR_HAIR_COLORS = ['2c1b18', '5a3d2b', '8b5e3c', 'd19a66', 'f2d6b3', '8b1e3f', '4c6a92'];
const DICEBEAR_EYE_OPTIONS = Array.from({ length: 26 }, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const DICEBEAR_BROW_OPTIONS = Array.from({ length: 15 }, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const DICEBEAR_MOUTH_OPTIONS = Array.from({ length: 30 }, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const DICEBEAR_HAIR_OPTIONS = [
  ...Array.from({ length: 26 }, (_, i) => `long${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 19 }, (_, i) => `short${String(i + 1).padStart(2, '0')}`),
];
const DICEBEAR_ACCESSORY_OPTIONS = ['blank', 'variant01', 'variant02', 'variant03', 'variant04', 'variant05'];
const DICEBEAR_FEATURE_OPTIONS = ['blank', 'mustache', 'blush', 'birthmark', 'freckles'];
const DICEBEAR_EARRING_OPTIONS = ['blank', 'variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06'];

const hashValue = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const normalizeSeed = (seed) => (seed || 'gametok').trim() || 'gametok';

const pickBackground = (seed) => DICEBEAR_BACKGROUNDS[hashValue(seed) % DICEBEAR_BACKGROUNDS.length];

const pickOption = (seed, options, salt) =>
  options[hashValue(`${seed}:${salt}`) % options.length];

function makeDicebearAvatarUri(seed) {
  const normalizedSeed = normalizeSeed(seed);
  const bg = pickBackground(normalizedSeed);
  const skinColor = pickOption(normalizedSeed, DICEBEAR_SKIN_TONES, 'skin');
  const hairColor = pickOption(normalizedSeed, DICEBEAR_HAIR_COLORS, 'hairColor');
  const eyes = pickOption(normalizedSeed, DICEBEAR_EYE_OPTIONS, 'eyes');
  const eyebrows = pickOption(normalizedSeed, DICEBEAR_BROW_OPTIONS, 'eyebrows');
  const mouth = pickOption(normalizedSeed, DICEBEAR_MOUTH_OPTIONS, 'mouth');
  const hair = pickOption(normalizedSeed, DICEBEAR_HAIR_OPTIONS, 'hair');
  const accessory = pickOption(normalizedSeed, DICEBEAR_ACCESSORY_OPTIONS, 'accessory');
  const feature = pickOption(normalizedSeed, DICEBEAR_FEATURE_OPTIONS, 'feature');
  const earrings = pickOption(normalizedSeed, DICEBEAR_EARRING_OPTIONS, 'earrings');

  const params = new URLSearchParams();
  params.set('bg', bg);
  params.set('skinColor', skinColor);
  params.set('hairColor', hairColor);
  params.set('eyes', eyes);
  params.set('eyebrows', eyebrows);
  params.set('mouth', mouth);
  params.set('hair', hair);
  if (accessory !== 'blank') params.set('accessory', accessory);
  if (feature !== 'blank') params.set('feature', feature);
  if (earrings !== 'blank') params.set('earrings', earrings);

  return `dicebear://${encodeURIComponent(normalizedSeed)}?${params.toString()}`;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('🔍 Finding users with unsplash or missing dicebear avatars...');
    const usersRes = await client.query(`
      SELECT id, username, display_name, avatar 
      FROM users 
      WHERE avatar LIKE '%unsplash%' 
         OR avatar IS NULL 
         OR avatar = ''
    `);

    console.log(`Found ${usersRes.rows.length} users needing avatar restoration.`);

    let updated = 0;
    for (const user of usersRes.rows) {
      const newAvatar = makeDicebearAvatarUri(user.username || user.id);
      await client.query(
        'UPDATE users SET avatar = $1 WHERE id = $2',
        [newAvatar, user.id]
      );
      console.log(`  ✓ Restored @${user.username} (${user.display_name}) -> ${newAvatar.slice(0, 50)}...`);
      updated++;
    }

    console.log(`\n🎉 Successfully restored ${updated} user avatars to GameTok avatar system!`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
