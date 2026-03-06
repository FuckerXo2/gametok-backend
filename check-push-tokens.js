// Check if users have push tokens registered
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkTokens() {
  try {
    const result = await pool.query(
      'SELECT id, username, push_token FROM users ORDER BY created_at DESC LIMIT 10'
    );

    console.log('\n📱 Recent users and their push tokens:\n');
    
    if (result.rows.length === 0) {
      console.log('No users found');
    } else {
      result.rows.forEach((user, i) => {
        console.log(`${i + 1}. ${user.username}`);
        console.log(`   Token: ${user.push_token ? '✅ ' + user.push_token.substring(0, 50) + '...' : '❌ No token'}`);
        console.log('');
      });
    }

    // Check if push_token column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'push_token'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('⚠️  WARNING: push_token column does not exist in users table!');
      console.log('Run this SQL to add it:');
      console.log('ALTER TABLE users ADD COLUMN push_token TEXT;');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTokens();
