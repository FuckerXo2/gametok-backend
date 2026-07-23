import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Define upload directories
const UPLOAD_ROOT = path.join(__dirname, '../public/uploads');
const ASSETS_JSON_PATH = path.join(UPLOAD_ROOT, 'community-assets.json');

// Ensure directories exist
['video', 'image', 'bgm', 'sfx'].forEach(type => {
  const dir = path.join(UPLOAD_ROOT, type);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Removed static cache, now read dynamically per request
const getCommunityAssets = () => {
  if (fs.existsSync(ASSETS_JSON_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, 'utf-8'));
    } catch (e) {
      console.error('Failed to load community assets:', e);
    }
  }
  return [];
};

const saveAssetsToDisk = (assets) => {
    fs.writeFileSync(ASSETS_JSON_PATH, JSON.stringify(assets, null, 2));
};

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || 'image'; // from formData
    const dir = path.join(UPLOAD_ROOT, type);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });

// POST /api/assets/upload
// Handles uploading from the frontend
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const type = req.body.type || 'image';
    const serverUrl = req.protocol + '://' + req.get('host'); // e.g. http://localhost:3000
    const fileUrl = `${serverUrl}/uploads/${type}/${req.file.filename}`;

    const newAsset = {
      id: Date.now().toString(),
      type: type,
      url: fileUrl,
      title: req.body.title || req.file.originalname,
      label: req.body.title || req.file.originalname,
      duration: '00:03', // default mock duration for audio
      instruction: type === 'bgm' ? `Set the game background music to this URL: ${fileUrl}` 
                 : type === 'sfx' ? `Add a sound effect using this URL: ${fileUrl}` 
                 : `Use this media asset: ${fileUrl}`
    };

    const communityAssets = getCommunityAssets();
    communityAssets.unshift(newAsset); // Add to beginning of array
    saveAssetsToDisk(communityAssets);

    res.json({ success: true, asset: newAsset });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, error: 'Failed to process upload' });
  }
});

router.get('/trending', (req, res) => {
  const communityAssets = getCommunityAssets();
  const type = req.query.type;

  // Filter by type (audio = bgm + sfx). No type = everything.
  let list;
  if (!type) {
    list = communityAssets;
  } else if (type === 'audio') {
    list = communityAssets.filter((a) => a.type === 'bgm' || a.type === 'sfx');
  } else {
    list = communityAssets.filter((a) => a.type === type);
  }

  const total = list.length;

  // Optional pagination. Without ?limit the full list is returned, so existing
  // callers (and old app builds) are unaffected.
  const limit = parseInt(req.query.limit, 10);
  const offset = parseInt(req.query.offset, 10) || 0;
  if (Number.isFinite(limit) && limit > 0) {
    const page = list.slice(offset, offset + limit);
    return res.json({
      success: true,
      assets: page,
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
    });
  }

  res.json({ success: true, assets: list, total });
});

export default router;
