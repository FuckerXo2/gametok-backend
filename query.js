import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/gametok' });
const res = await pool.query("SELECT raw_game_html, html_payload, project_files FROM game_drafts WHERE id = '337326be-56f1-4ded-a2ee-a0008c8f2bd2'");
console.log(JSON.stringify(res.rows[0], null, 2));
pool.end();
