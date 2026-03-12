import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function updateUrls() {
  const client = await pool.connect();
  try {
    // Update embed URLs to use the Pages URL (which loads from R2)
    const result = await client.query(`
      UPDATE games 
      SET embed_url = REPLACE(embed_url, '/openpigeon-games/', 'https://gametok-games.pages.dev/openpigeon-games/')
      WHERE id LIKE 'openpigeon_%'
      RETURNING id, name, embed_url
    `);
    
    console.log('Updated URLs for OpenPigeon games:');
    result.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.embed_url}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

updateUrls().catch(console.error);
