type DreamAsset = {
  key?: string;
  id?: string;
  runtimeKey?: string;
  type?: string;
  role?: string;
  category?: string;
  url?: string;
};

function isVisualAsset(asset: DreamAsset): boolean {
  const type = String(asset?.type || 'image').toLowerCase();
  return type !== 'audio' && type !== 'music' && type !== 'sfx';
}

async function readLocalAssetPack(): Promise<DreamAsset[]> {
  try {
    const response = await fetch('assets/asset-pack.json', { cache: 'no-store' });
    if (!response.ok) return [];
    const pack = await response.json();
    if (Array.isArray(pack?.meta?.runtimeAssets)) return pack.meta.runtimeAssets;
    if (Array.isArray(pack?.runtimeAssets)) return pack.runtimeAssets;
    if (Array.isArray(pack?.generated?.files)) return pack.generated.files;
    const sectionAssets = Object.entries(pack || {})
      .filter(([name, section]: [string, any]) => name !== 'meta' && Array.isArray(section?.files))
      .flatMap(([name, section]: [string, any]) => section.files.map((file: DreamAsset) => ({
        ...file,
        role: file.role || file.category || name.replace(/s$/, ''),
        category: file.category || file.role || name.replace(/s$/, ''),
      })));
    if (sectionAssets.length > 0) return sectionAssets;
    return [];
  } catch {
    return [];
  }
}

function imageSourceFor(asset: DreamAsset, key?: string | null): string | null {
  const resolvedKey = key || asset.key || asset.runtimeKey || asset.id;
  if (!resolvedKey) return asset.url || null;
  return (
    (window as any).DreamAssets?.getImage?.(resolvedKey)
    || (window as any).DREAM_ASSETS?.[resolvedKey]
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

function registerLoadedImage(
  images: Record<string, HTMLImageElement>,
  asset: DreamAsset,
  key: string,
  image: HTMLImageElement,
) {
  images[key] = image;
  if (asset.id) images[asset.id] = image;
  if (asset.runtimeKey) images[asset.runtimeKey] = image;
  if (asset.role) images[asset.role] = image;
  if (asset.category) images[asset.category] = image;
}

function loadImageEntry(
  images: Record<string, HTMLImageElement>,
  key: string,
  src: string,
  asset: DreamAsset = {},
): Promise<void> {
  return new Promise((resolve) => {
    if (!key || !src) {
      resolve();
      return;
    }
    if (images[key] instanceof HTMLImageElement && images[key].complete && images[key].naturalWidth > 0) {
      resolve();
      return;
    }
    const image = new Image();
    image.onload = () => {
      registerLoadedImage(images, asset, key, image);
      resolve();
    };
    image.onerror = () => {
      console.warn(`Failed to load DreamAsset image: ${key}`);
      resolve();
    };
    image.src = src;
  });
}

export async function loadDreamAssets(): Promise<void> {
  const localPack = await readLocalAssetPack();
  const globalPack = Array.isArray((window as any).DREAM_ASSET_PACK) ? (window as any).DREAM_ASSET_PACK : [];
  const pack = dedupeAssets([...localPack, ...globalPack]);
  const images: Record<string, HTMLImageElement> = (window as any).DREAM_IMAGES || {};
  (window as any).DREAM_IMAGES = images;

  const packLoads = pack
    .filter((asset: DreamAsset) => isVisualAsset(asset) && (asset.key || asset.id || asset.runtimeKey))
    .map((asset: DreamAsset) => {
      const key = asset.key || asset.runtimeKey || asset.id;
      const src = imageSourceFor(asset, key);
      return loadImageEntry(images, String(key), String(src || ''), asset);
    });

  const inlineLoads = Object.entries((window as any).DREAM_ASSETS || {})
    .filter(([key, src]) => Boolean(key) && typeof src === 'string' && src.length > 0)
    .map(([key, src]) => loadImageEntry(images, key, src as string, { key, role: key }));

  await Promise.all([...packLoads, ...inlineLoads]);

  const pack = Array.isArray((window as any).DREAM_ASSET_PACK) ? (window as any).DREAM_ASSET_PACK : [];
  const assignAlias = (alias: string, sourceKey: string) => {
    if (!alias || !sourceKey || images[alias]?.complete) return;
    if (images[sourceKey]?.complete && images[sourceKey].naturalWidth > 0) {
      images[alias] = images[sourceKey];
    }
  };

  const backgroundAsset = pack.find((asset: DreamAsset) => {
    const role = String(asset.role || asset.category || '').toLowerCase();
    const type = String(asset.type || '').toLowerCase();
    return type === 'background' || role === 'background' || role === 'environment';
  }) || pack.find((asset: DreamAsset) => /^background/i.test(String(asset.key || asset.id || '')));

  if (backgroundAsset) {
    const sourceKey = String(backgroundAsset.key || backgroundAsset.id || backgroundAsset.runtimeKey || '');
    ['toybox_background', 'background', 'background1', 'environment'].forEach((alias) => assignAlias(alias, sourceKey));
  }

  if (images.background) assignAlias('toybox_background', 'background');
  if (images.environment && !images.background) assignAlias('background', 'environment');

  const itemAssets = pack
    .filter((asset: DreamAsset) => {
      const role = String(asset.role || asset.category || '').toLowerCase();
      return role === 'item' || /^item\d+$/i.test(String(asset.key || asset.id || ''));
    })
    .sort((a: DreamAsset, b: DreamAsset) => String(a.key || a.id).localeCompare(String(b.key || b.id), undefined, { numeric: true }));

  itemAssets.forEach((asset: DreamAsset, index: number) => {
    const sourceKey = String(asset.key || asset.id || asset.runtimeKey || '');
    assignAlias(`item${index + 1}`, sourceKey);
  });
}
