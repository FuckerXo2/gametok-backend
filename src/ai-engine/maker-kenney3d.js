// Kenney 3D model retrieval — the "RAG (simple)" step. Searches the committed catalog
// (kenney3d-catalog.json) and returns a small, relevant shortlist of GLB models for a game, keyed so
// the materializer can fetch them from R2 (kenney3d/<id>.glb). Keyword + genre-kit scoring for now;
// can be upgraded to vector/preview-embedding search later without changing callers.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _catalog = null;
function loadCatalog() {
    if (_catalog) return _catalog;
    try {
        _catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'kenney3d-catalog.json'), 'utf8'));
    } catch {
        _catalog = { models: [] };
    }
    return _catalog;
}

// Genre cue in the prompt -> strongly-preferred kits.
const GENRE_KITS = [
    [/rac(e|ing)|kart|drift|\btrack\b|\bcar\b|driving/i, ['Car Kit', 'Road Pack', 'Racing Kit', 'Toy Car Kit']],
    [/city|street|urban|town|traffic/i, ['City Kit - Roads', 'City Kit - Commercial', 'City Kit - Suburban', 'City Kit - Industrial', 'Modular Buildings', 'Retro Urban Kit']],
    [/dungeon|crawl/i, ['Modular Dungeon Kit', 'Mini Dungeon']],
    [/castle|fantasy|knight|medieval|kingdom/i, ['Castle Kit', 'Fantasy Town Kit', 'Retro Fantasy Kit']],
    [/space|sci-?fi|galaxy|alien|spaceship|station|cosmic/i, ['Space Kit', 'Space Station Kit', 'Modular Space Kit']],
    [/pirate|ship|\bsea\b|ocean|boat|sail/i, ['Pirate Kit', 'Watercraft Pack']],
    [/forest|nature|tree|outdoor|wild|park|jungle/i, ['Nature Kit', 'Nature Kit (Classic)']],
    [/zombie|survival|apocalypse|wasteland/i, ['Survival Kit', 'Graveyard Kit']],
    [/tower defense|\btd\b/i, ['Tower Defense Kit', 'Tower Defense (Classic)']],
    [/food|cook|kitchen|restaurant|diner/i, ['Food Kit']],
    [/house|home|\broom\b|interior|furniture|office/i, ['Furniture Kit', 'Modular Buildings']],
    [/shoot|\bgun\b|weapon|\bfps\b|battle|\bwar\b|blast/i, ['Weapon Pack', 'Blaster Kit']],
    [/train|railway|locomotive/i, ['Train Kit']],
    [/skate|skating/i, ['Mini Skate']],
    [/golf/i, ['Minigolf Kit']],
    [/pet|animal|creature/i, ['Cube Pets']],
];

function tokenize(s) {
    return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
}

/**
 * Pick a relevant shortlist of Kenney GLB models for a game.
 * @param {string} prompt - the game idea / foundation summary
 * @param {{limit?:number, perKitCap?:number}} opts
 * @returns {Array<{id,name,kit,category,key}>} shortlist (key = R2 object key kenney3d/<id>.glb)
 */
export function selectKenney3dModels(prompt, { limit = 24, perKitCap = 10 } = {}) {
    const catalog = loadCatalog();
    if (!catalog.models || !catalog.models.length) return [];
    const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
    const tokens = new Set([...tokenize(prompt)].map(stem)); // plural-insensitive (cars -> car)
    const preferredKits = new Set();
    for (const [re, kits] of GENRE_KITS) if (re.test(prompt || '')) kits.forEach((k) => preferredKits.add(k));

    const scored = [];
    for (const m of catalog.models) {
        let score = 0;
        if (preferredKits.has(m.kit)) score += 10;
        for (const t of m.tags) if (tokens.has(stem(t))) score += 3;
        if (tokens.has(stem(m.category))) score += 2;
        if (score > 0) scored.push({ m, score });
    }
    scored.sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));

    const perKit = {};
    const out = [];
    for (const { m } of scored) {
        perKit[m.kit] = perKit[m.kit] || 0;
        if (perKit[m.kit] >= perKitCap) continue;
        perKit[m.kit] += 1;
        out.push({ id: m.id, name: m.name, kit: m.kit, category: m.category, key: `kenney3d/${m.id}.glb` });
        if (out.length >= limit) break;
    }
    return out;
}

export function kenney3dCatalogStats() {
    const c = loadCatalog();
    return { total: c.total || (c.models ? c.models.length : 0), kits: c.kits || 0, byCategory: c.byCategory || {} };
}

function r2PublicBase() {
    return (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
}

/**
 * Materialize Kenney models for a 3D game: pick a shortlist, fetch each GLB from R2 server-side,
 * inline them as base64 in window.DREAM_MODELS (injected into the game's index.html so loadModel()
 * resolves keys to data-URIs — no CORS, no runtime fetch). Fully guarded: ANY failure returns [] so
 * the builder simply falls back to code geometry. Returns the models that actually materialized.
 * @returns {Promise<Array<{id,name,kit,category,key}>>}
 */
export async function materializeKenney3dModels(projectRoot, prompt, { limit = 18 } = {}) {
    try {
        const picks = selectKenney3dModels(prompt, { limit });
        if (!picks.length) return [];
        if (typeof fetch !== 'function') return [];
        const base = r2PublicBase();
        const inlined = {};
        const ok = [];
        for (const m of picks) {
            try {
                const res = await fetch(`${base}/${m.key}`);
                if (!res.ok) continue;
                const buf = Buffer.from(await res.arrayBuffer());
                if (!buf.length) continue;
                inlined[m.key] = `data:model/gltf-binary;base64,${buf.toString('base64')}`;
                ok.push(m);
            } catch { /* skip this model (e.g. kit not uploaded yet) */ }
        }
        if (!ok.length) return [];
        const indexPath = path.join(projectRoot, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        const script = `<script>window.DREAM_MODELS=${JSON.stringify(inlined)};</script>`;
        html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${script}\n</head>`) : `${script}\n${html}`;
        fs.writeFileSync(indexPath, html);
        return ok;
    } catch {
        return [];
    }
}

/** One-line builder-prompt block listing the model keys available via loadModel() this game. */
export function kenney3dModelPromptBlock(models) {
    if (!Array.isArray(models) || !models.length) return '';
    const list = models.map((m) => `"${m.key}" (${m.name}, ${m.category})`).join(', ');
    return [
        'REAL 3D MODELS PROVIDED — USING THEM IS MANDATORY (do NOT hand-build these from Box/Cylinder geometry):',
        '  Real Kenney CC0 GLB models are already inlined in this game. The player vehicle/character AND any matching entities (traffic cars, enemies, props) MUST be loaded with loadModel(). Building them from BoxGeometry instead is a HARD FAILURE and will force a repair turn.',
        `  import { loadModel, preloadModels } from './threeAssets.ts'; await preloadModels([...keys]) in init; then const car = await loadModel(${JSON.stringify(models[0].key)}); position/scale the returned Group, add it to the scene, register solids via collisionWorld().addMesh(car).`,
        `  Available keys: ${list}.`,
        '  NO PLACEHOLDER GEOMETRY: await preloadModels([...]) FIRST in init, then build every entity directly from loadModel(). Do NOT spawn a temporary Box/Cylinder stand-in and swap the model in later — that leaves a stray glowing box around the real model (a visible bug). If a model ever fails to load, loadModel returns a fallback; do not add your own box around it.',
        '  Code-build ONLY what these keys do NOT cover (road, terrain, lane markings, sky, UI). Anything matching a key above MUST use loadModel().',
    ].join('\n');
}
