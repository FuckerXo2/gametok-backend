import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CATALOG_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-catalog.json');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'kenney-wave1-intelligence.json');

const NOISE_PATTERNS = [
  /^letter[a-z0-9_-]*\./i,
  /^number\d+/i,
  /^tilemap(?:_packed)?\./i,
  /^colormap\./i,
  /^normalmap\./i,
  /^roughness\./i,
  /^metalness\./i,
  /^ao\./i,
];

const ROLE_PATTERNS = {
  player: [/plane/i, /survivor/i, /hero/i, /player/i, /hitman/i, /soldier/i, /man[A-Z]/i, /robot\d/i, /knight/i, /archer/i, /wizard/i, /human/i, /keeper/i, /adventurer/i],
  enemy: [/zombie/i, /skeleton/i, /slime/i, /orc/i, /enemy/i, /goblin/i, /ghost/i, /vampire/i, /monster/i],
  pickup: [/coin/i, /gem/i, /key/i, /chest/i, /heart/i, /pickup/i, /ammo/i, /medkit/i, /potion/i],
  environment: [/background/i, /terrain_/i, /^tile_/i, /cloud/i, /tree/i, /column/i, /wall/i, /floor/i, /road/i, /grave/i, /arena/i, /dungeon/i],
  prop: [/barrel/i, /crate/i, /sign/i, /torch/i, /banner/i, /barricade/i, /weapon/i, /shield/i, /coffin/i, /fence/i],
  ui: [/button/i, /hud_/i, /frame/i, /border/i, /divider/i, /text/i, /label/i],
  control: [/joystick/i, /button_/i],
  audio: [/\.ogg$/i, /\.wav$/i, /\.mp3$/i],
  model3d: [/\.glb$/i, /\.gltf$/i],
};

function inferRoles(asset) {
  const haystack = `${asset.filename} ${asset.relativeFromPack || ''} ${asset.kind}`;
  const roles = Object.entries(ROLE_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(haystack)))
    .map(([role]) => role);
  if (roles.includes('control')) return ['control', 'ui'];
  if (roles.includes('ui')) return ['ui'];
  if (roles.includes('audio')) return ['audio'];
  if (roles.includes('model3d') && roles.length === 1) return ['model3d', 'prop'];
  if (roles.length > 0) return roles;
  if (asset.kind === 'control') return ['control', 'ui'];
  if (asset.kind === 'audio') return ['audio'];
  if (asset.kind === 'model') return ['model3d', 'prop'];
  if (asset.kind === 'environment') return ['environment'];
  if (asset.kind === 'character') return ['player'];
  return ['misc'];
}

function computeKeywords(asset) {
  const rawTokens = [
    asset.lane,
    asset.runtime,
    asset.role,
    asset.packName,
    asset.packSlug,
    asset.kind,
    asset.filename.replace(/\.[^.]+$/, ''),
    ...(asset.tags || []),
  ]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return [...new Set(rawTokens)].slice(0, 24);
}

function isUseful(asset) {
  if (NOISE_PATTERNS.some((pattern) => pattern.test(asset.filename))) {
    return false;
  }
  if (asset.kind === 'preview') return false;
  if (asset.filename.endsWith('.meta')) return false;
  return true;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(DEFAULT_CATALOG_PATH, 'utf8'));
  const enrichedAssets = catalog.assets.map((asset) => {
    const useful = isUseful(asset);
    const semanticRoles = inferRoles(asset);
    const keywords = computeKeywords(asset);
    const qualityHint = useful ? (semanticRoles.includes('player') || semanticRoles.includes('enemy') || semanticRoles.includes('pickup') ? 'hero' : 'support') : 'noise';
    return {
      ...asset,
      useful,
      semanticRoles,
      keywords,
      qualityHint,
    };
  });

  const usefulAssets = enrichedAssets.filter((asset) => asset.useful);
  const summary = {
    totals: {
      assets: enrichedAssets.length,
      usefulAssets: usefulAssets.length,
      noiseAssets: enrichedAssets.length - usefulAssets.length,
    },
    byLane: Object.fromEntries(
      [...new Set(enrichedAssets.map((asset) => asset.lane))].map((lane) => {
        const laneAssets = enrichedAssets.filter((asset) => asset.lane === lane);
        return [lane, {
          assets: laneAssets.length,
          usefulAssets: laneAssets.filter((asset) => asset.useful).length,
          heroAssets: laneAssets.filter((asset) => asset.useful && asset.qualityHint === 'hero').length,
        }];
      })
    ),
  };

  fs.writeFileSync(DEFAULT_OUTPUT_PATH, JSON.stringify({ summary, assets: enrichedAssets }, null, 2));
  console.log(`Wrote ${DEFAULT_OUTPUT_PATH}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
