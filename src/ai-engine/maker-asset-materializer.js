import fs from 'fs/promises';
import path from 'path';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeKey(value, fallback = 'asset') {
    return String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || fallback;
}

function assetKey(asset = {}) {
    return asset.key || asset.id || null;
}

function normalizeRole(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function isRenderableImage(asset = {}) {
    const type = normalizeRole(asset.type || asset.kind || asset.assetType);
    const role = normalizeRole(asset.role || asset.category);
    return Boolean(assetKey(asset)) && (
        ['image', 'sprite', 'background', 'prop', 'item', 'effect', 'animation_frame'].includes(type)
        || ['player', 'enemy', 'item', 'prop', 'effect', 'background', 'environment', 'collectible'].includes(role)
        || Boolean(asset.url)
    );
}

function dataUrlInfo(source = '') {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(source || ''));
    if (!match) return null;
    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = Boolean(match[2]);
    const data = match[3] || '';
    const extension = mimeType.includes('jpeg') ? 'jpg'
        : mimeType.includes('png') ? 'png'
            : mimeType.includes('webp') ? 'webp'
                : mimeType.includes('gif') ? 'gif'
                    : 'bin';
    return {
        mimeType,
        extension,
        buffer: isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8'),
    };
}

function collectGeneratedAssets(generatedAssets = null) {
    const byKey = new Map();
    for (const asset of [
        ...asArray(generatedAssets?.manifest?.assets),
        ...asArray(generatedAssets?.assetPack),
        ...asArray(generatedAssets?.assetQuality?.assets),
    ]) {
        const key = assetKey(asset);
        if (!key || !isRenderableImage(asset)) continue;
        byKey.set(key, { ...(byKey.get(key) || {}), ...asset, key });
    }
    for (const [key, url] of Object.entries(generatedAssets?.assets || {})) {
        if (!key || byKey.has(key)) continue;
        byKey.set(key, { key, id: key, role: key, category: key, type: 'image', url });
    }
    return Array.from(byKey.values());
}

function buildRoleIndexes(runtimeAssets = []) {
    const byRole = {};
    for (const asset of runtimeAssets) {
        const values = [asset.role, asset.category, asset.type].map(normalizeRole).filter(Boolean);
        for (const value of values) {
            if (!byRole[value]) byRole[value] = [];
            byRole[value].push(asset.key);
        }
    }
    return byRole;
}

function buildSlotReport(makerManifest = null, runtimeAssets = []) {
    const byKey = new Set(runtimeAssets.map((asset) => asset.key).filter(Boolean));
    const byRole = new Set(runtimeAssets.flatMap((asset) => [asset.role, asset.category].map(normalizeRole)).filter(Boolean));
    return asArray(makerManifest?.slots).map((slot) => {
        const runtimeKey = slot.runtimeKey || null;
        const role = normalizeRole(slot.role || slot.category || slot.id);
        const hasRuntimeKey = Boolean(runtimeKey && byKey.has(runtimeKey));
        const hasRoleFallback = Boolean(role && byRole.has(role));
        return {
            id: slot.id || role,
            role,
            required: Boolean(slot.required),
            runtimeKey,
            status: hasRuntimeKey || hasRoleFallback ? 'ready' : 'missing',
            fallbackRecorded: Boolean(slot.fallback && !hasRuntimeKey),
        };
    });
}

export async function materializeMakerAssetsForProject(projectRoot, generatedAssets = null, { workspace = null } = {}) {
    const publicAssetRoot = path.join(projectRoot, 'public', 'assets');
    await fs.mkdir(publicAssetRoot, { recursive: true });

    const sourceAssets = collectGeneratedAssets(generatedAssets);
    const runtimeAssets = [];
    const fileWrites = [];
    const seenFileNames = new Set();

    for (const asset of sourceAssets) {
        const key = assetKey(asset);
        const source = generatedAssets?.assets?.[key] || asset.url || null;
        let runtimeUrl = source || null;
        let localFile = null;
        const parsed = dataUrlInfo(source);

        if (parsed) {
            const baseName = normalizeKey(key);
            let fileName = `${baseName}.${parsed.extension}`;
            let counter = 2;
            while (seenFileNames.has(fileName)) {
                fileName = `${baseName}_${counter}.${parsed.extension}`;
                counter += 1;
            }
            seenFileNames.add(fileName);
            localFile = fileName;
            runtimeUrl = `assets/${fileName}`;
            await fs.writeFile(path.join(publicAssetRoot, fileName), parsed.buffer);
            fileWrites.push({
                key,
                file: `public/assets/${fileName}`,
                bytes: parsed.buffer.length,
                mimeType: parsed.mimeType,
            });
        }

        runtimeAssets.push({
            key,
            id: asset.id || key,
            runtimeKey: key,
            type: normalizeRole(asset.type || asset.kind || asset.assetType) || 'image',
            role: normalizeRole(asset.role || asset.category || key) || null,
            category: normalizeRole(asset.category || asset.role) || null,
            url: runtimeUrl,
            localFile,
            width: asset.width || null,
            height: asset.height || null,
            transparent: asset.transparent !== false && normalizeRole(asset.role || asset.category) !== 'background',
            source: asset.source || asset.provider || 'gametok-artist-agent',
        });
    }

    const makerManifest = generatedAssets?.makerAssetManifest || generatedAssets?.manifest?.makerAssetManifest || null;
    const slots = buildSlotReport(makerManifest, runtimeAssets);
    const phaserFiles = runtimeAssets
        .filter((asset) => asset.url && asset.key)
        .map((asset) => ({
            type: 'image',
            key: asset.key,
            url: asset.url,
        }));
    const assetPack = {
        version: 1,
        source: 'gametok-maker-materialized-asset-pack',
        generatedAt: new Date().toISOString(),
        generated: {
            files: phaserFiles,
        },
        runtimeAssets,
        slots,
        roleIndex: buildRoleIndexes(runtimeAssets),
        meta: {
            imageCount: runtimeAssets.length,
            fileCount: fileWrites.length,
            localPath: 'public/assets',
            compatibleGlobals: ['DREAM_ASSET_PACK', 'DREAM_ASSETS', 'DreamAssets'],
        },
    };
    const animations = {
        version: 1,
        source: 'gametok-maker-materialized-animations',
        animations: asArray(generatedAssets?.animations),
    };
    const audioManifest = {
        version: 1,
        source: 'gametok-maker-materialized-audio',
        audio: generatedAssets?.audio || { sfx: [], music: [] },
    };
    const wiringReport = {
        version: 1,
        source: 'gametok-maker-asset-materializer',
        generatedAt: assetPack.generatedAt,
        publicAssetRoot,
        assetPackPath: path.join(publicAssetRoot, 'asset-pack.json'),
        files: fileWrites,
        runtimeAssets: runtimeAssets.map((asset) => ({
            key: asset.key,
            role: asset.role,
            category: asset.category,
            type: asset.type,
            url: asset.url,
            localFile: asset.localFile,
        })),
        requiredSlots: slots.filter((slot) => slot.required),
        missingRequiredSlots: slots.filter((slot) => slot.required && slot.status !== 'ready').map((slot) => slot.id),
    };

    await fs.writeFile(path.join(publicAssetRoot, 'asset-pack.json'), JSON.stringify(assetPack, null, 2), 'utf8');
    await fs.writeFile(path.join(publicAssetRoot, 'animations.json'), JSON.stringify(animations, null, 2), 'utf8');
    await fs.writeFile(path.join(publicAssetRoot, 'audio-manifest.json'), JSON.stringify(audioManifest, null, 2), 'utf8');
    await fs.writeFile(path.join(publicAssetRoot, 'asset-wiring-report.json'), JSON.stringify(wiringReport, null, 2), 'utf8');

    if (workspace) {
        await fs.writeFile(path.join(workspace, 'asset-pack.json'), JSON.stringify(assetPack, null, 2), 'utf8');
        await fs.writeFile(path.join(workspace, 'asset-wiring-report.json'), JSON.stringify(wiringReport, null, 2), 'utf8');
    }

    if (generatedAssets) {
        generatedAssets.materializedAssetPack = assetPack;
        generatedAssets.materializedAssetWiringReport = wiringReport;
    }

    return {
        assetPack,
        wiringReport,
        animations,
        audioManifest,
    };
}
