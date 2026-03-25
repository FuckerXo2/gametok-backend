import pool from './src/db.js';

async function check() {
  try {
    const res = await pool.query("SELECT id, title, raw_code, html_payload FROM ai_games ORDER BY created_at DESC LIMIT 1");
    if(res.rows.length > 0) {
      console.log("TITLE:", res.rows[0].title);
      console.log("=================== RAW CODE ===================");
      console.log(res.rows[0].raw_code);
    } else {
      console.log("No games found.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
