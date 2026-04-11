import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_SOURCE_ROOT = '/Users/abiolalimitless/gameidea/Kenney Game Assets All-in-1 3';
const DEFAULT_SUMMARY_OUT = path.join(REPO_ROOT, 'docs', 'kenney-library-summary.json');

const sectionRuntimeMap = {
  '2D assets': 'canvas2d',
  '3D assets': 'threejs',
  'UI assets': 'ui',
  'Icons': 'ui',
  'Audio': 'audio',
};

const IGNORED_EXTENSIONS = new Set([
  '.txt',
  '.url',
  '.html',
  '.swf',
  '.pdf',
  '.ase',
  '.psd',
  '.xcf',
  '.db',
  '.meta',
]);

const FILE_KIND_MAP = new Map([
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.webp', 'image'],
  ['.svg', 'vector'],
  ['.glb', 'model_3d'],
  ['.gltf', 'model_3d'],
  ['.fbx', 'model_source'],
  ['.obj', 'model_source'],
  ['.mtl', 'model_material'],
  ['.wav', 'audio'],
  ['.mp3', 'audio'],
  ['.ogg', 'audio'],
  ['.m4a', 'audio'],
  ['.xml', 'metadata'],
  ['.json', 'metadata'],
  ['.tmx', 'metadata'],
  ['.tsx', 'metadata'],
]);

const laneKeywordMap = {
  endless_flyer: ['tappy', 'plane', 'flappy', 'jumper', 'ski'],
  pixel_platformer: ['platformer', 'pico-8', 'roguelike', 'scribble platformer', 'pixel platformer', 'new platformer'],
  topdown_arcade: ['topdown shooter', 'desert shooter', 'racing', 'tank', 'road', 'vehicle'],
  auto_battler_arena: ['tiny battle', 'rts', 'tower defense', 'pirate', 'medieval', 'battle'],
  first_person_threejs: ['mini dungeon', 'survival kit', 'graveyard', 'weapon pack', 'dungeon', 'blocky characters', 'animated characters', 'city kit', 'nature kit'],
};

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenize(value) {
  return String(value || '')
    .replace(/[_()]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function getFileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return FILE_KIND_MAP.get(ext) || null;
}

function isPreviewLike(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name.includes('preview') || name.includes('sample');
}

function collectFiles(dir, bucket = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, bucket);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) continue;
    const kind = getFileKind(fullPath);
    if (!kind) continue;
    bucket.push({ fullPath, ext, kind });
  }
  return bucket;
}

function inferLanes(sectionName, packName) {
  const haystack = `${sectionName} ${packName}`.toLowerCase();
  const results = [];
  for (const [lane, keywords] of Object.entries(laneKeywordMap)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      results.push(lane);
    }
  }
  if (!results.length && sectionName === '3D assets') {
    results.push('first_person_threejs');
  }
  return results;
}

function buildPackSummary(sectionName, packName, packDir) {
  const files = collectFiles(packDir);
  const counts = {
    usableFiles: files.length,
    image: 0,
    vector: 0,
    model3d: 0,
    modelSource: 0,
    audio: 0,
    metadata: 0,
  };

  for (const file of files) {
    if (file.kind === 'image') counts.image += 1;
    else if (file.kind === 'vector') counts.vector += 1;
    else if (file.kind === 'model_3d') counts.model3d += 1;
    else if (file.kind === 'model_source' || file.kind === 'model_material') counts.modelSource += 1;
    else if (file.kind === 'audio') counts.audio += 1;
    else if (file.kind === 'metadata') counts.metadata += 1;
  }

  const previewFiles = files
    .filter((file) => file.kind === 'image' && isPreviewLike(file.fullPath))
    .slice(0, 4)
    .map((file) => path.relative(REPO_ROOT, file.fullPath));

  const sampleFiles = files
    .filter((file) => !isPreviewLike(file.fullPath))
    .slice(0, 6)
    .map((file) => path.relative(REPO_ROOT, file.fullPath));

  const tokens = new Set([
    ...tokenize(sectionName),
    ...tokenize(packName),
  ]);

  const lanes = inferLanes(sectionName, packName);
  const recommendedRuntime = sectionRuntimeMap[sectionName] || 'unknown';

  return {
    section: sectionName,
    packName,
    slug: slugify(`${sectionName}-${packName}`),
    sourcePath: packDir,
    recommendedRuntime,
    lanes,
    tags: Array.from(tokens).slice(0, 12),
    counts,
    previewFiles,
    sampleFiles,
  };
}

function summarizeSection(sectionName, packs) {
  return {
    section: sectionName,
    packCount: packs.length,
    usableFiles: packs.reduce((sum, pack) => sum + pack.counts.usableFiles, 0),
    imageFiles: packs.reduce((sum, pack) => sum + pack.counts.image, 0),
    modelFiles: packs.reduce((sum, pack) => sum + pack.counts.model3d, 0),
    audioFiles: packs.reduce((sum, pack) => sum + pack.counts.audio, 0),
    topPacks: [...packs]
      .sort((a, b) => b.counts.usableFiles - a.counts.usableFiles)
      .slice(0, 8)
      .map((pack) => ({
        packName: pack.packName,
        lanes: pack.lanes,
        recommendedRuntime: pack.recommendedRuntime,
        usableFiles: pack.counts.usableFiles,
      })),
  };
}

function buildLaneCandidates(packs) {
  const result = {};
  for (const lane of Object.keys(laneKeywordMap)) {
    result[lane] = packs
      .filter((pack) => pack.lanes.includes(lane))
      .sort((a, b) => b.counts.usableFiles - a.counts.usableFiles)
      .slice(0, 10)
      .map((pack) => ({
        packName: pack.packName,
        section: pack.section,
        recommendedRuntime: pack.recommendedRuntime,
        usableFiles: pack.counts.usableFiles,
        previewFiles: pack.previewFiles.slice(0, 2),
      }));
  }
  return result;
}

function main() {
  const sourceRoot = process.argv[2] || DEFAULT_SOURCE_ROOT;
  const summaryOut = process.argv[3] || DEFAULT_SUMMARY_OUT;

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Kenney source root not found: ${sourceRoot}`);
  }

  const sectionDirs = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const allPacks = [];

  for (const sectionName of sectionDirs) {
    const sectionPath = path.join(sourceRoot, sectionName);
    const packDirs = fs.readdirSync(sectionPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const packName of packDirs) {
      const packDir = path.join(sectionPath, packName);
      allPacks.push(buildPackSummary(sectionName, packName, packDir));
    }
  }

  const sections = sectionDirs.map((sectionName) => {
    const packs = allPacks.filter((pack) => pack.section === sectionName);
    return summarizeSection(sectionName, packs);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    totals: {
      packCount: allPacks.length,
      usableFiles: allPacks.reduce((sum, pack) => sum + pack.counts.usableFiles, 0),
      imageFiles: allPacks.reduce((sum, pack) => sum + pack.counts.image, 0),
      modelFiles: allPacks.reduce((sum, pack) => sum + pack.counts.model3d, 0),
      audioFiles: allPacks.reduce((sum, pack) => sum + pack.counts.audio, 0),
    },
    sections,
    laneCandidates: buildLaneCandidates(allPacks),
    packs: allPacks,
  };

  fs.mkdirSync(path.dirname(summaryOut), { recursive: true });
  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));

  console.log(`Indexed ${summary.totals.packCount} packs and ${summary.totals.usableFiles} usable files.`);
  console.log(`Wrote summary to ${summaryOut}`);
}

main();
