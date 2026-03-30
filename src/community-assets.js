import express from 'express';
import multer from 'multer';
import path from 'path';
import pool from './db.js';
import crypto from 'crypto';

const router = express.Router();

// Setup Multer for User-Generated Assets
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max for meme video uploads
});

// Middleware to require authentication for uploads
const requireAuth = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const userResult = await pool.query('SELECT id FROM users WHERE token = $1', [token]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Expired session' });
        req.userId = userResult.rows[0].id;
        next();
    } catch(err) {
        res.status(500).json({ error: 'Auth failed' });
    }
};

// ============================================
// UPLOAD ASSET
// ============================================
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { type, title } = req.body; 
        if (!['video', 'sfx', 'bgm', 'image'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        // Construct public URL
        const hostname = req.hostname === 'localhost' ? 'http://localhost:3000' : 'https://gametok-backend-production.up.railway.app';
        const fileUrl = `${hostname}/uploads/${req.file.filename}`;

        // Optional thumbnail (would need ffmpeg for video, skipping for simplicity)
        const thumbUrl = (type === 'image') ? fileUrl : '';

        // Save to community database
        const insertRes = await pool.query(
            `INSERT INTO community_assets (user_id, type, url, thumbnail, title)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [req.userId, type, fileUrl, thumbUrl, title || 'Uploaded Asset']
        );

        res.json({ 
            success: true, 
            id: insertRes.rows[0].id,
            url: fileUrl,
            message: 'Meme instantly injected into the Global Hivemind.'
        });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ error: 'Failed to upload asset' });
    }
});

// ============================================
// FETCH TRENDING / RECENT ASSETS
// ============================================
router.get('/trending', async (req, res) => {
    try {
        const { type } = req.query;
        let query = `SELECT id, type, url, thumbnail, title, usage_count, created_at FROM community_assets`;
        let params = [];
        
        if (type) {
            query += ` WHERE type = $1`;
            params.push(type);
        }
        
        // Sorting by newest + usage_count
        query += ` ORDER BY usage_count DESC, created_at DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, assets: result.rows });
    } catch (err) {
        console.error("Trending error:", err);
        res.status(500).json({ error: 'Failed to fetch trending assets' });
    }
});

// Log asset usage
router.post('/:id/use', async (req, res) => {
    try {
        await pool.query('UPDATE community_assets SET usage_count = usage_count + 1 WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;
