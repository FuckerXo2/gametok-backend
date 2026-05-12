// Fix template games by downloading from R2 and storing HTML in database
import fetch from 'node-fetch';
import pool from './src/db.js';

const TEMPLATE_GAMES = [
  'The Dentist',
  'Pokemon Fusion', 
  'Guess the Song',
  'Slice the Pizza',
  'oioioiii',
  'Put the Money in the Bag',
  'A Mysterious Note',
  'Toybox Tales'
];

async function fixTemplateGames() {
  console.log('🔧 Fixing template games...\n');
  
  // Find games with embed_url that match template names
  const result = await pool.query(
    `SELECT id, title, embed_url 
     FROM games 
     WHERE embed_url IS NOT NULL 
     AND embed_url != ''
     AND (title = ANY($1) OR title ILIKE '%hardest%')`,
    [TEMPLATE_GAMES]
  );
  
  console.log(`Found ${result.rows.length} template games to fix:\n`);
  
  for (const game of result.rows) {
    console.log(`📥 Downloading: ${game.title}`);
    console.log(`   URL: ${game.embed_url}`);
    
    try {
      // Download the HTML from R2
      const response = await fetch(game.embed_url);
      
      if (!response.ok) {
        console.log(`   ❌ Failed to download (${response.status})`);
        continue;
      }
      
      const html = await response.text();
      console.log(`   ✅ Downloaded ${html.length} bytes`);
      
      // Store in database and clear embed_url
      await pool.query(
        `UPDATE games 
         SET html_payload = $1, embed_url = NULL 
         WHERE id = $2`,
        [html, game.id]
      );
      
      console.log(`   ✅ Saved to database\n`);
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('✅ Done!');
  await pool.end();
}

fixTemplateGames().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
