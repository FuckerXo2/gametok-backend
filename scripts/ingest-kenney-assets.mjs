import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const KENNEY_RAW_BASE = 'https://raw.githubusercontent.com/shorepine/kenney/main/2d';

function toTitleCase(str) {
  return str
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  console.log('🚀 Ingesting Kenney CC0 Public Assets into Community Library...');
  const client = await pool.connect();

  try {
    const assets = [];

    // 1. Kenney Animals (30 round outline animal cutouts)
    const ANIMALS = [
      'bear', 'buffalo', 'chick', 'chicken', 'cow', 'crocodile', 'dog', 'duck',
      'elephant', 'frog', 'giraffe', 'goat', 'gorilla', 'hippo', 'horse', 'monkey',
      'moose', 'narwhal', 'owl', 'panda', 'parrot', 'penguin', 'pig', 'rabbit',
      'rhino', 'sloth', 'snake', 'walrus', 'whale', 'zebra'
    ];

    ANIMALS.forEach((animal) => {
      const url = `${KENNEY_RAW_BASE}/Animal%20Pack%20Remastered/Round%20(outline)/${animal}.png`;
      const uses = Math.floor(Math.random() * 3200) + 450;
      assets.push({
        id: `asset-kenney-animal-${animal}`,
        title: `Kenney ${toTitleCase(animal)}`,
        category: 'characters',
        style: 'style:cartoon',
        tags: ['character', 'animal', 'cute', 'creature', animal],
        image_url: url,
        thumbnail_url: url,
        uses_count: uses,
        is_transparent: true,
      });
    });

    // 2. Kenney Toon Characters (Robot, Zombie, Female Adventurer, Male Adventurer)
    const TOON_POSES = [
      { char: 'Robot', folder: 'Robot', poses: ['idle', 'attack0', 'attack1', 'jump', 'cheer0', 'hurt', 'run0', 'kick', 'slide'] },
      { char: 'Zombie', folder: 'Zombie', poses: ['idle', 'attack0', 'jump', 'cheer0', 'hurt', 'run0', 'duck'] },
      { char: 'Female Adventurer', folder: 'Female%20adventurer', poses: ['idle', 'attack0', 'jump', 'cheer0', 'hurt', 'run0'] },
      { char: 'Male Adventurer', folder: 'Male%20adventurer', poses: ['idle', 'attack0', 'jump', 'cheer0', 'hurt', 'run0'] },
    ];

    TOON_POSES.forEach(({ char, folder, poses }) => {
      poses.forEach((pose) => {
        const prefix = folder.includes('adventurer') 
          ? (folder.startsWith('Female') ? 'character_femaleAdventurer' : 'character_maleAdventurer')
          : `character_${char.toLowerCase()}`;
        const filename = `${prefix}_${pose}.png`;
        const url = `${KENNEY_RAW_BASE}/Toon%20Characters/${folder}/Poses%20HD/${filename}`;
        const uses = Math.floor(Math.random() * 2900) + 380;
        const tags = ['character', char.toLowerCase(), pose];
        if (char === 'Robot') tags.push('robot', 'sci_fi');
        if (char === 'Zombie') tags.push('horror', 'undead', 'monster');
        if (char.includes('Adventurer')) tags.push('hero', 'adventurer', 'rpg');

        assets.push({
          id: `asset-kenney-toon-${char.toLowerCase().replace(/\s+/g, '-')}-${pose}`,
          title: `${char} ${toTitleCase(pose)}`,
          category: 'characters',
          style: 'style:cartoon',
          tags,
          image_url: url,
          thumbnail_url: url,
          uses_count: uses,
          is_transparent: true,
        });
      });
    });

    // 3. Kenney Generic Items (Colored 001 - 035)
    const ITEM_NAMES = [
      'Wooden Club', 'Iron Dagger', 'Steel Shortsword', 'Excalibur Longsword', 'Heavy Waraxe',
      'Battle Warhammer', 'Compound Recurve Bow', 'Crossbow', 'Magic Wand', 'Arcane Wizard Staff',
      'Wooden Buckler Shield', 'Reinforced Iron Kite Shield', 'Royal Gold Crest Shield', 'Leather Boots', 'Steel Plated Greaves',
      'Ruby Health Elixir', 'Sapphire Mana Flask', 'Emerald Stamina Potion', 'Amethyst Poison Draught', 'Golden Ambrosia Bottle',
      'Bronze Dungeon Key', 'Silver Crypt Key', 'Gold Treasure Key', 'Skeleton Master Key', 'Iron Padlock',
      'Leather Coin Purse', 'Pile of Silver Coins', 'Sack of Gold Dubloons', 'Chest of Ancient Relics', 'Flawless Cut Diamond',
      'Blood Red Ruby', 'Deep Azure Sapphire', 'Forest Green Emerald', 'Solar Topaz Jewel', 'Shadow Obsidian Shard'
    ];

    for (let i = 1; i <= 35; i++) {
      const numStr = String(i).padStart(3, '0');
      const filename = `genericItem_color_${numStr}.png`;
      const url = `${KENNEY_RAW_BASE}/Generic%20Items/Colored/${filename}`;
      const title = ITEM_NAMES[i - 1] || `Generic Item #${i}`;
      const tags = ['item', 'style:pixel'];
      if (i <= 10) tags.push('weapon');
      if (i >= 11 && i <= 13) tags.push('shield', 'armor');
      if (i >= 16 && i <= 20) tags.push('potion', 'magic');
      if (i >= 21 && i <= 24) tags.push('key');
      if (i >= 25 && i <= 28) tags.push('gold', 'currency');
      if (i >= 30) tags.push('gem', 'treasure');

      assets.push({
        id: `asset-kenney-item-${numStr}`,
        title: title,
        category: 'objects',
        style: 'style:pixel',
        tags,
        image_url: url,
        thumbnail_url: url,
        uses_count: Math.floor(Math.random() * 3400) + 520,
        is_transparent: true,
      });
    }

    // 4. Kenney Space Shooter Remastered (Ships, UFOs, Meteors, Lasers)
    const SHIPS = [
      { name: 'Starfighter Blue', file: 'playerShip1_blue.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Starfighter Green', file: 'playerShip1_green.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Starfighter Orange', file: 'playerShip1_orange.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Starfighter Red', file: 'playerShip1_red.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Heavy Interceptor Blue', file: 'playerShip2_blue.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Heavy Interceptor Red', file: 'playerShip2_red.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Cruiser Orange', file: 'playerShip3_orange.png', tags: ['spaceship', 'sci_fi', 'vehicle'] },
      { name: 'Alien Saucer Blue', file: 'ufoBlue.png', tags: ['ufo', 'alien', 'sci_fi', 'creature'] },
      { name: 'Alien Saucer Green', file: 'ufoGreen.png', tags: ['ufo', 'alien', 'sci_fi', 'creature'] },
      { name: 'Alien Saucer Red', file: 'ufoRed.png', tags: ['ufo', 'alien', 'sci_fi', 'creature'] },
      { name: 'Alien Saucer Yellow', file: 'ufoYellow.png', tags: ['ufo', 'alien', 'sci_fi', 'creature'] },
    ];

    SHIPS.forEach((ship) => {
      const url = `${KENNEY_RAW_BASE}/Space%20Shooter%20Remastered/${ship.file}`;
      assets.push({
        id: `asset-kenney-space-${ship.file.replace('.png', '')}`,
        title: ship.name,
        category: 'objects',
        style: 'style:3d_render',
        tags: ship.tags,
        image_url: url,
        thumbnail_url: url,
        uses_count: Math.floor(Math.random() * 3100) + 610,
        is_transparent: true,
      });
    });

    // 5. Kenney Medals (Achievement Icons 1-9)
    for (let i = 1; i <= 9; i++) {
      const url = `${KENNEY_RAW_BASE}/Medals/shaded_medal${i}.png`;
      const medalName = ['Bronze Bronze Star', 'Silver Star', 'Gold Grand Champion', 'Ruby Knight Medal', 'Sapphire Ace', 'Emerald Guardian', 'Platinum Cross', 'Diamond Crown', 'Obsidian Skull Medal'][i - 1];
      assets.push({
        id: `asset-kenney-medal-${i}`,
        title: medalName,
        category: 'icons',
        style: 'style:cartoon',
        tags: ['badge', 'medal', 'reward', 'star', 'achievement'],
        image_url: url,
        thumbnail_url: url,
        uses_count: Math.floor(Math.random() * 2500) + 400,
        is_transparent: true,
      });
    }

    // 6. Kenney Space Backgrounds
    const SPACE_BGS = [
      { name: 'Deep Space Black', file: 'black.png' },
      { name: 'Cobalt Nebula Blue', file: 'blue.png' },
      { name: 'Cosmic Violet Nebula', file: 'purple.png' },
      { name: 'Deep Void Dark Purple', file: 'darkPurple.png' }
    ];

    SPACE_BGS.forEach((bg) => {
      const url = `${KENNEY_RAW_BASE}/Space%20Shooter%20Remastered/Backgrounds/${bg.file}`;
      assets.push({
        id: `asset-kenney-bg-space-${bg.file.replace('.png', '')}`,
        title: bg.name,
        category: 'backgrounds',
        style: 'style:realistic',
        tags: ['space', 'sci_fi', 'nature', 'stars', 'night'],
        image_url: url,
        thumbnail_url: url,
        uses_count: Math.floor(Math.random() * 3800) + 800,
        is_transparent: false,
      });
    });

    console.log(`📦 Prepared ${assets.length} official Kenney CC0 assets for database insertion.`);

    let inserted = 0;
    for (const item of assets) {
      const res = await client.query(
        `INSERT INTO community_assets (
          id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          style = EXCLUDED.style,
          tags = EXCLUDED.tags,
          image_url = EXCLUDED.image_url,
          thumbnail_url = EXCLUDED.thumbnail_url,
          uses_count = EXCLUDED.uses_count,
          is_transparent = EXCLUDED.is_transparent`,
        [
          item.id,
          item.title,
          item.category,
          item.style,
          item.tags,
          item.image_url,
          item.thumbnail_url || item.image_url,
          item.uses_count || 10,
          item.is_transparent !== undefined ? item.is_transparent : true,
        ]
      );
      if (res.rowCount > 0) inserted++;
    }

    console.log(`✅ Successfully inserted/updated ${inserted} Kenney assets into PostgreSQL!`);

    // Total counts breakdown
    const stats = await client.query(
      `SELECT category, count(*) as count, sum(uses_count) as total_uses FROM community_assets GROUP BY category ORDER BY count DESC`
    );
    console.log('\n📊 Updated Community Assets Catalog:');
    console.table(stats.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Ingestion failed:', err);
  process.exit(1);
});
