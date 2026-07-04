import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '../public/assets');
const CATALOG_PATH = path.join(__dirname, '../src/ai-engine/phaser2d/catalog.json');

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET = process.env.R2_BUCKET_NAME;

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

const filesToUpload = new Set();

catalog.atlases.forEach(a => {
    if (a.texture) filesToUpload.add(a.texture);
    if (a.data) filesToUpload.add(a.data);
});

catalog.tilemaps.forEach(t => {
    if (t.data) filesToUpload.add(t.data);
    if (t.tilesets) {
        t.tilesets.forEach(ts => {
            if (ts.image) filesToUpload.add(ts.image);
        });
    }
});

catalog.audio.forEach(a => {
    if (a.files) a.files.forEach(f => filesToUpload.add(f));
});

catalog.backgrounds.forEach(b => {
    if (b.file) filesToUpload.add(b.file);
});

catalog.sprites.forEach(s => {
    if (s.file) filesToUpload.add(s.file);
});

const filesArray = Array.from(filesToUpload);
console.log(`Prepared ${filesArray.length} specific catalog files for upload...`);

function getContentType(ext) {
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.json') return 'application/json';
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.ogg') return 'audio/ogg';
    if (ext === '.wav') return 'audio/wav';
    if (ext === '.m4a') return 'audio/mp4';
    return 'application/octet-stream';
}

async function uploadFile(relPath) {
    const fullPath = path.join(ASSETS_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
        console.warn(`File missing locally: ${relPath}`);
        return;
    }
    
    const ext = path.extname(relPath).toLowerCase();
    const contentType = getContentType(ext);
    const body = fs.readFileSync(fullPath);
    const r2Key = `phaser2d/${relPath}`;

    try {
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: r2Key,
            Body: body,
            ContentType: contentType,
        }));
        console.log(`Uploaded: ${r2Key}`);
    } catch (err) {
        console.error(`Failed to upload ${r2Key}:`, err.message);
    }
}

async function main() {
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET_NAME) {
        console.error("Missing R2 credentials in environment (.env).");
        process.exit(1);
    }
    
    // Upload with concurrency of 10
    const concurrency = 10;
    let i = 0;
    
    const worker = async () => {
        while (i < filesArray.length) {
            const index = i++;
            await uploadFile(filesArray[index]);
        }
    };
    
    const workers = [];
    for (let w = 0; w < concurrency; w++) {
        workers.push(worker());
    }
    
    await Promise.all(workers);
    console.log("All cataloged Phaser assets uploaded successfully!");
}

main().catch(console.error);
