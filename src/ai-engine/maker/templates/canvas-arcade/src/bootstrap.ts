import { loadDreamAssets } from './assetLoader';

loadDreamAssets().finally(() => {
  import('./main');
});
