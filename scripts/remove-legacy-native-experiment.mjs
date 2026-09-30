#!/usr/bin/env node
/** Remove the legacy browser-bundle/native-executor catalog and every hosted asset under its IDs. */
import 'dotenv/config';
import pg from 'pg';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const LEGACY_GAME_IDS = [
  '2048', '2048-v2', 'aim-trainer', 'ball-bounce', 'block-blast', 'breakout',
  'bubble-pop', 'color-match', 'connect4', 'crossy-road', 'doodle-jump',
  'flappy-bird', 'fruit-slicer', 'geometry-dash', 'hextris', 'hextris-v2',
  'memory-match', 'number-tap', 'piano-tiles', 'pong', 'rock-paper-scissors',
  'simon-says', 'snake-io', 'tap-tap-dash', 'tetris', 'tic-tac-toe',
  'tomb-of-mask-1', 'tomb-of-mask-2', 'tomb-of-mask-3', 'tomb-of-mask-4',
  'tower-blocks-3d', 'towermaster', 'whack-a-mole',
];

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') || process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function deleteR2Prefix(prefix) {
  let continuationToken;
  let deleted = 0;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${prefix}/`,
      ContinuationToken: continuationToken,
    }));
    const keys = (page.Contents || []).map(({ Key }) => ({ Key }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET_NAME, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

try {
  const preview = await pool.query('SELECT id, name FROM games WHERE id = ANY($1) ORDER BY id', [LEGACY_GAME_IDS]);
  console.log(`Removing ${preview.rowCount} legacy database games:`);
  preview.rows.forEach(({ id, name }) => console.log(`- ${id}: ${name}`));

  const result = await pool.query('DELETE FROM games WHERE id = ANY($1) RETURNING id', [LEGACY_GAME_IDS]);
  let r2Deleted = 0;
  for (const id of LEGACY_GAME_IDS) r2Deleted += await deleteR2Prefix(id);
  console.log(`Deleted ${result.rowCount} database games and ${r2Deleted} R2 objects.`);
} finally {
  await pool.end();
}
