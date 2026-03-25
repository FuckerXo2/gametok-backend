export function compileGameHTML(json) {
    const configScript = json.config ? `<script>window.gameConfig = ${JSON.stringify(json.config)};</script>` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; connect-src *; script-src * 'unsafe-inline' 'unsafe-eval';">
    <script crossorigin="anonymous" src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.55.2/phaser.min.js"></script>
    <script crossorigin="anonymous" src="https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@700;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #0a0a0f; font-family: 'Outfit', -apple-system, sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
        
        /* DOM UI OVERLAY - Crystal clear text instead of blurry canvas text */
        #ui-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100; overflow: hidden; display: none; }
        .hud-top { position: absolute; top: env(safe-area-inset-top, 40px); left: 20px; right: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
        .score-pill { background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 12px 24px; border-radius: 30px; border: 2px solid rgba(255,255,255,0.1); }
        .score-label { font-size: 14px; font-weight: 700; color: #a855f7; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
        .score-value { font-size: 32px; font-weight: 900; color: #fff; text-shadow: 0 2px 10px rgba(168, 85, 247, 0.5); }
        .lives-container { display: flex; gap: 8px; }
        .life-icon { width: 24px; height: 24px; background: #ff3366; border-radius: 50%; box-shadow: 0 0 15px rgba(255, 51, 102, 0.5); transition: all 0.3s ease; }
        .life-icon.lost { background: rgba(255,255,255,0.1); box-shadow: none; transform: scale(0.8); }
        
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
    <div id="game-container" style="width:100vw; height:100vh; display:block;"></div>

    <!-- REZONA STYLE UI OVERLAY -->
    <div id="ui-layer">
        <div class="hud-top">
            <div class="score-pill">
                <div class="score-label">SCORE</div>
                <div class="score-value" id="ui-score">0</div>
            </div>
            <div class="lives-container" id="ui-lives"></div>
        </div>
    </div>

    <!-- REZONA STYLE GAME OVER UI -->
    <div id="game-over-screen">
        <div id="game-over-title">GAME OVER</div>
        <button class="btn-restart" onclick="window.gameRestartCallback && window.gameRestartCallback()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-5.67"/></svg>
            PLAY AGAIN
        </button>
    </div>

    ${configScript}

    <script>
        // Global error handlers
        window.onerror = function(msg, source, lineno, colno, error) {
            document.getElementById('loading-screen').style.display = 'none';
            var overlay = document.getElementById('error-overlay');
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>Game Error</h3><p>" + msg + "</p><p>Line: " + lineno + "</p><hr>";
            return true;
        };

        // Auto-hide loading screen once canvas appears
        var loadCheck = setInterval(function() {
            if (document.querySelector('canvas')) {
                document.getElementById('loading-screen').style.display = 'none';
                clearInterval(loadCheck);
            }
        }, 150);

        // ==== OPINIONATED FRAMEWORK UTILS ====
        
        window.showUI = function() { document.getElementById('ui-layer').style.display = 'block'; }
        window.hideUI = function() { document.getElementById('ui-layer').style.display = 'none'; }
        
        window.updateScore = function(val) {
            var el = document.getElementById('ui-score');
            el.innerText = val;
            el.style.transform = 'scale(1.3)'; // Pop animation
            setTimeout(() => el.style.transform = 'scale(1)', 150);
        }

        window.initLives = function(maxLives) {
            var c = document.getElementById('ui-lives');
            c.innerHTML = '';
            for(let i=0; i<maxLives; i++) {
                c.innerHTML += '<div class="life-icon" id="life-'+i+'"></div>';
            }
        }

        window.updateLives = function(currentLives, maxLives) {
            for(let i=0; i<maxLives; i++) {
                var life = document.getElementById('life-'+i);
                if (i >= currentLives) life.classList.add('lost');
                else life.classList.remove('lost');
            }
        }

        window.showGameOver = function(score, onRestartFn) {
            window.gameRestartCallback = () => {
                document.getElementById('game-over-screen').style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('game-over-screen').style.display = 'none';
                    if (onRestartFn) onRestartFn();
                }, 300);
            };
            var go = document.getElementById('game-over-screen');
            go.style.display = 'flex';
            // Trigger reflow for animation
            void go.offsetWidth; 
            go.style.opacity = '1';
        }

        // Audio API
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
try {
${json.code}
} catch(e) {
    document.getElementById('loading-screen').style.display = 'none';
    var ov = document.getElementById('error-overlay');
    ov.style.display = 'block';
    ov.innerHTML = '<h3>Game Init Crash</h3><p>' + e.message + '</p><p>Stack: ' + (e.stack || 'N/A') + '</p>';
}
    </script>
</body>
</html>`;
}
