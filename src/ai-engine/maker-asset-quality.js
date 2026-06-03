function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function stripDataUrl(value = '') {
    const text = String(value || '');
    const comma = text.indexOf(',');
    return comma === -1 ? text : text.slice(comma + 1);
}

function assetUrlFor(generatedAssets = null, key = '') {
    if (!generatedAssets || !key) return '';
    return generatedAssets.assets?.[key] || '';
}

function severityRank(severity) {
    return severity === 'fatal' ? 3 : severity === 'warning' ? 2 : 1;
}

function issue({ id, severity = 'warning', key = null, message = '', details = null }) {
    return { id, severity, key, message, details };
}

export const ANIMATION_FRAME_KEY_PATTERN = /_(idle|move|hit|dash|pulse)_\d{2}$/i;

const NON_BLOCKING_ANIMATION_FRAME_ISSUES = new Set([
    'asset_blank_or_transparent',
    'asset_decode_failed',
    'asset_too_small',
]);

export function isAnimationFrameAssetKey(key = '', asset = {}) {
    const normalizedKey = String(key || asset?.key || asset?.id || '');
    return asset?.kind === 'animation_frame' || ANIMATION_FRAME_KEY_PATTERN.test(normalizedKey);
}

export function softenAnimationFrameIssue(entry = {}, asset = {}, key = '') {
    if (!entry || entry.severity !== 'fatal') return entry;
    if (!isAnimationFrameAssetKey(key, asset)) return entry;
    if (!NON_BLOCKING_ANIMATION_FRAME_ISSUES.has(entry.id)) return entry;
    return {
        ...entry,
        severity: 'warning',
        message: `${entry.message || entry.id} (animation frame; non-blocking)`,
    };
}

export function isBlockingAssetQualityIssue(entry = {}) {
    if (entry?.severity !== 'fatal') return false;
    if (isAnimationFrameAssetKey(entry.key) && NON_BLOCKING_ANIMATION_FRAME_ISSUES.has(entry.id)) {
        return false;
    }
    return true;
}

function colorBucket(r, g, b, a) {
    if (a < 12) return 'transparent';
    return `${r >> 4}:${g >> 4}:${b >> 4}`;
}

async function analyzeImageDataUrl({ key, role, category, type, url }) {
    const sharp = (await import('sharp')).default;
    const buffer = Buffer.from(stripDataUrl(url), 'base64');
    const metadata = await sharp(buffer).metadata();
    const sample = await sharp(buffer)
        .ensureAlpha()
        .resize({ width: 48, height: 48, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pixels = sample.info.width * sample.info.height;
    const buckets = new Set();
    let visible = 0;
    let edgeVisible = 0;
    let edgeTotal = 0;
    let alphaSum = 0;
    let lumaSum = 0;
    let lumaSq = 0;

    for (let y = 0; y < sample.info.height; y += 1) {
        for (let x = 0; x < sample.info.width; x += 1) {
            const offset = (y * sample.info.width + x) * 4;
            const r = sample.data[offset];
            const g = sample.data[offset + 1];
            const b = sample.data[offset + 2];
            const a = sample.data[offset + 3];
            alphaSum += a;
            const luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
            lumaSum += luma;
            lumaSq += luma * luma;
            if (a > 24) visible += 1;
            if (x === 0 || y === 0 || x === sample.info.width - 1 || y === sample.info.height - 1) {
                edgeTotal += 1;
                if (a > 24) edgeVisible += 1;
            }
            buckets.add(colorBucket(r, g, b, a));
        }
    }

    const avgLuma = pixels ? lumaSum / pixels : 0;
    const lumaVariance = pixels ? (lumaSq / pixels) - (avgLuma * avgLuma) : 0;
    const visibleRatio = pixels ? visible / pixels : 0;
    const edgeVisibleRatio = edgeTotal ? edgeVisible / edgeTotal : 0;
    const alphaAverage = pixels ? alphaSum / pixels : 0;
    const issues = [];
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const isBackground = ['background', 'environment'].includes(String(role || category || '').toLowerCase())
        || String(type || '').toLowerCase() === 'background';
    const isTileset = String(type || '').toLowerCase() === 'tileset'
        || String(role || category || '').toLowerCase().includes('tileset');

    if (width < 16 || height < 16) {
        issues.push(issue({ id: 'asset_too_small', severity: 'fatal', key, message: `${key} is only ${width}x${height}.` }));
    }
    if (visibleRatio < 0.015 && alphaAverage < 8) {
        issues.push(issue({ id: 'asset_blank_or_transparent', severity: 'fatal', key, message: `${key} appears blank or fully transparent.` }));
    }
    if (buckets.size <= 2 || lumaVariance < 3) {
        issues.push(issue({ id: 'asset_low_detail', severity: 'warning', key, message: `${key} has very low visual detail.` }));
    }
    if (!isBackground && !isTileset && edgeVisibleRatio > 0.92 && visibleRatio > 0.82) {
        issues.push(issue({ id: 'sprite_background_likely_present', severity: 'warning', key, message: `${key} likely still has a solid image background.` }));
    }
    if (isBackground && width < 256 && height < 256) {
        issues.push(issue({ id: 'background_low_resolution', severity: 'warning', key, message: `${key} background is ${width}x${height}.` }));
    }
    if (isBackground) {
        const aspect = height ? width / height : 1;
        if (aspect < 0.62 || aspect > 1.95) {
            issues.push(issue({
                id: 'background_mobile_aspect_risky',
                severity: 'warning',
                key,
                message: `${key} background aspect ${aspect.toFixed(2)} may crop awkwardly in a 390x844 mobile webview.`,
            }));
        }
    }
    if (!isBackground && !isTileset && visibleRatio > 0 && visibleRatio < 0.08) {
        issues.push(issue({ id: 'sprite_subject_too_tiny', severity: 'warning', key, message: `${key} subject occupies very little of the sprite frame.` }));
    }

    return {
        key,
        role: role || null,
        category: category || null,
        type: type || null,
        width,
        height,
        visibleRatio: Number(visibleRatio.toFixed(4)),
        edgeVisibleRatio: Number(edgeVisibleRatio.toFixed(4)),
        colorBuckets: buckets.size,
        lumaVariance: Number(Math.max(0, lumaVariance).toFixed(2)),
        issues,
    };
}

async function analyzeAssetPack(generatedAssets = null) {
    const results = [];
    const issues = [];
    const entries = asArray(generatedAssets?.assetPack);
    for (const asset of entries) {
        const key = asset?.key || asset?.id;
        const url = asset?.url || assetUrlFor(generatedAssets, key);
        if (!key || !url || !String(url).startsWith('data:image/')) continue;
        try {
            const result = await analyzeImageDataUrl({
                key,
                role: asset.role,
                category: asset.category,
                type: asset.type || asset.kind,
                url,
            });
            results.push(result);
            for (const entry of result.issues) {
                issues.push(softenAnimationFrameIssue(entry, asset, key));
            }
        } catch (error) {
            issues.push(softenAnimationFrameIssue(issue({
                id: 'asset_decode_failed',
                severity: 'fatal',
                key,
                message: `${key} could not be decoded for quality inspection: ${error.message}`,
            }), asset, key));
        }
    }
    return { assets: results, issues };
}

export function analyzeAnimations(generatedAssets = null) {
    const assets = generatedAssets?.assets || {};
    const animationResults = [];
    const issues = [];
    for (const animation of asArray(generatedAssets?.animations)) {
        const key = animation?.key || animation?.id || animation?.animationKey;
        const type = String(animation?.type || '').toLowerCase();
        const frames = asArray(animation?.frames).map((frame) => typeof frame === 'string' ? frame : frame?.key).filter(Boolean);
        const missingFrames = frames.filter((frameKey) => !assets[frameKey]);
        const uniqueFrameUrls = new Set(frames.map((frameKey) => assets[frameKey]).filter(Boolean));
        const duplicateFrameCount = Math.max(0, frames.length - uniqueFrameUrls.size - missingFrames.length);
        if (!key) {
            issues.push(issue({ id: 'animation_missing_key', severity: 'fatal', message: 'Animation entry is missing a key.' }));
        }
        if (type === 'procedural_tween') {
            animationResults.push({
                key: key || null,
                type,
                frameCount: 0,
                missingFrames: [],
                duplicateFrameCount: 0,
                frameKeys: [],
            });
            continue;
        }
        if (frames.length < 2) {
            const isSingleFrameReaction = /_(hit|dash)$/i.test(String(key || '')) && frames.length === 1;
            issues.push(issue({
                id: 'animation_too_few_frames',
                severity: isSingleFrameReaction ? 'warning' : 'fatal',
                key,
                message: `${key || 'animation'} has fewer than 2 frames.`,
            }));
        }
        for (const frameKey of missingFrames) {
            issues.push(issue({ id: 'animation_frame_missing_asset', severity: 'fatal', key, message: `${key} references missing frame ${frameKey}.` }));
        }
        if (frames.length >= 3 && duplicateFrameCount >= frames.length - 1) {
            issues.push(issue({ id: 'animation_frames_duplicate', severity: 'warning', key, message: `${key} animation frames appear duplicated.` }));
        }
        animationResults.push({
            key: key || null,
            type: type || null,
            frameCount: frames.length,
            missingFrames,
            duplicateFrameCount,
            frameKeys: frames,
        });
    }
    return { animations: animationResults, issues };
}

async function analyzeTilesets(generatedAssets = null) {
    const issues = [];
    const results = [];
    for (const tileset of asArray(generatedAssets?.tilesets)) {
        const key = tileset?.key || tileset?.id;
        const imageKey = tileset?.imageKey || key;
        const tileSize = Number(tileset?.tileSize || 0);
        const imageUrl = assetUrlFor(generatedAssets, imageKey);
        const result = {
            key: key || null,
            imageKey: imageKey || null,
            tileSize: tileSize || null,
            columns: tileset?.columns || null,
            rows: tileset?.rows || null,
            width: null,
            height: null,
        };
        if (!imageKey || !imageUrl) {
            issues.push(issue({ id: 'tileset_image_missing', severity: 'fatal', key, message: `${key || 'tileset'} has no generated sheet image.` }));
            results.push(result);
            continue;
        }
        try {
            const sharp = (await import('sharp')).default;
            const metadata = await sharp(Buffer.from(stripDataUrl(imageUrl), 'base64')).metadata();
            result.width = Number(metadata.width || 0);
            result.height = Number(metadata.height || 0);
            const expectedSize = tileSize ? tileSize * 7 : null;
            if (expectedSize && (result.width !== expectedSize || result.height !== expectedSize)) {
                issues.push(issue({
                    id: 'tileset_wrong_dimensions',
                    severity: 'fatal',
                    key,
                    message: `${key} should be ${expectedSize}x${expectedSize} but is ${result.width}x${result.height}.`,
                }));
            }
            if (tileset?.columns && Number(tileset.columns) !== 7) {
                issues.push(issue({ id: 'tileset_wrong_columns', severity: 'fatal', key, message: `${key} columns should be 7.` }));
            }
            if (tileset?.rows && Number(tileset.rows) !== 7) {
                issues.push(issue({ id: 'tileset_wrong_rows', severity: 'fatal', key, message: `${key} rows should be 7.` }));
            }
        } catch (error) {
            issues.push(issue({ id: 'tileset_decode_failed', severity: 'fatal', key, message: `${key} tileset could not be decoded: ${error.message}` }));
        }
        results.push(result);
    }
    return { tilesets: results, issues };
}

function normalizeAssetKey(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function isBackgroundAsset(asset = {}) {
    const role = String(asset?.role || asset?.category || '').toLowerCase();
    const type = String(asset?.type || asset?.kind || asset?.assetType || '').toLowerCase();
    return type === 'background' || role === 'background' || role === 'environment';
}

function findBackgroundAssetForSlot(slot = {}, packEntries = [], packById = new Map()) {
    const slotId = String(slot.id || slot.role || '');
    const slotKeys = [slotId, slot.role, slot.category]
        .map(normalizeAssetKey)
        .filter(Boolean);

    for (const key of slotKeys) {
        const direct = packById.get(key);
        if (direct) return direct;
    }

    const roleMatch = packEntries.find((entry) => {
        if (!isBackgroundAsset(entry)) return false;
        const entryKeys = [entry.id, entry.key, entry.role, entry.category]
            .map(normalizeAssetKey)
            .filter(Boolean);
        return slotKeys.some((slotKey) => entryKeys.includes(slotKey));
    });
    if (roleMatch) return roleMatch;

    const slotRole = normalizeAssetKey(slot.role || slot.category);
    if (slotRole) {
        const byRole = packEntries.find((entry) => {
            if (!isBackgroundAsset(entry)) return false;
            const entryRole = normalizeAssetKey(entry.role || entry.category);
            return entryRole && entryRole === slotRole;
        });
        if (byRole) return byRole;
    }

    const backgrounds = packEntries.filter(isBackgroundAsset);
    if (backgrounds.length === 1) return backgrounds[0];
    return null;
}

function analyzeRequiredBackgroundFallbacks(generatedAssets = null, assetContract = null) {
    const issues = [];
    const requiredSlots = asArray(assetContract?.slots).filter((slot) => slot?.required && isBackgroundAsset(slot));
    if (requiredSlots.length === 0) return issues;

    const packEntries = asArray(generatedAssets?.assetPack);
    const packById = new Map();
    for (const asset of packEntries) {
        for (const rawKey of [asset?.id, asset?.key]) {
            if (!rawKey) continue;
            const text = String(rawKey);
            packById.set(text, asset);
            const normalized = normalizeAssetKey(text);
            if (normalized) packById.set(normalized, asset);
        }
    }

    for (const slot of requiredSlots) {
        const slotId = String(slot.id || slot.role || '');
        const asset = findBackgroundAssetForSlot(slot, packEntries, packById);
        if (!asset) {
            issues.push(issue({
                id: 'required_background_missing',
                severity: 'fatal',
                key: slotId || 'background',
                message: `Required background slot ${slotId || 'background'} is missing from the generated asset pack.`,
            }));
            continue;
        }
        if (asset.fallback || asset.generationSource === 'fallback') {
            issues.push(issue({
                id: 'required_background_used_fallback',
                severity: 'fatal',
                key: slotId || asset.key || asset.id,
                message: `Required background ${slotId || asset.key || asset.id} used fallback art instead of generated FLUX scenery.`,
            }));
        }
    }
    return issues;
}

export function assertRequiredBackgroundArt(generatedAssets = null, assetContract = null) {
    const issues = analyzeRequiredBackgroundFallbacks(generatedAssets, assetContract);
    if (issues.length === 0) return;
    const error = new Error(`Required background art generation failed: ${issues.map((entry) => entry.message).join(' ')}`);
    error.code = 'REQUIRED_BACKGROUND_ART_FAILED';
    error.issues = issues;
    throw error;
}

function isRequiredVisualSlot(slot = {}) {
    if (slot?.required === false) return false;
    const role = String(slot.role || slot.category || '').toLowerCase();
    if (!role || ['sfx', 'music', 'audio', 'sound'].includes(role)) return false;
    return true;
}

function findPackAssetForSlot(slot = {}, packEntries = [], packById = new Map()) {
    const slotId = String(slot.id || slot.role || '');
    if (slotId && packById.has(slotId)) return packById.get(slotId);
    const slotRole = String(slot.role || slot.category || '').toLowerCase();
    if (slotRole) {
        const byRole = packEntries.find((entry) => String(entry.role || entry.category || '').toLowerCase() === slotRole);
        if (byRole) return byRole;
    }
    if (/^item\d+$/i.test(slotId)) {
        return packEntries.find((entry) => /^item\d*$/i.test(String(entry.key || entry.id || '')));
    }
    if (/^prop\d+$/i.test(slotId)) {
        return packEntries.find((entry) => String(entry.role || entry.category || '').toLowerCase() === 'prop'
            || /^prop\d*$/i.test(String(entry.key || entry.id || '')));
    }
    if (/^obstacle\d+$/i.test(slotId)) {
        return packEntries.find((entry) => String(entry.role || entry.category || '').toLowerCase() === 'obstacle'
            || /^obstacle\d*$/i.test(String(entry.key || entry.id || '')));
    }
    if (/^enemy\d+$/i.test(slotId)) {
        return packEntries.find((entry) => /^enemy\d*$/i.test(String(entry.key || entry.id || ''))
            || String(entry.role || '').toLowerCase() === 'enemy');
    }
    if (slotRole === 'player') {
        return packEntries.find((entry) => String(entry.role || '').toLowerCase() === 'player'
            || /^player/i.test(String(entry.key || entry.id || '')));
    }
    return null;
}

function analyzeRequiredSlotFallbacks(generatedAssets = null, assetContract = null) {
    const issues = [];
    const requiredSlots = asArray(assetContract?.slots).filter(isRequiredVisualSlot)
        .filter((slot) => !isBackgroundAsset(slot));
    if (requiredSlots.length === 0) return issues;

    const packEntries = asArray(generatedAssets?.assetPack);
    const packById = new Map();
    for (const asset of packEntries) {
        for (const rawKey of [asset?.id, asset?.key]) {
            if (!rawKey) continue;
            packById.set(String(rawKey), asset);
        }
    }

    for (const slot of requiredSlots) {
        const slotId = String(slot.id || slot.role || '');
        const asset = findPackAssetForSlot(slot, packEntries, packById);
        if (!asset) {
            issues.push(issue({
                id: 'required_slot_missing',
                severity: 'fatal',
                key: slotId,
                message: `Required ${slot.role || slot.category || 'asset'} slot ${slotId} is missing from the generated asset pack.`,
            }));
            continue;
        }
        if (asset.fallback || asset.generationSource === 'fallback') {
            issues.push(issue({
                id: 'required_slot_used_fallback',
                severity: 'fatal',
                key: slotId || asset.key || asset.id,
                message: `Required ${slot.role || slot.category || 'asset'} ${slotId || asset.key || asset.id} used procedural fallback instead of generated art.`,
            }));
        }
    }
    return issues;
}

/** Fail artist phase when any required visual slot is missing or fell back to procedural art. */
export function assertRequiredContractArt(generatedAssets = null, assetContract = null) {
    const issues = [
        ...analyzeRequiredBackgroundFallbacks(generatedAssets, assetContract),
        ...analyzeRequiredSlotFallbacks(generatedAssets, assetContract),
    ];
    if (issues.length === 0) return;
    const error = new Error(`Required contract art generation failed: ${issues.map((entry) => entry.message).join(' ')}`);
    error.code = 'REQUIRED_CONTRACT_ART_FAILED';
    error.issues = issues;
    throw error;
}

export async function analyzeMakerAssetQuality(generatedAssets = null, options = {}) {
    if (!generatedAssets) {
        return {
            version: 1,
            source: 'gametok-maker-asset-quality',
            passed: true,
            score: 100,
            counts: { assets: 0, animations: 0, tilesets: 0, issues: 0, fatalIssues: 0 },
            assets: [],
            animations: [],
            tilesets: [],
            issues: [],
        };
    }
    const assetPack = await analyzeAssetPack(generatedAssets);
    const animations = analyzeAnimations(generatedAssets);
    const tilesets = await analyzeTilesets(generatedAssets);
    const backgroundFallbackIssues = analyzeRequiredBackgroundFallbacks(generatedAssets, options.assetContract || null);
    const slotFallbackIssues = analyzeRequiredSlotFallbacks(generatedAssets, options.assetContract || null);
    const issues = [
        ...assetPack.issues,
        ...animations.issues,
        ...tilesets.issues,
        ...backgroundFallbackIssues,
        ...slotFallbackIssues,
    ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const fatalIssues = issues.filter((entry) => entry.severity === 'fatal');
    const score = Math.max(0, 100 - (fatalIssues.length * 25) - ((issues.length - fatalIssues.length) * 6));
    return {
        version: 1,
        source: 'gametok-maker-asset-quality',
        passed: fatalIssues.length === 0,
        score,
        counts: {
            assets: assetPack.assets.length,
            animations: animations.animations.length,
            tilesets: tilesets.tilesets.length,
            issues: issues.length,
            fatalIssues: fatalIssues.length,
        },
        assets: assetPack.assets,
        animations: animations.animations,
        tilesets: tilesets.tilesets,
        issues,
    };
}

export function summarizeMakerAssetQuality(report = null) {
    if (!report) return null;
    return {
        passed: Boolean(report.passed),
        score: report.score,
        counts: report.counts || {},
        fatalIssues: asArray(report.issues).filter((entry) => entry.severity === 'fatal').slice(0, 8),
        warnings: asArray(report.issues).filter((entry) => entry.severity !== 'fatal').slice(0, 8),
    };
}
