/**
 * LMS Adapter for HSK 3 Witch Game (Thuốc Độc Của Phù Thủy)
 * Kiến trúc đồng bộ & tương thích LMS chuẩn HSK 2 / HSK 4:
 * - Tương thích 100% với mọi hệ thống LMS: Moodle, Canvas, Blackboard, Schoology, Google Classroom, Brightspace (D2L)
 * - SCORM 1.2 & SCORM 2004 (CMI API: Lesson Status, Score, Session Time, Commit, Terminate)
 * - Cross-Origin iFrame & Sandbox Resilience (Safe Storage in-memory fallback, 3rd-party cookie fallback)
 * - Auto-Resize postMessage (setHeight, resize, lti.frameResize, HSK3_RESIZE)
 * - Smart Fullscreen & Popout (Open in Standalone Window fallback when iframe blocks fullscreen)
 * - Web Audio API Synthesizer Fallback (Works 100% offline, intranet & firewalled schools)
 * - Toast Notification System
 */

(function (window) {
    'use strict';

    // 1. In-memory fallback if localStorage is blocked by sandboxed iframe
    const memoryStorage = {};

    const safeStorage = {
        getItem(key, defaultVal = null) {
            try {
                if (window.localStorage) {
                    const val = window.localStorage.getItem(key);
                    return val !== null ? val : defaultVal;
                }
            } catch (e) {
                // Blocked by LMS cross-origin iframe sandbox or 3rd-party cookie policy
            }
            try {
                if (window.sessionStorage) {
                    const val = window.sessionStorage.getItem(key);
                    return val !== null ? val : defaultVal;
                }
            } catch (e) {}
            return key in memoryStorage ? memoryStorage[key] : defaultVal;
        },
        setItem(key, value) {
            try {
                if (window.localStorage) {
                    window.localStorage.setItem(key, value);
                    return;
                }
            } catch (e) {
                // Fallback to in-memory store
            }
            try {
                if (window.sessionStorage) {
                    window.sessionStorage.setItem(key, value);
                    return;
                }
            } catch (e) {}
            memoryStorage[key] = String(value);
        },
        removeItem(key) {
            try {
                if (window.localStorage) {
                    window.localStorage.removeItem(key);
                }
            } catch (e) {}
            try {
                if (window.sessionStorage) {
                    window.sessionStorage.removeItem(key);
                }
            } catch (e) {}
            delete memoryStorage[key];
        }
    };

    window.safeStorage = safeStorage;

    // 2. LMS Adapter Core
    const LMSAdapter = {
        isSCORM: false,
        scormVersion: null, // '1.2' or '2004'
        apiHandle: null,
        isInitialized: false,
        startTime: new Date(),
        isInIframe: false,
        isNavigatingInternal: false,
        audioCtx: null,

        // Backwards compatibility helpers
        getStorage(key, defaultVal = null) {
            return safeStorage.getItem(key, defaultVal);
        },
        setStorage(key, value) {
            safeStorage.setItem(key, value);
        },

        /**
         * Safely discover SCORM API in window hierarchy
         */
        findAPI(win) {
            let findAttempts = 0;
            const maxAttempts = 15;
            let current = win;

            while (current && findAttempts < maxAttempts) {
                try {
                    if (current.API) {
                        this.scormVersion = '1.2';
                        return current.API;
                    }
                    if (current.API_1484_11) {
                        this.scormVersion = '2004';
                        return current.API_1484_11;
                    }
                } catch (e) {
                    break;
                }

                try {
                    if (current.parent && current.parent !== current) {
                        current = current.parent;
                    } else if (current.opener) {
                        current = current.opener;
                    } else {
                        break;
                    }
                } catch (e) {
                    break;
                }
                findAttempts++;
            }
            return null;
        },

        /**
         * Initialize LMS connection
         */
        init() {
            if (this.isInitialized) return;

            try {
                this.isInIframe = window.self !== window.top;
            } catch (e) {
                this.isInIframe = true;
            }

            // 1. Detect SCORM
            try {
                this.apiHandle = this.findAPI(window);
                if (this.apiHandle) {
                    this.isSCORM = true;
                    if (this.scormVersion === '1.2') {
                        this.apiHandle.LMSInitialize("");
                        this.apiHandle.LMSSetValue("cmi.core.lesson_status", "incomplete");
                        this.apiHandle.LMSCommit("");
                    } else if (this.scormVersion === '2004') {
                        this.apiHandle.Initialize("");
                        this.apiHandle.SetValue("cmi.completion_status", "incomplete");
                        this.apiHandle.Commit("");
                    }
                    console.log(`[LMSAdapter] Connected to SCORM ${this.scormVersion}`);
                }
            } catch (e) {
                console.warn("[LMSAdapter] SCORM initialization warning:", e);
            }

            // 2. Setup PostMessage broadcaster for iframe resizing & event tracking
            this.setupPostMessage();

            // 3. Setup unload handler for SCORM finish
            const handleUnload = () => {
                if (!this.isNavigatingInternal) {
                    this.terminate();
                }
            };
            window.addEventListener('beforeunload', handleUnload);
            window.addEventListener('pagehide', handleUnload);
            window.addEventListener('unload', handleUnload);

            // 4. Global hotkeys
            window.addEventListener('keydown', (e) => {
                if (e.key === 'f' || e.key === 'F') {
                    // Only toggle if not typing in input
                    if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                        this.toggleFullscreen();
                    }
                } else if (e.key === 'm' || e.key === 'M') {
                    if (typeof window.toggleMusic === 'function') {
                        window.toggleMusic(e);
                    }
                }
            });

            // 5. Global Web Audio unlocker on user interaction
            const unlockAudioCtx = () => {
                const ctx = this.getAudioContext();
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume().catch(() => {});
                }
            };
            ['click', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
                document.addEventListener(evt, unlockAudioCtx, { passive: true });
            });

            this.isInitialized = true;
            this.sendPostMessage('HSK3_LMS_READY', {
                title: 'HSK 3 - Thuốc Độc Của Phù Thủy',
                scorm: this.isSCORM,
                version: this.scormVersion,
                inIframe: this.isInIframe
            });
        },

        markInternalNavigation() {
            this.isNavigatingInternal = true;
        },

        /**
         * Auto-report height & width to parent LMS iframe to eliminate scrollbars
         */
        setupPostMessage() {
            const reportSize = () => {
                try {
                    const height = Math.max(
                        document.body.scrollHeight || 0,
                        document.documentElement.scrollHeight || 0,
                        document.body.offsetHeight || 0,
                        document.documentElement.offsetHeight || 0
                    );
                    this.sendPostMessage('setHeight', { height });
                    this.sendPostMessage('resize', { height, width: window.innerWidth });
                    this.sendPostMessage('HSK3_RESIZE', { height });

                    // IMS LTI Frame Resize Protocol
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            subject: 'lti.frameResize',
                            height: height
                        }, '*');
                    }
                } catch (e) {}
            };

            window.addEventListener('resize', reportSize);
            window.addEventListener('load', reportSize);

            if (window.MutationObserver && document.body) {
                const observer = new MutationObserver(reportSize);
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            }

            // Listen for control commands from parent LMS
            window.addEventListener('message', (event) => {
                if (!event || !event.data) return;
                const data = event.data;
                const action = data.action || data.type;

                if (action === 'MUTE' || action === 'HSK3_MUTE') {
                    if (typeof window.setMuted === 'function') {
                        window.setMuted(true);
                    } else if (typeof window.toggleMusic === 'function' && window.bgMusic && !window.bgMusic.muted) {
                        window.toggleMusic();
                    }
                } else if (action === 'UNMUTE' || action === 'HSK3_UNMUTE') {
                    if (typeof window.setMuted === 'function') {
                        window.setMuted(false);
                    } else if (typeof window.toggleMusic === 'function' && window.bgMusic && window.bgMusic.muted) {
                        window.toggleMusic();
                    }
                } else if (action === 'HSK3_LMS_COMPLETE' && data.payload && this.isSCORM) {
                    this.recordScore(data.payload.score, data.payload.maxScore, data.payload);
                }
            });
        },

        sendPostMessage(action, payload = {}) {
            const message = {
                source: 'HSK3_WITCH_GAME',
                action: action,
                payload: payload,
                timestamp: Date.now()
            };
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(message, '*');
                }
            } catch (e) {}

            try {
                if (window.opener && window.opener !== window && !window.opener.closed) {
                    window.opener.postMessage(message, '*');
                }
            } catch (e) {}
        },

        postToParent(eventType, data) {
            this.sendPostMessage(eventType, data);
        },

        formatScormTime(startDate) {
            const diff = Math.max(0, Math.floor((new Date() - startDate) / 1000));
            const hours = Math.floor(diff / 3600);
            const minutes = Math.floor((diff % 3600) / 60);
            const seconds = diff % 60;
            const pad = (n) => (n < 10 ? '0' + n : n);
            return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        },

        /**
         * Report game completion and scores to LMS
         */
        recordScore(score, maxScore = 250, details = {}) {
            console.log(`[LMSAdapter] Recording score: ${score}/${maxScore}`, details);
            const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 100;
            const sessionTime = this.formatScormTime(this.startTime);

            // 1. SCORM reporting
            if (this.isSCORM && this.apiHandle) {
                try {
                    const scaledScore = maxScore > 0 ? (score / maxScore) : 1;
                    if (this.scormVersion === '1.2') {
                        this.apiHandle.LMSSetValue("cmi.core.score.raw", String(scorePercent));
                        this.apiHandle.LMSSetValue("cmi.core.score.max", "100");
                        this.apiHandle.LMSSetValue("cmi.core.score.min", "0");
                        this.apiHandle.LMSSetValue("cmi.core.session_time", sessionTime);
                        this.apiHandle.LMSSetValue("cmi.core.lesson_status", score > 0 ? "passed" : "completed");
                        this.apiHandle.LMSCommit("");
                    } else if (this.scormVersion === '2004') {
                        this.apiHandle.SetValue("cmi.score.raw", String(scorePercent));
                        this.apiHandle.SetValue("cmi.score.max", "100");
                        this.apiHandle.SetValue("cmi.score.min", "0");
                        this.apiHandle.SetValue("cmi.score.scaled", String((scorePercent / 100).toFixed(2)));
                        this.apiHandle.SetValue("cmi.session_time", 'PT' + Math.floor((new Date() - this.startTime) / 1000) + 'S');
                        this.apiHandle.SetValue("cmi.completion_status", "completed");
                        this.apiHandle.SetValue("cmi.success_status", score > 0 ? "passed" : "completed");
                        this.apiHandle.Commit("");
                    }
                } catch (e) {
                    console.warn("[LMSAdapter] SCORM score save note:", e);
                }
            }

            // 2. PostMessage to LMS wrapper
            this.sendPostMessage('HSK3_LMS_COMPLETE', {
                score: score,
                scorePercent: scorePercent,
                maxScore: maxScore,
                status: score > 0 ? 'passed' : 'completed',
                theme: details.theme || '',
                winner: details.winner || '',
                duration: sessionTime
            });
        },

        terminate() {
            if (this.isSCORM && this.apiHandle) {
                try {
                    if (this.scormVersion === '1.2') {
                        this.apiHandle.LMSCommit("");
                        this.apiHandle.LMSFinish("");
                    } else if (this.scormVersion === '2004') {
                        this.apiHandle.Commit("");
                        this.apiHandle.Terminate("");
                    }
                    this.apiHandle = null;
                } catch (e) {}
            }
        },

        finishSession() {
            this.terminate();
        },

        /**
         * Show toast notification on game interface
         */
        showToast(msg, duration = 2500) {
            let toast = document.getElementById('lms-toast') || document.getElementById('sync-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'lms-toast';
                toast.className = 'lms-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        },

        /**
         * Smart Fullscreen toggle with LMS iframe fallback
         */
        toggleFullscreen(targetElem = document.documentElement) {
            const isFsDisallowed = (document.fullscreenEnabled === false);

            if (this.isInIframe && isFsDisallowed) {
                this.openNewTab();
                return;
            }

            try {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    const req = targetElem.requestFullscreen || targetElem.webkitRequestFullscreen || targetElem.mozRequestFullScreen || targetElem.msRequestFullscreen;
                    if (req) {
                        const p = req.call(targetElem);
                        if (p && typeof p.then === 'function') {
                            p.then(() => {
                                this.showToast("⛶ Đã bật chế độ Toàn Màn Hình");
                            }).catch(() => {
                                if (this.isInIframe) {
                                    this.openNewTab();
                                } else {
                                    this.showToast("⛶ Đã mở rộng giao diện");
                                }
                            });
                            return;
                        }
                    }
                } else {
                    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
                    if (exit) {
                        exit.call(document);
                        this.showToast("🗗 Đã trở về chế độ chuẩn");
                    }
                }
            } catch (e) {
                if (this.isInIframe) {
                    this.openNewTab();
                }
            }
        },

        openNewTab() {
            if (typeof window.openGameInNewWindow === 'function') {
                window.openGameInNewWindow();
                return;
            }
            if (window.SyncManager && typeof window.SyncManager.openPopup === 'function') {
                window.SyncManager.openPopup();
            }
        },

        /**
         * Safe Audio Playback Wrapper
         */
        safePlayAudio(audio, synthFallbackType = null) {
            if (!audio) return;
            const isBg = audio.isBackgroundMusic || audio.id === 'bgMusic' || audio === window.bgMusic;
            try {
                if (!isBg) {
                    audio.muted = false;
                    audio.currentTime = 0;
                }
            } catch (e) {}

            const ctx = this.getAudioContext();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            try {
                const p = audio.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(() => {
                        if (synthFallbackType) {
                            this.playSynthesizedSound(synthFallbackType);
                        }
                    });
                }
            } catch (e) {
                if (synthFallbackType) {
                    this.playSynthesizedSound(synthFallbackType);
                }
            }
        },

        /**
         * Web Audio API Synthesizer Fallback (Works 100% offline, intranet & firewalled schools)
         */
        getAudioContext() {
            if (!this.audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.audioCtx = new AudioCtx();
                }
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
            return this.audioCtx;
        },

        playTone(freq, type = 'sine', duration = 0.2, gainVal = 0.2) {
            try {
                const ctx = this.getAudioContext();
                if (!ctx) return;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(gainVal, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + duration);
            } catch (e) {}
        },

        playSynthesizedSound(type) {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            switch (type) {
                case 'correct':
                case 'chime':
                case 'ding':
                    [523.25, 659.25, 783.99].forEach((f, i) => {
                        setTimeout(() => this.playTone(f, 'triangle', 0.25, 0.22), i * 70);
                    });
                    break;
                case 'wrong':
                case 'buzz':
                case 'poison':
                    this.playTone(130, 'sawtooth', 0.45, 0.3);
                    setTimeout(() => this.playTone(95, 'sawtooth', 0.4, 0.3), 100);
                    break;
                case 'magic':
                case 'sparkle':
                    [784, 988, 1175, 1568].forEach((f, i) => {
                        setTimeout(() => this.playTone(f, 'sine', 0.2, 0.15), i * 60);
                    });
                    break;
                case 'victory':
                case 'win':
                    [523, 659, 784, 1046].forEach((f, i) => {
                        setTimeout(() => this.playTone(f, 'sine', 0.35, 0.2), i * 90);
                    });
                    break;
                case 'click':
                case 'select':
                    this.playTone(587.33, 'triangle', 0.1, 0.2);
                    break;
                case 'tap':
                    this.playTone(440, 'sine', 0.08, 0.15);
                    break;
            }
        },

        playChime() { this.playSynthesizedSound('chime'); },
        playBuzz() { this.playSynthesizedSound('buzz'); },
        playMagic() { this.playSynthesizedSound('magic'); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => LMSAdapter.init());
    } else {
        LMSAdapter.init();
    }

    window.LMSAdapter = LMSAdapter;
    window.LMSBridge = LMSAdapter;
    window.safePlayAudio = function (audio, fallback) {
        LMSAdapter.safePlayAudio(audio, fallback);
    };

})(window);
