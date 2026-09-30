import 'dotenv/config';
import fs from 'node:fs/promises';
import pool from '../src/db.js';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const manifestPath = new URL('../catalog-removal-manifest.json', import.meta.url);
const apply = process.argv.includes('--apply');
const origin = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev';
const client = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: {
  accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
} });
const Bucket = process.env.R2_BUCKET_NAME;
try {
  if (!apply) {
    const { rows } = await pool.query('SELECT id, name, embed_url FROM games ORDER BY id');
    const manifest = rows.map(row => {
      const url = new URL(row.embed_url);
      if (url.origin !== origin || !/^\/(games\/[\w-]+|loops-games\/\d+)\/index\.html$/.test(url.pathname)) {
        throw new Error(`Unrecognized storage location for ${row.id}; refusing deletion`);
      }
      return { ...row, prefix: url.pathname.slice(1, -'index.html'.length) };
    });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest));
    console.log(`Prepared ${manifest.length} catalog games; nothing deleted.`);
  } else {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const game of manifest) {
      if (!/^(games\/[\w-]+|loops-games\/\d+)\/$/.test(game.prefix)) throw new Error('Unsafe prefix');
      let removed = 0;
      // Always list the first page again after deletion to avoid skipping objects.
      while (true) {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: game.prefix }));
        if (!page.Contents?.length) break;
        const result = await client.send(new DeleteObjectsCommand({ Bucket, Delete: {
          Objects: page.Contents.map(({ Key }) => ({ Key })), Quiet: true,
        } }));
        if (result.Errors?.length) throw new Error(JSON.stringify(result.Errors));
        removed += page.Contents.length;
      }
      const result = await pool.query('DELETE FROM games WHERE id = $1 AND embed_url = $2 RETURNING id', [game.id, game.embed_url]);
      console.log(`${game.id}: deleted ${removed} objects, ${result.rowCount} catalog rows`);
    }
    console.log('Remaining catalog:', (await pool.query('SELECT COUNT(*) FROM games')).rows[0].count);
  }
} finally {
  client.destroy();
  await pool.end();
}
