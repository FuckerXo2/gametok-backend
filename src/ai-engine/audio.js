// DreamStream Audio Runtime
// Plays real audio files from window.DREAM_AUDIO_MANIFEST. No oscillator synthesis.
(function() {
    if (window._audioInitialized) return;
    window._audioInitialized = true;

    const cache = new Map();
    let unlocked = false;
    let currentMusic = null;
    let currentMusicKey = null;

    function manifest() {
        return window.DREAM_AUDIO_MANIFEST || { sfx: [], music: [] };
    }

    function musicTracks() {
        const data = manifest();
        return Array.isArray(data.music) ? data.music.filter(function(entry) {
            return entry && entry.url;
        }) : [];
    }

    function allEntries() {
        const data = manifest();
        return []
            .concat(Array.isArray(data.sfx) ? data.sfx : [])
            .concat(musicTracks());
    }

    function findEntry(entryOrKey) {
        if (entryOrKey && typeof entryOrKey === 'object') return entryOrKey;
        const key = String(entryOrKey || '').trim();
        if (!key) return null;
        return allEntries().find(function(entry) {
            return entry.key === key ||
                entry.role === key ||
                entry.trigger === key ||
                String(entry.key || '').includes(key) ||
                String(entry.role || '').includes(key);
        }) || null;
    }

    function findMusicEntry(key) {
        if (key) {
            const direct = findEntry(key);
            if (direct && direct.url) return direct;
        }
        const tracks = musicTracks();
        return tracks.find(function(entry) {
            return entry.key === 'bgm_main' || entry.key === 'bgm' || entry.role === 'background_music';
        }) || tracks[0] || null;
    }

    function configureAudioElement(audio, entry, options) {
        audio.preload = 'auto';
        const isMusic = entry.assetType === 'music' || options?.loop || entry.loop;
        audio.volume = typeof entry.volume === 'number'
            ? entry.volume
            : (isMusic ? 0.38 : 0.8);
        audio.loop = Boolean(options && options.loop) || Boolean(entry.loop) || entry.assetType === 'music';
        return audio;
    }

    function cloneAudio(entry, options) {
        if (!entry || !entry.url) return null;
        const base = cache.get(entry.url) || new Audio(entry.url);
        configureAudioElement(base, entry, options);
        cache.set(entry.url, base);
        const audio = base.cloneNode(true);
        configureAudioElement(audio, entry, options);
        return audio;
    }

    function play(entryOrKey, options) {
        const entry = findEntry(entryOrKey);
        const audio = cloneAudio(entry, options);
        if (!audio) return false;

        const started = audio.play();
        if (started && typeof started.catch === 'function') {
            started.catch(function() {
                window.__dreamAudioQueue = window.__dreamAudioQueue || [];
                window.__dreamAudioQueue.push(['play', entry.key || entry.role]);
            });
        }
        return true;
    }

    function isMusicPlaying() {
        return Boolean(currentMusic && !currentMusic.paused && !currentMusic.ended);
    }

    function startMusic(key) {
        const entry = findMusicEntry(key);
        if (!entry || !entry.url) return false;
        if (isMusicPlaying() && (!key || currentMusicKey === entry.key)) return true;

        try {
            if (currentMusic) {
                currentMusic.pause();
                currentMusic.currentTime = 0;
            }
        } catch (e) {}

        currentMusic = cloneAudio(entry, { loop: true });
        if (!currentMusic) return false;
        currentMusic.loop = true;
        currentMusic.volume = typeof entry.volume === 'number' ? entry.volume : 0.38;
        currentMusicKey = entry.key || entry.role || 'bgm_main';

        const started = currentMusic.play();
        if (started && typeof started.catch === 'function') {
            started.catch(function() {
                currentMusic = null;
                currentMusicKey = null;
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
        } catch (e) {}
        currentMusic = null;
        currentMusicKey = null;
    }

    function ensureBackgroundMusic() {
        if (!musicTracks().length) return false;
        if (isMusicPlaying()) return true;
        return startMusic();
    }

    function unlock() {
        if (!unlocked) {
            unlocked = true;
            allEntries().forEach(function(entry) {
                if (!entry.url || cache.has(entry.url)) return;
                try {
                    const audio = new Audio(entry.url);
                    audio.preload = 'auto';
                    audio.volume = 0;
                    cache.set(entry.url, audio);
                    audio.load();
                } catch (e) {}
            });

            const pending = Array.isArray(window.__dreamAudioQueue) ? window.__dreamAudioQueue.splice(0) : [];
            pending.forEach(function(call) {
                try {
                    if (call[0] === 'play') play(call[1]);
                    if (call[0] === 'startMusic') startMusic(call[1]);
                } catch (e) {}
            });
        }

        ensureBackgroundMusic();
    }

    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown', 'pointerdown'].forEach(function(eventName) {
        document.addEventListener(eventName, unlock, { once: false, passive: true });
    });

    window.DreamAudio = {
        unlock,
        play,
        startMusic,
        stopMusic,
        ensureBackgroundMusic,
        isMusicPlaying,
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
        } catch (e) {}
    });
})();
