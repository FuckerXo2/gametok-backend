import pool from '../src/db.js';
import crypto from 'crypto';

const CREATORS = [
  {
    username: 'apex_drift',
    displayName: 'Apex Racing Studio',
    email: 'apex@gametok.ai',
    bio: 'High-speed arcade racers, F1 & drift simulation 🏎️💨',
    avatar: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'voxelmaster',
    displayName: 'Voxel Labs',
    email: 'voxel@gametok.ai',
    bio: 'Crafting procedural voxel worlds & sandbox engines ⛏️🧱',
    avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'midnight_spook',
    displayName: 'Midnight Spook',
    email: 'spook@gametok.ai',
    bio: 'Turn off your lights. Atmospheric 3D horror & escapes 👁️🩸',
    avatar: 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'leonida_dev',
    displayName: 'Leonida Studios',
    email: 'leonida@gametok.ai',
    bio: 'Open-world vice city sandboxes & tactical 3D arenas 🌆🔫',
    avatar: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'fable_studios',
    displayName: 'Fable Anime & RPG',
    email: 'fable@gametok.ai',
    bio: 'Heroic anime adventures, 3D combat & cyberpunk worlds ⚔️✨',
    avatar: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'pixel_legend',
    displayName: 'Pixel Legends',
    email: 'pixel@gametok.ai',
    bio: 'Retro platformer clones, endless runners & surfing vibes 🍄🌊',
    avatar: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200&h=200&fit=crop',
    verified: true,
  },
  {
    username: 'shred_rider',
    displayName: 'Shred Extreme Studios',
    email: 'shred@gametok.ai',
    bio: 'Downhill mountain biking, BMX freestyle & extreme sports gravity engines 🚵‍♂️🏔️',
    avatar: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=200&h=200&fit=crop',
    verified: true,
  }
];

export async function createCreators() {
  console.log('👥 Ensuring Thematic Creator Accounts exist on Supabase...');
  const creatorMap = {};

  for (const c of CREATORS) {
    try {
      const existing = await pool.query('SELECT id, username FROM users WHERE username = $1', [c.username]);
      if (existing.rows.length > 0) {
        creatorMap[c.username] = existing.rows[0].id;
        console.log(`  ✓ Creator exists: @${c.username} (${existing.rows[0].id})`);
      } else {
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO users (id, username, display_name, email, bio, avatar, verified, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [id, c.username, c.displayName, c.email, c.bio, c.avatar, c.verified]
        );
        creatorMap[c.username] = id;
        console.log(`  + Created new creator: @${c.username} (${id})`);
      }
    } catch (err) {
      console.error(`  ✗ Error with creator @${c.username}:`, err.message);
    }
  }

  return creatorMap;
}

if (process.argv[1]?.endsWith('create-thematic-creators.mjs')) {
  createCreators().then(() => pool.end());
}
