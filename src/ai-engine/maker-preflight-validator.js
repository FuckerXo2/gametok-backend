import fs from 'fs/promises';
import path from 'path';

async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return '';
    }
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function requiredAssetSlots(assetContract = null) {
    return (Array.isArray(assetContract?.slots) ? assetContract.slots : [])
        .filter((slot) => slot && slot.required !== false)
        .map((slot) => ({
            id: String(slot.id || slot.key || slot.name || slot.role || '').trim(),
            role: String(slot.role || slot.id || slot.key || slot.name || '').trim(),
        }))
        .filter((slot) => slot.id || slot.role);
}

function generatedAssetRoles(generatedAssets = null) {
    const pack = Array.isArray(generatedAssets?.assetPack) ? generatedAssets.assetPack : [];
    return unique(pack.map((asset) => String(asset?.role || asset?.category || '').trim()));
}

function sourceReferencesAny(source, values) {
    return values.some((value) => {
        if (!value) return false;
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(source);
    });
}

export async function runMakerPreflightChecks({ projectRoot, generatedAssets = null, assetContract = null } = {}) {
    const sourcePath = path.join(projectRoot || '', 'src', 'main.ts');
    const source = await readTextIfExists(sourcePath);
    const issues = [];

    if (!source.trim()) {
        issues.push({
            id: 'preflight_missing_main_source',
            severity: 'critical',
            message: 'src/main.ts is missing or empty before build.',
            repair: 'Restore a complete src/main.ts implementation from the selected scaffold before running build or sandbox checks.',
        });
    }

    const hasVisualAssets = generatedAssets?.assets && Object.keys(generatedAssets.assets).length > 0;
    if (hasVisualAssets && !/DreamAssets|DREAM_ASSET_PACK|DREAM_ASSET_LIST|DREAM_ASSETS/.test(source)) {
        issues.push({
            id: 'preflight_asset_pack_ignored',
            severity: 'critical',
            message: 'Generated visual assets exist, but src/main.ts never references DreamAssets or DREAM_ASSET_PACK.',
            repair: 'Load generated gameplay art through DreamAssets or DREAM_ASSET_PACK before falling back to procedural placeholders.',
        });
    }

    const requiredSlots = requiredAssetSlots(assetContract);
    const roles = generatedAssetRoles(generatedAssets);
    const missingRequiredSlots = requiredSlots
        .filter((slot) => !sourceReferencesAny(source, unique([slot.id, slot.role])))
        .map((slot) => slot.id || slot.role);
    if (missingRequiredSlots.length > 0 && roles.length > 0) {
        issues.push({
            id: 'preflight_required_asset_slots_unreferenced',
            severity: 'critical',
            message: `Required generated asset slots are not referenced before build: ${missingRequiredSlots.join(', ')}.`,
            missingSlots: missingRequiredSlots,
            repair: 'Reference each required slot by role/key and render that generated asset in the matching gameplay renderer.',
        });
    }

    const touchPointerMismatch = /addEventListener\s*\(\s*['"`]touch(?:start|move|end|cancel)['"`][\s\S]{0,240}\(\s*\w+\s*:\s*PointerEvent\s*\)/m.test(source);
    if (touchPointerMismatch) {
        issues.push({
            id: 'preflight_touch_pointer_event_mismatch',
            severity: 'critical',
            message: 'A touch event listener is wired to a handler typed as PointerEvent, which TypeScript rejects.',
            repair: 'Use pointerdown/pointermove/pointerup for PointerEvent handlers, or type touch handlers as TouchEvent/Event and narrow safely.',
        });
    }

    const likelyNoFirstFrame = source.trim()
        && /document\.createElement\s*\(\s*['"`]canvas['"`]\s*\)|getElementById\s*\(\s*['"`][^'"`]*(?:canvas|game)[^'"`]*['"`]\s*\)/i.test(source)
        && !/requestAnimationFrame|setInterval|setTimeout\s*\(\s*(?:render|draw|loop|tick|update)/i.test(source);
    if (likelyNoFirstFrame) {
        issues.push({
            id: 'preflight_no_visible_first_frame',
            severity: 'warning',
            message: 'Canvas setup does not clearly schedule an animation loop or immediate render call.',
            repair: 'Draw a visible boot frame synchronously, then start requestAnimationFrame so sandbox pixel checks see gameplay immediately.',
        });
    }

    return {
        success: !issues.some((issue) => issue.severity === 'critical'),
        issues,
    };
}

