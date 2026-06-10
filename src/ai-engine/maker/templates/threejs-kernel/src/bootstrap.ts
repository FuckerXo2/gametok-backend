import { loadDreamAssets } from './assetLoader';

function enforceGameViewport() {
  const root = document.documentElement;
  const body = document.body;
  root.style.margin = '0';
  root.style.padding = '0';
  body.style.margin = '0';
  body.style.padding = '0';
  body.style.overflow = 'hidden';

  const shell = document.getElementById('game-shell');
  if (shell) {
    shell.style.position = 'fixed';
    shell.style.inset = '0';
    shell.style.margin = '0';
    shell.style.padding = '0';
    shell.style.overflow = 'hidden';
  }

  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.margin = '0';
  canvas.style.padding = '0';
  canvas.style.display = 'block';
}

function bootMain() {
  return import('./main').finally(() => {
    enforceGameViewport();
    window.addEventListener('resize', enforceGameViewport);
    requestAnimationFrame(() => enforceGameViewport());
    window.setTimeout(() => enforceGameViewport(), 100);
    window.setTimeout(() => enforceGameViewport(), 500);
  });
}

// Pre-load all generated assets before starting the game
loadDreamAssets().then(bootMain).catch((err) => {
  console.error('Failed to load DreamAssets:', err);
  bootMain();
});
