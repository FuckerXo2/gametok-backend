import 'dotenv/config';
import pg from 'pg';
import { heuristicCategories, setGameCategories, normalizeCategories } from '../src/categories.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Explicit curated category mappings for known catalog games (1-3 categories per game)
const CURATED_MAPPINGS = {
  // 3D Racing & Vehicles
  'turbo-kart-rush': ['racing', 'arcade', 'sports'],
  'apex-formula': ['racing', 'sports'],
  'sunbreak-downhill': ['racing', 'sports', 'adventure'],
  'ox-alpha-bmx': ['sports', 'racing', 'arcade'],
  'neon-drift': ['racing', 'arcade'],
  'hexgl': ['racing', 'action'],
  'tideline': ['adventure', 'sports'],
  'moto-x3m': ['racing', 'sports', 'arcade'],
  'hill-climb': ['racing', 'arcade'],

  // Horror & Mystery
  'bridge-horror-house': ['horror', 'adventure'],
  'backroom-escape': ['horror', 'puzzle', 'adventure'],
  'slender-forest': ['horror', 'adventure'],
  'zombie-blast': ['action', 'horror', 'arcade'],
  'haunted-hospital': ['horror', 'adventure', 'puzzle'],

  // Classic Arcade & Skill
  'pong': ['arcade', 'sports'],
  'flappy-bird': ['arcade', 'action'],
  'doodle-jump': ['arcade', 'action'],
  'towerblocks': ['arcade', 'puzzle'],
  'breakout': ['arcade', 'puzzle'],
  'snake': ['arcade', 'puzzle'],
  'pacman': ['arcade', 'action'],
  'space-invaders': ['arcade', 'action'],
  'asteroids': ['arcade', 'action'],
  'crossy-road': ['arcade', 'action'],
  'subway-surf': ['arcade', 'action'],
  'temple-run': ['arcade', 'action', 'adventure'],
  'rhythm-jump': ['arcade', 'action'],

  // Puzzles & Brain
  '2048': ['puzzle', 'arcade'],
  'sudoku': ['puzzle'],
  'tetris': ['puzzle', 'arcade'],
  'memory-match': ['puzzle'],
  'color-match': ['puzzle', 'arcade'],
  'wordle': ['puzzle'],
  'infinite-alchemy': ['puzzle', 'adventure'],
  'cut-the-rope': ['puzzle', 'arcade'],
  'candy-match': ['puzzle', 'arcade'],

  // Action, Combat & Shooters
  'ammo-blitz': ['action', 'arcade'],
  'cyber-slash': ['action', 'adventure'],
  'ninja-runner': ['action', 'arcade'],
  'space-shooter': ['action', 'arcade'],
  'galaxy-guardian': ['action', 'arcade'],
  'street-brawler': ['action', 'arcade'],
  'pixel-warrior': ['action', 'adventure', 'rpg'],

  // Sports & Competitive
  'penalty-shootout': ['sports', 'arcade'],
  'basketball-dunk': ['sports', 'arcade'],
  'tennis-clash': ['sports', 'arcade'],
  'bowling-strike': ['sports', 'arcade'],

  // Adventure & RPG
  'dungeon-quest': ['rpg', 'adventure', 'action'],
  'realm-explorer': ['adventure', 'rpg'],
  'hollowmere': ['adventure', 'action', 'rpg'],
  'fantasy-quest': ['rpg', 'adventure'],
};

async function main() {
  console.log('Fetching all games from games table...');
  const { rows: games } = await pool.query(`
    SELECT id, name, description
    FROM games
    ORDER BY id
  `);

  console.log(`Found ${games.length} games in catalog.`);

  let updatedCount = 0;
  for (const game of games) {
    let categories = CURATED_MAPPINGS[game.id];

    if (!categories) {
      // Check partial matches on ID
      for (const [key, cats] of Object.entries(CURATED_MAPPINGS)) {
        if (game.id.includes(key) || key.includes(game.id)) {
          categories = cats;
          break;
        }
      }
    }

    if (!categories || categories.length === 0) {
      // Run heuristic keyword classification from title and description
      const text = `${game.name} ${game.description || ''}`;
      const heuristics = heuristicCategories(text);
      if (heuristics && heuristics.length > 0) {
        categories = heuristics;
      }
    }

    // Default fallback based on common patterns so every game has 1-2 categories
    if (!categories || categories.length === 0) {
      const lower = (game.name + ' ' + (game.description || '')).toLowerCase();
      if (lower.includes('race') || lower.includes('car') || lower.includes('drift') || lower.includes('kart') || lower.includes('speed') || lower.includes('drive')) {
        categories = ['racing', 'sports'];
      } else if (lower.includes('jump') || lower.includes('run') || lower.includes('block') || lower.includes('tap') || lower.includes('ball')) {
        categories = ['arcade', 'action'];
      } else if (lower.includes('horror') || lower.includes('dark') || lower.includes('scary') || lower.includes('escape') || lower.includes('night')) {
        categories = ['horror', 'adventure'];
      } else if (lower.includes('match') || lower.includes('puzzle') || lower.includes('merge') || lower.includes('card')) {
        categories = ['puzzle', 'arcade'];
      } else if (lower.includes('shoot') || lower.includes('blast') || lower.includes('strike') || lower.includes('fight')) {
        categories = ['action', 'arcade'];
      } else {
        categories = ['arcade', 'action'];
      }
    }

    const assigned = await setGameCategories(pool, game.id, categories, 'curated_catalog');
    console.log(`[${game.id}] "${game.name}" -> ${assigned.join(', ')}`);
    updatedCount++;
  }

  console.log(`\n Successfully assigned categories for all ${updatedCount} games!`);

  // Print summary by category
  const stats = await pool.query(`
    SELECT gc.category, COUNT(*) as game_count
    FROM game_categories gc
    GROUP BY gc.category
    ORDER BY game_count DESC
  `);
  console.log('\nCategory breakdown in database:');
  for (const row of stats.rows) {
    console.log(`  - ${row.category}: ${row.game_count} games`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error assigning categories:', err);
  process.exit(1);
});
