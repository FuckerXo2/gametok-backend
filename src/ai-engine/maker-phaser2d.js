import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildKenneyRetrievalText } from './maker-kenney3d.js';

function r2PublicBase() {
    return (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.join(__dirname, 'phaser2d');

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
    if (/dress|outfit|wardrobe|makeover|makeup|customi|avatar|character creator|fashion|style/.test(blob)) {
        need.add('items'); need.delete('tiles');
    }
    return need;
}

let _catalog = null;
function loadPhaserCatalog() {
    if (_catalog) return _catalog;
    try {
        _catalog = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'catalog.json'), 'utf8'));
    } catch {
        _catalog = { atlases: [], tilemaps: [] };
    }
    return _catalog;
}

function tokenize(s) {
    return new Set(String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/).filter((w) => w.length > 2));
}

function scoreItem(item, queryTokens, queryText) {
    let theme = 0;
    const nameTokens = tokenize(item.key);
    for (const t of nameTokens) if (queryTokens.has(t)) theme += 2;
    if (queryText.includes(item.key.toLowerCase())) theme += 3;
    
    const richness = item.frames ? Math.min(item.frames / 10, 5) : 0;
    return theme * 10 + richness;
}

export function selectPhaser2dAssets(prompt = '', qualityIntent = {}, foundation = {}) {
    const catalog = loadPhaserCatalog();
    const retrievalText = buildKenneyRetrievalText(prompt, qualityIntent, foundation);
    const queryTokens = tokenize(retrievalText);
    const requiredRoles = deriveRequiredRoles(foundation, retrievalText);
    
    const picks = {};
    const atlases = catalog.atlases || [];
    
    const resolveRole = (targetRole, catalogRoles) => {
        const candidates = atlases.filter(a => catalogRoles.includes(a.role));
        if (!candidates.length) return null;
        return candidates
            .map(a => ({ a, score: scoreItem(a, queryTokens, retrievalText) }))
            .sort((a, b) => b.score - a.score || (b.a.frames || 0) - (a.a.frames || 0))[0].a;
    };
    
    if (requiredRoles.has('player')) picks.player = resolveRole('player', ['character', 'grabbag']);
    if (requiredRoles.has('enemies')) picks.enemy = resolveRole('enemy', ['enemy', 'character', 'grabbag']);
    if (requiredRoles.has('projectiles')) picks.projectile = resolveRole('projectile', ['prop', 'misc', 'grabbag']);
    if (requiredRoles.has('vehicles')) picks.vehicle = resolveRole('vehicle', ['misc', 'grabbag']);
    if (requiredRoles.has('items')) picks.items = resolveRole('items', ['prop', 'ui_item', 'misc', 'grabbag']);
    
    const uiCandidates = atlases.filter(a => a.role === 'ui_item' || a.role === 'misc' || a.role === 'grabbag');
    if (uiCandidates.length) {
        picks.ui = uiCandidates.sort((a, b) => (b.frames || 0) - (a.frames || 0))[0];
    }
    
    // Background picking
    const backgrounds = catalog.backgrounds || [];
    if (backgrounds.length > 0) {
        picks.background = backgrounds
            .map(b => ({ b, score: scoreItem({key: b.key}, queryTokens, retrievalText) }))
            .sort((a, b) => b.score - a.score)[0].b;
    }
    
    // Audio picking
    const audioList = catalog.audio || [];
    if (audioList.length > 0) {
        const music = audioList.filter(a => a.kind === 'music');
        if (music.length > 0) {
            picks.bgm = music.map(m => ({ m, score: scoreItem({key: m.key}, queryTokens, retrievalText) }))
                .sort((a, b) => b.score - a.score)[0].m;
        }
        
        // Grab a few SFX loosely based on theme
        const sfx = audioList.filter(a => a.kind === 'sfx')
            .map(s => ({ s, score: scoreItem({key: s.key}, queryTokens, retrievalText) }))
            .sort((a, b) => b.score - a.score).slice(0, 5).map(i => i.s);
            
        if (sfx.length > 0) {
            picks.sfx = sfx;
        }
    }
    
    return {
        picks,
        requiredRoles: [...requiredRoles],
        debug: { retrievalText: retrievalText.slice(0, 160) }
    };
}

export async function materializePhaser2dSprites(projectRoot, resolution = {}, opts = {}) {
    try {
        const keys = Object.keys(resolution);
        if (!keys.length || typeof fetch !== 'function') return null;
        
        const base = r2PublicBase();
        const atlasesData = {};
        const audioData = {};
        const backgroundsData = {};
        const roleMap = {};
        const ok = new Set();
        
        const processItem = async (role, meta) => {
            if (!meta) return;
            
            if (meta.type === 'atlas') {
                const imgRes = await fetch(`${base}/phaser2d/${meta.texture}`);
                if (!imgRes.ok) return;
                const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                if (!imgBuf.length) return;
                const ext = meta.texture.split('.').pop();
                const imageBase64 = `data:image/${ext === 'svg' ? 'svg+xml' : 'png'};base64,${imgBuf.toString('base64')}`;
                
                const jsonRes = await fetch(`${base}/phaser2d/${meta.data}`);
                if (!jsonRes.ok) return;
                const atlasJson = await jsonRes.json();
                
                let frames = {};
                if (Array.isArray(atlasJson.frames)) {
                    for (const f of atlasJson.frames) frames[f.filename] = f;
                } else if (typeof atlasJson.frames === 'object') {
                    for (const [filename, f] of Object.entries(atlasJson.frames)) frames[filename] = f;
                }
                
                const animations = {};
                const frameNames = Object.keys(frames).sort();
                if (meta.animations) {
                    for (const [animName, count] of Object.entries(meta.animations)) {
                        let matches = frameNames.filter(f => f.startsWith(animName));
                        if (matches.length === 0) matches = frameNames.filter(f => f.includes(animName));
                        if (matches.length > 0) animations[animName] = matches;
                    }
                }

                atlasesData[role] = { image: imageBase64, frames, animations };
                roleMap[role] = { base: meta.key };
                ok.add(role);
                
            } else if (meta.file && meta.file.startsWith('skies/') || meta.file?.startsWith('pics/')) {
                // Background
                const imgRes = await fetch(`${base}/phaser2d/${meta.file}`);
                if (!imgRes.ok) return;
                const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                const ext = meta.file.split('.').pop();
                backgroundsData[role] = `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${imgBuf.toString('base64')}`;
                ok.add(role);
            } else if (meta.files) {
                // Audio
                // Take the first file (prefer ogg if available in indexer, but indexer sorted it)
                const file = meta.files[0];
                const res = await fetch(`${base}/phaser2d/${file}`);
                if (!res.ok) return;
                const buf = Buffer.from(await res.arrayBuffer());
                const ext = file.split('.').pop();
                let mime = 'audio/mpeg';
                if (ext === 'ogg') mime = 'audio/ogg';
                if (ext === 'wav') mime = 'audio/wav';
                audioData[role] = `data:${mime};base64,${buf.toString('base64')}`;
                ok.add(role);
            }
        };

        for (const [logicalRole, item] of Object.entries(resolution)) {
            try {
                if (Array.isArray(item)) {
                    for (let i = 0; i < item.length; i++) {
                        await processItem(`${logicalRole}_${i}`, item[i]);
                    }
                } else {
                    await processItem(logicalRole, item);
                }
            } catch (err) { 
                console.warn(`Failed to materialize phaser asset for ${logicalRole}:`, err);
            }
        }
        
        if (!ok.size) return null;

        const allBase64Assets = {};
        for (const role in atlasesData) allBase64Assets[atlasesData[role].image] = atlasesData[role].image;
        for (const role in backgroundsData) allBase64Assets[backgroundsData[role]] = backgroundsData[role];

        const moduleSource = [
            '// Generated runtime data — DO NOT EDIT. Phaser 2D assets for this game (base64 data-URIs)',
            `;(window as unknown as { DREAM_ATLASES?: Record<string,any> }).DREAM_ATLASES = Object.assign((window as unknown as { DREAM_ATLASES?: Record<string,any> }).DREAM_ATLASES || {}, ${JSON.stringify(atlasesData)});`,
            `;(window as unknown as { DREAM_AUDIO?: Record<string,string> }).DREAM_AUDIO = Object.assign((window as unknown as { DREAM_AUDIO?: Record<string,string> }).DREAM_AUDIO || {}, ${JSON.stringify(audioData)});`,
            `;(window as unknown as { DREAM_BACKGROUNDS?: Record<string,string> }).DREAM_BACKGROUNDS = Object.assign((window as unknown as { DREAM_BACKGROUNDS?: Record<string,string> }).DREAM_BACKGROUNDS || {}, ${JSON.stringify(backgroundsData)});`,
            `;(window as unknown as { DREAM_ASSETS?: Record<string,string> }).DREAM_ASSETS = Object.assign((window as unknown as { DREAM_ASSETS?: Record<string,string> }).DREAM_ASSETS || {}, ${JSON.stringify(allBase64Assets)});`,
            `;(window as unknown as { DREAM_SPRITE_ROLES?: unknown }).DREAM_SPRITE_ROLES = ${JSON.stringify(roleMap)};`,
            `;(window as unknown as { DREAM_PIXEL_ART?: boolean }).DREAM_PIXEL_ART = ${opts.pixelArt ? 'true' : 'false'};`,
            'export {};',
            '',
        ].join('\n');
        
        fs.writeFileSync(path.join(projectRoot, 'src', 'dreamSprites.ts'), moduleSource);
        return { count: ok.size, roles: Array.from(ok) };
    } catch (err) {
        console.error("materializePhaser2dSprites error:", err);
        return null;
    }
}

export function phaser2dSpritePromptBlock(resolution = {}) {
    const roles = Object.keys(resolution);
    if (!roles.length) return '';
    const lines = [
        'REAL 2D ASSETS PROVIDED (Phaser atlases, audio, backgrounds) — strongly prefer these over hand-drawn primitives (ctx.fillRect/arc).',
        'All helpers are exported from \'./sprite.ts\'. Import ONLY what you need:',
        '',
        '  import { sprite, animatedSprite, hasAtlas, drawAtlas, playAnim, tileGround, scatterProps, drawParallax, hasAudio, playSFX, playBGM, stopBGM, hasBackground, drawBackground } from \'./sprite.ts\';',
        '',
        'AVAILABLE ASSETS:',
    ];
    const actor = (r, v) => {
        const anims = v.animations ? Object.keys(v.animations) : null;
        lines.push(`  - "${r}" (atlas)${anims && anims.length ? ` — animations: ${anims.join(', ')}` : ''}`);
    };
    
    if (resolution.player) actor('player', resolution.player);
    if (resolution.enemy) actor('enemy', resolution.enemy);
    if (resolution.projectile) lines.push(`  - "projectile" (atlas)`);
    if (resolution.vehicle) lines.push(`  - "vehicle" (atlas)`);
    if (resolution.items) lines.push(`  - "items" (atlas)`);
    if (resolution.ui) lines.push(`  - "ui" (atlas)`);
    if (resolution.background) lines.push(`  - "background" (full-screen image)`);
    if (resolution.bgm) lines.push(`  - "bgm" (looping background music)`);
    if (resolution.sfx && resolution.sfx.length) {
        for (let i = 0; i < resolution.sfx.length; i++) lines.push(`  - "sfx_${i}" (sound effect)`);
    }
    
    lines.push('');
    lines.push('HOW TO USE (copy-paste these patterns):');
    lines.push('  SPRITES:     playAnim(ctx, \'player\', \'run\', t, x, y, { size: 64, anchor: \'bottom\', flipX: !facingRight })');
    lines.push('               drawAtlas(ctx, \'enemy\', \'idle/frame0001\', x, y, { size: 48 })');
    lines.push('               if (!playAnim(ctx, \'player\', \'idle\', t, x, y)) { /* fallback rectangle */ }');
    lines.push('  BACKGROUND:  drawBackground(ctx, \'background\')  // fills entire canvas');
    lines.push('  MUSIC:       playBGM(\'bgm\', 0.3)  // call once, loops automatically, no-op if already playing');
    lines.push('               stopBGM()  // stop music');
    lines.push('  SFX:         playSFX(\'sfx_0\', 0.5)  // one-shot, overlapping is fine');
    lines.push('  CHECK FIRST: if (hasAtlas(\'player\')) { ... }  if (hasAudio(\'bgm\')) { ... }  if (hasBackground()) { ... }');
    lines.push('');
    lines.push('IMPORTANT: Do NOT access window.DREAM_* globals directly. Use ONLY the sprite.ts helpers above.');
    
    return lines.join('\n');
}
