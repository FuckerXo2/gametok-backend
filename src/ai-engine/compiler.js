export function compileGameHTML(json) {
    const engineImports = `
        <script crossorigin="anonymous" src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.55.2/phaser.min.js"></script>
    `;

    const configScript = json.config ? `<script>window.gameConfig = ${JSON.stringify(json.config)};</script>` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    ${engineImports}
    <style>
        body { margin: 0; padding: 0; background: #1a1a2e; overflow: hidden; touch-action: none; font-family: sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
        #error-overlay { display: none; position: fixed; z-index: 9999; background: rgba(20,0,0,0.95); color: #ff3366; padding: 20px; width: 100%; height: 100%; box-sizing: border-box; font-family: monospace; overflow-y: auto; text-align: left; }
        #loading-screen { position: fixed; z-index: 8888; top: 0; left: 0; width: 100%; height: 100%; background: #1a1a2e; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #fff; font-family: sans-serif; }
        #loading-screen .spinner { width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #a855f7; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="error-overlay"></div>
    <div id="loading-screen">
        <div class="spinner"></div>
        <div>Loading game...</div>
    </div>
    <div id="game-container" style="width:100vw; height:100vh; display:block;"></div>
    
    ${configScript}

    <script>
        // Error catching - covers both thrown errors AND silent Phaser crashes
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

        // Hide loading screen once Phaser creates a canvas OR after 5s timeout
        var loadCheck = setInterval(function() {
            var canvas = document.querySelector('canvas');
            if (canvas) {
                document.getElementById('loading-screen').style.display = 'none';
                clearInterval(loadCheck);
            }
        }, 200);
        setTimeout(function() {
            var ls = document.getElementById('loading-screen');
            if (ls.style.display !== 'none') {
                ls.innerHTML = '<div style="text-align:center; padding:20px;"><h2 style="color:#ff3366;">⚠️ Game failed to start</h2><p style="color:#aaa;">Tap Retry below to regenerate</p></div>';
            }
            clearInterval(loadCheck);
        }, 8000);

        // Audio API
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.playSound = function(type) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            if(type === 'jump') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1); gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
            else if (type === 'coin') { osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.05); gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
            else if (type === 'explosion') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.2); gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3); osc.start(); osc.stop(audioCtx.currentTime + 0.3); }
            else if (type === 'shoot') { osc.type = 'square'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1); gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
        };
    </script>
    <script>
// RAW GENERATED PHASER LOGIC
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
