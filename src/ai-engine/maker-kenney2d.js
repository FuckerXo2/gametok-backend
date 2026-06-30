// Kenney 2D sprite retrieval — the "RAG (simple)" step for 2D, mirroring maker-kenney3d.js.
//
// Reads the committed SPLIT catalog (kenney2d/pack-index.json + packs/<packId>.json). Unlike 3D
// (one flat list), 2D is hierarchical for two reasons:
//   - SCALE: ~29k sprites can't go in a prompt, so retrieval scans only the small pack-index, picks
//     ONE coherent pack (+ a shared UI and background pack), then loads just that pack's manifest.
//   - COHERENCE: one pack per game keeps the art style consistent (the v1 "ransom note" failure).
//
// Scoring is CAPABILITY-driven: "can this pack fill the roles this game needs?" (player/enemies/
// tiles/...) with genre/keyword overlap as the tiebreak — NOT lane routing (the lane library was
// reverted; see CLAUDE.md). The Asset Resolver (asset-resolver.js) maps logical roles onto the
// chosen pack afterwards, so the builder never sees Kenney filenames.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildKenneyRetrievalText } from './maker-kenney3d.js';

function r2PublicBase() {
    return (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.join(__dirname, 'kenney2d');

let _index = null;
function loadPackIndex() {
    if (_index) return _index;
    try {
        _index = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'pack-index.json'), 'utf8'));
    } catch {
        _index = { packs: [] };
    }
    return _index;
}

const _manifestCache = new Map();
export function loadPackManifest(packId) {
    if (_manifestCache.has(packId)) return _manifestCache.get(packId);
    let manifest = null;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'packs', `${packId}.json`), 'utf8'));
    } catch { manifest = null; }
    _manifestCache.set(packId, manifest);
    return manifest;
}

const ROLE_KEYS = ['player', 'enemies', 'tiles', 'items', 'projectiles', 'vehicles', 'background'];

function tokenize(s) {
    return new Set(String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/).filter((w) => w.length > 2));
}

// What roles does THIS game need? Derived from the foundation's entity blueprints + the retrieval
// text (genre cues), never from the raw prompt language alone. Always assumes a player + a world.
export function deriveRequiredRoles(foundation = {}, retrievalText = '') {
    const need = new Set(['player', 'tiles']);
    const t = retrievalText.toLowerCase();
    const blob = [
        ...(Array.isArray(foundation.entityBlueprints) ? foundation.entityBlueprints : [])
            .map((b) => (typeof b === 'string' ? b : `${b?.name || ''} ${b?.role || ''} ${b?.description || ''}`)),
        t,
    ].join(' ').toLowerCase();

    if (/enemy|enemies|zombie|monster|foe|boss|alien|invader|horde|wave/.test(blob)) need.add('enemies');
    if (/bullet|projectile|shoot|laser|missile|arrow|gun|blast|fire\b/.test(blob)) need.add('projectiles');
    if (/coin|gem|pickup|collect|item|loot|powerup|star|food|fruit|key|treasure/.test(blob)) need.add('items');
    if (/car|vehicle|tank|ship|racer|drive|kart|plane/.test(blob)) need.add('vehicles');
    if (/sky|outdoor|space|forest|scroll|parallax|backdrop|background|world/.test(blob)) need.add('background');
    // Dress-up / character-creator: the player IS the content; items = wardrobe pieces.
    if (/dress|outfit|wardrobe|makeover|makeup|customi|avatar|character creator|fashion|style/.test(blob)) {
        need.add('items'); need.delete('tiles');
    }
    return need;
}

function scorePack(pack, requiredRoles, queryTokens) {
    const caps = pack.capabilities || {};
    let covered = 0;
    for (const role of requiredRoles) if (caps[role]) covered += 1;
    const coverage = requiredRoles.size ? covered / requiredRoles.size : 0;

    // Capability coverage dominates; genre/keyword overlap breaks ties.
    let score = coverage * 100;
    let kw = 0;
    for (const tag of pack.genreTags || []) if (queryTokens.has(tag)) kw += 1;
    score += Math.min(kw, 6) * 4;
    // Small nudge: animated packs feel more alive when the game needs a moving player.
    if (requiredRoles.has('player') && (caps.animations || []).length) score += 5;
    // A pack that covers EVERY required role beats a partial one of equal keyword score.
    if (covered === requiredRoles.size && requiredRoles.size > 0) score += 8;
    return { score, coverage, covered };
}

/**
 * Pick the assets for a 2D game: one coherent main pack, plus a shared UI pack and background pack.
 * @returns {{ main, ui, background, requiredRoles:string[], debug }} manifests (or null) for each slot.
 */
export function selectKenney2dPacks(prompt = '', qualityIntent = {}, foundation = {}) {
    const index = loadPackIndex();
    if (!index.packs || !index.packs.length) return { main: null, ui: null, background: null, requiredRoles: [], debug: 'empty catalog' };

    const retrievalText = buildKenneyRetrievalText(prompt, qualityIntent, foundation);
    const queryTokens = tokenize(retrievalText);
    const requiredRoles = deriveRequiredRoles(foundation, retrievalText);
    // UI/background come from dedicated slots, so the MAIN pack is scored on gameplay roles only.
    const mainRoles = new Set([...requiredRoles].filter((r) => r !== 'background'));

    const ranked = index.packs
        .filter((p) => !p.ui) // UI packs are scored separately for the UI slot
        .map((p) => ({ p, ...scorePack(p, mainRoles, queryTokens) }))
        .sort((a, b) => b.score - a.score || b.covered - a.covered || a.p.spriteCount - b.p.spriteCount);

    const mainPick = ranked[0];
    const main = mainPick ? loadPackManifest(mainPick.p.packId) : null;

    // UI slot: best-covering UI pack (prefer style match with main).
    const uiRanked = index.packs.filter((p) => p.capabilities?.ui)
        .map((p) => ({ p, kw: [...(p.genreTags || [])].filter((t) => queryTokens.has(t)).length,
            styleMatch: main && p.style === main.style ? 1 : 0 }))
        .sort((a, b) => b.styleMatch - a.styleMatch || b.kw - a.kw || a.p.spriteCount - b.p.spriteCount);
    const ui = uiRanked.length ? loadPackManifest(uiRanked[0].p.packId) : null;

    // Background slot: only if the game wants one; prefer a dedicated background pack.
    let background = null;
    if (requiredRoles.has('background')) {
        const bgRanked = index.packs.filter((p) => p.capabilities?.background && !p.ui)
            .map((p) => ({ p, kw: [...(p.genreTags || [])].filter((t) => queryTokens.has(t)).length }))
            .sort((a, b) => b.kw - a.kw || a.p.spriteCount - b.p.spriteCount);
        if (bgRanked.length) background = loadPackManifest(bgRanked[0].p.packId);
    }

    return {
        main,
        ui,
        background,
        requiredRoles: [...requiredRoles],
        debug: {
            retrievalText: retrievalText.slice(0, 160),
            top: ranked.slice(0, 4).map((r) => `${r.p.pack}(${r.score.toFixed(0)},cov ${(r.coverage * 100).toFixed(0)}%)`),
        },
    };
}

/**
 * Builder-prompt block for a 2D game — mirrors kenney3dModelPromptBlock. Lists the LOGICAL roles +
 * animations available this game (never raw Kenney filenames; the resolver + runtime role-map handle
 * concrete keys). Tells the builder to reach for the easy sprite helpers instead of drawing primitives.
 */
export function kenney2dSpritePromptBlock(resolution = {}) {
    const roles = Object.keys(resolution);
    if (!roles.length) return '';
    const lines = ['REAL 2D SPRITES PROVIDED — strongly prefer these over hand-drawn primitives (ctx.fillRect/arc). Each is referenced by its LOGICAL name; the runtime resolves it to the actual art:'];
    const actor = (r, v) => {
        const anims = v.animations && Object.keys(v.animations).length ? Object.keys(v.animations) : null;
        lines.push(`  - "${r}" (${v.w || '?'}x${v.h || '?'})${anims ? ` — animations: ${anims.join(', ')}` : ''}`);
    };
    if (resolution.player) actor('player', resolution.player);
    if (resolution.enemy) actor('enemy', resolution.enemy);
    if (resolution.projectile) lines.push(`  - "projectile" (${resolution.projectile.w || '?'}x${resolution.projectile.h || '?'})`);
    if (resolution.vehicle) lines.push(`  - "vehicle" (${resolution.vehicle.w || '?'}x${resolution.vehicle.h || '?'})`);
    if (resolution.tiles) lines.push(`  - "tiles" — ${resolution.tiles.keys.length} ground/wall tiles (use tile('tiles', i) to vary)`);
    if (resolution.items) lines.push(`  - "items" — ${resolution.items.keys.length} pickups/props`);
    if (resolution.ui) lines.push(`  - "ui.button"${resolution.ui.panel ? ', "ui.panel"' : ''}${resolution.ui.joystick ? ', "ui.joystick"' : ''} (HUD + on-screen controls)`);
    if (resolution.background) lines.push(`  - "background" — ${resolution.background.keys.length} backdrop/parallax pieces`);
    lines.push("  HOW: import { sprite, animatedSprite, tile, count } from './sprite.ts'. sprite(ctx, 'player', x, y) draws the base pose centered at (x,y); animatedSprite(ctx, 'player', 'walk', t, x, y) cycles its frames (t = elapsed seconds); tile(ctx, 'tiles', i, x, y) draws the i-th tile (count('tiles') for the total). Options: { size, scale, flipX, anchor:'bottom' } — use anchor:'bottom' so feet rest on the ground. Each returns false if unavailable, so you may draw a fallback. NEVER draw a colored rectangle for anything listed above — a real sprite always looks better. Code-draw ONLY what has no sprite (HUD numbers via sdf2d, simple particles).");
    return lines.join('\n');
}

// Every unique sprite key a resolution map references (base poses + animation frames + lists).
function keysInResolution(res = {}) {
    const keys = new Set();
    const add = (k) => { if (k) keys.add(k); };
    for (const role of ['player', 'enemy']) {
        if (res[role]) { add(res[role].key); Object.values(res[role].animations || {}).flat().forEach(add); }
    }
    for (const role of ['projectile', 'vehicle']) if (res[role]) add(res[role].key);
    for (const role of ['tiles', 'items', 'background']) (res[role]?.keys || []).forEach(add);
    if (res.ui) ['button', 'panel', 'joystick'].forEach((r) => add(res.ui[r]));
    return [...keys];
}

/**
 * Fetch the resolved sprites from R2 and write them into the game as a bundled module
 * (src/dreamSprites.ts): base64 data-URIs in window.DREAM_ASSETS (loaded by assetLoader.ts) plus a
 * logical role map in window.DREAM_SPRITE_ROLES (consumed by the sprite.ts helper). Mirrors 3D's
 * materializeKenney3dModels — self-contained game, no runtime fetch/CORS. Fully guarded: any failure
 * returns null and the builder falls back to code-drawn primitives. Drops keys that fail to fetch.
 * @returns {Promise<null | { count:number, roles:string[] }>}
 */
export async function materializeKenney2dSprites(projectRoot, resolution = {}, { ext = 'png' } = {}) {
    try {
        const keys = keysInResolution(resolution);
        if (!keys.length || typeof fetch !== 'function') return null;
        const base = r2PublicBase();
        const assets = {};
        const ok = new Set();
        for (const key of keys) {
            try {
                const res = await fetch(`${base}/kenney2d/${key}.${ext}`);
                if (!res.ok) continue;
                const buf = Buffer.from(await res.arrayBuffer());
                if (!buf.length) continue;
                assets[key] = `data:image/${ext === 'svg' ? 'svg+xml' : 'png'};base64,${buf.toString('base64')}`;
                ok.add(key);
            } catch { /* skip this sprite; resolver/builder degrade gracefully */ }
        }
        if (!ok.size) return null;

        const keep = (arr) => (arr || []).filter((k) => ok.has(k));
        const actor = (a) => (a && ok.has(a.key)) ? {
            base: a.key,
            animations: Object.fromEntries(Object.entries(a.animations || {})
                .map(([n, f]) => [n, keep(f)]).filter(([, f]) => f.length)),
        } : null;

        const roleMap = {};
        if (actor(resolution.player)) roleMap.player = actor(resolution.player);
        if (actor(resolution.enemy)) roleMap.enemy = actor(resolution.enemy);
        for (const r of ['projectile', 'vehicle']) if (resolution[r] && ok.has(resolution[r].key)) roleMap[r] = { base: resolution[r].key };
        for (const r of ['tiles', 'items', 'background']) if (resolution[r]) { const k = keep(resolution[r].keys); if (k.length) roleMap[r] = k; }
        if (resolution.ui) {
            const ui = {};
            for (const slot of ['button', 'panel', 'joystick']) if (ok.has(resolution.ui[slot])) ui[slot] = resolution.ui[slot];
            if (Object.keys(ui).length) roleMap.ui = ui;
        }

        const moduleSource = [
            '// Generated runtime data — DO NOT EDIT. Kenney 2D sprites for this game (base64 data-URIs)',
            '// + the logical role map. Imported first by bootstrap; sprite.ts resolves logical names here.',
            `;(window as unknown as { DREAM_ASSETS?: Record<string,string> }).DREAM_ASSETS = Object.assign((window as unknown as { DREAM_ASSETS?: Record<string,string> }).DREAM_ASSETS || {}, ${JSON.stringify(assets)});`,
            `;(window as unknown as { DREAM_SPRITE_ROLES?: unknown }).DREAM_SPRITE_ROLES = ${JSON.stringify(roleMap)};`,
            'export {};',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(projectRoot, 'src', 'dreamSprites.ts'), moduleSource);
        return { count: ok.size, roles: Object.keys(roleMap) };
    } catch {
        return null;
    }
}
