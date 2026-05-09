const PHASER_ASSET_BASE = process.env.PHASER_ASSET_BASE || '/assets';

function phaserAsset(assetPath) {
    return `${PHASER_ASSET_BASE}/${assetPath.replace(/^\/+/, '')}`;
}

export const ASSET_CATALOG = {
    characters: [
        { name: 'Classic Hero', url: phaserAsset('sprites/dude.png'), type: 'sprite' },
        { name: 'Alien Monster', url: phaserAsset('sprites/space-baddie.png'), type: 'sprite' },
        { name: 'Slime Blob', url: phaserAsset('sprites/slime.png'), type: 'sprite' },
        { name: 'Mushroom', url: phaserAsset('sprites/mushroom2.png'), type: 'sprite' },
        { name: 'Fighter Jet', url: phaserAsset('sprites/asteroids_ship.png'), type: 'sprite' },
        { name: 'UFO', url: phaserAsset('sprites/ufo.png'), type: 'sprite' },
        { name: 'Racecar', url: phaserAsset('sprites/car90.png'), type: 'sprite' },
        { name: 'Ghost', url: phaserAsset('sprites/ghost.png'), type: 'sprite' },
        { name: 'Robot', url: phaserAsset('sprites/x2kship.png'), type: 'sprite' },
        { name: 'Mine/Spike', url: phaserAsset('sprites/mine.png'), type: 'sprite' },
        { name: 'Asteroid', url: phaserAsset('sprites/asteroids_meteor.png'), type: 'sprite' },
        { name: 'Penguin', url: phaserAsset('sprites/penguin.png'), type: 'sprite' },
    ],
    items: [
        { name: 'Gold Coin', url: phaserAsset('sprites/coin.png'), type: 'image' },
        { name: 'Bomb', url: phaserAsset('sprites/bomb.png'), type: 'image' },
        { name: 'Star', url: phaserAsset('sprites/star.png'), type: 'image' },
        { name: 'Diamond', url: phaserAsset('sprites/diamond.png'), type: 'image' },
        { name: 'Health Kit', url: phaserAsset('sprites/firstaid.png'), type: 'image' },
        { name: 'Watermelon', url: phaserAsset('sprites/melon.png'), type: 'image' },
        { name: 'Pineapple', url: phaserAsset('sprites/pineapple.png'), type: 'image' },
        { name: 'Laser Beam', url: phaserAsset('sprites/laser.png'), type: 'image' },
    ],
    backgrounds: [
        { name: 'Deep Space', url: phaserAsset('skies/space3.png'), type: 'image' },
        { name: 'Nebula', url: phaserAsset('skies/nebula.jpg'), type: 'image' },
        { name: 'Sunny Sky', url: phaserAsset('skies/sky4.png'), type: 'image' },
        { name: 'Sunset', url: phaserAsset('skies/sunset.png'), type: 'image' },
        { name: 'Underwater', url: phaserAsset('skies/underwater1.png'), type: 'image' },
        { name: 'Dark City', url: phaserAsset('skies/darkstone.png'), type: 'image' },
    ],
    platforms: [
        { name: 'Grass Platform', url: phaserAsset('sprites/platform.png'), type: 'image' },
        { name: 'Stone Block', url: phaserAsset('sprites/block.png'), type: 'image' },
        { name: 'Metal Crate', url: phaserAsset('sprites/crate.png'), type: 'image' },
    ],
    particles: [
        { name: 'Blue Glow', url: phaserAsset('particles/blue.png'), type: 'image' },
        { name: 'Red Spark', url: phaserAsset('particles/red.png'), type: 'image' },
        { name: 'Green Slime', url: phaserAsset('particles/green.png'), type: 'image' },
        { name: 'Yellow Star', url: phaserAsset('particles/yellow.png'), type: 'image' },
        { name: 'White Smoke', url: phaserAsset('particles/smoke-puff.png'), type: 'image' },
    ],
};
