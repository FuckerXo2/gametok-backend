// Asset Resolver — the library-agnostic seam between retrieval and the builder.
//
// The builder asks for LOGICAL roles (player, enemy, projectile, tiles, ui, background) and never
// sees Kenney filenames. This module maps those roles onto concrete sprites in the selected pack(s),
// attaching animation sets for animated roles. Kenney is the FIRST provider behind this interface;
// a future OpenGameArt/custom library just has to produce the same normalized pack shape
// ({ sprites:[{id,name,category,w,h}], animations:[{character,name,frames}], capabilities }) and the
// builder + runtime are unchanged.

function groupByCategory(sprites = []) {
    const m = {};
    for (const s of sprites) (m[s.category] = m[s.category] || []).push(s);
    return m;
}

// Animations belonging to one character base, as { walk:[ids], jump:[ids], ... }.
function animationsFor(animations = [], character) {
    const out = {};
    for (const a of animations) if (a.character === character) out[a.name] = a.frames;
    return out;
}

const IDLE_RE = /_(?:stand|idle|default|front)$|_0$/i;
// A "base" sprite = the resting pose to show when not animating. Prefer stand/idle, else the
// shortest name (the bare character, e.g. "zombie" over "zombie_attack").
function pickBase(sprites = []) {
    if (!sprites.length) return null;
    return sprites.find((s) => IDLE_RE.test(s.name))
        || [...sprites].sort((a, b) => a.name.length - b.name.length)[0];
}

// The character with the most animations = the richest player/enemy choice.
function richestCharacter(animations = []) {
    if (!animations.length) return null;
    const count = {};
    for (const a of animations) count[a.character] = (count[a.character] || 0) + 1;
    return Object.keys(count).sort((x, y) => count[y] - count[x])[0];
}

// Resolve one animated actor (player/enemy): a base pose + its animation set.
function resolveActor(role, categorySprites, animations) {
    const character = richestCharacter(animations);
    if (character) {
        const own = (categorySprites || []).filter((s) => s.name.startsWith(character));
        const anims = animationsFor(animations, character);
        const base = pickBase(own)
            || (anims.idle && anims.idle[0]) || (anims.walk && anims.walk[0]) || null;
        const baseSprite = typeof base === 'object' ? base : (categorySprites || []).find((s) => s.id === base);
        if (baseSprite) return { role, key: baseSprite.id, w: baseSprite.w, h: baseSprite.h, animations: anims };
    }
    const base = pickBase(categorySprites || []);
    return base ? { role, key: base.id, w: base.w, h: base.h, animations: {} } : null;
}

/**
 * Map the game's required logical roles onto concrete assets in the selected packs.
 * @param {{main, ui, background}} packs - manifests from selectKenney2dPacks
 * @param {string[]} requiredRoles
 * @returns {Object} resolutionMap keyed by logical role
 */
export function resolveKenney2dAssets(packs = {}, requiredRoles = []) {
    const map = {};
    const main = packs.main;
    if (!main) return map;
    const roles = new Set(requiredRoles);
    const cat = groupByCategory(main.sprites);

    if (roles.has('player')) {
        const actor = resolveActor('player', cat.character || cat.prop || [], main.animations || []);
        if (actor) map.player = actor;
    }
    if (roles.has('enemies')) {
        const actor = resolveActor('enemy', cat.enemy || [], (main.animations || []).filter((a) =>
            (cat.enemy || []).some((s) => s.name.startsWith(a.character))));
        if (actor) map.enemy = actor;
    }
    if (roles.has('projectiles')) {
        const p = pickBase(cat.projectile || cat.item || []);
        if (p) map.projectile = { role: 'projectile', key: p.id, w: p.w, h: p.h };
    }
    if (roles.has('tiles') && cat.tile) {
        map.tiles = { role: 'tiles', keys: cat.tile.slice(0, 40).map((s) => s.id), sample: cat.tile[0]?.id };
    }
    if (roles.has('items')) {
        const items = cat.item || cat.prop || [];
        if (items.length) map.items = { role: 'items', keys: items.slice(0, 30).map((s) => s.id) };
    }
    if (roles.has('vehicles') && cat.vehicle) {
        const v = pickBase(cat.vehicle);
        if (v) map.vehicle = { role: 'vehicle', key: v.id, w: v.w, h: v.h };
    }

    if (packs.ui) {
        const ui = groupByCategory(packs.ui.sprites).ui || packs.ui.sprites || [];
        const find = (re) => (ui.find((s) => re.test(s.name)) || {}).id;
        map.ui = {
            role: 'ui',
            pack: packs.ui.pack,
            button: find(/button/i) || ui[0]?.id,
            panel: find(/panel|frame|window/i),
            joystick: find(/joystick|stick|dpad|thumb/i),
        };
    }
    if (packs.background) {
        const bg = (packs.background.sprites || []).filter((s) => s.category === 'background');
        const pool = bg.length ? bg : (packs.background.sprites || []);
        map.background = { role: 'background', pack: packs.background.pack, keys: pool.slice(0, 8).map((s) => s.id) };
    }

    return map;
}
