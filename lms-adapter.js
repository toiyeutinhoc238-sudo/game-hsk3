/**
 * LMS Adapter for HSK 3 Witch Game
 * Hỗ trợ tương thích toàn diện với:
 * - Moodle, Canvas, Blackboard, Schoology, Google Classroom
 * - SCORM 1.2 & SCORM 2004 (CMI API)
 * - Iframe Embeds (Auto-height postMessage, Safe Storage, Fullscreen)
 * - Intranet / Firewalled School Networks (Web Audio API Synthesizer fallback)
 */

(function (window) {
    'use strict';

    // In-memory fallback if localStorage is blocked by sandboxed iframe
    const memoryStorage = {};

    const LMSAdapter = {
        isSCORM: false,
        scormVersion: null, // '1.2' or '2004'
        apiHandle: null,
        isInitialized: false,
        audioCtx: null,

        /**
         * Safe Storage Get
         */
        getStorage(key, defaultVal) {
            try {
                if (window.localStorage) {
                    const val = window.localStorage.getItem(key);
                    return val !== null ? val : defaultVal;
                }
            } catch (e) {
                // Blocked by LMS cross-origin iframe sandbox
            }
            return key in memoryStorage ? memoryStorage[key] : defaultVal;
        },

        /**
         * Safe Storage Set
         */
        setStorage(key, value) {
            try {
                if (window.localStorage) {
                    window.localStorage.setItem(key, value);
                    return;
                }
            } catch (e) {
                // Blocked by LMS cross-origin iframe sandbox
            }
            memoryStorage[key] = value;
        },

        /**
         * Find SCORM API in window hierarchy safely
         */
        findAPI(win) {
            let findAttempts = 0;
            const maxAttempts = 10;

            while (win && findAttempts < maxAttempts) {
                try {
                    if (win.API) {
                        this.scormVersion = '1.2';
                        return win.API;
                    }
                    if (win.API_1484_11) {
                        this.scormVersion = '2004';
                        return win.API_1484_11;
                    }
                } catch (e) {
                    // Cross-origin boundary reached
                    break;
                }

                if (win.parent && win.parent !== win) {
                    win = win.parent;
                } else if (win.opener) {
                    win = win.opener;
                } else {
                    break;
                }
                findAttempts++;
            }
            return null;
        },

        /**
         * Initialize LMS connection (SCORM & postMessage)
         */
        init() {
            if (this.isInitialized) return;

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
            window.addEventListener('beforeunload', () => this.terminate());
            window.addEventListener('unload', () => this.terminate());

            this.isInitialized = true;
            this.sendPostMessage('HSK_LMS_READY', {
                title: 'HSK 3 - Thuốc Độc Của Phù Thủy',
                scorm: this.isSCORM,
                version: this.scormVersion
            });
        },

        /**
         * Setup automatic height reporting to parent LMS iframe
         */
        setupPostMessage() {
            const reportSize = () => {
                const height = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.offsetHeight
                );
                this.sendPostMessage('setHeight', { height: height });
                this.sendPostMessage('resize', { height: height, width: window.innerWidth });
            };

            window.addEventListener('resize', reportSize);
            window.addEventListener('load', reportSize);

            // Report height when DOM changes
            if (window.MutationObserver) {
                const observer = new MutationObserver(reportSize);
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            }
        },

        /**
         * Broadcast events to parent LMS / iframe wrapper
         */
        sendPostMessage(action, data = {}) {
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        source: 'HSK3_GAME',
                        action: action,
                        payload: data,
                        timestamp: Date.now()
                    }, '*');
                }
            } catch (e) {
                // Ignore cross-origin postMessage errors
            }
        },

        /**
         * Report game completion and scores to LMS
         */
        recordScore(score, maxScore = 250, details = {}) {
            console.log(`[LMSAdapter] Recording score: ${score}/${maxScore}`, details);

            // 1. SCORM reporting
            if (this.isSCORM && this.apiHandle) {
                try {
                    const scaledScore = maxScore > 0 ? (score / maxScore) : 1;
                    if (this.scormVersion === '1.2') {
                        this.apiHandle.LMSSetValue("cmi.core.score.raw", String(score));
                        this.apiHandle.LMSSetValue("cmi.core.score.max", String(maxScore));
                        this.apiHandle.LMSSetValue("cmi.core.score.min", "0");
                        this.apiHandle.LMSSetValue("cmi.core.lesson_status", score > 0 ? "passed" : "completed");
                        this.apiHandle.LMSCommit("");
                    } else if (this.scormVersion === '2004') {
                        this.apiHandle.SetValue("cmi.score.raw", String(score));
                        this.apiHandle.SetValue("cmi.score.max", String(maxScore));
                        this.apiHandle.SetValue("cmi.score.min", "0");
                        this.apiHandle.SetValue("cmi.score.scaled", String(scaledScore.toFixed(2)));
                        this.apiHandle.SetValue("cmi.completion_status", "completed");
                        this.apiHandle.SetValue("cmi.success_status", score > 0 ? "passed" : "failed");
                        this.apiHandle.Commit("");
                    }
                } catch (e) {
                    console.warn("[LMSAdapter] SCORM score save failed:", e);
                }
            }

            // 2. PostMessage to LMS wrapper
            this.sendPostMessage('HSK_LMS_COMPLETE', {
                score: score,
                maxScore: maxScore,
                status: score > 0 ? 'passed' : 'completed',
                theme: details.theme || '',
                winner: details.winner || ''
            });
        },

        /**
         * Terminate SCORM session cleanly
         */
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
                } catch (e) {
                    // Ignore unload termination errors
                }
            }
        },

        /**
         * Toggle Fullscreen for LMS embeds
         */
        toggleFullscreen(targetElem = document.documentElement) {
            try {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    if (targetElem.requestFullscreen) {
                        targetElem.requestFullscreen().catch(() => {});
                    } else if (targetElem.webkitRequestFullscreen) {
                        targetElem.webkitRequestFullscreen();
                    }
                } else {
                    if (document.exitFullscreen) {
                        document.exitFullscreen().catch(() => {});
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    }
                }
            } catch (e) {
                console.log("Fullscreen not permitted in current frame");
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
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + duration);
            } catch (e) {}
        },

        playChime() {
            // Bright cheerful chime (C5 -> E5 -> G5)
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                setTimeout(() => this.playTone(freq, 'triangle', 0.35, 0.25), i * 80);
            });
        },

        playBuzz() {
            // Low dramatic buzzer for poison
            const ctx = this.getAudioContext();
            if (!ctx) return;
            this.playTone(130, 'sawtooth', 0.45, 0.3);
            setTimeout(() => this.playTone(95, 'sawtooth', 0.4, 0.3), 100);
        },

        playMagic() {
            // Mystical sparkle arpeggio
            [784, 988, 1175, 1568].forEach((freq, i) => {
                setTimeout(() => this.playTone(freq, 'sine', 0.2, 0.15), i * 60);
            });
        }
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => LMSAdapter.init());
    } else {
        LMSAdapter.init();
    }

    window.LMSAdapter = LMSAdapter;

})(window);
