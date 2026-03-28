import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function showSnippet() {
  try {
    const draftId = process.argv[2] || 'dd4750ad-0244-4e15-b3e8-2866cb170ea2';
    
    const result = await pool.query(
      'SELECT html_payload FROM ai_games WHERE id = $1',
      [draftId]
    );

    if (result.rows.length === 0) {
      console.log('Draft not found');
      await pool.end();
      return;
    }

    const html = result.rows[0].html_payload;
    const lines = html.split('\n');
    
    // Show lines 130-160 where the error is
    console.log('\n--- Lines 130-160 ---\n');
    for (let i = 129; i < 160 && i < lines.length; i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

showSnippet();
