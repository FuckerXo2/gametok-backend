import pool from './db.js';

async function test() {
    const res = await pool.query("SELECT title, raw_code FROM ai_games ORDER BY id DESC LIMIT 1");
    console.log("LAST DRAFT TITLE:", res.rows[0].title);
    console.log("LAST DRAFT CODE:");
    console.log(res.rows[0].raw_code);
    process.exit();
}
test();
