/**
 * Audio Manager for HSK 3 Witch Game (Thuốc Độc Của Phù Thủy)
 * Đồng bộ âm thanh 2 chiều thời gian thực chuẩn HSK 2 / HSK 4:
 * - Đồng bộ trạng thái Bật/Tắt âm thanh (Mute/Unmute) giữa LMS và Cửa Sổ Mới
 * - Đồng bộ vị trí bản nhạc (CurrentTime) - khi chuyển cửa sổ, nhạc phát tiếp ngay vị trí hiện tại
 * - BroadcastChannel, postMessage & safeStorage fallback
 * - Tự động mở khoá AudioContext & chính sách Autoplay trên mọi trình duyệt
 */

(function (window) {
    'use strict';

    class AudioManager {
        constructor() {
            this.music = new Audio('nhac_nen/halloween.mp3');
            this.music.loop = true;
            this.music.isBackgroundMusic = true;
            window.bgMusic = this.music;

            const params = new URLSearchParams(window.location.search);
            const isPopout = params.get('popout') === '1' || params.get('popup') === '1' || (window.opener && window.name === 'HSK3_Standalone_Game');
            this.isPopout = isPopout;

            // 1. Khởi tạo trạng thái Mute từ URL param hoặc safeStorage
            this.isMuted = false;
            if (params.has('muted')) {
                this.isMuted = (params.get('muted') === '1');
            } else {
                const saved = window.safeStorage ? window.safeStorage.getItem('musicMuted') : localStorage.getItem('musicMuted');
                const legacy = window.safeStorage ? window.safeStorage.getItem('game_muted') : localStorage.getItem('game_muted');
                this.isMuted = (saved === 'true' || legacy === 'true');
            }

            // 2. Khởi tạo vị trí âm thanh (audioTime) từ URL param
            const initAudioTime = parseFloat(params.get('audioTime')) || 0;
            if (initAudioTime > 0) {
                const setSeek = () => {
                    try {
                        if (this.music.duration && initAudioTime >= this.music.duration) {
                            this.music.currentTime = initAudioTime % this.music.duration;
                        } else {
                            this.music.currentTime = initAudioTime;
                        }
                    } catch (e) {}
                };
                if (this.music.readyState >= 1) {
                    setSeek();
                } else {
                    this.music.addEventListener('loadedmetadata', setSeek, { once: true });
                }
            }

            // 3. Khởi tạo BroadcastChannel để đồng bộ âm thanh đa cửa sổ
            this.syncChannel = null;
            try {
                if ('BroadcastChannel' in window) {
                    this.syncChannel = new BroadcastChannel('hsk3_game_sync');
                    this.syncChannel.onmessage = (e) => this.handleIncomingSync(e.data);
                }
            } catch (e) {}

            // Lắng nghe postMessage và storage
            window.addEventListener('message', (e) => this.handleIncomingSync(e.data));
            window.addEventListener('storage', (e) => {
                if (e.key === 'hsk3_audio_sync' && e.newValue) {
                    try {
                        const parsed = JSON.parse(e.newValue);
                        this.handleIncomingSync(parsed);
                    } catch (err) {}
                }
            });

            this.lastToggleTime = 0;
            this.initUI();
            this.setupAutoplayUnlock();
        }

        initUI() {
            this.updateUI();

            // Gắn sự kiện cho các nút toggle âm thanh có sẵn trong DOM
            const bindBtn = (btn) => {
                if (!btn) return;
                btn.onclick = (e) => {
                    if (e && e.preventDefault) e.preventDefault();
                    if (e && e.stopPropagation) e.stopPropagation();
                    this.toggle(e);
                };
            };

            const musicToggleBtn = document.getElementById('musicToggle');
            if (musicToggleBtn) bindBtn(musicToggleBtn);

            const audioToggleBtn = document.getElementById('audio-toggle-btn') || document.querySelector('.audio-toggle');
            if (audioToggleBtn) bindBtn(audioToggleBtn);

            // Tự động phát nếu không mute và không phải LMS Host đang chờ child window
            if (!this.isMuted) {
                const isHostWaiting = window.SyncManager && window.SyncManager.hasActiveChild && window.SyncManager.hasActiveChild();
                if (!isHostWaiting) {
                    this.music.play().catch(() => {});
                }
            }
        }

        updateUI() {
            this.music.muted = this.isMuted;

            const musicToggleBtn = document.getElementById('musicToggle');
            if (musicToggleBtn) {
                const icon = musicToggleBtn.querySelector('.icon') || musicToggleBtn;
                icon.textContent = this.isMuted ? '🔇' : '🔊';
                musicToggleBtn.classList.toggle('muted', this.isMuted);
                musicToggleBtn.classList.toggle('playing', !this.isMuted);
            }

            const audioToggleBtn = document.getElementById('audio-toggle-btn') || document.querySelector('.audio-toggle');
            if (audioToggleBtn) {
                audioToggleBtn.innerHTML = this.isMuted ? '🔇' : '🔊';
                audioToggleBtn.classList.toggle('muted', this.isMuted);
                audioToggleBtn.classList.toggle('playing', !this.isMuted);
            }

            if (this.isMuted) {
                this.music.pause();
            } else {
                const isHostWaiting = window.SyncManager && window.SyncManager.hasActiveChild && window.SyncManager.hasActiveChild();
                if (this.music.paused && !isHostWaiting) {
                    window.safePlayAudio ? window.safePlayAudio(this.music) : this.music.play().catch(() => {});
                }
            }
        }

        broadcastAudioSync(customTime = null) {
            const curTime = isFinite(customTime) && customTime !== null
                ? Number(customTime.toFixed(2))
                : (this.music ? Number(this.music.currentTime.toFixed(2)) : 0);

            const msg = {
                type: 'HSK3_AUDIO_SYNC',
                isMuted: this.isMuted,
                audioCurrentTime: curTime,
                audioPlaying: !this.isMuted && this.music && !this.music.paused,
                timestamp: Date.now()
            };

            if (this.syncChannel) {
                try { this.syncChannel.postMessage(msg); } catch (e) {}
            }

            try {
                if (this.isPopout && window.opener && !window.opener.closed) {
                    window.opener.postMessage(msg, '*');
                } else if (window.SyncManager && window.SyncManager.childWin && !window.SyncManager.childWin.closed) {
                    window.SyncManager.childWin.postMessage(msg, '*');
                }
            } catch (e) {}

            try {
                if (window.safeStorage) {
                    window.safeStorage.setItem('hsk3_audio_sync', JSON.stringify(msg));
                }
            } catch (e) {}
        }

        handleIncomingSync(data) {
            if (!data || data.type !== 'HSK3_AUDIO_SYNC') return;

            if (typeof data.isMuted === 'boolean') {
                const muteChanged = this.isMuted !== data.isMuted;
                this.isMuted = data.isMuted;

                if (window.safeStorage) {
                    window.safeStorage.setItem('musicMuted', this.isMuted ? 'true' : 'false');
                    window.safeStorage.setItem('game_muted', this.isMuted ? 'true' : 'false');
                }

                this.updateUI();

                const isHostWaiting = !this.isPopout && window.SyncManager && window.SyncManager.hasActiveChild && window.SyncManager.hasActiveChild();
                if (isHostWaiting) {
                    this.music.pause();
                } else if (!this.isMuted) {
                    if (isFinite(data.audioCurrentTime)) {
                        try { this.music.currentTime = data.audioCurrentTime; } catch (e) {}
                    }
                    window.safePlayAudio ? window.safePlayAudio(this.music) : this.music.play().catch(() => {});
                }
            }
        }

        toggle(e) {
            if (e && e.preventDefault) e.preventDefault();
            const now = Date.now();
            if (now - this.lastToggleTime < 250) return; // Prevent double trigger
            this.lastToggleTime = now;

            if (window.LMSAdapter) {
                window.LMSAdapter.playSynthesizedSound('tap');
            }

            this.isMuted = !this.isMuted;
            if (window.safeStorage) {
                window.safeStorage.setItem('musicMuted', this.isMuted ? 'true' : 'false');
                window.safeStorage.setItem('game_muted', this.isMuted ? 'true' : 'false');
            }

            this.updateUI();

            if (window.LMSAdapter && window.LMSAdapter.showToast) {
                window.LMSAdapter.showToast(this.isMuted ? '🔇 Đã tắt nhạc nền' : '🔊 Đã bật nhạc nền');
            }

            this.broadcastAudioSync();
        }

        setMuted(muted) {
            this.isMuted = !!muted;
            if (window.safeStorage) {
                window.safeStorage.setItem('musicMuted', this.isMuted ? 'true' : 'false');
                window.safeStorage.setItem('game_muted', this.isMuted ? 'true' : 'false');
            }
            this.updateUI();
            this.broadcastAudioSync();
        }

        seek(time) {
            if (isFinite(time) && this.music) {
                try {
                    this.music.currentTime = time;
                } catch (e) {}
            }
        }

        setupAutoplayUnlock() {
            const unlock = () => {
                if (window.LMSAdapter && window.LMSAdapter.getAudioContext) {
                    const ctx = window.LMSAdapter.getAudioContext();
                    if (ctx && ctx.state === 'suspended') {
                        ctx.resume().catch(() => {});
                    }
                }
                const isHostWaiting = window.SyncManager && window.SyncManager.hasActiveChild && window.SyncManager.hasActiveChild();
                if (!this.isMuted && this.music.paused && !isHostWaiting) {
                    window.safePlayAudio ? window.safePlayAudio(this.music) : this.music.play().catch(() => {});
                }
            };
            ['click', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
                document.addEventListener(evt, unlock, { passive: true });
            });
        }
    }

    const gameAudio = new AudioManager();
    window.gameAudio = gameAudio;
    window.toggleMusic = function (e) { gameAudio.toggle(e); };
    window.setMuted = function (m) { gameAudio.setMuted(m); };

})(window);
