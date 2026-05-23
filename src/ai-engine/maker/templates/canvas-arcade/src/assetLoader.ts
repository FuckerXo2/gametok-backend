type DreamAsset = {
  key?: string;
  id?: string;
  type?: string;
  role?: string;
  category?: string;
  url?: string;
};

function imageSourceFor(asset: DreamAsset): string | null {
  const key = asset.key || asset.id;
  if (!key) return null;
  return (
    window.DreamAssets?.getImage?.(key)
    || window.DREAM_ASSETS?.[key]
    || asset.url
    || null
  );
}

export async function loadDreamAssets(): Promise<void> {
  const pack = Array.isArray(window.DREAM_ASSET_PACK) ? window.DREAM_ASSET_PACK : [];
  const images: Record<string, HTMLImageElement> = window.DREAM_IMAGES || {};
  window.DREAM_IMAGES = images;

  const loads = pack
    .filter((asset: DreamAsset) => asset && asset.type === 'image' && (asset.key || asset.id))
    .map((asset: DreamAsset) => new Promise<void>((resolve) => {
      const key = asset.key || asset.id;
      const src = imageSourceFor(asset);
      if (!key || !src) {
        resolve();
        return;
      }

      if (images[key] instanceof HTMLImageElement && images[key].complete) {
        resolve();
        return;
      }

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        images[key] = image;
        if (asset.id) images[asset.id] = image;
        if (asset.role) images[asset.role] = image;
        if (asset.category) images[asset.category] = image;
        resolve();
      };
      image.onerror = () => {
        console.warn(`Failed to load DreamAsset image: ${key}`);
        resolve();
      };
      image.src = src;
    }));

  await Promise.all(loads);
}
