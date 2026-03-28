import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function checkDrafts() {
  try {
    const result = await pool.query(`
      SELECT 
        ag.id,
        ag.title,
        ag.prompt,
        ag.created_at,
        u.username,
        LENGTH(ag.html_payload) as html_size
      FROM ai_games ag
      JOIN users u ON ag.user_id = u.id
      WHERE ag.is_draft = true
      ORDER BY ag.created_at DESC
    `);

    console.log(`\n📝 Found ${result.rows.length} draft(s):\n`);
    
    if (result.rows.length === 0) {
      console.log('No drafts found in the database.');
    } else {
      result.rows.forEach((draft, i) => {
        console.log(`${i + 1}. "${draft.title || 'Untitled'}"`);
        console.log(`   User: ${draft.username}`);
        console.log(`   Prompt: ${draft.prompt.substring(0, 100)}${draft.prompt.length > 100 ? '...' : ''}`);
        console.log(`   HTML Size: ${(draft.html_size / 1024).toFixed(2)} KB`);
        console.log(`   Created: ${draft.created_at}`);
        console.log(`   ID: ${draft.id}\n`);
      });
    }

    await pool.end();
  } catch (error) {
    console.error('Error checking drafts:', error.message);
    process.exit(1);
  }
}

checkDrafts();
