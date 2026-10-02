import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('sslmode=require') || process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('render.com'))) || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export const SEED_ASSETS = [
  // ── TRENDING ─────────────────────────────────────────────────────────────
  {
    id: 'asset-poolrooms-hallway',
    title: 'Poolrooms Water Hallway',
    category: 'backgrounds',
    style: 'style:3d_render',
    tags: ['liminal_space', 'pool', 'water', 'interior'],
    image_url: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=800&auto=format&fit=crop&q=80',
    uses_count: 3920,
    is_transparent: false,
  },
  {
    id: 'asset-minecraft-tv-head',
    title: 'Blocky TV Head',
    category: 'characters',
    style: 'style:cartoon',
    tags: ['character', 'pixel_art', 'retro', 'blocky'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
    uses_count: 2450,
    is_transparent: true,
  },
  {
    id: 'asset-demon-wide-mouth',
    title: 'Void Stalker',
    category: 'characters',
    style: 'style:3d_render',
    tags: ['character', 'creature', 'horror', 'monster'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png',
    uses_count: 4410,
    is_transparent: true,
  },
  {
    id: 'asset-blood-splatter',
    title: 'Action Blood Splatter',
    category: 'effects',
    style: 'style:realistic',
    tags: ['blood', 'damage', 'horror', 'action'],
    image_url: 'https://opengameart.org/sites/default/files/splat1.png',
    uses_count: 2540,
    is_transparent: true,
  },
  {
    id: 'asset-stick-figure-runner',
    title: 'Running Icon Circle',
    category: 'icons',
    style: 'style:realistic',
    tags: ['symbol', 'action', 'run', 'badge'],
    image_url: 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/footprints.svg',
    uses_count: 592,
    is_transparent: true,
  },
  {
    id: 'asset-chainsaw',
    title: 'Heavy Chainsaw',
    category: 'objects',
    style: 'style:realistic',
    tags: ['weapon', 'tool', 'action', 'metal'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/saw.png',
    uses_count: 700,
    is_transparent: true,
  },
  {
    id: 'asset-glitter-bun',
    title: 'Gold Glitter Slime',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['toy', 'food', 'gold', 'cute'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/132.png',
    uses_count: 491,
    is_transparent: true,
  },
  {
    id: 'asset-cat-paw',
    title: 'Neon Cat Paw Pad',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['toy', 'cute', 'animal', 'cat'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/52.png',
    uses_count: 419,
    is_transparent: true,
  },
  {
    id: 'asset-pistol-aim',
    title: 'Tactical Pistol',
    category: 'objects',
    style: 'style:realistic',
    tags: ['weapon', 'action', 'military'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Weapon/Models/PNG/pistol.png',
    uses_count: 393,
    is_transparent: true,
  },
  {
    id: 'asset-butter-bar',
    title: 'Golden Butter Bar',
    category: 'objects',
    style: 'style:realistic',
    tags: ['food', 'dairy', 'yellow', 'item'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Food/Models/PNG/cheese.png',
    uses_count: 850,
    is_transparent: true,
  },
  {
    id: 'asset-strawberry-ripe',
    title: 'Glossy Strawberry',
    category: 'objects',
    style: 'style:realistic',
    tags: ['food', 'fruit', 'red', 'item'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Food/Models/PNG/apple.png',
    uses_count: 1120,
    is_transparent: true,
  },
  {
    id: 'asset-creepy-hallway',
    title: 'Liminal Wallpaper Hallway',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['liminal_space', 'interior', 'horror'],
    image_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
    uses_count: 542,
    is_transparent: false,
  },
  {
    id: 'asset-void-eyes',
    title: 'Abyssal Eyes Void',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['horror', 'creature', 'interior'],
    image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    uses_count: 758,
    is_transparent: false,
  },
  {
    id: 'asset-parking-pillar',
    title: 'Dark Concrete Pillar Basement',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['liminal_space', 'interior', 'urban'],
    image_url: 'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&auto=format&fit=crop&q=80',
    uses_count: 1640,
    is_transparent: false,
  },
  {
    id: 'asset-windows-bliss',
    title: 'Endless Green Meadow',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['nature', 'retro', 'sky'],
    image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&auto=format&fit=crop&q=80',
    uses_count: 3100,
    is_transparent: false,
  },

  // ── CHARACTERS ───────────────────────────────────────────────────────────
  {
    id: 'char-cyber-warrior',
    title: 'Cyber Ninja',
    category: 'characters',
    style: 'style:3d_render',
    tags: ['character', 'cyberpunk', 'hero', 'anime'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/448.png',
    uses_count: 2890,
    is_transparent: true,
  },
  {
    id: 'char-space-cadet',
    title: 'Space Marine',
    category: 'characters',
    style: 'style:3d_render',
    tags: ['character', 'sci_fi', 'hero'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png',
    uses_count: 1820,
    is_transparent: true,
  },
  {
    id: 'char-ghost-phantom',
    title: 'Spooky Phantom',
    category: 'characters',
    style: 'style:cartoon',
    tags: ['character', 'creature', 'horror', 'ghost'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/92.png',
    uses_count: 3400,
    is_transparent: true,
  },
  {
    id: 'char-flame-mage',
    title: 'Inferno Mage',
    category: 'characters',
    style: 'style:cartoon',
    tags: ['character', 'anime', 'magic', 'fire'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png',
    uses_count: 4120,
    is_transparent: true,
  },
  {
    id: 'char-mecha-bot',
    title: 'Titan Mech Bot',
    category: 'characters',
    style: 'style:3d_render',
    tags: ['character', 'robot', 'sci_fi'],
    image_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/376.png',
    uses_count: 2150,
    is_transparent: true,
  },

  // ── OBJECTS ──────────────────────────────────────────────────────────────
  {
    id: 'obj-gold-coin',
    title: 'Ancient Gold Coin',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['item', 'gold', 'currency'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/coin.png',
    uses_count: 5210,
    is_transparent: true,
  },
  {
    id: 'obj-health-potion',
    title: 'Crimson Health Elixir',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['potion', 'magic', 'health', 'item'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/bottle.png',
    uses_count: 3120,
    is_transparent: true,
  },
  {
    id: 'obj-diamond-gem',
    title: 'Radiant Blue Diamond',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['gem', 'diamond', 'treasure', 'item'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/crystal.png',
    uses_count: 4050,
    is_transparent: true,
  },
  {
    id: 'obj-energy-sword',
    title: 'Plasma Energy Blade',
    category: 'objects',
    style: 'style:3d_render',
    tags: ['weapon', 'sword', 'sci_fi'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Weapon/Models/PNG/sword.png',
    uses_count: 3890,
    is_transparent: true,
  },
  {
    id: 'obj-dynamite-bomb',
    title: 'TNT Cartoon Bomb',
    category: 'objects',
    style: 'style:cartoon',
    tags: ['weapon', 'toy', 'explosive', 'item'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/bomb.png',
    uses_count: 2780,
    is_transparent: true,
  },

  // ── BACKGROUNDS ──────────────────────────────────────────────────────────
  {
    id: 'bg-synthwave-grid',
    title: '80s Neon Sunset Grid',
    category: 'backgrounds',
    style: 'style:3d_render',
    tags: ['cyberpunk', 'retro', 'sky'],
    image_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
    uses_count: 4890,
    is_transparent: false,
  },
  {
    id: 'bg-deep-space',
    title: 'Orion Cosmic Nebula',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['nature', 'space', 'sky'],
    image_url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&auto=format&fit=crop&q=80',
    uses_count: 3670,
    is_transparent: false,
  },
  {
    id: 'bg-cyberpunk-alley',
    title: 'Rainy Cyber City',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['cyberpunk', 'interior', 'urban'],
    image_url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&auto=format&fit=crop&q=80',
    uses_count: 2950,
    is_transparent: false,
  },
  {
    id: 'bg-spooky-dungeon',
    title: 'Gothic Castle Crypt',
    category: 'backgrounds',
    style: 'style:realistic',
    tags: ['interior', 'horror', 'liminal_space'],
    image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    uses_count: 2120,
    is_transparent: false,
  },

  // ── ICONS & UI ───────────────────────────────────────────────────────────
  {
    id: 'icon-heart-health',
    title: 'Glossy Heart Container',
    category: 'icons',
    style: 'style:3d_render',
    tags: ['symbol', 'badge', 'action'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/heart.png',
    uses_count: 6100,
    is_transparent: true,
  },
  {
    id: 'icon-joystick-dpad',
    title: 'Arcade D-Pad Controller',
    category: 'ui',
    style: 'style:realistic',
    tags: ['hud', 'joystick', 'button'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/cross.png',
    uses_count: 3450,
    is_transparent: true,
  },
  {
    id: 'icon-lightning-drift',
    title: 'Turbo Drift Spark',
    category: 'effects',
    style: 'style:3d_render',
    tags: ['sparkle', 'magic', 'action'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/star.png',
    uses_count: 2990,
    is_transparent: true,
  },
  {
    id: 'icon-crosshair',
    title: 'Sniper Reticle HUD',
    category: 'ui',
    style: 'style:realistic',
    tags: ['hud', 'frame', 'action'],
    image_url: 'https://raw.githubusercontent.com/KenneyNL/Starter-Kits/master/3D/Survival/Models/PNG/circle.png',
    uses_count: 1890,
    is_transparent: true,
  }
];

export async function seedCommunityAssets() {
  const client = await pool.connect();
  try {
    console.log('🌱 [Seed] Ensuring community_assets table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS community_assets (
        id VARCHAR(100) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        style VARCHAR(50) DEFAULT 'style:realistic',
        tags TEXT[] DEFAULT '{}',
        image_url TEXT NOT NULL,
        thumbnail_url TEXT,
        uses_count INTEGER DEFAULT 0,
        creator_id UUID,
        is_transparent BOOLEAN DEFAULT TRUE,
        is_system BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_community_assets_cat_uses ON community_assets (category, uses_count DESC);
      CREATE INDEX IF NOT EXISTS idx_community_assets_uses ON community_assets (uses_count DESC);
      CREATE INDEX IF NOT EXISTS idx_community_assets_style ON community_assets (style);
      CREATE INDEX IF NOT EXISTS idx_community_assets_tags ON community_assets USING GIN (tags);
    `);

    console.log('🌱 [Seed] Seeding community assets library...');
    for (const a of SEED_ASSETS) {
      await client.query(`
        INSERT INTO community_assets (id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent, is_system)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          style = EXCLUDED.style,
          tags = EXCLUDED.tags,
          image_url = EXCLUDED.image_url,
          thumbnail_url = EXCLUDED.thumbnail_url,
          uses_count = EXCLUDED.uses_count,
          is_transparent = EXCLUDED.is_transparent;
      `, [
        a.id,
        a.title,
        a.category,
        a.style,
        a.tags,
        a.image_url,
        a.thumbnail_url || a.image_url,
        a.uses_count || 100,
        a.is_transparent ?? true
      ]);
    }
    console.log(`✅ [Seed] Successfully seeded ${SEED_ASSETS.length} community assets!`);
  } catch (e) {
    console.error('❌ [Seed] Error seeding community assets:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('seed-community-assets.js')) {
  seedCommunityAssets().then(() => process.exit(0));
}
