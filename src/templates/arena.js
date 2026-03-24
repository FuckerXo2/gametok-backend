// ==========================================
// FATAL ERROR PREVENTION: NEVER DELETE THE PHYSICS OVERLAPS OR GROUPS. 
// ONLY CHANGE THE VISUALS, ASSETS, SPEEDS, AND JUICE (PARTICLES/CAMERA SHAKE/COLORS)
// TO MATCH THE USER'S PROMPT.
// ==========================================
class MainScene extends Phaser.Scene {
    preload() {
        this.load.crossOrigin = 'anonymous';
        // AI: You may load official Phaser assets here (e.g. this.load.image('ship', 'https://labs.phaser.io/assets/sprites/ship.png');)
        // Or leave empty if using Math/Geometry/SVGs
    }

    create() {
        // 1. SETUP CORE
        this.score = 0;
        this.gameOver = false;
        
        // AI: Change background color dynamically to match the user's prompt (Dark, Bright, Pastel, etc.)
        this.cameras.main.setBackgroundColor('#0A0A0C');

        // 2. GROUPS (CORE PHYSICS)
        this.enemies = this.physics.add.group();
        this.projectiles = this.physics.add.group();

        // 3. PLAYER
        // AI: Replace this rectangle with a loaded sprite, SVG, Vector Art, or text Emoji
        this.player = this.add.rectangle(window.innerWidth/2, window.innerHeight/2, 32, 32, 0x00E5FF);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);
        this.player.body.setBounce(0.2);

        // 4. INPUTS
        this.pointer = this.input.activePointer;

        // 5. COLLISIONS (DO NOT TOUCH THIS MATH, JUST ADD JUICE)
        this.physics.add.overlap(this.projectiles, this.enemies, (proj, enemy) => {
            proj.destroy();
            enemy.destroy();
            this.score += 10;
            this.scoreText.setText('Score: ' + this.score);
            
            // AI: ADD JUICE HERE (Particle explosions matching the theme, Camera shake, Scale tweens!)
            window.playSound('explosion');
            this.cameras.main.shake(100, 0.01);
        });

        this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
            this.gameOver = true;
            this.physics.pause();
            
            // AI: Add dramatic death effects here (massive particles, flashes, player spinning out)
            this.player.setTint(0xff0000);
            window.playSound('explosion');
            
            // Restart UI
            this.add.text(window.innerWidth/2, window.innerHeight/2, 'GAME OVER\nTap to Restart', { 
                fontSize: '48px', fill: '#ffffff', align: 'center', fontFamily: 'sans-serif', fontStyle: 'bold' 
            }).setOrigin(0.5).setStroke('#000000', 8);
            
            // Allow restarting after 1 second
            this.time.delayedCall(1000, () => {
                this.input.on('pointerdown', () => this.scene.restart());
            });
        });

        // 6. SPAWNERS
        this.time.addEvent({
            delay: 1000, // AI: Adjust spawn rate based on difficulty prompted
            loop: true,
            callback: () => {
                if (this.gameOver) return;
                
                // Spawn enemies strictly outside screen edges, chasing inwards
                let spawnX = Math.random() < 0.5 ? -50 : window.innerWidth + 50;
                let spawnY = Math.random() * window.innerHeight;
                if(Math.random() < 0.5) {
                    spawnX = Math.random() * window.innerWidth;
                    spawnY = Math.random() < 0.5 ? -50 : window.innerHeight + 50;
                }

                // AI: Change enemy visuals here (Add loaded sprites, pulsing tweens, SVGs)
                let enemy = this.add.rectangle(spawnX, spawnY, 24, 24, 0xFF0055);
                this.physics.add.existing(enemy);
                this.enemies.add(enemy);
            }
        });

        // 7. SHOOTING
        this.lastFired = 0;
        
        // 8. SCORE UI
        this.scoreText = this.add.text(20, 20, 'Score: 0', { 
            fontSize: '32px', fill: '#FFF', fontFamily: 'sans-serif', fontStyle: 'bold' 
        }).setScrollFactor(0).setDepth(100);
    }

    update(time) {
        if (this.gameOver) return;

        // PLAYER MOVEMENT: Smoothly look/move towards the pointer
        // AI: Adjust player speed based on the prompt vibe (Fast, Sluggish)
        const speed = 300;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pointer.x, this.pointer.y) > 20) {
            this.physics.moveToObject(this.player, this.pointer, speed);
        } else {
            this.player.body.setVelocity(0);
        }
        
        // Optional AI: Add rotation logic to make player face the pointer: 
        // this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.pointer.x, this.pointer.y);

        // ENEMY CHASING: All enemies relentlessly drift towards player
        // AI: Adjust enemy speed here
        const enemySpeed = 150;
        this.enemies.getChildren().forEach(enemy => {
            if(enemy.active) {
                this.physics.moveToObject(enemy, this.player, enemySpeed);
            }
        });

        // SHOOTING LOGIC: Auto-fire while holding down pointer
        if (this.pointer.isDown && time > this.lastFired) {
            // AI: Change Projectile visuals, firing rate, and speeds here
            let proj = this.add.rectangle(this.player.x, this.player.y, 8, 8, 0xFFD700);
            this.physics.add.existing(proj);
            this.projectiles.add(proj);
            
            // Aim exactly at pointer
            this.physics.moveTo(proj, this.pointer.worldX, this.pointer.worldY, 600);
            this.lastFired = time + 200; 
            window.playSound('shoot');
        }
    }
}

// AI: ONLY modify this config if the prompt implies a specific gravity (e.g. y: 800) instead of 0
const config = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    parent: 'phaser-game',
    backgroundColor: '#0A0A0C', // AI: Matches dynamically
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 }, // Arena games have 0 gravity!
            debug: false
        }
    },
    scene: MainScene
};

window.game = new Phaser.Game(config);
