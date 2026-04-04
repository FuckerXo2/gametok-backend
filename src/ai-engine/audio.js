// DreamStream Procedural Audio Engine
// Synthesizes all game sounds using Web Audio API — zero external files needed.
// Hooks into the Juice Engine's DOM mutation observers for automatic triggering.
(function() {
    if (window._audioInitialized) return;
    window._audioInitialized = true;

    let audioCtx = null;
    let audioUnlocked = false;

    function getCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // Unlock audio on first user interaction (mobile requirement)
    function unlockAudio() {
        if (audioUnlocked) return;
        const ctx = getCtx();
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        audioUnlocked = true;
    }

    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(evt => {
        document.addEventListener(evt, unlockAudio, { once: false, passive: true });
    });

    // ─────────────────────────────────────────
    // SOUND EFFECT LIBRARY (all synthesized)
    // ─────────────────────────────────────────

    function playCollectSound() {
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(587, ctx.currentTime);       // D5
            osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08); // G5
            osc.frequency.setValueAtTime(988, ctx.currentTime + 0.15); // B5

            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch(e) {}
    }

    function playHitSound() {
        try {
            const ctx = getCtx();
            // Noise burst for impact
            const bufferSize = ctx.sampleRate * 0.15;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

            // Low thud
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.12);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.5, ctx.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

            noise.connect(gain);
            gain.connect(ctx.destination);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);

            noise.start(ctx.currentTime);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch(e) {}
    }

    function playGameOverSound() {
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'sawtooth';
            // Dramatic descending notes
            osc.frequency.setValueAtTime(440, ctx.currentTime);       // A4
            osc.frequency.setValueAtTime(370, ctx.currentTime + 0.2); // F#4
            osc.frequency.setValueAtTime(294, ctx.currentTime + 0.4); // D4
            osc.frequency.setValueAtTime(220, ctx.currentTime + 0.6); // A3

            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.5);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 1.0);
        } catch(e) {}
    }

    function playClickSound() {
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.05);
        } catch(e) {}
    }

    // ─────────────────────────────────────────
    // AMBIENT BACKGROUND MUSIC (subtle loop)
    // ─────────────────────────────────────────

    let bgmPlaying = false;
    function startBGM() {
        if (bgmPlaying) return;
        bgmPlaying = true;
        try {
            const ctx = getCtx();

            // Pad chord — warm ambient drone
            const notes = [130.81, 164.81, 196.00]; // C3, E3, G3 (C major)
            notes.forEach(freq => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const filter = ctx.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(400, ctx.currentTime);

                gain.gain.setValueAtTime(0, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 2);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime);

                // Slow subtle LFO for movement
                const lfo = ctx.createOscillator();
                const lfoGain = ctx.createGain();
                lfo.type = 'sine';
                lfo.frequency.setValueAtTime(0.3, ctx.currentTime);
                lfoGain.gain.setValueAtTime(5, ctx.currentTime);
                lfo.connect(lfoGain);
                lfoGain.connect(osc.frequency);
                lfo.start(ctx.currentTime);
            });
        } catch(e) {}
    }

    // ─────────────────────────────────────────
    // AUTO-WIRE TO DOM (works with Juice Engine)
    // ─────────────────────────────────────────

    function wireAudio() {
        const scoreEl = document.getElementById('score');
        const livesEl = document.getElementById('lives');
        const healthEl = document.getElementById('health');
        const goEl = document.getElementById('game-over');
        const restartBtn = document.getElementById('restart-btn');

        let lastScore = 0;
        if (scoreEl) {
            lastScore = parseInt(scoreEl.textContent) || 0;
            new MutationObserver(() => {
                const current = parseInt(scoreEl.textContent) || 0;
                if (current > lastScore) {
                    playCollectSound();
                    // Start BGM on first score (means player is actively playing)
                    startBGM();
                }
                lastScore = current;
            }).observe(scoreEl, { childList: true, characterData: true, subtree: true });
        }

        const monitorDamage = (el) => {
            if (!el) return;
            let lastVal = parseInt(el.textContent) || 0;
            new MutationObserver(() => {
                const current = parseInt(el.textContent) || 0;
                if (current < lastVal) playHitSound();
                lastVal = current;
            }).observe(el, { childList: true, characterData: true, subtree: true });
        };
        monitorDamage(livesEl);
        monitorDamage(healthEl);

        if (goEl) {
            new MutationObserver(() => {
                if (window.getComputedStyle(goEl).display !== 'none') {
                    playGameOverSound();
                }
            }).observe(goEl, { attributes: true, attributeFilter: ['style', 'class'] });
        }

        if (restartBtn) {
            restartBtn.addEventListener('click', playClickSound);
        }

        // Start BGM on first touch (fallback)
        document.addEventListener('touchstart', startBGM, { once: true });
        document.addEventListener('click', startBGM, { once: true });
    }

    // Wire when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireAudio);
    } else {
        wireAudio();
    }

})();
