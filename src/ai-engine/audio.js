// DreamStream Audio Runtime
// Plays real audio files from window.DREAM_AUDIO_MANIFEST. No oscillator synthesis.
(function() {
    if (window._audioInitialized) return;
    window._audioInitialized = true;

    const cache = new Map();
    let unlocked = false;
    let currentMusic = null;

    function manifest() {
        return window.DREAM_AUDIO_MANIFEST || { sfx: [], music: [] };
    }

    function allEntries() {
        const data = manifest();
        return []
            .concat(Array.isArray(data.sfx) ? data.sfx : [])
            .concat(Array.isArray(data.music) ? data.music : []);
    }

    function findEntry(entryOrKey) {
        if (entryOrKey && typeof entryOrKey === 'object') return entryOrKey;
        const key = String(entryOrKey || '').trim();
        if (!key) return null;
        return allEntries().find((entry) => (
            entry.key === key ||
            entry.role === key ||
            entry.trigger === key ||
            String(entry.key || '').includes(key) ||
            String(entry.role || '').includes(key)
        )) || null;
    }

    function cloneAudio(entry) {
        if (!entry || !entry.url) return null;
        const base = cache.get(entry.url) || new Audio(entry.url);
        base.preload = 'auto';
        base.crossOrigin = 'anonymous';
        base.volume = typeof entry.volume === 'number' ? entry.volume : (entry.assetType === 'music' ? 0.28 : 0.8);
        cache.set(entry.url, base);
        const audio = base.cloneNode(true);
        audio.volume = base.volume;
        audio.crossOrigin = 'anonymous';
        return audio;
    }

    function play(entryOrKey, options) {
        const entry = findEntry(entryOrKey);
        const audio = cloneAudio(entry);
        if (!audio) return false;

        audio.loop = Boolean(options && options.loop) || Boolean(entry.loop) || entry.assetType === 'music';
        const started = audio.play();
        if (started && typeof started.catch === 'function') {
            started.catch(function() {
                window.__dreamAudioQueue = window.__dreamAudioQueue || [];
                window.__dreamAudioQueue.push(['play', entry.key || entry.role]);
            });
        }
        return true;
    }

    function startMusic(key) {
        const data = manifest();
        const tracks = Array.isArray(data.music) ? data.music : [];
        const entry = key ? findEntry(key) : tracks[0];
        if (!entry || !entry.url) return false;
        try {
            if (currentMusic) {
                currentMusic.pause();
                currentMusic.currentTime = 0;
            }
        } catch(e) {}
        currentMusic = cloneAudio(entry);
        if (!currentMusic) return false;
        currentMusic.loop = true;
        currentMusic.volume = typeof entry.volume === 'number' ? entry.volume : 0.24;
        const started = currentMusic.play();
        if (started && typeof started.catch === 'function') {
            started.catch(function() {
                window.__dreamAudioQueue = window.__dreamAudioQueue || [];
                window.__dreamAudioQueue.push(['startMusic', entry.key]);
            });
        }
        return true;
    }

    function stopMusic() {
        if (!currentMusic) return;
        try {
            currentMusic.pause();
            currentMusic.currentTime = 0;
        } catch(e) {}
        currentMusic = null;
    }

    function unlock() {
        if (unlocked) return;
        unlocked = true;
        allEntries().forEach((entry) => {
            if (!entry.url || cache.has(entry.url)) return;
            try {
                const audio = new Audio(entry.url);
                audio.preload = 'auto';
                audio.crossOrigin = 'anonymous';
                audio.volume = 0;
                cache.set(entry.url, audio);
                audio.load();
            } catch(e) {}
        });

        const pending = Array.isArray(window.__dreamAudioQueue) ? window.__dreamAudioQueue.splice(0) : [];
        pending.forEach(function(call) {
            try {
                if (call[0] === 'play') play(call[1]);
                if (call[0] === 'startMusic') startMusic(call[1]);
            } catch(e) {}
        });
    }

    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown', 'pointerdown'].forEach((eventName) => {
        document.addEventListener(eventName, unlock, { once: false, passive: true });
    });

    window.DreamAudio = {
        unlock,
        play,
        startMusic,
        stopMusic,
        getManifest: manifest,
        getEntries: allEntries,
        playCollect: function() { return play('collect'); },
        playHit: function() { return play('impact'); },
        playClick: function() { return play('ui_tap'); },
        playAction: function() { return play('primary_action'); },
        playMovement: function() { return play('movement_burst'); },
        playSuccess: function() { return play('success'); },
        playFailure: function() { return play('failure'); },
    };
    window.playDreamSound = window.DreamAudio.play;

    const pendingAudioCalls = Array.isArray(window.__dreamAudioQueue) ? window.__dreamAudioQueue.splice(0) : [];
    pendingAudioCalls.forEach(function(call) {
        try {
            if (call[0] === 'play') window.DreamAudio.play(call[1]);
            if (call[0] === 'startMusic') window.DreamAudio.startMusic(call[1]);
        } catch(e) {}
    });
})();
