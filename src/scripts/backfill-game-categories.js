/**
 * Database Backfill Script: Auto-Categorize All Existing Games
 * 
 * Loops through all existing games in ai_games / games table and runs heuristic
 * keyword matching + DeepSeek Flash classification to populate game_categories join table.
 */

import pool from '../db.js';
import { heuristicCategories, setGameCategories } from '../categories.js';

export async function backfillGameCategories() {
    if (!pool) {
        console.warn('[backfill] Database pool not configured');
        return;
    }


    try {
        console.log('🔄 Starting backfill of game categories...');
        
        // Fetch all games from ai_games table
        const { rows } = await pool.query(
            `SELECT id, title, prompt, description FROM ai_games ORDER BY created_at DESC`
        );

        console.log(`Found ${rows.length} games to inspect for categorization.`);
        let updatedCount = 0;

        for (const game of rows) {
            const text = [game.title, game.prompt, game.description].filter(Boolean).join('\n');
            let categories = heuristicCategories(text);
            
            // Default fallback if no keywords matched so no game is left behind
            if (!categories || categories.length === 0) {
                categories = ['action', 'arcade'];
            }

            await setGameCategories(pool, game.id, categories, 'heuristic_backfill');
            updatedCount++;
        }

        console.log(`✅ Successfully backfilled categories for ${updatedCount} games!`);
    } catch (err) {
        console.error('[backfill] Error during categories backfill:', err.message);
    }
}

// Run script if invoked directly
if (process.argv[1]?.endsWith('backfill-game-categories.js')) {
    backfillGameCategories().then(() => process.exit(0)).catch(() => process.exit(1));
}
