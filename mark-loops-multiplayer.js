/**
 * Mark existing Loops games as multiplayer-only
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function markLoopsMultiplayer() {
  const client = await pool.connect();

  try {
    console.log('Marking Loops games as multiplayer-only...');

    // Update all games with IDs starting with 'loops_'
    const result = await client.query(`
      UPDATE games 
      SET multiplayer_only = TRUE 
      WHERE id LIKE 'loops_%'
      RETURNING id, name
    `);

    console.log(`✅ Updated ${result.rows.length} Loops games:`);
    result.rows.forEach(game => {
      console.log(`   - ${game.name} (${game.id})`);
    });

  } catch (error) {
    console.error('Error marking games:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

markLoopsMultiplayer().catch(console.error);
