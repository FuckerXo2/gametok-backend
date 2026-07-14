#!/usr/bin/env node
// Bring in STATIC (single-frame) assets with the new motion field. First batch: the 28
// atlas/monsters.json fantasy characters + 2 clear sprite keeps (alienbusters ship, kung-fu master).
//
// NEW SCHEMA FIELD: motion = 'animated' | 'static'. Static assets have no animation frames — the
// game moves/rotates/scales them with code (cars, monsters, ships). The builder prompt branches on
// this so it never tries to play('walk') on a static sprite.
//
// Also backfills motion:'animated' into all 232 existing catalog items (they're all multi-frame).
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

for (const k of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','OPENAI_API_KEY']) if (!process.env[k]) { console.error('Missing '+k); process.exit(1); }
const s3 = new S3Client({ region:'auto', endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
const BUCKET = process.env.R2_BUCKET_NAME, PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/,'');
const R2 = 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/assets/';
const AI = 'src/ai-engine';
const slugify = s => s.replace(/[^a-z0-9_-]/gi,'_').toLowerCase();

// --- Monster label table: name → {asset_type, species, playable_role} (theme=fantasy, perspective=side, motion=static) ---
const M = {
  icegolem:{t:'creature',s:'golem',r:'enemy',d:'ice elemental golem, jagged frozen body'},
  magmagolem:{t:'creature',s:'golem',r:'enemy',d:'magma/lava elemental golem, glowing molten cracks'},
  stonegolem:{t:'creature',s:'golem',r:'enemy',d:'rocky stone golem, boulder body'},
  troll:{t:'creature',s:'troll',r:'enemy',d:'hulking green troll with tusks'},
  ogre:{t:'creature',s:'ogre',r:'enemy',d:'grey brute ogre with axe'},
  giantspider:{t:'creature',s:'spider',r:'enemy',d:'red giant spider, multiple legs and eyes'},
  slime:{t:'creature',s:'slime',r:'enemy',d:'green translucent slime blob with skulls inside'},
  zombie:{t:'character',s:'zombie',r:'enemy',d:'gaunt grey undead zombie'},
  frogman:{t:'creature',s:'frogman',r:'enemy',d:'green frog-man humanoid with spear'},
  imp:{t:'creature',s:'imp',r:'enemy',d:'red demon imp with blades and tail'},
  ghost:{t:'creature',s:'ghost',r:'enemy',d:'pale translucent floating ghost'},
  hobgoblin:{t:'character',s:'goblin',r:'enemy',d:'armored hobgoblin with sword and shield'},
  'hero-mage':{t:'character',s:'human',r:'player',d:'hooded hero mage wielding fire magic'},
  skeletalwarrior:{t:'creature',s:'skeleton',r:'enemy',d:'skeletal warrior with sword and shield'},
  'hero-warrior':{t:'character',s:'human',r:'player',d:'armored hero warrior with sword and shield, red cape'},
  swashbuckler:{t:'character',s:'human',r:'enemy',d:'red-coat swashbuckler with dual cutlasses'},
  gnoll:{t:'creature',s:'gnoll',r:'enemy',d:'hyena-headed gnoll beast with weapon'},
  scout:{t:'character',s:'human',r:'player',d:'green-cloaked scout holding a torch'},
  wererat:{t:'creature',s:'wererat',r:'enemy',d:'grey were-rat humanoid with claws'},
  assassin:{t:'character',s:'human',r:'enemy',d:'black-clad hooded assassin with dagger'},
  'hero-ranger':{t:'character',s:'human',r:'player',d:'green hero ranger with dual blades'},
  darkreaper:{t:'creature',s:'reaper',r:'enemy',d:'grim reaper in black robe with scythe'},
  goblin:{t:'creature',s:'goblin',r:'enemy',d:'small green goblin, crouched'},
  lizardman:{t:'creature',s:'lizardman',r:'enemy',d:'green lizard-man with shield and blade'},
  guard:{t:'character',s:'human',r:'npc',d:'armored town guard with sword and red tabard'},
  cultist:{t:'character',s:'human',r:'enemy',d:'red-robed hooded cultist with fire'},
  drow:{t:'character',s:'human',r:'enemy',d:'dark-elf drow in black armor with blade'},
  ruffian:{t:'character',s:'human',r:'enemy',d:'bald bandit ruffian with sword on shoulder'},
};

// --- Sprite keeps (already single PNGs on R2) ---
const SPRITE_KEEPS = {
  'sprites/alienbusters.png': {t:'vehicle', s:'spaceship', r:'player', d:'detailed sci-fi "Alien Busters" spaceship, side view'},
  'sprites/master.png':       {t:'character', s:'human', r:'npc', d:'old kung-fu master in white robe standing on a cloud'},
};

const labeled = [];

// 1. Monsters — crop from staging (already extracted by prior step) OR re-extract
const monstersIdx = JSON.parse(fs.readFileSync('v2-catalog/staging/monsters/_index.json'));
for (const rec of monstersIdx) {
  const info = M[rec.name];
  if (!info) { console.error('No label for monster:', rec.name); process.exit(1); }
  labeled.push({
    id:`phaser/atlas_monsters/${slugify(rec.name)}`, asset_type:info.t, species:info.s,
    animation_type:'idle', motion:'static', perspective:'side', movement:'ground',
    theme:'fantasy', playable_role:info.r, frame_count:1, canvas_size:{w:rec.w,h:rec.h},
    source_pack:'phaser-cdn atlas/monsters', quality_score:5, confidence_score:0.95,
    description:`${info.d} (static single-frame sprite, move with code)`,
    _local:rec.local, _pack:'atlas_monsters',
  });
}

// 2. Sprite keeps — download the single PNGs
const OUT = 'v2-catalog/staging/static-sprites'; fs.mkdirSync(OUT,{recursive:true});
for (const [p, info] of Object.entries(SPRITE_KEEPS)) {
  const buf = Buffer.from(await (await fetch(R2+p)).arrayBuffer());
  const meta = await sharp(buf).metadata();
  const local = OUT+'/'+slugify(path.basename(p,'.png'))+'.png';
  fs.writeFileSync(local, buf);
  labeled.push({
    id:`phaser/sprites/${slugify(path.basename(p,'.png'))}`, asset_type:info.t, species:info.s,
    animation_type:'idle', motion:'static', perspective:'side', movement:info.t==='vehicle'?'air':'ground',
    theme:info.t==='vehicle'?'sci_fi':'fantasy', playable_role:info.r, frame_count:1, canvas_size:{w:meta.width,h:meta.height},
    source_pack:'phaser-cdn sprites', quality_score:4, confidence_score:0.9,
    description:`${info.d} (static single-frame sprite, move with code)`,
    _local:local, _pack:'sprites',
  });
}

console.log(`Labeled ${labeled.length} static assets`);

// --- Upload ---
async function put(local,key,ct){ const b=fs.readFileSync(local); await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:b,ContentType:ct,CacheControl:'public, max-age=31536000, immutable'})); }
console.log('\n=== UPLOAD ===');
const uploaded=[];
for (const l of labeled) {
  const packSlug = slugify('phaser_'+l._pack);
  const base = slugify(l.id.split('/').pop());
  const dir = `assets/v2/${l.asset_type}/${packSlug}`;
  const sheetKey = `${dir}/${base}.png`, atlasKey = `${dir}/${base}.json`;
  // Static atlas JSON: single frame, empty animations, motion flag
  const atlasJson = { sheet:`${base}.png`, frameSize:l.canvas_size, motion:'static', animations:{} };
  const tmpAtlas = l._local.replace(/\.png$/,'.static.json'); fs.writeFileSync(tmpAtlas, JSON.stringify(atlasJson,null,2));
  await Promise.all([ put(l._local,sheetKey,'image/png'), put(tmpAtlas,atlasKey,'application/json') ]);
  uploaded.push({ id:l.id, sheetKey, atlasKey });
}
console.log(`uploaded ${uploaded.length} (${uploaded.length*2} objects)`);

console.log('\n=== HEAD VERIFY ===');
const misses=[];
for (const u of uploaded) for (const key of [u.sheetKey,u.atlasKey]) { const r=await fetch(`${PUBLIC_URL}/${key}`,{method:'HEAD'}); if(!r.ok) misses.push(key); }
if (misses.length){ console.error('MISSES',misses); process.exit(1); }
console.log(`✅ all ${uploaded.length*2} live`);

// --- Finalize records + embed ---
const uById=new Map(uploaded.map(u=>[u.id,u]));
const finalized = labeled.map(l=>{
  const u=uById.get(l.id);
  const {_local,_pack,...rest}=l;
  return { ...rest, r2:{ sheet_url:`${PUBLIC_URL}/${u.sheetKey}`, atlas_url:`${PUBLIC_URL}/${u.atlasKey}`, sheet_key:u.sheetKey, atlas_key:u.atlasKey },
    search_text:[l.asset_type,l.species,'static',l.perspective,l.movement,l.theme,l.playable_role,l.description].join(' ').toLowerCase().replace(/[^a-z0-9\s_]/g,' ').replace(/\s+/g,' ').trim(),
    atlas_animations:{} };
});

const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const embText=l=>`${l.asset_type} ${l.species} static ${l.perspective} ${l.movement} ${l.theme} ${l.playable_role}. ${l.description}`;
const resp=await openai.embeddings.create({model:'text-embedding-3-small',input:finalized.map(embText),dimensions:256});
const b64=f=>Buffer.from(new Float32Array(f).buffer).toString('base64');
const newEmb=finalized.map((l,i)=>({ id:l.id, asset_type:l.asset_type, species:l.species, animation_type:l.animation_type, motion:l.motion, perspective:l.perspective, movement:l.movement, theme:l.theme, playable_role:l.playable_role, frame_count:1, canvas_size:l.canvas_size, source_pack:l.source_pack, quality_score:l.quality_score, confidence_score:l.confidence_score, description:l.description, r2:l.r2, atlas_animations:{}, vec:b64(resp.data[i].embedding) }));

// --- Merge + backfill motion:animated on existing ---
const embPath=path.join(AI,'v2-asset-embeddings.json'), catPath=path.join(AI,'v2-asset-catalog.json');
const emb=JSON.parse(fs.readFileSync(embPath)), cat=JSON.parse(fs.readFileSync(catPath));
let backfilled=0;
for (const it of emb.items) if(!it.motion){ it.motion='animated'; backfilled++; }
for (const it of cat.items) if(!it.motion){ it.motion='animated'; }
const have=new Set(emb.items.map(x=>x.id));
const addE=newEmb.filter(x=>!have.has(x.id)), addC=addE.map(({vec,...r})=>r);
emb.items.push(...addE); emb.builtAt=new Date().toISOString(); fs.writeFileSync(embPath, JSON.stringify(emb));
cat.items.push(...addC); cat.builtAt=new Date().toISOString(); fs.writeFileSync(catPath, JSON.stringify(cat,null,2));
fs.writeFileSync('v2-catalog/staging/static-sprites/_labeled.json', JSON.stringify({items:finalized},null,2));
console.log(`\n✅ backfilled motion:animated on ${backfilled} existing items`);
console.log(`✅ merged ${addE.length} static → catalog now ${cat.items.length} items`);
const anim=cat.items.filter(i=>i.motion==='animated').length, stat=cat.items.filter(i=>i.motion==='static').length;
console.log(`   motion split: ${anim} animated, ${stat} static`);
