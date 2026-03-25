export function compileGameHTML(json) {
    let engineImports = '';
    
    if (json.engine === 'threejs') {
        engineImports = `
            <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
            <script>
                const _originalLoad = THREE.TextureLoader.prototype.load;
                THREE.TextureLoader.prototype.load = function(url, onLoad, onProgress, onError) {
                    this.setCrossOrigin('anonymous');
                    return _originalLoad.call(this, url, onLoad, onProgress, onError);
                };
            </script>
        `;
    } else if (json.engine === 'phaser') {
        engineImports = `
            <script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>
        `;
    }

    // Inject the configuration block defined by the AI
    const configScript = json.config ? `<script>window.gameConfig = ${JSON.stringify(json.config)};</script>` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    ${engineImports}
    <style>
        body { margin: 0; padding: 0; background: #000; overflow: hidden; touch-action: none; font-family: sans-serif; }
        canvas { display: block; touch-action: none; outline: none; }
        #error-overlay { display: none; position: absolute; z-index: 9999; background: rgba(20,0,0,0.9); color: #ff3366; padding: 20px; width: 100%; height: 100%; box-sizing: border-box; font-family: monospace; overflow-y: auto; text-align: left; }
    </style>
</head>
<body>
    <div id="error-overlay"></div>
    <div id="game-container" style="width:100vw; height:100vh; display:block;"></div>
    
    <!-- Rezona-Style Parametric Config Bridge -->
    ${configScript}

    <script>
        window.onerror = function(msg, source, lineno, colno, error) {
            var overlay = document.getElementById('error-overlay');
            if (msg === 'Script error.') msg = 'WebGL CORS Blocked or Texture Loader Crash. Check image origins.';
            overlay.style.display = 'block';
            overlay.innerHTML += "<h3>" + "${json.engine}".toUpperCase() + " Engine Crash</h3><p>" + msg + "</p><p>Line: " + lineno + "</p><hr>";
            return true;
        };

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
// RAW GENERATED [${json.engine.toUpperCase()}] LOGIC
${json.code}
    </script>
</body>
</html>`;
}
