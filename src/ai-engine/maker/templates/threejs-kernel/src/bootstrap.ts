import './dreamModels'; // sets window.DREAM_MODELS (Kenney GLB data-URIs) before anything calls loadModel()
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

// Onboarding hint (#status-line) auto-dismisses on the player's first input —
// kernel-guaranteed so it never lingers under gameplay regardless of game code.
function installOnboardingDismiss() {
  const statusLine = document.getElementById('status-line');
  if (!statusLine) return;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    statusLine.style.transition = 'opacity 0.25s ease';
    statusLine.style.opacity = '0';
    window.setTimeout(() => { statusLine.style.display = 'none'; }, 280);
    window.removeEventListener('pointerdown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
    window.removeEventListener('touchstart', dismiss, true);
  };
  window.addEventListener('pointerdown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
  window.addEventListener('touchstart', dismiss, true);
}

function bootMain() {
  return import('./main').then((mod: Record<string, unknown>) => {
    // Kernel-guaranteed probe fallback: if main.ts forgot to wire __GAMETOK_TEMPLATE_PROBE__,
    // install a minimal one using its exported stepGame/renderAll/resetGame so the sandbox
    // can still verify liveness. main.ts should always export and set its own richer probe —
    // this only fires when the agent omits it.
    if (!window.__GAMETOK_TEMPLATE_PROBE__) {
      const stepFn = typeof mod.stepGame === 'function' ? mod.stepGame as (dt: number) => void : null;
      const renderFn = typeof mod.renderAll === 'function' ? mod.renderAll as () => void : null;
      const resetFn = typeof mod.resetGame === 'function' ? mod.resetGame as () => void : null;
      window.__GAMETOK_TEMPLATE_PROBE__ = {
        snapshot() {
          const canvas = document.querySelector('canvas');
          const ctx3d = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
          return { score: 0, gameOver: false, started: false, renderCalls: ctx3d ? 1 : 0, triangles: 0, cameraY: 0 };
        },
        step(dt: number = 16) {
          // Guarded: if main.ts init aborted (e.g. headless WebGL failure), its
          // exported step/render close over uninitialized module state. Calling them
          // unguarded threw a misleading "reading 'obstacles'" that masked the real
          // WebGL cause. Swallow here so the genuine error (already logged to console)
          // is what the sandbox sees and bypasses on.
          try { stepFn?.(dt); renderFn?.(); } catch { /* surfaced via console error */ }
          return (window.__GAMETOK_TEMPLATE_PROBE__ as any).snapshot();
        },
        reset() {
          try { resetFn?.(); } catch { /* surfaced via console error */ }
          return (window.__GAMETOK_TEMPLATE_PROBE__ as any).snapshot();
        },
      };
    }
  }).finally(() => {
    enforceGameViewport();
    installOnboardingDismiss();
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
