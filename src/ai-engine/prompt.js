export function buildOmniEnginePrompt(assetMap, manifest) {
    const assetEntries = Object.entries(assetMap);
    const assetLoadCode = assetEntries.map(([key, url]) => 
        `var ${key} = new Image(); ${key}.crossOrigin = "anonymous"; ${key}.src = "${url}";`
    ).join("\n");
    const assetImgTags = assetEntries.map(([key, url]) =>
        `<img id="img_${key}" data-editable="image" data-label="${key}" src="${url}" hidden>`
    ).join("\n");

    return `You are an expert HTML5 Canvas game developer. You produce a COMPLETE, working HTML file.

=== EXTREMELY IMPORTANT INSTRUCTION ===
DO NOT just copy and paste the reference template exactly! The reference template is only there to show you the architectural skeleton (how to use RequestAnimationFrame, how to parse gameConfig, how to bind pointer events). 
You MUST COMPLETELY REWRITE the internal game logic (the update loop, the drawing logic, the entities) to explicitly create the game described in the GAME BRIEF! If you just output the reference template without changing it to match the requested game, YOU WILL FAIL!

=== GAME BRIEF ===
${manifest ? manifest.mechanics : "Build a highly engaging interactive mobile game."}

=== REFERENCE TEMPLATE SKELETON ===
Use this HTML layout, HUD, and loop structure, BUT write Custom Game Logic to match the brief:

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
    ${assetLoadCode || ''}
    var canvas = document.getElementById('gameCanvas');
    var ctx = canvas.getContext('2d');
    var cw, ch;
    
    // Parse Config safely
    var gameConfig = {};
    try {
        var el = document.getElementById('game-config');
        if (el) {
            var conf = JSON.parse(el.textContent);
            for (var k in conf) gameConfig[k] = conf[k].value;
        }
    } catch(e) { console.error("Config parse error"); }

    function resize() {
        cw = window.innerWidth;
        ch = window.innerHeight;
        canvas.width = cw;
        canvas.height = ch;
    }
    window.addEventListener('resize', resize);
    
    // ==========================================
    // ZERO-SHOT GAME LOGIC (WRITE FROM SCRATCH)
    // ==========================================
    
    var lastTime = 0;
    function init() {
        resize();
        // You MUST initialize your unique game here
        
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
    
    function gameLoop(now) {
        var dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms to prevent glitches
        lastTime = now;
        
        // You MUST write custom physics, inputs, and draw operations here!
        ctx.clearRect(0, 0, cw, ch);
        
        requestAnimationFrame(gameLoop);
    }
    
    // Example interaction hooks
    window.addEventListener('pointerdown', function(e) {
        // Handle custom input
    });
    document.getElementById('restart-btn').onclick = function() {
        document.getElementById('game-over').style.display = 'none';
        init();
    };
    
    // Start Game
    init();
    </script>
</body>
</html>
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
