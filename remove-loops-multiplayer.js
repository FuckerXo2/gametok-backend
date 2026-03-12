import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function remove() {
  const client = await pool.connect();
  try {
    const result = await client.query(`UPDATE games SET multiplayer_only = false WHERE id LIKE 'loops_%'`);
    console.log('Removed ' + result.rowCount + ' Loops games from multiplayer');
    
    const check = await client.query(`SELECT id, name FROM games WHERE multiplayer_only = true`);
    console.log('\nRemaining multiplayer games:');
    check.rows.forEach(r => console.log('  - ' + r.name));
  } finally {
    client.release();
    await pool.end();
  }
}
remove();
