import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const BASE_RAW = 'https://raw.githubusercontent.com/marpor/PixelAdventure/master/PixelAdventure';

// Pixel Frog complete pack items
export const PIXEL_FROG_ASSETS = [
  // ── MAIN HEROES ──
  {
    id: 'asset-pixelfrog-ninja-frog-idle',
    title: 'Ninja Frog (Idle)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'ninja_frog', 'hero', 'player', 'ninja', 'frog', 'platformer'],
    image_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Idle%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Idle%20(32x32).png`,
    uses_count: 650,
  },
  {
    id: 'asset-pixelfrog-ninja-frog-run',
    title: 'Ninja Frog (Run)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'ninja_frog', 'hero', 'runner', 'ninja', 'frog'],
    image_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Run%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Run%20(32x32).png`,
    uses_count: 590,
  },
  {
    id: 'asset-pixelfrog-ninja-frog-jump',
    title: 'Ninja Frog (Jump)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'ninja_frog', 'hero', 'jump', 'ninja', 'frog'],
    image_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Jump%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Ninja%20Frog/Jump%20(32x32).png`,
    uses_count: 510,
  },
  {
    id: 'asset-pixelfrog-pink-man-idle',
    title: 'Pink Man (Idle)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pink_man', 'hero', 'player', 'retro'],
    image_url: `${BASE_RAW}/Main%20Characters/Pink%20Man/Idle%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Pink%20Man/Idle%20(32x32).png`,
    uses_count: 480,
  },
  {
    id: 'asset-pixelfrog-pink-man-run',
    title: 'Pink Man (Run)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pink_man', 'hero', 'runner', 'retro'],
    image_url: `${BASE_RAW}/Main%20Characters/Pink%20Man/Run%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Pink%20Man/Run%20(32x32).png`,
    uses_count: 420,
  },
  {
    id: 'asset-pixelfrog-mask-dude-idle',
    title: 'Masked Dude (Idle)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'mask_dude', 'hero', 'player', 'masked'],
    image_url: `${BASE_RAW}/Main%20Characters/Mask%20Dude/Idle%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Mask%20Dude/Idle%20(32x32).png`,
    uses_count: 460,
  },
  {
    id: 'asset-pixelfrog-mask-dude-run',
    title: 'Masked Dude (Run)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'mask_dude', 'hero', 'runner', 'masked'],
    image_url: `${BASE_RAW}/Main%20Characters/Mask%20Dude/Run%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Mask%20Dude/Run%20(32x32).png`,
    uses_count: 410,
  },
  {
    id: 'asset-pixelfrog-virtual-guy-idle',
    title: 'Virtual Guy (Idle)',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'virtual_guy', 'hero', 'player', 'scifi'],
    image_url: `${BASE_RAW}/Main%20Characters/Virtual%20Guy/Idle%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Main%20Characters/Virtual%20Guy/Idle%20(32x32).png`,
    uses_count: 390,
  },

  // ── ENEMIES ──
  {
    id: 'asset-pixelfrog-enemy-angry-pig',
    title: 'Angry Pig',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'pig', 'angry', 'mob', 'monster'],
    image_url: `${BASE_RAW}/Enemies/AngryPig/Idle%20(36x30).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/AngryPig/Idle%20(36x30).png`,
    uses_count: 530,
  },
  {
    id: 'asset-pixelfrog-enemy-chicken',
    title: 'Fast Chicken',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'chicken', 'bird', 'mob'],
    image_url: `${BASE_RAW}/Enemies/Chicken/Idle%20(32x34).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Chicken/Idle%20(32x34).png`,
    uses_count: 420,
  },
  {
    id: 'asset-pixelfrog-enemy-bunny',
    title: 'Jumping Bunny',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'bunny', 'rabbit', 'mob'],
    image_url: `${BASE_RAW}/Enemies/Bunny/Idle%20(34x44).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Bunny/Idle%20(34x44).png`,
    uses_count: 410,
  },
  {
    id: 'asset-pixelfrog-enemy-chameleon',
    title: 'Tongue Chameleon',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'chameleon', 'lizard', 'mob'],
    image_url: `${BASE_RAW}/Enemies/Chameleon/Attack%20(84x38).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Chameleon/Attack%20(84x38).png`,
    uses_count: 375,
  },
  {
    id: 'asset-pixelfrog-enemy-ghost',
    title: 'Floaty Ghost',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'ghost', 'spooky', 'undead'],
    image_url: `${BASE_RAW}/Enemies/Ghost/Idle%20(44x30).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Ghost/Idle%20(44x30).png`,
    uses_count: 440,
  },
  {
    id: 'asset-pixelfrog-enemy-mushroom',
    title: 'Mushroom Spore',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'mushroom', 'fungus', 'mob'],
    image_url: `${BASE_RAW}/Enemies/Mushroom/Idle%20(32x32).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Mushroom/Idle%20(32x32).png`,
    uses_count: 405,
  },
  {
    id: 'asset-pixelfrog-enemy-plant-shooter',
    title: 'Spit Plant Shooter',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'plant', 'shooter', 'turret'],
    image_url: `${BASE_RAW}/Enemies/Plant/Attack%20(44x42).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Plant/Attack%20(44x42).png`,
    uses_count: 460,
  },
  {
    id: 'asset-pixelfrog-enemy-radish',
    title: 'Flying Radish',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'radish', 'veggie', 'flying'],
    image_url: `${BASE_RAW}/Enemies/Radish/Idle%201%20(30x38).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Radish/Idle%201%20(30x38).png`,
    uses_count: 350,
  },
  {
    id: 'asset-pixelfrog-enemy-rino',
    title: 'Charging Rhino',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'rhino', 'rino', 'charge', 'heavy'],
    image_url: `${BASE_RAW}/Enemies/Rino/Run%20(52x34).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Rino/Run%20(52x34).png`,
    uses_count: 420,
  },
  {
    id: 'asset-pixelfrog-enemy-slime',
    title: 'Bouncing Slime',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'slime', 'goo', 'bounce'],
    image_url: `${BASE_RAW}/Enemies/Slime/Idle-Run%20(44x30).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Slime/Idle-Run%20(44x30).png`,
    uses_count: 490,
  },
  {
    id: 'asset-pixelfrog-enemy-snail',
    title: 'Armored Snail',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'snail', 'shell', 'defense'],
    image_url: `${BASE_RAW}/Enemies/Snail/Walk%20(38x24).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Snail/Walk%20(38x24).png`,
    uses_count: 360,
  },
  {
    id: 'asset-pixelfrog-enemy-turtle',
    title: 'Spike Turtle',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'turtle', 'spikes', 'armor'],
    image_url: `${BASE_RAW}/Enemies/Turtle/Idle%201%20(44x26).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Turtle/Idle%201%20(44x26).png`,
    uses_count: 380,
  },
  {
    id: 'asset-pixelfrog-enemy-bat',
    title: 'Cavern Bat',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'bat', 'cave', 'flying'],
    image_url: `${BASE_RAW}/Enemies/Bat/Flying%20(46x30).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Bat/Flying%20(46x30).png`,
    uses_count: 395,
  },
  {
    id: 'asset-pixelfrog-enemy-bee',
    title: 'Stinger Bee',
    category: 'characters',
    style: 'style:pixel',
    tags: ['pixel_frog', 'enemy', 'bee', 'insect', 'flying'],
    image_url: `${BASE_RAW}/Enemies/Bee/Fly%20(36x34).png`,
    thumbnail_url: `${BASE_RAW}/Enemies/Bee/Fly%20(36x34).png`,
    uses_count: 370,
  },

  // ── FRUITS & COLLECTIBLES ──
  {
    id: 'asset-pixelfrog-fruit-apple',
    title: 'Pixel Apple',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'apple', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Apple.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Apple.png`,
    uses_count: 520,
  },
  {
    id: 'asset-pixelfrog-fruit-bananas',
    title: 'Pixel Bananas',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'banana', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Bananas.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Bananas.png`,
    uses_count: 480,
  },
  {
    id: 'asset-pixelfrog-fruit-cherries',
    title: 'Pixel Cherries',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'cherry', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Cherries.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Cherries.png`,
    uses_count: 495,
  },
  {
    id: 'asset-pixelfrog-fruit-kiwi',
    title: 'Pixel Kiwi',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'kiwi', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Kiwi.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Kiwi.png`,
    uses_count: 410,
  },
  {
    id: 'asset-pixelfrog-fruit-melon',
    title: 'Pixel Watermelon',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'melon', 'watermelon', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Melon.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Melon.png`,
    uses_count: 440,
  },
  {
    id: 'asset-pixelfrog-fruit-orange',
    title: 'Pixel Orange',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'orange', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Orange.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Orange.png`,
    uses_count: 430,
  },
  {
    id: 'asset-pixelfrog-fruit-pineapple',
    title: 'Pixel Pineapple',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'pineapple', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Pineapple.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Pineapple.png`,
    uses_count: 460,
  },
  {
    id: 'asset-pixelfrog-fruit-strawberry',
    title: 'Pixel Strawberry',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fruit', 'strawberry', 'food', 'collectible'],
    image_url: `${BASE_RAW}/Items/Fruits/Strawberry.png`,
    thumbnail_url: `${BASE_RAW}/Items/Fruits/Strawberry.png`,
    uses_count: 510,
  },

  // ── TRAPS & HAZARDS ──
  {
    id: 'asset-pixelfrog-trap-saw',
    title: 'Rotating Saw Blade',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'trap', 'saw', 'blade', 'hazard', 'obstacle'],
    image_url: `${BASE_RAW}/Traps/Saw/On%20(38x38).png`,
    thumbnail_url: `${BASE_RAW}/Traps/Saw/On%20(38x38).png`,
    uses_count: 470,
  },
  {
    id: 'asset-pixelfrog-trap-spikes',
    title: 'Floor Spikes',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'trap', 'spikes', 'hazard', 'obstacle'],
    image_url: `${BASE_RAW}/Traps/Spikes/Idle.png`,
    thumbnail_url: `${BASE_RAW}/Traps/Spikes/Idle.png`,
    uses_count: 505,
  },
  {
    id: 'asset-pixelfrog-trap-trampoline',
    title: 'Super Trampoline Jump Pad',
    category: 'objects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'trampoline', 'jump', 'spring', 'platform'],
    image_url: `${BASE_RAW}/Traps/Trampoline/Idle.png`,
    thumbnail_url: `${BASE_RAW}/Traps/Trampoline/Idle.png`,
    uses_count: 480,
  },
  {
    id: 'asset-pixelfrog-trap-fire',
    title: 'Flame Thrower Trap',
    category: 'effects',
    style: 'style:pixel',
    tags: ['pixel_frog', 'fire', 'flame', 'trap', 'hazard'],
    image_url: `${BASE_RAW}/Traps/Fire/On%20(16x32).png`,
    thumbnail_url: `${BASE_RAW}/Traps/Fire/On%20(16x32).png`,
    uses_count: 420,
  },

  // ── BACKGROUNDS ──
  {
    id: 'bg-pixelfrog-blue-tiling',
    title: 'Pixel Adventure Blue Sky',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pixel', 'sky', 'blue', 'tiling', 'platformer'],
    image_url: `${BASE_RAW}/Background/Blue.png`,
    thumbnail_url: `${BASE_RAW}/Background/Blue.png`,
    uses_count: 510,
  },
  {
    id: 'bg-pixelfrog-purple-tiling',
    title: 'Pixel Adventure Violet Sky',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pixel', 'sky', 'purple', 'tiling', 'platformer'],
    image_url: `${BASE_RAW}/Background/Purple.png`,
    thumbnail_url: `${BASE_RAW}/Background/Purple.png`,
    uses_count: 430,
  },
  {
    id: 'bg-pixelfrog-green-tiling',
    title: 'Pixel Adventure Lush Forest',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pixel', 'forest', 'green', 'tiling', 'nature'],
    image_url: `${BASE_RAW}/Background/Green.png`,
    thumbnail_url: `${BASE_RAW}/Background/Green.png`,
    uses_count: 420,
  },
  {
    id: 'bg-pixelfrog-yellow-tiling',
    title: 'Pixel Adventure Desert Sun',
    category: 'backgrounds',
    style: 'style:pixel',
    tags: ['pixel_frog', 'pixel', 'desert', 'yellow', 'tiling', 'sun'],
    image_url: `${BASE_RAW}/Background/Yellow.png`,
    thumbnail_url: `${BASE_RAW}/Background/Yellow.png`,
    uses_count: 380,
  },
];

async function main() {
  console.log(`🐸 Ingesting ${PIXEL_FROG_ASSETS.length} official Pixel Frog assets into PostgreSQL...`);
  const client = await pool.connect();
  try {
    let inserted = 0;
    for (const a of PIXEL_FROG_ASSETS) {
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
      inserted++;
    }
    console.log(`✅ Successfully ingested ${inserted} Pixel Frog platformer assets!`);

    const countRes = await client.query('SELECT count(*) FROM community_assets');
    console.log(`🎉 Total community catalog in PostgreSQL: ${countRes.rows[0].count} assets`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Ingestion failed:', err);
  process.exit(1);
});
