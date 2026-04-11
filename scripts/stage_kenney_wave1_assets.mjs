import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-manifest.json');
const DEFAULT_STAGE_ROOT = path.join(REPO_ROOT, 'public', 'uploads', 'kenney-wave1');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFilePreserve(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function main() {
  const manifestPath = process.argv[2] || DEFAULT_MANIFEST_PATH;
  const stageRoot = process.argv[3] || DEFAULT_STAGE_ROOT;

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ensureDir(stageRoot);

  let copied = 0;
  for (const entry of manifest.entries || []) {
    for (const file of entry.files || []) {
      const targetPath = path.join(stageRoot, file.targetPath);
      copyFilePreserve(file.sourcePath, targetPath);
      copied += 1;
    }
  }

  const manifestCopyPath = path.join(stageRoot, 'manifest.json');
  fs.writeFileSync(manifestCopyPath, JSON.stringify(manifest, null, 2));

  console.log(`Copied ${copied} files into ${stageRoot}`);
  console.log(`Copied manifest to ${manifestCopyPath}`);
}

main();
