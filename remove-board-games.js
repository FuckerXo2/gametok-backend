import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function remove() {
  const client = await pool.connect();
  try {
    // Remove board games: Chess, Checkers, Connect 4, Reversi, Gomoku, Mancala
    const boardGames = [
      'openpigeon_chess',
      'openpigeon_checkers', 
      'openpigeon_connect4',
      'openpigeon_reversi',
      'openpigeon_gomoku',
      'openpigeon_mancala'
    ];
    
    const result = await client.query(
      `DELETE FROM games WHERE id = ANY($1)`,
      [boardGames]
    );
    console.log('Removed ' + result.rowCount + ' board games');
    
    const remaining = await client.query(`SELECT name FROM games WHERE multiplayer_only = true ORDER BY name`);
    console.log('\nRemaining 10 games:');
    remaining.rows.forEach(r => console.log('  - ' + r.name));
  } finally {
    client.release();
    await pool.end();
  }
}
remove();
