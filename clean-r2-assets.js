#!/usr/bin/env node
/**
 * Clean Old Assets from Cloudflare R2 Bucket
 * 
 * This script helps you bulk delete old/useless assets from R2.
 * 
 * Usage:
 *   node clean-r2-assets.js --dry-run              # Preview what would be deleted
 *   node clean-r2-assets.js --prefix audio/        # Delete all files under audio/
 *   node clean-r2-assets.js --confirm              # Actually delete (use with --prefix)
 * 
 * Environment Variables Required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');
const prefixArg = args.find(arg => arg.startsWith('--prefix='));
const prefix = prefixArg ? prefixArg.split('=')[1] : '';

// Folders to keep (whitelist approach - safer!)
const KEEP_PREFIXES = [
  'covers/',           // AI-generated cover art (new system)
  'opengame-games/',   // OpenGame generated games
];

// Folders to delete (old system)
// You can customize this list based on what you see in your bucket
const DELETE_PREFIXES = [
  'audio/',            // Old audio assets (if you're not using them anymore)
  'sprites/',          // Old uploaded sprites (if migrating to local assets)
  'backgrounds/',      // Old backgrounds
  'tiles/',            // Old tileset assets
  // Add more prefixes as needed
];

/**
 * List all objects with a given prefix
 */
async function listObjects(prefix = '') {
  const objects = [];
  let continuationToken = undefined;

  console.log(`📂 Scanning bucket: ${BUCKET_NAME}${prefix ? ` (prefix: ${prefix})` : ''}`);

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        objects.push(...response.Contents);
        console.log(`  Found ${objects.length.toLocaleString()} objects...`);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
  } catch (error) {
    console.error('❌ Error listing objects:', error.message);
    throw error;
  }
}

/**
 * Delete objects in batches (R2 allows max 1000 per request)
 */
async function deleteObjects(keys) {
  if (keys.length === 0) {
    console.log('No objects to delete');
    return { deleted: 0, errors: 0 };
  }

  console.log(`🗑️  Deleting ${keys.length.toLocaleString()} objects...`);

  let deleted = 0;
  let errors = 0;
  const batchSize = 1000;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    try {
      const command = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: batch.map(Key => ({ Key })),
          Quiet: true,
        },
      });

      const response = await s3Client.send(command);
      
      deleted += batch.length;
      if (response.Errors && response.Errors.length > 0) {
        errors += response.Errors.length;
        console.error(`  ⚠️  ${response.Errors.length} errors in this batch`);
      }

      console.log(`  Deleted ${deleted.toLocaleString()} / ${keys.length.toLocaleString()} objects`);
    } catch (error) {
      errors += batch.length;
      console.error(`  ❌ Error deleting batch:`, error.message);
    }
  }

  return { deleted, errors };
}

/**
 * Get user confirmation
 */
function askConfirmation(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Calculate total size
 */
function calculateSize(objects) {
  return objects.reduce((sum, obj) => sum + (obj.Size || 0), 0);
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Show folder breakdown
 */
function showBreakdown(objects) {
  const prefixCounts = {};
  const prefixSizes = {};

  objects.forEach(obj => {
    const prefix = obj.Key.split('/')[0] + '/';
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    prefixSizes[prefix] = (prefixSizes[prefix] || 0) + (obj.Size || 0);
  });

  console.log('\n📊 Folder Breakdown:\n');
  const sortedPrefixes = Object.entries(prefixCounts)
    .sort((a, b) => b[1] - a[1]);

  sortedPrefixes.forEach(([prefix, count]) => {
    const size = formatBytes(prefixSizes[prefix]);
    const percentage = ((count / objects.length) * 100).toFixed(1);
    console.log(`  ${prefix.padEnd(30)} ${count.toLocaleString().padStart(8)} files  ${size.padStart(12)}  (${percentage}%)`);
  });
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

  console.log('🧹 R2 Asset Cleanup Tool\n');

  // If no prefix specified, show overview and ask what to delete
  if (!prefix) {
    console.log('📂 Scanning entire bucket to show you what\'s there...\n');
    const allObjects = await listObjects();

    if (allObjects.length === 0) {
      console.log('✅ Bucket is empty!');
      return;
    }

    const totalSize = calculateSize(allObjects);
    console.log(`\n📦 Total: ${allObjects.length.toLocaleString()} objects (${formatBytes(totalSize)})`);

    showBreakdown(allObjects);

    console.log('\n💡 Usage Examples:');
    console.log('   node clean-r2-assets.js --prefix=audio/ --dry-run       # Preview deletion');
    console.log('   node clean-r2-assets.js --prefix=audio/ --confirm       # Actually delete');
    console.log('   node clean-r2-assets.js --prefix=sprites/ --confirm     # Delete sprites folder');
    console.log('\n⚠️  Add --confirm flag to actually delete files!');
    return;
  }

  // List objects with the specified prefix
  const objects = await listObjects(prefix);

  if (objects.length === 0) {
    console.log(`\n✅ No objects found with prefix: ${prefix}`);
    return;
  }

  const totalSize = calculateSize(objects);
  console.log(`\n📦 Found ${objects.length.toLocaleString()} objects (${formatBytes(totalSize)})`);

  // Show a sample of files
  console.log('\n📄 Sample files (first 10):');
  objects.slice(0, 10).forEach(obj => {
    console.log(`  ${obj.Key} (${formatBytes(obj.Size)})`);
  });
  if (objects.length > 10) {
    console.log(`  ... and ${(objects.length - 10).toLocaleString()} more files`);
  }

  // Dry run mode
  if (dryRun || !confirm) {
    console.log('\n🔍 DRY RUN MODE - No files will be deleted');
    console.log(`\n⚠️  To actually delete these ${objects.length.toLocaleString()} files, run:`);
    console.log(`   node clean-r2-assets.js --prefix=${prefix} --confirm`);
    return;
  }

  // Confirmation required
  console.log('\n⚠️  WARNING: This will permanently delete these files!');
  const confirmed = await askConfirmation(`\nDelete ${objects.length.toLocaleString()} files from ${prefix}?`);

  if (!confirmed) {
    console.log('\n❌ Cancelled by user');
    return;
  }

  // Delete the files
  const keys = objects.map(obj => obj.Key);
  const { deleted, errors } = await deleteObjects(keys);

  console.log('\n✅ Cleanup Complete!');
  console.log(`   Deleted: ${deleted.toLocaleString()} files`);
  console.log(`   Freed: ${formatBytes(totalSize)}`);
  if (errors > 0) {
    console.log(`   Errors: ${errors}`);
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
