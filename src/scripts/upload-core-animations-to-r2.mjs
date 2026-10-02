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

const CORE_DIR = path.join(backendRoot, 'storage/animations/core');

async function uploadCoreAnimations() {
    console.log('🚀 Uploading core animations to R2...');
    const files = await fs.readdir(CORE_DIR);

    for (const file of files) {
        if (!file.endsWith('.glb')) continue;
        const filePath = path.join(CORE_DIR, file);
        const data = await fs.readFile(filePath);
        const r2Key = `animations/core/${file}`;

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2Key,
            Body: data,
            ContentType: 'model/gltf-binary',
        }));

        console.log(`✅ Uploaded: ${PUBLIC_URL}/${r2Key}`);
    }

    console.log('🎉 Core animations successfully uploaded to R2!');
}

uploadCoreAnimations().catch(err => {
    console.error('💥 Upload failed:', err);
    process.exit(1);
});
