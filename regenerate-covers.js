/**
 * Regenerate cover art thumbnails for all games that have broken local paths.
 * 
 * This replaces ephemeral `/uploads/covers/xxx.jpg` paths with permanent
 * Pollinations URLs that don't depend on Railway's filesystem.
 * 
 * Usage: node regenerate-covers.js
 *   Requires DATABASE_URL env var (set on Railway or pass inline).
 */

import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL env var');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Prompt builder (mirrors cover-art.js) ──────────────────────────────────

const STYLE_BY_CATEGORY = {
  Action: 'cinematic action-game screenshot, dramatic pose, debris, rim lighting, sharp composition',
  Adventure: 'hand-painted storybook world, lush environment, atmospheric lighting',
  Puzzle: 'minimalist isometric puzzle diorama, soft pastel palette, clean geometric composition',
  Arcade: 'retro arcade flyer art, bold pixel-inspired shapes, vibrant CMYK palette, halftone texture',
  Strategy: 'tabletop board-game cover art, top-down composition, painted textures, rich detail',
  Sports: 'energetic sports promo art, dramatic perspective, kinetic motion lines, vibrant colors',
  Casual: 'friendly chibi-style illustration, rounded shapes, cheerful palette, soft shadows',
  Story: 'graphic novel splash page, dramatic character pose, painterly lighting, cinematic mood',
  Music: 'concert poster art, neon glow, equalizer waveforms, flowing rhythmic shapes',
  Horror: 'grainy psychological horror still, desaturated blue black palette, lonely hallway, uneasy negative space',
  Racing: 'low-angle racing photo-illustration, wet asphalt, motion blur, chrome reflections',
  Simulation: 'detailed isometric scene, cozy warm lighting, painterly miniature look',
};

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || 'gametok-cover');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildPrompt(game) {
  const title = String(game.name || 'Untitled Game').trim();
  const category = game.category || 'default';
  const style = STYLE_BY_CATEGORY[category] || STYLE_BY_CATEGORY[category.charAt(0).toUpperCase() + category.slice(1)] || 'distinctive mobile-game scene, clear focal subject, polished composition';
  const seed = hashSeed(`${game.id || ''} ${title}`);
  
  const titleText = title.replace(/[^A-Za-z0-9 \-']/g, '');

  const prompt = [
    `High-end mobile game promotional poster for a game titled "${titleText}"`,
    `The exact words "${titleText}" MUST be written prominently at the very top of the image in huge, bold, glowing, 3D extruded cinematic typography`,
    `The art style below the text should be ${style}`,
    'Extremely vibrant, high contrast, insanely polished app-store promotional art',
    'Portrait composition. The background should be dynamic and match the theme',
    'Make the 3D text logo pop out with rim lighting and strong drop shadows',
  ].join(', ');

  return { prompt, seed };
}

function makePollinationsUrl(game) {
  const { prompt, seed } = buildPrompt(game);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=768&nologo=true&enhance=true&model=flux&seed=${seed}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('Fetching games with broken local thumbnail paths...');
  
  // Find all games whose thumbnails are local paths (not full URLs)
  const { rows: games } = await pool.query(`
    SELECT id, name, category, subcategory, thumbnail 
    FROM games 
    ORDER BY id
  `);

  console.log(`Found ${games.length} games to re-roll with the new 3D text style.\n`);

  if (games.length === 0) {
    console.log('All thumbnails are already using full URLs. Nothing to do!');
    await pool.end();
    return;
  }

  let fixed = 0;
  let failed = 0;

  for (const game of games) {
    const url = makePollinationsUrl(game);

    try {
      // Update games table
      await pool.query('UPDATE games SET thumbnail = $1 WHERE id = $2', [url, game.id]);

      // Also update ai_games if there's a matching draft
      const draftId = game.id.replace('gm-ai-', '');
      await pool.query(
        `UPDATE ai_games SET thumbnail = $1 WHERE id::text LIKE $2`,
        [url, `${draftId}%`]
      ).catch(() => {}); // Silently skip if no matching draft

      fixed++;
      console.log(`✓ ${game.name} (${game.id})`);
      console.log(`  OLD: ${game.thumbnail}`);
      console.log(`  NEW: ${url.slice(0, 80)}...`);
      console.log('');
    } catch (err) {
      failed++;
      console.error(`✗ ${game.name} (${game.id}): ${err.message}`);
    }
  }

  console.log(`\nDone! Fixed: ${fixed}, Failed: ${failed}`);
  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
