// GOLD STANDARD: ENDLESS RUNNER (Flappy Bird / Ascent style)
// Strict opinionated logic. Uses window.gameConfig dynamically.
const config = {
    type: Phaser.AUTO, width: window.innerWidth, height: window.innerHeight, parent: 'game-container',
    backgroundColor: '#E6EAE8', // Pastel/Retro background
    physics: { default: 'arcade', arcade: { gravity: { y: window.gameConfig.gravity || 1500 }, debug: false } },
    scene: { create, update }
};
window.game = new Phaser.Game(config);

let player, obstacles, score = 0, isGameOver = false;

function create() {
    window.showUI(); window.updateScore(0); window.initLives(0);
    
    // Draw Background Pattern
    const bgGfx = this.make.graphics();
    bgGfx.lineStyle(2, 0x000000, 0.05);
    for(let i=0; i<window.innerWidth + 200; i+=80) { bgGfx.moveTo(i, 0); bgGfx.lineTo(i, window.innerHeight); }
    bgGfx.strokePath(); bgGfx.generateTexture('bgLines', window.innerWidth + 200, window.innerHeight); bgGfx.destroy();
    this.bg = this.add.tileSprite(window.innerWidth/2, window.innerHeight/2, window.innerWidth+200, window.innerHeight, 'bgLines');

    // Draw Player
    const playerGfx = this.make.graphics();
    // THEME THIS: AI SHOULD OVERRIDE THIS GRAPHIC
    playerGfx.fillStyle(0x000000); playerGfx.fillCircle(40,40,30); playerGfx.generateTexture('player', 80, 80); playerGfx.destroy();
    
    // Draw Obstacle
    const obsGfx = this.make.graphics();
    // THEME THIS: AI SHOULD OVERRIDE THIS GRAPHIC
    obsGfx.fillStyle(0xED254E); obsGfx.fillRect(0,0,100,600); obsGfx.generateTexture('obstacle', 100, 600); obsGfx.destroy();
    
    // Logic setup
    obstacles = this.physics.add.group({ allowGravity: false });
    player = this.physics.add.sprite(window.innerWidth * 0.3, window.innerHeight / 2, 'player');
    player.setCollideWorldBounds(true);
    
    // Initial spawn
    spawnObstacle(this, window.innerWidth + 200);

    this.input.on('pointerdown', () => {
        if (isGameOver) return;
        player.setVelocityY(window.gameConfig.jumpForce || -600);
        this.tweens.add({ targets: player, angle: -30, duration: 150, ease: 'Power2' });
        window.playSound('jump');
    });
}

function update() {
    if (isGameOver) return;
    this.bg.tilePositionX += 1;
    if (player.angle < 60) player.angle += 2; // Auto rotate down

    obstacles.getChildren().forEach(obs => {
        if (obs.x < player.x && !obs.passed && obs.isScoreTrigger) {
            obs.passed = true; score++; window.updateScore(score); window.playSound('coin');
        }
        if (obs.x < -100) {
            if(obs.isScoreTrigger) spawnObstacle(this, window.innerWidth + 300);
            obs.destroy();
        }
    });

    if (player.y >= window.innerHeight - 40 || player.y <= 40) die();
    this.physics.add.overlap(player, obstacles, die, null, this);
}

function spawnObstacle(scene, xPos) {
    let gap = window.gameConfig.gapSize || 250;
    let yCenter = Phaser.Math.Between(window.innerHeight * 0.3, window.innerHeight * 0.7);
    let top = obstacles.create(xPos, yCenter - gap/2 - 300, 'obstacle');
    top.setVelocityX(window.gameConfig.speed || -250); top.isScoreTrigger = true; top.passed = false;
    let bot = obstacles.create(xPos, yCenter + gap/2 + 300, 'obstacle');
    bot.setVelocityX(window.gameConfig.speed || -250); bot.isScoreTrigger = false;
}

function die() {
    isGameOver = true; player.setVelocityY(0); player.body.gravity.y = 0;
    obstacles.getChildren().forEach(p => p.setVelocityX(0));
    window.playSound('gameover');
    window.showGameOver(score, () => { isGameOver = false; window.game.scene.scenes[0].scene.restart(); });
}
