import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-manifest.json');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-catalog.json');

function buildPublicUrl(targetPath) {
  return `/uploads/kenney-wave1/${targetPath.replace(/\\/g, '/')}`;
}

function inferTags(file) {
  const source = `${file.packName} ${file.kind} ${file.filename} ${file.relativeFromPack}`.toLowerCase();
  return [...new Set(
    source
      .replace(/[_().-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length > 1)
  )].slice(0, 20);
}

function main() {
  const manifestPath = process.argv[2] || DEFAULT_MANIFEST_PATH;
  const outputPath = process.argv[3] || DEFAULT_OUTPUT_PATH;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const assets = [];
  for (const entry of manifest.entries || []) {
    for (const file of entry.files || []) {
      assets.push({
        lane: entry.lane,
        runtime: entry.runtime,
        role: entry.role,
        section: entry.section,
        packName: entry.packName,
        packSlug: entry.packSlug,
        kind: file.kind,
        filename: file.filename,
        relativeFromPack: file.relativeFromPack,
        targetPath: file.targetPath,
        url: buildPublicUrl(file.targetPath),
        tags: inferTags(file),
      });
    }
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.manifestVersion || 1,
    totals: {
      assets: assets.length,
      lanes: [...new Set(assets.map((asset) => asset.lane))].length,
      packs: [...new Set(assets.map((asset) => `${asset.section}::${asset.packName}`))].length,
    },
    byLane: Object.fromEntries(
      [...new Set(assets.map((asset) => asset.lane))].map((lane) => [
        lane,
        assets.filter((asset) => asset.lane === lane),
      ])
    ),
    assets,
  };

  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));
  console.log(`Built Wave 1 catalog with ${catalog.totals.assets} assets.`);
  console.log(`Wrote catalog to ${outputPath}`);
}

main();
