import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log('1. Ensuring studio creators exist in users table...');

  const creators = [
    {
      username: 'anshu_space',
      display_name: 'Pale Seeker Labs',
      avatar: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&h=200&fit=crop',
      bio: 'Deep space exploration & procedural cosmos systems.',
      verified: true,
    },
    {
      username: 'bkcore_labs',
      display_name: 'BKcore Anti-Grav',
      avatar: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&h=200&fit=crop',
      bio: 'Next-gen anti-gravity racing technology.',
      verified: true,
    },
    {
      username: 'tideline_waters',
      display_name: 'Tideline Nautical',
      avatar: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&h=200&fit=crop',
      bio: '3D nautical simulators and alpine waters.',
      verified: true,
    },
  ];

  for (const c of creators) {
    const check = await client.query('SELECT id FROM users WHERE username = $1', [c.username]);
    if (check.rows.length === 0) {
      await client.query(
        `INSERT INTO users (username, display_name, avatar, bio, verified)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.username, c.display_name, c.avatar, c.bio, c.verified]
      );
      console.log('Created creator @' + c.username);
    } else {
      console.log('Found existing creator @' + c.username);
    }
  }

  // Map usernames to user IDs
  const userMap = {};
  const uRes = await client.query('SELECT id, username FROM users');
  uRes.rows.forEach((r) => {
    userMap[r.username] = r.id;
  });

  console.log('2. Updating games with creators, likes, and thousands of plays...');
  const updates = [
    {
      id: 'leonida',
      developer: userMap['leonida_dev'],
      plays: 48320,
      like_count: 3640,
      save_count: 1280,
    },
    {
      id: 'apex-formula',
      developer: userMap['apex_drift'],
      plays: 52890,
      like_count: 4190,
      save_count: 1650,
    },
    {
      id: 'neon-drift',
      developer: userMap['fable_studios'],
      plays: 39540,
      like_count: 3120,
      save_count: 1120,
    },

    {
      id: 'hexgl',
      developer: userMap['bkcore_labs'],
      plays: 34180,
      like_count: 2750,
      save_count: 940,
    },
    {
      id: 'tideline',
      developer: userMap['tideline_waters'],
      plays: 18740,
      like_count: 1420,
      save_count: 560,
    },
    {
      id: 'sunbreak-downhill',
      developer: userMap['voxelmaster'],
      plays: 31460,
      like_count: 2480,
      save_count: 980,
    },
    {
      id: 'turbo-kart-rush',
      developer: userMap['physics_lab'] || 'c1000000-0000-0000-0000-000000000012',
      plays: 44670,
      like_count: 3510,
      save_count: 1420,
    },
    {
      id: 'bridge-horror-house',
      developer: userMap['midnight_spook'],
      plays: 36890,
      like_count: 2940,
      save_count: 1180,
    },
    {
      id: 'ox-alpha-bmx',
      developer: userMap['shred_rider'],
      plays: 41250,
      like_count: 3460,
      save_count: 1320,
    },
    {
      id: 'world-creator',
      developer: userMap['fable_studios'],
      plays: 46710,
      like_count: 3890,
      save_count: 1540,
    },
    {
      id: 'backroom-escape',
      developer: userMap['midnight_spook'],
      plays: 58420,
      like_count: 4780,
      save_count: 1920,
    },
  ];

  for (const u of updates) {
    await client.query(
      `UPDATE games 
       SET developer = $1, plays = $2, like_count = $3, save_count = $4
       WHERE id = $5`,
      [u.developer, u.plays, u.like_count, u.save_count, u.id]
    );
    console.log(`Updated ${u.id}: developer=${u.developer}, plays=${u.plays}, likes=${u.like_count}`);
  }

  // Verify
  const finalRes = await client.query(`
    SELECT g.id, g.name, g.plays, g.like_count, g.save_count, u.username, u.display_name, u.verified
    FROM games g
    LEFT JOIN users u ON u.id::text = g.developer
    ORDER BY g.plays DESC;
  `);
  console.log('\n=== FINAL CATALOG WITH METRICS ===');
  console.table(finalRes.rows);

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
