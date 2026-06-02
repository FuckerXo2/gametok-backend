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

  installDreamAssetUsageTracker();
}

type DreamAssetUsage = {
  helperCalls: number;
  usedKeys: Record<string, number>;
  usedRoles: Record<string, number>;
  renderedKeys: Record<string, number>;
  renderedRoles: Record<string, number>;
};

function installDreamAssetUsageTracker() {
  const w = window as typeof window & {
    __DREAM_ASSET_USAGE_INSTALLED?: boolean;
    __DREAM_ASSET_USAGE?: DreamAssetUsage;
    DREAM_IMAGES?: Record<string, HTMLImageElement>;
    DREAM_ASSET_PACK?: DreamAsset[];
  };
  if (w.__DREAM_ASSET_USAGE_INSTALLED) return;
  w.__DREAM_ASSET_USAGE_INSTALLED = true;
  w.__DREAM_ASSET_USAGE = w.__DREAM_ASSET_USAGE || {
    helperCalls: 0,
    usedKeys: {},
    usedRoles: {},
    renderedKeys: {},
    renderedRoles: {},
  };

  const resolveRoleForKey = (key: string): string | null => {
    const pack = Array.isArray(w.DREAM_ASSET_PACK) ? w.DREAM_ASSET_PACK : [];
    for (const asset of pack) {
      const assetKey = String(asset?.key || asset?.id || asset?.runtimeKey || '');
      if (assetKey && assetKey === key) {
        return String(asset.role || asset.category || '').toLowerCase() || null;
      }
    }
    if (/^background/i.test(key) || key === 'environment') return 'background';
    return null;
  };

  const noteSceneryRoleUsage = (usage: DreamAssetUsage, role: string) => {
    usage.renderedRoles[role] = (usage.renderedRoles[role] || 0) + 1;
    if (role === 'background' || role === 'environment') {
      const aliasRole = role === 'background' ? 'environment' : 'background';
      usage.renderedRoles[aliasRole] = (usage.renderedRoles[aliasRole] || 0) + 1;
    }
  };

  const noteRenderedImage = (image: CanvasImageSource) => {
    if (!(image instanceof HTMLImageElement)) return;
    const usage = w.__DREAM_ASSET_USAGE;
    if (!usage) return;
    const images = w.DREAM_IMAGES || {};
    for (const [key, img] of Object.entries(images)) {
      if (img !== image) continue;
      usage.renderedKeys[key] = (usage.renderedKeys[key] || 0) + 1;
      const role = resolveRoleForKey(key);
      if (role) {
        noteSceneryRoleUsage(usage, role);
      }
    }
  };

  const proto = CanvasRenderingContext2D.prototype;
  const originalDrawImage = proto.drawImage;
  proto.drawImage = function drawImageWithUsage(
    this: CanvasRenderingContext2D,
    ...args: any[]
  ): void {
    noteRenderedImage(args[0] as CanvasImageSource);
    (originalDrawImage as (...inner: any[]) => void).apply(this, args);
  } as typeof proto.drawImage;
}
