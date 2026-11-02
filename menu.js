document.addEventListener('DOMContentLoaded', () => {
    const screens = {
        splash: document.getElementById('splash'),
        lessons: document.getElementById('lesson-selection')
    };

    const lessonGrid = document.querySelector('.lesson-grid');

    function showScreen(screenId) {
        Object.values(screens).forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screens[screenId]) screens[screenId].classList.add('active');
    }

    function init() {
        // Build lesson selection grid
        if (typeof hsk3Data !== 'undefined') {
            let currentBaseChude = 0;
            let lastBaseTheme = "";

            hsk3Data.forEach((item, index) => {
                let themeName = item.theme;
                let urlParam = "";
                
                // Check if it's a part: "Name (Phần X)"
                const partMatch = themeName.match(/(.*)\s*\(Phần (\d+)\)/);
                if (partMatch) {
                    const baseName = partMatch[1].trim();
                    const partNum = partMatch[2];
                    
                    if (baseName !== lastBaseTheme) {
                        currentBaseChude++;
                        lastBaseTheme = baseName;
                    }
                    urlParam = `chude${currentBaseChude}_phan${partNum}`;
                } else {
                    currentBaseChude++;
                    lastBaseTheme = themeName;
                    urlParam = `chude${currentBaseChude}`;
                }

                const card = document.createElement('div');
                card.className = 'lesson-card';
                card.innerHTML = `
                    <div class="num">Chủ đề ${currentBaseChude}${partMatch ? ' - P' + partMatch[2] : ''}</div>
                    <div class="title">${themeName}</div>
                `;
                card.onclick = () => {
                    if (window.LMSAdapter) {
                        window.LMSAdapter.playSynthesizedSound('select');
                    }
                    if (window.LMSAdapter && window.LMSAdapter.markInternalNavigation) {
                        window.LMSAdapter.markInternalNavigation();
                    }

                    let targetUrl = `game.html?${urlParam}`;
                    const params = new URLSearchParams(window.location.search);
                    const isPop = params.get('popout') === '1' || params.get('popup') === '1' || (window.SyncManager && window.SyncManager.isPopup);
                    if (isPop) {
                        targetUrl += '&popout=1';
                    }

                    // Kế thừa chính xác currentTime và mute state khi chuyển từ menu sang game
                    if (window.bgMusic) {
                        targetUrl += `&audioTime=${Number(window.bgMusic.currentTime.toFixed(2))}`;
                    }
                    if (window.gameAudio) {
                        targetUrl += `&muted=${window.gameAudio.isMuted ? '1' : '0'}`;
                    }

                    window.location.href = targetUrl;
                };
                lessonGrid.appendChild(card);
            });
        }

        // Event Listeners
        document.getElementById('start-btn').onclick = () => {
            if (window.LMSAdapter) window.LMSAdapter.playSynthesizedSound('click');
            showScreen('lessons');
            if (window.SyncManager) window.SyncManager.notifyChange();
        };
        
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => {
                if (window.LMSAdapter) window.LMSAdapter.playSynthesizedSound('tap');
                if (screens.lessons && screens.lessons.classList.contains('active')) {
                    showScreen('splash');
                    if (window.SyncManager) window.SyncManager.notifyChange();
                }
            };
        });

        // Register with SyncManager for 2-way real-time sync
        if (window.SyncManager) {
            window.SyncManager.registerGame({
                getState: () => ({
                    page: 'index.html',
                    activeScreen: (screens.lessons && screens.lessons.classList.contains('active')) ? 'lessons' : 'splash',
                    topicName: 'Đang chọn chủ đề'
                }),
                applyState: (state) => {
                    if (!state) return;
                    if (state.activeScreen === 'lessons') {
                        showScreen('lessons');
                    } else {
                        showScreen('splash');
                    }
                }
            });
        }
    }

    init();
});
