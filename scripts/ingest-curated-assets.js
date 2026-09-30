import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { universalAssetIngestor } from '../src/ai-engine/asset-engine/ingestor/universal-asset-ingestor.js';

/**
 * GameTok Curated Asset Ingestion CLI
 * 
 * Ingests local 3D assets (GLB, OBJ, FBX) and standalone animations into
 * PostgreSQL `asset_catalog` / `animation_catalog` and Cloudflare R2 CDN.
 * 
 * Usage:
 *   node scripts/ingest-curated-assets.js --file=./path/to/knight.glb --category=characters --style=stylized
 *   node scripts/ingest-curated-assets.js --file=./path/to/run.fbx --type=standalone_animation --rig=humanoid_standard_v1 --action=run
 *   node scripts/ingest-curated-assets.js --dir=./assets/props --category=props --style=low-poly
 */

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    for (const arg of args) {
        if (arg.startsWith('--')) {
            const [k, v] = arg.replace(/^--/, '').split('=');
            options[k] = v === undefined ? true : v;
        }
    }
    return options;
}

async function run() {
    const opts = parseArgs();
    const filePath = opts.file;
    const dirPath = opts.dir;

    if (!filePath && !dirPath) {
        console.error(`❌ Please provide --file=<path> or --dir=<path>`);
        console.log(`Examples:`);
        console.log(`  node scripts/ingest-curated-assets.js --file=./models/knight.glb --category=characters --style=stylized`);
        console.log(`  node scripts/ingest-curated-assets.js --file=./anims/sword_slash.fbx --type=standalone_animation --rig=humanoid_standard_v1 --action=sword_slash`);
        console.log(`  node scripts/ingest-curated-assets.js --dir=./models/props --category=props --style=low-poly`);
        process.exit(1);
    }

    const category = opts.category || 'props';
    const style = opts.style || 'stylized';
    const isStandaloneAnim = opts.type === 'standalone_animation' || opts.type === 'animation';
    const rigTarget = opts.rig || opts.rigTarget || 'humanoid_standard_v1';
    const action = opts.action || 'motion';

    if (filePath) {
        console.log(`🚀 Ingesting single file: "${filePath}"...`);
        const buffer = await fs.readFile(path.resolve(filePath));
        const filename = path.basename(filePath);

        const result = await universalAssetIngestor.ingest({
            buffer,
            filename,
            category,
            style,
            targetType: isStandaloneAnim ? 'standalone_animation' : '3d_model',
            animationMetadata: {
                rigTarget,
                action,
                category: opts.animCategory || 'locomotion',
                role: opts.role || 'neutral',
                durationSeconds: Number(opts.duration) || 1.2
            },
            source: 'gametok-curated',
            license: opts.license || 'GameTok-Proprietary',
            attribution: opts.attribution || 'GameTok Studios'
        });

        console.log(`\n✅ Ingestion complete!`);
        console.log(`   • ID: ${result.id}`);
        console.log(`   • Name: ${result.name}`);
        console.log(`   • CDN URL: ${result.cdn_url}`);
        process.exit(0);
    }

    if (dirPath) {
        console.log(`🚀 Ingesting directory: "${dirPath}"...`);
        const resolvedDir = path.resolve(dirPath);
        const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

        const supportedExts = ['.glb', '.gltf', '.fbx', '.obj'];
        const files = entries.filter(e => e.isFile() && supportedExts.includes(path.extname(e.name).toLowerCase()));

        console.log(`📂 Found ${files.length} supported asset files.`);

        let successCount = 0;
        for (const file of files) {
            try {
                const fullPath = path.join(resolvedDir, file.name);
                const buffer = await fs.readFile(fullPath);

                const result = await universalAssetIngestor.ingest({
                    buffer,
                    filename: file.name,
                    category,
                    style,
                    source: 'gametok-curated',
                    license: opts.license || 'GameTok-Curated',
                    attribution: 'GameTok Curated Library'
                });

                console.log(`  ✅ Ingested [${successCount + 1}/${files.length}]: "${result.name}" → ${result.cdn_url}`);
                successCount++;
            } catch (err) {
                console.error(`  ❌ Failed to ingest "${file.name}":`, err.message);
            }
        }

        console.log(`\n🎉 Ingestion finished! Successfully cataloged ${successCount}/${files.length} assets.`);
        process.exit(0);
    }
}

run().catch(err => {
    console.error('Fatal Ingestion Error:', err);
    process.exit(1);
});
