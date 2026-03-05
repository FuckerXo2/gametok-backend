// Migration: Make username nullable for OAuth users
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Making username column nullable...');
    
    // Drop NOT NULL constraint from username
    await client.query(`
      ALTER TABLE users 
      ALTER COLUMN username DROP NOT NULL;
    `);
    
    console.log('✓ Username column is now nullable');
    console.log('Migration complete!');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
