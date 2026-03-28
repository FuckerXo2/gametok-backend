export function compileGameHTML(json, assetMap) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
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
        }

        // === AUDIO API ===
        var audioCtx = null;
        window.playSound = function(type) {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            try {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                var t = audioCtx.currentTime;
                if (type === 'jump') { osc.type='sine'; osc.frequency.setValueAtTime(400,t); osc.frequency.exponentialRampToValueAtTime(800,t+0.1); gain.gain.setValueAtTime(0.3,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.1); osc.start(t); osc.stop(t+0.1); }
                else if (type === 'coin') { osc.type='sine'; osc.frequency.setValueAtTime(1200,t); osc.frequency.setValueAtTime(1600,t+0.05); gain.gain.setValueAtTime(0.2,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.15); osc.start(t); osc.stop(t+0.15); }
                else if (type === 'hit') { osc.type='square'; osc.frequency.setValueAtTime(150,t); osc.frequency.exponentialRampToValueAtTime(50,t+0.2); gain.gain.setValueAtTime(0.4,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.2); osc.start(t); osc.stop(t+0.2); }
                else if (type === 'gameover') { osc.type='sawtooth'; osc.frequency.setValueAtTime(200,t); osc.frequency.linearRampToValueAtTime(50,t+0.6); gain.gain.setValueAtTime(0.5,t); gain.gain.linearRampToValueAtTime(0.01,t+0.6); osc.start(t); osc.stop(t+0.6); }
            } catch(e) {}
        };
    </script>
    <script>
// === GENERATED GAME CODE ===
${json.code}
    </script>
</body>
</html>`;
}
