// ==========================================
// FATAL ERROR PREVENTION: RUNNER TEMPLATE
// NEVER DELETE THE PHYSICS OVERLAPS OR JUMP LOGIC. 
// ONLY CHANGE THE VISUALS, ASSETS, SPEEDS, AND JUICE TO MATCH THE PROMPT.
// ==========================================
class MainScene extends Phaser.Scene {
    preload() {
        this.load.crossOrigin = 'anonymous';
        // AI: Load specific sprites/backgrounds here
    }

    create() {
        this.score = 0;
        this.gameOver = false;
        
        // AI: Adapt background color strictly to prompt
        this.cameras.main.setBackgroundColor('#87CEEB'); 

        // 1. WORLD SETUP (Floor & Scroller)
        this.floor = this.add.rectangle(window.innerWidth/2, window.innerHeight - 50, window.innerWidth, 100, 0x228B22);
        this.physics.add.existing(this.floor, true); // Static body (true)
        this.floor.body.immovable = true;

        // 2. PLAYER
        // AI: Replace rectangle with an awesome sprite or emoji
        this.player = this.add.rectangle(100, window.innerHeight - 200, 40, 40, 0xFFD700);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);
        this.player.body.setGravityY(1200); // AI: Heavy gravity for snappy jumping

        // 3. OBSTACLES (The enemies or spikes)
        this.obstacles = this.physics.add.group();

        // 4. COLLISIONS
        this.physics.add.collider(this.player, this.floor);
        this.physics.add.collider(this.obstacles, this.floor);

        this.physics.add.overlap(this.player, this.obstacles, () => {
            this.gameOver = true;
            this.physics.pause();
            
            // AI: Add death effects, sounds, tints!
            this.player.setTint(0xff0000);
            window.playSound('explosion');
            this.cameras.main.shake(150, 0.02);

            this.add.text(window.innerWidth/2, window.innerHeight/2, 'GAME OVER\nTap to Restart', { 
                fontSize: '48px', fill: '#FFF', align: 'center', fontFamily: 'sans-serif', fontStyle: 'bold' 
            }).setOrigin(0.5).setStroke('#000', 6);
            
            this.time.delayedCall(1000, () => {
                this.input.on('pointerdown', () => this.scene.restart());
            });
        });

        // 5. OBSTACLE SPAWNER
        this.time.addEvent({
            delay: 1500, // AI: Modulate based on difficulty
            loop: true,
            callback: () => {
                if (this.gameOver) return;

                // Spawn off-screen to the right
                // AI: Tweak height and width to make fun shapes (tall pipes, flying birds, spikes)
                let isFlying = Math.random() > 0.7;
                let obsY = isFlying ? window.innerHeight - 250 : window.innerHeight - 120;
                let obs = this.add.rectangle(window.innerWidth + 50, obsY, 40, Math.random() * 60 + 40, 0xFF0055);
                
                this.physics.add.existing(obs);
                if (isFlying) {
                    obs.body.setAllowGravity(false);
                }
                
                // Move obstacle leftwards
                // AI: Speed defines difficulty
                obs.body.setVelocityX(-400); 
                this.obstacles.add(obs);
            }
        });

        // 6. SCORE TICKER
        this.scoreText = this.add.text(20, 20, 'Score: 0', { 
            fontSize: '32px', fill: '#FFF', fontFamily: 'sans-serif', fontStyle: 'bold' 
        }).setScrollFactor(0).setStroke('#000', 4);

        this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                if(!this.gameOver) {
                    this.score += 10;
                    this.scoreText.setText('Score: ' + this.score);
                }
            }
        });

        // 7. CONTROLS (Jumping)
        this.input.on('pointerdown', () => {
            if (!this.gameOver && this.player.body.touching.down) {
                // AI: Adjust jump velocity
                this.player.body.setVelocityY(-800);
                window.playSound('jump');
                // AI: Add squash and stretch tweens here!
            }
        });
    }

    update(time) {
        if (this.gameOver) return;
        
        // Clean up memory
        this.obstacles.getChildren().forEach(obs => {
            if (obs.x < -100) {
                obs.destroy();
            }
        });
    }
}

const config = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    parent: 'phaser-game',
    backgroundColor: '#87CEEB', // AI: Matches dynamically
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 }, // Handled individually by bodies
            debug: false
        }
    },
    scene: MainScene
};

window.game = new Phaser.Game(config);
