#!/usr/bin/env node
/**
 * Auto-upload assets to R2 on Railway deployment
 * This runs during Railway startup if R2 is configured
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, '../public/assets');
const R2_PREFIX = 'assets/';

// Check if R2 is configured
if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
  console.log('⊘ R2 not configured, skipping asset upload');
  process.exit(0);
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (stat.isFile()) {
      const relativePath = path.relative(baseDir, fullPath);
      files.push({
        localPath: fullPath,
        remotePath: relativePath.replace(/\\/g, '/'),
        size: stat.size,
      });
    }
  }
  
  return files;
}

async function uploadFile(localPath, remotePath) {
  const key = R2_PREFIX + remotePath;
  
  try {
    const fileContent = fs.readFileSync(localPath);
    const mimeType = getMimeType(localPath);

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000',
    }));

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function uploadBatch(files, concurrency = 20) {
  let uploaded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(f => uploadFile(f.localPath, f.remotePath))
    );

    results.forEach((r, idx) => {
      if (r.success) {
        uploaded++;
      } else {
        failed++;
        console.error(`✗ ${batch[idx].remotePath}: ${r.error}`);
      }
    });

    const progress = Math.min(i + concurrency, files.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📤 Uploaded ${progress}/${files.length} (${elapsed}s)`);
  }

  return { uploaded, failed };
}

async function main() {
  console.log('🚀 Uploading assets to Cloudflare R2...');
  console.log(`📦 Bucket: ${process.env.R2_BUCKET_NAME}`);

  if (!fs.existsSync(ASSETS_DIR)) {
    console.log('⚠️  Assets directory not found, skipping');
    process.exit(0);
  }

  const files = getAllFiles(ASSETS_DIR);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  console.log(`📁 Found ${files.length} files (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);

  const { uploaded, failed } = await uploadBatch(files);

  const duration = ((Date.now() - Date.now()) / 1000).toFixed(1);
  console.log(`✅ Upload complete: ${uploaded} succeeded, ${failed} failed`);
  
  const publicUrl = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
  console.log(`🌐 Assets live at: ${publicUrl}/${R2_PREFIX}`);
}

main().catch(error => {
  console.error('❌ Upload failed:', error);
  // Don't exit with error - assets can still be served from Railway
  process.exit(0);
});
