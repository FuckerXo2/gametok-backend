import puppeteer from 'puppeteer';
import { uploadAssetBufferToR2 } from '../asset-storage.js';

/**
 * Headless Studio 3D Thumbnail Renderer
 * 
 * Renders standardized 512x512 transparent WebP thumbnails for any 3D asset
 * using a Three.js studio environment inside headless Chromium.
 */
export class StudioThumbnailRenderer {
    /**
     * Render a 512x512 studio thumbnail for a 3D model
     * @param {object} params
     * @param {string} params.modelUrl Public CDN URL or local URL of GLB model
     * @param {string} params.sha256 SHA-256 hash of the asset
     * @param {object} [params.boundingBox] Spatial dimensions
     * @returns {Promise<{ key: string, thumbnailUrl: string, buffer: Buffer }>}
     */
    static async renderThumbnail({ modelUrl, sha256, boundingBox }) {
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--use-gl=angle',
                    '--use-angle=swiftshader',
                    '--enable-unsafe-swiftshader',
                    '--enable-webgl',
                    '--ignore-gpu-blocklist'
                ]
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 512, height: 512 });

            const studioHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
        canvas { width: 512px; height: 512px; display: block; }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
</head>
<body>
<canvas id="c"></canvas>
<script>
async function renderStudioShot() {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(512, 512);
    renderer.setPixelRatio(1);
    renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    // Studio 3-Point Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x90b0ff, 0.5);
    fillLight.position.set(-5, 3, -3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffd0a0, 0.6);
    rimLight.position.set(0, 5, -5);
    scene.add(rimLight);

    const loader = new THREE.GLTFLoader();
    loader.load('${modelUrl}', (gltf) => {
        const root = gltf.scene;

        // Auto-center and normalize bounds
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        root.position.sub(center); // center at origin
        scene.add(root);

        // Isometric Camera Framing
        const distance = maxDim * 2.2;
        camera.position.set(distance * 0.7, distance * 0.5, distance * 0.7);
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
        window.__STUDIO_RENDER_READY__ = true;
    }, undefined, (err) => {
        window.__STUDIO_RENDER_ERROR__ = err.message || 'GLTF Load Error';
    });
}

renderStudioShot();
</script>
</body>
</html>
`;

            await page.setContent(studioHtml, { waitUntil: 'load' });
            await page.waitForFunction('window.__STUDIO_RENDER_READY__ === true || window.__STUDIO_RENDER_ERROR__ !== undefined', { timeout: 15000 });

            const isError = await page.evaluate(() => window.__STUDIO_RENDER_ERROR__);
            if (isError) {
                console.warn(`⚠️ [Thumbnail Renderer] Preview render warning: ${isError}`);
                return null;
            }

            const rawScreenshot = await page.screenshot({
                type: 'webp',
                omitBackground: true
            });
            const imageBuffer = Buffer.from(rawScreenshot);

            await browser.close();
            browser = null;

            // Upload thumbnail to R2
            const r2Key = `thumbnails/${sha256.substring(0, 16)}.webp`;
            const uploadResult = await uploadAssetBufferToR2({
                key: r2Key,
                buffer: imageBuffer,
                contentType: 'image/webp',
                cacheControl: 'public, max-age=31536000, immutable'
            });


            console.log(`📸 [Thumbnail Renderer] Rendered 512x512 WebP preview → ${uploadResult.cdnUrl}`);
            return {
                key: uploadResult.key,
                thumbnailUrl: uploadResult.cdnUrl,
                buffer: imageBuffer
            };
        } catch (err) {
            console.warn(`⚠️ [Thumbnail Renderer] Failed to render thumbnail for ${modelUrl}:`, err.message);
            return null;
        } finally {
            if (browser) await browser.close().catch(() => {});
        }
    }
}
