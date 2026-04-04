import dotenv from 'dotenv';
dotenv.config();
import pool from './src/db.js';

async function main() {
    try {
        const res = await pool.query("SELECT html_payload FROM ai_games WHERE title LIKE '%Horror%' OR prompt LIKE '%horror%' ORDER BY created_at DESC LIMIT 1");
        if (res.rows.length > 0) {
            console.log(res.rows[0].html_payload);
        } else {
            console.log('No games found.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
main();
