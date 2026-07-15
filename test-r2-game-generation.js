#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { buildClaudeStylePrompt } from './src/ai-engine/maker-claude-style-prompt.js';
import { runKimiCliAgent } from './src/ai-engine/maker-kimi-cli-runner.js';
import { verifyGame } from './src/ai-engine/sandbox.js';
import { uploadGameFolderToR2 } from './src/ai-engine/r2-uploader.js';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startLocalServer(projectRoot) {
    return new Promise((resolve, reject) => {
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

        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            let filePath = path.join(projectRoot, urlPath);
            
            fs.stat(filePath, (err, stats) => {
                if (!err && stats.isDirectory()) {
                    filePath = path.join(filePath, 'index.html');
                }
                
                fs.readFile(filePath, (readErr, data) => {
                    if (readErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('404 Not Found');
                        return;
                    }
                    const ext = path.extname(filePath).toLowerCase();
                    const contentType = mimeTypes[ext] || 'application/octet-stream';
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(data);
                });
            });
        });

        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = address.port;
            console.log(`📡 [Test Server] Serving ${projectRoot} on http://127.0.0.1:${port}`);
            resolve({
                url: `http://127.0.0.1:${port}/index.html`,
                close: () => new Promise((closeRes) => server.close(closeRes)),
            });
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

async function main() {
    const prompt = process.argv[2] || 'Create a simple endless runner game where you jump over obstacles';
    
    console.log('🚀 Testing GameTok R2 & Framework-Agnostic Generation Pipeline');
    console.log(`📝 Prompt: "${prompt}"`);
    console.log('');

    if (!process.env.MOONSHOT_API_KEY) {
        console.error('❌ Error: MOONSHOT_API_KEY is not set in the environment.');
        process.exit(1);
    }

    const jobId = `test-job-${Math.random().toString(36).substring(2, 9)}`;
    const testDir = path.join(__dirname, 'generated-games', jobId);

    try {
        // 1. Create workspace
        await fs.mkdir(testDir, { recursive: true });
        console.log(`📁 Created temp workspace at: ${testDir}`);

        // 2. Build Claude-style prompt instructions with asset details
        console.log('🔨 Preparing Kimi instructions and design brief...');
        const { system, user } = await buildClaudeStylePrompt(prompt);

        // 3. Run Kimi CLI directly in the workspace
        console.log('🤖 Spawning Kimi CLI agent loop...');
        await runKimiCliAgent(testDir, system, user);

        // 4. Spin up local static server
        console.log('📡 Starting local HTTP server...');
        const localServer = await startLocalServer(testDir);

        // 5. Verify the generated game via Puppeteer
        console.log('🕵️ Running sandbox verification...');
        const rawGameHtml = await fs.readFile(path.join(testDir, 'index.html'), 'utf-8').catch(() => '');
        const sandboxRes = await verifyGame(localServer.url, { sourceHtml: rawGameHtml });
        
        console.log('📋 Sandbox Results:', JSON.stringify(sandboxRes, null, 2));

        // Close server
        await localServer.close();

        // 6. Upload to R2 if configured
        let publicUrl = null;
        if (process.env.R2_BUCKET_NAME) {
            console.log('☁️ Uploading folder to Cloudflare R2...');
            publicUrl = await uploadGameFolderToR2(jobId, testDir);
        } else {
            console.log('⚠️ Skipping R2 upload: R2_BUCKET_NAME is not set.');
        }

        // 7. Generate redirect HTML
        const redirectHtml = publicUrl ? `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0; url=${publicUrl}">
</head>
<body>
    <script>window.location.replace("${publicUrl}");</script>
</body>
</html>` : 'Redirect HTML wrapper omitted because R2 is not configured';

        console.log('');
        console.log('==================================================');
        console.log('✅ TEST PIPELINE COMPLETED SUCCESSFULLY!');
        console.log(`📂 Code generated: ${testDir}`);
        console.log(`🔗 Public URL: ${publicUrl || 'N/A'}`);
        console.log(`📝 Redirect Wrapper HTML size: ${redirectHtml.length} chars`);
        console.log('==================================================');
        console.log('');

    } catch (error) {
        console.error('');
        console.error('❌ TEST PIPELINE FAILED:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
