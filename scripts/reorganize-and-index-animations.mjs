import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const GLB_DIR = path.join(REPO_ROOT, 'Mixamo Full Motion Pack for UE5 (GLB)');
const CATALOG_PATH = path.join(GLB_DIR, 'animations-catalog.json');

// Deep Taxonomy Classification Rule
export function classifyDeep(filename) {
  const n = filename.toLowerCase();

  // 1. SPORTS & SPECIALIZED ACTIVITIES
  if (/soccer|penalty|football|goalkeeper|kick_up_soccerball|dribbl/.test(n)) {
    return { bucket: 'sports_activities', subBucket: 'soccer' };
  }
  if (/golf/.test(n)) {
    return { bucket: 'sports_activities', subBucket: 'golf' };
  }
  if (/baseball|batter|pitching|umpire|bunt|catcher/.test(n)) {
    return { bucket: 'sports_activities', subBucket: 'baseball' };
  }
  if (/squat|bicep_curl|curl|stretch|burpee|pushup|kettlebell|snatch|bench_press|pullup|treadmill/.test(n)) {
    return { bucket: 'sports_activities', subBucket: 'fitness_gym' };
  }
  if (/piano|bartending|typing|filing_cabinet|phone|cpr|wheelchair|piloting|drive|driving|fishing|torch_equip|grab_torch|equip_torch/.test(n)) {
    return { bucket: 'sports_activities', subBucket: 'lifestyle_interact' };
  }

  // 2. REACTIONS & DAMAGE
  if (/death|die|dead|collapse|defeat|knockout|brutal_assassination|assassinated|hit_by_car/.test(n)) {
    return { bucket: 'reactions', subBucket: 'deaths_defeats' };
  }
  if (/knocked|thrown|tripped|falling_back|fall_to_ground|fall_flat|sweep_fall/.test(n)) {
    return { bucket: 'reactions', subBucket: 'knockdowns_falls' };
  }
  if (/agony|pain|choking|dizzy|poison|electrocute|strangle|injured_walking|injured_idle|limping/.test(n)) {
    return { bucket: 'reactions', subBucket: 'agony_injury' };
  }
  if (/hit|blow|gut|head_hit|stumble|stagger|groin|impact|taking_punch/.test(n)) {
    return { bucket: 'reactions', subBucket: 'hits_impacts' };
  }

  // 3. COMBAT
  if (/rifle|pistol|gun|sniper|firing|reload|shoot|aim|prone_firing|cover_fire|crouch_fire/.test(n)) {
    return { bucket: 'combat', subBucket: 'guns_ranged' };
  }
  if (/sword|shield|great_sword|greatsword|blade|katana|spear|axe|slash|stab|parry|torch_melee|melee_attack/.test(n)) {
    return { bucket: 'combat', subBucket: 'swords_blades' };
  }
  if (/spell|magic|cast|summon|wand|staff/.test(n)) {
    return { bucket: 'combat', subBucket: 'magic_spells' };
  }
  if (/punch|kick|boxing|jab|cross|hook|uppercut|brawl|takedown|knee|elbow|strike|combo|armada|esquiva|au_|martelo|bencao|ginga|block|inward_block|fight|blocking/.test(n)) {
    return { bucket: 'combat', subBucket: 'melee_unarmed' };
  }

  // 4. EMOTES & SOCIAL
  if (/dance|dancing|breakdance|uprock|bboy|samba|salsa|swing_dance|hip_hop|northern_soul|soul_floor/.test(n)) {
    return { bucket: 'emotes_social', subBucket: 'dances' };
  }
  if (/cheer|applause|clap|celebrat|victory|fist_pump|yell|boast|hooray/.test(n)) {
    return { bucket: 'emotes_social', subBucket: 'cheers_victory' };
  }
  if (/taunt|cocky|flair|kiss|blow_a_kiss|catwalk|swagger|flexing|insult/.test(n)) {
    return { bucket: 'emotes_social', subBucket: 'taunts_attitude' };
  }
  if (/wave|bow|point|shrug|nod|head_shake|agree|acknowledg|asking|talk|arguing|begging|crying|salute|handshake|shaking_hands|gesture|beckon|bashful|bored|angry|annoy|disagree/.test(n)) {
    return { bucket: 'emotes_social', subBucket: 'gestures_talk' };
  }

  // 5. LOCOMOTION
  if (/zombie|orc_walk|drunk_walk|stroll_limp/.test(n)) {
    return { bucket: 'locomotion', subBucket: 'monster_stylized' };
  }
  if (/crouch|crawl|sneak|creeping|kneel_walk|cover_sneak|low_crawl/.test(n)) {
    return { bucket: 'locomotion', subBucket: 'crouch_stealth' };
  }
  if (/climb|hang|shimmy|vault|roll|flip|cartwheel|dive_roll|dive|mantle|ledge|drop|land|landing|parkour/.test(n)) {
    return { bucket: 'locomotion', subBucket: 'parkour_climbing' };
  }
  if (/jump|hop|skip|leap|box_jump|running_jump|forward_jump/.test(n)) {
    return { bucket: 'locomotion', subBucket: 'jumps_leaps' };
  }
  if (/walk|run|sprint|jog|strafe|turn|step|dash|stairs|evade|dodge|slide|stroll|backward|forward|arc/.test(n)) {
    return { bucket: 'locomotion', subBucket: 'basic' };
  }

  // 6. IDLES & STANCES
  if (/fight_idle|combat_idle|guard|aim_idle|ready|ninja_idle|warrior_idle|boxing_idle|stance|torch_idle/.test(n)) {
    return { bucket: 'idles_stances', subBucket: 'combat_ready' };
  }
  if (/crouch_idle|kneel_idle|laying|prone|crawl_idle|floor_idle/.test(n)) {
    return { bucket: 'idles_stances', subBucket: 'crouch_ground' };
  }
  if (/sit|sitting|chair|bench/.test(n)) {
    return { bucket: 'idles_stances', subBucket: 'seated' };
  }

  return { bucket: 'idles_stances', subBucket: 'standing_relaxed' };
}

async function reorganize() {
  console.log('🔄 [Reorganizer] Reading catalog from:', CATALOG_PATH);
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('❌ Catalog not found at:', CATALOG_PATH);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const animations = catalog.animations || [];
  console.log(`📦 Loaded ${animations.length} animations.`);

  // Find all existing .glb files on disk
  const existingFiles = new Map();
  function scan(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (item.endsWith('.glb')) {
        existingFiles.set(item, fullPath);
      }
    }
  }
  scan(GLB_DIR);
  console.log(`🔍 Found ${existingFiles.size} .glb files across all subdirectories.`);

  const newCounts = {};
  const updatedAnimations = [];

  for (const anim of animations) {
    const originalFbx = anim.originalFbx || anim.cleanName;
    const { bucket, subBucket } = classifyDeep(originalFbx);

    const targetSubDir = path.join(GLB_DIR, bucket, subBucket);
    fs.mkdirSync(targetSubDir, { recursive: true });

    const fileName = anim.fileName || `${anim.id}.glb`;
    const targetFilePath = path.join(targetSubDir, fileName);

    // Look up current location of file
    const currentPath = existingFiles.get(fileName);
    if (currentPath && currentPath !== targetFilePath) {
      fs.renameSync(currentPath, targetFilePath);
      existingFiles.set(fileName, targetFilePath);
    }

    const relativePath = `${bucket}/${subBucket}/${fileName}`;

    newCounts[bucket] = (newCounts[bucket] || 0) + 1;
    newCounts[`${bucket}/${subBucket}`] = (newCounts[`${bucket}/${subBucket}`] || 0) + 1;

    updatedAnimations.push({
      ...anim,
      bucket,
      subBucket,
      relativePath,
    });
  }

  // Remove old empty top-level folders if they are empty
  const oldFolders = ['actions_sports', 'combat', 'emotes', 'idles', 'locomotion', 'reactions'];
  for (const old of oldFolders) {
    const oldPath = path.join(GLB_DIR, old);
    if (fs.existsSync(oldPath)) {
      const files = fs.readdirSync(oldPath);
      if (files.length === 0) {
        fs.rmdirSync(oldPath);
      }
    }
  }

  const updatedCatalog = {
    generatedAt: new Date().toISOString(),
    totalAnimations: updatedAnimations.length,
    taxonomy: {
      combat: ['swords_blades', 'guns_ranged', 'melee_unarmed', 'magic_spells'],
      locomotion: ['basic', 'jumps_leaps', 'crouch_stealth', 'parkour_climbing', 'monster_stylized'],
      idles_stances: ['standing_relaxed', 'combat_ready', 'crouch_ground', 'seated'],
      reactions: ['hits_impacts', 'deaths_defeats', 'knockdowns_falls', 'agony_injury'],
      emotes_social: ['dances', 'cheers_victory', 'gestures_talk', 'taunts_attitude'],
      sports_activities: ['soccer', 'golf', 'baseball', 'fitness_gym', 'lifestyle_interact'],
    },
    counts: newCounts,
    animations: updatedAnimations,
  };

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(updatedCatalog, null, 2));

  // Save to backend
  const backendCatalogPath = path.join(__dirname, '../src/ai-engine/animations-catalog.json');
  fs.writeFileSync(backendCatalogPath, JSON.stringify(updatedCatalog, null, 2));

  console.log('✅ Reorganization complete!');
  console.log('📊 Category breakdown:');
  for (const [k, v] of Object.entries(updatedCatalog.taxonomy)) {
    console.log(`   📁 ${k}: ${newCounts[k] || 0} animations`);
    for (const sub of v) {
      console.log(`      ├── ${sub}: ${newCounts[`${k}/${sub}`] || 0}`);
    }
  }
}

reorganize().catch(console.error);
