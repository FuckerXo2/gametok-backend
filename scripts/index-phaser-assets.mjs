import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '../public/assets');
const CATALOG_PATH = path.join(__dirname, '../src/ai-engine/phaser2d/catalog.json');

// Helper to deeply scan a directory
function walkSync(dir, filelist = []) {
    if (!fs.existsSync(dir)) return filelist;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walkSync(filepath, filelist);
        } else {
            filelist.push(filepath);
        }
    }
    return filelist;
}

const allFiles = walkSync(ASSETS_DIR);
const relPath = (p) => path.relative(ASSETS_DIR, p).replace(/\\/g, '/');

const catalog = {
    generatedAt: new Date().toISOString(),
    source: "gametok-backend/public/assets",
    note: "rel paths double as R2 key suffixes under phaser2d/. Heavy art is gitignored; upload separately.",
    atlases: [],
    tilemaps: [],
    audio: [],
    sprites: [],
    backgrounds: []
};

// Indexing Atlases
const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
const pngFiles = allFiles.filter(f => f.endsWith('.png'));

for (const jPath of jsonFiles) {
    try {
        const relJ = relPath(jPath);
        if (!relJ.startsWith('atlas/') && !relJ.startsWith('animations/')) continue;
        
        const data = JSON.parse(fs.readFileSync(jPath, 'utf8'));
        const imagePath = jPath.replace('.json', '.png');
        
        if (fs.existsSync(imagePath) && (data.frames || data.textures)) {
            let framesCount = 0;
            if (Array.isArray(data.frames)) framesCount = data.frames.length;
            else if (typeof data.frames === 'object') framesCount = Object.keys(data.frames).length;
            else if (data.textures && data.textures[0] && data.textures[0].frames) framesCount = data.textures[0].frames.length;

            const baseName = path.basename(jPath, '.json');
            
            // Heuristic for role
            let role = 'misc';
            const nameLower = baseName.toLowerCase();
            if (nameLower.includes('player') || nameLower.includes('alien') || nameLower.includes('dude') || nameLower.includes('brawler') || nameLower.includes('knight') || nameLower.includes('char') || nameLower.includes('hero') || nameLower.includes('ryu')) role = 'character';
            else if (nameLower.includes('enemy') || nameLower.includes('zombie') || nameLower.includes('monster') || nameLower.includes('boss') || nameLower.includes('bot')) role = 'enemy';
            else if (nameLower.includes('bullet') || nameLower.includes('laser') || nameLower.includes('rocket') || nameLower.includes('fire')) role = 'projectile';
            else if (nameLower.includes('ui') || nameLower.includes('button') || nameLower.includes('icon') || nameLower.includes('banner')) role = 'ui_item';
            else if (nameLower.includes('item') || nameLower.includes('coin') || nameLower.includes('gem') || nameLower.includes('chest')) role = 'prop';
            else if (nameLower.includes('ship') || nameLower.includes('car') || nameLower.includes('plane')) role = 'vehicle';
            else role = 'grabbag';

            catalog.atlases.push({
                key: baseName,
                role,
                type: 'atlas',
                texture: relPath(imagePath),
                data: relJ,
                frames: framesCount
            });
        }
    } catch(e) {}
}

// Indexing Tilemaps
for (const jPath of jsonFiles) {
    try {
        const relJ = relPath(jPath);
        if (!relJ.startsWith('tilemaps/')) continue;
        
        const data = JSON.parse(fs.readFileSync(jPath, 'utf8'));
        if (data.layers && data.tilesets) {
            const tilesets = data.tilesets.map(ts => {
                // Try to find the image in the same directory or globally
                let imgPath = ts.image;
                if (!imgPath) return null;
                // Just keep it simple for now, we'll store the reference
                const possibleImg = path.join(path.dirname(jPath), path.basename(imgPath));
                let foundImg = null;
                if (fs.existsSync(possibleImg)) {
                    foundImg = relPath(possibleImg);
                } else {
                    // Search all pngs
                    const bname = path.basename(imgPath);
                    const match = pngFiles.find(p => path.basename(p) === bname);
                    if (match) foundImg = relPath(match);
                }
                
                return {
                    name: ts.name,
                    image: foundImg,
                    margin: ts.margin || 0,
                    spacing: ts.spacing || 0,
                    tilewidth: ts.tilewidth,
                    tileheight: ts.tileheight
                };
            }).filter(Boolean);

            catalog.tilemaps.push({
                key: path.basename(jPath, '.json'),
                type: 'tilemap_tiled_json',
                data: relJ,
                tilesets: tilesets
            });
        }
    } catch(e) {}
}

// Indexing Audio
const audioExts = new Set(['.mp3', '.ogg', '.wav', '.m4a']);
const audioFiles = allFiles.filter(f => audioExts.has(path.extname(f).toLowerCase()));

for (const aPath of audioFiles) {
    const relA = relPath(aPath);
    if (!relA.startsWith('audio/')) continue;
    const baseName = path.basename(aPath, path.extname(aPath));
    const size = fs.statSync(aPath).size;
    let kind = 'sfx';
    if (size > 1024 * 1024 || baseName.toLowerCase().includes('music') || baseName.toLowerCase().includes('bgm') || baseName.toLowerCase().includes('theme')) kind = 'music';
    
    // Deduplicate by key (prefer ogg, then mp3, then wav)
    let existing = catalog.audio.find(a => a.key === baseName);
    if (existing) {
        existing.files.push(relA);
    } else {
        catalog.audio.push({
            key: baseName,
            kind,
            files: [relA]
        });
    }
}

// Indexing Backgrounds
const bgExts = new Set(['.png', '.jpg', '.jpeg']);
const bgFiles = allFiles.filter(f => bgExts.has(path.extname(f).toLowerCase()));

for (const bgPath of bgFiles) {
    const relBg = relPath(bgPath);
    if (relBg.startsWith('skies/') || relBg.startsWith('pics/')) {
        catalog.backgrounds.push({
            key: path.basename(bgPath, path.extname(bgPath)),
            file: relBg
        });
    }
}

// Indexing standalone sprites
for (const sPath of pngFiles) {
    const relS = relPath(sPath);
    if (relS.startsWith('sprites/')) {
        const baseName = path.basename(sPath, '.png');
        // Heuristic: check if name looks like a spritesheet (e.g. dude-32x32)
        const match = baseName.match(/(\d+)x(\d+)/);
        let framesize = null;
        if (match) {
            framesize = { w: parseInt(match[1]), h: parseInt(match[2]) };
        }
        
        catalog.sprites.push({
            key: baseName,
            file: relS,
            framesize
        });
    }
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
console.log(`✅ Indexed ${catalog.atlases.length} atlases`);
console.log(`✅ Indexed ${catalog.tilemaps.length} tilemaps`);
console.log(`✅ Indexed ${catalog.audio.length} audio tracks`);
console.log(`✅ Indexed ${catalog.backgrounds.length} backgrounds`);
console.log(`✅ Indexed ${catalog.sprites.length} sprites`);
console.log(`Catalog saved to ${CATALOG_PATH}`);
