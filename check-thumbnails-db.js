#!/usr/bin/env node
/**
 * Check thumbnail status in database
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkThumbnails() {
    try {
        // Count total AI games
        const totalRes = await pool.query(`
            SELECT COUNT(*) as total 
            FROM ai_games 
            WHERE is_draft = FALSE
        `);
        
        // Count games with new AI-generated thumbnails (from R2)
        const newThumbsRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM ai_games 
            WHERE is_draft = FALSE 
            AND thumbnail LIKE '%r2.dev/covers/%'
        `);
        
        // Count games with old Pollinations thumbnails
        const oldThumbsRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM ai_games 
            WHERE is_draft = FALSE 
            AND thumbnail LIKE '%pollinations.ai%'
        `);
        
        // Count games with no thumbnail
        const noThumbsRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM ai_games 
            WHERE is_draft = FALSE 
            AND (thumbnail IS NULL OR thumbnail = '')
        `);
        
        // Get some recent examples
        const examplesRes = await pool.query(`
            SELECT title, thumbnail, created_at
            FROM ai_games 
            WHERE is_draft = FALSE 
            AND thumbnail IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 5
        `);
        
        console.log('🎨 Thumbnail Status Report');
        console.log('==========================\n');
        console.log(`📊 Total Published Games: ${totalRes.rows[0].total}`);
        console.log(`✅ New AI Thumbnails (R2): ${newThumbsRes.rows[0].count}`);
        console.log(`🔄 Old Thumbnails (Pollinations): ${oldThumbsRes.rows[0].count}`);
        console.log(`❌ No Thumbnail: ${noThumbsRes.rows[0].count}`);
        
        console.log('\n📸 Recent Examples:');
        examplesRes.rows.forEach((game, i) => {
            const type = game.thumbnail.includes('r2.dev') ? '✅ NEW' : '🔄 OLD';
            console.log(`   ${i + 1}. ${type} - ${game.title}`);
            console.log(`      ${game.thumbnail.substring(0, 80)}...`);
        });
        
        await pool.end();
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

checkThumbnails();
