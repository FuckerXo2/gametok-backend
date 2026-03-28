// Seed OpenPigeon multiplayer games to database
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

// URLs
const WORKER_URL = 'https://openpigeon-cors.abiolaolasubomi2007.workers.dev';
const R2_URL = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';

// Web-native games (our own ports using OpenPigeon assets)
const webNativeGames = [
  { id: 'dots_web', name: 'Dots & Boxes', description: 'Connect dots to make boxes! Beat the CPU.', embedUrl: R2_URL + '/openpigeon-dots/index.html', category: 'puzzle', color: '#7209B7', multiplayer: false },
  { id: 'basketball_web', name: 'Basketball', description: 'Shoot hoops and score points!', embedUrl: R2_URL + '/openpigeon-basketball/index.html', category: 'sports', color: '#FF6B35', multiplayer: false },
];

// OpenPigeon Godot games (multiplayer)
const openpigeonGames = [
  { id: 'openpigeon_darts', name: 'Darts MP', description: 'Aim and throw darts at the board!', gameKey: 'darts', category: 'sports', color: '#E63946' },
  { id: 'openpigeon_cuppong', name: 'Cup Pong', description: 'Throw the ball into cups!', gameKey: 'beer', category: 'sports', color: '#F4A261' },
  { id: 'openpigeon_archery', name: 'Archery', description: 'Draw your bow and hit the target!', gameKey: 'archery', category: 'sports', color: '#2A9D8F' },
  { id: 'openpigeon_seabattle', name: 'Sea Battle', description: 'Classic battleship - sink the enemy fleet!', gameKey: 'battleship', category: 'strategy', color: '#264653' },
  { id: 'openpigeon_filler', name: 'Filler', description: 'Expand territory by changing colors!', gameKey: 'fill', category: 'puzzle', color: '#3A0CA3' },
  { id: 'openpigeon_anagrams', name: 'Anagrams', description: 'Unscramble letters to form words!', gameKey: 'anagrams', category: 'word', color: '#4361EE' },
  { id: 'openpigeon_wordbites', name: 'Word Bites', description: 'Find words in the letter grid!', gameKey: 'bites', category: 'word', color: '#4CC9F0' },
  { id: 'openpigeon_questions', name: '20 Questions', description: 'Guess in 20 questions or less!', gameKey: 'questions', category: 'trivia', color: '#F72585' },
];

async function seedGames() {
  const client = await pool.connect();
  try {
    console.log('Seeding games...\n');
    
    // Seed web-native games first
    console.log('--- Web Native Games ---');
    for (const game of webNativeGames) {
      await client.query(
        `INSERT INTO games (id, name, description, thumbnail, embed_url, category, plays, like_count, multiplayer_only, color, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, embed_url = EXCLUDED.embed_url, category = EXCLUDED.category, multiplayer_only = EXCLUDED.multiplayer_only, color = EXCLUDED.color`,
        [game.id, game.name, game.description, null, game.embedUrl, game.category, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 500), game.multiplayer, game.color]
      );
      console.log('OK', game.name, '->', game.embedUrl);
    }
    
    // Seed OpenPigeon Godot games
    console.log('\n--- OpenPigeon Godot Games ---');
    for (const game of openpigeonGames) {
      const embedUrl = WORKER_URL + '/index.html?game=' + game.gameKey;
      await client.query(
        `INSERT INTO games (id, name, description, thumbnail, embed_url, category, plays, like_count, multiplayer_only, color, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, embed_url = EXCLUDED.embed_url, category = EXCLUDED.category, multiplayer_only = EXCLUDED.multiplayer_only, color = EXCLUDED.color`,
        [game.id, game.name, game.description, null, embedUrl, game.category, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 500), true, game.color]
      );
      console.log('OK', game.name, '->', embedUrl);
    }
    
    // Remove old games
    const removedGames = ['openpigeon_chess', 'openpigeon_checkers', 'openpigeon_connect4', 'openpigeon_mancala', 'openpigeon_reversi', 'openpigeon_gomoku', 'openpigeon_basketball', 'openpigeon_dots'];
    console.log('\nRemoving old games...');
    for (const gameId of removedGames) {
      const result = await client.query('DELETE FROM games WHERE id = $1', [gameId]);
      if (result.rowCount > 0) console.log('Removed', gameId);
    }
    
    console.log('\nDone! Seeded', webNativeGames.length + openpigeonGames.length, 'games');
  } finally {
    client.release();
    await pool.end();
  }
}

seedGames().catch(console.error);
