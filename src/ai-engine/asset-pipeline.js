import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { GAMETOK_UNITY } from './gametok-unity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const AUDIO_DIR = path.join(REPO_ROOT, 'public/assets/audio');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const R2_AUDIO_CACHE_TTL_MS = 10 * 60 * 1000;
const BACKGROUND_DEFAULT_WIDTH = GAMETOK_UNITY.assetPolicy.background.defaultWidth;
const BACKGROUND_DEFAULT_HEIGHT = GAMETOK_UNITY.assetPolicy.background.defaultHeight;
const BACKGROUND_FORBIDDEN_PROMPT = GAMETOK_UNITY.assetPolicy.background.forbiddenPrompt;

let r2AudioCache = {
    expiresAt: 0,
    promise: null,
    assets: null,
};

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeId(value, fallback) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function includesAny(text, terms) {
    const haystack = String(text || '').toLowerCase();
    return terms.some((term) => haystack.includes(term));
}

function publicAudioUrl(fileName) {
    const baseUrl = String(process.env.AUDIO_ASSET_BASE || '/assets/audio').replace(/\/+$/, '');
    return `${baseUrl}/${encodePath(fileName)}`;
}

function encodePath(fileName) {
    const encodedPath = String(fileName || '')
        .split(/[\\/]+/)
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
    return encodedPath;
}

function titleFromFile(fileName) {
    return path.basename(fileName, path.extname(fileName))
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function walkAudioFiles(dir, baseDir = dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkAudioFiles(absolutePath, baseDir));
            continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(ext)) continue;
        files.push(path.relative(baseDir, absolutePath).split(path.sep).join('/'));
    }
    return files;
}

function audioKindForPath(fileName) {
    const name = String(fileName || '').toLowerCase();
    if (includesAny(name, [
        'soundeffects/',
        'kyobi/wavs/',
        'stacker/',
        'monsters/',
        'sfx',
        'shot',
        'hit',
        'impact',
        'click',
        'pickup',
        'collect',
        'coin',
        'jump',
        'whoosh',
        'explode',
        'explosion',
        'laser',
        'lazer',
        'death',
        'warning',
        'miss',
        'place',
        'door',
        'key',
        'battery',
        'sword',
        'pistol',
        'blaster',
    ])) {
        return 'sfx';
    }
    return 'music';
}

function getLocalAudioLibrary() {
    try {
        const preferredByKey = new Map();
        const extensionRank = { '.mp3': 4, '.ogg': 3, '.m4a': 2, '.wav': 1 };
        walkAudioFiles(AUDIO_DIR)
            .forEach((fileName) => {
                const name = fileName.toLowerCase();
                const key = safeId(fileName.slice(0, -path.extname(fileName).length), 'audio');
                const asset = {
                    key,
                    label: titleFromFile(fileName),
                    file: fileName,
                    url: publicAudioUrl(fileName),
                    kind: audioKindForPath(fileName),
                    tags: name.replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean),
                };
                const existing = preferredByKey.get(key);
                const ext = path.extname(fileName).toLowerCase();
                const existingExt = existing ? path.extname(existing.file).toLowerCase() : '';
                if (!existing || (extensionRank[ext] || 0) > (extensionRank[existingExt] || 0)) {
                    preferredByKey.set(key, asset);
                }
            });
        return Array.from(preferredByKey.values());
    } catch (error) {
        console.warn('[asset-pipeline] Could not read public audio library:', error.message);
        return [];
    }
}

function hasR2Config() {
    return Boolean(
        process.env.R2_BUCKET_NAME &&
        process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY
    );
}

function r2PublicUrl(key) {
    const publicUrlBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
    return `${String(publicUrlBase).replace(/\/+$/, '')}/${encodePath(key)}`;
}

function createR2Client() {
    return new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
}

async function listR2AudioPrefix(client, prefix) {
    const assets = [];
    let continuationToken;
    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
        }));
        for (const object of response.Contents || []) {
            const key = object.Key || '';
            const ext = path.extname(key).toLowerCase();
            if (!AUDIO_EXTENSIONS.has(ext)) continue;
            assets.push({
                key: safeId(key.slice(0, -ext.length), 'audio'),
                label: titleFromFile(key),
                file: key,
                url: r2PublicUrl(key),
                kind: audioKindForPath(key),
                source: 'r2',
                tags: key.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean),
            });
        }
        continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return assets;
}

async function getR2AudioLibrary() {
    if (!hasR2Config()) return [];

    const now = Date.now();
    if (r2AudioCache.assets && r2AudioCache.expiresAt > now) {
        return r2AudioCache.assets;
    }
    if (r2AudioCache.promise) return r2AudioCache.promise;

    r2AudioCache.promise = (async () => {
        try {
            const client = createR2Client();
            const groups = await Promise.all([
                listR2AudioPrefix(client, 'kenney-wave1/'),
                listR2AudioPrefix(client, 'phaser-assets/'),
            ]);
            const assets = groups.flat();
            r2AudioCache.assets = assets;
            r2AudioCache.expiresAt = Date.now() + R2_AUDIO_CACHE_TTL_MS;
            console.log(`[asset-pipeline] Loaded ${assets.length} R2 audio assets`);
            return assets;
        } catch (error) {
            console.warn('[asset-pipeline] Could not load R2 audio library:', error.message);
            return [];
        } finally {
            r2AudioCache.promise = null;
        }
    })();

    return r2AudioCache.promise;
}

function scoreAudioAsset(asset, text) {
    const haystack = `${asset.label} ${asset.tags.join(' ')}`.toLowerCase();
    const query = String(text || '').toLowerCase();
    let score = 0;
    for (const token of query.split(/[^a-z0-9]+/).filter(Boolean)) {
        if (token.length > 2 && haystack.includes(token)) score += 2;
    }
    if (includesAny(query, ['space', 'shooter', 'arcade', 'laser']) && includesAny(haystack, ['shmup', 'astro', 'goldrunner', 'gemattack'])) score += 8;
    if (includesAny(query, ['jungle', 'forest', 'nature']) && haystack.includes('jungle')) score += 8;
    if (includesAny(query, ['quest', 'dungeon', 'magic', 'wizard', 'fantasy']) && includesAny(haystack, ['quest', 'wizball', 'pandora', 'enigma'])) score += 8;
    if (includesAny(query, ['retro', '8bit', 'pixel', 'arcade']) && includesAny(haystack, ['4bit', '8bit', 'chiptune', 'wizball'])) score += 8;
    if (includesAny(query, ['intense', 'combat', 'boss', 'fast', 'neon']) && includesAny(haystack, ['overkill', 'hardcore', 'goa', 'remix'])) score += 8;
    if (includesAny(query, ['tech', 'cyber', 'future', 'machine', 'robot']) && includesAny(haystack, ['tech', 'synth', 'bass', 'drums'])) score += 8;
    return score;
}

function pickAudioAssets(assets, text, count = 1) {
    return assets
        .map((asset) => ({ asset, score: scoreAudioAsset(asset, text) }))
        .sort((a, b) => b.score - a.score || a.asset.label.localeCompare(b.asset.label))
        .slice(0, count)
        .map((entry) => entry.asset);
}

function scoreSfxAsset(asset, cue, specText) {
    const haystack = `${asset.label} ${asset.tags.join(' ')}`.toLowerCase();
    const cueText = `${cue.key} ${cue.role} ${cue.trigger} ${cue.style} ${specText}`.toLowerCase();
    if (haystack.includes('dog') && !includesAny(cueText, ['dog', 'animal', 'bark'])) return -100;

    let score = scoreAudioAsset(asset, cueText);
    if (includesAny(haystack, ['audiosprite', 'sprites']) && !includesAny(cueText, ['ambience', 'loop', 'music'])) score -= 6;
    if (cue.key === 'ui_tap' && includesAny(haystack, ['click', 'menu', 'select', 'switch', 'ui', 'numkey'])) score += 14;
    if (cue.key === 'impact' && includesAny(haystack, ['hit', 'impact', 'boss', 'explode', 'explosion', 'wall'])) score += 14;
    if (cue.key === 'collect' && includesAny(haystack, ['pickup', 'key', 'battery', 'coin', 'collect', 'match', 'chain'])) score += 14;
    if (cue.key === 'primary_action' && includesAny(haystack, ['shot', 'shoot', 'blaster', 'lazer', 'laser', 'sword', 'pistol', 'magical', 'fx'])) score += 14;
    if (cue.key === 'movement_burst' && includesAny(haystack, ['whoosh', 'steps', 'jump', 'door', 'dash'])) score += 14;
    if (cue.key === 'success' && includesAny(haystack, ['gamewon', 'nextlevel', 'chain', 'match', 'success', 'pickup'])) score += 14;
    if (cue.key === 'failure' && includesAny(haystack, ['gameover', 'gamelost', 'death', 'warning', 'miss', 'fail'])) score += 14;
    return score;
}

function pickSfxAsset(assets, cue, specText, usedFiles) {
    const ranked = assets
        .filter((asset) => !usedFiles.has(asset.file))
        .map((asset) => ({ asset, score: scoreSfxAsset(asset, cue, specText) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.asset.label.localeCompare(b.asset.label));
    if (ranked[0]?.asset) return ranked[0].asset;
    return assets.find((asset) => !usedFiles.has(asset.file)) || null;
}

function collectSpecText(qualityIntent = {}) {
    return [
        qualityIntent.userIntent,
        qualityIntent.playableExperience?.coreFantasy,
        qualityIntent.playableExperience?.coreLoop,
        qualityIntent.playableExperience?.primaryMechanic,
        qualityIntent.technicalRequirements?.screenComposition,
        ...asArray(qualityIntent.playerActions),
        ...asArray(qualityIntent.mustExist),
        ...asArray(qualityIntent.feelRules),
        ...asArray(qualityIntent.failureModesToAvoid),
        ...asArray(qualityIntent.entityRules).flatMap((rule) => [
            rule.entity,
            rule.role,
            rule.behavior,
            rule.interaction,
            rule.feedback,
        ]),
    ].filter(Boolean).join(' ');
}

function findRoleDescription(assetRoles, assetId, fallback = '') {
    const match = asArray(assetRoles).find((role) => role.assetId === assetId || role.assetId === safeId(assetId, assetId));
    return match?.roleInGameplay || fallback;
}

function buildArtDirectionSuffix(artDirection = {}, kind = 'sprite') {
    const parts = [];
    if (artDirection.styleName) parts.push(`Art style: ${artDirection.styleName}.`);
    if (Array.isArray(artDirection.palette) && artDirection.palette.length > 0) {
        parts.push(`Palette: ${artDirection.palette.slice(0, 6).join(', ')}.`);
    }
    if (kind === 'background') {
        if (artDirection.backgroundStyle) parts.push(`Background style: ${artDirection.backgroundStyle}.`);
        if (artDirection.screenComposition) parts.push(`Mobile composition: ${artDirection.screenComposition}.`);
    } else {
        if (artDirection.spriteStyle) parts.push(`Sprite style: ${artDirection.spriteStyle}.`);
        if (artDirection.spriteCameraAngle) parts.push(`Camera angle: ${artDirection.spriteCameraAngle}.`);
    }
    if (Array.isArray(artDirection.consistencyRules) && artDirection.consistencyRules.length > 0) {
        parts.push(`Consistency: ${artDirection.consistencyRules.slice(0, 3).join(' ')}`);
    }
    return parts.join(' ');
}

function withArtDirection(description, artDirection = {}, kind = 'sprite') {
    return [
        description,
        buildArtDirectionSuffix(artDirection, kind),
    ].filter(Boolean).join(' ');
}

function pushRequest(requests, request, seen) {
    const id = safeId(request.id, `asset_${requests.length + 1}`);
    if (seen.has(id)) return;
    seen.add(id);
    requests.push({
        ...request,
        id,
    });
}

export async function buildDreamAssetPlan(qualityIntent = {}) {
    const visualAssets = qualityIntent.visualAssets || {};
    const assetRoles = asArray(qualityIntent.assetRoles);
    const artDirection = qualityIntent.artDirection || {};
    const requests = [];
    const seen = new Set();

    if (visualAssets.player) {
        pushRequest(requests, {
            id: 'player',
            assetType: 'sprite',
            description: withArtDirection(visualAssets.player.description, artDirection, 'sprite'),
            category: 'player',
            role: 'player',
            gameplayRole: findRoleDescription(assetRoles, 'player', 'main playable character'),
            size: visualAssets.player.size || 128,
            transparent: visualAssets.player.transparent !== false,
        }, seen);
    }

    asArray(visualAssets.enemies).forEach((enemy, idx) => {
        const id = enemy.id || `enemy${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: withArtDirection(enemy.description, artDirection, 'sprite'),
            category: 'enemy',
            role: 'enemy',
            gameplayRole: findRoleDescription(assetRoles, id, 'opponent or hazard'),
            size: enemy.size || 128,
            transparent: enemy.transparent !== false,
        }, seen);
    });

    asArray(visualAssets.items).forEach((item, idx) => {
        const id = item.id || `item${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: withArtDirection(item.description, artDirection, 'sprite'),
            category: 'item',
            role: 'item',
            gameplayRole: findRoleDescription(assetRoles, id, 'pickup, collectible, power-up, or resource'),
            size: item.size || 64,
            transparent: item.transparent !== false,
        }, seen);
    });

    asArray(visualAssets.backgrounds).forEach((bg, idx) => {
        const id = bg.id || `background${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'background',
            description: [
                withArtDirection(bg.description, artDirection, 'background'),
                BACKGROUND_FORBIDDEN_PROMPT
            ].filter(Boolean).join(' '),
            category: 'environment',
            role: 'background',
            gameplayRole: findRoleDescription(assetRoles, id, 'main playfield backdrop'),
            width: Number(bg.width || BACKGROUND_DEFAULT_WIDTH),
            height: Number(bg.height || BACKGROUND_DEFAULT_HEIGHT),
            size: bg.size || null,
            transparent: bg.transparent === true,
        }, seen);
    });

    // HUD and touch controls are rendered by the game runtime. Do not generate
    // AI-image HUD panels/buttons by default; they tend to look inconsistent and
    // often include unusable text.

    asArray(visualAssets.props).forEach((prop, idx) => {
        const id = prop.id || `prop${idx + 1}`;
        pushRequest(requests, {
            id,
            assetType: 'sprite',
            description: withArtDirection(prop.description, artDirection, 'sprite'),
            category: 'prop',
            role: 'prop',
            gameplayRole: findRoleDescription(assetRoles, id, 'obstacle, decoration, or interactive prop'),
            size: prop.size || 96,
            transparent: prop.transparent !== false,
        }, seen);
    });

    const specText = collectSpecText(qualityIntent);
    const animations = buildAnimationPlan(requests, qualityIntent);
    const audio = await buildAudioPlan(qualityIntent);
    const tilesets = buildTilesetPlan(qualityIntent, specText);

    return {
        version: 2,
        source: 'gametok-generate-game-assets-request',
        qualityIntent,
        artDirection,
        styleAnchor: [
            artDirection.styleName,
            Array.isArray(artDirection.palette) ? artDirection.palette.join(', ') : null,
            artDirection.spriteStyle,
        ].filter(Boolean).join('; '),
        outputDirName: 'runtime/DREAM_ASSET_PACK',
        imageRequests: requests,
        animations,
        audio,
        tilesets,
    };
}

export function buildStructuredAssetToolRequest(assetPlan = {}, assetContract = null) {
    const imageRequests = asArray(assetPlan?.imageRequests).map((request) => {
        const assetType = request.assetType === 'background' ? 'background' : 'image';
        return {
            type: assetType,
            key: request.id || request.key,
            role: request.role || request.category || 'prop',
            description: request.description,
            params: assetType === 'background'
                ? { resolution: `${request.width || BACKGROUND_DEFAULT_WIDTH}x${request.height || BACKGROUND_DEFAULT_HEIGHT}` }
                : { size: request.size || 128, transparent: request.transparent !== false },
            required: Boolean(asArray(assetContract?.slots).find((slot) => slot.id === request.id || slot.role === request.role)?.required),
        };
    });
    const animations = asArray(assetPlan?.animations).map((animation) => ({
        type: 'animation',
        key: animation.key,
        sourceKey: animation.sourceKey,
        role: animation.role,
        states: animation.states || [],
        implementation: animation.implementation,
    }));
    const audio = [
        ...asArray(assetPlan?.audio?.sfx).map((sound) => ({ ...sound, type: 'audio', audioType: 'sfx' })),
        ...asArray(assetPlan?.audio?.music).map((track) => ({ ...track, type: 'audio', audioType: 'bgm' })),
    ];
    const tilesets = asArray(assetPlan?.tilesets).map((tileset) => ({
        type: 'tileset',
        key: tileset.key,
        role: tileset.role || 'environment',
        description: tileset.description || '',
        tileSize: tileset.tileSize || 32,
        coreGrid: tileset.coreGrid || '3x3',
        expandedGrid: tileset.expandedGrid || '7x7',
        instructions: tileset.instructions || [],
    }));

    return {
        version: 1,
        tool: 'gametok_generate_game_assets',
        source: 'native-maker-asset-plan',
        styleAnchor: assetPlan?.styleAnchor || '',
        output: {
            runtimeGlobals: ['window.DREAM_ASSETS', 'window.DREAM_ASSET_PACK', 'window.DREAM_ASSET_MANIFEST'],
            files: ['asset-plan.json', 'asset-tool-request.json', 'asset-manifest.json', 'asset-summary.json'],
            manifestType: 'GameTok maker asset manifest v3',
        },
        assets: [
            ...imageRequests,
            ...animations,
            ...audio,
            ...tilesets,
        ],
        constraints: [
            'HUD, controls, labels, meters, sliders, and readable UI text are never generated as images.',
            'Backgrounds are scenery only and do not define collision or tactical geometry.',
            'Sprites are isolated subjects with transparent backgrounds unless asset type is background.',
            'All outputs must resolve to runtime keys consumed through DreamAssets or DREAM_ASSET_PACK.',
        ],
    };
}

function buildAnimationPlan(requests, qualityIntent = {}) {
    const perspective = String(qualityIntent.technicalRequirements?.perspective || '').toLowerCase();
    const isTopDown = perspective === 'top_down' || perspective === 'isometric';
    const player = requests.find((request) => request.role === 'player');
    const enemies = requests.filter((request) => request.role === 'enemy').slice(0, 3);
    const animations = [];

    if (player) {
        animations.push({
            key: 'player_idle',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: ['idle'],
            implementation: 'subtle breathing scale, small vertical bob, cloak/limb sway if applicable',
        });
        animations.push({
            key: 'player_move',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: isTopDown ? ['move_up', 'move_down', 'move_left', 'move_right'] : ['move'],
            implementation: 'direction-aware flip/rotation, squash on acceleration, dust or trail particles',
        });
        animations.push({
            key: 'player_hit_or_dash',
            type: 'procedural_tween',
            sourceKey: player.id,
            role: 'player',
            states: ['hit', 'dash'],
            implementation: 'flash tint, afterimage trail, brief scale pop, short hit-stop on impact',
        });
    }

    enemies.forEach((enemy) => {
        animations.push({
            key: `${enemy.id}_motion`,
            type: 'procedural_tween',
            sourceKey: enemy.id,
            role: 'enemy',
            states: ['idle', 'move', 'hit', 'defeat'],
            implementation: 'squash-and-stretch movement, hit flash, particle burst on defeat',
        });
    });

    return animations;
}

async function buildAudioPlan(qualityIntent = {}) {
    const sfxNeeds = asArray(qualityIntent.audioNeeds?.sfx);
    const musicNeeds = asArray(qualityIntent.audioNeeds?.music);
    const specText = collectSpecText(qualityIntent);
    const r2Library = await getR2AudioLibrary();
    const localLibrary = r2Library.length > 0 ? [] : getLocalAudioLibrary();
    const library = r2Library.length > 0 ? r2Library : localLibrary;
    const musicLibrary = library.filter((asset) => asset.kind === 'music');
    const sfxLibrary = library.filter((asset) => asset.kind === 'sfx');
    const selectedMusic = pickAudioAssets(musicLibrary, `${specText} ${musicNeeds.join(' ')}`, Math.max(1, Math.min(3, musicNeeds.length || 1)));
    const resolvedMusic = selectedMusic.length > 0
        ? selectedMusic
        : musicLibrary.slice(0, Math.max(1, Math.min(3, musicNeeds.length || 1)));
    const mustExistText = asArray(qualityIntent.mustExist).join(' ');
    const defaults = [
        { key: 'ui_tap', role: 'ui', trigger: 'button press or menu selection', style: 'short UI cue' },
        { key: 'impact', role: 'feedback', trigger: 'player or enemy takes damage', style: 'impact or tension cue' },
        { key: 'collect', role: 'reward', trigger: 'pickup, score, combo, or resource gain', style: 'reward cue' },
        { key: 'success', role: 'success', trigger: 'correct action, order complete, or milestone', style: 'short victory sparkle' },
        { key: 'failure', role: 'failure', trigger: 'wrong action, timeout, or penalty', style: 'short descending sting' },
    ];

    if (includesAny(mustExistText, ['cast', 'spell', 'shoot', 'fire', 'attack'])) {
        defaults.push({ key: 'primary_action', role: 'action', trigger: 'main player attack/cast/use action', style: 'snappy magical or arcade burst' });
    }
    if (includesAny(mustExistText, ['dash', 'boost', 'jump', 'move'])) {
        defaults.push({ key: 'movement_burst', role: 'movement', trigger: 'dash, jump, boost, or fast movement', style: 'quick whoosh' });
    }

    const usedSfxFiles = new Set();
    const sfx = defaults
        .map((entry, index) => {
            const audioAsset = pickSfxAsset(sfxLibrary, entry, `${specText} ${sfxNeeds.join(' ')}`, usedSfxFiles);
            if (!audioAsset) return null;
            usedSfxFiles.add(audioAsset.file);
            return {
                ...entry,
                type: 'audio_file',
                assetType: 'sfx',
                description: sfxNeeds[index] || entry.style,
                label: audioAsset.label,
                url: audioAsset.url,
                sourceFile: audioAsset.file,
            };
        })
        .filter(Boolean);

    const music = resolvedMusic.length > 0
        ? resolvedMusic.map((audioAsset, index) => ({
            key: index === 0 ? 'bgm_main' : `bgm_${index + 1}`,
            type: 'audio_file',
            assetType: 'music',
            role: 'background_music',
            trigger: 'gameplay loop',
            description: musicNeeds[index] || 'looping background music from the local game audio library',
            label: audioAsset.label,
            url: audioAsset.url,
            sourceFile: audioAsset.file,
            loop: true,
            source: 'auto_library',
        }))
        : [];
    const librarySource = r2Library.length > 0 ? 'r2' : 'public/assets/audio';

    return {
        sfx,
        music,
        library: {
            source: librarySource,
            r2Available: r2Library.length,
            localAvailable: localLibrary.length,
            available: library.length,
            selected: sfx.length + music.length,
        },
    };
}

function normalizeAttachmentType(type = '') {
    const normalized = String(type || '').trim().toLowerCase();
    switch (normalized) {
        case 'photo':
        case 'gif':
        case 'sticker':
            return 'image';
        case 'music':
            return 'bgm';
        case 'audio':
            return 'sfx';
        default:
            return normalized || 'image';
    }
}

function normalizeAttachmentRole(role = '', type = '') {
    const normalized = String(role || '').trim().toLowerCase();
    const normalizedType = normalizeAttachmentType(type);
    if (!normalized) {
        if (normalizedType === 'bgm') return 'bgm';
        if (normalizedType === 'sfx') return 'sfx';
        if (normalizedType === 'video') return 'background';
        return 'hero';
    }
    if (normalized === 'music') return 'bgm';
    if (normalized === 'audio') return 'sfx';
    return normalized;
}

export function findUserBgmAttachment(mediaAttachments = []) {
    return asArray(mediaAttachments).find((asset) => {
        if (!asset?.url) return false;
        const type = normalizeAttachmentType(asset.type);
        const role = normalizeAttachmentRole(asset.role, asset.type);
        return type === 'bgm' || role === 'bgm';
    }) || null;
}

function buildUserBgmTrack(attachment = {}) {
    return {
        key: 'bgm_main',
        type: 'audio_file',
        assetType: 'music',
        role: 'background_music',
        trigger: 'gameplay loop',
        description: attachment.instruction || 'User-selected background music',
        label: attachment.title || attachment.label || 'User BGM',
        url: attachment.url,
        sourceFile: attachment.url,
        loop: true,
        source: 'user_attachment',
    };
}

function isAudioPackEntry(entry = {}) {
    const type = String(entry?.type || entry?.assetType || '').toLowerCase();
    const role = String(entry?.role || entry?.category || '').toLowerCase();
    return ['sfx', 'music', 'audio', 'audio_file'].includes(type)
        || ['sfx', 'background_music', 'music', 'bgm'].includes(role);
}

function syncAudioIntoBundle(generatedAssets, audio) {
    const audioPackEntries = [
        ...asArray(audio?.sfx).map((sound) => ({ ...sound, type: 'sfx' })),
        ...asArray(audio?.music).map((track) => ({ ...track, type: 'music' })),
    ];

    if (!generatedAssets) {
        return {
            assets: {},
            assetPack: audioPackEntries,
            manifest: {
                version: 2,
                assets: [],
                animations: [],
                audio,
                tilesets: [],
            },
            animations: [],
            audio,
            tilesets: [],
        };
    }

    const nonAudioPack = asArray(generatedAssets.assetPack).filter((entry) => !isAudioPackEntry(entry));
    return {
        ...generatedAssets,
        audio,
        manifest: {
            ...(generatedAssets.manifest || {}),
            audio,
        },
        assetPack: [...nonAudioPack, ...audioPackEntries],
    };
}

export async function resolveDreamAudioForJob({
    generatedAssets = null,
    mediaAttachments = [],
    qualityIntent = {},
    assetPlan = null,
} = {}) {
    const userBgm = findUserBgmAttachment(mediaAttachments);
    let audio = generatedAssets?.audio || assetPlan?.audio || null;

    if (!audio || (!asArray(audio.music).length && !asArray(audio.sfx).length)) {
        audio = await buildAudioPlan(qualityIntent);
    }

    if (userBgm) {
        const preservedMusic = asArray(audio.music).filter((track) => track.key !== 'bgm_main');
        audio = {
            sfx: asArray(audio.sfx),
            music: [buildUserBgmTrack(userBgm), ...preservedMusic],
        };
    } else if (!asArray(audio.music).length) {
        const fallbackAudio = await buildAudioPlan(qualityIntent);
        audio = {
            sfx: asArray(audio.sfx).length ? asArray(audio.sfx) : asArray(fallbackAudio.sfx),
            music: asArray(fallbackAudio.music),
        };
    }

    return syncAudioIntoBundle(generatedAssets, audio);
}

function buildTilesetPlan(qualityIntent = {}, specText = '') {
    const needsTiles = includesAny(specText, [
        'tile',
        'tileset',
        'platform',
        'maze',
        'grid',
        'dungeon',
        'room',
        'wall',
        'floor',
        'terrain',
    ]);

    if (!needsTiles) return [];

    return [{
        key: 'world_tileset',
        type: 'generated_tileset',
        role: 'environment',
        description: [
            qualityIntent.artDirection?.terrainStyle,
            qualityIntent.artDirection?.backgroundStyle,
            qualityIntent.artDirection?.styleName,
            specText,
        ].filter(Boolean).join(' '),
        coreGrid: '3x3',
        expandedGrid: '7x7',
        tileSize: 32,
        instructions: [
            'Generate a repeatable 3x3 core tile vocabulary from the game art direction.',
            'Expand into a 7x7 rule grid with deterministic corners, edges, and center fills.',
            'Use this for collision platforms, arena walls, floors, paths, rooms, or terrain whenever the game needs tile rhythm.',
        ],
    }];
}

function inferProductionArchetype(qualityIntent = {}) {
    const perspective = String(qualityIntent.technicalRequirements?.perspective || '').toLowerCase();
    const dimension = String(qualityIntent.technicalRequirements?.dimension || '2D').toUpperCase();
    const text = collectSpecText(qualityIntent).toLowerCase();

    if (dimension === '3D') {
        if (perspective === 'first_person') return 'three_first_person';
        if (perspective === 'third_person') return 'three_third_person';
        return 'three_scene';
    }
    if (includesAny(text, ['turn-based', 'turn based', 'artillery', 'worms-style', 'tank wars', 'tank warfare', 'scorched earth', 'wind and power'])) return 'turn_based_projectile';
    if (includesAny(text, ['lander', 'thruster', 'fuel', 'landing pad', 'soft touchdown'])) return 'physics_lander';
    if (perspective === 'side_view' && includesAny(text, ['gravity', 'jump', 'platform', 'fall', 'terrain'])) return 'side_physics';
    if (perspective === 'top_down' || perspective === 'isometric') return 'top_down_action';
    if (includesAny(text, ['grid', 'tile', 'match', 'board', 'puzzle'])) return 'grid_logic';
    return 'mobile_arcade';
}

function buildRuntimeContract(qualityIntent = {}, assetPlan = {}) {
    qualityIntent = qualityIntent || {};
    const artDirection = assetPlan?.artDirection || qualityIntent.artDirection || {};
    const imageRequests = asArray(assetPlan?.imageRequests);
    const byRole = (role) => imageRequests.filter((asset) => asset.role === role || asset.category === role).map((asset) => asset.id);
    const hasTilesets = asArray(assetPlan?.tilesets).length > 0;
    const hasAudio = asArray(assetPlan?.audio?.sfx).length + asArray(assetPlan?.audio?.music).length > 0;

    return {
        version: 1,
        archetype: inferProductionArchetype(qualityIntent),
        output: 'single self-contained mobile HTML5 game',
        screen: {
            target: 'portrait phone inside GameTok preview chrome',
            widthStrategy: 'window.innerWidth or visualViewport.width',
            heightStrategy: 'window.innerHeight or visualViewport.height',
            safeTopPx: 112,
            safeBottomPx: 48,
            required: 'all HUD, controls, score, prompts, and important gameplay spawn inside DreamAssets.safeRect(width,height)',
        },
        assets: {
            sourceOfTruth: 'window.DREAM_ASSET_PACK and window.DREAM_ASSET_MANIFEST',
            player: byRole('player'),
            enemies: byRole('enemy'),
            items: byRole('item'),
            props: byRole('prop'),
            backgrounds: byRole('background').concat(byRole('environment')),
            animations: asArray(assetPlan?.animations).map((animation) => animation.key),
            audio: hasAudio ? 'DREAM_AUDIO_MANIFEST real audio files' : 'no real audio selected; remain playable without audio',
            tilesets: hasTilesets ? 'DREAM_TILESETS available for tile rhythm' : 'no tileset required',
        },
        renderingRules: [
            'background images are scenery layers only, never collision terrain or readable UI',
            'player/enemy/item/prop sprites come from DREAM_ASSET_PACK when available',
            'HUD, labels, meters, buttons, turn prompts, aim/power panels, score, and controls are code-rendered',
            'gameplay geometry is code-defined: terrain, landing pads, paths, walls, hitboxes, destructible ground, and tactical grids',
            'terrain and runtime UI must visually follow artDirection.terrainStyle and artDirection.uiStyle',
            'never navigate outside the generated game or open external URLs',
        ],
        firstFrameAcceptance: [
            'the game canvas fills the phone viewport with no horizontal scroll',
            'the main playfield is visible below the GameTok top chrome',
            'the player or controlled object is visible and correctly scaled',
            'the objective/target/hazard is visible or introduced within two seconds',
            'the code-rendered HUD shows only necessary state and does not overlap native app chrome',
            'touch controls are visible when needed and do not cover the main action',
        ],
        gameplayAcceptance: [
            qualityIntent.playableExperience?.primaryMechanic || 'primary mechanic works from touch input',
            qualityIntent.playableExperience?.coreLoop || 'repeatable input -> reaction -> feedback loop exists',
            ...(asArray(qualityIntent.mustExist).slice(0, 10)),
        ].filter(Boolean),
        artDirection,
    };
}

export function compileDreamAssetBundle(generatedImages = null, assetPlan = null) {
    if (!generatedImages) return null;

    const imagePack = Array.isArray(generatedImages.assetPack) ? generatedImages.assetPack : [];
    const manifestAssets = Array.isArray(generatedImages.manifest?.assets) ? generatedImages.manifest.assets : [];
    const plannedAnimations = Array.isArray(assetPlan?.animations) ? assetPlan.animations : [];
    const frameAnimations = Array.isArray(generatedImages.animations) ? generatedImages.animations : [];
    const animations = Array.from(new Map([
        ...plannedAnimations,
        ...frameAnimations,
    ].filter(Boolean).map((animation) => [animation.key || JSON.stringify(animation), animation])).values());
    const audio = assetPlan?.audio || { sfx: [], music: [] };
    const tilesets = Array.isArray(generatedImages.tilesets) && generatedImages.tilesets.length > 0
        ? generatedImages.tilesets
        : (assetPlan?.tilesets || []);
    const productionContract = buildRuntimeContract(assetPlan?.qualityIntent || null, assetPlan);

    return {
        ...generatedImages,
        assetPlan,
        productionContract,
        manifest: {
            version: 2,
            artDirection: assetPlan?.artDirection || null,
            productionContract,
            assets: manifestAssets,
            animations,
            audio,
            tilesets,
        },
        assetPack: [
            ...imagePack,
            ...animations.map((animation) => ({
                key: animation.key,
                type: 'animation',
                sourceKey: animation.sourceKey,
                role: animation.role,
                states: animation.states || [],
                implementation: animation.implementation,
            })),
            ...audio.sfx.map((sound) => ({ ...sound, type: 'sfx' })),
            ...audio.music.map((track) => ({ ...track, type: 'music' })),
            ...tilesets.map((tileset) => ({ ...tileset, type: 'tileset' })),
        ],
        animations,
        audio,
        tilesets,
    };
}
