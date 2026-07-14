#!/usr/bin/env node
// Finalize the comprehensive-pass keeps: 18 newly-surfaced animations (snowmen/penguin, germs,
// chick, cowboy, pixel zombie) that the earlier parser bug hid. Label → upload → HEAD-verify →
// embed → merge into the shared v2 catalog + embeddings.
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const STAGING = 'v2-catalog/staging/phaser-full';
const AI_DIR = 'src/ai-engine';
const manifest = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest.json')));
const byId = new Map(manifest.map(m => [m.id, m]));

// Explicit label per kept id. species uses accurate values (some outside the original enum —
// chick/penguin/snowman/germ — flagged for enum formalization later; retrieval is embedding-based
// so accuracy > strict enum here). animation_type maps to the controlled enum.
const KEEPS = {
  'phaser/demoscene/budbrain__hatch':   { asset_type:'creature', species:'chick', animation_type:'action', perspective:'front', movement:'ground', theme:'casual', playable_role:'npc', quality:4, desc:'orange baby chick hatching out of an egg shell' },
  'phaser/demoscene/budbrain__sing':    { asset_type:'creature', species:'chick', animation_type:'cheer', perspective:'front', movement:'ground', theme:'casual', playable_role:'npc', quality:4, desc:'orange baby chick chirping/singing with open beak' },
  'phaser/games_bank-panic/bank-panic__hat': { asset_type:'character', species:'human', animation_type:'cheer', perspective:'side', movement:'ground', theme:'casual', playable_role:'npc', quality:3, desc:'western cowboy character tipping his bowler hat' },
  'phaser/games_germs/germs__blue':     { asset_type:'creature', species:'germ', animation_type:'idle', perspective:'front', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'blue jelly germ blob with big eyes, squishy idle animation' },
  'phaser/games_germs/germs__red':      { asset_type:'creature', species:'germ', animation_type:'idle', perspective:'front', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'red jelly germ blob with big eyes, squishy idle animation' },
  'phaser/games_germs/germs__green':    { asset_type:'creature', species:'germ', animation_type:'idle', perspective:'front', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'green jelly germ blob with big eyes, squishy idle animation' },
  'phaser/games_germs/germs__purple':   { asset_type:'creature', species:'germ', animation_type:'idle', perspective:'front', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'purple jelly germ blob with big eyes, squishy idle animation' },
  'phaser/games_snowmen-attack/sprites__snowman-big-die':   { asset_type:'character', species:'snowman', animation_type:'damage', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'large snowman enemy with top hat, melting/death animation' },
  'phaser/games_snowmen-attack/sprites__snowman-big-idle':  { asset_type:'character', species:'snowman', animation_type:'idle', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'large snowman enemy with top hat, idle animation' },
  'phaser/games_snowmen-attack/sprites__snowman-big-throw': { asset_type:'character', species:'snowman', animation_type:'attack', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'large snowman enemy with top hat, throwing snowball attack' },
  'phaser/games_snowmen-attack/sprites__snowman-big-walk':  { asset_type:'character', species:'snowman', animation_type:'walk', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'large snowman enemy with top hat, walk cycle' },
  'phaser/games_snowmen-attack/sprites__snowman-small-die':  { asset_type:'character', species:'snowman', animation_type:'damage', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'small snowman enemy, melting/death animation' },
  'phaser/games_snowmen-attack/sprites__snowman-small-idle': { asset_type:'character', species:'snowman', animation_type:'idle', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'small snowman enemy, idle animation' },
  'phaser/games_snowmen-attack/sprites__snowman-small-throw':{ asset_type:'character', species:'snowman', animation_type:'attack', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'small snowman enemy, throwing snowball attack' },
  'phaser/games_snowmen-attack/sprites__snowman-small-walk': { asset_type:'character', species:'snowman', animation_type:'walk', perspective:'side', movement:'ground', theme:'casual', playable_role:'enemy', quality:4, desc:'small snowman enemy, walk cycle' },
  'phaser/games_snowmen-attack/sprites__throw': { asset_type:'creature', species:'penguin', animation_type:'attack', perspective:'side', movement:'ground', theme:'casual', playable_role:'player', quality:4, desc:'black-and-white penguin player character, throwing snowball' },
  'phaser/games_snowmen-attack/sprites__idle':  { asset_type:'creature', species:'penguin', animation_type:'idle', perspective:'side', movement:'ground', theme:'casual', playable_role:'player', quality:4, desc:'black-and-white penguin player character, idle animation' },
  'phaser/tests/zombie-no-pivot__walk': { asset_type:'character', species:'zombie', animation_type:'walk', perspective:'side', movement:'ground', theme:'platformer', playable_role:'enemy', quality:4, desc:'cartoon pixel-art zombie with red cap and blue shirt, walk cycle' },
};

for (const k of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','OPENAI_API_KEY']) if (!process.env[k]) { console.error('Missing '+k); process.exit(1); }
const s3 = new S3Client({ region:'auto', endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
const BUCKET = process.env.R2_BUCKET_NAME, PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/,'');
const slugify = s => s.replace(/[^a-z0-9_-]/gi,'_').toLowerCase();

const labeled = [];
for (const [id, L] of Object.entries(KEEPS)) {
  const item = byId.get(id);
  if (!item) { console.error('MISSING in manifest:', id); process.exit(1); }
  const description = `${L.desc}, ${item.anim} animation (${item.frameCount} frames)`;
  labeled.push({
    id, asset_type:L.asset_type, species:L.species, animation_type:L.animation_type,
    perspective:L.perspective, movement:L.movement, theme:L.theme, playable_role:L.playable_role,
    frame_count:item.frameCount, canvas_size:{w:item.canvasW,h:item.canvasH},
    source_pack:`phaser-cdn ${item.source}`, quality_score:L.quality, confidence_score:0.9,
    description,
    search_text: [L.asset_type,L.species,L.animation_type,L.perspective,L.movement,L.theme,L.playable_role,description].join(' ').toLowerCase().replace(/[^a-z0-9\s_]/g,' ').replace(/\s+/g,' ').trim(),
    _sheetPath:item.sheetPath, _previewPath:item.previewPath, _anim:item.anim,
  });
}
console.log(`Labeled ${labeled.length}`);

function r2Keys(item) {
  const packSlug = slugify(item.source_pack.replace(/^phaser-cdn\s*/,'phaser_').replace(/\.json.*$/,'').replace(/\//g,'_'));
  const basename = path.basename(item._sheetPath,'.png');
  const dir = `assets/v2/${item.asset_type}/${packSlug}`;
  return { sheetKey:`${dir}/${basename}.png`, atlasKey:`${dir}/${basename}.json`, sheetLocal:item._sheetPath, atlasLocal:item._sheetPath.replace(/\.png$/,'.json') };
}
async function put(local,key,ct){ const b=fs.readFileSync(local); await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:b,ContentType:ct,CacheControl:'public, max-age=31536000, immutable'})); }

console.log('\n=== UPLOAD ===');
const uploaded = [];
for (const item of labeled) {
  const k = r2Keys(item);
  await Promise.all([ put(k.sheetLocal,k.sheetKey,'image/png'), put(k.atlasLocal,k.atlasKey,'application/json') ]);
  uploaded.push({ id:item.id, ...k });
}
console.log(`uploaded ${uploaded.length} (${uploaded.length*2} objects)`);

console.log('\n=== HEAD VERIFY ===');
const keys = uploaded.flatMap(u => [u.sheetKey,u.atlasKey]);
const misses = [];
for (const key of keys) { const r = await fetch(`${PUBLIC_URL}/${key}`,{method:'HEAD'}); if(!r.ok) misses.push(key); }
if (misses.length) { console.error('MISSES:', misses); process.exit(1); }
console.log(`✅ all ${keys.length} live`);

// Attach r2 + atlas_ref
const uById = new Map(uploaded.map(u=>[u.id,u]));
const finalized = labeled.map(l => {
  const u = uById.get(l.id);
  const { _sheetPath,_previewPath,_anim,...rest } = l;
  return { ...rest, r2:{ sheet_url:`${PUBLIC_URL}/${u.sheetKey}`, atlas_url:`${PUBLIC_URL}/${u.atlasKey}`, sheet_key:u.sheetKey, atlas_key:u.atlasKey },
    atlas_ref:{ sheet:path.basename(u.sheetKey), animations:{ [l.animation_type]:{ frames:Array.from({length:l.frame_count},(_,i)=>i), fps:12, loop:true } } } };
});

console.log('\n=== EMBED + MERGE ===');
const openai = new OpenAI({ apiKey:process.env.OPENAI_API_KEY });
const embText = l => `${l.asset_type} ${l.species} ${l.animation_type} ${l.perspective} ${l.movement} ${l.theme} ${l.playable_role}. ${l.description}`;
const resp = await openai.embeddings.create({ model:'text-embedding-3-small', input:finalized.map(embText), dimensions:256 });
const b64 = f => Buffer.from(new Float32Array(f).buffer).toString('base64');
const newEmb = finalized.map((l,i)=>({ id:l.id, asset_type:l.asset_type, species:l.species, animation_type:l.animation_type, perspective:l.perspective, movement:l.movement, theme:l.theme, playable_role:l.playable_role, frame_count:l.frame_count, canvas_size:l.canvas_size, source_pack:l.source_pack, quality_score:l.quality_score, confidence_score:l.confidence_score, description:l.description, r2:l.r2, atlas_animations:l.atlas_ref.animations, vec:b64(resp.data[i].embedding) }));

const embPath = path.join(AI_DIR,'v2-asset-embeddings.json'), catPath = path.join(AI_DIR,'v2-asset-catalog.json');
const emb = JSON.parse(fs.readFileSync(embPath)), cat = JSON.parse(fs.readFileSync(catPath));
const have = new Set(emb.items.map(x=>x.id));
const addE = newEmb.filter(x=>!have.has(x.id)), addC = addE.map(({vec,...r})=>r);
emb.items.push(...addE); emb.builtAt = new Date().toISOString(); fs.writeFileSync(embPath, JSON.stringify(emb));
cat.items.push(...addC); cat.builtAt = new Date().toISOString(); fs.writeFileSync(catPath, JSON.stringify(cat,null,2));
fs.writeFileSync(path.join(STAGING,'_labeled.json'), JSON.stringify({items:finalized},null,2));
console.log(`✅ merged ${addE.length} new → catalog now ${cat.items.length} items`);
