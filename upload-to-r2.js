#!/usr/bin/env node

/**
 * Upload Assets to Cloudflare R2
 * 
 * This script uploads all files from /public/assets/ to an R2 bucket
 * preserving the directory structure.
 * 
 * Prerequisites:
 * 1. Install Wrangler: npm install -g wrangler
 * 2. Login to Cloudflare: wrangler login
 * 3. Create R2 bucket: wrangler r2 bucket create gametok-assets
 * 
 * Environment variables needed:
 * - CLOUDFLARE_ACCOUNT_ID: Your Cloudflare account ID
 * - R2_BUCKET_NAME: Name of your R2 bucket (default: gametok-assets)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, 'public/assets');
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'gametok-assets';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

/**
 * Get all files in directory recursively
 */
function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (stat.isFile()) {
      // Get relative path from base assets directory
      const relativePath = path.relative(baseDir, fullPath);
      files.push({
        localPath: fullPath,
        remotePath: relativePath.replace(/\\/g, '/') // Normalize to forward slashes
      });
    }
  }
  
  return files;
}

/**
 * Upload a single file to R2
 */
async function uploadFile(localPath, remotePath) {
  try {
    const command = `wrangler r2 object put ${BUCKET_NAME}/${remotePath} --file="${localPath}"`;
    await execAsync(command);
    return { success: true, path: remotePath };
  } catch (error) {
    return { success: false, path: remotePath, error: error.message };
  }
}

/**
 * Upload files in batches
 */
async function uploadBatch(files, batchSize = 10) {
  const results = {
    success: 0,
    failed: 0,
    errors: []
  };
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const promises = batch.map(file => uploadFile(file.localPath, file.remotePath));
    const batchResults = await Promise.all(promises);
    
    batchResults.forEach(result => {
      if (result.success) {
        results.success++;
        console.log(`✓ ${result.path}`);
      } else {
        results.failed++;
        results.errors.push({ path: result.path, error: result.error });
        console.error(`✗ ${result.path}: ${result.error}`);
      }
    });
    
    // Progress
    const progress = Math.min(i + batchSize, files.length);
    console.log(`\nProgress: ${progress}/${files.length} (${Math.round(progress / files.length * 100)}%)\n`);
  }
  
  return results;
}

/**
 * Main upload function
 */
async function main() {
  console.log('🚀 GameTok Asset Upload to R2\n');
  
  // Check prerequisites
  if (!ACCOUNT_ID) {
    console.error('❌ Error: CLOUDFLARE_ACCOUNT_ID environment variable not set');
    console.log('\nSet it with: export CLOUDFLARE_ACCOUNT_ID=your-account-id');
    process.exit(1);
  }
  
  // Check if assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`❌ Error: Assets directory not found: ${ASSETS_DIR}`);
    process.exit(1);
  }
  
  // Check if wrangler is installed
  try {
    await execAsync('wrangler --version');
  } catch (error) {
    console.error('❌ Error: Wrangler CLI not found');
    console.log('\nInstall it with: npm install -g wrangler');
    console.log('Then login with: wrangler login');
    process.exit(1);
  }
  
  console.log(`📁 Scanning assets directory: ${ASSETS_DIR}`);
  const files = getAllFiles(ASSETS_DIR);
  console.log(`   Found ${files.length} files\n`);
  
  console.log(`☁️  Uploading to R2 bucket: ${BUCKET_NAME}`);
  console.log(`   Account ID: ${ACCOUNT_ID}\n`);
  
  const startTime = Date.now();
  const results = await uploadBatch(files);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Upload Summary');
  console.log('='.repeat(50));
  console.log(`✅ Success: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⏱️  Duration: ${duration}s`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(({ path, error }) => {
      console.log(`   ${path}: ${error}`);
    });
  }
  
  if (results.success > 0) {
    console.log('\n✅ Assets uploaded successfully!');
    console.log(`\n🔗 Your assets are now available at:`);
    console.log(`   https://pub-YOUR-R2-DOMAIN/${BUCKET_NAME}/`);
    console.log('\n💡 Next steps:');
    console.log('   1. Enable R2 public access in Cloudflare dashboard');
    console.log('   2. Set up custom domain (optional)');
    console.log('   3. Update BASE_URL in your game generation code');
  }
}

// Run
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
