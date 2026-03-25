import pg from 'pg';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=(.*)/);
const processEnvDb = dbUrlMatch ? dbUrlMatch[1].trim() : null;

const pool = new pg.Pool({ connectionString: processEnvDb });
async function start() {
    try {
        const res = await pool.query("SELECT title, raw_code FROM ai_games ORDER BY id DESC LIMIT 1");
        console.log("TITLE:", res.rows[0].title);
        console.log("CODE:");
        console.log(res.rows[0].raw_code);
    } catch(e) { console.error(e); }
    process.exit();
}
start();
