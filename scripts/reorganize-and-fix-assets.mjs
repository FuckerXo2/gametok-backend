import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PHASER_SKIES = 'https://raw.githubusercontent.com/phaserjs/examples/master/public/assets/skies';
const KENNEY_BASE = 'https://raw.githubusercontent.com/shorepine/kenney/main/2d';

// Authentic game backgrounds only — NO stock photos!
const REAL_GAME_BACKGROUNDS = [
  // ── Pixel Art & Retro Game Skies ──
  {
    id: 'bg-pixel-sky-day',
    title: 'Pixel Sky Daytime',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel', 'sky', 'clouds', 'retro', 'daytime', 'platformer'],
    image_url: `${PHASER_SKIES}/pixelsky.png`,
    thumbnail_url: `${PHASER_SKIES}/pixelsky.png`,
    uses_count: 380,
  },
  {
    id: 'bg-pixel-hills-backdrop',
    title: 'Pixel Hills Horizon',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel', 'hills', 'nature', 'landscape', 'retro', 'platformer'],
    image_url: `${PHASER_SKIES}/pixelback1.jpg`,
    thumbnail_url: `${PHASER_SKIES}/pixelback1.jpg`,
    uses_count: 340,
  },
  {
    id: 'bg-pixel-mountains-tile',
    title: 'Pixel Tiling Mountains',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel', 'mountain', 'parallax', 'retro', 'landscape'],
    image_url: `${PHASER_SKIES}/mountains-tile.png`,
    thumbnail_url: `${PHASER_SKIES}/mountains-tile.png`,
    uses_count: 295,
  },
  {
    id: 'bg-clouds-fluffy',
    title: 'Sunny Cloud Canopy',
    category: 'backgrounds',
    style: 'style:cartoon',
    tags: ['sky', 'clouds', 'blue', 'daytime', 'nature'],
    image_url: `${PHASER_SKIES}/clouds.png`,
    thumbnail_url: `${PHASER_SKIES}/clouds.png`,
    uses_count: 310,
  },
  {
    id: 'bg-retro-sunset-arcade',
    title: 'Vibrant Sunset Skyline',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['sunset', 'sky', 'orange', 'clouds', 'arcade', 'retro'],
    image_url: `${PHASER_SKIES}/sunset.png`,
    thumbnail_url: `${PHASER_SKIES}/sunset.png`,
    uses_count: 360,
  },

  // ── Dungeons & Caverns ──
  {
    id: 'bg-cavern-stone-1',
    title: 'Underground Stone Cavern',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['dungeon', 'cavern', 'stone', 'cave', 'dark', 'rpg'],
    image_url: `${PHASER_SKIES}/cavern1.png`,
    thumbnail_url: `${PHASER_SKIES}/cavern1.png`,
    uses_count: 350,
  },
  {
    id: 'bg-cavern-deep-2',
    title: 'Deep Obsidian Cavern',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['dungeon', 'cavern', 'mine', 'dark', 'subterranean'],
    image_url: `${PHASER_SKIES}/cavern2.png`,
    thumbnail_url: `${PHASER_SKIES}/cavern2.png`,
    uses_count: 320,
  },
  {
    id: 'bg-darkstone-wall',
    title: 'Castle Dungeon Wall',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['dungeon', 'castle', 'wall', 'stone', 'dark', 'rpg'],
    image_url: `${PHASER_SKIES}/darkstone.png`,
    thumbnail_url: `${PHASER_SKIES}/darkstone.png`,
    uses_count: 280,
  },
  {
    id: 'bg-spooky-graveyard-sky',
    title: 'Spooky Haunted Horizon',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['horror', 'spooky', 'night', 'graveyard', 'creepy'],
    image_url: `${PHASER_SKIES}/spooky.png`,
    thumbnail_url: `${PHASER_SKIES}/spooky.png`,
    uses_count: 330,
  },

  // ── Space & Sci-Fi Cosmos ──
  {
    id: 'bg-deep-space-nebula',
    title: 'Violet Star Nebula',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['space', 'nebula', 'sci_fi', 'stars', 'galaxy', 'cosmos'],
    image_url: `${PHASER_SKIES}/space3.png`,
    thumbnail_url: `${PHASER_SKIES}/space3.png`,
    uses_count: 420,
  },
  {
    id: 'bg-deep-space-blue',
    title: 'Cobalt Cosmic Abyss',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['space', 'blue', 'stars', 'sci_fi', 'galaxy'],
    image_url: `${PHASER_SKIES}/space1.png`,
    thumbnail_url: `${PHASER_SKIES}/space1.png`,
    uses_count: 380,
  },
  {
    id: 'bg-deep-space-green',
    title: 'Emerald Galaxy Cluster',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['space', 'green', 'stars', 'sci_fi', 'galaxy'],
    image_url: `${PHASER_SKIES}/space2.png`,
    thumbnail_url: `${PHASER_SKIES}/space2.png`,
    uses_count: 310,
  },
  {
    id: 'bg-starfield-8bit',
    title: 'Retro 8-Bit Starfield',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['space', 'stars', 'pixel', 'retro', 'arcade', 'shmup'],
    image_url: `${PHASER_SKIES}/starfield.png`,
    thumbnail_url: `${PHASER_SKIES}/starfield.png`,
    uses_count: 390,
  },
  {
    id: 'bg-kenney-space-purple',
    title: 'Space Shooter Violet',
    category: 'backgrounds',
    style: 'style:cartoon',
    tags: ['space', 'purple', 'sci_fi', 'stars', 'kenney'],
    image_url: `${KENNEY_BASE}/Space%20Shooter%20Remastered/Backgrounds/purple.png`,
    thumbnail_url: `${KENNEY_BASE}/Space%20Shooter%20Remastered/Backgrounds/purple.png`,
    uses_count: 270,
  },
  {
    id: 'bg-kenney-space-dark',
    title: 'Deep Void Dark Purple',
    category: 'backgrounds',
    style: 'style:cartoon',
    tags: ['space', 'dark', 'void', 'sci_fi', 'kenney'],
    image_url: `${KENNEY_BASE}/Space%20Shooter%20Remastered/Backgrounds/darkPurple.png`,
    thumbnail_url: `${KENNEY_BASE}/Space%20Shooter%20Remastered/Backgrounds/darkPurple.png`,
    uses_count: 260,
  },

  // ── Aquatic & Underwater ──
  {
    id: 'bg-underwater-coral-1',
    title: 'Sunken Deep Waters',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['underwater', 'ocean', 'water', 'sea', 'blue'],
    image_url: `${PHASER_SKIES}/underwater1.png`,
    thumbnail_url: `${PHASER_SKIES}/underwater1.png`,
    uses_count: 275,
  },
  {
    id: 'bg-underwater-deep-2',
    title: 'Abyssal Trench Blue',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['underwater', 'ocean', 'deep', 'sea', 'water'],
    image_url: `${PHASER_SKIES}/underwater2.png`,
    thumbnail_url: `${PHASER_SKIES}/underwater2.png`,
    uses_count: 260,
  },
  {
    id: 'bg-underwater-reef-3',
    title: 'Aquatic Ocean Reef',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['underwater', 'reef', 'water', 'ocean', 'marine'],
    image_url: `${PHASER_SKIES}/underwater3.png`,
    thumbnail_url: `${PHASER_SKIES}/underwater3.png`,
    uses_count: 250,
  },

  // ── Arcade Synth & Elemental ──
  {
    id: 'bg-synthwave-grid',
    title: 'Neon Retro Grid',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['cyberpunk', 'grid', 'neon', 'synthwave', 'retro', 'arcade'],
    image_url: `${PHASER_SKIES}/grid.png`,
    thumbnail_url: `${PHASER_SKIES}/grid.png`,
    uses_count: 360,
  },
  {
    id: 'bg-inferno-fire',
    title: 'Blazing Lava Inferno',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['fire', 'lava', 'flame', 'inferno', 'danger', 'volcano'],
    image_url: `${PHASER_SKIES}/fire.png`,
    thumbnail_url: `${PHASER_SKIES}/fire.png`,
    uses_count: 315,
  },
  {
    id: 'bg-toxic-wasteland',
    title: 'Toxic Acid Wasteland',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['toxic', 'green', 'acid', 'wasteland', 'cyberpunk', 'sci_fi'],
    image_url: `${PHASER_SKIES}/toxic.png`,
    thumbnail_url: `${PHASER_SKIES}/toxic.png`,
    uses_count: 290,
  },
  {
    id: 'bg-fog-mist',
    title: 'Silent Hill Gray Fog',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['fog', 'mist', 'horror', 'atmospheric', 'mystery'],
    image_url: `${PHASER_SKIES}/fog.png`,
    thumbnail_url: `${PHASER_SKIES}/fog.png`,
    uses_count: 240,
  },

  // ── Minecraft Official Biome Panoramas ──
  {
    id: 'bg-minecraft-overworld-panorama',
    title: 'Minecraft Overworld Biome',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['minecraft', 'voxel', 'overworld', 'panorama', 'nature'],
    image_url: 'https://minecraft.wiki/images/Panorama_1.20.png',
    thumbnail_url: 'https://minecraft.wiki/images/Panorama_1.20.png',
    uses_count: 450,
  },
  {
    id: 'bg-minecraft-nether-panorama',
    title: 'Minecraft Nether Hellscape',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['minecraft', 'voxel', 'nether', 'lava', 'fire', 'dimension'],
    image_url: 'https://minecraft.wiki/images/Nether_Panorama.png',
    thumbnail_url: 'https://minecraft.wiki/images/Nether_Panorama.png',
    uses_count: 410,
  },
  {
    id: 'bg-minecraft-end-panorama',
    title: 'Minecraft The End Dimension',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['minecraft', 'voxel', 'end', 'void', 'space', 'dragon', 'dimension'],
    image_url: 'https://minecraft.wiki/images/End_Panorama.png',
    thumbnail_url: 'https://minecraft.wiki/images/End_Panorama.png',
    uses_count: 430,
  },
];

async function main() {
  console.log('🧹 Purging stock photo fuckery from community_assets...');
  const client = await pool.connect();
  try {
    // 1. Delete all Unsplash stock photos
    const delRes = await client.query(`DELETE FROM community_assets WHERE image_url LIKE '%unsplash%'`);
    console.log(`🗑️ Deleted ${delRes.rowCount} stock photo entries.`);

    // 2. Insert authentic game backgrounds
    console.log(`🎨 Inserting ${REAL_GAME_BACKGROUNDS.length} authentic game backgrounds...`);
    for (const bg of REAL_GAME_BACKGROUNDS) {
      await client.query(`
        INSERT INTO community_assets (id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent, is_system)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, TRUE)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          style = EXCLUDED.style,
          tags = EXCLUDED.tags,
          image_url = EXCLUDED.image_url,
          thumbnail_url = EXCLUDED.thumbnail_url,
          uses_count = EXCLUDED.uses_count,
          is_transparent = FALSE;
      `, [bg.id, bg.title, bg.category, bg.style, bg.tags, bg.image_url, bg.thumbnail_url, bg.uses_count]);
    }
    console.log(`✅ Game backgrounds successfully added.`);

    // 3. Reorganize & cross-tag all assets with their proper mates
    console.log('🔗 Tagging and cohorting all assets with their universe mates...');
    
    // Minecraft assets get 'minecraft' and related tags
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['minecraft', 'voxel'])
      WHERE id LIKE '%minecraft%' OR title ILIKE '%minecraft%' OR title ILIKE '%steve%' OR title ILIKE '%creeper%';
    `);

    // Clash assets get 'clash'
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['clash', 'brawler'])
      WHERE id LIKE '%clash%' OR title ILIKE '%clash%' OR title ILIKE '%pekka%' OR title ILIKE '%archer%';
    `);

    // Sanrio assets get 'sanrio'
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['sanrio', 'cute', 'cartoon'])
      WHERE id LIKE '%sanrio%' OR title ILIKE '%kitty%' OR title ILIKE '%kuromi%' OR title ILIKE '%melody%';
    `);

    // FNaF assets get 'fnaf' and 'horror'
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['fnaf', 'horror', 'animatronic'])
      WHERE id LIKE '%fnaf%' OR title ILIKE '%freddy%' OR title ILIKE '%bonnie%' OR title ILIKE '%chica%' OR title ILIKE '%foxy%';
    `);

    // Space Fleet assets get 'space_fleet' and 'spaceship'
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['space_fleet', 'spaceship', 'scifi'])
      WHERE title ILIKE '%ship%' OR title ILIKE '%ufo%' OR title ILIKE '%fighter%' AND category = 'objects';
    `);

    // RPG weapons get 'rpg_loot' and 'weapon'
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['rpg_loot', 'loot', 'weapon'])
      WHERE title ILIKE '%sword%' OR title ILIKE '%shield%' OR title ILIKE '%potion%' OR title ILIKE '%blade%' OR title ILIKE '%axe%';
    `);

    // Deduplicate tags in array
    await client.query(`
      UPDATE community_assets
      SET tags = (
        SELECT ARRAY_AGG(DISTINCT t)
        FROM unnest(tags) AS t
      );
    `);

    const summary = await client.query(`
      SELECT category, count(*) FROM community_assets GROUP BY category ORDER BY count DESC
    `);
    console.log('📊 Current Catalog Summary:');
    console.table(summary.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
