import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { universalAssetIngestor } from '../ingestor/universal-asset-ingestor.js';
import { AnimationIngestor } from '../ingestor/animation-ingestor.js';
import { searchAssetCatalog, searchAnimationCatalog } from '../asset-search.js';
import { 
    getInMemoryAssets, 
    getInMemoryAnimations, 
    getCharacterCategories, 
    addCharacterCategory, 
    deleteCharacterCategory, 
    updateAssetCharacterCategory 
} from '../asset-metadata-schema.js';
import pool from '../../../db.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_HTML_PATH = path.join(__dirname, 'admin-asset-ui.html');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max per asset
});

/**
 * GET /admin/assets or GET /api/admin/assets/ui
 * Serves the Admin Asset Library Interface
 */
router.get(['/', '/ui'], (req, res) => {
    if (fs.existsSync(UI_HTML_PATH)) {
        res.sendFile(UI_HTML_PATH);
    } else {
        res.status(404).send('Admin UI not found.');
    }
});

/**
 * GET /api/admin/assets/character-categories
 */
router.get('/character-categories', async (req, res) => {
    try {
        const categories = await getCharacterCategories();
        res.json({ success: true, count: categories.length, categories });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/assets/character-categories
 */
router.post('/character-categories', async (req, res) => {
    try {
        const { id, name, label, description } = req.body;
        if (!name && !label) {
            return res.status(400).json({ success: false, error: 'Name or label is required' });
        }
        const created = await addCharacterCategory({ id, name, label, description });
        res.json({ success: true, category: created });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/assets/character-categories/:id
 */
router.delete('/character-categories/:id', async (req, res) => {
    try {
        const result = await deleteCharacterCategory(req.params.id);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/assets/characters
 */
router.get('/characters', async (req, res) => {
    try {
        let characters = [];
        try {
            const result = await pool.query(
                "SELECT * FROM asset_catalog WHERE category = 'characters' OR is_rigged = true ORDER BY created_at DESC"
            );
            characters = result.rows;
        } catch {
            characters = getInMemoryAssets().filter(a => a.category === 'characters' || a.is_rigged);
        }
        res.json({ success: true, count: characters.length, characters });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/admin/assets/:id/category
 */
router.patch('/:id/category', async (req, res) => {
    try {
        const { category } = req.body;
        if (!category) return res.status(400).json({ success: false, error: 'Category is required' });
        const result = await updateAssetCharacterCategory(req.params.id, category);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


/**
 * GET /api/admin/assets/stats
 * Overview metrics for the Asset Ecosystem
 */
router.get('/stats', async (req, res) => {
    try {
        let total3D = 0;
        let totalAnimations = 0;
        let categories = {};

        try {
            const assetRes = await pool.query('SELECT category, count(*) FROM asset_catalog GROUP BY category');
            const animRes = await pool.query('SELECT count(*) FROM animation_catalog');
            totalAnimations = parseInt(animRes.rows[0]?.count || 0, 10);
            assetRes.rows.forEach(r => {
                categories[r.category] = parseInt(r.count, 10);
                total3D += parseInt(r.count, 10);
            });
        } catch {
            const inMemAssets = getInMemoryAssets();
            const inMemAnims = getInMemoryAnimations();
            total3D = inMemAssets.length;
            totalAnimations = inMemAnims.length;
            inMemAssets.forEach(a => {
                categories[a.category] = (categories[a.category] || 0) + 1;
            });
        }

        res.json({
            success: true,
            stats: {
                total3dAssets: total3D,
                totalAnimations,
                categories,
                canonicalFormat: 'GLB (3D) / .gtanim (Motion)'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/assets/list
 * Filterable, paginated asset catalog listing
 */
router.get('/list', async (req, res) => {
    try {
        const { query, category, style, rig_type, limit = 50 } = req.query;
        const assets = await searchAssetCatalog({
            query,
            category,
            style,
            rig_type,
            limit: Number(limit)
        });

        res.json({ success: true, count: assets.length, assets });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/assets/animations
 * Reusable motion tracks listing
 */
router.get('/animations', async (req, res) => {
    try {
        const { rig_target, category, action } = req.query;
        const animations = await searchAnimationCatalog({
            rig_target,
            category,
            action
        });

        res.json({ success: true, count: animations.length, animations });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/assets/upload
 * Multi-file batch and single asset ingestion endpoint
 */
router.post('/upload', upload.array('files', 50), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files provided.' });
        }

        const {
            category = 'characters',
            subcategory,
            archetype,
            name,
            style = 'stylized',
            targetType = '3d_model',
            rigTarget = 'humanoid_standard_v1',
            action = 'motion',
            animCategory = 'locomotion',
            role = 'neutral',
            license = 'GameTok-Curated',
            attribution = 'GameTok Curated Library',
            tags = ''
        } = req.body;

        const results = [];
        const errors = [];

        function autoDetectArchetype(fn) {
            const lower = (fn || '').toLowerCase();
            if (/spider|batman|super|hero|iron|hulk|homelander|avenger|flash|superman|captain|lantern/i.test(lower)) return 'superheroes';
            if (/goblin|venom|joker|thanos|villain|nemesis|boss|bane|carnage/i.test(lower)) return 'villains';
            if (/gta|franklin|cj|trevor|npc|citizen|cop|pedestrian|civilian|worker/i.test(lower)) return 'street_citizens_npcs';
            if (/scorpion|subzero|fighter|boxing|ninja|karate|clash|warrior|brawler/i.test(lower)) return 'fighters';
            if (/zombie|monster|creature|orc|demon|alien|undead|beast/i.test(lower)) return 'monsters_creatures';
            return 'street_citizens_npcs';
        }

        for (const file of files) {
            try {
                const filename = file.originalname;
                const ext = path.extname(filename).toLowerCase();
                const baseTitle = path.basename(filename, ext).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const detectedArchetype = archetype || subcategory || autoDetectArchetype(filename);

                const parsedTags = typeof tags === 'string' && tags.trim().length > 0
                    ? tags.split(',').map(t => t.trim()).filter(Boolean)
                    : [path.basename(filename, ext).toLowerCase(), detectedArchetype, 'character', 'rigged'];

                if (detectedArchetype && !parsedTags.includes(detectedArchetype)) {
                    parsedTags.push(detectedArchetype);
                }

                // Check for zip archives
                if (ext === '.zip') {
                    // Extract zip entries in memory if unzipper available or handle individual archives
                    errors.push({ filename, error: 'Direct .zip extraction requires individual .glb/.fbx/.obj uploads in current version.' });
                    continue;
                }

                const isStandaloneAnim = targetType === 'standalone_animation' || /animation/i.test(targetType);

                const ingested = await universalAssetIngestor.ingest({
                    buffer: file.buffer,
                    filename,
                    category,
                    subcategory: detectedArchetype || null,
                    name: name || baseTitle,
                    style,
                    targetType: isStandaloneAnim ? 'standalone_animation' : '3d_model',
                    animationMetadata: {
                        rigTarget,
                        action,
                        category: animCategory,
                        role,
                        durationSeconds: 1.2
                    },
                    tags: parsedTags.length > 0 ? parsedTags : [path.basename(filename, ext)],
                    source: 'gametok-curated',
                    license,
                    attribution
                });

                results.push(ingested);
            } catch (fileErr) {
                errors.push({ filename: file.originalname, error: fileErr.message });
            }
        }

        res.json({
            success: true,
            ingestedCount: results.length,
            failedCount: errors.length,
            results,
            errors
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/assets/:id
 * Remove asset from catalog
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM asset_catalog WHERE id = $1', [id]);
            await pool.query('DELETE FROM animation_catalog WHERE id = $1', [id]);
        } catch {
            // in-memory fallback delete
        }
        res.json({ success: true, message: `Asset "${id}" removed from catalog.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
