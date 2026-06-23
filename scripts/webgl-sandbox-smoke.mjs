// Smoke test: confirm headless Chrome can create a SOFTWARE (SwiftShader) WebGL context and
// actually draw — reproducing the GPU-less Railway path locally by forcing --disable-gpu.
// Run: node scripts/webgl-sandbox-smoke.mjs
import puppeteer from 'puppeteer';

const ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--ignore-certificate-errors',
  // Force the software path even on a machine that HAS a GPU (Mac), so this mirrors Railway.
  '--disable-gpu',
];

const HTML = `<!doctype html><html><body><canvas id="c" width="64" height="64"></canvas>
<script>
  window.__result = (() => {
    const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl');
    if (!gl) return { ok: false, why: 'getContext returned null' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(no debug info)';
    // Draw a full-clear red frame and read back the center pixel.
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { ok: true, renderer, version: gl.getParameter(gl.VERSION), pixel: Array.from(px) };
  })();
</script></body></html>`;

const browser = await puppeteer.launch({ headless: 'new', args: ARGS });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(HTML, { waitUntil: 'load' });
  const result = await page.evaluate(() => window.__result);
  console.log('WebGL result:', JSON.stringify(result, null, 2));
  if (errors.length) console.log('Console errors:', errors);
  const drewRed = result.ok && result.pixel && result.pixel[0] > 200 && result.pixel[1] < 50;
  console.log(drewRed ? '\n✅ PASS — software WebGL context created AND drew a frame' : '\n❌ FAIL — no usable software WebGL context');
  process.exit(drewRed ? 0 : 1);
} finally {
  await browser.close();
}
