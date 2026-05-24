type DreamAsset = {
  key?: string;
  id?: string;
  runtimeKey?: string;
  type?: string;
  role?: string;
  category?: string;
  url?: string;
};

async function readLocalAssetPack(): Promise<DreamAsset[]> {
  try {
    const response = await fetch('assets/asset-pack.json', { cache: 'no-store' });
    if (!response.ok) return [];
    const pack = await response.json();
    if (Array.isArray(pack?.runtimeAssets)) return pack.runtimeAssets;
    if (Array.isArray(pack?.generated?.files)) return pack.generated.files;
    return [];
  } catch {
    return [];
  }
}

function imageSourceFor(asset: DreamAsset): string | null {
  const key = asset.key || asset.runtimeKey || asset.id;
  if (!key) return asset.url || null;
  return (
    (window as any).DreamAssets?.getImage?.(key)
    || (window as any).DREAM_ASSETS?.[key]
    || asset.url
    || null
  );
}

function dedupeAssets(assets: DreamAsset[]): DreamAsset[] {
  return Array.from(new Map(
    assets
      .filter((asset) => asset && (asset.key || asset.id || asset.runtimeKey))
      .map((asset) => [asset.key || asset.runtimeKey || asset.id, asset])
  ).values());
}

export async function loadDreamAssets(): Promise<void> {
  const localPack = await readLocalAssetPack();
  const globalPack = Array.isArray((window as any).DREAM_ASSET_PACK) ? (window as any).DREAM_ASSET_PACK : [];
  const pack = dedupeAssets([...localPack, ...globalPack]);
  const images: Record<string, HTMLImageElement> = (window as any).DREAM_IMAGES || {};
  (window as any).DREAM_IMAGES = images;

  const loads = pack
    .filter((asset: DreamAsset) => asset && (asset.type || 'image') !== 'audio' && (asset.key || asset.id || asset.runtimeKey))
    .map((asset: DreamAsset) => new Promise<void>((resolve) => {
      const key = asset.key || asset.runtimeKey || asset.id;
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
      image.onload = () => {
        images[key] = image;
        if (asset.id) images[asset.id] = image;
        if (asset.runtimeKey) images[asset.runtimeKey] = image;
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
