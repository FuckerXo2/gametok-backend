#!/usr/bin/env node
/**
 * Count total assets in Cloudflare R2 bucket
 * 
 * Usage: node count-r2-assets.js
 * Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

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

async function countR2Assets() {
  if (!BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID) {
    console.error('❌ R2 credentials not configured');
    console.error('Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  console.log(`📊 Counting assets in R2 bucket: ${BUCKET_NAME}\n`);

  let totalObjects = 0;
  let totalSize = 0;
  let continuationToken = undefined;
  const prefixCounts = {};

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response = await s3Client.send(command);
      
      if (response.Contents) {
        totalObjects += response.Contents.length;
        
        response.Contents.forEach(obj => {
          totalSize += obj.Size || 0;
          
          // Count by prefix (folder)
          const prefix = obj.Key.split('/')[0];
          prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        });

        console.log(`  Processed ${totalObjects.toLocaleString()} objects...`);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log('\n✅ Count Complete!\n');
    console.log('═══════════════════════════════════════');
    console.log(`📦 Total Objects: ${totalObjects.toLocaleString()}`);
    console.log(`💾 Total Size: ${formatBytes(totalSize)}`);
    console.log(`📊 Average Size: ${formatBytes(totalSize / totalObjects)}`);
    console.log('═══════════════════════════════════════\n');

    console.log('📁 Breakdown by Folder:\n');
    const sortedPrefixes = Object.entries(prefixCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    sortedPrefixes.forEach(([prefix, count]) => {
      const percentage = ((count / totalObjects) * 100).toFixed(1);
      console.log(`  ${prefix.padEnd(30)} ${count.toLocaleString().padStart(8)} (${percentage}%)`);
    });

    if (Object.keys(prefixCounts).length > 20) {
      console.log(`  ... and ${Object.keys(prefixCounts).length - 20} more folders`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`🎯 Total: ${(totalObjects / 1000).toFixed(1)}K assets`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error counting R2 assets:', error.message);
    process.exit(1);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

countR2Assets();
