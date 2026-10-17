/**
 * Audio Manager - Hỗ trợ phát nhạc nền & tương thích LMS iframe sandbox
 */
class AudioManager {
    constructor() {
        this.music = new Audio('nhac_nen/halloween.mp3');
        this.music.loop = true;
        this.isMuted = this.getSavedMuteState();
        this.btn = null;
        
        this.init();
    }

    getSavedMuteState() {
        try {
            if (window.LMSAdapter) {
                return window.LMSAdapter.getStorage('game_muted', 'false') === 'true';
            }
            if (window.localStorage) {
                return window.localStorage.getItem('game_muted') === 'true';
            }
        } catch (e) {
            // Blocked by LMS sandbox iframe
        }
        return false;
    }

    saveMuteState(val) {
        try {
            if (window.LMSAdapter) {
                window.LMSAdapter.setStorage('game_muted', String(val));
                return;
            }
            if (window.localStorage) {
                window.localStorage.setItem('game_muted', String(val));
            }
        } catch (e) {
            // Silently ignore if LMS iframe restricts storage
        }
    }

    init() {
        // Create the button in DOM
        this.btn = document.createElement('div');
        this.btn.className = 'audio-toggle';
        this.btn.id = 'audio-toggle-btn';
        this.btn.title = 'Bật/Tắt âm thanh';
        this.btn.innerHTML = this.isMuted ? '🔇' : '🔊';
        if (!this.isMuted) this.btn.classList.add('playing');
        else this.btn.classList.add('muted');
        
        document.body.appendChild(this.btn);

        this.btn.onclick = (e) => {
            e.stopPropagation();
            this.toggle();
        };

        // Try to play immediately (LMS might require user interaction first)
        if (!this.isMuted) {
            this.music.play().catch(() => {
                // Autoplay blocked by LMS iframe policy, will play on first interaction
            });
        }

        // Multiple triggers to ensure music starts on first user gesture
        const startMusic = () => {
            if (!this.isMuted && this.music.paused) {
                this.music.play().catch(() => {});
            }
            ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
                window.removeEventListener(evt, startMusic)
            );
        };

        ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
            window.addEventListener(evt, startMusic, { passive: true })
        );
    }

    toggle() {
        this.isMuted = !this.isMuted;
        this.saveMuteState(this.isMuted);
        
        if (this.isMuted) {
            this.music.pause();
            this.btn.innerHTML = '🔇';
            this.btn.classList.remove('playing');
            this.btn.classList.add('muted');
        } else {
            this.music.play().catch(() => {});
            this.btn.innerHTML = '🔊';
            this.btn.classList.add('playing');
            this.btn.classList.remove('muted');
        }
    }
}

// Global instance
window.gameAudio = new AudioManager();
