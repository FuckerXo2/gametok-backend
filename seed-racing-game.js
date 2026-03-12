/**
 * Seed Racing Game to Database
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function seedRacingGame() {
  const client = await pool.connect();

  try {
    console.log('Adding Racing Game...');

    // Check if game already exists
    const existing = await client.query(
      'SELECT id FROM games WHERE id = $1',
      ['racing_game_3d']
    );

    if (existing.rows.length > 0) {
      console.log('⏭️  Racing Game already exists, updating...');
      await client.query(`
        UPDATE games SET
          name = $2,
          description = $3,
          category = $4,
          thumbnail = $5,
          embed_url = $6,
          multiplayer_only = $7,
          color = $8
        WHERE id = $1
      `, [
        'racing_game_3d',
        '3D Racing',
        'Open source 3D racing game with realistic physics. Race around the track and beat your best time!',
        'Racing',
        'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/racing-game/images/gold.png',
        'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/racing-game/index.html',
        true,
        '#FF6B35'
      ]);
      console.log('✅ Updated Racing Game');
    } else {
      await client.query(`
        INSERT INTO games (
          id, name, description, category, thumbnail, embed_url, 
          plays, like_count, multiplayer_only, color, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `, [
        'racing_game_3d',
        '3D Racing',
        'Open source 3D racing game with realistic physics. Race around the track and beat your best time!',
        'Racing',
        'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/racing-game/images/gold.png',
        'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/racing-game/index.html',
        0,
        0,
        true,
        '#FF6B35'
      ]);
      console.log('✅ Added Racing Game');
    }

    console.log('\n🏎️  Racing Game is now available!');
    console.log('   URL: https://pub-b7694276c8f54290854b276638a93b62.r2.dev/racing-game/index.html');

  } catch (error) {
    console.error('Error seeding game:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedRacingGame().catch(console.error);
