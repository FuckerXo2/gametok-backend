// Kenney 3D model retrieval — the "RAG (simple)" step. Searches the committed catalog
// (kenney3d-catalog.json) and returns a small, relevant shortlist of GLB models for a game, keyed so
// the materializer can fetch them from R2 (kenney3d/<id>.glb). Keyword + genre-kit scoring for now;
// can be upgraded to vector/preview-embedding search later without changing callers.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

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

// Pull the JSON chunk out of a GLB (binary glTF): 12-byte header, then [len][type][data] chunks. The
// glTF JSON holds accessor min/max (the geometry bounding boxes) and material colors — everything we
// need for metadata — so we never decode the binary buffer.
function parseGlbJson(buf) {
    if (!buf || buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) return null; // magic 'glTF'
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const chunkLen = buf.readUInt32LE(offset);
        const chunkType = buf.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        if (chunkType === 0x4e4f534a) { // 'JSON'
            try {
                return JSON.parse(buf.slice(dataStart, dataStart + chunkLen).toString('utf8'));
            } catch {
                return null;
            }
        }
        offset = dataStart + chunkLen;
    }
    return null;
}

function glbNodeLocalMatrix(node) {
    const m = new THREE.Matrix4();
    if (Array.isArray(node.matrix) && node.matrix.length === 16) return m.fromArray(node.matrix);
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    return m.compose(
        new THREE.Vector3(t[0], t[1], t[2]),
        new THREE.Quaternion(r[0], r[1], r[2], r[3]),
        new THREE.Vector3(s[0], s[1], s[2]),
    );
}

// Real dimensions (world-space bounding box), longest axis, and base material colors for a GLB. Lets
// the builder size/tint a kit piece from facts instead of a blind name. Returns null on any parse miss.
export function extractGlbMetadata(buf) {
    try {
        const gltf = parseGlbJson(buf);
        if (!gltf) return null;
        const accessors = gltf.accessors || [];
        const meshes = gltf.meshes || [];
        const nodes = gltf.nodes || [];
        const box = new THREE.Box3().makeEmpty();
        const corner = new THREE.Vector3();
        const scenes = gltf.scenes || [];
        const roots = scenes.length ? (scenes[gltf.scene || 0]?.nodes || []) : nodes.map((_, i) => i);
        const visit = (idx, parent) => {
            const node = nodes[idx];
            if (!node) return;
            const world = parent.clone().multiply(glbNodeLocalMatrix(node));
            if (node.mesh != null && meshes[node.mesh]) {
                for (const prim of meshes[node.mesh].primitives || []) {
                    const acc = accessors[prim.attributes?.POSITION];
                    if (acc && Array.isArray(acc.min) && Array.isArray(acc.max)) {
                        for (const cx of [acc.min[0], acc.max[0]]) {
                            for (const cy of [acc.min[1], acc.max[1]]) {
                                for (const cz of [acc.min[2], acc.max[2]]) {
                                    box.expandByPoint(corner.set(cx, cy, cz).applyMatrix4(world));
                                }
                            }
                        }
                    }
                }
            }
            for (const child of node.children || []) visit(child, world);
        };
        const identity = new THREE.Matrix4();
        for (const idx of roots) visit(idx, identity);
        if (box.isEmpty()) return null;
        const size = box.getSize(new THREE.Vector3());
        const dims = [size.x, size.y, size.z].map((v) => Math.round(v * 100) / 100);
        const longestAxis = ['X', 'Y', 'Z'][dims.indexOf(Math.max(...dims))];
        const colors = [];
        for (const mat of gltf.materials || []) {
            const f = mat.pbrMetallicRoughness?.baseColorFactor;
            if (Array.isArray(f)) {
                const hex = '#' + [f[0], f[1], f[2]]
                    .map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0'))
                    .join('');
                if (!colors.includes(hex)) colors.push(hex);
            }
        }
        return { dims, longestAxis, colors: colors.slice(0, 4) };
    } catch {
        return null;
    }
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
                const meta = extractGlbMetadata(buf);
                ok.push(meta ? { ...m, ...meta } : m);
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
    const list = models.map((m) => {
        const facts = [];
        if (Array.isArray(m.dims)) facts.push(`${m.dims.join('×')}u`);
        if (m.longestAxis) facts.push(`long axis ${m.longestAxis}`);
        if (Array.isArray(m.colors) && m.colors.length) facts.push(m.colors.join('/'));
        const tail = facts.length ? `, ${facts.join(', ')}` : '';
        return `"${m.key}" (${m.name}, ${m.category}${tail})`;
    }).join(', ');
    return [
        'REAL 3D MODELS PROVIDED — strongly prefer them for vehicles/characters/props over hand-built Box/Cylinder geometry (best-effort, not enforced: if you build the world another way that is fine, but for anything matching a key below, a real model looks far better than boxes):',
        '  Real Kenney CC0 GLB models are inlined in this game. Load them with loadModel(). Each entry below lists its NATIVE size (Width×Height×Depth in world units), its longest axis, and its base colors — use these facts: size each model with fitSize relative to the others (a model listed 4×2×2u next to one listed 1×1×1u should stay ~4x bigger), expect the longest axis to be the model\'s length/forward, and only tint when you want to override the listed colors.',
        `  import { loadModel, preloadModels } from './threeAssets.ts'; await preloadModels([...keys]) in init; then e.g. const car = await loadModel(${JSON.stringify(models[0].key)}, { fitSize: 2, recenter: true, tint: '#cc3333' }); add to scene, register solids via collisionWorld().addMesh(car).`,
        '  SIZING IS REQUIRED, NOT OPTIONAL: Kenney kits do NOT share a scale, so a raw model imports wildly too big or too small. ALWAYS pass options.fitSize (the size in world units you want the longest dimension to be — e.g. a player car ~2) and recenter:true so the piece rests on the ground instead of floating/sinking. Use options.tint to theme a model to your palette (it multiplies the colors, so neutral/white kit pieces tint best).',
        `  Available keys: ${list}.`,
        '  NO PLACEHOLDER GEOMETRY: await preloadModels([...]) FIRST in init, then build every entity directly from loadModel(). Do NOT spawn a temporary Box/Cylinder stand-in and swap the model in later — that leaves a stray glowing box around the real model (a visible bug). If a model ever fails to load, loadModel returns a fallback; do not add your own box around it.',
        '  Code-build ONLY what these keys do NOT cover (road, terrain, lane markings, sky, UI). Anything matching a key above MUST use loadModel().',
    ].join('\n');
}
