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

// Genre families: each maps query cues (what the game is about) to pack-name cues (which packs
// look like it). This is the THEME signal — without it, scoring collapses to "which pack fills the
// most role slots", and a generic catch-all pack (e.g. Voxel Pack, all capabilities=true) wins every
// game regardless of style. q is tested against the full retrieval text; p against the pack name.
const GENRE_FAMILIES = [
    { q: /wizard|mage|magic|sorcer|spell|arcane|enchant|fantasy|\brpg\b|rogue|dungeon|slime|goblin|orc|ogre|troll|knight|elf|dwarf|dragon|medieval|\bsword\b|castle|monster|undead|skeleton|necromanc/i,
      p: /fantasy|\brpg\b|rogue|dungeon|monster|medieval|magic|knight|tiny|scribble|micro/i },
    { q: /zombie|shoot|shooter|\bgun\b|pistol|rifle|bullet|\bammo\b|blast|military|soldier|\barmy\b|\bwar\b|\btank\b|shmup|invader|turret/i,
      p: /shoot|shmup|blaster|\bgun\b|tank|military|gallery|desert/i },
    { q: /space|galaxy|cosmic|alien|\bufo\b|asteroid|spaceship|starship|nebula|planet|sci.?fi|\blaser\b/i,
      p: /space|galaxy|cosmic|alien|\bufo\b|planet/i },
    { q: /match.?3|match.?three|puzzle|\bgem\b|jewel|crystal|board.?game|connect|bubble|candy|block.?puzzle|\bswap\b/i,
      p: /puzzle|\bgem\b|jewel|\bblock\b|board|bubble|candy/i },
    { q: /platform|\bjump\b|side.?scroll|goomba|\bcoin\b|\bspike\b|\bledge\b/i,
      p: /platform|jumper|\bjump\b/i },
    { q: /\brace\b|racing|\bcar\b|\bkart\b|driv|\blap\b|\btrack\b|traffic|highway|\broad\b|vehicle/i,
      p: /racing|\bcar\b|kart|vehicle|\broad\b/i },
];

function scorePack(pack, requiredRoles, queryTokens, queryText = '') {
    const caps = pack.capabilities || {};
    const name = (pack.pack || '').toLowerCase();

    // CORE roles = the ones a game needs visually DISTINCT art for (player, enemies). These carry
    // more weight than generic breadth: a combat game wants real characters, not "has a sprite for
    // every slot".
    let coreCovered = 0;
    for (const role of ['player', 'enemies']) if (requiredRoles.has(role) && caps[role]) coreCovered += 1;

    // Secondary breadth across all required roles — a minor signal now, not the dominant one.
    let covered = 0;
    for (const role of requiredRoles) if (caps[role]) covered += 1;
    const coverage = requiredRoles.size ? covered / requiredRoles.size : 0;

    // THEME = direct name-token overlap + genre-family match. This is the PRIMARY ranker: a pack that
    // looks like the game should beat a generic pack that merely fills every role slot.
    let theme = 0;
    for (const tag of pack.genreTags || []) if (queryTokens.has(tag)) theme += 1;
    for (const fam of GENRE_FAMILIES) if (fam.q.test(queryText) && fam.p.test(name)) theme += 2;

    let score = coreCovered * 18 + coverage * 12 + theme * 22;
    if (requiredRoles.has('player') && (caps.animations || []).length) score += 5;

    // Catch-all penalty: a pack claiming (nearly) every capability is a generic grab-bag, not a
    // styled set. Without a theme match it should never be the default winner.
    const capCount = ['player', 'enemies', 'tiles', 'items', 'projectiles', 'vehicles', 'ui', 'background', 'effects']
        .filter((k) => caps[k] === true || (Array.isArray(caps[k]) && caps[k].length)).length;
    if (capCount >= 8 && theme === 0) score -= 35;

    return { score, coverage, covered, theme };
}

function groupCats(sprites = []) {
    const m = {};
    for (const s of sprites) (m[s.category] = m[s.category] || []).push(s);
    return m;
}

// Look INSIDE a pack's actual sprite roster — the pack-name match and the coarse capability flags
// can't tell a usable creature pack from a parts/construction kit. (Monster Builder Pack is flagged
// enemies:true but is 175 prop "arm" sprites + 4 eyeball "characters"; the resolver would hand the
// builder an eyeball as the wizard.) Rewards a real WHOLE player + enemy; penalizes parts kits.
function packUsability(manifest, requiredRoles) {
    if (!manifest || !Array.isArray(manifest.sprites)) return 0;
    const cats = groupCats(manifest.sprites);
    const nChar = (cats.character || []).length;
    const nEnemy = (cats.enemy || []).length;
    const nProp = (cats.prop || []).length;
    const total = manifest.sprites.length || 1;

    let u = 0;
    if (requiredRoles.has('player')) u += nChar > 0 ? 10 : -12;   // a real character, not a prop/part
    if (requiredRoles.has('enemies')) u += nEnemy > 0 ? 10 : -12; // a real enemy sprite, not just "has characters"
    u += Math.min(nChar + nEnemy, 8);                             // variety of usable actors
    // Parts kit: props swamp the pack and real actors are scarce (arms/eyes, not finished creatures).
    if (nProp / total > 0.6 && nChar + nEnemy <= 4) u -= 15;
    return u;
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
        .map((p) => ({ p, ...scorePack(p, mainRoles, queryTokens, retrievalText) }))
        .sort((a, b) => b.score - a.score || b.covered - a.covered || a.p.spriteCount - b.p.spriteCount);

    // Refine the top shortlist by INSPECTING each candidate's real sprite roster (only the top few —
    // cheap, manifests are cached). This is where a parts kit gets demoted below a usable pack of
    // equal theme/coverage.
    const shortlist = ranked.slice(0, 8).map((r) => {
        const manifest = loadPackManifest(r.p.packId);
        const usability = packUsability(manifest, mainRoles);
        return { ...r, manifest, usability, finalScore: r.score + usability };
    }).sort((a, b) => b.finalScore - a.finalScore || b.score - a.score || a.p.spriteCount - b.p.spriteCount);

    const mainPick = shortlist[0] || ranked[0];
    const main = mainPick ? (mainPick.manifest || loadPackManifest(mainPick.p.packId)) : null;

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
            top: shortlist.slice(0, 4).map((r) => `${r.p.pack}(${r.finalScore.toFixed(0)}=name${r.score.toFixed(0)}+use${r.usability},theme ${r.theme})`),
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
    if (resolution.tiles) lines.push(`  - "tiles" — ${resolution.tiles.keys.length} ground/wall tiles (fill the whole floor with tileGround(...) — see WORLD below)`);
    if (resolution.items) lines.push(`  - "items" — ${resolution.items.keys.length} pickups/props (dress the arena with scatterProps(...) — see WORLD below)`);
    if (resolution.ui) lines.push(`  - "ui.button"${resolution.ui.panel ? ', "ui.panel"' : ''}${resolution.ui.joystick ? ', "ui.joystick"' : ''} (HUD + on-screen controls)`);
    if (resolution.background) lines.push(`  - "background" — ${resolution.background.keys.length} backdrop/parallax pieces`);
    lines.push("  HOW: import { sprite, animatedSprite, tile, count, tileGround, scatterProps } from './sprite.ts'. sprite(ctx, 'player', x, y) draws the base pose centered at (x,y); animatedSprite(ctx, 'player', 'walk', t, x, y) cycles its frames (t = elapsed seconds); tile(ctx, 'tiles', i, x, y) draws one specific tile. Options: { size, scale, flipX, anchor:'bottom' } — use anchor:'bottom' so feet rest on the ground, and pass `size` to fit sprites to the world (native art is small — e.g. `size: 40` for a character). Each returns false if unavailable, so you may draw a fallback. NEVER draw a colored rectangle for anything listed above — a real sprite always looks better. Code-draw ONLY what has no sprite (HUD numbers via sdf2d, simple particles). Image smoothing is auto-set by the kernel per art style — do not touch it.");
    lines.push("  WORLD (MANDATORY — this is what makes the game look FINISHED, not empty): every frame, BEFORE drawing entities, (1) call `tileGround(ctx, canvas.width, canvas.height)` to fill the entire floor with real ground tiles — a flat color / gradient / black void is a HARD FAILURE; (2) if items exist, scatter static props ONCE at init (pick ~6-12 fixed positions away from the player spawn) and draw them each frame with `scatterProps(ctx, propList)` so the arena reads as a real place. Only if tileGround returns false (no ground art) may you fall back to a solid themed fill.");
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
export async function materializeKenney2dSprites(projectRoot, resolution = {}, { ext = 'png', pixelArt = false } = {}) {
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
            `;(window as unknown as { DREAM_PIXEL_ART?: boolean }).DREAM_PIXEL_ART = ${pixelArt ? 'true' : 'false'};`,
            'export {};',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(projectRoot, 'src', 'dreamSprites.ts'), moduleSource);
        return { count: ok.size, roles: Object.keys(roleMap) };
    } catch {
        return null;
    }
}
