import { isTimedOrderCookingLane } from './maker-lane-scaffolds.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function slugifyHudBlock(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'stat';
}

/** Legacy opt-in: pre-render kernel .hud-chip boxes. Default off — Phase 2 designs HUD. */
export function usesKernelHudScaffold(foundation = {}) {
    return foundation.hudScaffold === true;
}

export function normalizeHudDesignForFoundation(foundation = {}, qualityIntent = {}) {
    const fromArchitect = asString(foundation.hudDesign);
    if (fromArchitect) return fromArchitect;
    const hudPlan = asString(
        qualityIntent?.technicalRequirements?.hudPlan
        || qualityIntent?.hudPlan,
    );
    if (hudPlan) return hudPlan;
    if (isTimedOrderCookingLane(foundation)) {
        return 'Minimal shift HUD: score and order timer only when playing; hide on game over.';
    }
    return 'Minimal mobile HUD: only stats required by the core loop; match game art style; no generic dev chips.';
}

export function capHudBlocks(blocks = [], max = 3) {
    const seen = new Set();
    const capped = [];
    for (const block of asArray(blocks)) {
        const label = asString(block);
        if (!label) continue;
        const id = slugifyHudBlock(label);
        if (seen.has(id)) continue;
        seen.add(id);
        capped.push(label);
        if (capped.length >= max) break;
    }
    return capped;
}

export function normalizeHudBlocksForFoundation(foundation = {}, qualityIntent = {}) {
    if (!usesKernelHudScaffold(foundation)) return [];
    return capHudBlocks(asArray(foundation.hudBlocks));
}

export function resolveHudAuthority(foundation = {}) {
    const explicit = asString(foundation.hudAuthority, '').toLowerCase();
    if (['dom', 'canvas', 'agent'].includes(explicit)) return explicit;

    if (usesKernelHudScaffold(foundation)) {
        const hudZone = asArray(foundation.layoutComposition?.zones)
            .find((zone) => zone?.id === 'hud');
        const zoneLayer = asString(hudZone?.layer, '').toLowerCase();
        if (zoneLayer === 'canvas') return 'canvas';
        return 'dom';
    }

    const uiAuthority = asString(foundation.uiAuthority, '').toLowerCase();
    if (uiAuthority === 'canvas') return 'canvas';
    if (isTimedOrderCookingLane(foundation) || uiAuthority === 'hybrid-zoned') return 'agent';
    return 'agent';
}

export function indexHtmlHasKernelHudChips(indexHtml = '') {
    const html = String(indexHtml || '');
    return /id\s*=\s*["']hud["']/i.test(html) && /hud-chip/i.test(html);
}

const CANVAS_HUD_CALL_PATTERN = /\b(?:drawHud|renderHud|drawHUD|renderHUD|drawFuelBar|drawFuelMeter|drawDistanceHud|drawStatsHud|renderStats|drawTopHud|drawHudBar|renderHudBar)\s*\(/i;

const CANVAS_HUD_FILL_TEXT_PATTERN = /(?:ctx|context)\.fillText\s*\(\s*['"`](?:SCORE|FUEL|DISTANCE|LIVES|TIME|COMBO|KM|MPH)/i;

export function detectDuplicateHudRendering(indexHtml = '', mainSource = '') {
    const source = String(mainSource || '');
    if (!source.trim() || !indexHtmlHasKernelHudChips(indexHtml)) {
        return { duplicate: false, reasons: [] };
    }

    const reasons = [];
    if (/\bsyncHud\s*\(/.test(source) || /\bhud\s*=\s*\{/.test(source)) {
        if (CANVAS_HUD_CALL_PATTERN.test(source)) reasons.push('canvas_hud_function');
        if (CANVAS_HUD_FILL_TEXT_PATTERN.test(source)) reasons.push('canvas_hud_fillText');
    }

    return { duplicate: reasons.length > 0, reasons, hudAuthority: 'dom' };
}

export function applyDuplicateHudCanvasRepairs(source = '') {
    let content = String(source || '');
    const removedCalls = [];

    const callPattern = /\n[ \t]*(?:await[ \t]+)?(?:drawHud|renderHud|drawHUD|renderHUD|drawFuelBar|drawFuelMeter|drawDistanceHud|drawStatsHud|renderStats|drawTopHud|drawHudBar|renderHudBar)\s*\([^;]*\)\s*;?/gi;
    content = content.replace(callPattern, (match) => {
        removedCalls.push(match.trim());
        return '\n  // preflight: removed duplicate canvas HUD call (DOM HUD is authoritative)';
    });

    const fillTextPattern = /\n[ \t]*(?:ctx|context)\.fillText\s*\(\s*['"`](?:SCORE|FUEL|DISTANCE|LIVES|TIME|COMBO)[^'"`]*['"`][^;]*;?/gi;
    content = content.replace(fillTextPattern, (match) => {
        if (!/\bsyncHud\s*\(/.test(content) && !/\bhud\s*=\s*\{/.test(content)) return match;
        removedCalls.push(match.trim());
        return '\n  // preflight: removed duplicate canvas stat label';
    });

    return { content, removedCalls, changed: removedCalls.length > 0 };
}
