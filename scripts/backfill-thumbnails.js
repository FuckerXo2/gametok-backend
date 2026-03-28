
import pg from 'pg';
import puppeteer from 'puppeteer';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function main() {
    console.log("🚀 Starting Drafts Thumbnail Backfill...");
    const client = await pool.connect();
    let browser = null;

    try {
        console.log("🕵️  Booting Headless Browser...");
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });

        // Get all AI games that have an HTML payload but no thumbnail
        const draftsResult = await client.query(`
            SELECT id, title, html_payload 
            FROM ai_games 
            WHERE html_payload IS NOT NULL 
              AND html_payload != '' 
              AND (thumbnail IS NULL OR thumbnail = '')
        `);

        console.log(`Found ${draftsResult.rowCount} games to process.`);

        for (let i = 0; i < draftsResult.rows.length; i++) {
            const draft = draftsResult.rows[i];
            console.log(`[${i + 1}/${draftsResult.rowCount}] Capturing: ${draft.title || 'Untitled'} (ID: ${draft.id})`);
            
            let page = null;
            try {
                page = await browser.newPage();
                // Exact mobile dimensions for realistic iOS ratio
                await page.setViewport({ width: 390, height: 844 });
                
                // Load HTML and wait 2 seconds for JS execution & drawing
                await page.setContent(draft.html_payload, { waitUntil: 'load', timeout: 15000 });
                await new Promise(r => setTimeout(r, 2000));
                
                // Screenshot canvas area
                const buffer = await page.screenshot({ type: 'webp', quality: 50 });
                const base64 = 'data:image/webp;base64,' + buffer.toString('base64');
                
                await client.query(`UPDATE ai_games SET thumbnail = $1 WHERE id = $2`, [base64, draft.id]);
                
                console.log(`✅ Success`);
            } catch (err) {
                console.error(`❌ Failed:`, err.message);
            } finally {
                if (page) await page.close();
            }
        }

        console.log("🎉 Backfill complete!");
    } catch (e) {
        console.error("FATAL ERROR:", e);
    } finally {
        if (browser) await browser.close();
        client.release();
        await pool.end();
    }
}

main();
