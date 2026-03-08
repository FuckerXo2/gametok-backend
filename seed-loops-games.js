/**
 * Seed Loops HTML5 Games to Database
 * 
 * This script extracts the 36 HTML5 games from Loops and adds them to the database
 */

import fs from 'fs';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Game IDs from Loops (extracted from GameTok_decompiled/assets/game/)
const loopsGameIds = [
  206, 319, 413, 416, 417, 423, 425, 432, 439, 441,
  466, 467, 468, 469, 471, 578, 633, 690, 691, 694,
  720, 729, 755, 760, 762, 778, 799, 817, 822, 836,
  840, 844, 857, 862, 936, 958
];

// Game names (you'll need to update these with actual names from Loops)
const gameNames = {
  206: 'Stack Ball',
  319: 'Color Road',
  413: 'Helix Jump',
  416: 'Knife Hit',
  417: 'Fire Balls 3D',
  423: 'Twist',
  425: 'Rise Up',
  432: 'Jelly Shift',
  439: 'Perfect Slices',
  441: 'Rolly Vortex',
  466: 'Aquapark.io',
  467: 'Fun Race 3D',
  468: 'Crowd City',
  469: 'Hole.io',
  471: 'Paper.io 2',
  578: 'Spiral Roll',
  633: 'Roof Rails',
  690: 'Shortcut Run',
  691: 'Bridge Race',
  694: 'Join Clash',
  720: 'Tall Man Run',
  729: 'Count Masters',
  755: 'Blob Runner 3D',
  760: 'Muscle Race 3D',
  762: 'Twerk Race 3D',
  778: 'Money Rush',
  799: 'Makeup Run',
  817: 'High Heels',
  822: 'Shoe Race',
  836: 'Body Race',
  840: 'Balloon Pop',
  844: 'Crowd Evolution',
  857: 'Parkour Race',
  862: 'Roof Rails Online',
  936: 'Draw Climber',
  958: 'Flip Dunk'
};

// Categories for games
const categories = {
  206: 'Arcade',
  319: 'Racing',
  413: 'Arcade',
  416: 'Arcade',
  417: 'Arcade',
  423: 'Puzzle',
  425: 'Arcade',
  432: 'Puzzle',
  439: 'Arcade',
  441: 'Arcade',
  466: 'Racing',
  467: 'Racing',
  468: 'Multiplayer',
  469: 'Multiplayer',
  471: 'Multiplayer',
  578: 'Arcade',
  633: 'Racing',
  690: 'Racing',
  691: 'Racing',
  694: 'Action',
  720: 'Racing',
  729: 'Action',
  755: 'Racing',
  760: 'Racing',
  762: 'Racing',
  778: 'Arcade',
  799: 'Racing',
  817: 'Racing',
  822: 'Racing',
  836: 'Racing',
  840: 'Arcade',
  844: 'Action',
  857: 'Racing',
  862: 'Racing',
  936: 'Puzzle',
  958: 'Sports'
};

async function seedLoopsGames() {
  const client = await pool.connect();

  try {
    console.log('Starting Loops games seeding...');

    let added = 0;
    let skipped = 0;

    for (const gameId of loopsGameIds) {
      const gameName = gameNames[gameId] || `Game ${gameId}`;
      const category = categories[gameId] || 'Arcade';

      // Check if game already exists
      const existing = await client.query(
        'SELECT id FROM games WHERE id = $1',
        [`loops_${gameId}`]
      );

      if (existing.rows.length > 0) {
        console.log(`⏭️  Skipping ${gameName} (already exists)`);
        skipped++;
        continue;
      }

      // Insert game
      await client.query(`
        INSERT INTO games (
          id, name, description, category, thumbnail, embed_url, 
          plays, like_count, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        `loops_${gameId}`,
        gameName,
        `Play ${gameName} - Fun HTML5 game from Loops`,
        category,
        `/loops-games/${gameId}/thumbnail.png`,
        `/loops-games/${gameId}/index.html`,
        Math.floor(Math.random() * 10000), // Random plays
        Math.floor(Math.random() * 1000), // Random likes
      ]);

      console.log(`✅ Added ${gameName}`);
      added++;
    }

    console.log(`\n✨ Seeding complete!`);
    console.log(`   Added: ${added} games`);
    console.log(`   Skipped: ${skipped} games`);
    console.log(`   Total Loops games: ${loopsGameIds.length}`);

  } catch (error) {
    console.error('Error seeding games:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the seeder
seedLoopsGames().catch(console.error);
