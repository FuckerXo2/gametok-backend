import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function inspectDraft() {
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
    
    // Find all catch statements and their context
    const lines = html.split('\n');
    console.log('\n🔍 Looking for catch statements:\n');
    
    lines.forEach((line, idx) => {
      if (line.includes('catch')) {
        const start = Math.max(0, idx - 3);
        const end = Math.min(lines.length, idx + 3);
        
        console.log(`\n--- Line ${idx + 1} ---`);
        for (let i = start; i <= end; i++) {
          const marker = i === idx ? '>>> ' : '    ';
          console.log(`${marker}${i + 1}: ${lines[i]}`);
        }
      }
    });

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

inspectDraft();
