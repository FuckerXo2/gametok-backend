import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_SOURCE_ROOT, RUNTIME_EXTENSIONS, WAVE1_PACKS } from './kenney_wave1_config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY_PATH = path.join(REPO_ROOT, 'docs', 'kenney-library-summary.json');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-manifest.json');

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collectFiles(dir, bucket = []) {
  if (!fs.existsSync(dir)) return bucket;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, bucket);
    } else {
      bucket.push(fullPath);
    }
  }
  return bucket;
}

function shouldIncludeFile(fullPath, runtime) {
  const normalized = fullPath.replace(/\\/g, '/');
  const ext = path.extname(fullPath).toLowerCase();
  const allowed = RUNTIME_EXTENSIONS[runtime];
  if (!allowed || !allowed.has(ext)) return false;

  if (runtime === 'threejs') {
    return normalized.includes('/Models/GLB format/') || normalized.includes('/Previews/');
  }

  if (runtime === 'audio') {
    return true;
  }

  if (runtime === 'ui') {
    if (normalized.includes('/Sprites/') || normalized.includes('/Icons/') || normalized.includes('/PNG/') || normalized.includes('/UI/')) return true;
    if (normalized.includes('/Preview') || normalized.includes('/Sample')) return false;
    return true;
  }

  if (runtime === 'canvas2d') {
    if (normalized.includes('/Vector/') || normalized.includes('/Spritesheet/') || normalized.includes('/Tilesheet/') || normalized.includes('/Tiled/')) return false;
    if (normalized.includes('/Preview') || normalized.includes('/Sample')) return false;
    return true;
  }

  return false;
}

function classifyKind(runtime, fullPath) {
  const normalized = fullPath.replace(/\\/g, '/').toLowerCase();
  const ext = path.extname(fullPath).toLowerCase();
  if (runtime === 'audio') return 'audio';
  if (runtime === 'threejs') {
    if (ext === '.glb') return 'model';
    return 'preview';
  }
  if (runtime === 'ui') {
    if (normalized.includes('/icons/')) return 'icon';
    if (normalized.includes('/sprites/')) return 'control';
    return 'ui';
  }
  if (normalized.includes('/planes/')) return 'character';
  if (normalized.includes('/zombie ') || normalized.includes('/survivor') || normalized.includes('/soldier') || normalized.includes('/robot') || normalized.includes('/man ') || normalized.includes('/woman ') || normalized.includes('/hitman')) return 'character';
  if (normalized.includes('/tiles/') || normalized.includes('tile_') || normalized.includes('ground') || normalized.includes('background')) return 'environment';
  if (normalized.includes('weapon_')) return 'weapon';
  if (normalized.includes('particle') || normalized.includes('puff') || normalized.includes('smoke')) return 'fx';
  return 'sprite';
}

function main() {
  const sourceRoot = process.argv[2] || DEFAULT_SOURCE_ROOT;
  const outputPath = process.argv[3] || DEFAULT_OUTPUT_PATH;

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const packsByKey = new Map(
    inventory.packs.map((pack) => [`${pack.section}::${pack.packName}`, pack])
  );

  const manifestEntries = [];

  for (const config of WAVE1_PACKS) {
    const key = `${config.section}::${config.packName}`;
    const inventoryPack = packsByKey.get(key);
    if (!inventoryPack) continue;

    const packRoot = path.join(sourceRoot, config.section, config.packName);
    const packSlug = slugify(config.packName);
    const files = collectFiles(packRoot)
      .filter((fullPath) => shouldIncludeFile(fullPath, config.runtime))
      .map((fullPath) => {
        const relativeFromPack = path.relative(packRoot, fullPath).replace(/\\/g, '/');
        const filename = path.basename(fullPath);
        return {
          lane: config.lane,
          runtime: config.runtime,
          role: config.role,
          section: config.section,
          packName: config.packName,
          packSlug,
          kind: classifyKind(config.runtime, fullPath),
          sourcePath: fullPath,
          relativeFromPack,
          targetPath: `${config.lane}/${packSlug}/${relativeFromPack}`,
          filename,
        };
      });

    manifestEntries.push({
      lane: config.lane,
      runtime: config.runtime,
      role: config.role,
      section: config.section,
      packName: config.packName,
      packSlug,
      sourceRoot: packRoot,
      inventoryCounts: inventoryPack.counts,
      stagedFileCount: files.length,
      files,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    manifestVersion: 1,
    totals: {
      packs: manifestEntries.length,
      files: manifestEntries.reduce((sum, entry) => sum + entry.files.length, 0),
    },
    lanes: Object.fromEntries(
      [...new Set(manifestEntries.map((entry) => entry.lane))].map((lane) => [
        lane,
        {
          packs: manifestEntries.filter((entry) => entry.lane === lane).map((entry) => ({
            packName: entry.packName,
            runtime: entry.runtime,
            role: entry.role,
            stagedFileCount: entry.stagedFileCount,
          })),
        },
      ])
    ),
    entries: manifestEntries,
  };

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`Built Wave 1 manifest with ${summary.totals.packs} packs and ${summary.totals.files} staged files.`);
  console.log(`Wrote manifest to ${outputPath}`);
}

main();
