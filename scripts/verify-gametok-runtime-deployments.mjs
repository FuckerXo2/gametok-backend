#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const standaloneSdkGames = [
  'bridge-horror-house',
  'hexgl',
  'leonida',
  'ox-alpha-bmx',
  'world-creator',
];

async function getText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

try {
  const result = await pool.query(`
    SELECT id, embed_url
    FROM games
    WHERE html_payload LIKE '%gametok-default-controller%'
    ORDER BY id
  `);
  if (result.rowCount !== 44) {
    throw new Error(`Expected 44 default-controller games, found ${result.rowCount}`);
  }

  for (const game of result.rows) {
    const html = await getText(game.embed_url);
    if (!html.includes('id="gametok-default-controller"') ||
        !html.includes('installDefaultController({')) {
      throw new Error(`${game.id}: deployed controller marker/call is missing`);
    }
    const sdkMatch = html.match(/<script[^>]+src=["']([^"']*gametok-sdk\.js)["'][^>]*><\/script>/i);
    if (!sdkMatch) throw new Error(`${game.id}: deployed SDK script tag is missing`);
    const sdk = await getText(new URL(sdkMatch[1], game.embed_url).href);
    if (!sdk.includes("const SDK_VERSION = '1.1.0'") ||
        !sdk.includes('installDefaultController')) {
      throw new Error(`${game.id}: deployed SDK is stale`);
    }
  }
  console.log('✓ 44/44 default-controller games verified from live R2 URLs');

  const standaloneResult = await pool.query(
    `SELECT id, embed_url
     FROM games
     WHERE id = ANY($1::text[])
     ORDER BY id`,
    [standaloneSdkGames],
  );
  if (standaloneResult.rowCount !== standaloneSdkGames.length) {
    throw new Error(`Expected ${standaloneSdkGames.length} standalone-SDK games, found ${standaloneResult.rowCount}`);
  }
  for (const game of standaloneResult.rows) {
    if (!game.embed_url.includes(`/web-games/${game.id}/`)) {
      throw new Error(`${game.id}: catalog does not point at its immutable R2 release`);
    }
    const html = await getText(game.embed_url);
    const sdkMatch = html.match(/<script[^>]+src=["']([^"']*gametok-sdk\.js)["'][^>]*><\/script>/i);
    if (!sdkMatch) throw new Error(`${game.id}: deployed SDK script tag is missing`);
    const sdk = await getText(new URL(sdkMatch[1], game.embed_url).href);
    if (!sdk.includes("const SDK_VERSION = '1.1.0'") ||
        !sdk.includes('ready(detail)')) {
      throw new Error(`${game.id}: deployed standalone SDK is stale`);
    }
  }
  console.log(`✓ ${standaloneSdkGames.length}/${standaloneSdkGames.length} standalone-SDK games verified from live R2 URLs`);

  const tidelineResult = await pool.query(
    "SELECT embed_url FROM games WHERE id = 'tideline'",
  );
  if (!tidelineResult.rowCount) throw new Error('Tideline catalog row is missing');
  const tidelineUrl = tidelineResult.rows[0].embed_url;
  const tidelineHtml = await getText(tidelineUrl);
  const moduleMatch = tidelineHtml.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
  if (!moduleMatch) throw new Error('Tideline deployed module script is missing');
  const tidelineBundle = await getText(new URL(moduleMatch[1], tidelineUrl).href);
  for (const required of ['1.1.0', 'preloaded', 'paused', 'active', 'destroyed', 'qualitychange']) {
    if (!tidelineBundle.includes(required)) {
      throw new Error(`Tideline deployed bundle lacks ${required}`);
    }
  }
  console.log(`✓ Tideline lifecycle + quality bundle verified: ${tidelineUrl}`);
} finally {
  await pool.end();
}
