import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const storageRoot = process.env.ASSET_STORAGE_ROOT || path.join(repoRoot, 'public');
const previewDir = process.env.PREVIEW_VIDEO_DIR || path.join(storageRoot, 'game-previews');
const tmpRoot = process.env.PREVIEW_CAPTURE_TMP || '/tmp/gametok-preview-capture';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL || 'https://gametok-backend-production.up.railway.app').replace(/\/$/, '');
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

function isFfmpegAvailable() {
    const result = spawnSync(ffmpegBin, ['-version'], { encoding: 'utf8' });
    return !result.error && result.status === 0;
}

function encodeMp4(frameDir, outputPath, fps) {
    const result = spawnSync(
        ffmpegBin,
        [
            '-y',
            '-framerate',
            String(fps),
            '-i',
            path.join(frameDir, 'frame_%04d.png'),
            '-vf',
            'scale=390:-2:flags=lanczos',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            outputPath,
        ],
        { encoding: 'utf8' },
    );

    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'ffmpeg failed to encode preview video');
    }
}

export async function capturePreviewVideo(htmlString, previewId, options = {}) {
    const seconds = Number(options.seconds || process.env.PREVIEW_CAPTURE_SECONDS || 4);
    const fps = Number(options.fps || process.env.PREVIEW_CAPTURE_FPS || 6);
    const safeId = String(previewId || '').replace(/[^a-z0-9-]/gi, '');

    if (!htmlString || !safeId) return null;
    if (!isFfmpegAvailable()) {
        console.warn('[preview-video] ffmpeg is not available; skipping preview capture.');
        return null;
    }

    await fs.mkdir(previewDir, { recursive: true });
    await fs.mkdir(tmpRoot, { recursive: true });

    const frameDir = path.join(tmpRoot, safeId);
    const outputPath = path.join(previewDir, `${safeId}.mp4`);
    const previewUrl = `${publicBaseUrl}/game-previews/${safeId}.mp4`;
    let browser = null;
    let page = null;

    try {
        await fs.rm(frameDir, { recursive: true, force: true });
        await fs.mkdir(frameDir, { recursive: true });

        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-gl=swiftshader',
                '--use-angle=swiftshader-webgl',
                '--enable-webgl',
                '--ignore-gpu-blocklist',
                '--ignore-certificate-errors',
            ],
        });

        page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent(htmlString, { waitUntil: 'load', timeout: 15000 });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const frameCount = Math.max(1, Math.round(seconds * fps));
        const frameDelay = Math.max(1, Math.round(1000 / fps));

        for (let frame = 0; frame < frameCount; frame += 1) {
            if (frame > 0) await new Promise((resolve) => setTimeout(resolve, frameDelay));

            if (frame === Math.floor(frameCount / 3)) {
                try {
                    await page.mouse.move(200, 360);
                    await page.mouse.down({ button: 'left' });
                    await page.mouse.move(230, 420, { steps: 8 });
                    await page.mouse.up({ button: 'left' });
                } catch {
                    // Best-effort interaction only.
                }
            }

            await page.screenshot({
                path: path.join(frameDir, `frame_${String(frame).padStart(4, '0')}.png`),
                type: 'png',
            });
        }

        encodeMp4(frameDir, outputPath, fps);
        return previewUrl;
    } catch (error) {
        console.warn('[preview-video] Capture failed:', error.message);
        return null;
    } finally {
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
        await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
    }
}
