#!/usr/bin/env node
/**
 * Upload Professional Asset Catalog to Cloudflare R2
 * 
 * This script uploads the 2,651 curated assets from /public/assets/ to R2
 * with progress tracking, retry logic, and catalog metadata.
 * 
 * Usage:
 *   node upload-catalog-to-r2.js --dry-run              # Preview what will be uploaded
 *   node upload-catalog-to-r2.js                        # Upload all assets
 *   node upload-catalog-to-r2.js --prefix sprites/      # Upload only sprites folder
 * 
 * Environment Variables Required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCatalog } from './src/ai-engine/load-catalog.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const ASSETS_DIR = path.join(__dirname, 'public/assets');
const R2_PREFIX = 'assets/'; // Upload to assets/ folder in R2

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');
const prefixArg = args.find(arg => arg.startsWith('--prefix='));
const filterPrefix = prefixArg ? prefixArg.split('=')[1] : '';

/**
 * Get MIME type for file
 */
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

/**
 * Check if file already exists in R2
 */
async function fileExists(key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Upload a single file to R2
 */
async function uploadFile(localPath, remotePath) {
  const key = R2_PREFIX + remotePath;

  // Skip if already exists (optional)
  if (skipExisting && await fileExists(key)) {
    return { success: true, skipped: true, path: remotePath };
  }

  try {
    const fileContent = fs.readFileSync(localPath);
    const mimeType = getMimeType(localPath);

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    }));

    return { success: true, skipped: false, path: remotePath, size: fileContent.length };
  } catch (error) {
    return { success: false, skipped: false, path: remotePath, error: error.message };
  }
}

/**
 * Get all files from catalog
 */
function getFilesFromCatalog() {
  const catalog = getCatalog();
  const files = [];

  catalog.assets.forEach(asset => {
    const localPath = path.join(ASSETS_DIR, asset.path);
    
    // Filter by prefix if specified
    if (filterPrefix && !asset.path.startsWith(filterPrefix)) {
      return;
    }

    if (fs.existsSync(localPath)) {
      files.push({
        localPath,
        remotePath: asset.path,
        type: asset.type,
        themes: asset.themes,
        metadata: asset.metadata,
      });

      // For spritesheets, also upload the JSON file
      if (asset.type === 'spritesheet' || asset.type === 'spritesheet_data') {
        const jsonPath = localPath.replace(/\.(png|jpg|jpeg)$/i, '.json');
        const jsonRemotePath = asset.path.replace(/\.(png|jpg|jpeg)$/i, '.json');
        
        if (fs.existsSync(jsonPath)) {
          files.push({
            localPath: jsonPath,
            remotePath: jsonRemotePath,
            type: 'spritesheet_data',
            themes: asset.themes,
            metadata: {},
          });
        }
      }
    }
  });

  return files;
}

/**
 * Upload files in parallel batches
 */
async function uploadBatch(files, concurrency = 20) {
  const results = {
    success: 0,
    skipped: 0,
    failed: 0,
    totalSize: 0,
    errors: [],
  };

  const startTime = Date.now();

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const promises = batch.map(file => uploadFile(file.localPath, file.remotePath));
    const batchResults = await Promise.all(promises);

    batchResults.forEach(result => {
      if (result.success) {
        if (result.skipped) {
          results.skipped++;
          console.log(`⊘ ${result.path} (already exists)`);
        } else {
          results.success++;
          results.totalSize += result.size || 0;
          console.log(`✓ ${result.path} (${formatBytes(result.size)})`);
        }
      } else {
        results.failed++;
        results.errors.push({ path: result.path, error: result.error });
        console.error(`✗ ${result.path}: ${result.error}`);
      }
    });

    // Progress
    const progress = Math.min(i + concurrency, files.length);
    const percentage = Math.round((progress / files.length) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (progress / elapsed).toFixed(1);
    
    console.log(`\n📊 Progress: ${progress}/${files.length} (${percentage}%) | ${elapsed}s elapsed | ${rate} files/sec\n`);
  }

  return results;
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Upload catalog.json
 */
async function uploadCatalogFile() {
  const catalogPath = path.join(__dirname, 'src/ai-engine/phaser-cdn-catalog.json');
  
  if (!fs.existsSync(catalogPath)) {
    console.warn('⚠️  Catalog file not found, skipping');
    return;
  }

  console.log('\n📋 Uploading catalog metadata...');
  
  const result = await uploadFile(catalogPath, 'phaser-cdn-catalog.json');
  
  if (result.success) {
    console.log(`✓ Catalog metadata uploaded (${formatBytes(result.size)})`);
  } else {
    console.error(`✗ Failed to upload catalog: ${result.error}`);
  }
}

/**
 * Main function
 */
async function main() {
  // Validate credentials
  if (!BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
    console.error('❌ R2 credentials not configured');
    console.error('Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  console.log('🚀 Professional Asset Catalog Upload to R2\n');
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`📁 Local: ${ASSETS_DIR}`);
  console.log(`☁️  Remote: ${R2_PREFIX}`);
  
  if (filterPrefix) {
    console.log(`🔍 Filter: ${filterPrefix}`);
  }
  
  if (skipExisting) {
    console.log(`⊘ Skip existing files: enabled`);
  }

  // Get files from catalog
  console.log('\n📊 Loading asset catalog...');
  const files = getFilesFromCatalog();

  if (files.length === 0) {
    console.log('✅ No files to upload (filter matched 0 assets)');
    return;
  }

  // Calculate total size
  const totalSize = files.reduce((sum, file) => {
    try {
      return sum + fs.statSync(file.localPath).size;
    } catch {
      return sum;
    }
  }, 0);

  console.log(`\n📦 Found ${files.length.toLocaleString()} files (${formatBytes(totalSize)})`);

  // Show breakdown by type
  const byType = {};
  files.forEach(file => {
    byType[file.type] = (byType[file.type] || 0) + 1;
  });

  console.log('\n📊 Breakdown by type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  // Dry run mode
  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No files will be uploaded');
    console.log('\n📄 Sample files (first 20):');
    files.slice(0, 20).forEach(file => {
      console.log(`  ${file.remotePath}`);
    });
    if (files.length > 20) {
      console.log(`  ... and ${(files.length - 20).toLocaleString()} more files`);
    }
    console.log(`\n⚠️  To actually upload these files, run without --dry-run flag`);
    return;
  }

  // Confirm upload
  console.log('\n⚠️  Ready to upload to R2!');
  console.log(`   This will upload ${files.length.toLocaleString()} files (${formatBytes(totalSize)})`);
  console.log(`   Estimated time: ~${Math.ceil(files.length / 20)}s at 20 files/sec\n`);

  // Start upload
  console.log('🚀 Starting upload...\n');
  const startTime = Date.now();
  const results = await uploadBatch(files);

  // Upload catalog metadata
  await uploadCatalogFile();

  // Show summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const publicUrl = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 Upload Complete!');
  console.log('═'.repeat(60));
  console.log(`✅ Uploaded: ${results.success.toLocaleString()} files (${formatBytes(results.totalSize)})`);
  
  if (results.skipped > 0) {
    console.log(`⊘ Skipped: ${results.skipped.toLocaleString()} (already existed)`);
  }
  
  if (results.failed > 0) {
    console.log(`❌ Failed: ${results.failed}`);
  }
  
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`🚀 Speed: ${(files.length / duration).toFixed(1)} files/sec`);
  console.log('═'.repeat(60));

  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(({ path, error }) => {
      console.log(`   ${path}: ${error}`);
    });
  }

  if (results.success > 0) {
    console.log('\n✅ Your professional assets are now live on R2!');
    console.log(`\n🔗 Asset URLs:`);
    console.log(`   ${publicUrl}/${R2_PREFIX}sprites/zombie.png`);
    console.log(`   ${publicUrl}/${R2_PREFIX}animations/zombie.png`);
    console.log(`   ${publicUrl}/${R2_PREFIX}audio/SoundEffects/blaster.mp3`);
    console.log(`\n📋 Catalog URL:`);
    console.log(`   ${publicUrl}/${R2_PREFIX}phaser-cdn-catalog.json`);
    console.log('\n💡 Next Steps:');
    console.log('   1. Update BASE_URL in maker-claude-style-prompt.js to use R2');
    console.log('   2. Update Railway environment variable: ASSETS_CDN_URL');
    console.log('   3. Test game generation with new CDN assets');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
