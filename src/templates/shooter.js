// GOLD STANDARD: TOP DOWN SHOOTER
// Fast paced physics, Object Pooling for bullets, Virtual Joystick Movement.
const config = {
    type: Phaser.AUTO, width: window.innerWidth, height: window.innerHeight, parent: 'game-container',
    backgroundColor: '#0a0a0f', physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } }, scene: { preload, create, update }
};
window.game = new Phaser.Game(config);

let player, joystick, enemies, bullets, lastFired=0, score=0, isGameOver=false;

function preload() {
    this.load.plugin('rexvirtualjoystickplugin', 'https://cdn.jsdelivr.net/npm/phaser3-rex-plugins@1.1.84/dist/rexvirtualjoystickplugin.min.js', true);
}

function create() {
    window.showUI(); window.updateScore(0); window.initLives(3);
    
    // Draw Space Grid Bg
    const bgGfx = this.make.graphics(); bgGfx.lineStyle(1, 0xFF00FF, 0.2);
    for(let i=0; i<window.innerWidth; i+=40) { bgGfx.moveTo(i, 0); bgGfx.lineTo(i, window.innerHeight); }
    for(let j=0; j<window.innerHeight; j+=40) { bgGfx.moveTo(0, j); bgGfx.lineTo(window.innerWidth, j); }
    bgGfx.strokePath(); bgGfx.generateTexture('grid', window.innerWidth, window.innerHeight); bgGfx.destroy();
    this.add.image(window.innerWidth/2, window.innerHeight/2, 'grid');

    // Draw Ship
    const sGfx = this.make.graphics(); sGfx.fillStyle(0x00FFFF); sGfx.fillTriangle(20,0, 40,40, 0,40);
    sGfx.generateTexture('ship', 40,40); sGfx.destroy();
    
    // Draw Enemy
    const eGfx = this.make.graphics(); eGfx.fillStyle(0xFF0055); eGfx.fillCircle(15,15,15); eGfx.generateTexture('enemy', 30,30); eGfx.destroy();

    // Draw Bullet
    const bGfx = this.make.graphics(); bGfx.fillStyle(0xFFFF00); bGfx.fillRect(0,0,4,16); bGfx.generateTexture('bullet', 4,16); bGfx.destroy();

    player = this.physics.add.sprite(window.innerWidth/2, window.innerHeight - 150, 'ship');
    player.setCollideWorldBounds(true);
    
    // Initialize Joystick
    joystick = this.plugins.get('rexvirtualjoystickplugin').add(this, {
        x: window.innerWidth / 2, y: window.innerHeight - 100, radius: 60,
        base: this.add.circle(0,0,60,0x888888,0.2).setDepth(100), thumb: this.add.circle(0,0,30,0xcccccc,0.5).setDepth(100)
    });

    bullets = this.physics.add.group({defaultKey:'bullet', maxSize:30});
    enemies = this.physics.add.group({defaultKey:'enemy', maxSize:20});

    this.time.addEvent({ delay: window.gameConfig.spawnRate || 1000, callback: spawnEnemy, callbackScope: this, loop: true });

    this.physics.add.collider(bullets, enemies, hitEnemy, null, this);
    this.physics.add.overlap(player, enemies, hitPlayer, null, this);
}

function update(time) {
    if (isGameOver) return;
    
    // Joystick Move
    if (joystick.force > 0) {
        player.setVelocityX(Math.cos(joystick.angle * Math.PI/180) * (window.gameConfig.speed || 300));
        player.setVelocityY(Math.sin(joystick.angle * Math.PI/180) * (window.gameConfig.speed || 300));
        player.rotation = joystick.angle * Math.PI/180 + Math.PI/2;
    } else { player.setVelocity(0,0); }

    // Auto Shoot
    if (time > lastFired) {
        let b = bullets.get(player.x, player.y - 20);
        if (b) {
            b.setActive(true).setVisible(true);
            b.setVelocityY(-600);
            b.setVelocityX(player.body.velocity.x * 0.5); // Add momentum
            window.playSound('shoot'); lastFired = time + (window.gameConfig.fireRate || 200);
        }
    }

    // Cleanup offscreen objects
    bullets.children.each(b => { if (b.active && b.y < 0) { b.setActive(false).setVisible(false); }});
    enemies.children.each(e => { if (e.active && e.y > window.innerHeight) { e.setActive(false).setVisible(false); }});
}

function spawnEnemy() {
    if(isGameOver) return;
    let e = enemies.get(Phaser.Math.Between(40, window.innerWidth-40), -40);
    if(e) {
        e.setActive(true).setVisible(true).setVelocityY(window.gameConfig.enemySpeed || 150);
        e.body.enable = true;
    }
}

function hitEnemy(bullet, enemy) {
    bullet.setActive(false).setVisible(false); bullet.body.enable=false;
    enemy.setActive(false).setVisible(false); enemy.body.enable=false;
    score+=10; window.updateScore(score); window.playSound('explosion');
}

let lives = 3;
function hitPlayer(p, enemy) {
    enemy.setActive(false).setVisible(false); enemy.body.enable=false;
    lives--; window.updateLives(lives, 3); window.playSound('hit');
    if(lives <= 0) {
        isGameOver = true; player.destroy(); window.playSound('gameover');
        window.showGameOver(score, () => { lives=3; isGameOver=false; window.game.scene.scenes[0].scene.restart(); });
    } else {
        p.setAlpha(0.2); setTimeout(()=> p.setAlpha(1), 1000);
    }
}
