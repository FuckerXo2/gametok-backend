import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  preload() {
    // Load assets from CDN here
    // Example: this.load.image('player', 'https://labs.phaser.io/assets/sprites/phaser-dude.png');
  }

  create() {
    // Initialize game objects
    const { width, height } = this.scale;
    
    // Example: Add centered text
    this.add.text(width / 2, height / 2, 'Phaser 3 Game', {
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5);
  }

  update() {
    // Game loop logic
  }
}
