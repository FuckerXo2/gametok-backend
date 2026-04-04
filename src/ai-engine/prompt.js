export function buildOmniEnginePrompt(assetMap, manifest) {
    const assetEntries = Object.entries(assetMap);
    const assetLoadCode = assetEntries.map(([key, url]) => 
        `var ${key} = new Image(); ${key}.crossOrigin = "anonymous"; ${key}.src = "${url}";`
    ).join("\n");
    const assetImgTags = assetEntries.map(([key, url]) =>
        `<img id="img_${key}" data-editable="image" data-label="${key}" src="${url}" hidden>`
    ).join("\n");

    return `You are an expert HTML5 Canvas game developer. You produce a COMPLETE, working HTML file.

=== GAME BRIEF ===
${manifest ? manifest.mechanics : "Build a highly engaging interactive mobile game."}

=== REFERENCE TEMPLATE ===
Below is a working reference game. You MUST follow this EXACT structure but REPLACE the game logic, entities, and theme to match the GAME BRIEF above. Keep the same architectural patterns.

\`\`\`html
<!DOCTYPE html>
<html lang="en"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Game</title>
    <style>
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #0f0f1a; }
        #gameCanvas { display: block; touch-action: none; width: 100%; height: 100%; }
        #hud { position: absolute; top: 80px; left: 20px; right: 20px; display: flex; justify-content: space-between; font-family: sans-serif; font-size: 22px; font-weight: bold; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.7); z-index: 10; pointer-events: none; }
        #game-over { position: absolute; inset: 0; background: rgba(0,0,0,0.85); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 50; }
        #game-over h1 { font-family: sans-serif; font-size: 42px; color: #ff4466; margin-bottom: 10px; }
        #game-over p { font-family: sans-serif; font-size: 20px; color: #ccc; margin-bottom: 30px; }
        #game-over button { background: #ff4466; color: #fff; border: none; padding: 16px 48px; border-radius: 30px; font-size: 20px; font-weight: bold; cursor: pointer; }
    </style>
    <script id="game-config" type="application/x-game-config">
    {
        "heroSpeed": { "type": "number", "label": "Hero Speed", "value": 5, "min": 2, "max": 12 },
        "enemySpeed": { "type": "number", "label": "Enemy Speed", "value": 3, "min": 1, "max": 8 },
        "spawnRate": { "type": "number", "label": "Spawn Rate", "value": 2, "min": 0.5, "max": 5 }
    }
    </script>
</head>
<body>
    ${assetImgTags || ''}
    <canvas id="gameCanvas"></canvas>
    <div id="hud">
        <span id="hud-score">Score: 0</span>
        <span id="hud-lives">❤️ 3</span>
    </div>
    <div id="game-over">
        <h1>GAME OVER</h1>
        <p>Score: <span id="final-score">0</span></p>
        <button id="restart-btn">PLAY AGAIN</button>
    </div>
    <script>
    var canvas = document.getElementById('gameCanvas');
    var ctx = canvas.getContext('2d');
    var cw, ch;

    // Parse game config
    var gameConfig = {};
    try {
        var confEl = document.getElementById('game-config');
        if (confEl) {
            var defs = JSON.parse(confEl.textContent);
            for (var k in defs) gameConfig[k] = defs[k].value;
        }
    } catch(e) {}

    // State
    var state = 'PLAYING'; // PLAYING or GAMEOVER
    var score = 0;
    var lives = 3;
    var lastTime = 0;

    // Player entity
    var player = { x: 0, y: 0, r: 25, targetX: 0, targetY: 0 };
    // Enemies array
    var enemies = [];
    // Collectibles array
    var coins = [];

    function resize() {
        cw = window.innerWidth;
        ch = window.innerHeight;
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
    }
    window.addEventListener('resize', resize);
    resize();

    function init() {
        score = 0; lives = 3; state = 'PLAYING';
        player.x = cw / 2; player.y = ch / 2;
        player.targetX = player.x; player.targetY = player.y;
        enemies = []; coins = [];
        // Spawn initial enemies
        for (var i = 0; i < 3; i++) spawnEnemy();
        spawnCoin();
        document.getElementById('game-over').style.display = 'none';
        updateHUD();
    }

    function spawnEnemy() {
        enemies.push({
            x: Math.random() * cw,
            y: Math.random() < 0.5 ? 80 : ch - 180,
            r: 20, speed: gameConfig.enemySpeed || 3
        });
    }
    function spawnCoin() {
        coins.push({
            x: 60 + Math.random() * (cw - 120),
            y: 100 + Math.random() * (ch - 300),
            r: 15, pulse: 0
        });
    }

    // Input
    window.addEventListener('pointerdown', function(e) {
        if (state === 'GAMEOVER') return;
        player.targetX = e.clientX;
        player.targetY = e.clientY;
    });
    window.addEventListener('pointermove', function(e) {
        if (e.buttons > 0 && state === 'PLAYING') {
            player.targetX = e.clientX;
            player.targetY = e.clientY;
        }
    });
    document.getElementById('restart-btn').onclick = function() { init(); };

    function updateHUD() {
        document.getElementById('hud-score').textContent = 'Score: ' + score;
        document.getElementById('hud-lives').textContent = '❤️ ' + lives;
    }

    function update(dt) {
        if (state !== 'PLAYING') return;
        // Move player toward target
        var dx = player.targetX - player.x;
        var dy = player.targetY - player.y;
        var dist = Math.hypot(dx, dy);
        if (dist > 2) {
            var speed = gameConfig.heroSpeed || 5;
            var move = Math.min(dist, speed * dt * 60);
            player.x += (dx / dist) * move;
            player.y += (dy / dist) * move;
        }
        // Clamp player to safe area
        player.x = Math.max(player.r, Math.min(cw - player.r, player.x));
        player.y = Math.max(80 + player.r, Math.min(ch - 180 - player.r, player.y));

        // Move enemies toward player
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            var edx = player.x - e.x, edy = player.y - e.y;
            var ed = Math.hypot(edx, edy);
            if (ed > 0) { e.x += (edx/ed) * e.speed * dt * 60; e.y += (edy/ed) * e.speed * dt * 60; }
            // Collision with player
            if (ed < player.r + e.r) {
                lives--;
                updateHUD();
                if (lives <= 0) { gameOver(); return; }
                // Reset enemy position
                e.x = Math.random() * cw;
                e.y = Math.random() < 0.5 ? 80 : ch - 180;
            }
        }
        // Coin collection
        for (var j = coins.length - 1; j >= 0; j--) {
            coins[j].pulse += dt * 4;
            var c = coins[j];
            if (Math.hypot(player.x - c.x, player.y - c.y) < player.r + c.r) {
                score += 10;
                coins.splice(j, 1);
                spawnCoin();
                if (score % 50 === 0) spawnEnemy();
                updateHUD();
            }
        }
    }

    function draw() {
        // Background gradient
        var bg = ctx.createLinearGradient(0, 0, 0, ch);
        bg.addColorStop(0, '#0f0f2a');
        bg.addColorStop(1, '#1a0a2e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cw, ch);

        // Draw coins with glow
        for (var j = 0; j < coins.length; j++) {
            var c = coins[j];
            var pr = c.r + Math.sin(c.pulse) * 3;
            ctx.save();
            ctx.shadowBlur = 15; ctx.shadowColor = '#ffcc00';
            ctx.fillStyle = '#ffcc00';
            ctx.beginPath(); ctx.arc(c.x, c.y, pr, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        }
        // Draw enemies
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            ctx.save();
            ctx.shadowBlur = 10; ctx.shadowColor = '#ff3344';
            ctx.fillStyle = '#ff3344';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2); ctx.fill();
            // Eyes
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(e.x - 6, e.y - 5, 4, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(e.x + 6, e.y - 5, 4, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(e.x - 5, e.y - 5, 2, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(e.x + 7, e.y - 5, 2, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        }
        // Draw player
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = '#44aaff';
        ctx.fillStyle = '#44aaff';
        ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(player.x - 8, player.y - 6, 5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(player.x + 8, player.y - 6, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(player.x - 7, player.y - 6, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(player.x + 9, player.y - 6, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    }

    function gameOver() {
        state = 'GAMEOVER';
        document.getElementById('final-score').textContent = score;
        document.getElementById('game-over').style.display = 'flex';
    }

    function gameLoop(now) {
        if (!lastTime) lastTime = now;
        var dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        update(dt);
        draw();
        requestAnimationFrame(gameLoop);
    }
    init();
    requestAnimationFrame(gameLoop);
    </script>
</body></html>
\`\`\`

=== YOUR TASK ===
Using the EXACT same structure, patterns, and code style as the reference template above, build a DIFFERENT game that matches the GAME BRIEF. Change the theme, entities, mechanics, colors, and gameplay — but keep the same architecture:
- Same HTML structure (head/style/canvas/hud/game-over/script)
- Same game-config pattern (parse at boot, read in update loop)
- Same state machine (PLAYING/GAMEOVER)
- Same entity pattern (objects with x, y, r properties)
- Same input pattern (pointer events setting target position)
- Same render pipeline (background → entities → player → overlays)
- Same safe areas (top: 80px, bottom: canvas.height - 180px)
${assetLoadCode ? `\n- Load these asset images at the top of your script:\n${assetLoadCode}\nDraw them with ctx.drawImage(). Check .complete before drawing. Fall back to a colored shape if not loaded.` : ''}

Output ONLY the complete HTML file. No explanation.

\`\`\`html
<!DOCTYPE html>
...
\`\`\`
`;
}
