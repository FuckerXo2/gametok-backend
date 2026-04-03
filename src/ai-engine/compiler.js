export function compileGameHTML(json, assetMap) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@700;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #0a0a0f; font-family: 'Outfit', -apple-system, sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
        
// No DOM UI required
        
        #game-over-screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10,10,15,0.85); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); display: none; flex-direction: column; justify-content: center; align-items: center; z-index: 200; pointer-events: auto; opacity: 0; transition: opacity 0.5s ease; }
        #game-over-title { font-size: 48px; font-weight: 900; color: #fff; margin-bottom: 20px; text-shadow: 0 4px 20px rgba(0,0,0,0.5); background: linear-gradient(135deg, #FF3366, #FF9933); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .btn-restart { background: #fff; color: #000; padding: 16px 40px; border-radius: 40px; font-size: 20px; font-weight: 700; border: none; box-shadow: 0 10px 30px rgba(255,255,255,0.2); transform: scale(1); transition: transform 0.1s; display: flex; align-items: center; gap: 10px; }
        .btn-restart:active { transform: scale(0.95); }

        #error-overlay { display: none; position: fixed; z-index: 9999; background: rgba(10,0,0,0.97); color: #ff3366; padding: 20px; width: 100%; height: 100%; box-sizing: border-box; font-family: monospace; overflow-y: auto; text-align: left; font-size: 13px; }
        #loading-screen { position: fixed; z-index: 8888; top: 0; left: 0; width: 100%; height: 100%; background: #0a0a0f; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #fff; }
        #loading-screen .spinner { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.15); border-top-color: #a855f7; border-radius: 50%; animation: spin 0.7s linear infinite; margin-bottom: 14px; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="error-overlay"></div>
    <div id="loading-screen">
        <div class="spinner"></div>
        <div style="font-size:14px;opacity:0.7;font-weight:700;">BUILDING WORLD...</div>
    </div>

    <!-- GAME CANVAS -->
    <canvas id="game-canvas"></canvas>

<!-- UI OVERLAY REMOVED FOR CUSTOM AI UI -->

    <!-- GAME OVER UI -->
    <div id="game-over-screen">
        <div id="game-over-title">GAME OVER</div>
        <button class="btn-restart" onclick="window.gameRestartCallback && window.gameRestartCallback()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-5.67"/></svg>
            PLAY AGAIN
        </button>
    </div>

    <script>
        // Global error handlers
        window.onerror = function(msg, source, lineno, colno, error) {
            document.getElementById('loading-screen').style.display = 'none';
            var overlay = document.getElementById('error-overlay');
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>Game Error</h3><p>" + msg + "</p><p>Line: " + lineno + "</p><hr>";
            return true;
        };

        // === CANVAS SETUP ===
        var canvas = document.getElementById('game-canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';

        // Hide loading screen once game starts
        document.getElementById('loading-screen').style.display = 'none';

        // === EXTERNAL ASSET INJECTION ===
        window.EXTERNAL_ASSETS = ${JSON.stringify(assetMap || {})};

        // === COLLISION DETECTION HELPER ===
        window.collides = function(a, b) {
            return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        };

        // === UI UTILS REMOVED ===

        window.showGameOver = function(score, onRestartFn) {
            window.gameRestartCallback = function() {
                document.getElementById('game-over-screen').style.opacity = '0';
                setTimeout(function() {
                    document.getElementById('game-over-screen').style.display = 'none';
                    if (onRestartFn) onRestartFn();
                }, 300);
            };
            var go = document.getElementById('game-over-screen');
            go.style.display = 'flex';
            void go.offsetWidth; 
            go.style.opacity = '1';
        }        // === PHYSICS ENGINE (Matter.js) ===
        // Loaded globally via CDN so AI can use it without writing complex math
        window.Matter = Matter;

        // === DYNAMIC SPRITE TRANSPARENCY (Chroma Keying) ===
        // Automatically turns AI-generated JPEGs (with black/white bg) into transparent sprites
        window.makeTransparent = function(imgElement, tolerance = 30, colorToReplace = [0,0,0]) {
            var c = document.createElement('canvas');
            c.width = imgElement.width || imgElement.naturalWidth;
            c.height = imgElement.height || imgElement.naturalHeight;
            var ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(imgElement, 0, 0, c.width, c.height);
            var imgData = ctx.getImageData(0, 0, c.width, c.height);
            var data = imgData.data;
            for (var i = 0; i < data.length; i += 4) {
                var r = data[i], g = data[i+1], b = data[i+2];
                // Check distance from target color
                var dist = Math.sqrt(Math.pow(r - colorToReplace[0], 2) + Math.pow(g - colorToReplace[1], 2) + Math.pow(b - colorToReplace[2], 2));
                if (dist < tolerance) {
                    data[i+3] = 0; // Set alpha to 0 (transparent)
                }
            }
            ctx.putImageData(imgData, 0, 0);
            var newImg = new Image();
            newImg.src = c.toDataURL("image/png");
            return newImg;
        };

        // === AUDIO API ===
        var audioCtx = null;
        function getAudioCtx() {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return audioCtx;
        }
        window.playSound = function(type) {
            var ctx = getAudioCtx();
            try {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                var t = ctx.currentTime;
                if (type === 'jump') { osc.type='sine'; osc.frequency.setValueAtTime(400,t); osc.frequency.exponentialRampToValueAtTime(800,t+0.1); gain.gain.setValueAtTime(0.3,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.1); osc.start(t); osc.stop(t+0.1); }
                else if (type === 'coin') { osc.type='sine'; osc.frequency.setValueAtTime(1200,t); osc.frequency.setValueAtTime(1600,t+0.05); gain.gain.setValueAtTime(0.2,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.15); osc.start(t); osc.stop(t+0.15); }
                else if (type === 'hit') { osc.type='square'; osc.frequency.setValueAtTime(150,t); osc.frequency.exponentialRampToValueAtTime(50,t+0.2); gain.gain.setValueAtTime(0.4,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.2); osc.start(t); osc.stop(t+0.2); }
                else if (type === 'gameover') { osc.type='sawtooth'; osc.frequency.setValueAtTime(200,t); osc.frequency.linearRampToValueAtTime(50,t+0.6); gain.gain.setValueAtTime(0.5,t); gain.gain.linearRampToValueAtTime(0.01,t+0.6); osc.start(t); osc.stop(t+0.6); }
            } catch(e) {}
        };

        // === BACKGROUND MUSIC ENGINE ===
        var bgmInterval = null;
        window.startBGM = function(style) {
            if (bgmInterval) return; // already playing
            var ctx = getAudioCtx();
            var masterGain = ctx.createGain();
            masterGain.gain.value = 0.12;
            masterGain.connect(ctx.destination);

            var patterns = {
                synthwave: { notes: [261,329,392,523,392,329,261,196], wave: 'triangle', tempo: 200 },
                chiptune:  { notes: [523,659,784,659,523,392,523,659], wave: 'square', tempo: 150 },
                chill:     { notes: [220,261,329,392,329,261,220,196], wave: 'sine', tempo: 280 },
                dark:      { notes: [146,174,196,220,196,174,146,130], wave: 'sawtooth', tempo: 250 },
                arcade:    { notes: [440,523,659,784,880,784,659,523], wave: 'square', tempo: 120 }
            };
            var p = patterns[style] || patterns.synthwave;
            var step = 0;

            bgmInterval = setInterval(function() {
                try {
                    var osc = ctx.createOscillator();
                    var g = ctx.createGain();
                    osc.type = p.wave;
                    osc.frequency.value = p.notes[step % p.notes.length];
                    g.gain.setValueAtTime(0.15, ctx.currentTime);
                    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (p.tempo / 1000) * 0.9);
                    osc.connect(g);
                    g.connect(masterGain);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + (p.tempo / 1000));
                    step++;
                } catch(e) {}
            }, p.tempo);
        };
        window.stopBGM = function() { if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; } };
    </script>
    <script>
// === GENERATED GAME CODE ===
${json.code}
    </script>
</body>
</html>`;
}
