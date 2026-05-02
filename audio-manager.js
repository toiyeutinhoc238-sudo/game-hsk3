class AudioManager {
    constructor() {
        this.music = new Audio('nhac_nen/halloween.mp3');
        this.music.loop = true;
        this.isMuted = localStorage.getItem('game_muted') === 'true';
        this.btn = null;
        
        this.init();
    }

    init() {
        // Create the button in DOM
        this.btn = document.createElement('div');
        this.btn.className = 'audio-toggle';
        this.btn.id = 'audio-toggle-btn';
        this.btn.innerHTML = this.isMuted ? '🔇' : '🔊';
        if (!this.isMuted) this.btn.classList.add('playing');
        else this.btn.classList.add('muted');
        
        document.body.appendChild(this.btn);

        this.btn.onclick = (e) => {
            e.stopPropagation();
            this.toggle();
        };

        // Try to play immediately
        if (!this.isMuted) {
            this.music.play().catch(() => {
                console.log("Autoplay blocked, waiting for interaction...");
            });
        }

        // Multiple triggers to ensure music starts on first interaction
        const startMusic = () => {
            if (!this.isMuted && this.music.paused) {
                this.music.play().catch(e => console.log("Play failed"));
            }
            // Remove listeners after first successful start
            ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
                window.removeEventListener(evt, startMusic)
            );
        };

        ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
            window.addEventListener(evt, startMusic)
        );
    }

    toggle() {
        this.isMuted = !this.isMuted;
        localStorage.setItem('game_muted', this.isMuted);
        
        if (this.isMuted) {
            this.music.pause();
            this.btn.innerHTML = '🔇';
            this.btn.classList.remove('playing');
            this.btn.classList.add('muted');
        } else {
            this.music.play().catch(e => console.log("Play error"));
            this.btn.innerHTML = '🔊';
            this.btn.classList.add('playing');
            this.btn.classList.remove('muted');
        }
    }
}

// Global instance
window.gameAudio = new AudioManager();
