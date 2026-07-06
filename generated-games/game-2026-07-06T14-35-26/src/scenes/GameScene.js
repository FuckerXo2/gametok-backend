export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.score = 0;
        this.wave = 1;
        this.zombiesKilled = 0;
        this.zombiesPerWave = 5;
        this.gameOver = false;
        this.playerSpeed = 200;
        this.bulletSpeed = 500;
        this.fireRate = 300;
        this.lastFired = 0;
    }

    preload() {
        const baseUrl = (typeof process !== 'undefined' && process.env && process.env.RAILWAY_PUBLIC_DOMAIN)
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/assets/`
            : 'http://localhost:3000/assets/';

        // Load assets with fallback
        this.load.on('loaderror', (file) => {
            console.warn('Failed to load asset:', file.src);
        });

        // Background
        this.load.image('background', baseUrl + 'rope/background-grave.png');
        // Player sprite
        this.load.spritesheet('player', baseUrl + 'sprites/player_handgun.png', { frameWidth: 66, frameHeight: 60 });
        // Zombie sprite
        this.load.spritesheet('zombie', baseUrl + 'animations/zombie.png', { frameWidth: 949, frameHeight: 978 });
        // Bullet
        this.load.image('bullet', baseUrl + 'sprites/bullet.png');
        // Particle
        this.load.image('particle', baseUrl + 'particles/fire1.png');
        // Sound
        this.load.audio('shoot', baseUrl + 'audio/SoundEffects/blaster.mp3');
        this.load.audio('hit', baseUrl + 'audio/SoundEffects/shotgun.wav');
    }

    create() {
        // Background
        this.add.image(195, 422, 'background').setDisplaySize(390, 844);

        // Player
        this.player = this.physics.add.sprite(195, 700, 'player');
        this.player.setCollideWorldBounds(true);
        this.player.setScale(1.5);
        this.player.body.setSize(40, 50);
        this.player.body.setOffset(13, 5);

        // Player animation (idle)
        if (this.anims.exists('player_idle')) {
            this.anims.remove('player_idle');
        }
        this.anims.create({
            key: 'player_idle',
            frames: this.anims.generateFrameNumbers('player', { start: 0, end: 0 }),
            frameRate: 1,
            repeat: -1
        });
        this.player.play('player_idle');

        // Zombie animation
        if (this.anims.exists('zombie_walk')) {
            this.anims.remove('zombie_walk');
        }
        this.anims.create({
            key: 'zombie_walk',
            frames: this.anims.generateFrameNumbers('zombie', { start: 0, end: 3 }),
            frameRate: 4,
            repeat: -1
        });

        // Groups
        this.bullets = this.physics.add.group({
            defaultKey: 'bullet',
            maxSize: 30
        });

        this.zombies = this.physics.add.group();

        // Collisions
        this.physics.add.overlap(this.bullets, this.zombies, this.hitZombie, null, this);
        this.physics.add.overlap(this.player, this.zombies, this.gameOverHandler, null, this);

        // Touch controls - virtual joystick
        this.createJoystick();

        // Keyboard controls
        this.cursors = this.input.keyboard ? this.input.keyboard.createCursorKeys() : null;
        this.spaceKey = this.input.keyboard ? this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE) : null;

        // UI
        this.scoreText = this.add.text(10, 10, 'Score: 0', { fontSize: '20px', fill: '#fff', fontFamily: 'Arial' });
        this.waveText = this.add.text(10, 40, 'Wave: 1', { fontSize: '20px', fill: '#fff', fontFamily: 'Arial' });
        this.healthText = this.add.text(10, 70, 'Health: 3', { fontSize: '20px', fill: '#fff', fontFamily: 'Arial' });

        // Health
        this.health = 3;

        // Spawn first wave
        this.spawnWave();

        // Game over overlay (hidden)
        this.gameOverGroup = this.add.group();
        this.createGameOverUI();
    }

    createJoystick() {
        // Virtual joystick for movement
        this.joystickBase = this.add.circle(0, 0, 60, 0x444444, 0.6).setScrollFactor(0).setDepth(100);
        this.joystickThumb = this.add.circle(0, 0, 30, 0x888888, 0.8).setScrollFactor(0).setDepth(101);
        this.joystickBase.setVisible(false);
        this.joystickThumb.setVisible(false);

        this.joystickActive = false;
        this.joystickDirection = new Phaser.Math.Vector2(0, 0);

        this.input.on('pointerdown', (pointer) => {
            if (this.gameOver) return;
            // Check if pointer is in left half for joystick
            if (pointer.x < 195) {
                this.joystickBase.setPosition(pointer.x, pointer.y);
                this.joystickThumb.setPosition(pointer.x, pointer.y);
                this.joystickBase.setVisible(true);
                this.joystickThumb.setVisible(true);
                this.joystickActive = true;
            } else {
                // Tap to shoot
                this.shootTowards(pointer.x, pointer.y);
            }
        });

        this.input.on('pointermove', (pointer) => {
            if (!this.joystickActive || this.gameOver) return;
            const dx = pointer.x - this.joystickBase.x;
            const dy = pointer.y - this.joystickBase.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 50;
            if (dist > maxDist) {
                const angle = Math.atan2(dy, dx);
                this.joystickThumb.setPosition(
                    this.joystickBase.x + Math.cos(angle) * maxDist,
                    this.joystickBase.y + Math.sin(angle) * maxDist
                );
                this.joystickDirection.set(Math.cos(angle), Math.sin(angle));
            } else {
                this.joystickThumb.setPosition(pointer.x, pointer.y);
                this.joystickDirection.set(dx / maxDist, dy / maxDist);
            }
        });

        this.input.on('pointerup', () => {
            this.joystickActive = false;
            this.joystickBase.setVisible(false);
            this.joystickThumb.setVisible(false);
            this.joystickDirection.set(0, 0);
        });
    }

    shootTowards(x, y) {
        if (this.gameOver) return;
        const time = this.time.now;
        if (time - this.lastFired < this.fireRate) return;
        this.lastFired = time;

        const bullet = this.bullets.get(this.player.x, this.player.y);
        if (!bullet) return;
        bullet.setActive(true).setVisible(true);
        bullet.body.enable = true;
        bullet.setPosition(this.player.x, this.player.y);

        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
        const vx = Math.cos(angle) * this.bulletSpeed;
        const vy = Math.sin(angle) * this.bulletSpeed;
        bullet.body.setVelocity(vx, vy);
        bullet.body.setSize(5, 9);

        // Auto-destroy bullet after 2 seconds
        this.time.delayedCall(2000, () => {
            if (bullet.active) {
                bullet.setActive(false).setVisible(false);
                bullet.body.enable = false;
            }
        });

        // Sound
        if (this.sound.get('shoot')) {
            this.sound.play('shoot', { volume: 0.5 });
        }

        // Muzzle flash
        const flash = this.add.circle(this.player.x, this.player.y, 10, 0xffff00, 1);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2,
            duration: 100,
            onComplete: () => flash.destroy()
        });
    }

    spawnWave() {
        const count = this.zombiesPerWave + (this.wave - 1) * 2;
        for (let i = 0; i < count; i++) {
            this.time.delayedCall(i * 500, () => {
                if (this.gameOver) return;
                this.spawnZombie();
            });
        }
    }

    spawnZombie() {
        const x = Phaser.Math.Between(0, 390);
        const y = Phaser.Math.Between(-50, -20);
        const zombie = this.zombies.create(x, y, 'zombie');
        zombie.setScale(0.15);
        zombie.body.setSize(200, 200);
        zombie.body.setOffset(370, 400);
        zombie.play('zombie_walk');
        zombie.setDepth(1);

        // Move towards player
        const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
        const speed = Phaser.Math.Between(40, 80);
        zombie.body.setVelocity(
            Math.cos(angle) * speed,
            Math.sin(angle) * speed
        );

        // Rotate to face player
        zombie.rotation = angle;
    }

    hitZombie(bullet, zombie) {
        // Deactivate bullet
        bullet.setActive(false).setVisible(false);
        bullet.body.enable = false;

        // Particle effect
        this.createDeathParticles(zombie.x, zombie.y);

        // Score popup
        this.createScorePopup(zombie.x, zombie.y);

        // Sound
        if (this.sound.get('hit')) {
            this.sound.play('hit', { volume: 0.7 });
        }

        // Screen shake
        this.cameras.main.shake(100, 0.005);

        // Remove zombie
        zombie.destroy();

        this.zombiesKilled++;
        this.score += 10;
        this.scoreText.setText('Score: ' + this.score);

        // Check wave completion
        if (this.zombies.countActive() === 0 && this.zombiesKilled >= this.zombiesPerWave + (this.wave - 1) * 2) {
            this.wave++;
            this.waveText.setText('Wave: ' + this.wave);
            this.zombiesKilled = 0;
            this.spawnWave();
        }
    }

    createDeathParticles(x, y) {
        // Create multiple particles
        for (let i = 0; i < 8; i++) {
            const particle = this.add.circle(x, y, Phaser.Math.Between(3, 8), 0xff0000, 1);
            particle.setDepth(5);
            const angle = Math.random() * Math.PI * 2;
            const speed = Phaser.Math.Between(50, 150);
            this.tweens.add({
                targets: particle,
                x: x + Math.cos(angle) * speed,
                y: y + Math.sin(angle) * speed,
                alpha: 0,
                scale: 0.2,
                duration: 500,
                onComplete: () => particle.destroy()
            });
        }

        // Blood splat
        const splat = this.add.circle(x, y, 20, 0x8b0000, 0.7);
        splat.setDepth(4);
        this.tweens.add({
            targets: splat,
            alpha: 0,
            scale: 2,
            duration: 800,
            onComplete: () => splat.destroy()
        });
    }

    createScorePopup(x, y) {
        const text = this.add.text(x, y - 20, '+10', {
            fontSize: '16px',
            fill: '#ff0',
            fontFamily: 'Arial',
            stroke: '#000',
            strokeThickness: 2
        }).setOrigin(0.5).setDepth(10);

        this.tweens.add({
            targets: text,
            y: y - 60,
            alpha: 0,
            duration: 800,
            onComplete: () => text.destroy()
        });
    }

    gameOverHandler(player, zombie) {
        if (this.gameOver) return;
        this.health--;
        this.healthText.setText('Health: ' + this.health);

        // Flash player red
        player.setTint(0xff0000);
        this.time.delayedCall(200, () => {
            if (player.active) player.clearTint();
        });

        // Knockback zombie
        const angle = Phaser.Math.Angle.Between(zombie.x, zombie.y, player.x, player.y);
        zombie.body.setVelocity(
            Math.cos(angle) * 200,
            Math.sin(angle) * 200
        );

        if (this.health <= 0) {
            this.endGame();
        }
    }

    endGame() {
        this.gameOver = true;
        this.physics.pause();

        // Game over screen
        this.gameOverGroup.setVisible(true);
        this.gameOverGroup.setActive(true);

        // Stop all zombies
        this.zombies.getChildren().forEach(z => {
            z.body.setVelocity(0, 0);
        });
    }

    createGameOverUI() {
        // Overlay
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.7);
        overlay.setDepth(50);
        this.gameOverGroup.add(overlay);

        // Game Over text
        const gameOverText = this.add.text(195, 300, 'GAME OVER', {
            fontSize: '48px',
            fill: '#ff0000',
            fontFamily: 'Arial',
            stroke: '#000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(51);
        this.gameOverGroup.add(gameOverText);

        // Final score
        const finalScoreText = this.add.text(195, 370, 'Score: ' + this.score, {
            fontSize: '32px',
            fill: '#fff',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setDepth(51);
        this.gameOverGroup.add(finalScoreText);

        // Restart button
        const restartBtn = this.add.rectangle(195, 450, 200, 60, 0x00aa00, 1)
            .setInteractive()
            .setDepth(51);
        const restartText = this.add.text(195, 450, 'RESTART', {
            fontSize: '28px',
            fill: '#fff',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setDepth(52);
        this.gameOverGroup.add(restartBtn);
        this.gameOverGroup.add(restartText);

        restartBtn.on('pointerdown', () => {
            this.scene.restart();
        });

        // Hide initially
        this.gameOverGroup.setVisible(false);
        this.gameOverGroup.setActive(false);
    }

    update(time, delta) {
        if (this.gameOver) return;

        // Keyboard movement (secondary)
        if (this.cursors) {
            let vx = 0;
            let vy = 0;
            if (this.cursors.left.isDown) vx = -1;
            else if (this.cursors.right.isDown) vx = 1;
            if (this.cursors.up.isDown) vy = -1;
            else if (this.cursors.down.isDown) vy = 1;

            if (vx !== 0 || vy !== 0) {
                const len = Math.sqrt(vx * vx + vy * vy);
                vx /= len;
                vy /= len;
                this.player.body.setVelocity(vx * this.playerSpeed, vy * this.playerSpeed);
            } else if (!this.joystickActive) {
                this.player.body.setVelocity(0, 0);
            }

            // Keyboard shoot
            if (this.spaceKey && this.spaceKey.isDown) {
                // Shoot towards nearest zombie or straight up
                const nearest = this.findNearestZombie();
                if (nearest) {
                    this.shootTowards(nearest.x, nearest.y);
                } else {
                    this.shootTowards(this.player.x, this.player.y - 100);
                }
            }
        }

        // Joystick movement
        if (this.joystickActive) {
            const dir = this.joystickDirection;
            const len = dir.length();
            if (len > 0.1) {
                this.player.body.setVelocity(
                    dir.x * this.playerSpeed,
                    dir.y * this.playerSpeed
                );
            } else {
                this.player.body.setVelocity(0, 0);
            }
        }

        // Auto-aim and shoot at nearest zombie (optional)
        // For mobile, we rely on tap to shoot

        // Update zombie animations to face player
        this.zombies.getChildren().forEach(z => {
            if (z.active) {
                const angle = Phaser.Math.Angle.Between(z.x, z.y, this.player.x, this.player.y);
                z.rotation = angle;
            }
        });

        // Clean up off-screen bullets
        this.bullets.getChildren().forEach(b => {
            if (b.active && (b.y < -50 || b.y > 900 || b.x < -50 || b.x > 450)) {
                b.setActive(false).setVisible(false);
                b.body.enable = false;
            }
        });
    }

    findNearestZombie() {
        let nearest = null;
        let minDist = Infinity;
        this.zombies.getChildren().forEach(z => {
            if (z.active) {
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, z.x, z.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = z;
                }
            }
        });
        return nearest;
    }
}