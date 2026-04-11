import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const archiveUrl = process.argv[2];
const targetRoot = process.argv[3] || '/app/storage';

if (!archiveUrl) {
  console.error('Usage: node scripts/seed_railway_kenney_volume.mjs <archive-url> [target-root]');
  process.exit(1);
}

async function main() {
  const archivePath = path.join(targetRoot, 'kenney-wave1.tar.gz');

  fs.mkdirSync(targetRoot, { recursive: true });

  console.log(`Downloading ${archiveUrl} -> ${archivePath}`);
  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);
  console.log(`Saved ${buffer.length} bytes`);

  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archivePath, '-C', targetRoot], { stdio: 'inherit' });
    tar.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
    tar.on('error', reject);
  });

  fs.unlinkSync(archivePath);
  console.log(`Extracted into ${path.join(targetRoot, 'kenney-wave1')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
