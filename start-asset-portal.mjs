import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import adminAssetsRouter from './src/ai-engine/asset-engine/admin/admin-assets-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Admin UI and API
app.use('/admin/assets', adminAssetsRouter);
app.use('/api/admin/assets', adminAssetsRouter);
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// Root redirect to Admin UI
app.get('/', (req, res) => {
    res.redirect('/admin/assets');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎉 ========================================================`);
    console.log(`👤 GameTok Admin Character Rigger & Asset Engine is LIVE!`);
    console.log(`👉 Open: http://localhost:${PORT}/admin/assets`);
    console.log(`========================================================\n`);
});
