import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const result = await pool.query(
      `SELECT id, name, script_payload 
       FROM games 
       WHERE name LIKE $1 OR name LIKE $2
       ORDER BY created_at DESC 
       LIMIT 3`,
      ['%Jelly%', '%Sweet%']
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No matching game found');
      return;
    }
    
    for (const game of result.rows) {
      console.log('Game ID:', game.id);
      console.log('Name:', game.name);
      console.log('\n--- Checking CSS ---');
      
      const html = game.script_payload;
      
      // Extract #game-container CSS
      const containerMatch = html.match(/#game-container\s*\{[^\}]+\}/s);
      if (containerMatch) {
        console.log('\n#game-container:');
        console.log(containerMatch[0]);
      }
      
      // Extract canvas sizing
      const canvasMatch = html.match(/canvas\s*\{[^\}]+\}/s);
      if (canvasMatch) {
        console.log('\ncanvas:');
        console.log(canvasMatch[0]);
      }
      
      // Extract body/html sizing
      const bodyMatch = html.match(/body\s*\{[^\}]+\}/s);
      if (bodyMatch) {
        console.log('\nbody:');
        console.log(bodyMatch[0]);
      }
      
      console.log('\n=====================================\n');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
