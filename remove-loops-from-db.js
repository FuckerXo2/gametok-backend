/**
 * Remove all Loops games from database
 * Run this once to clean up legacy Loops games
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function removeLoopsGames() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Removing Loops games from database...');

    // Get count before deletion
    const beforeCount = await client.query(
      "SELECT COUNT(*) FROM games WHERE id LIKE 'loops_%'"
    );
    console.log(`   Found ${beforeCount.rows[0].count} Loops games`);

    // Delete all games with loops_ prefix
    const result = await client.query(
      "DELETE FROM games WHERE id LIKE 'loops_%'"
    );

    console.log(`✅ Removed ${result.rowCount} Loops games from database`);

    // Verify deletion
    const afterCount = await client.query(
      "SELECT COUNT(*) FROM games WHERE id LIKE 'loops_%'"
    );
    console.log(`   Remaining Loops games: ${afterCount.rows[0].count}`);

    if (afterCount.rows[0].count === '0') {
      console.log('✨ All Loops games successfully removed!');
    }

  } catch (error) {
    console.error('❌ Error removing Loops games:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the cleanup
removeLoopsGames().catch(console.error);
