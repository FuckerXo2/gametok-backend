#!/usr/bin/env node
// Phaser CDN filter pass — same-shape output as Kenney's v2-filter.mjs. Every keep/reject/defer
// carries a reason string for auditability.
import fs from 'fs';
import path from 'path';

const STAGING = 'v2-catalog/staging/phaser-cdn';
const manifest = JSON.parse(fs.readFileSync(path.join(STAGING, '_manifest.json')));

// --- SEMANTIC KEEP RULES (verified via preview inspection) ---
// Match on id fragment; matched items get labeled with the shape below.
const KEEPS = [
  { match: /animations\/knight__/, label: { source: 'phaser-cdn animations/knight', species: 'human', asset_type: 'character', theme: 'fantasy', playable_role: 'player', perspective: 'side', movement: 'ground', quality: 5, desc_prefix: 'pixel-art armored knight with sword' } },
  { match: /animations\/soldier__/, label: { source: 'phaser-cdn animations/soldier', species: 'human', asset_type: 'character', theme: 'military', playable_role: 'generic', perspective: 'side', movement: 'ground', quality: 4, desc_prefix: 'WWII-era camo soldier with rifle' } },
  { match: /animations\/zombie__/, label: { source: 'phaser-cdn animations/zombie', species: 'zombie', asset_type: 'character', theme: 'platformer', playable_role: 'enemy', perspective: 'side', movement: 'ground', quality: 5, desc_prefix: 'rendered zombie crawling on all fours, blue tattered shirt' } },
  { match: /animations\/alien__/, label: { source: 'phaser-cdn animations/alien', species: 'alien', asset_type: 'character', theme: 'sci_fi', playable_role: 'enemy', perspective: 'side', movement: 'ground', quality: 5, desc_prefix: 'rendered green-headed alien astronaut in silver spacesuit with laser pistol' } },
  { match: /animations\/robo__/, label: { source: 'phaser-cdn animations/robo', species: 'robot', asset_type: 'character', theme: 'sci_fi', playable_role: 'generic', perspective: 'side', movement: 'ground', quality: 4, desc_prefix: 'cute cartoon grey robot with big eyes and antenna' } },
  { match: /animations\/walker__/, label: { source: 'phaser-cdn animations/walker', species: 'robot', asset_type: 'vehicle', theme: 'sci_fi', playable_role: 'enemy', perspective: 'side', movement: 'ground', quality: 5, desc_prefix: 'detailed pixel-art sci-fi mech walker with multiple guns' } },
  { match: /animations\/elves-craft-pixel__/, label: { source: 'phaser-cdn animations/elves-craft-pixel', species: 'human', asset_type: 'character', theme: 'fantasy', playable_role: 'player', perspective: 'side', movement: 'ground', quality: 4, desc_prefix: 'stylized elf wizard/mage character with pointed hat and staff' } },
  { match: /animations\/bird____/, label: { source: 'phaser-cdn animations/bird', species: 'monster', asset_type: 'creature', theme: 'casual', playable_role: 'enemy', perspective: 'side', movement: 'ground', quality: 3, desc_prefix: 'stylized pink ostrich-like bird with orange spots' } },
  { match: /animations\/aseprite\/paladin/, label: { source: 'phaser-cdn animations/aseprite/paladin', species: 'human', asset_type: 'character', theme: 'fantasy', playable_role: 'player', perspective: 'side', movement: 'ground', quality: 5, desc_prefix: 'winged paladin/angel warrior, detailed pixel art (270-frame multi-animation sheet, animation states packed sequentially — needs manual split)' } },
  { match: /animations\/aseprite\/tank/, label: { source: 'phaser-cdn animations/aseprite/tank', species: 'spaceship', asset_type: 'vehicle', theme: 'military', playable_role: 'generic', perspective: 'side', movement: 'ground', quality: 4, desc_prefix: 'pixel-art tank with rotating turret firing animation' } },
  { match: /tweens\/golem/, label: { source: 'phaser-cdn tweens/golem', species: 'monster', asset_type: 'creature', theme: 'fantasy', playable_role: 'enemy', perspective: 'front', movement: 'ground', quality: 4, desc_prefix: 'blue armored demon/golem boss, front-facing idle breathing animation' } },
  { match: /raw-frames\/animations\/horse/, label: { source: 'phaser-cdn animations/horse', species: 'monster', asset_type: 'creature', theme: 'casual', playable_role: 'generic', perspective: 'side', movement: 'ground', quality: 3, desc_prefix: 'pixel-art brown horse gallop cycle (NOTE: grass+clouds background baked in, best used on grass scenes)' } },
  { match: /phaserbyexample_starshake_assets_images__foe/, label: { source: 'phaser-cdn starshake/foe', species: 'ufo', asset_type: 'vehicle', theme: 'sci_fi', playable_role: 'enemy', perspective: 'top_down', movement: 'air', quality: 3, desc_prefix: 'orange diamond-shaped alien shooter enemy, rotation/bobbing animation' } },
];

// --- REJECT RULES ---
const REJECTS = [
  { match: /animations\/sf2|animations\/sf2ryu/, reason: 'Street Fighter II copyright IP (Capcom) — do not redistribute' },
  { match: /animations\/sao/, reason: 'Sword Art Online copyright IP (Aniplex) — do not redistribute' },
  { match: /animations\/california-raisins/, reason: 'California Raisins branded IP — do not redistribute' },
  { match: /raw-frames\/animations\/cat[^\d]/, reason: 'Pusheen the Cat copyright IP (visible Pusheen.com watermark) — do not redistribute' },
  { match: /animations\/cube/, reason: 'rotating cube — not character/vehicle/animal' },
  { match: /animations\/rocket/, reason: 'rocket "trail" is exhaust flame effect only, no vehicle body' },
  { match: /animations\/lazer/, reason: 'laser projectile effect — not character/vehicle' },
  { match: /animations\/cybercity/, reason: 'city environment/tile atlas — not character' },
  { match: /tweens\/ufo/, reason: '3 static UFO color variants — not animation frames (color-variant grid)' },
  { match: /raw-frames\/skies|raw-frames\/textures|raw-frames\/particles|raw-frames\/normal-maps|raw-frames\/tests\/columns|raw-frames\/tests\/piano|raw-frames\/tests\/twist|raw-frames\/tests\/terrain|raw-frames\/tests\/underwater|raw-frames\/tests\/fruit|raw-frames\/sets\/objects|raw-frames\/games\/breakout|raw-frames\/games\/card-memory|raw-frames\/games\/sliding-puzzle|raw-frames\/games\/asteroids|raw-frames\/games\/multi|raw-frames\/games\/tom|raw-frames\/games\/pacman|raw-frames\/pics|raw-frames\/rapier|raw-frames\/rope|raw-frames\/audio|raw-frames\/compressed|raw-frames\/demoscene|raw-frames\/phaserbyexample|raw-frames\/physics|raw-frames\/spine|raw-frames\/tweens|raw-frames\/tests_scenes|raw-frames\/tests\/space\/moon|raw-frames\/tests\/space\/asteroid|raw-frames\/tests\/space\/muzzleflash|raw-frames\/tests\/invaders|raw-frames\/animations\/lazer|raw-frames\/animations\/bubble|raw-frames\/sprites\/planet|raw-frames\/sprites\/atari|raw-frames\/sprites\/1bitblock|raw-frames\/sprites\/brush|raw-frames\/sprites\/bullets|raw-frames\/sprites\/mask|raw-frames\/sprites\/phaser|raw-frames\/sprites\/tetrisblock|raw-frames\/sprites\/strip|raw-frames\/sprites\/spinObj|raw-frames\/sprites\/shmup-baddie|raw-frames\/sprites\/bsquadron|raw-frames\/animations\/aseprite/, reason: 'not character/vehicle/animal — env/tile/UI/particle/tilemap noise, single-vehicle-shot color variants, or effect frames' },
];

const kept = [];
const rejected = [];
const deferred = [];
const packStats = {};

for (const item of manifest) {
  const rej = REJECTS.find(r => r.match.test(item.id));
  if (rej) { rejected.push({ id: item.id, reason: rej.reason }); (packStats[item.source] ||= { keep: 0, reject: 0, defer: 0 }).reject++; continue; }
  const keep = KEEPS.find(k => k.match.test(item.id));
  if (keep) {
    kept.push({ item, label: keep.label });
    (packStats[keep.label.source] ||= { keep: 0, reject: 0, defer: 0 }).keep++;
    continue;
  }
  deferred.push({ id: item.id, reason: 'no rule matched — needs manual review in future session' });
  (packStats[item.source] ||= { keep: 0, reject: 0, defer: 0 }).defer++;
}

fs.writeFileSync(path.join(STAGING, '_review-log.json'), JSON.stringify({
  summary: { input: manifest.length, kept: kept.length, rejected: rejected.length, deferred: deferred.length },
  kept: kept.map(k => ({ id: k.item.id, source: k.label.source })),
  rejected, deferred, packStats,
}, null, 2));

fs.writeFileSync(path.join(STAGING, '_curated-with-labels.json'), JSON.stringify(kept, null, 2));

console.log(`Phaser filter pass:`);
console.log(`  Input:    ${manifest.length}`);
console.log(`  ✅ Kept:   ${kept.length}`);
console.log(`  ❌ Reject: ${rejected.length}`);
console.log(`  ⏸  Defer:  ${deferred.length}`);
console.log(`\nBy source:`);
Object.entries(packStats).sort((a,b)=>b[1].keep - a[1].keep).forEach(([s, c]) => {
  const bits = [];
  if (c.keep) bits.push(`✅${c.keep}`);
  if (c.reject) bits.push(`❌${c.reject}`);
  if (c.defer) bits.push(`⏸${c.defer}`);
  console.log(`  ${s}: ${bits.join(' ')}`);
});
