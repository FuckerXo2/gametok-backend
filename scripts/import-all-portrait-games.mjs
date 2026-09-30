import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function collectFiles(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') return [];
    return entry.isDirectory()
      ? collectFiles(fullPath, base)
      : [{ fullPath, relativePath: path.relative(base, fullPath).split(path.sep).join('/') }];
  });
}

// Lightweight catalog games opt into the SDK's generic lifecycle controller. Complex games with
// bespoke pause/quality implementations are uploaded by their own scripts and do not use this.
const sdkSource = path.join(root, 'gametok-sdk/dist/gametok-sdk.js');
const sdkContent = fs.existsSync(sdkSource) ? fs.readFileSync(sdkSource, 'utf8') : '';
const integrationMarker = 'gametok-default-controller';
const integrationScript = `<script id="${integrationMarker}">
window.GameTok.lifecycle.installDefaultController({
  autoReady: true,
  readyDetail: { integration: 'portrait-default' }
});
</script>`;

function prepareGameDirectory(game) {
  if (!sdkContent.includes('installDefaultController')) {
    throw new Error(`Built SDK is missing installDefaultController: ${sdkSource}`);
  }

  const targetSdk = path.join(game.dir, 'gametok-sdk.js');
  if (!fs.existsSync(targetSdk) || fs.readFileSync(targetSdk, 'utf8') !== sdkContent) {
    fs.writeFileSync(targetSdk, sdkContent, 'utf8');
  }

  const indexHtmlPath = path.join(game.dir, 'index.html');
  let htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!htmlContent.includes('gametok-sdk.js')) {
    if (!htmlContent.includes('<head>')) {
      throw new Error(`${game.id}: index.html has no <head> insertion point`);
    }
    htmlContent = htmlContent.replace('<head>', '<head>\n<script src="./gametok-sdk.js"></script>');
  }
  if (!htmlContent.includes(`id="${integrationMarker}"`)) {
    const sdkTag = /<script[^>]+src=["'][^"']*gametok-sdk\.js["'][^>]*><\/script>/i;
    if (!sdkTag.test(htmlContent)) {
      throw new Error(`${game.id}: SDK script tag could not be located`);
    }
    htmlContent = htmlContent.replace(sdkTag, (tag) => `${tag}\n${integrationScript}`);
  }
  fs.writeFileSync(indexHtmlPath, htmlContent, 'utf8');

  validatePreparedGame(game, htmlContent);
  return htmlContent;
}

function validatePreparedGame(game, htmlContent) {
  const targetSdk = path.join(game.dir, 'gametok-sdk.js');
  if (!fs.existsSync(targetSdk)) {
    throw new Error(`${game.id}: gametok-sdk.js is missing`);
  }
  const targetSdkContent = fs.readFileSync(targetSdk, 'utf8');
  if (!targetSdkContent.includes("const SDK_VERSION = '1.1.0'") ||
      !targetSdkContent.includes('installDefaultController')) {
    throw new Error(`${game.id}: gametok-sdk.js is stale or lacks the default controller`);
  }
  const sdkIndex = htmlContent.indexOf('gametok-sdk.js');
  const controllerIndex = htmlContent.indexOf(`id="${integrationMarker}"`);
  if (sdkIndex < 0 || controllerIndex < 0 || controllerIndex < sdkIndex) {
    throw new Error(`${game.id}: lifecycle controller must load after the SDK`);
  }
  if (!htmlContent.includes('installDefaultController({')) {
    throw new Error(`${game.id}: lifecycle controller call is missing`);
  }
  if (htmlContent.indexOf(`id="${integrationMarker}"`) !==
      htmlContent.lastIndexOf(`id="${integrationMarker}"`)) {
    throw new Error(`${game.id}: lifecycle controller was injected more than once`);
  }
}

// Map of all games to import
const GAMES = [
  // --- Classic Portrait Arcade Games ---
  {
    id: 'flappy-bird',
    name: 'Flappy Bird',
    category: 'casual',
    dir: path.join(root, 'gametok-games/flappy-bird'),
    thumb: path.join(root, 'gametok-games/thumbnails/flappy-bird.png'),
    desc: 'Tap to flap your wings and navigate through pipes in this timeless arcade classic.',
    icon: '🐦',
    creator: 'pixel_legend',
  },
  {
    id: 'pong',
    name: 'Pong Master',
    category: 'retro',
    dir: path.join(root, 'gametok-games/pong'),
    thumb: path.join(root, 'gametok-games/thumbnails/pong.png'),
    desc: 'The legendary paddle bounce duel. Test your reflexes against intelligent AI.',
    icon: '🏓',
    creator: 'pixel_legend',
  },
  {
    id: 'doodle-jump',
    name: 'Doodle Jump',
    category: 'casual',
    dir: path.join(root, 'gametok-games/doodle-jump'),
    thumb: path.join(root, 'gametok-games/thumbnails/doodle-jump.png'),
    desc: 'Bounce to new heights on shifting platforms, dodging hazards on the way up.',
    icon: '🐸',
    creator: 'pixel_legend',
  },
  {
    id: 'classic-tetris',
    name: 'Classic Tetris',
    category: 'puzzle',
    dir: path.join(root, 'gametok-games/tetris'),
    thumb: path.join(root, 'gametok-games/thumbnails/tetris.png'),
    desc: 'Rotate and fit falling tetromino blocks to clear lines and rack up combos.',
    icon: '🧱',
    creator: 'pixel_legend',
  },
  {
    id: 'fruit-slicer',
    name: 'Fruit Slicer',
    category: 'action',
    dir: path.join(root, 'gametok-games/fruit-slicer'),
    thumb: path.join(root, 'gametok-games/thumbnails/fruit-slicer.png'),
    desc: 'Swipe your blade to slice flying watermelons, oranges, and apples before they drop.',
    icon: '🍉',
    creator: 'pixel_legend',
  },
  {
    id: 'snake-io',
    name: 'Snake.io',
    category: 'arcade',
    dir: path.join(root, 'gametok-games/snake-io'),
    thumb: path.join(root, 'gametok-games/thumbnails/snake-io.png'),
    desc: 'Slither, eat glowing pellets, and grow your serpent while cutting off rivals.',
    icon: '🐍',
    creator: 'pixel_legend',
  },
  {
    id: '2048',
    name: '2048',
    category: 'puzzle',
    dir: path.join(root, 'gametok-games/2048'),
    thumb: path.join(root, 'gametok-games/thumbnails/2048.png'),
    desc: 'Slide numbered tiles to merge them. Can you reach the legendary 2048 tile?',
    icon: '🔢',
    creator: 'pixel_legend',
  },
  {
    id: 'block-blast',
    name: 'Block Blast',
    category: 'puzzle',
    dir: path.join(root, 'gametok-games/block-blast'),
    thumb: path.join(root, 'gametok-games/thumbnails/block-blast.png'),
    desc: 'Place geometric wooden blocks onto the grid to blast rows and columns.',
    icon: '🟫',
    creator: 'pixel_legend',
  },

  // --- 36 Loops Games ---
  { id: 'tower-building', name: 'Tower Building', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/206'), desc: 'Stack swinging crane blocks to construct the tallest skyscraper in the city.', icon: '🏗️', creator: 'pixel_legend' },
  { id: 'cohe-shoo', name: 'Cohe Shoo', category: 'action', dir: path.join(root, 'gametok-games/loops-games/319'), desc: 'Dynamic reflex dodging and shooting arena with fluid obstacle waves.', icon: '⚡', creator: 'pixel_legend' },
  { id: 'ninja-clan', name: 'Ninja Clan', category: 'action', dir: path.join(root, 'gametok-games/loops-games/413'), desc: 'Stealthy ninja rooftop agility, wall jumps, and throwing star combat.', icon: '🥷', creator: 'pixel_legend' },
  { id: 'barrier-dodge', name: 'Barrier Dodge', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/416'), desc: 'Weave through shifting geometric barriers at breakneck speeds.', icon: '🚧', creator: 'pixel_legend' },
  { id: 'ricocheting-orange', name: 'Ricocheting Orange', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/417'), desc: 'Angle your bouncing fruit shots to collect all items in each stage.', icon: '🍊', creator: 'pixel_legend' },
  { id: 'little-strawberry', name: 'Little Strawberry', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/423'), desc: 'Guide the little strawberry through sweet garden hazards and sugary traps.', icon: '🍓', creator: 'pixel_legend' },
  { id: 'broccoli-jump', name: 'Broccoli Jump', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/425'), desc: 'Healthy hopping fun across floating garden pads and leafy platforms.', icon: '🥦', creator: 'pixel_legend' },
  { id: 'gold-miner', name: 'Gold Miner', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/432'), desc: 'Aim your mechanical claw reel to haul in heavy gold nuggets and diamonds.', icon: '⛏️', creator: 'pixel_legend' },
  { id: 'police-and-thief', name: 'Police & Thief', category: 'action', dir: path.join(root, 'gametok-games/loops-games/439'), desc: 'Cops and robbers high-stakes pursuit through crowded city avenues.', icon: '🚔', creator: 'pixel_legend' },
  { id: 'nutmeg-football', name: 'Nutmeg Football', category: 'sports', dir: path.join(root, 'gametok-games/loops-games/441'), desc: 'Flick the soccer ball between the defender legs to score precision goals.', icon: '⚽', creator: 'pixel_legend' },
  { id: 'tnt-tap', name: 'TNT Tap', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/466'), desc: 'Rapid tap reflex challenge to blast crates before the dynamite detonates.', icon: '💣', creator: 'pixel_legend' },
  { id: 'windmill-spin', name: 'WindMill', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/467'), desc: 'Time your rotations to align the windmill blades and harvest pure energy.', icon: '💨', creator: 'pixel_legend' },
  { id: 'teddy-escape', name: 'Teddy Escape', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/468'), desc: 'Help the fluffy teddy bear dodge mischievous nursery obstacles.', icon: '🧸', creator: 'pixel_legend' },
  { id: 'treasure-ninja', name: 'Treasure Ninja', category: 'action', dir: path.join(root, 'gametok-games/loops-games/469'), desc: 'Infiltrate the ancient pagoda vaults and collect forbidden relics.', icon: '💎', creator: 'pixel_legend' },
  { id: 'the-last-battle', name: 'The Last Battle', category: 'action', dir: path.join(root, 'gametok-games/loops-games/471'), desc: 'Stand your ground against endless waves of invading pixel warriors.', icon: '⚔️', creator: 'pixel_legend' },
  { id: 'super-tetris', name: 'Super Tetris', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/578'), desc: 'High-speed vertical block puzzle with neon visual effects and sound.', icon: '🟦', creator: 'pixel_legend' },
  { id: 'cut-the-candy', name: 'Cut The Candy', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/633'), desc: 'Slice swinging ropes to deliver sweet treats to hungry forest friends.', icon: '🍬', creator: 'pixel_legend' },
  { id: 'emoji-pong', name: 'Emoji Pong', category: 'sports', dir: path.join(root, 'gametok-games/loops-games/690'), desc: 'Fast-paced vertical paddle bounce battle with expressive animated emojis.', icon: '🏓', creator: 'pixel_legend' },
  { id: 'fast-driver', name: 'Fast Driver', category: 'racing', dir: path.join(root, 'gametok-games/loops-games/691'), desc: 'Weave through rush-hour highway traffic without scraping oncoming cars.', icon: '🏎️', creator: 'pixel_legend' },
  { id: 'fishing-frenzy', name: 'Fishing Frenzy', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/694'), desc: 'Cast your line deep into the reef and hook rare sparkling catches.', icon: '🎣', creator: 'pixel_legend' },
  { id: 'koala-leap', name: 'Koala Leap', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/720'), desc: 'Bounce up eucalyptus branches gathering leaves while dodging eagles.', icon: '🐨', creator: 'pixel_legend' },
  { id: 'mini-karting', name: 'Mini Karting', category: 'racing', dir: path.join(root, 'gametok-games/loops-games/729'), desc: 'Micro-kart drift battles around twisting outdoor asphalt tracks.', icon: '🏎️', creator: 'pixel_legend' },
  { id: 'pac-rush', name: 'Pac Rush', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/755'), desc: 'Chomp glowing dots and dodge colorful ghosts in vertical neon mazes.', icon: '🟡', creator: 'pixel_legend' },
  { id: 'pipe-mania', name: 'Pipe Mania', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/760'), desc: 'Rotate pipe segments to create a closed circuit before water overflows.', icon: '🔧', creator: 'pixel_legend' },
  { id: 'jewel-match', name: 'Jewel Match', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/762'), desc: 'Swap sparkling gems in lines of three to clear board obstacles.', icon: '💎', creator: 'pixel_legend' },
  { id: 'animals-crush', name: 'Animals Crush', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/778'), desc: 'Connect matching cute animal faces for explosive combo reactions.', icon: '🐼', creator: 'pixel_legend' },
  { id: 'crazy-supermarket', name: 'Crazy Supermarket', category: 'casual', dir: path.join(root, 'gametok-games/loops-games/799'), desc: 'Rush through grocery aisles collecting cart items against the clock.', icon: '🛒', creator: 'pixel_legend' },
  { id: 'greedy-snake', name: 'Greedy Snake', category: 'arcade', dir: path.join(root, 'gametok-games/loops-games/817'), desc: 'Classic hungry snake eating fruit and growing without biting yourself.', icon: '🐍', creator: 'pixel_legend' },
  { id: 'car-racing-2d', name: 'Car Racing 2D', category: 'racing', dir: path.join(root, 'gametok-games/loops-games/822'), desc: 'Retro top-down vertical freeway racer dodging multi-lane obstacles.', icon: '🚗', creator: 'pixel_legend' },
  { id: 'moto-race', name: 'Real Moto Race', category: 'racing', dir: path.join(root, 'gametok-games/loops-games/836'), desc: 'Rev your motorbike engine and weave through desert highway convoys.', icon: '🏍️', creator: 'pixel_legend' },
  { id: 'mine-clearance', name: 'Mine Clearance', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/840'), desc: 'Clean, touch-first tactical grid puzzle: reveal safe tiles, flag mines.', icon: '🚩', creator: 'pixel_legend' },
  { id: 'dragon-and-princess', name: 'Dragon & Princess', category: 'adventure', dir: path.join(root, 'gametok-games/loops-games/844'), desc: 'A chivalric quest through fairytale towers to rescue the captive princess.', icon: '👑', creator: 'pixel_legend' },
  { id: 'star-pop', name: 'Star Pop', category: 'puzzle', dir: path.join(root, 'gametok-games/loops-games/857'), desc: 'Tap clusters of shining stars to clear massive blocks and earn stars.', icon: '⭐', creator: 'pixel_legend' },
  { id: 'cat-hero', name: 'Cat Hero', category: 'action', dir: path.join(root, 'gametok-games/loops-games/862'), desc: 'Run, jump, and scratch through enemy territory with your agile hero cat.', icon: '🐱', creator: 'pixel_legend' },
  { id: 'agents-vs-zombies', name: 'Agents Vs Zombies', category: 'strategy', dir: path.join(root, 'gametok-games/loops-games/936'), desc: 'Tactical vertical lane defense: deploy specialized agents against zombies.', icon: '🧟', creator: 'pixel_legend' },
  { id: 'idle-miner', name: 'Idle Miner Tycoon', category: 'simulation', dir: path.join(root, 'gametok-games/loops-games/958'), desc: 'Tap and manage deep mining shafts to amass a fortune in underground gems.', icon: '💰', creator: 'pixel_legend' },
];

async function run() {
  console.log(`🚀 Starting import of ${GAMES.length} portrait & loops games...`);

  const prepareOnly = process.argv.includes('--prepare-only');
  const validateOnly = process.argv.includes('--validate-only');

  for (const game of GAMES) {
    if (!fs.existsSync(game.dir)) {
      if (validateOnly) throw new Error(`Directory missing for ${game.id}: ${game.dir}`);
      console.warn(`⚠️ Directory missing for ${game.id}: ${game.dir}`);
      continue;
    }
    const indexHtmlPath = path.join(game.dir, 'index.html');
    if (validateOnly) {
      validatePreparedGame(game, fs.readFileSync(indexHtmlPath, 'utf8'));
    } else {
      prepareGameDirectory(game);
    }
  }

  if (prepareOnly || validateOnly) {
    console.log(`✓ ${validateOnly ? 'Validated' : 'Prepared'} ${GAMES.length} game integrations`);
    await pool.end();
    return;
  }

  // Verify creator exists
  const creatorRes = await pool.query('SELECT id FROM users WHERE username = $1', ['pixel_legend']);
  if (creatorRes.rows.length === 0) throw new Error('Creator @pixel_legend does not exist');
  const creatorId = creatorRes.rows[0].id;

  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '') || 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';
  let processed = 0;

  for (const game of GAMES) {
    if (!fs.existsSync(game.dir)) {
      console.warn(`⚠️ Directory missing for ${game.id}: ${game.dir}`);
      continue;
    }

    // 1–2. Refresh and validate the SDK + generic lifecycle controller before release hashing.
    const htmlContent = prepareGameDirectory(game);

    // 3. Collect files and compute release hash
    const files = collectFiles(game.dir);
    const releaseHash = crypto.createHash('sha256');
    for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      releaseHash.update(file.relativePath);
      releaseHash.update(fs.readFileSync(file.fullPath));
    }
    const release = releaseHash.digest('hex').slice(0, 12);
    const prefix = `web-games/${game.id}/${release}`;
    const embedUrl = `${publicBase}/${prefix}/index.html`;

    // 4. Upload files to R2
    for (const file of files) {
      const extension = path.extname(file.fullPath).toLowerCase();
      const isEntry = file.relativePath === 'index.html';
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: `${prefix}/${file.relativePath}`,
        Body: fs.readFileSync(file.fullPath),
        ContentType: mimeTypes[extension] || 'application/octet-stream',
        CacheControl: isEntry ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable',
      }));
    }

    // 5. Upload thumbnail
    let thumbPath = game.thumb;
    if (!thumbPath || !fs.existsSync(thumbPath)) {
      // Look inside game dir
      const candidates = [
        path.join(game.dir, 'icons/icon-256.png'),
        path.join(game.dir, 'icons/icon-512.png'),
        path.join(game.dir, 'icons/icon-128.png'),
        path.join(game.dir, 'assets/favicon.png'),
        path.join(game.dir, 'icon.png'),
        path.join(root, 'gametok-games/thumbnails/tower-blocks-3d.png'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) { thumbPath = c; break; }
      }
    }

    let thumbnailUrl = `${publicBase}/web-games/${game.id}/thumb.png`;
    if (thumbPath && fs.existsSync(thumbPath)) {
      const ext = path.extname(thumbPath).toLowerCase();
      const thumbKey = `web-games/${game.id}/thumb${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: thumbKey,
        Body: fs.readFileSync(thumbPath),
        ContentType: mimeTypes[ext] || 'image/png',
        CacheControl: 'no-cache, max-age=0',
      }));
      thumbnailUrl = `${publicBase}/${thumbKey}`;
    }

    // 6. Generate random engagement strictly UNDER 10k
    // plays: 2,400 to 9,400
    // likes: 180 to 880
    // saves: 40 to 240
    const plays = Math.floor(Math.random() * (9400 - 2400) + 2400);
    const likes = Math.floor(Math.random() * (880 - 180) + 180);
    const saves = Math.floor(Math.random() * (240 - 40) + 40);

    // 7. Inject base href into html_payload so AI remixing immediately has correct asset paths
    let remixHtml = htmlContent;
    const baseUrl = `${publicBase}/${prefix}/`;
    if (!remixHtml.includes('<base ') && remixHtml.includes('<head>')) {
      remixHtml = remixHtml.replace('<head>', `<head>\n<base href="${baseUrl}">`);
    }

    // 8. Upsert in Supabase
    await pool.query(`
      INSERT INTO games (
        id, name, description, icon, color, thumbnail, embed_url,
        orientation, developer, plays, like_count, save_count,
        category, primary_tab, html_payload, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        thumbnail = EXCLUDED.thumbnail,
        embed_url = EXCLUDED.embed_url,
        orientation = EXCLUDED.orientation,
        developer = EXCLUDED.developer,
        category = EXCLUDED.category,
        primary_tab = EXCLUDED.primary_tab,
        html_payload = EXCLUDED.html_payload;
    `, [
      game.id,
      game.name,
      game.desc,
      game.icon,
      '#111827',
      thumbnailUrl,
      embedUrl,
      'portrait',
      creatorId,
      plays,
      likes,
      saves,
      game.category,
      game.category,
      remixHtml,
    ]);

    processed++;
    console.log(`[${processed}/${GAMES.length}] ✓ ${game.id} -> ${embedUrl} (plays: ${plays}, likes: ${likes})`);
  }

  console.log(`\n🎉 Successfully imported ${processed} portrait & loops games into GameTok feed!`);
  await pool.end();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
