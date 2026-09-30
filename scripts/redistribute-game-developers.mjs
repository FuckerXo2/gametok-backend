import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('sslmode=require') || process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('render.com'))) || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Map of game ID -> user UUID (Exactly 12 Studios)
const GAME_DEVELOPER_MAP = {
  // 1. Apex Racing Studio (5 games: 2 landscape, 3 portrait)
  'apex-formula': 'eb536fe0-8e27-47fb-b9b5-7fbb66a4d4a0',
  'hexgl': 'eb536fe0-8e27-47fb-b9b5-7fbb66a4d4a0',
  'car-racing-2d': 'eb536fe0-8e27-47fb-b9b5-7fbb66a4d4a0',
  'fast-driver': 'eb536fe0-8e27-47fb-b9b5-7fbb66a4d4a0',
  'mini-karting': 'eb536fe0-8e27-47fb-b9b5-7fbb66a4d4a0',

  // 2. Shred Extreme Studios (4 games: 3 landscape, 1 portrait)
  'ox-alpha-bmx': '12024d87-6c9b-4d74-9c8f-fe23e1fd9d00',
  'sunbreak-downhill': '12024d87-6c9b-4d74-9c8f-fe23e1fd9d00',
  'tideline': '12024d87-6c9b-4d74-9c8f-fe23e1fd9d00',
  'nutmeg-football': '12024d87-6c9b-4d74-9c8f-fe23e1fd9d00',

  // 3. Midnight Spook (4 games: 2 landscape, 2 portrait)
  'backroom-escape': '14c916f8-b5a7-4d00-8440-25bac34ab0d3',
  'bridge-horror-house': '14c916f8-b5a7-4d00-8440-25bac34ab0d3',
  'teddy-escape': '14c916f8-b5a7-4d00-8440-25bac34ab0d3',
  'barrier-dodge': '14c916f8-b5a7-4d00-8440-25bac34ab0d3',

  // 4. Fable Anime & RPG (4 games: 2 landscape, 2 portrait)
  'world-creator': '36799fbb-92af-41b7-bc13-9b84f63df5a0',
  'neon-drift': '36799fbb-92af-41b7-bc13-9b84f63df5a0',
  'dragon-and-princess': '36799fbb-92af-41b7-bc13-9b84f63df5a0',
  'cat-hero': '36799fbb-92af-41b7-bc13-9b84f63df5a0',

  // 5. Kinetic Games (5 games: 1 landscape, 4 portrait)
  'turbo-kart-rush': 'c1000000-0000-0000-0000-000000000012',
  'idle-miner': 'c1000000-0000-0000-0000-000000000012',
  'gold-miner': 'c1000000-0000-0000-0000-000000000012',
  'fishing-frenzy': 'c1000000-0000-0000-0000-000000000012',
  'tower-building': 'c1000000-0000-0000-0000-000000000012',

  // 6. Pixel Legends (5 games: 5 portrait)
  'jewel-match': '558d11f9-7de5-488a-b7c2-4960b60feeed',
  'cohe-shoo': '558d11f9-7de5-488a-b7c2-4960b60feeed',
  'little-strawberry': '558d11f9-7de5-488a-b7c2-4960b60feeed',
  'animals-crush': '558d11f9-7de5-488a-b7c2-4960b60feeed',
  'star-pop': '558d11f9-7de5-488a-b7c2-4960b60feeed',

  // 7. Vertical Jump Lab (4 games: 4 portrait)
  'doodle-jump': 'c1000000-0000-0000-0000-000000000006',
  'broccoli-jump': 'c1000000-0000-0000-0000-000000000006',
  'koala-leap': 'c1000000-0000-0000-0000-000000000006',
  'flappy-bird': 'c1000000-0000-0000-0000-000000000006',

  // 8. RobTop Creations (5 games: 5 portrait)
  'ninja-clan': 'c1000000-0000-0000-0000-000000000009',
  'treasure-ninja': 'c1000000-0000-0000-0000-000000000009',
  'police-and-thief': 'c1000000-0000-0000-0000-000000000009',
  'fruit-slicer': 'c1000000-0000-0000-0000-000000000009',
  'the-last-battle': 'c1000000-0000-0000-0000-000000000009',

  // 9. Block Matrix Lab (4 games: 4 portrait)
  'classic-tetris': 'c1000000-0000-0000-0000-000000000004',
  'super-tetris': 'c1000000-0000-0000-0000-000000000004',
  'block-blast': 'c1000000-0000-0000-0000-000000000004',
  '2048': 'c1000000-0000-0000-0000-000000000004',

  // 10. Neon Serpent Studio (4 games: 4 portrait)
  'snake-io': 'c1000000-0000-0000-0000-000000000005',
  'greedy-snake': 'c1000000-0000-0000-0000-000000000005',
  'agents-vs-zombies': 'c1000000-0000-0000-0000-000000000005',
  'windmill-spin': 'c1000000-0000-0000-0000-000000000005',

  // 11. Harmonic Keys Studio (5 games: 5 portrait)
  'crazy-supermarket': 'c1000000-0000-0000-0000-000000000007',
  'cut-the-candy': 'c1000000-0000-0000-0000-000000000007',
  'tnt-tap': 'c1000000-0000-0000-0000-000000000007',
  'ricocheting-orange': 'c1000000-0000-0000-0000-000000000007',
  'moto-race': 'c1000000-0000-0000-0000-000000000007',

  // 12. Neuro Reflex Lab (5 games: 5 portrait)
  'mine-clearance': 'c1000000-0000-0000-0000-000000000015',
  'pipe-mania': 'c1000000-0000-0000-0000-000000000015',
  'pac-rush': 'c1000000-0000-0000-0000-000000000015',
  'pong': 'c1000000-0000-0000-0000-000000000015',
  'emoji-pong': 'c1000000-0000-0000-0000-000000000015',
};

async function main() {
  const client = await pool.connect();
  try {
    console.log('🚀 Redistributing game developer assignments...');
    let updated = 0;
    for (const [gameId, devUuid] of Object.entries(GAME_DEVELOPER_MAP)) {
      const res = await client.query(
        'UPDATE games SET developer = $1 WHERE id = $2 RETURNING id, name, developer',
        [devUuid, gameId]
      );
      if (res.rows.length > 0) {
        updated++;
      } else {
        console.warn(`Game not found: ${gameId}`);
      }
    }
    console.log(`✅ Updated ${updated} games.`);

    // Summary of developers after redistribution
    const countRes = await client.query(`
      SELECT u.username, u.display_name, COUNT(g.id) as game_count
      FROM games g
      JOIN users u ON u.id::text = g.developer
      GROUP BY u.username, u.display_name
      ORDER BY game_count DESC, u.display_name ASC
    `);
    console.log('\n📊 Portfolio Breakdown by Developer:');
    for (const row of countRes.rows) {
      console.log(`  ${row.display_name} (@${row.username}): ${row.game_count} games`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
