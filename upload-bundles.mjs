#!/usr/bin/env node
/**
 * upload-bundles.mjs
 * 
 * Uploads all game.bundle.js files from gametok-games/ to Cloudflare R2.
 * Run from gametok-backend where @aws-sdk/client-s3 is installed.
 * 
 * Usage:
 *   node upload-bundles.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

// Load env from .env file
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = path.resolve(__dirname, '../gametok-games');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET_NAME) {
  console.error('❌ Missing R2 credentials in .env file');
  console.error('   Need: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
  process.exit(1);
}

const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

async function main() {
  console.log('🚀 Starting upload to R2...\n');
  console.log(`   Bucket: ${BUCKET_NAME}`);
  console.log(`   Games dir: ${GAMES_DIR}\n`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });

  const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
  const SKIP = new Set([
    'node_modules', 'report', 'scripts', 'support', 'thumbnails', 
    'openpigeon-games', 'game', 'icons', 'loops-games', '.git', '.wrangler'
  ]);
  
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) {
      continue;
    }
    
    const bundlePath = path.join(GAMES_DIR, entry.name, 'game.bundle.js');
    if (!fs.existsSync(bundlePath)) {
      console.log(`  ⏭️  ${entry.name.padEnd(25)} — no game.bundle.js`);
      skipped++;
      continue;
    }

    const fileContent = fs.readFileSync(bundlePath);
    const fileSizeKB = (fileContent.length / 1024).toFixed(1);
    const key = `${entry.name}/game.bundle.js`;

    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: 'application/javascript',
      }));
      console.log(`  ✅ ${entry.name.padEnd(25)} ${fileSizeKB.padStart(8)} KB`);
      uploaded++;
    } catch (err) {
      console.error(`  ❌ ${entry.name.padEnd(25)} ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 Upload complete!`);
  console.log(`   ✅ Uploaded: ${uploaded}`);
  console.log(`   ⏭️  Skipped:  ${skipped}`);
  if (failed > 0) {
    console.log(`   ❌ Failed:   ${failed}`);
  }
  console.log(`\n🌐 Public URL base: ${PUBLIC_URL || 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev'}`);
  console.log(`   Example: ${PUBLIC_URL}/breakout/game.bundle.js\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
