// ==========================================
// FATAL ERROR PREVENTION: FLAPPY TEMPLATE
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
        this.cameras.main.setBackgroundColor('#4ec0ca'); 

        // 1. PLAYER
        // AI: Replace rectangle with an awesome sprite or emoji (Bird, Helicopter, UFO)
        this.player = this.add.rectangle(100, window.innerHeight/2, 36, 36, 0xFFE066);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);
        this.player.body.setGravityY(1600); // Heavy downward pull
        this.player.body.setBounce(0.4);

        // 2. OBSTACLES (Pipes, Walls, Lasers)
        this.obstacles = this.physics.add.group();

        // 3. SCORE TRIGGERS (Invisible sensors between pipes)
        this.sensors = this.physics.add.group();

        // 4. COLLISIONS
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

        // 5. SCORE INCREMENT (When passing through sensor)
        this.physics.add.overlap(this.player, this.sensors, (player, sensor) => {
            if(!sensor.triggered) {
                sensor.triggered = true;
                this.score += 1;
                this.scoreText.setText('Score: ' + this.score);
                window.playSound('coin');
            }
        });

        // 6. PIPES SPAWNER
        this.time.addEvent({
            delay: 1500, // AI: Modulate based on difficulty speed
            loop: true,
            callback: () => {
                if (this.gameOver) return;

                // Gap math
                const gapSize = 250; 
                const minH = 50; 
                const maxH = window.innerHeight - minH - gapSize;
                const topH = Phaser.Math.Between(minH, maxH);
                
                // Top Pipe (AI: Custom visuals inside here)
                let topObs = this.add.rectangle(window.innerWidth + 50, topH / 2, 60, topH, 0x55FF55);
                this.physics.add.existing(topObs);
                topObs.body.setAllowGravity(false);
                topObs.body.setVelocityX(-250); 
                this.obstacles.add(topObs);

                // Bottom Pipe
                const botY = topH + gapSize;
                const botH = window.innerHeight - botY;
                let botObs = this.add.rectangle(window.innerWidth + 50, botY + (botH/2), 60, botH, 0x55FF55);
                this.physics.add.existing(botObs);
                botObs.body.setAllowGravity(false);
                botObs.body.setVelocityX(-250); 
                this.obstacles.add(botObs);

                // Invisible Sensor for scoring!
                let sensor = this.add.rectangle(window.innerWidth + 50, topH + (gapSize/2), 20, gapSize, 0x000000);
                sensor.visible = false;
                sensor.triggered = false;
                this.physics.add.existing(sensor);
                sensor.body.setAllowGravity(false);
                sensor.body.setVelocityX(-250);
                this.sensors.add(sensor);
            }
        });

        // 7. SCORE UI
        this.scoreText = this.add.text(20, 20, 'Score: 0', { 
            fontSize: '36px', fill: '#FFF', fontFamily: 'sans-serif', fontStyle: 'bold' 
        }).setScrollFactor(0).setStroke('#000', 4).setDepth(100);

        // 8. CONTROLS (Flapping)
        this.input.on('pointerdown', () => {
            if (!this.gameOver) {
                // AI: Adjust flap velocity
                this.player.body.setVelocityY(-550);
                window.playSound('jump');
                // AI: Rotate player upwards 
            }
        });
    }

    update(time) {
        if (this.gameOver) return;
        
        // Tilt animation
        if (this.player.body.velocity.y < 0) {
            this.player.angle -= 2;
        } else {
            this.player.angle += 1.5;
        }
        this.player.angle = Phaser.Math.Clamp(this.player.angle, -20, 90);

        // Clean up memory
        this.obstacles.getChildren().forEach(obs => {
            if (obs.x < -100) obs.destroy();
        });
        this.sensors.getChildren().forEach(sen => {
            if (sen.x < -100) sen.destroy();
        });
    }
}

const config = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    parent: 'phaser-game',
    backgroundColor: '#4ec0ca', // AI: Matches dynamically
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
