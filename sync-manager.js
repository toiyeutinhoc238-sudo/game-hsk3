/**
 * SyncManager - Hệ thống đồng bộ 2 chiều thời gian thực giữa màn hình LMS và Cửa sổ mới (Popup)
 * 
 * Tính năng:
 * - Khi mở cửa sổ mới từ LMS: Cửa sổ mới kế thừa chính xác 100% khoảnh khắc đang chơi (điểm, lượt, ô đã mở, vị trí bình độc, thời gian timer).
 * - Trong khi chơi ở cửa sổ mới: Mọi tương tác được đồng bộ liên tục qua BroadcastChannel, localStorage và postMessage.
 * - Khi tắt cửa sổ mới (bấm dấu X hoặc đóng tab): Màn hình LMS tự động quay về khoảnh khắc đang chơi đó và tiếp tục liền mạch.
 * - Nếu bấm "Tiếp tục tại màn hình này" trên LMS: Tự động khôi phục và tiếp tục trực tiếp tại LMS.
 */
(function (window) {
    'use strict';

    const STORAGE_KEY = 'HSK3_SYNC_GAME_STATE';
    const POPUP_ACTIVE_KEY = 'HSK3_POPUP_IS_OPEN';
    const CHANNEL_NAME = 'hsk3_game_sync_channel';

    let isPopup = false;
    let popupRef = null;
    let pollInterval = null;
    let broadcastChannel = null;
    let gameHandlers = null;
    let latestState = null;

    // Kiểm tra xem trang hiện tại có đang chạy dưới dạng Cửa sổ mới (Popup) hay không
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('popup') === '1' || window.name === 'HSK3_GAME_POPUP') {
        isPopup = true;
    }

    // Khởi tạo BroadcastChannel nếu trình duyệt hỗ trợ
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
        }
    } catch (e) {
        console.warn('[SyncManager] BroadcastChannel không khả dụng:', e);
    }

    const SyncManager = {
        isPopup: isPopup,

        /**
         * Đăng ký bộ xử lý trạng thái từ game.js hoặc menu.js
         */
        registerGame(handlers) {
            gameHandlers = handlers;

            // Nếu đây là Cửa sổ mới, khôi phục trạng thái ban đầu ngay khi sẵn sàng
            if (isPopup) {
                this.initAsPopup();
            } else {
                this.initAsHost();

                // Kiểm tra xem host có vừa được điều hướng tới đây khi popup đóng không
                try {
                    if (sessionStorage.getItem('HSK3_JUST_CLOSED_POPUP') === 'true') {
                        sessionStorage.removeItem('HSK3_JUST_CLOSED_POPUP');
                        const pendingState = this.loadSavedState();
                        if (pendingState && gameHandlers && typeof gameHandlers.applyState === 'function') {
                            setTimeout(() => {
                                gameHandlers.applyState(pendingState);
                                this.showToast('✨ Đã tiếp tục trò chơi từ cửa sổ mới!');
                            }, 100);
                        }
                    }
                } catch (e) {}
            }
        },

        /**
         * Lưu trạng thái an toàn (kết hợp localStorage & LMSAdapter)
         */
        saveState(state) {
            if (!state) return;
            state.timestamp = Date.now();
            latestState = state;

            const stateStr = JSON.stringify(state);
            try {
                if (window.LMSAdapter) {
                    window.LMSAdapter.setStorage(STORAGE_KEY, stateStr);
                } else if (window.localStorage) {
                    window.localStorage.setItem(STORAGE_KEY, stateStr);
                }
            } catch (e) {
                // Ignore storage quota or sandbox restrictions
            }
        },

        /**
         * Đọc trạng thái đã lưu
         */
        loadSavedState() {
            try {
                let stateStr = null;
                if (window.LMSAdapter) {
                    stateStr = window.LMSAdapter.getStorage(STORAGE_KEY, null);
                } else if (window.localStorage) {
                    stateStr = window.localStorage.getItem(STORAGE_KEY);
                }
                if (stateStr) {
                    return JSON.parse(stateStr);
                }
            } catch (e) {
                console.warn('[SyncManager] Không thể đọc state từ storage:', e);
            }
            return latestState;
        },

        /**
         * Phát tán thay đổi trạng thái tới các cửa sổ khác
         */
        broadcastState(state) {
            if (!state) return;
            this.saveState(state);

            const msg = {
                type: 'STATE_UPDATE',
                state: state,
                isFromPopup: isPopup,
                timestamp: Date.now()
            };

            // 1. BroadcastChannel (Cùng origin, đa tab/cửa sổ)
            if (broadcastChannel) {
                try {
                    broadcastChannel.postMessage(msg);
                } catch (e) {}
            }

            // 2. postMessage trực tiếp qua window.opener hoặc popupRef
            try {
                if (isPopup && window.opener && !window.opener.closed) {
                    window.opener.postMessage(msg, '*');
                } else if (!isPopup && popupRef && !popupRef.closed) {
                    popupRef.postMessage(msg, '*');
                }
            } catch (e) {}
        },

        /**
         * Thông báo trạng thái game vừa thay đổi (gọi từ game.js khi click, chuyển lượt, v.v.)
         */
        notifyChange() {
            if (!gameHandlers || typeof gameHandlers.getState !== 'function') return;
            const currentState = gameHandlers.getState();
            this.broadcastState(currentState);
        },

        /**
         * Khởi tạo dành cho CỬA SỔ MỚI (Popup Window)
         */
        initAsPopup() {
            console.log('[SyncManager] Đang chạy ở chế độ Cửa Sổ Mới (Popup)');

            // Ẩn tất cả nút "Mở cửa sổ mới" trên cửa sổ popup để tránh mở lồng nhau
            document.querySelectorAll('.lms-window-btn').forEach(btn => {
                btn.style.display = 'none';
            });

            // Lấy state ban đầu để tiếp tục
            const initialState = this.loadSavedState();
            if (initialState && gameHandlers && typeof gameHandlers.applyState === 'function') {
                console.log('[SyncManager] Khôi phục trạng thái ban đầu cho cửa sổ mới:', initialState);
                gameHandlers.applyState(initialState);
            }

            // Gửi tín hiệu sẵn sàng tới opener
            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage({
                        type: 'POPUP_READY',
                        timestamp: Date.now()
                    }, '*');
                } catch (e) {}
            }

            // Lắng nghe khi popup chuẩn bị đóng (X hoặc Alt+F4 hoặc tab close)
            const handleClosing = () => {
                if (gameHandlers && typeof gameHandlers.getState === 'function') {
                    const finalState = gameHandlers.getState();
                    this.saveState(finalState);
                    const msg = {
                        type: 'POPUP_CLOSING',
                        state: finalState,
                        timestamp: Date.now()
                    };
                    if (broadcastChannel) {
                        try { broadcastChannel.postMessage(msg); } catch (e) {}
                    }
                    if (window.opener && !window.opener.closed) {
                        try { window.opener.postMessage(msg, '*'); } catch (e) {}
                    }
                }
                try {
                    if (window.localStorage) {
                        window.localStorage.setItem(POPUP_ACTIVE_KEY, 'false');
                    }
                } catch (e) {}
            };

            window.addEventListener('beforeunload', handleClosing);
            window.addEventListener('pagehide', handleClosing);
            window.addEventListener('unload', handleClosing);

            // Đổi tiêu đề tab cho rõ ràng
            document.title = "✦ [Cửa Sổ Riêng] " + document.title;
        },

        /**
         * Khởi tạo dành cho MÀN HÌNH LMS (Host Window)
         */
        initAsHost() {
            // Lắng nghe tin nhắn từ BroadcastChannel
            if (broadcastChannel) {
                broadcastChannel.onmessage = (event) => {
                    this.handleIncomingMessage(event.data);
                };
            }

            // Lắng nghe postMessage từ cửa sổ con
            window.addEventListener('message', (event) => {
                if (event.data && typeof event.data === 'object' && event.data.type) {
                    this.handleIncomingMessage(event.data);
                }
            });

            // Lắng nghe storage event (trường hợp tab khác cập nhật localStorage)
            window.addEventListener('storage', (event) => {
                if (event.key === STORAGE_KEY && event.newValue) {
                    try {
                        const parsed = JSON.parse(event.newValue);
                        this.handleIncomingMessage({
                            type: 'STATE_UPDATE',
                            state: parsed,
                            isFromPopup: true
                        });
                    } catch (e) {}
                }
            });

            // Gắn sự kiện cho các nút "Cửa sổ mới"
            document.querySelectorAll('.lms-window-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openPopup();
                };
            });

            // Gắn sự kiện cho các nút trong modal đồng bộ trên LMS
            const resumeBtn = document.getElementById('resume-here-btn');
            if (resumeBtn) {
                resumeBtn.onclick = () => {
                    this.resumeInHost();
                };
            }

            const focusBtn = document.getElementById('focus-popup-btn');
            if (focusBtn) {
                focusBtn.onclick = () => {
                    if (popupRef && !popupRef.closed) {
                        popupRef.focus();
                    } else {
                        this.openPopup();
                    }
                };
            }
        },

        /**
         * Xử lý tin nhắn gửi tới Host từ Popup
         */
        handleIncomingMessage(data) {
            if (!data) return;

            if (data.type === 'STATE_UPDATE' && data.state) {
                latestState = data.state;
                // Nếu cửa sổ này đang hiển thị overlay (chờ popup), cập nhật state ngầm
                // để khi popup đóng sẽ áp dụng ngay
            } else if (data.type === 'POPUP_CLOSING') {
                if (data.state) latestState = data.state;
                this.onPopupClosed();
            }
        },

        /**
         * Mở Cửa Sổ Mới từ LMS
         */
        openPopup() {
            // 1. Lấy trạng thái hiện tại từ game hoặc menu
            let currentState = null;
            if (gameHandlers && typeof gameHandlers.getState === 'function') {
                currentState = gameHandlers.getState();
            }

            if (currentState) {
                this.saveState(currentState);
            }

            // 2. Xây dựng URL mở popup (giữ nguyên query params và thêm popup=1)
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('popup', '1');

            // 3. Tính toán kích thước & vị trí cửa sổ mới (khoảng 85% màn hình)
            const width = Math.min(1180, Math.floor(window.screen.availWidth * 0.92));
            const height = Math.min(820, Math.floor(window.screen.availHeight * 0.92));
            const left = Math.max(0, Math.floor((window.screen.availWidth - width) / 2));
            const top = Math.max(0, Math.floor((window.screen.availHeight - height) / 2));

            const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=no`;

            // Nếu popup đã mở trước đó và chưa đóng, chỉ cần focus
            if (popupRef && !popupRef.closed) {
                popupRef.focus();
                this.showHostOverlay();
                return;
            }

            popupRef = window.open(currentUrl.toString(), 'HSK3_GAME_POPUP', windowFeatures);

            if (!popupRef || popupRef.closed || typeof popupRef.closed === 'undefined') {
                alert('Trình duyệt đang chặn mở cửa sổ mới! Vui lòng bấm vào biểu tượng Cho phép Pop-up trên thanh địa chỉ của trình duyệt.');
                return;
            }

            try {
                if (window.localStorage) {
                    window.localStorage.setItem(POPUP_ACTIVE_KEY, 'true');
                }
            } catch (e) {}

            // Thông báo tới gameHandlers tạm dừng âm thanh / timer bên LMS
            if (gameHandlers && typeof gameHandlers.onPopupOpened === 'function') {
                gameHandlers.onPopupOpened();
            }

            // Hiển thị overlay thông báo trên màn hình LMS
            this.showHostOverlay();

            // Khởi động vòng lặp kiểm tra xem popup có bị người dùng đóng qua dấu X không
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(() => {
                if (!popupRef || popupRef.closed) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    this.onPopupClosed();
                }
            }, 400);
        },

        /**
         * Hiển thị overlay trên màn hình LMS khi Cửa Sổ Mới đang hoạt động
         */
        showHostOverlay() {
            const overlay = document.getElementById('popup-sync-overlay');
            if (overlay) {
                overlay.classList.add('active');
            }
        },

        /**
         * Ẩn overlay trên màn hình LMS
         */
        hideHostOverlay() {
            const overlay = document.getElementById('popup-sync-overlay');
            if (overlay) {
                overlay.classList.remove('active');
            }
        },

        /**
         * Xử lý khi Cửa Sổ Mới đóng -> Quay lại khoảnh khắc đang chơi trên màn hình LMS
         */
        onPopupClosed() {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            popupRef = null;

            try {
                if (window.localStorage) {
                    window.localStorage.setItem(POPUP_ACTIVE_KEY, 'false');
                }
            } catch (e) {}

            this.hideHostOverlay();

            // Đọc lại trạng thái mới nhất đạt được từ cửa sổ mới
            const stateToRestore = this.loadSavedState() || latestState;

            if (stateToRestore) {
                // Nếu popup đang ở game.html nhưng host hiện tại đang ở index.html:
                if (stateToRestore.page === 'game.html' && window.location.pathname.indexOf('game.html') === -1) {
                    try {
                        sessionStorage.setItem('HSK3_JUST_CLOSED_POPUP', 'true');
                    } catch (e) {}
                    const param = stateToRestore.currentLessonParam || `chude${(stateToRestore.currentLesson || 0) + 1}`;
                    window.location.href = `game.html?${param}`;
                    return;
                }

                if (gameHandlers && typeof gameHandlers.applyState === 'function') {
                    console.log('[SyncManager] Khôi phục trạng thái mới nhất về màn hình LMS:', stateToRestore);
                    gameHandlers.applyState(stateToRestore);
                }
            }

            if (gameHandlers && typeof gameHandlers.onPopupClosed === 'function') {
                gameHandlers.onPopupClosed();
            }

            this.showToast('✨ Đã tiếp tục trò chơi từ cửa sổ mới!');
        },

        /**
         * Người dùng bấm nút "Tiếp tục tại màn hình này" trên LMS
         */
        resumeInHost() {
            if (popupRef && !popupRef.closed) {
                try {
                    popupRef.close();
                } catch (e) {}
            }
            this.onPopupClosed();
        },

        /**
         * Hiển thị thông báo nhỏ gọn (Toast)
         */
        showToast(message) {
            let toast = document.getElementById('sync-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'sync-toast';
                toast.className = 'sync-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 2500);
        }
    };

    window.SyncManager = SyncManager;

})(window);
