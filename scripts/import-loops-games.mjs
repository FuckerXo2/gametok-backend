#!/usr/bin/env node
/** Publish the self-contained Loops browser exports and register them in GameTok. */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gamesRoot = path.resolve(__dirname, '../../gametok-games/loops-games');
const publicBase = (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
const dryRun = process.argv.includes('--dry-run');

const creators = [
  { username: 'loops_arcade', displayName: 'Loops Arcade', bio: 'Quick-play browser arcade games, built for one more round.', avatar: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200&h=200&fit=crop' },
  { username: 'loops_speed', displayName: 'Loops Speed Lab', bio: 'Karting, racing, and reflex games for fast thumbs.', avatar: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=200&h=200&fit=crop' },
  { username: 'loops_puzzle', displayName: 'Loops Puzzle Club', bio: 'Small puzzles, big satisfaction.', avatar: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=200&h=200&fit=crop' },
  { username: 'loops_action', displayName: 'Loops Action', bio: 'Compact action games with immediate chaos.', avatar: 'https://images.unsplash.com/photo-1511882150382-421056c89033?w=200&h=200&fit=crop' },
  { username: 'loops_casual', displayName: 'Loops Casual', bio: 'A playful collection for a five-minute break.', avatar: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&h=200&fit=crop' },
  { username: 'loops_quest', displayName: 'Loops Quest', bio: 'Adventures, survival runs, and strange little worlds.', avatar: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&h=200&fit=crop' },
];

const colors = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };

function filesIn(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full, base) : [{ full, relative: path.relative(base, full) }];
  });
}

function titleFrom(html, fallback) {
  return (html.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)?.[1] || fallback)
    .replace(/^Cocos Creator\s*\|\s*/i, '')
    .trim();
}

function categoryFor(title) {
  const value = title.toLowerCase();
  if (/race|kart|moto|driver|car/.test(value)) return 'racing';
  if (/match|tetris|mine|jewel|candy|puzzle|clear/.test(value)) return 'puzzle';
  if (/zombie|battle|ninja|agent|escape|hero/.test(value)) return 'action';
  if (/football|pong|fishing/.test(value)) return 'sports';
  return 'arcade';
}

function creatorFor(category) {
  return creators[{ racing: 1, puzzle: 2, action: 3, sports: 4, arcade: 0 }[category] ?? 5];
}

function thumbnailFor(dir) {
  const options = ['icons/icon-256.png', 'assets/favicon.png', 'favicon.png', 'loading/logo.png', 'splash.97a22.png', 'yad.png', 'images/shared-0-sheet0.webp'];
  return options.find((relative) => fs.existsSync(path.join(dir, relative))) || null;
}

const entries = fs.readdirSync(gamesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(gamesRoot, entry.name, 'index.html')))
  .map((entry) => {
    const dir = path.join(gamesRoot, entry.name);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const title = titleFrom(html, `Loops Game ${entry.name}`);
    const category = categoryFor(title);
    const orientation = /screen-orientation[^>]+landscape|x5-orientation[^>]+landscape|screenorientation=['"]landscape/i.test(html) ? 'landscape' : 'portrait';
    const assets = filesIn(dir);
    const thumbnail = thumbnailFor(dir);
    return { sourceId: entry.name, id: `loops-${entry.name}`, dir, title, category, orientation, assets, thumbnail, creator: creatorFor(category) };
  })
  .sort((a, b) => a.sourceId.localeCompare(b.sourceId, undefined, { numeric: true }));

console.log(`Found ${entries.length} Loops web-game packages.`);
entries.forEach((game) => console.log(`${game.id}\t${game.orientation}\t${game.category}\t@${game.creator.username}\t${game.title}`));
if (dryRun) process.exit(0);

for (const key of ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

try {
  const creatorIds = new Map();
  for (const creator of creators) {
    const id = crypto.randomUUID();
    const result = await pool.query(
      `INSERT INTO users (id, username, display_name, email, bio, avatar, verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
       ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, avatar = EXCLUDED.avatar, verified = TRUE
       RETURNING id`,
      [id, creator.username, creator.displayName, `${creator.username}@gametok.co`, creator.bio, creator.avatar],
    );
    creatorIds.set(creator.username, result.rows[0].id);
  }

  let uploaded = 0;
  for (const game of entries) {
    for (const asset of game.assets) {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: `loops-games/${game.sourceId}/${asset.relative.replaceAll(path.sep, '/')}`,
        Body: fs.readFileSync(asset.full),
        ContentType: mime[path.extname(asset.full).toLowerCase()] || 'application/octet-stream',
      }));
      uploaded++;
    }
    const thumbnail = game.thumbnail ? `${publicBase}/loops-games/${game.sourceId}/${game.thumbnail}` : null;
    await pool.query(
      `INSERT INTO games (id, name, description, icon, color, category, embed_url, thumbnail, developer, orientation, file_size)
       VALUES ($1, $2, $3, '🎮', $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, color = EXCLUDED.color, category = EXCLUDED.category, embed_url = EXCLUDED.embed_url, thumbnail = EXCLUDED.thumbnail, developer = EXCLUDED.developer, orientation = EXCLUDED.orientation, file_size = EXCLUDED.file_size`,
      [game.id, game.title, `A Loops ${game.category} game.`, colors[Number(game.sourceId) % colors.length], game.category, `${publicBase}/loops-games/${game.sourceId}/index.html`, thumbnail, creatorIds.get(game.creator.username), game.orientation, game.assets.reduce((sum, asset) => sum + fs.statSync(asset.full).size, 0)],
    );
  }
  console.log(`Published ${entries.length} games, ${uploaded} assets, and ${creators.length} creator accounts.`);
} finally {
  await pool.end();
}
