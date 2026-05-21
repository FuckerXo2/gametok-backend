import { loadDreamAssets } from './assetLoader';

// Pre-load all generated assets before starting the game
loadDreamAssets().then(() => {
  // Now that window.DREAM_IMAGES is fully populated, start the game logic
  import('./main');
}).catch((err) => {
  console.error("Failed to load DreamAssets:", err);
  // Boot anyway so the game doesn't hang
  import('./main');
});
