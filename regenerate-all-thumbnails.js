#!/usr/bin/env node
/**
 * Regenerate thumbnails for all AI-generated games using the new AI-powered system.
 * 
 * Usage:
 *   node regenerate-all-thumbnails.js [--limit=N] [--dry-run]
 * 
 * Options:
 *   --limit=N    Only regenerate N games (for testing)
 *   --dry-run    Show what would be regenerated without actually doing it
 */

import pkg from 'pg';
import { generateAndApplyCover, deleteCoverAsset } from './src/cover-art.js';

const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Parse command line arguments
const args = process.argv.slice(2);
const limit = args.find(arg => arg.startsWith('--limit='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

async function regenerateAllThumbnails() {
    console.log('🎨 AI-Powered Thumbnail Regeneration\n');
    
    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    try {
        // Get all AI-generated games
        const query = `
            SELECT 
                g.id as game_id,
                g.name as title,
                g.thumbnail,
                ai.id as draft_id,
                ai.prompt,
                ai.classification
            FROM games g
            LEFT JOIN ai_games ai ON g.id = ai.game_id
            WHERE g.source = 'ai'
            ORDER BY g.created_at DESC
            ${limit ? `LIMIT ${limit}` : ''}
        `;

        const result = await pool.query(query);
        const games = result.rows;

        console.log(`📊 Found ${games.length} AI-generated games\n`);

        if (games.length === 0) {
            console.log('✅ No games to regenerate');
            await pool.end();
            return;
        }

        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < games.length; i++) {
            const game = games[i];
            const progress = `[${i + 1}/${games.length}]`;

            console.log(`${progress} Processing: ${game.title}`);
            console.log(`   Game ID: ${game.game_id}`);
            console.log(`   Current thumbnail: ${game.thumbnail || 'none'}`);

            if (!game.prompt) {
                console.log(`   ⚠️  Skipped: No prompt found\n`);
                skippedCount++;
                continue;
            }

            if (dryRun) {
                console.log(`   ✓ Would regenerate thumbnail\n`);
                successCount++;
                continue;
            }

            try {
                // Delete old thumbnail if it exists
                if (game.thumbnail) {
                    await deleteCoverAsset(game.thumbnail);
                }

                // Parse classification if it's a JSON string
                let classification = game.classification;
                if (typeof classification === 'string') {
                    try {
                        classification = JSON.parse(classification);
                    } catch (e) {
                        classification = null;
                    }
                }

                // Generate new thumbnail with AI-powered system
                const newThumbnailUrl = await generateAndApplyCover(pool, {
                    draftId: game.draft_id,
                    gameId: game.game_id,
                    title: game.title,
                    prompt: game.prompt,
                    classification: classification || {}
                });

                if (newThumbnailUrl) {
                    console.log(`   ✅ Generated: ${newThumbnailUrl}\n`);
                    successCount++;
                } else {
                    console.log(`   ❌ Failed: No URL returned\n`);
                    failCount++;
                }

                // Rate limiting - wait 2 seconds between generations
                if (i < games.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}\n`);
                failCount++;
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('📈 Summary:');
        console.log(`   ✅ Success: ${successCount}`);
        console.log(`   ❌ Failed: ${failCount}`);
        console.log(`   ⚠️  Skipped: ${skippedCount}`);
        console.log(`   📊 Total: ${games.length}`);
        console.log('='.repeat(50));

    } catch (error) {
        console.error('❌ Fatal error:', error);
    } finally {
        await pool.end();
    }
}

// Run the script
regenerateAllThumbnails().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
