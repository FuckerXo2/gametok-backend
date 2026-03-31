import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import youtubedl from 'youtube-dl-exec';
import crypto from 'crypto';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Initialize Database connection solely for injecting scraped assets
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * 🚀 GLOBAL BRAINROT INGESTOR MODULE
 * Downloads high user-engagement TikToks / YouTube Shorts directly into the server without API keys, 
 * bypassing watermarks and injects them seamlessly straight into the top of the UGC Hivemind feed.
 */
export const INGEST_URLS = [
    // Enter the raw URLs of the Top 5 Viral Meme Videos here for the daily run
    'https://www.youtube.com/shorts/RXZvVv0Nn1Q', // Example Short
    'https://www.youtube.com/shorts/V-cT70-lE5M'  // Example Short
];

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Ensure an 'admin' or 'System Bot' user exists to own these scraped videos
async function getOrCreateSystemBot() {
    const client = await pool.connect();
    try {
        let res = await client.query("SELECT id FROM users WHERE username = 'BrainrotBot'");
        if (res.rows.length === 0) {
            console.log("Creating System Bot...");
            // Notice: The db migration creates a random UUID ID
            res = await client.query(
                "INSERT INTO users (username, display_name, email, password) VALUES ('BrainrotBot', 'System Ingestor', 'bot@gametok.app', 'bot') RETURNING id"
            );
        }
        return res.rows[0].id;
    } finally {
        client.release();
    }
}

export async function ingestViralMemes(urls) {
    console.log('[🧠 Brainrot Ingestor] Initializing pipeline sequence...');
    
    let botId;
    try {
        botId = await getOrCreateSystemBot();
        console.log(`✅ System Bot active [ID: ${botId}]`);
    } catch(err) {
        console.error("❌ Critical Failure: Could not attach to UGC Database.", err);
        process.exit(1);
    }

    const hostname = process.env.NODE_ENV === 'production' 
      ? 'https://gametok-backend-production.up.railway.app' 
      : 'http://localhost:3000';

    for (const url of urls) {
        try {
            console.log(`\n🔍 Inspecting URL: ${url}`);
            
            // Step 1: Probe metadata (Extract title, check duration filter)
            const videoInfo = await youtubedl(url, {
                dumpJson: true,
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true,
            });

            // Filter out excessive duration! It's supposed to be short hyper-react brainrot.
            const duration = videoInfo.duration || 0;
            if (duration > 30) {
                console.log(`⚠️ REJECTED: Video is too long (${duration}s). Strict 30s threshold for UGC meme formats.`);
                continue;
            }

            const cleanTitle = (videoInfo.title || 'Viral TikTok').replace(/[^a-zA-Z0-9 ]/g, '').trim();
            const uniqueId = crypto.randomBytes(6).toString('hex');
            const filename = `trending_${uniqueId}.mp4`;
            const destPath = path.join(UPLOADS_DIR, filename);

            console.log(`📥 RIPPING (${duration}s): ${cleanTitle}`);
            
            // Step 2: Download the raw .mp4 silently
            await youtubedl(url, {
                output: destPath,
                format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true,
            });

            // Step 3: Inject the physical file into our UGC Postgres Database
            const publicUrl = `${hostname}/uploads/${filename}`;

            await pool.query(
                `INSERT INTO community_assets (user_id, type, url, thumbnail, title, usage_count)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [botId, 'video', publicUrl, '', cleanTitle, 5] // Auto-boost with 5 usage counts to push up feed
            );

            console.log(`🔥 SUCCESS! Injected directly to the App Global Feed: ${publicUrl}`);
        } catch(error) {
            console.error(`❌ Ingestion Failed for ${url} (It might be IP-blocked, age-restricted, or removed):`, error.message.substring(0, 150));
        }
    }
    
    console.log('\n[🧠 Brainrot Ingestor] Pipeline successfully terminated.');
    // process.exit(0); // Removing exit so it doesn't kill the main server if run via cron
}

// Boot Sequence
const isMainModule = import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
    const args = process.argv.slice(2);
    const targetUrls = args.length > 0 ? args : INGEST_URLS;
    ingestViralMemes(targetUrls);
}
