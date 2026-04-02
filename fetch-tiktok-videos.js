/**
 * TikTok Brain Rot Video Fetcher
 * 
 * Searches TikTok via TikWM API and saves video URLs
 * directly into the community-assets.json pool.
 * 
 * Usage:
 *   node fetch-tiktok-videos.js                    # fetches defaults
 *   node fetch-tiktok-videos.js --count 500        # fetch 500 videos
 *   node fetch-tiktok-videos.js --tags "minecraft parkour,subway surfers"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ───
const ASSETS_JSON_PATH = path.join(__dirname, 'public/uploads/community-assets.json');
const UPLOADS_DIR = path.join(__dirname, 'public/uploads');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const TARGET_COUNT = parseInt(getArg('--count') || '200');
const MAX_DURATION = parseInt(getArg('--maxdur') || '30'); // seconds
const CUSTOM_TAGS = getArg('--tags');

// Actual trending brainrot meme culture hashtags
const DEFAULT_TAGS = [
  // Italian Brainrot Universe
  'italian brainrot',
  'bombardiro crocodilo',
  'tralalero tralala',
  'tung tung tung sahur',
  'ballerina cappuccina',
  'brr brr patapim',
  'lirili larila',
  'bombombini gusini',
  'schimpanzini bananini',
  'spaghetti tualetti',
  'la vaca saturno saturnita',
  
  // General brainrot culture
  'brainrot',
  'brainrot meme',
  'brainrot compilation',
  'skibidi toilet',
  'skibidi brainrot',
  
  // Trending meme figures
  'diddy meme',
  'p diddy meme',
  'jeffrey epstein meme',
  'sigma meme',
  'sigma male meme',
  'npc meme',
  'rizz meme',
  'mewing meme',
  'gyatt meme',
  'ohio meme',
  'ohio final boss',
  
  // Viral meme formats
  'meme compilation',
  'shitpost compilation',
  'dank memes',
  'cursed meme',
  'gen z meme',
  'gen alpha brainrot',
  'tiktok meme compilation',
  'brain rot tiktok',
  
  // Gaming brainrot
  'subway surfers brainrot',
  'minecraft brainrot',
  'roblox meme',
  'fortnite meme',
];

const SEARCH_TAGS = CUSTOM_TAGS ? CUSTOM_TAGS.split(',').map(t => t.trim()) : DEFAULT_TAGS;

// ─── Helpers ───

// Ensure upload directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Load existing assets
let existingAssets = [];
if (fs.existsSync(ASSETS_JSON_PATH)) {
  try {
    existingAssets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, 'utf-8'));
  } catch (e) {
    existingAssets = [];
  }
}

const existingUrls = new Set(existingAssets.filter(a => a.type === 'video').map(a => a.url));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchTikWM(keywords, count = 30, cursor = 0) {
  const url = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keywords)}&count=${count}&cursor=${cursor}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    });
    
    if (!res.ok) {
      console.error(`   ❌ HTTP ${res.status} for "${keywords}"`);
      return { videos: [], cursor: 0, hasMore: false };
    }
    
    const data = await res.json();
    
    if (data.code !== 0 || !data.data) {
      console.error(`   ❌ API error for "${keywords}":`, data.msg || 'Unknown');
      return { videos: [], cursor: 0, hasMore: false };
    }

    return {
      videos: data.data.videos || [],
      cursor: data.data.cursor || 0,
      hasMore: data.data.hasMore || false
    };
  } catch (err) {
    console.error(`   ❌ Network error for "${keywords}":`, err.message);
    return { videos: [], cursor: 0, hasMore: false };
  }
}

function formatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
}

// ─── Main ───

async function main() {
  console.log('\n🧠 TikTok Brain Rot Video Fetcher');
  console.log('─'.repeat(50));
  console.log(`📦 Target: ~${TARGET_COUNT} videos (max ${MAX_DURATION}s each)`);
  console.log(`🏷️  Tags: ${SEARCH_TAGS.length} hashtags`);
  console.log(`📂 Output: ${ASSETS_JSON_PATH}`);
  console.log(`📊 Existing pool size: ${existingAssets.length} assets (${existingUrls.size} videos)`);
  console.log('─'.repeat(50));

  const videosPerTag = Math.ceil(TARGET_COUNT / SEARCH_TAGS.length);
  let totalFetched = 0;
  let totalDupes = 0;
  let totalTooLong = 0;
  const newAssets = [];

  for (const tag of SEARCH_TAGS) {
    console.log(`\n🔍 Searching: "${tag}" (want ${videosPerTag} videos)...`);
    
    let cursor = 0;
    let tagFetched = 0;
    let page = 0;

    while (tagFetched < videosPerTag && page < 10) { // Max 10 pages per tag
      const batchSize = Math.min(30, videosPerTag - tagFetched); // TikWM max is ~30 per request
      const result = await fetchTikWM(tag, batchSize, cursor);
      
      if (result.videos.length === 0) {
        console.log(`   ⚠️  No more results for "${tag}"`);
        break;
      }

      for (const video of result.videos) {
        // Build direct play URL (TikWM provides this)
        const playUrl = video.play;
        const coverUrl = video.cover || video.origin_cover;
        
        if (!playUrl) continue;

        // Skip videos longer than MAX_DURATION seconds
        if (video.duration && video.duration > MAX_DURATION) {
          totalTooLong++;
          continue;
        }

        // Skip duplicates
        if (existingUrls.has(playUrl)) {
          totalDupes++;
          continue;
        }

        const asset = {
          id: `tiktok-${video.video_id || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'video',
          url: playUrl,
          thumb: coverUrl,
          thumbnail: coverUrl,
          title: (video.title || tag).substring(0, 80),
          label: (video.title || tag).substring(0, 80),
          duration: formatDuration(video.duration),
          source: 'tiktok',
          tag: tag,
        };

        newAssets.push(asset);
        existingUrls.add(playUrl);
        tagFetched++;
        totalFetched++;
      }

      console.log(`   📥 Page ${page + 1}: got ${result.videos.length} → ${tagFetched} kept for "${tag}"`);

      cursor = result.cursor;
      if (!result.hasMore) break;
      
      page++;
      await sleep(800); // Rate limit: ~1 req/sec to be respectful
    }

    console.log(`   ✅ "${tag}": ${tagFetched} new videos`);
    
    // Small delay between tags
    await sleep(500);
  }

  // Merge new assets into existing pool
  const finalAssets = [...newAssets, ...existingAssets];
  fs.writeFileSync(ASSETS_JSON_PATH, JSON.stringify(finalAssets, null, 2));

  console.log('\n' + '═'.repeat(50));
  console.log(`🎉 DONE!`);
  console.log(`   📥 New videos fetched: ${totalFetched}`);
  console.log(`   ⏱️  Skipped (too long): ${totalTooLong}`);
  console.log(`   🔁 Duplicates skipped: ${totalDupes}`);
  console.log(`   📦 Total pool size: ${finalAssets.length} assets`);
  console.log(`   💾 Saved to: ${ASSETS_JSON_PATH}`);
  console.log('═'.repeat(50) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
