export function compileGameHTML(json) {
    const configScript = json.config ? `<script>window.gameConfig = ${JSON.stringify(json.config)};</script>` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #0a0a0f; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
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
        <div style="font-size:14px;opacity:0.7;">Loading game...</div>
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
        window.addEventListener('unhandledrejection', function(e) {
            document.getElementById('loading-screen').style.display = 'none';
            var overlay = document.getElementById('error-overlay');
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>Async Error</h3><p>" + (e.reason || e) + "</p><hr>";
        });

        // Auto-hide loading screen once canvas appears or after timeout
        var loadCheck = setInterval(function() {
            if (document.querySelector('canvas')) {
                document.getElementById('loading-screen').style.display = 'none';
                clearInterval(loadCheck);
            }
        }, 150);
        setTimeout(function() {
            var ls = document.getElementById('loading-screen');
            if (ls && ls.style.display !== 'none') {
                ls.innerHTML = '<div style="text-align:center;padding:20px;"><h2 style="color:#ff3366;">⚠️ Game failed to start</h2><p style="color:#aaa;font-size:14px;">Tap Retry below to regenerate</p></div>';
            }
            clearInterval(loadCheck);
        }, 6000);

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
                if (type === 'jump') { osc.type='sine'; osc.frequency.setValueAtTime(250,t); osc.frequency.exponentialRampToValueAtTime(500,t+0.12); gain.gain.setValueAtTime(0.4,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.12); osc.start(t); osc.stop(t+0.12); }
                else if (type === 'coin') { osc.type='sine'; osc.frequency.setValueAtTime(880,t); osc.frequency.setValueAtTime(1320,t+0.06); gain.gain.setValueAtTime(0.25,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.12); osc.start(t); osc.stop(t+0.12); }
                else if (type === 'explosion') { osc.type='sawtooth'; osc.frequency.setValueAtTime(120,t); osc.frequency.exponentialRampToValueAtTime(15,t+0.25); gain.gain.setValueAtTime(0.4,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.3); osc.start(t); osc.stop(t+0.3); }
                else if (type === 'shoot') { osc.type='square'; osc.frequency.setValueAtTime(440,t); osc.frequency.exponentialRampToValueAtTime(120,t+0.08); gain.gain.setValueAtTime(0.25,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.08); osc.start(t); osc.stop(t+0.08); }
                else if (type === 'match') { osc.type='sine'; osc.frequency.setValueAtTime(523,t); osc.frequency.setValueAtTime(659,t+0.08); osc.frequency.setValueAtTime(784,t+0.16); gain.gain.setValueAtTime(0.3,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.25); osc.start(t); osc.stop(t+0.25); }
                else if (type === 'hit') { osc.type='triangle'; osc.frequency.setValueAtTime(200,t); osc.frequency.exponentialRampToValueAtTime(60,t+0.15); gain.gain.setValueAtTime(0.35,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.15); osc.start(t); osc.stop(t+0.15); }
            } catch(e) {}
        };

        // Utility: Create an Image from an inline SVG string
        window.svgToImage = function(svgString) {
            var img = new Image();
            img.src = 'data:image/svg+xml;base64,' + btoa(svgString);
            return img;
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
