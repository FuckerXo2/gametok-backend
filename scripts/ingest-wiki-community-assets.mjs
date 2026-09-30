import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper to format clean titles
function cleanTitle(filename) {
  return filename
    .replace(/^File:/i, '')
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .replace(/_JE\d+.*$/i, '')
    .replace(/_BE\d+.*$/i, '')
    .replace(/Card.*$/i, '')
    .replace(/render/gi, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchMediaWikiCategory(apiUrl, categoryTitle, limit = 30) {
  try {
    const url = `${apiUrl}?action=query&format=json&prop=imageinfo&iiprop=url|size|mime&generator=categorymembers&gcmtitle=${encodeURIComponent(categoryTitle)}&gcmtype=file&gcmlimit=${limit}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GameTokAssetBot/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.query || !data.query.pages) return [];

    const pages = Object.values(data.query.pages);
    const items = [];

    for (const page of pages) {
      if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
        const info = page.imageinfo[0];
        // Ensure PNG or WebP with clean transparent potential
        if (info.mime === 'image/png' || info.mime === 'image/webp') {
          items.push({
            title: page.title,
            url: info.url,
            width: info.width,
            height: info.height,
          });
        }
      }
    }
    return items;
  } catch (e) {
    console.warn(`[WikiScrape] Error fetching ${categoryTitle} from ${apiUrl}:`, e.message);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting Automated Game Wiki Asset Ingestion...');
  const client = await pool.connect();

  try {
    const assetsToInsert = [];

    // 1. MINECRAFT WIKI: Iconic Mobs & Items
    console.log('⛏️ Fetching Minecraft Wiki renders...');
    const mcMobs = await fetchMediaWikiCategory('https://minecraft.wiki/api.php', 'Category:Mob renders', 40);
    console.log(`   Found ${mcMobs.length} Minecraft mob renders.`);

    mcMobs.forEach((item) => {
      const rawTitle = cleanTitle(item.title);
      // Skip very tiny or obscure textures
      if (rawTitle.length < 3 || rawTitle.includes('0.0.')) return;

      const id = `asset-mc-${rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const uses = Math.floor(Math.random() * 4500) + 1200;
      assetsToInsert.push({
        id,
        title: `Minecraft ${rawTitle}`,
        category: 'characters',
        style: 'style:3d_render',
        tags: ['character', 'minecraft', 'mob', 'creature', 'voxel'],
        image_url: item.url,
        thumbnail_url: item.url,
        uses_count: uses,
        is_transparent: true,
      });
    });

    // 2. Specific Iconic Minecraft Staples (Creeper, Steve, Alex, Enderman, Diamond Sword, TNT)
    const MC_ICONICS = [
      { name: 'Creeper', file: 'Creeper_JE3_BE1.png', cat: 'characters', tags: ['character', 'creeper', 'mob', 'monster'] },
      { name: 'Enderman', file: 'Enderman_JE3.png', cat: 'characters', tags: ['character', 'enderman', 'monster', 'dark'] },
      { name: 'Steve', file: 'Steve_JE5.png', cat: 'characters', tags: ['character', 'hero', 'steve', 'player'] },
      { name: 'Alex', file: 'Alex_(slim)_JE1.png', cat: 'characters', tags: ['character', 'hero', 'alex', 'player'] },
      { name: 'Warden', file: 'Warden_JE1_BE1.png', cat: 'characters', tags: ['character', 'boss', 'monster', 'warden'] },
      { name: 'Iron Golem', file: 'Iron_Golem_JE1_BE1.png', cat: 'characters', tags: ['character', 'golem', 'tank', 'defender'] },
      { name: 'Ender Dragon', file: 'Ender_Dragon_JE1_BE1.png', cat: 'characters', tags: ['character', 'dragon', 'boss', 'flying'] },
      { name: 'Diamond Sword', file: 'Diamond_Sword_JE3_BE3.png', cat: 'objects', tags: ['weapon', 'sword', 'diamond', 'item'] },
      { name: 'Golden Apple', file: 'Golden_Apple_JE2_BE2.png', cat: 'objects', tags: ['food', 'gold', 'apple', 'magic'] },
      { name: 'TNT Block', file: 'TNT_JE3_BE2.png', cat: 'objects', tags: ['explosion', 'tnt', 'block', 'danger'] },
      { name: 'Totem of Undying', file: 'Totem_of_Undying_JE2_BE2.png', cat: 'objects', tags: ['item', 'gold', 'totem', 'magic'] },
      { name: 'Enchanted Book', file: 'Enchanted_Book_JE2_BE2.png', cat: 'objects', tags: ['item', 'magic', 'book', 'scroll'] },
    ];

    MC_ICONICS.forEach((m) => {
      assetsToInsert.push({
        id: `asset-mc-iconic-${m.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        title: `Minecraft ${m.name}`,
        category: m.cat,
        style: 'style:3d_render',
        tags: m.tags,
        image_url: `https://minecraft.wiki/images/${m.file}`,
        thumbnail_url: `https://minecraft.wiki/images/${m.file}`,
        uses_count: Math.floor(Math.random() * 5200) + 2100,
        is_transparent: true,
      });
    });

    // 3. CLASH ROYALE WIKI: Troops & Fighters
    console.log('⚔️ Fetching Clash Royale Wiki card renders...');
    const clashCards = await fetchMediaWikiCategory('https://clashroyale.fandom.com/api.php', 'Category:Card Images', 35);
    console.log(`   Found ${clashCards.length} Clash Royale cards.`);

    clashCards.forEach((item) => {
      const rawTitle = cleanTitle(item.title);
      if (rawTitle.length < 3 || rawTitle.includes('Evolution')) return;

      const isBuilding = rawTitle.includes('Tower') || rawTitle.includes('Hut') || rawTitle.includes('Cannon');
      const isSpell = rawTitle.includes('Arrows') || rawTitle.includes('Clone') || rawTitle.includes('Barrel');
      const category = isBuilding || isSpell ? 'objects' : 'characters';

      const id = `asset-clash-${rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const uses = Math.floor(Math.random() * 4100) + 980;
      assetsToInsert.push({
        id,
        title: `Clash ${rawTitle}`,
        category,
        style: 'style:3d_render',
        tags: [category === 'characters' ? 'character' : 'weapon', 'clash', 'fighter', rawTitle.toLowerCase()],
        image_url: item.url.split('/revision/')[0], // Clean static URL
        thumbnail_url: item.url.split('/revision/')[0],
        uses_count: uses,
        is_transparent: true,
      });
    });

    // 4. SANRIO / HELLO KITTY WIKI: Pop Cutouts
    console.log('🎀 Adding Sanrio & Hello Kitty Cutouts...');
    const SANRIO_ICONS = [
      { name: 'Hello Kitty Classic', url: 'https://static.wikia.nocookie.net/hellokitty/images/8/87/Hello_Kitty.png', tags: ['cute', 'cat', 'character', 'sanrio'] },
      { name: 'Kuromi Rebel', url: 'https://static.wikia.nocookie.net/hellokitty/images/1/14/Kuromi.png', tags: ['cute', 'gothic', 'character', 'sanrio'] },
      { name: 'My Melody', url: 'https://static.wikia.nocookie.net/hellokitty/images/2/29/My_Melody.png', tags: ['cute', 'rabbit', 'character', 'sanrio'] },
      { name: 'Cinnamoroll', url: 'https://static.wikia.nocookie.net/hellokitty/images/4/4b/Cinnamoroll.png', tags: ['cute', 'puppy', 'character', 'sanrio'] },
      { name: 'Pompompurin', url: 'https://static.wikia.nocookie.net/hellokitty/images/0/05/Pompompurin.png', tags: ['cute', 'dog', 'character', 'sanrio'] },
      { name: 'Badtz Maru', url: 'https://static.wikia.nocookie.net/hellokitty/images/c/c5/Badtz-Maru.png', tags: ['cute', 'penguin', 'character', 'sanrio'] },
    ];

    SANRIO_ICONS.forEach((s) => {
      assetsToInsert.push({
        id: `asset-sanrio-${s.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        title: s.name,
        category: 'characters',
        style: 'style:cartoon',
        tags: s.tags,
        image_url: s.url,
        thumbnail_url: s.url,
        uses_count: Math.floor(Math.random() * 4900) + 1500,
        is_transparent: true,
      });
    });

    // 5. FNAF WIKI: Animatronic Horror Renders
    console.log('🐻 Adding FNaF Horror Cutouts...');
    const FNAF_ROSTER = [
      { name: 'Freddy Fazbear', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/2/28/Freddy_Fazbear.png', tags: ['horror', 'fnaf', 'bear', 'robot', 'monster'] },
      { name: 'Bonnie the Bunny', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/8/87/Bonnie_the_Bunny.png', tags: ['horror', 'fnaf', 'bunny', 'robot', 'monster'] },
      { name: 'Chica the Chicken', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/4/46/Chica_the_Chicken.png', tags: ['horror', 'fnaf', 'bird', 'robot', 'monster'] },
      { name: 'Foxy the Pirate', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/3/36/Foxy_the_Pirate.png', tags: ['horror', 'fnaf', 'fox', 'pirate', 'robot'] },
      { name: 'Golden Freddy', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/5/5f/Golden_Freddy.png', tags: ['horror', 'fnaf', 'gold', 'bear', 'ghost'] },
      { name: 'Springtrap', url: 'https://static.wikia.nocookie.net/freddy-fazbears-pizza/images/c/c2/Springtrap.png', tags: ['horror', 'fnaf', 'decay', 'zombie', 'monster'] },
    ];

    FNAF_ROSTER.forEach((f) => {
      assetsToInsert.push({
        id: `asset-fnaf-${f.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        title: f.name,
        category: 'characters',
        style: 'style:3d_render',
        tags: f.tags,
        image_url: f.url,
        thumbnail_url: f.url,
        uses_count: Math.floor(Math.random() * 5600) + 2400,
        is_transparent: true,
      });
    });

    console.log(`\n📦 Prepared ${assetsToInsert.length} total wiki assets for insertion.`);

    let inserted = 0;
    for (const item of assetsToInsert) {
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

    console.log(`✅ Successfully inserted/updated ${inserted} wiki assets into PostgreSQL!`);

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
  console.error('❌ Script failed:', err);
  process.exit(1);
});
