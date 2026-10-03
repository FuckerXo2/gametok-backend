import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../../');

dotenv.config({ path: path.join(backendRoot, '.env') });

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET_NAME) {
    console.error('❌ Missing R2 credentials in .env file');
    process.exit(1);
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
    },
});

const uploads = [
    {
        local: path.join(backendRoot, 'storage/models3d/rigged/scorpion_rigged.glb'),
        r2Key: 'characters/scorpion_rigged.glb',
    },
    {
        local: path.join(backendRoot, 'storage/models3d/rigged/hal_jordan_green_lantern_rigged.glb'),
        r2Key: 'characters/hal_jordan_green_lantern_rigged.glb',
    },
    {
        local: path.join(backendRoot, 'storage/characters/scorpion.glb'),
        r2Key: 'characters/scorpion.glb',
    },
    {
        local: path.join(backendRoot, 'storage/characters/hal_jordan_green_lantern.glb'),
        r2Key: 'characters/hal_jordan_green_lantern.glb',
    },
];

async function uploadModels() {
    console.log('🚀 Uploading 3D character models to R2...');
    for (const item of uploads) {
        try {
            const data = await fs.readFile(item.local);
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: item.r2Key,
                Body: data,
                ContentType: 'model/gltf-binary',
            }));
            console.log(`✅ Uploaded: ${PUBLIC_URL}/${item.r2Key} (${(data.length / 1024).toFixed(1)} KB)`);
        } catch (e) {
            console.error(`❌ Failed to upload ${item.local}:`, e.message);
        }
    }
    console.log('🎉 3D character models successfully uploaded to R2!');
}

uploadModels().catch(err => {
    console.error('💥 Upload failed:', err);
    process.exit(1);
});
