import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        const res = await pool.query("SELECT raw_code, title FROM ai_games ORDER BY created_at DESC LIMIT 1");
        console.log("== TITLE ==");
        console.log(res.rows[0].title);
        console.log("== CODE ==");
        console.log(res.rows[0].raw_code);
    } catch (e) {
        console.error("DB error:", e);
    } finally {
        pool.end();
    }
}
run();
