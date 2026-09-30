import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Polyfills for Node environment
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {};
}

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      }).catch((err) => {
        if (this.onerror) this.onerror(err);
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  };
}

// Filter verbose Three.js FBXLoader warnings
const origWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Encountered a unused curve')) return;
  origWarn(...args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIR = path.join(REPO_ROOT, 'Mixamo Full Motion Pack for UE5 (FBX)');
const OUTPUT_DIR = path.join(REPO_ROOT, 'Mixamo Full Motion Pack for UE5 (GLB)');

export const BUCKETS = {
  reactions: 'reactions',
  combat: 'combat',
  emotes: 'emotes',
  idles: 'idles',
  locomotion: 'locomotion',
  actions_sports: 'actions_sports',
};

export function classifyAnimation(filename) {
  const n = filename.toLowerCase();

  // 1. Reactions (damage, deaths, pain, agony, stumbles)
  if (/hit_|injured|hurt|head_hit|stumble|stagger|falling|collapse|death|die|dead|defeat|knockout|blown|impact|groin|agony|pain|choking|dizzy|poison|electrocute/.test(n)) {
    return BUCKETS.reactions;
  }

  // 2. Combat (melee, weapons, guns, spells, martial arts, capoeira)
  if (/punch|kick|fight|boxing|brawl|takedown|knee|elbow|block|strike|sword|shield|axe|spear|blade|katana|hammer|melee|slash|stab|rifle|pistol|gun|aim|shoot|fire|reload|sniper|prone|cast|spell|magic|summon|wand|staff|assassin|combo|armada|esquiva|martial/.test(n)) {
    return BUCKETS.combat;
  }

  // 3. Emotes & Social (dances, cheers, catwalk, gestures, talking, reactions)
  if (/dance|dancing|catwalk|cheer|bow|clap|taunt|wave|laugh|salute|applause|shaking_hands|gesture|flair|agree|acknowledg|angry|annoy|asking|shrug|nod|head_shake|pointing|point_|talk|arguing|begging|crying|celebrat|yell|boast|disagree/.test(n)) {
    return BUCKETS.emotes;
  }

  // 4. Idles & Stances
  if (/idle|standing|pose|wait|look_around|resting|sit|laying|crouch_idle|kneel_idle|watch/.test(n)) {
    return BUCKETS.idles;
  }

  // 5. Locomotion (walk, run, sprint, jump, parkour, stealth, stairs, evade)
  if (/walk|run|sprint|jog|jump|hop|skip|strafe|turn|step|dash|crouch|crawl|sneak|climb|vault|roll|flip|cartwheel|dive|stairs|evade|dodge|slide|stroll/.test(n)) {
    return BUCKETS.locomotion;
  }

  // 6. Actions & Sports / Everyday Interactions
  return BUCKETS.actions_sports;
}

export function cleanAnimationName(filename) {
  let name = filename;
  name = name.replace(/^[Mm]ixamo_/, '');
  name = name.replace(/_[Mm]ixamo_[Mm]otion\.[Ff]bx$/i, '');
  name = name.replace(/\.[Ff]bx$/i, '');
  name = name.replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  return name || 'motion';
}

export async function convertFbxFile(filePath, loader, exporter) {
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const fbxGroup = loader.parse(arrayBuffer, '');
  const animations = fbxGroup.animations || [];
  const clip = animations[0] || null;

  const gltf = await exporter.parseAsync(fbxGroup, {
    binary: true,
    animations: animations,
  });

  return {
    glbBuffer: Buffer.from(gltf),
    duration: clip ? parseFloat(clip.duration.toFixed(2)) : 0,
    tracksCount: clip ? clip.tracks.length : 0,
    clipName: clip ? clip.name : '',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const testLimit = args.includes('--test') ? 5 : null;

  console.log('🚀 [Mixamo Converter] Scanning files from:', SOURCE_DIR);
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('❌ Source directory not found:', SOURCE_DIR);
    process.exit(1);
  }

  // Create target directories
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const bucket of Object.values(BUCKETS)) {
    fs.mkdirSync(path.join(OUTPUT_DIR, bucket), { recursive: true });
  }

  const allFiles = fs.readdirSync(SOURCE_DIR).filter((f) => f.toLowerCase().endsWith('.fbx')).sort();
  const filesToProcess = testLimit ? allFiles.slice(0, testLimit) : allFiles;
  console.log(`📦 Found ${allFiles.length} FBX files total. Processing: ${filesToProcess.length}`);

  const loader = new FBXLoader();
  const exporter = new GLTFExporter();

  const nameCounts = new Map();
  const catalog = {
    generatedAt: new Date().toISOString(),
    totalAnimations: 0,
    countsByBucket: {},
    animations: [],
  };

  for (const b of Object.values(BUCKETS)) {
    catalog.countsByBucket[b] = 0;
  }

  const startTime = Date.now();
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const fbxFileName = filesToProcess[i];
    const fullSourcePath = path.join(SOURCE_DIR, fbxFileName);

    try {
      const bucket = classifyAnimation(fbxFileName);
      let cleanName = cleanAnimationName(fbxFileName);

      // Handle duplicate clean names by appending suffix
      const count = (nameCounts.get(cleanName) || 0) + 1;
      nameCounts.set(cleanName, count);
      const uniqueName = count > 1 ? `${cleanName}_v${count}` : cleanName;
      const glbFileName = `${uniqueName}.glb`;
      const relativeGlbPath = path.join(bucket, glbFileName);
      const targetGlbPath = path.join(OUTPUT_DIR, relativeGlbPath);

      // Convert
      const { glbBuffer, duration, tracksCount, clipName } = await convertFbxFile(fullSourcePath, loader, exporter);
      fs.writeFileSync(targetGlbPath, glbBuffer);

      catalog.animations.push({
        id: uniqueName,
        cleanName,
        fileName: glbFileName,
        bucket,
        relativePath: relativeGlbPath,
        originalFbx: fbxFileName,
        duration,
        tracksCount,
        clipName,
        sizeKb: parseFloat((glbBuffer.length / 1024).toFixed(1)),
      });

      catalog.countsByBucket[bucket]++;
      catalog.totalAnimations++;
      completed++;

      if (completed % 25 === 0 || testLimit || i === filesToProcess.length - 1) {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const percent = (((i + 1) / filesToProcess.length) * 100).toFixed(1);
        console.log(`✅ [${percent}%] ${i + 1}/${filesToProcess.length} converted (${elapsedSec}s elapsed) -> ${bucket}/${glbFileName}`);
      }
    } catch (err) {
      console.error(`❌ Failed converting "${fbxFileName}":`, err.message);
      failed++;
    }
  }

  // Save master catalog JSON
  const catalogPath1 = path.join(OUTPUT_DIR, 'animations-catalog.json');
  fs.writeFileSync(catalogPath1, JSON.stringify(catalog, null, 2));

  // Also save a copy inside backend for Hermes / Gemini integration
  const backendCatalogDir = path.join(__dirname, '../src/ai-engine');
  if (fs.existsSync(backendCatalogDir)) {
    const catalogPath2 = path.join(backendCatalogDir, 'animations-catalog.json');
    fs.writeFileSync(catalogPath2, JSON.stringify(catalog, null, 2));
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n🎉 [Conversion Complete!]');
  console.log(`⏱️ Total time: ${totalSec}s`);
  console.log(`✅ Completed: ${completed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('📊 Bucket breakdown:');
  for (const [b, c] of Object.entries(catalog.countsByBucket)) {
    console.log(`   - ${b}: ${c}`);
  }
  console.log('📁 Catalog written to:', catalogPath1);
}

main().catch(console.error);
