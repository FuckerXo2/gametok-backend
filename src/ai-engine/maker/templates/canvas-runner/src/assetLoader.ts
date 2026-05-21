export async function loadDreamAssets(): Promise<void> {
  const pack = Array.isArray((window as any).DREAM_ASSET_PACK) 
    ? (window as any).DREAM_ASSET_PACK 
    : [];

  const images: Record<string, HTMLImageElement> = {};
  (window as any).DREAM_IMAGES = images;

  const promises = pack
    .filter((asset: any) => asset.type === 'image' && asset.key)
    .map((asset: any) => {
      return new Promise<void>((resolve) => {
        const dataUrl = (window as any).DreamAssets?.getImage?.(asset.key) || (window as any).DREAM_ASSETS?.[asset.key];
        if (!dataUrl) {
          resolve();
          return;
        }

        const img = new Image();
        img.onload = () => {
          images[asset.key] = img;
          images[asset.role || asset.category] = img; // Fallback so DREAM_IMAGES['player'] works even if key is different
          resolve();
        };
        img.onerror = () => {
          console.warn(`Failed to load asset: ${asset.key}`);
          resolve(); // Resolve anyway so we don't block the game
        };
        img.src = dataUrl;
      });
    });

  await Promise.all(promises);
}
