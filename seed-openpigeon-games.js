// Seed OpenPigeon multiplayer games to database
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

const WORKER_URL = 'https://openpigeon-cors.abiolaolasubomi2007.workers.dev';
const R2_URL = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';

// Web-native games (our own ports using OpenPigeon assets) - show in Connect screen
const webNativeGames = [
  { id: 'dots_web', name: 'Dots & Boxes', description: 'Connect dots to make boxes! Beat the CPU.', embedUrl: R2_URL + '/openpigeon-dots/index.html', category: 'puzzle', color: '#7209B7' },
  { id: 'basketball_web', name: 'Basketball', description: 'Shoot hoops and score points!', embedUrl: R2_URL + '/openpigeon-basketball/index.html', category: 'sports', color: '#FF6B35' },
];

// OpenPigeon Godot games (multiplayer)
const openpigeonGames = [
  { id: 'openpigeon_darts', name: 'Darts MP', gameKey: 'darts', category: 'sports', color: '#E63946' },
  { id: 'openpigeon_cuppong', name: 'Cup Pong', gameKey: 'beer', category: 'sports', color: '#F4A261' },
  { id: 'openpigeon_archery', name: 'Archery', gameKey: 'archery', category: 'sports', color: '#2A9D8F' },
  { id: 'openpigeon_seabattle', name: 'Sea Battle', gameKey: 'battleship', category: 'strategy', color: '#264653' },
  { id: 'openpigeon_filler', name: 'Filler', gameKey: 'fill', category: 'puzzle', color: '#3A0CA3' },
  { id: 'openpigeon_anagrams', name: 'Anagrams', gameKey: 'anagrams', category: 'word', color: '#4361EE' },
  { id: 'openpigeon_wordbites', name: 'Word Bites', gameKey: 'bites', category: 'word', color: '#4CC9F0' },
  { id: 'openpigeon_questions', name: '20 Questions', gameKey: 'questions', category: 'trivia', color: '#F72585' },
];

async function seedGames() {
  const client = await pool.connect();
  try {
    console.log('Seeding games...\n');
    
    // Web native games - set multiplayer_only = TRUE so they show in Connect screen
    console.log('--- Web Native Games ---');
    for (const game of webNativeGames) {
      await client.query(
        'INSERT INTO games (id, name, description, thumbnail, embed_url, category, plays, like_count, multiplayer_only, color, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, NOW()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, embed_url = EXCLUDED.embed_url, category = EXCLUDED.category, multiplayer_only = TRUE, color = EXCLUDED.color',
        [game.id, game.name, game.description, null, game.embedUrl, game.category, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 500), game.color]
      );
      console.log('OK', game.name, '->', game.embedUrl);
    }
    
    console.log('\n--- OpenPigeon Godot Games ---');
    for (const game of openpigeonGames) {
      const embedUrl = WORKER_URL + '/index.html?game=' + game.gameKey;
      await client.query(
        'INSERT INTO games (id, name, description, thumbnail, embed_url, category, plays, like_count, multiplayer_only, color, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, NOW()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, embed_url = EXCLUDED.embed_url, category = EXCLUDED.category, multiplayer_only = TRUE, color = EXCLUDED.color',
        [game.id, game.name, game.name + ' game', null, embedUrl, game.category, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 500), game.color]
      );
      console.log('OK', game.name, '->', embedUrl);
    }
    
    console.log('\nDone!');
  } finally {
    client.release();
    await pool.end();
  }
}

seedGames().catch(console.error);
