import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SUNNYLAND_BASE = 'https://raw.githubusercontent.com/Kevin1321/DA_Module_12_SunnyLand/master/assets/sprites';
const GOTHIC_BASE = 'https://raw.githubusercontent.com/acatovic/gothicvania-codex-demo/master/assets';

export const ANSIMUZ_ASSETS = [
  // ── SUNNYLAND FOXY CHARACTER PACK ──
  {
    id: 'asset-ansimuz-foxy-idle-1',
    title: 'Foxy (Idle 1)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'player', 'idle'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-1.png`,
    uses_count: 580,
  },
  {
    id: 'asset-ansimuz-foxy-idle-2',
    title: 'Foxy (Idle 2)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'player', 'idle'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-2.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-2.png`,
    uses_count: 540,
  },
  {
    id: 'asset-ansimuz-foxy-idle-3',
    title: 'Foxy (Idle 3)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'player', 'idle'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-3.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-3.png`,
    uses_count: 520,
  },
  {
    id: 'asset-ansimuz-foxy-idle-4',
    title: 'Foxy (Idle 4)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'player', 'idle'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-4.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/idle/player-idle-4.png`,
    uses_count: 510,
  },
  {
    id: 'asset-ansimuz-foxy-run-1',
    title: 'Foxy (Run 1)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-1.png`,
    uses_count: 530,
  },
  {
    id: 'asset-ansimuz-foxy-run-2',
    title: 'Foxy (Run 2)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-2.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-2.png`,
    uses_count: 510,
  },
  {
    id: 'asset-ansimuz-foxy-run-3',
    title: 'Foxy (Run 3)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-3.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-3.png`,
    uses_count: 505,
  },
  {
    id: 'asset-ansimuz-foxy-run-4',
    title: 'Foxy (Run 4)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-4.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-4.png`,
    uses_count: 495,
  },
  {
    id: 'asset-ansimuz-foxy-run-5',
    title: 'Foxy (Run 5)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-5.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-5.png`,
    uses_count: 490,
  },
  {
    id: 'asset-ansimuz-foxy-run-6',
    title: 'Foxy (Run 6)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'runner', 'run'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-6.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/run/player-run-6.png`,
    uses_count: 485,
  },
  {
    id: 'asset-ansimuz-foxy-jump-1',
    title: 'Foxy (Jump Ascend)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'jump'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/jump/player-jump-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/jump/player-jump-1.png`,
    uses_count: 510,
  },
  {
    id: 'asset-ansimuz-foxy-jump-2',
    title: 'Foxy (Jump Fall)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'fall'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/jump/player-jump-2.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/jump/player-jump-2.png`,
    uses_count: 490,
  },
  {
    id: 'asset-ansimuz-foxy-hurt',
    title: 'Foxy (Hurt)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'hurt', 'damage'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/hurt/player-hurt-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/hurt/player-hurt-1.png`,
    uses_count: 460,
  },
  {
    id: 'asset-ansimuz-foxy-victory',
    title: 'Foxy (Victory Dance)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'victory', 'pose'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/Victory/player-victory-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/Victory/player-victory-1.png`,
    uses_count: 530,
  },
  {
    id: 'asset-ansimuz-foxy-roll',
    title: 'Foxy (Dodge Roll)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'foxy', 'fox', 'sunnyland', 'hero', 'roll', 'dodge'],
    image_url: `${SUNNYLAND_BASE}/characters/Foxy/Roll/player-roll-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Foxy/Roll/player-roll-1.png`,
    uses_count: 470,
  },

  // ── SUNNYLAND PICKUPS & ENEMIES ──
  {
    id: 'asset-ansimuz-cherry-pickup',
    title: 'SunnyLand Juicy Cherry',
    category: 'objects',
    style: 'style:pixel',
    tags: ['ansimuz', 'cherry', 'fruit', 'pickup', 'collectible', 'sunnyland'],
    image_url: `${SUNNYLAND_BASE}/PickUps/cherry/cherry-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/PickUps/cherry/cherry-1.png`,
    uses_count: 440,
  },
  {
    id: 'asset-ansimuz-gem-pickup',
    title: 'SunnyLand Diamond Gem',
    category: 'objects',
    style: 'style:pixel',
    tags: ['ansimuz', 'gem', 'diamond', 'pickup', 'collectible', 'sunnyland'],
    image_url: `${SUNNYLAND_BASE}/PickUps/gem/gem-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/PickUps/gem/gem-1.png`,
    uses_count: 420,
  },
  {
    id: 'asset-ansimuz-slimer-enemy',
    title: 'SunnyLand Cave Slimer',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'enemy', 'slime', 'slimer', 'mob', 'sunnyland'],
    image_url: `${SUNNYLAND_BASE}/characters/Slimer/idle/slimer-idle-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Slimer/idle/slimer-idle-1.png`,
    uses_count: 390,
  },
  {
    id: 'asset-ansimuz-vulture-enemy',
    title: 'SunnyLand Swoop Vulture',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'enemy', 'vulture', 'bird', 'flying', 'sunnyland'],
    image_url: `${SUNNYLAND_BASE}/characters/Vulture/vulture-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/characters/Vulture/vulture-1.png`,
    uses_count: 370,
  },
  {
    id: 'asset-ansimuz-enemy-poof',
    title: 'Enemy Defeat Cloud Poof',
    category: 'effects',
    style: 'style:pixel',
    tags: ['ansimuz', 'vfx', 'poof', 'cloud', 'smoke', 'fx', 'sunnyland'],
    image_url: `${SUNNYLAND_BASE}/VFX/enemy-death/enemy-death-1.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/VFX/enemy-death/enemy-death-1.png`,
    uses_count: 430,
  },
  {
    id: 'bg-ansimuz-sunnyland-woods',
    title: 'SunnyLand Pine Forest',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['ansimuz', 'sunnyland', 'forest', 'woods', 'trees', 'nature', 'platformer'],
    image_url: `${SUNNYLAND_BASE}/environments/Backgrounds/SunnyLandForest/background.png`,
    thumbnail_url: `${SUNNYLAND_BASE}/environments/Backgrounds/SunnyLandForest/background.png`,
    uses_count: 480,
  },

  // ── GOTHICVANIA PACK ──
  {
    id: 'asset-ansimuz-gothic-player',
    title: 'Gothicvania Dark Knight',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'gothicvania', 'knight', 'warrior', 'sword', 'gothic'],
    image_url: `${GOTHIC_BASE}/spritesheets/player.png`,
    thumbnail_url: `${GOTHIC_BASE}/spritesheets/player.png`,
    uses_count: 470,
  },
  {
    id: 'asset-ansimuz-gothic-wizard',
    title: 'Gothicvania Arcane Wizard',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'gothicvania', 'wizard', 'mage', 'magic', 'dark'],
    image_url: `${GOTHIC_BASE}/spritesheets/wizard.png`,
    thumbnail_url: `${GOTHIC_BASE}/spritesheets/wizard.png`,
    uses_count: 440,
  },
  {
    id: 'asset-ansimuz-gothic-ghoul',
    title: 'Gothicvania Burning Ghoul',
    category: 'characters',
    style: 'style:pixel',
    tags: ['ansimuz', 'gothicvania', 'ghoul', 'zombie', 'fire', 'undead', 'monster'],
    image_url: `${GOTHIC_BASE}/spritesheets/burning-ghoul.png`,
    thumbnail_url: `${GOTHIC_BASE}/spritesheets/burning-ghoul.png`,
    uses_count: 460,
  },
  {
    id: 'asset-ansimuz-gothic-fireball',
    title: 'Gothicvania Flaming Comet',
    category: 'effects',
    style: 'style:pixel',
    tags: ['ansimuz', 'gothicvania', 'fireball', 'magic', 'flame', 'projectile'],
    image_url: `${GOTHIC_BASE}/spritesheets/fireball.png`,
    thumbnail_url: `${GOTHIC_BASE}/spritesheets/fireball.png`,
    uses_count: 450,
  },
  {
    id: 'bg-ansimuz-gothic-church',
    title: 'Gothicvania Catacomb Ruins',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['ansimuz', 'gothicvania', 'church', 'catacomb', 'gothic', 'castle', 'night'],
    image_url: `${GOTHIC_BASE}/images/backgrounds/environment-preview.png`,
    thumbnail_url: `${GOTHIC_BASE}/images/backgrounds/environment-preview.png`,
    uses_count: 420,
  },
];

async function main() {
  console.log(`🦊 Ingesting ${ANSIMUZ_ASSETS.length} official Ansimuz assets...`);
  const client = await pool.connect();
  try {
    for (const a of ANSIMUZ_ASSETS) {
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
      `, [a.id, a.title, a.category, a.style, a.tags, a.image_url, a.thumbnail_url, a.uses_count, !a.id.startsWith('bg-')]);
    }

    // Cohort Ninja Frog frames specifically with 'ninja_frog' tag
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['ninja_frog', 'hero'])
      WHERE id LIKE '%ninja-frog%' OR title ILIKE '%ninja frog%';
    `);

    // Cohort Shmup Space Fleet specifically with 'shmup_fleet' tag
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['shmup_fleet', 'space_fleet'])
      WHERE id LIKE '%shmup%' OR id LIKE '%asteroids_ship%' OR id LIKE '%ufo%' OR title ILIKE '%shmup%';
    `);

    // Cohort Arcade Monsters specifically with 'arcade_monsters' tag
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['arcade_monsters'])
      WHERE id LIKE '%mummy%' OR id LIKE '%ghost%' OR id LIKE '%pacman%' OR id LIKE '%dragon%';
    `);

    // Cohort Platformer Enemies specifically with 'platform_enemies' tag
    await client.query(`
      UPDATE community_assets
      SET tags = array_cat(tags, ARRAY['platform_enemies'])
      WHERE tags && ARRAY['enemy'] AND tags && ARRAY['pixel_frog'];
    `);

    // Deduplicate all tags
    await client.query(`
      UPDATE community_assets
      SET tags = (
        SELECT ARRAY_AGG(DISTINCT t)
        FROM unnest(tags) AS t
      );
    `);

    const countRes = await client.query('SELECT count(*) FROM community_assets');
    console.log(`✅ Ansimuz ingested! Total community catalog in PostgreSQL: ${countRes.rows[0].count} assets`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Ingestion failed:', err);
  process.exit(1);
});
