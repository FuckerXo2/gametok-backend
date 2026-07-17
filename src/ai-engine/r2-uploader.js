import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Uploads all generated game files in the projectRoot directory to Cloudflare R2 bucket.
 * Matches directories under `games/[jobId]/`.
 * 
 * @param {string} jobId - The generation job ID
 * @param {string} projectRoot - The directory containing Kimi CLI generated files
 * @returns {Promise<string|null>} The public URL to the game's index.html, or null if R2 isn't configured
 */
export async function uploadGameFolderToR2(jobId, projectRoot) {
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        console.warn('⚠️ [R2 Uploader] R2 credentials not fully configured. Skipping upload.');
        return null;
    }

    const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;

    const filesToUpload = [];
    
    async function traverse(dir) {
        let entries = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
            console.error(`[R2 Uploader] Error reading directory ${dir}:`, err.message);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                await traverse(fullPath);
            } else if (entry.isFile()) {
                // Exclude system files, generation briefs, config files, and dotfiles
                if (
                    entry.name === '.DS_Store' ||
                    entry.name === 'instructions.txt' ||
                    entry.name === 'design_brief.md' ||
                    entry.name === 'package.json' ||
                    entry.name === 'package-lock.json' ||
                    entry.name === 'vite.config.js' ||
                    entry.name === 'vite.config.ts' ||
                    entry.name.startsWith('.')
                ) {
                    continue;
                }
                filesToUpload.push(fullPath);
            }
        }
    }

    await traverse(projectRoot);

    console.log(`📤 [R2 Uploader] Found ${filesToUpload.length} files to upload for job ${jobId}`);

    for (const localPath of filesToUpload) {
        const relativePath = path.relative(projectRoot, localPath).replace(/\\/g, '/');
        const key = `games/${jobId}/${relativePath}`;
        const content = await fs.readFile(localPath);
        const contentType = getMimeType(localPath);

        console.log(`📤 [R2 Uploader] Uploading ${relativePath} (${contentType}) to R2...`);
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000',
        });

        await s3Client.send(command);
    }

    const publicUrl = `${publicUrlBase.replace(/\/$/, '')}/games/${jobId}/index.html`;
    console.log(`✅ [R2 Uploader] Upload complete! Game available at: ${publicUrl}`);
    return publicUrl;
}
