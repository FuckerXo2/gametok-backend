import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  const client = await pool.connect();
  try {
    const result = await client.query(`UPDATE games SET multiplayer_only = TRUE WHERE id = 'basketball_web'`);
    console.log('Updated ' + result.rowCount + ' row(s)');
    
    const check = await client.query(`SELECT id, name, multiplayer_only FROM games WHERE id = 'basketball_web'`);
    console.log(check.rows[0]);
  } finally {
    client.release();
    pool.end();
  }
}

fix();
