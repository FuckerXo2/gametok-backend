// Global Juice Engine - Intercepts HUD DOM changes to add AAA game feel to 50+ templates instantly.
(function() {
    if (window._juiceInitialized) return;
    window._juiceInitialized = true;

    // 1. Inject Styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ds-shake {
            0% { transform: translate(1px, 1px) rotate(0deg); }
            10% { transform: translate(-1px, -2px) rotate(-1deg); }
            20% { transform: translate(-3px, 0px) rotate(1deg); }
            30% { transform: translate(3px, 2px) rotate(0deg); }
            40% { transform: translate(1px, -1px) rotate(1deg); }
            50% { transform: translate(-1px, 2px) rotate(-1deg); }
            60% { transform: translate(-3px, 1px) rotate(0deg); }
            70% { transform: translate(3px, 1px) rotate(-1deg); }
            80% { transform: translate(-1px, -1px) rotate(1deg); }
            90% { transform: translate(1px, 2px) rotate(0deg); }
            100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        @keyframes ds-pop {
            0%   { transform: scale(1); }
            50%  { transform: scale(1.5); }
            100% { transform: scale(1); }
        }
        .ds-shake-anim { animation: ds-shake 0.3s cubic-bezier(.36,.07,.19,.97) both; }
        .ds-pop-anim { animation: ds-pop 0.2s ease-out both; }
        
        #juice-canvas {
            position: absolute;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none;
            z-index: 9999;
        }
    `;
    document.head.appendChild(style);

    // 2. Setup Overlay Canvas for Particles
    const canvas = document.createElement('canvas');
    canvas.id = 'juice-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let cw = canvas.width = window.innerWidth;
    let ch = canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
        cw = canvas.width = window.innerWidth;
        ch = canvas.height = window.innerHeight;
    });

    let particles = [];
    let floaters = [];

    function spawnParticles(x, y, color, count=15) {
        for(let i=0; i<count; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 10 - 2,
                life: 1,
                color: color,
                size: Math.random() * 6 + 3
            });
        }
    }

    function spawnFloater(x, y, text, color) {
        floaters.push({
            x, y, text, color, life: 1, vy: -2
        });
    }

    function juiceLoop() {
        ctx.clearRect(0, 0, cw, ch);
        
        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
            ctx.fill();
            if (p.life <= 0) particles.splice(i, 1);
        }

        // Floaters
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";
        for (let i = floaters.length - 1; i >= 0; i--) {
            let f = floaters[i];
            f.y += f.vy;
            f.life -= 0.015;
            ctx.globalAlpha = Math.max(0, f.life);
            ctx.fillStyle = 'white';
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 4;
            ctx.strokeText(f.text, f.x, f.y);
            ctx.fillText(f.text, f.x, f.y);
            if (f.life <= 0) floaters.splice(i, 1);
        }
        
        ctx.globalAlpha = 1.0;
        requestAnimationFrame(juiceLoop);
    }
    requestAnimationFrame(juiceLoop);

    // 3. Observers to trigger Juice autonomously
    window.addEventListener('DOMContentLoaded', () => {
        const scoreEl = document.getElementById('score');
        const livesEl = document.getElementById('lives');
        const healthEl = document.getElementById('health');
        const goEl = document.getElementById('game-over');

        let lastScore = 0;
        if (scoreEl) {
            lastScore = parseInt(scoreEl.textContent) || 0;
            new MutationObserver((mutations) => {
                let currentScore = parseInt(scoreEl.textContent) || 0;
                if (currentScore > lastScore) {
                    // SCORE INCREASE! Juice it!
                    spawnParticles(cw / 2, ch / 4, '#FFD700', 20);
                    spawnFloater(cw / 2, ch / 4 - 20, '+1', '#FFD700');
                    scoreEl.classList.remove('ds-pop-anim');
                    void scoreEl.offsetWidth; // trigger reflow
                    scoreEl.classList.add('ds-pop-anim');
                }
                lastScore = currentScore;
            }).observe(scoreEl, { childList: true, characterData: true, subtree: true });
        }

        const monitorDamage = (el) => {
            if (!el) return;
            let lastVal = parseInt(el.textContent) || 0;
            new MutationObserver((mutations) => {
                let currentVal = parseInt(el.textContent) || 0;
                if (currentVal < lastVal) {
                    // DAMAGE TAKEN! Shake screen!
                    document.body.classList.remove('ds-shake-anim');
                    void document.body.offsetWidth;
                    document.body.classList.add('ds-shake-anim');
                    spawnParticles(cw / 2, ch / 2, '#FF0000', 30);
                }
                lastVal = currentVal;
            }).observe(el, { childList: true, characterData: true, subtree: true });
        };
        monitorDamage(livesEl);
        monitorDamage(healthEl);

        if (goEl) {
            new MutationObserver((mutations) => {
                if (window.getComputedStyle(goEl).display !== 'none') {
                    // GAME OVER! Massive blur and shockwave
                    document.body.classList.add('ds-shake-anim');
                    const gameCanvas = document.getElementById('gameCanvas');
                    if(gameCanvas) {
                        gameCanvas.style.transition = 'filter 0.5s';
                        gameCanvas.style.filter = 'blur(10px) grayscale(80%)';
                    }
                }
            }).observe(goEl, { attributes: true, attributeFilter: ['style', 'class'] });
        }
    });

})();
