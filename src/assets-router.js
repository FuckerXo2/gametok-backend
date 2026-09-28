import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { generateCoverArtImage } from './cover-art.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('sslmode=require') || process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('render.com'))) || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Define upload directories
const UPLOAD_ROOT = path.join(__dirname, '../public/uploads');
const ASSETS_JSON_PATH = path.join(UPLOAD_ROOT, 'community-assets.json');

['video', 'image', 'bgm', 'sfx'].forEach(type => {
  const dir = path.join(UPLOAD_ROOT, type);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || 'image';
    const dir = path.join(UPLOAD_ROOT, type);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// Category definitions with filter chips
const CATEGORIES = [
  { id: 'my_assets', label: 'My Assets', chips: [] },
  { id: 'trending', label: 'Trending', chips: [] },
  { id: 'packs', label: 'Packs', chips: ['ninja_frog', 'foxy', 'gothicvania', 'fighter', 'platform_enemies', 'space_fleet', 'arcade_monsters', 'food', 'furniture', 'minecraft', 'rpg', 'animals'] },
  { id: 'characters', label: 'Characters', chips: ['ninja_frog', 'foxy', 'gothicvania', 'fighter', 'platform_enemies', 'minecraft', 'arcade_monsters', 'animal', 'style:pixel', 'style:cartoon'] },
  { id: 'backgrounds', label: 'Backgrounds', chips: ['pixel', 'space', 'dungeon', 'cavern', 'sunset', 'cyberpunk'] },
  { id: 'objects', label: 'Objects', chips: ['fruit', 'food', 'furniture', 'weapon', 'space_fleet', 'loot', 'coin', 'gem', 'style:pixel'] },
  { id: 'icons', label: 'Icons', chips: ['medal', 'badge', 'star', 'achievement', 'action', 'symbol'] },
  { id: 'ui', label: 'UI', chips: ['hud', 'joystick', 'button', 'frame', 'heart'] },
  { id: 'effects', label: 'Effects', chips: ['explosion', 'fire', 'laser', 'sparkle', 'plasma', 'bullet'] },
  { id: 'portraits', label: 'Portraits', chips: ['hero', 'villain', 'monster', 'avatar'] }
];

// GET /api/assets/categories
router.get('/categories', (req, res) => {
  res.json({ success: true, categories: CATEGORIES });
});

// GET /api/assets
// Query params: category, style, tag, search, idsPrefix, creator_id, limit, offset
router.get('/', async (req, res) => {
  try {
    const { category, style, tag, search, idsPrefix, prefix, creator_id, limit = 30, offset = 0 } = req.query;
    const client = await pool.connect();

    try {
      let whereClauses = [];
      let queryParams = [];
      let paramIndex = 1;

      if (category && category !== 'trending' && category !== 'my_assets' && category !== 'packs') {
        whereClauses.push(`category = $${paramIndex++}`);
        queryParams.push(category);
      } else if (category === 'my_assets') {
        if (creator_id) {
          whereClauses.push(`creator_id = $${paramIndex++}`);
          queryParams.push(creator_id);
        } else {
          // If no creator_id provided, return empty for my_assets
          return res.json({ success: true, assets: [], total: 0, hasMore: false });
        }
      }

      if (style) {
        whereClauses.push(`style = $${paramIndex++}`);
        queryParams.push(style);
      }

      if (tag) {
        whereClauses.push(`$${paramIndex++} = ANY(tags)`);
        queryParams.push(tag);
      }

      const idFilter = idsPrefix || prefix;
      if (idFilter) {
        whereClauses.push(`id LIKE $${paramIndex++}`);
        queryParams.push(`${idFilter}%`);
      }

      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        whereClauses.push(`(LOWER(title) LIKE $${paramIndex} OR array_to_string(tags, ' ') ILIKE $${paramIndex})`);
        queryParams.push(searchTerm);
        paramIndex++;
      }

      const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      
      const countRes = await client.query(
        `SELECT COUNT(*) FROM community_assets ${whereSQL}`,
        queryParams
      );
      const total = parseInt(countRes.rows[0].count, 10);

      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
      const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

      const querySQL = `
        SELECT id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent, created_at
        FROM community_assets
        ${whereSQL}
        ORDER BY uses_count DESC, created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      const finalParams = [...queryParams, limitNum, offsetNum];
      const result = await client.query(querySQL, finalParams);

      return res.json({
        success: true,
        assets: result.rows,
        total,
        offset: offsetNum,
        limit: limitNum,
        hasMore: offsetNum + result.rows.length < total
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching community assets:', error);
    // Return empty list safely
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/assets/use
router.post('/use', async (req, res) => {
  const { assetId } = req.body;
  if (!assetId) {
    return res.status(400).json({ success: false, error: 'Missing assetId' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE community_assets SET uses_count = uses_count + 1 WHERE id = $1`,
        [assetId]
      );
      res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error updating asset uses_count:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/assets/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const type = req.body.type || 'image';
    const category = req.body.category || 'objects';
    const style = req.body.style || 'style:realistic';
    const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    const creatorId = req.body.creator_id || null;

    const serverUrl = req.protocol + '://' + req.get('host');
    const fileUrl = `${serverUrl}/uploads/${type}/${req.file.filename}`;

    const newAsset = {
      id: `user-asset-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title,
      category,
      style,
      tags: req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags]) : ['user_upload'],
      image_url: fileUrl,
      thumbnail_url: fileUrl,
      uses_count: 1,
      creator_id: creatorId,
      is_transparent: true,
      is_system: false,
    };

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO community_assets (id, title, category, style, tags, image_url, thumbnail_url, uses_count, creator_id, is_transparent, is_system)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
      `, [
        newAsset.id,
        newAsset.title,
        newAsset.category,
        newAsset.style,
        newAsset.tags,
        newAsset.image_url,
        newAsset.thumbnail_url,
        newAsset.uses_count,
        newAsset.creator_id,
        newAsset.is_transparent
      ]);
    } finally {
      client.release();
    }

    res.json({ success: true, asset: newAsset });
  } catch (error) {
    console.error('Asset Upload Error:', error);
    res.status(500).json({ success: false, error: 'Failed to process asset upload' });
  }
});

// POST /api/assets/generate
// Generate an asset sticker with AI prompt
router.post('/generate', async (req, res) => {
  try {
    const { prompt, category = 'objects', style = 'style:3d_render', creator_id = null } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    const enhancedPrompt = `${prompt.trim()}, isolated sticker cutout on solid white background, vibrant colors, game asset sprite, high resolution`;
    
    // Generate image via AI art director
    const imageUrl = await generateCoverArtImage({ rawPrompt: enhancedPrompt, prefix: 'assets' });
    if (!imageUrl) {
      return res.status(500).json({ success: false, error: 'Failed to generate asset image' });
    }

    const newAsset = {
      id: `ai-asset-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: prompt.trim().slice(0, 40),
      category,
      style,
      tags: ['ai_generated', category],
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      uses_count: 1,
      creator_id,
      is_transparent: true,
      is_system: false,
    };

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO community_assets (id, title, category, style, tags, image_url, thumbnail_url, uses_count, creator_id, is_transparent, is_system)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
      `, [
        newAsset.id,
        newAsset.title,
        newAsset.category,
        newAsset.style,
        newAsset.tags,
        newAsset.image_url,
        newAsset.thumbnail_url,
        newAsset.uses_count,
        newAsset.creator_id,
        newAsset.is_transparent
      ]);
    } finally {
      client.release();
    }

    res.json({ success: true, asset: newAsset });
  } catch (error) {
    console.error('Asset Generate Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Asset generation failed' });
  }
});

// Backward compatibility for /api/assets/trending
router.get('/trending', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, title, category, style, tags, image_url, thumbnail_url, uses_count, is_transparent
         FROM community_assets
         ORDER BY uses_count DESC
         LIMIT 40`
      );
      res.json({ success: true, assets: result.rows, total: result.rows.length });
    } finally {
      client.release();
    }
  } catch (e) {
    res.json({ success: true, assets: [], total: 0 });
  }
});

export default router;
