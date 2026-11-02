/**
 * SyncManager - Hệ thống đồng bộ 2 chiều thời gian thực giữa màn hình LMS và Cửa Sổ Mới (Standalone Window)
 * Kế thừa toàn bộ kiến trúc xuất sắc của Game Tiếng Trung HSK 2 / HSK 4:
 * 
 * - 4-tier Window Opening: Sized popup -> Named window -> _blank -> Anchor click fallback (bảo đảm 100% mở được trên mọi LMS iframe)
 * - Đồng bộ âm thanh toàn diện: Kế thừa chính xác currentTime và trạng thái Mute khi mở và khi đóng cửa sổ
 * - Heartbeat Guard: Khắc phục lỗi Chromium đánh dấu child.closed = true sớm trong sandbox iframe của LMS
 * - Real-time Overlay: Hiển thị chủ đề, vòng chơi, trạng thái và điểm số trực tiếp trên màn hình LMS
 * - 3 kênh truyền tin: BroadcastChannel + postMessage (opener/child) + safeStorage / storage event
 */

(function (window) {
    'use strict';

    const STORAGE_KEY = 'hsk3_synced_state';
    const CHANNEL_NAME = 'hsk3_game_sync';

    const storage = window.safeStorage || {
        getItem(k, d = null) { try { const v = localStorage.getItem(k); return v !== null ? v : d; } catch(e) { return d; } },
        setItem(k, v) { try { localStorage.setItem(k, v); } catch(e) {} },
        removeItem(k) { try { localStorage.removeItem(k); } catch(e) {} }
    };

    const params = new URLSearchParams(window.location.search);
    const isPopout = params.get('popout') === '1' || params.get('popup') === '1' || (window.opener && window.opener !== window && (window.name === 'HSK3_Standalone_Game' || window.name === 'HSK3_GAME_POPUP'));
    window.isChildWindow = isPopout;

    if (isPopout) {
        document.body.classList.add('is-child-window');
    }

    let syncChannel = null;
    try {
        if ('BroadcastChannel' in window) {
            syncChannel = new BroadcastChannel(CHANNEL_NAME);
        }
    } catch (e) {}

    let gameHandlers = null;
    let childWin = null;
    let popoutPollInterval = null;
    let latestSyncedState = null;
    let lastChildMessageTime = 0;

    // Khôi phục snapshot ban đầu nếu là Cửa Sổ Mới hoặc host vừa resume
    let initialSyncedState = null;
    if (isPopout || params.get('resume_sync') === '1') {
        try {
            const sess = sessionStorage.getItem('hsk3_resume_state');
            if (sess) {
                const parsedSess = JSON.parse(sess);
                if (parsedSess) {
                    initialSyncedState = parsedSess;
                }
                sessionStorage.removeItem('hsk3_resume_state');
            }
        } catch (e) {}
        try {
            if (window.opener && window.opener.__HSK3_LATEST_STATE__) {
                initialSyncedState = window.opener.__HSK3_LATEST_STATE__;
            }
        } catch (e) {}
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const urlSession = params.get('session');
                const isSessionValid = !urlSession || !parsed.syncSessionId || parsed.syncSessionId === urlSession;
                if (parsed && isSessionValid && (Date.now() - (parsed.timestamp || 0) < 7200000)) {
                    if (!initialSyncedState || (parsed.timestamp && parsed.timestamp > (initialSyncedState.timestamp || 0))) {
                        initialSyncedState = parsed;
                    }
                }
            }
        } catch (e) {}
    }

    // Gửi tín hiệu sẵn sàng từ Child tới Host
    if (isPopout && window.opener && !window.opener.closed) {
        try {
            window.opener.postMessage({ type: 'HSK3_CHILD_READY', timestamp: Date.now() }, '*');
        } catch (e) {}
    }

    /**
     * Cập nhật thông tin trực tiếp trên modal đồng bộ của LMS
     */
    function updateSyncOverlayInfo(state) {
        if (!state) return;
        const topicEl = document.getElementById('sync-overlay-topic');
        const phaseEl = document.getElementById('sync-overlay-phase');
        const scoreEl = document.getElementById('sync-overlay-score');
        const badgeEl = document.getElementById('sync-overlay-badge');

        if (topicEl) {
            topicEl.textContent = state.currentLessonDisplay || state.topicName || "Chủ đề HSK 3";
        }

        if (phaseEl) {
            if (state.isGameOver) {
                phaseEl.textContent = "Đã kết thúc";
                phaseEl.style.color = "var(--secondary, #00d2d3)";
            } else if (state.howToPlayModalActive) {
                phaseEl.textContent = "Xem luật chơi";
                phaseEl.style.color = "#ffeb3b";
            } else if (state.activeScreen === 'teams') {
                phaseEl.textContent = "Chọn số đội";
                phaseEl.style.color = "#55efc4";
            } else if (state.stage === 'POISONING') {
                phaseEl.textContent = `Trời Tối: Đội ${state.poisoningTeamIndex !== undefined ? state.poisoningTeamIndex + 1 : 1} giấu độc`;
                phaseEl.style.color = "#55efc4";
            } else {
                phaseEl.textContent = `Trời Sáng: Lượt Đội ${state.currentTurn !== undefined ? state.currentTurn + 1 : 1}`;
                phaseEl.style.color = "#55efc4";
            }
        }

        if (scoreEl) {
            if (state.activeScreen === 'teams') {
                scoreEl.textContent = "Chưa chọn đội";
            } else if (Array.isArray(state.scores) && state.scores.length > 0) {
                const teamScores = state.scores.slice(0, state.teamCount || 2).map((s, i) => `Đ${i + 1}: ${s}đ`).join(' | ');
                scoreEl.textContent = teamScores;
            } else {
                scoreEl.textContent = "0 đ";
            }
        }

        if (state.isGameOver) {
            if (badgeEl) {
                badgeEl.innerHTML = `<span class="sync-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span><span>TRẬN ĐẤU ĐÃ KẾT THÚC</span>`;
            }
            const modal = document.getElementById('sync-active-modal');
            const titleEl = modal ? modal.querySelector('.sync-title') : null;
            const descEl = modal ? modal.querySelector('.sync-description') : null;
            const resumeBtn = modal ? modal.querySelector('.sync-resume-btn') : null;
            if (titleEl) {
                titleEl.textContent = state.winnerText ? "Chiến Thắng!" : "Trận Đấu Đã Kết Thúc";
                titleEl.style.color = "var(--secondary, #00d2d3)";
            }
            if (descEl && state.winnerText) {
                descEl.textContent = state.winnerText;
            }
            if (resumeBtn) {
                resumeBtn.textContent = "📊 Xem Kết Quả & Ôn Tập Tại Màn Hình Này";
            }
        }
    }

    /**
     * Thu thập snapshot toàn bộ trạng thái game hiện tại (bao gồm cả Audio)
     */
    function getGameStateSnapshot() {
        let base = {};
        if (gameHandlers && typeof gameHandlers.getState === 'function') {
            base = gameHandlers.getState() || {};
        }

        const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
        const curAudioTime = bgMusic ? Number(bgMusic.currentTime.toFixed(2)) : 0;
        const isMuted = window.gameAudio ? window.gameAudio.isMuted : false;

        return {
            version: '3.0',
            timestamp: Date.now(),
            page: window.location.pathname.includes('game.html') ? 'game.html' : 'index.html',
            ...base,
            // Đồng bộ âm thanh
            isMuted: isMuted,
            audioCurrentTime: curAudioTime,
            audioPlaying: !isMuted && bgMusic && !bgMusic.paused
        };
    }

    /**
     * Áp dụng snapshot trạng thái (bao gồm khôi phục âm thanh)
     */
    function applyGameStateSnapshot(snapshot) {
        if (!snapshot) return false;

        // 1. Áp dụng âm thanh
        if (typeof snapshot.isMuted === 'boolean' && window.gameAudio) {
            window.gameAudio.setMuted(snapshot.isMuted);
        }

        const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
        if (isFinite(snapshot.audioCurrentTime) && bgMusic) {
            try {
                if (bgMusic.duration && snapshot.audioCurrentTime >= bgMusic.duration) {
                    bgMusic.currentTime = snapshot.audioCurrentTime % bgMusic.duration;
                } else {
                    bgMusic.currentTime = snapshot.audioCurrentTime;
                }
            } catch (e) {}
        }

        // 2. Áp dụng trạng thái game
        if (gameHandlers && typeof gameHandlers.applyState === 'function') {
            gameHandlers.applyState(snapshot);
        }

        // 3. Tiếp tục phát nhạc nếu không mute và không phải LMS Host đang chờ child window
        if (window.gameAudio && !window.gameAudio.isMuted && (!childWin || childWin.closed)) {
            if (bgMusic && bgMusic.paused) {
                window.safePlayAudio ? window.safePlayAudio(bgMusic) : bgMusic.play().catch(() => {});
            }
        }

        return true;
    }

    /**
     * Lưu và phát tán trạng thái tới các cửa sổ khác
     */
    function saveAndBroadcastState(customSnapshot = null, isClosing = false) {
        const snapshot = customSnapshot || getGameStateSnapshot();
        if (isClosing) snapshot.isPopoutClosing = true;
        latestSyncedState = snapshot;
        window.__HSK3_LATEST_STATE__ = snapshot;

        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            if (isClosing) {
                localStorage.setItem('hsk3_popout_closed', Date.now().toString());
            }
        } catch (e) {}

        const msgType = isClosing ? 'HSK3_POPOUT_CLOSED' : 'HSK3_STATE_UPDATE';
        const msg = { type: msgType, state: snapshot, timestamp: Date.now() };

        if (syncChannel) {
            try { syncChannel.postMessage(msg); } catch (e) {}
        }

        if (isPopout && window.opener && !window.opener.closed) {
            try { window.opener.__HSK3_LATEST_STATE__ = snapshot; } catch (e) {}
            try { window.opener.postMessage(msg, '*'); } catch (e) {}
        } else if (childWin && !childWin.closed) {
            try { childWin.postMessage(msg, '*'); } catch (e) {}
        }

        updateSyncOverlayInfo(snapshot);
    }

    /**
     * Xử lý tin nhắn đồng bộ đến (từ Host hoặc Child)
     */
    function handleIncomingSync(data) {
        if (!data) return;
        lastChildMessageTime = Date.now();
        const type = data.type || data.action;
        const state = data.state;

        if (type === 'HSK3_HEARTBEAT') {
            return;
        }

        // 1. Đồng bộ âm thanh riêng biệt
        if (type === 'HSK3_AUDIO_SYNC') {
            if (typeof data.isMuted === 'boolean' && window.gameAudio) {
                window.gameAudio.handleIncomingSync(data);
            }
            return;
        }

        // 2. Handshake: Child sẵn sàng, Host gửi ngay full state hiện tại
        if (type === 'HSK3_CHILD_READY' && !isPopout) {
            const currentSnap = getGameStateSnapshot();
            if (childWin && !childWin.closed) {
                try { childWin.postMessage({ type: 'HSK3_STATE_SYNC', state: currentSnap }, '*'); } catch (e) {}
            }
            if (syncChannel) {
                try { syncChannel.postMessage({ type: 'HSK3_STATE_SYNC', state: currentSnap }); } catch (e) {}
            }
            return;
        }

        // 3. Màn hình LMS Host nhận cập nhật từ Child
        if (!isPopout) {
            if (state) {
                latestSyncedState = state;
                window.__HSK3_LATEST_STATE__ = state;
                updateSyncOverlayInfo(state);

                // Áp dụng trạng thái liên tục trong nền để màn LMS luôn luôn khớp 100% từng nước đi
                if (gameHandlers && typeof gameHandlers.applyState === 'function') {
                    try { gameHandlers.applyState(state); } catch (e) {}
                }

                // Báo điểm lên SCORM nếu kết thúc
                if (window.LMSAdapter && state.isGameOver && typeof state.winnerScore === 'number') {
                    window.LMSAdapter.recordScore(state.winnerScore, 250, {
                        winner: state.winnerText || '',
                        theme: state.currentLessonDisplay || ''
                    });
                }
            }

            if (type === 'HSK3_POPOUT_CLOSED' || (state && state.isPopoutClosing)) {
                resumeInLmsWindow(false);
            }
        } else {
            // 4. Cửa Sổ Mới Child nhận cập nhật từ Host
            if ((type === 'HSK3_STATE_SYNC' || type === 'HSK3_STATE_UPDATE') && state) {
                applyGameStateSnapshot(state);
            } else if (type === 'HSK3_HOST_RESUMED') {
                if (window.LMSAdapter && typeof window.LMSAdapter.showToast === 'function') {
                    window.LMSAdapter.showToast("👉 Đang tiếp tục chơi trên màn hình LMS.");
                }
            }
        }
    }

    if (syncChannel) {
        syncChannel.onmessage = (e) => handleIncomingSync(e.data);
    }
    window.addEventListener('message', (e) => handleIncomingSync(e.data));
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            try {
                const parsed = JSON.parse(e.newValue);
                if (parsed) {
                    handleIncomingSync({
                        type: parsed.isPopoutClosing ? 'HSK3_POPOUT_CLOSED' : 'HSK3_STATE_UPDATE',
                        state: parsed
                    });
                }
            } catch (err) {}
        }
    });

    /**
     * Chiến lược mở Cửa Sổ Mới 4 cấp độ (Multi-tier Strategy chuẩn HSK 2 / HSK 4)
     */
    function openGameInNewWindow(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (window.LMSAdapter) window.LMSAdapter.playSynthesizedSound('tap');

        if (isPopout) {
            closePopoutAndReturnToLMS();
            return;
        }

        // 1. Tạm dừng timer nếu đang ở màn hình chơi
        if (gameHandlers && typeof gameHandlers.onPopupOpened === 'function') {
            gameHandlers.onPopupOpened();
        }

        // 2. Chụp vị trí nhạc hiện tại trước khi tạm dừng
        const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
        const currentAudioTime = bgMusic ? Number(bgMusic.currentTime.toFixed(2)) : 0;
        const isMuted = window.gameAudio ? window.gameAudio.isMuted : false;

        if (bgMusic && !bgMusic.paused) {
            try { bgMusic.pause(); } catch (err) {}
        }

        // 3. Snapshot trạng thái hiện tại
        const snapshot = getGameStateSnapshot();
        snapshot.isLmsWaiting = true;
        snapshot.syncSessionId = 'sync_' + Date.now();
        snapshot.audioCurrentTime = currentAudioTime;
        snapshot.isMuted = isMuted;

        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            storage.setItem('hsk3_active_session', snapshot.syncSessionId);
        } catch (err) {}
        window.__HSK3_LATEST_STATE__ = snapshot;

        if (syncChannel) {
            try { syncChannel.postMessage({ type: 'HSK3_SYNC_INIT', state: snapshot }); } catch (e) {}
        }

        // 4. Hiển thị Overlay trên màn hình LMS
        const overlay = document.getElementById('sync-active-modal') || document.getElementById('popup-sync-overlay');
        if (overlay) {
            overlay.classList.add('show');
            overlay.classList.add('active');
            overlay.style.display = 'flex';
            updateSyncOverlayInfo(snapshot);
        }

        // 5. Xây dựng URL chứa chính xác tham số phiên, audioTime và muted
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.delete('state');
        targetUrl.hash = '';
        targetUrl.searchParams.set('popout', '1');
        targetUrl.searchParams.set('session', snapshot.syncSessionId);
        targetUrl.searchParams.set('audioTime', currentAudioTime);
        targetUrl.searchParams.set('muted', isMuted ? '1' : '0');

        const scrWidth = (window.screen && window.screen.availWidth) || window.innerWidth || 1280;
        const scrHeight = (window.screen && window.screen.availHeight) || window.innerHeight || 800;
        const width = Math.min(1240, scrWidth - 40);
        const height = Math.min(760, scrHeight - 60);
        const left = Math.max(0, Math.floor((scrWidth - width) / 2));
        const top = Math.max(0, Math.floor((scrHeight - height) / 2));
        const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

        let child = null;

        // Strategy 1: Cửa sổ Popup độc lập với kích thước tối ưu
        try {
            child = window.open(targetUrl.toString(), 'HSK3_Standalone_Game', windowFeatures);
        } catch (err) {
            console.warn("[Popout] Strategy 1 failed:", err);
        }

        // Strategy 2: Cửa sổ có tên không kèm features
        if (!child || child.closed || typeof child.closed === 'undefined') {
            try {
                child = window.open(targetUrl.toString(), 'HSK3_Standalone_Game');
            } catch (err) {
                console.warn("[Popout] Strategy 2 failed:", err);
            }
        }

        // Strategy 3: Tab mới tiêu chuẩn (_blank)
        if (!child || child.closed || typeof child.closed === 'undefined') {
            try {
                child = window.open(targetUrl.toString(), '_blank');
            } catch (err) {
                console.warn("[Popout] Strategy 3 failed:", err);
            }
        }

        // Strategy 4: Anchor Click Fallback (Vượt qua iframe sandbox nghiêm ngặt nhất)
        if (!child || child.closed || typeof child.closed === 'undefined') {
            try {
                const a = document.createElement('a');
                a.href = targetUrl.toString();
                a.target = '_blank';
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                child = true;
            } catch (err) {
                console.warn("[Popout] Strategy 4 failed:", err);
            }
        }

        if (child) {
            if (child !== true) {
                childWin = child;
                try { child.focus(); } catch (err) {}
            }

            if (window.LMSAdapter && window.LMSAdapter.showToast) {
                window.LMSAdapter.showToast("🚀 Đang chơi tại cửa sổ mới! Màn hình LMS tạm dừng và chờ đồng bộ.");
            }

            if (popoutPollInterval) {
                clearInterval(popoutPollInterval);
                popoutPollInterval = null;
            }

            lastChildMessageTime = Date.now();

            // Safe poller với Heartbeat Guard
            if (popoutPollInterval) {
                clearInterval(popoutPollInterval);
                popoutPollInterval = null;
            }

            setTimeout(() => {
                popoutPollInterval = setInterval(() => {
                    let isClosed = false;
                    try {
                        isClosed = !childWin || childWin.closed;
                    } catch (err) {
                        isClosed = false;
                    }

                    // Tự động khôi phục nếu child đã đóng hoặc không còn gửi heartbeat quá 2.5 giây
                    const noHeartbeat = (Date.now() - lastChildMessageTime > 2500);

                    if (isClosed || noHeartbeat) {
                        clearInterval(popoutPollInterval);
                        popoutPollInterval = null;
                        childWin = null;
                        resumeInLmsWindow(false);
                    }
                }, 600);
            }, 1000);
        } else {
            if (overlay) {
                overlay.classList.remove('show');
                overlay.classList.remove('active');
                overlay.style.display = 'none';
            }
            if (!isMuted && bgMusic && bgMusic.paused) {
                window.safePlayAudio ? window.safePlayAudio(bgMusic) : bgMusic.play().catch(() => {});
            }
            if (window.LMSAdapter && window.LMSAdapter.showToast) {
                window.LMSAdapter.showToast("⚠️ Vui lòng cho phép popup trên trình duyệt của bạn!");
            }
        }
    }

    function focusChildWindow() {
        if (window.LMSAdapter) window.LMSAdapter.playSynthesizedSound('tap');
        let isAlive = false;
        if (childWin) {
            try { isAlive = !childWin.closed; } catch (e) { isAlive = false; }
        }
        if (isAlive) {
            try { childWin.focus(); return; } catch (e) {}
        }
        openGameInNewWindow();
    }

    /**
     * Khôi phục chơi tiếp tục tại màn hình LMS
     */
    function resumeInLmsWindow(forceCloseChild = false) {
        if (window.LMSAdapter) window.LMSAdapter.playSynthesizedSound('tap');
        if (popoutPollInterval) {
            clearInterval(popoutPollInterval);
            popoutPollInterval = null;
        }

        if (childWin) {
            try {
                if (!childWin.closed) childWin.close();
            } catch (e) {}
            childWin = null;
        }

        const overlay = document.getElementById('sync-active-modal') || document.getElementById('popup-sync-overlay');
        if (overlay) {
            overlay.classList.remove('show');
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        let stateToApply = window.__HSK3_LATEST_STATE__ || latestSyncedState;
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    if (!stateToApply || (parsed.timestamp && parsed.timestamp > (stateToApply.timestamp || 0))) {
                        stateToApply = parsed;
                    }
                }
            }
        } catch (e) {}

        // Nếu Child đang ở game.html nhưng Host hiện đang ở index.html: điều hướng host sang game.html
        if (stateToApply && stateToApply.page === 'game.html' && !window.location.pathname.includes('game.html')) {
            if (window.LMSAdapter && window.LMSAdapter.markInternalNavigation) {
                window.LMSAdapter.markInternalNavigation();
            }
            try {
                sessionStorage.setItem('hsk3_resume_state', JSON.stringify(stateToApply));
            } catch (e) {}
            const param = stateToApply.currentLessonParam || `chude${(stateToApply.currentLesson || 0) + 1}`;
            window.location.href = `game.html?${param}&resume_sync=1`;
            return;
        }

        if (stateToApply) {
            applyGameStateSnapshot(stateToApply);
            if (window.LMSAdapter && window.LMSAdapter.showToast) {
                window.LMSAdapter.showToast("🎮 Đã đồng bộ tiến trình! Tiếp tục chơi trên màn hình LMS.");
            }
        } else {
            const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
            const isMuted = window.gameAudio ? window.gameAudio.isMuted : false;
            if (!isMuted && bgMusic && bgMusic.paused) {
                window.safePlayAudio ? window.safePlayAudio(bgMusic) : bgMusic.play().catch(() => {});
            }
            if (gameHandlers && typeof gameHandlers.onPopupClosed === 'function') {
                gameHandlers.onPopupClosed();
            }
        }

        // Báo cho child (nếu còn) là host đã resume
        if (childWin && !childWin.closed) {
            try { childWin.postMessage({ type: 'HSK3_HOST_RESUMED' }, '*'); } catch (e) {}
        }
        if (syncChannel) {
            try { syncChannel.postMessage({ type: 'HSK3_HOST_RESUMED' }); } catch (e) {}
        }
    }

    /**
     * Đóng Cửa Sổ Mới và quay về màn hình LMS
     */
    function closePopoutAndReturnToLMS() {
        const finalSnapshot = getGameStateSnapshot();
        finalSnapshot.isPopoutClosing = true;

        // 1. Gọi trực tiếp vào Host opener nếu cùng origin để khôi phục ngay lập tức
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.__HSK3_LATEST_STATE__ = finalSnapshot;
                if (typeof window.opener.resumeInLmsWindow === 'function') {
                    window.opener.resumeInLmsWindow(false);
                }
            } catch (e) {
                console.warn("[Popout] Direct opener resume note:", e);
            }
        }

        // 2. Phát tán trạng thái snapshot qua postMessage & BroadcastChannel
        saveAndBroadcastState(finalSnapshot, true);

        // 3. Phát tín hiệu audio sync lần cuối
        if (window.gameAudio) {
            window.gameAudio.broadcastAudioSync();
        }

        if (window.opener && !window.opener.closed) {
            try { window.opener.focus(); } catch (e) {}
        }

        // 4. Delay nhỏ để trình duyệt kịp đẩy IPC postMessage trước khi đóng
        setTimeout(() => {
            window.close();
        }, 120);
    }

    // Thiết lập giao diện cho Cửa Sổ Mới
    if (isPopout) {
        // Heartbeat liên tục mỗi 1 giây
        setInterval(() => {
            const hb = { type: 'HSK3_HEARTBEAT', timestamp: Date.now() };
            if (syncChannel) {
                try { syncChannel.postMessage(hb); } catch (e) {}
            }
            if (window.opener && !window.opener.closed) {
                try { window.opener.postMessage(hb, '*'); } catch (e) {}
            }
        }, 1000);

        const setupPopoutBtn = () => {
            const popBtn = document.getElementById('popout-btn');
            if (popBtn) {
                popBtn.title = "Quay về màn hình LMS (Đóng cửa sổ này)";
                popBtn.setAttribute('aria-label', "Quay về màn hình LMS");
                popBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                        <polyline points="9 14 4 9 9 4"></polyline>
                        <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                    </svg>
                `;
                popBtn.onclick = function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    closePopoutAndReturnToLMS();
                };
            }

            // Đồng thời đổi các nút .lms-window-btn thành nút quay về
            document.querySelectorAll('.lms-window-btn').forEach(btn => {
                btn.title = "Quay về màn hình LMS";
                btn.innerHTML = `<span class="btn-icon">↩</span><span class="btn-text">Về LMS</span>`;
                btn.onclick = function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    closePopoutAndReturnToLMS();
                };
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupPopoutBtn);
        } else {
            setupPopoutBtn();
        }

        const handleUnload = () => {
            const finalSnapshot = getGameStateSnapshot();
            finalSnapshot.isPopoutClosing = true;

            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.__HSK3_LATEST_STATE__ = finalSnapshot;
                    if (typeof window.opener.resumeInLmsWindow === 'function') {
                        window.opener.resumeInLmsWindow(false);
                    }
                } catch (e) {}
                try {
                    window.opener.postMessage({ type: 'HSK3_POPOUT_CLOSED', state: finalSnapshot, timestamp: Date.now() }, '*');
                } catch (e) {}
            }

            saveAndBroadcastState(finalSnapshot, true);
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload);
    } else {
        const setupHostBtns = () => {
            const popBtn = document.getElementById('popout-btn');
            if (popBtn) {
                popBtn.title = "Mở ở cửa sổ mới (Đồng bộ tiến trình)";
                popBtn.setAttribute('aria-label', "Mở ở cửa sổ mới");
                popBtn.onclick = function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    openGameInNewWindow(e);
                };
            }

            document.querySelectorAll('.lms-window-btn').forEach(btn => {
                btn.onclick = function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    openGameInNewWindow(e);
                };
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupHostBtns);
        } else {
            setupHostBtns();
        }

        // Tự động kiểm tra và khôi phục khi người dùng chuyển lại tab/cửa sổ LMS
        window.addEventListener('focus', () => {
            if (!isPopout && childWin) {
                let isClosed = false;
                try { isClosed = !childWin || childWin.closed; } catch (e) { isClosed = false; }
                if (isClosed || (Date.now() - lastChildMessageTime > 2000)) {
                    resumeInLmsWindow(false);
                }
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !isPopout && childWin) {
                let isClosed = false;
                try { isClosed = !childWin || childWin.closed; } catch (e) { isClosed = false; }
                if (isClosed || (Date.now() - lastChildMessageTime > 2000)) {
                    resumeInLmsWindow(false);
                }
            }
        });
    }

    const SyncManager = {
        isPopup: isPopout,
        isPopout: isPopout,
        get childWin() { return childWin; },
        set childWin(val) { childWin = val; },

        hasActiveChild() {
            if (isPopout) return false;
            if (!childWin) return false;
            let isClosed = false;
            try { isClosed = childWin.closed; } catch (e) { isClosed = false; }
            if (isClosed) return false;
            return (Date.now() - lastChildMessageTime < 3000);
        },

        registerGame(handlers) {
            gameHandlers = handlers;
            if (initialSyncedState) {
                applyGameStateSnapshot(initialSyncedState);
            }
        },

        notifyChange() {
            saveAndBroadcastState();
        },

        openPopup() {
            openGameInNewWindow();
        },

        resumeInHost() {
            resumeInLmsWindow(true);
        },

        showHostOverlay() {
            const overlay = document.getElementById('sync-active-modal') || document.getElementById('popup-sync-overlay');
            if (overlay) {
                overlay.classList.add('show');
                overlay.classList.add('active');
                overlay.style.display = 'flex';
            }
        },

        hideHostOverlay() {
            const overlay = document.getElementById('sync-active-modal') || document.getElementById('popup-sync-overlay');
            if (overlay) {
                overlay.classList.remove('show');
                overlay.classList.remove('active');
                overlay.style.display = 'none';
            }
        },

        saveState(state) {
            saveAndBroadcastState(state);
        },

        loadSavedState() {
            try {
                const raw = storage.getItem(STORAGE_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) {}
            return latestSyncedState;
        }
    };

    window.SyncManager = SyncManager;
    window.openGameInNewWindow = openGameInNewWindow;
    window._fullOpenGameInNewWindow = openGameInNewWindow;
    window.openStandaloneWindow = openGameInNewWindow;
    window.focusChildWindow = focusChildWindow;
    window.resumeInLmsWindow = resumeInLmsWindow;
    window.closePopoutAndReturnToLMS = closePopoutAndReturnToLMS;

})(window);
