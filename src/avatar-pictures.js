// The Shop's item pictures, made by the server (like Roblox's): every item in src/avatar-items.js gets a picture
// rendered from its 3D file, so adding an item is its file and its line, nothing else. The published item viewer
// (games/avatar-editor/item-view.html ?shot) draws one item; headless Chrome opens it and the picture goes to R2
// (web-games/avatar/assets/thumbs/<item id>.webp, where the app loads it).
//   An item is rendered when its picture is missing, or its `pic` (picture version) is newer than the one made.
//   POST /api/avatar/pictures/render does it (the server calls it itself a minute after each new version starts:
//   src/index.js);
//   it's safe to call any time: with nothing to do it does nothing.
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ITEMS } from './avatar-items.js';

const PREFIX = 'web-games/avatar';
const MADE = `${PREFIX}/assets/thumbs/.pictures.json`;   // item id -> the picture version made
const NAKED = { head: null, top: null, arms: null, legs: null, feet: null, acc: null };
const WHITE = { head: '#ffffff', top: '#ffffff', arms: '#ffffff', legs: '#ffffff', feet: '#ffffff', acc: '#ffffff' };
// what an item is pictured on: a plain body, no hair, the item alone (hair and beards on a grey head, outfits and
// characters whole)
const BASE = { body: 'Male', skin: 2, face: 0, hair: null, beard: false, hairColor: '#5a3420', fit: true, parts: NAKED, colors: WHITE };

export function pictureOf(i) {
  if (i.kind === 'character') return { record: { ...BASE, character: i.character }, show: 'all' };
  if (i.kind === 'outfit') return { record: { ...BASE, hair: 'Hair_Buzzed', parts: { ...NAKED, ...i.parts } }, show: 'all' };
  if (i.kind === 'hair') return { record: { ...BASE, hair: i.hair, hairColor: i.hairColor }, show: 'head' };
  if (i.kind === 'beard') return { record: { ...BASE, beard: true }, show: 'head' };
  if (i.kind === 'part') return { record: { ...BASE, parts: { ...NAKED, [i.slot]: i.set } }, show: 'item' };
  return null;
}

let running = null;
// Render what's missing or out of date, for up to `budget` ms. Resolves to { rendered, failed, left }.
export function renderPictures(o) {
  return (running ||= run({ budget: 240000, ...o }).finally(() => { running = null; }));
}

async function run({ s3, bucket, publicUrl, budget, page: viewer = `${publicUrl}/${PREFIX}/item-view.html` }) {
  const until = Date.now() + budget;
  let made = {};
  try { made = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: MADE }))).Body.transformToString()); } catch {}
  const exists = async (key) => { try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; } catch { return false; } };
  const todo = [];
  for (const i of ITEMS) {
    const v = i.pic || 1, key = `${PREFIX}/assets/thumbs/${i.id}.webp`;
    if (made[i.id] === v || !pictureOf(i)) continue;
    // a picture from before the server made them (version 1, made by hand): kept
    if (v === 1 && await exists(key)) { made[i.id] = 1; continue; }
    todo.push(i);
  }
  const save = () => s3.send(new PutObjectCommand({ Bucket: bucket, Key: MADE, Body: JSON.stringify(made), ContentType: 'application/json', CacheControl: 'no-cache' }));
  if (!todo.length) { await save(); return { rendered: [], failed: [], left: 0 }; }

  console.log(`[Pictures] rendering ${todo.length}: ${todo.map((i) => i.id).join(' ')}`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const rendered = [], failed = [];
  try {
    for (const i of todo) {
      if (Date.now() > until) break;
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 256, height: 256 });
        const url = `${viewer}?shot&v=${Date.now()}&r=${encodeURIComponent(JSON.stringify(pictureOf(i)))}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction('window.__png', { timeout: 90000 });
        const png = Buffer.from((await page.evaluate(() => window.__png)).split(',')[1], 'base64');
        const webp = await sharp(png).webp({ quality: 88 }).toBuffer();
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${PREFIX}/assets/thumbs/${i.id}.webp`, Body: webp, ContentType: 'image/webp', CacheControl: 'public, max-age=86400' }));
        made[i.id] = i.pic || 1; rendered.push(i.id);
        await save();
      } catch (e) {
        console.error(`[Pictures] ${i.id}:`, e.message); failed.push(i.id);
      } finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(`[Pictures] rendered ${rendered.length}${failed.length ? `, failed ${failed.join(' ')}` : ''}`);
  return { rendered, failed, left: todo.length - rendered.length - failed.length };
}
