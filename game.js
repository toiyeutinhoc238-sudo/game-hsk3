document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let currentLesson = 0;
    let currentLessonParam = "";
    let teamCount = 2;
    let scores = [0, 0, 0, 0];
    let currentTurn = 0;
    let poisonIndices = [];
    let revealedIndices = new Set();
    let eliminatedTeams = new Set();
    let isGameOver = false;
    let stage = 'POISONING'; // 'POISONING', 'PLAYING'
    let mode = 'AI'; // 'AI', 'TEACHER'
    let poisoningTeamIndex = 0;
    let timerInterval = null;
    let timeLeft = 0;
    let isProcessing = false;
    let lastPoisonTime = 0;
    let cooldownInterval = null;
    let currentSessionWords = [];

    // --- DOM Elements ---
    const screens = {
        teams: document.getElementById('team-selection'),
        game: document.getElementById('game-screen')
    };

    const wordGrid = document.getElementById('word-grid');
    const teamsSidebar = document.getElementById('teams-sidebar');
    const phaseIndicator = document.getElementById('phase-indicator');
    const startPhaseBtn = document.getElementById('start-phase-btn');

    let currentLessonDisplay = "";
    
    // --- Sounds ---
    const sounds = {
        correct: new Audio('https://assets.mixkit.co/active_storage/sfx/2016/2016-preview.mp3'),
        wrong: new Audio('https://assets.mixkit.co/active_storage/sfx/172/172-preview.mp3'),
        magic: new Audio('https://assets.mixkit.co/active_storage/sfx/2026/2026-preview.mp3'),
        win: new Audio('nhac_nen/chienthang.mp3')
    };

    function playSound(type) {
        if (sounds[type]) {
            sounds[type].currentTime = 0;
            const promise = sounds[type].play();
            if (promise !== undefined) {
                promise.catch(() => {
                    // Fallback to Web Audio API synthesizer for LMS intranet / firewalled schools
                    if (window.LMSAdapter) {
                        if (type === 'correct') window.LMSAdapter.playChime();
                        else if (type === 'wrong') window.LMSAdapter.playBuzz();
                        else if (type === 'magic') window.LMSAdapter.playMagic();
                    }
                });
            }
        } else if (window.LMSAdapter) {
            if (type === 'correct') window.LMSAdapter.playChime();
            else if (type === 'wrong') window.LMSAdapter.playBuzz();
            else if (type === 'magic') window.LMSAdapter.playMagic();
        }
    }

    function showScreen(screenId) {
        Object.values(screens).forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screens[screenId]) screens[screenId].classList.add('active');
    }

    function init() {
        // Read theme from URL
        const params = new URLSearchParams(window.location.search);
        let targetIndex = -1;

        // Find key starting with 'chude'
        const paramKey = Array.from(params.keys()).find(k => k.startsWith('chude'));

        if (paramKey) {
            let currentBaseChude = 0;
            let lastBaseTheme = "";
            
            for (let i = 0; i < hsk3Data.length; i++) {
                const themeName = hsk3Data[i].theme;
                const partMatch = themeName.match(/(.*)\s*\(Phần (\d+)\)/);
                let currentKey = "";
                let currentDisplay = "";
                
                if (partMatch) {
                    const baseName = partMatch[1].trim();
                    const partNum = partMatch[2];
                    if (baseName !== lastBaseTheme) {
                        currentBaseChude++;
                        lastBaseTheme = baseName;
                    }
                    currentKey = `chude${currentBaseChude}_phan${partNum}`;
                    currentDisplay = `Chủ đề ${currentBaseChude} - P${partNum}`;
                } else {
                    currentBaseChude++;
                    lastBaseTheme = themeName;
                    currentKey = `chude${currentBaseChude}`;
                    currentDisplay = `Chủ đề ${currentBaseChude}`;
                }
                
                if (currentKey === paramKey) {
                    targetIndex = i;
                    currentLessonDisplay = currentDisplay;
                    currentLessonParam = currentKey;
                    break;
                }
            }
        }

        // Fallback for theme=N format or legacy chudeN
        if (targetIndex === -1) {
            const themeVal = parseInt(params.get('theme'));
            if (!isNaN(themeVal)) {
                targetIndex = themeVal - 1;
                currentLessonDisplay = `Chủ đề ${themeVal}`;
                currentLessonParam = `theme=${themeVal}`;
            } else if (paramKey) {
                const match = paramKey.match(/chude(\d+)(_phan(\d+))?/);
                if (match) {
                    const chudeNum = match[1];
                    const phanNum = match[3];
                    targetIndex = parseInt(chudeNum) - 1;
                    currentLessonDisplay = `Chủ đề ${chudeNum}${phanNum ? ' - P' + phanNum : ''}`;
                    currentLessonParam = paramKey;
                } else {
                    targetIndex = parseInt(paramKey.replace('chude', '')) - 1;
                    currentLessonDisplay = `Chủ đề ${targetIndex + 1}`;
                    currentLessonParam = paramKey;
                }
            }
        }

        if (targetIndex === -1 || targetIndex >= hsk3Data.length) {
            window.location.href = 'index.html';
            return;
        }

        currentLesson = targetIndex; 
        if (!currentLessonParam) {
            currentLessonParam = `chude${currentLesson + 1}`;
        }
        showScreen('teams');

        // Show Instructions automatically on game start (trừ khi đang chạy ở chế độ Cửa Sổ Mới Popup)
        const instructionModal = document.getElementById('how-to-play-modal');
        if (instructionModal) {
            if (window.SyncManager && window.SyncManager.isPopup) {
                instructionModal.classList.remove('active');
            } else {
                instructionModal.classList.add('active');
                document.getElementById('close-how-to-btn').onclick = () => {
                    instructionModal.classList.remove('active');
                };
            }
        }

        // Event Listeners
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => {
                if (screens.game && screens.game.classList.contains('active')) {
                    showScreen('teams');
                    if (window.SyncManager) window.SyncManager.notifyChange();
                } else {
                    let targetUrl = 'index.html';
                    const p = new URLSearchParams(window.location.search);
                    const isPop = p.get('popout') === '1' || p.get('popup') === '1' || (window.SyncManager && window.SyncManager.isPopup);
                    if (isPop) targetUrl += '?popout=1';
                    if (window.bgMusic) {
                        targetUrl += (targetUrl.includes('?') ? '&' : '?') + `audioTime=${Number(window.bgMusic.currentTime.toFixed(2))}`;
                    }
                    if (window.gameAudio) {
                        targetUrl += `&muted=${window.gameAudio.isMuted ? '1' : '0'}`;
                    }
                    if (window.LMSAdapter && window.LMSAdapter.markInternalNavigation) {
                        window.LMSAdapter.markInternalNavigation();
                    }
                    window.location.href = targetUrl;
                }
            };
        });

        document.querySelectorAll('.team-btn').forEach(btn => {
            btn.onclick = () => {
                teamCount = parseInt(btn.dataset.teams);
                initGame();
                showScreen('game');
                if (window.SyncManager) window.SyncManager.notifyChange();
            };
        });

        document.getElementById('start-phase-btn').onclick = startPlaying;
        const resetBtn = document.getElementById('reset-game-btn');
        if (resetBtn) resetBtn.onclick = initGame;
        
        const exitBtn = document.getElementById('exit-btn');
        if (exitBtn) exitBtn.onclick = () => window.location.href = 'index.html';
        if (document.getElementById('main-menu-btn')) {
            document.getElementById('main-menu-btn').onclick = () => window.location.href = 'index.html';
        }
        document.getElementById('play-again-btn').onclick = () => {
            document.getElementById('result-modal').classList.remove('active');
            initGame();
        };
        document.getElementById('modal-close').onclick = () => {
            document.getElementById('modal-overlay').classList.remove('active');
        };

        // Đăng ký hệ thống đồng bộ 2 chiều thời gian thực
        if (window.SyncManager) {
            window.SyncManager.registerGame({
                getState: getGameState,
                applyState: applyGameState,
                onPopupOpened: () => {
                    stopTimer();
                    if (window.gameAudio && window.gameAudio.music) {
                        window.gameAudio.music.pause();
                    }
                },
                onPopupClosed: () => {
                    if (window.gameAudio && !window.gameAudio.isMuted) {
                        window.gameAudio.music.play().catch(() => {});
                    }
                }
            });
        }
    }

    function initGame() {
        stopTimer();
        isGameOver = false;
        if (window.gameAudio && !window.gameAudio.isMuted) {
            window.gameAudio.music.play().catch(e => console.log("Music play failed"));
        }
        stage = 'POISONING';
        scores = new Array(teamCount).fill(0);
        currentTurn = 0;
        poisoningTeamIndex = 0;
        poisonIndices = [];
        revealedIndices.clear();
        eliminatedTeams.clear();
        isProcessing = false;
        lastPoisonTime = 0;
        clearInterval(cooldownInterval);
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";
        
        const themeData = hsk3Data[currentLesson];
        document.getElementById('current-lesson-title').textContent = currentLessonDisplay;
        document.getElementById('current-lesson-name').textContent = themeData.theme;

        // Shuffle and take a subset of words if the theme is too large
        const allWords = [...themeData.words];
        const shuffled = allWords.sort(() => Math.random() - 0.5);
        currentSessionWords = shuffled.slice(0, 25);
        this.gameWords = currentSessionWords;

        renderTeams();
        renderGrid();
        
        phaseIndicator.textContent = "Nhắm mắt lại: Phù thủy đang giấu thuốc độc...";
        startPhaseBtn.classList.add('hidden');
        document.getElementById('result-modal').classList.remove('active');

        // Automatically start the poisoning phase
        startPhase('TEACHER');

        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function renderTeams() {
        teamsSidebar.innerHTML = '';
        for (let i = 0; i < teamCount; i++) {
            const card = document.createElement('div');
            card.className = `team-card t${i} ${i === currentTurn ? 'active' : ''} ${eliminatedTeams.has(i) ? 'eliminated' : ''}`;
            card.innerHTML = `
                <div class="name">Đội ${i + 1}</div>
                <div class="score" id="score-team-${i}">${scores[i]}</div>
            `;
            teamsSidebar.appendChild(card);
        }
    }

    function renderGrid() {
        wordGrid.innerHTML = '';
        const words = (currentSessionWords && currentSessionWords.length > 0) ? currentSessionWords : this.gameWords;
        if (!words) return;
        words.forEach((word, index) => {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.index = index;
            const lenClass = word.hz.length >= 3 ? 'len-3' : (word.hz.length === 2 ? 'len-2' : 'len-1');
            tile.innerHTML = `<div class="hz ${lenClass}" lang="zh-CN">${word.hz}</div>`;
            tile.onclick = () => handleTileClick(index);
            wordGrid.appendChild(tile);
        });
    }

    function startTimer(seconds, onEnd) {
        stopTimer();
        const container = document.getElementById('timer-container');
        const progressBar = document.getElementById('timer-progress');
        const valDisplay = document.getElementById('timer-val');
        
        if (!container) return;

        container.classList.remove('hidden', 'warning');
        timeLeft = seconds;
        valDisplay.textContent = timeLeft;
        progressBar.style.width = '100%';
        progressBar.style.transition = 'none';
        void progressBar.offsetWidth;
        progressBar.style.transition = 'width 1s linear';

        timerInterval = setInterval(() => {
            timeLeft--;
            valDisplay.textContent = timeLeft;
            progressBar.style.width = `${(timeLeft / seconds) * 100}%`;
            if (timeLeft <= 5) container.classList.add('warning');
            if (timeLeft <= 0) {
                stopTimer();
                if (onEnd) onEnd();
            }
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
        const container = document.getElementById('timer-container');
        if (container) container.classList.add('hidden');
    }

    function startPhase(selectedMode) {
        mode = selectedMode || 'TEACHER';
        stage = 'POISONING';
        poisonIndices = [];
        revealedIndices.clear();
        renderGrid();
        
        poisoningTeamIndex = 0;
        while(eliminatedTeams.has(poisoningTeamIndex) && poisoningTeamIndex < teamCount) {
            poisoningTeamIndex++;
        }

        updatePoisoningPhaseUI();
        startPhaseBtn.classList.remove('hidden');
        
        let nextActive = poisoningTeamIndex + 1;
        while(eliminatedTeams.has(nextActive) && nextActive < teamCount) {
            nextActive++;
        }
        startPhaseBtn.textContent = nextActive >= teamCount ? "Xong! Bắt đầu chơi" : "Tiếp tục (Đội sau)";
        startPhaseBtn.onclick = nextPoisoningTeam;
        
        stopTimer();
        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function updatePoisoningPhaseUI() {
        clearInterval(cooldownInterval);
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";
        phaseIndicator.textContent = `ĐỘI ${poisoningTeamIndex + 1}: Mở mắt chọn thuốc độc. Các đội khác nhắm mắt!`;
        document.querySelectorAll('.team-card').forEach((c, i) => {
            c.classList.toggle('active', i === poisoningTeamIndex);
        });
    }

    function nextPoisoningTeam() {
        do {
            poisoningTeamIndex++;
        } while(eliminatedTeams.has(poisoningTeamIndex) && poisoningTeamIndex < teamCount);

        if (poisoningTeamIndex < teamCount) {
            updatePoisoningPhaseUI();
            
            let nextActive = poisoningTeamIndex + 1;
            while(eliminatedTeams.has(nextActive) && nextActive < teamCount) {
                nextActive++;
            }
            startPhaseBtn.textContent = nextActive >= teamCount ? "Xong! Bắt đầu chơi" : "Tiếp tục (Đội sau)";
            playSound('magic');
        } else {
            startPlaying();
        }
        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function startPlaying() {
        stopTimer();
        clearInterval(cooldownInterval);
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";
        if (mode === 'TEACHER' && poisonIndices.length === 0) {
            alert("Hãy chọn ít nhất 1 bình độc!");
            return;
        }
        stage = 'PLAYING';
        startPhaseBtn.classList.add('hidden');
        phaseIndicator.textContent = `Lượt của Đội ${currentTurn + 1}`;
        document.querySelectorAll('.tile').forEach(t => t.classList.remove('poisoned-hidden'));
        playSound('magic');
        startTimer(15, nextTurn);
        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function handleTileClick(index) {
        if (isGameOver || isProcessing) return;
        const tile = document.querySelector(`.tile[data-index="${index}"]`);
        
        if (stage === 'POISONING') {
            if (mode === 'TEACHER') {
                const now = Date.now();
                if (now - lastPoisonTime < 2000) {
                    return;
                }

                const pIdx = poisonIndices.indexOf(index);
                if (pIdx === -1) {
                    poisonIndices.push(index);
                    if (window.SyncManager) window.SyncManager.notifyChange();
                }
                
                tile.classList.remove('flash-poison');
                void tile.offsetWidth; 
                tile.classList.add('flash-poison');
                playSound('magic');
                lastPoisonTime = now;
                
                setTimeout(() => {
                    tile.classList.remove('flash-poison');
                }, 800);

                clearInterval(cooldownInterval);
                const originalText = `ĐỘI ${poisoningTeamIndex + 1}: Mở mắt chọn thuốc độc. Các đội khác nhắm mắt!`;
                let cdLeft = 2;
                phaseIndicator.innerHTML = `${originalText} <br><span style="color: #ffeb3b; font-weight: bold;">(Đợi ${cdLeft}s để chọn tiếp)</span>`;
                wordGrid.style.pointerEvents = "none";
                wordGrid.style.opacity = "0.8";

                cooldownInterval = setInterval(() => {
                    cdLeft--;
                    if (cdLeft <= 0) {
                        clearInterval(cooldownInterval);
                        phaseIndicator.textContent = originalText;
                        wordGrid.style.pointerEvents = "auto";
                        wordGrid.style.opacity = "1";
                    } else {
                        phaseIndicator.innerHTML = `${originalText} <br><span style="color: #ffeb3b; font-weight: bold;">(Đợi ${cdLeft}s để chọn tiếp)</span>`;
                    }
                }, 1000);
            }
            return;
        }

        if (revealedIndices.has(index)) return;
        
        isProcessing = true;
        stopTimer();
        revealedIndices.add(index);
        const words = (currentSessionWords && currentSessionWords.length > 0) ? currentSessionWords : this.gameWords;
        const word = words[index];
        const isPoison = poisonIndices.includes(index);

        if (isPoison) {
            tile.classList.add('revealed-poison');
            tile.innerHTML += `
                <div class="reveal-overlay">
                    <div class="hz-mini" lang="zh-CN">${word.hz}</div>
                    <div class="py">${word.py}</div>
                    <div class="mn">${word.mn.toLowerCase()}</div>
                    <div class="reveal-result">BÌNH ĐỘC!!!</div>
                </div>
            `;
            playSound('wrong');
            
            setTimeout(() => {
                tile.classList.add('tile-disappear');
            }, 1200);
            
            setTimeout(() => {
                eliminatedTeams.add(currentTurn);
                renderTeams();
                if (window.SyncManager) window.SyncManager.notifyChange();

                const activeTeamsCount = teamCount - eliminatedTeams.size;

                if (activeTeamsCount === 1) {
                    let winnerIdx = -1;
                    for (let i = 0; i < teamCount; i++) {
                        if (!eliminatedTeams.has(i)) {
                            winnerIdx = i;
                            break;
                        }
                    }

                    const eliminatedList = Array.from(eliminatedTeams).sort((a, b) => a - b).map(idx => `Đội ${idx + 1}`);
                    let eliminatedStr = "";
                    if (eliminatedList.length === 1) {
                        eliminatedStr = eliminatedList[0];
                    } else {
                        const last = eliminatedList.pop();
                        eliminatedStr = `${eliminatedList.join(', ')} và ${last}`;
                    }

                    endGame(`${eliminatedStr} trúng độc! Chúc mừng Đội ${winnerIdx + 1} là người sống sót cuối cùng và đã chiến thắng!`);
                } else if (activeTeamsCount === 0) {
                    endGame(`Tất cả các đội đều đã trúng độc! Không có người chiến thắng.`);
                } else {
                    phaseIndicator.textContent = `ĐỘI ${currentTurn + 1} TRÚNG ĐỘC VÀ BỊ LOẠI!`;
                    phaseIndicator.style.background = "var(--danger)";
                    setTimeout(() => {
                        phaseIndicator.style.background = "var(--primary)";
                        isProcessing = false;
                        nextTurn();
                    }, 3000);
                }
            }, 1000);
        } else {
            tile.classList.add('revealed-safe');
            tile.innerHTML += `
                <div class="reveal-overlay">
                    <div class="hz-mini" lang="zh-CN">${word.hz}</div>
                    <div class="py">${word.py}</div>
                    <div class="mn">${word.mn.toLowerCase()}</div>
                    <div class="reveal-result">AN TOÀN</div>
                </div>
            `;
            playSound('correct');
            
            setTimeout(() => {
                tile.classList.add('tile-disappear');
            }, 1200);

            scores[currentTurn] += 10;
            updateScores();
            if (window.SyncManager) window.SyncManager.notifyChange();
            
            phaseIndicator.textContent = `CHÍNH XÁC! Đội ${currentTurn + 1} an toàn và nhận +10 điểm!`;
            phaseIndicator.style.background = "#27ae60";

            const totalTiles = words.length;
            const safeTilesCount = totalTiles - poisonIndices.length;
            
            let revealedSafeCount = 0;
            revealedIndices.forEach(idx => {
                if (!poisonIndices.includes(idx)) {
                    revealedSafeCount++;
                }
            });
            
            if (revealedSafeCount === safeTilesCount) {
                let maxScore = -1;
                let winners = [];
                scores.forEach((s, i) => {
                    if (!eliminatedTeams.has(i)) {
                        if (s > maxScore) {
                            maxScore = s;
                            winners = [i + 1];
                        } else if (s === maxScore) {
                            winners.push(i + 1);
                        }
                    }
                });
                
                if (winners.length > 1) {
                    startTieBreaker(winners);
                } else if (winners.length === 1) {
                    endGame(`Chúc mừng Đội ${winners[0]} đã chiến thắng với ${maxScore}đ!`);
                } else {
                    endGame(`Tất cả đều đã bị loại! Không có người chiến thắng.`);
                }
            } else {
                setTimeout(() => {
                    phaseIndicator.style.background = "var(--primary)";
                    isProcessing = false;
                    nextTurn();
                }, 3000);
            }
        }
    }

    function nextTurn() {
        if (isGameOver) return;
        stopTimer();
        
        let nextIdx = (currentTurn + 1) % teamCount;
        let attempts = 0;
        while (eliminatedTeams.has(nextIdx) && attempts < teamCount) {
            nextIdx = (nextIdx + 1) % teamCount;
            attempts++;
        }
        
        currentTurn = nextIdx;
        
        document.querySelectorAll('.team-card').forEach((c, i) => {
            c.classList.toggle('active', i === currentTurn);
        });
        phaseIndicator.textContent = `Lượt của Đội ${currentTurn + 1}`;
        startTimer(15, nextTurn);
        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function updateScores() {
        scores.forEach((s, i) => {
            const el = document.getElementById(`score-team-${i}`);
            if (el) el.textContent = s;
        });
    }

    function endGame(msg) {
        stopTimer();
        isGameOver = true;
        document.getElementById('winner-text').textContent = msg;
        const reviewList = document.getElementById('review-list');
        reviewList.innerHTML = `
            <table class="mystic-table">
                <thead>
                    <tr>
                        <th>Từ vựng</th>
                        <th>Phiên âm</th>
                        <th>Nghĩa</th>
                    </tr>
                </thead>
                <tbody id="review-table-body"></tbody>
            </table>
        `;
        
        const tableBody = document.getElementById('review-table-body');
        const allWords = hsk3Data[currentLesson].words;
        allWords.forEach(w => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="hz" lang="zh-CN">${w.hz}</td>
                <td class="py">${w.py}</td>
                <td class="mn">${w.mn.toLowerCase()}</td>
            `;
            tableBody.appendChild(tr);
        });

        // Báo cáo điểm số và tiến độ tới hệ thống LMS (Moodle, Canvas, SCORM, iFrame)
        if (window.LMSAdapter) {
            const highestScore = Math.max(...scores, 10);
            window.LMSAdapter.recordScore(highestScore, 250, {
                theme: currentLessonDisplay,
                winner: msg
            });
        }

        setTimeout(() => {
            if (window.gameAudio && !window.gameAudio.isMuted) {
                window.gameAudio.music.pause();
            }
            playSound('win');
            document.getElementById('result-modal').classList.add('active');
        }, 1500);

        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    function startTieBreaker(winners) {
        stopTimer();
        isGameOver = false;
        
        alert(`Hòa nhau! Các Đội ${winners.join(', ')} sẽ bước vào vòng loại trực tiếp!`);
        
        eliminatedTeams.clear();
        for (let i = 0; i < teamCount; i++) {
            if (!winners.includes(i + 1)) {
                eliminatedTeams.add(i);
            }
        }
        
        scores.fill(0);
        stage = 'POISONING';
        
        for (let i = 0; i < teamCount; i++) {
            if (!eliminatedTeams.has(i)) {
                currentTurn = i;
                break;
            }
        }
        
        poisonIndices = [];
        revealedIndices.clear();
        isProcessing = false;
        lastPoisonTime = 0;
        clearInterval(cooldownInterval);
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";
        
        const themeData = hsk3Data[currentLesson];
        const allWords = [...themeData.words];
        const shuffled = allWords.sort(() => Math.random() - 0.5);
        currentSessionWords = shuffled.slice(0, 25);
        this.gameWords = currentSessionWords;
        
        renderTeams();
        renderGrid();
        
        phaseIndicator.textContent = "VÒNG LOẠI: Phù thủy đang giấu thuốc độc...";
        startPhaseBtn.classList.add('hidden');
        document.getElementById('result-modal').classList.remove('active');

        startPhase('TEACHER');
        if (window.SyncManager) window.SyncManager.notifyChange();
    }

    // --- State Serialization & Restoration (Đồng bộ 2 chiều LMS <-> Cửa sổ mới) ---
    function getGameState() {
        const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
        const curAudioTime = bgMusic ? Number(bgMusic.currentTime.toFixed(2)) : 0;
        const isMuted = window.gameAudio ? window.gameAudio.isMuted : false;
        const maxScore = scores && scores.length > 0 ? Math.max(...scores) : 0;

        return {
            page: 'game.html',
            activeScreen: screens.game && screens.game.classList.contains('active') ? 'game' : 'teams',
            currentLesson: currentLesson,
            currentLessonParam: currentLessonParam,
            currentLessonDisplay: currentLessonDisplay,
            topicName: hsk3Data[currentLesson] ? hsk3Data[currentLesson].theme : currentLessonDisplay,
            teamCount: teamCount,
            scores: [...scores],
            currentTurn: currentTurn,
            stage: stage,
            mode: mode,
            poisoningTeamIndex: poisoningTeamIndex,
            poisonIndices: [...poisonIndices],
            revealedIndices: Array.from(revealedIndices),
            eliminatedTeams: Array.from(eliminatedTeams),
            isGameOver: isGameOver,
            gameWords: (currentSessionWords && currentSessionWords.length > 0) ? currentSessionWords : (this.gameWords || null),
            timeLeft: timeLeft,
            timerActive: !!timerInterval && timeLeft > 0,
            phaseIndicatorText: phaseIndicator ? phaseIndicator.textContent : '',
            startPhaseBtnHidden: startPhaseBtn ? startPhaseBtn.classList.contains('hidden') : true,
            startPhaseBtnText: startPhaseBtn ? startPhaseBtn.textContent : '',
            resultModalActive: document.getElementById('result-modal') ? document.getElementById('result-modal').classList.contains('active') : false,
            winnerText: document.getElementById('winner-text') ? document.getElementById('winner-text').textContent : '',
            winnerScore: maxScore,
            // Đồng bộ âm thanh
            isMuted: isMuted,
            audioCurrentTime: curAudioTime,
            audioPlaying: !isMuted && bgMusic && !bgMusic.paused
        };
    }

    function applyGameState(state) {
        if (!state) return;
        stopTimer();
        clearInterval(cooldownInterval);

        // 1. Khôi phục trạng thái âm thanh
        if (typeof state.isMuted === 'boolean' && window.gameAudio) {
            window.gameAudio.setMuted(state.isMuted);
        }

        const bgMusic = window.bgMusic || (window.gameAudio ? window.gameAudio.music : null);
        if (isFinite(state.audioCurrentTime) && bgMusic) {
            try {
                if (bgMusic.duration && state.audioCurrentTime >= bgMusic.duration) {
                    bgMusic.currentTime = state.audioCurrentTime % bgMusic.duration;
                } else {
                    bgMusic.currentTime = state.audioCurrentTime;
                }
            } catch (e) {}
        }

        if (typeof state.currentLesson === 'number' && hsk3Data[state.currentLesson]) {
            currentLesson = state.currentLesson;
        }
        if (state.currentLessonDisplay) {
            currentLessonDisplay = state.currentLessonDisplay;
        }
        if (state.currentLessonParam) {
            currentLessonParam = state.currentLessonParam;
        }

        teamCount = state.teamCount || 2;
        scores = state.scores ? [...state.scores] : new Array(teamCount).fill(0);
        currentTurn = typeof state.currentTurn === 'number' ? state.currentTurn : 0;
        stage = state.stage || 'POISONING';
        mode = state.mode || 'TEACHER';
        poisoningTeamIndex = typeof state.poisoningTeamIndex === 'number' ? state.poisoningTeamIndex : 0;
        poisonIndices = state.poisonIndices ? [...state.poisonIndices] : [];
        revealedIndices = new Set(state.revealedIndices || []);
        eliminatedTeams = new Set(state.eliminatedTeams || []);
        isGameOver = !!state.isGameOver;
        isProcessing = false;
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";

        if (state.gameWords && Array.isArray(state.gameWords) && state.gameWords.length > 0) {
            currentSessionWords = state.gameWords;
            this.gameWords = state.gameWords;
        }

        // Khôi phục màn hình hiển thị
        if (state.activeScreen === 'game') {
            showScreen('game');

            const themeData = hsk3Data[currentLesson];
            if (themeData) {
                document.getElementById('current-lesson-title').textContent = currentLessonDisplay || `Chủ đề ${currentLesson + 1}`;
                document.getElementById('current-lesson-name').textContent = themeData.theme;
            }

            renderTeams();
            renderGrid();

            // Khôi phục các ô chữ đã lật
            const words = (currentSessionWords && currentSessionWords.length > 0) ? currentSessionWords : this.gameWords;
            revealedIndices.forEach(idx => {
                const tile = document.querySelector(`.tile[data-index="${idx}"]`);
                if (tile && words && words[idx]) {
                    const word = words[idx];
                    const isPoison = poisonIndices.includes(idx);
                    if (isPoison) {
                        tile.classList.add('revealed-poison', 'tile-disappear');
                        tile.innerHTML = `
                            <div class="reveal-overlay">
                                <div class="hz-mini" lang="zh-CN">${word.hz}</div>
                                <div class="py">${word.py}</div>
                                <div class="mn">${word.mn.toLowerCase()}</div>
                                <div class="reveal-result">BÌNH ĐỘC!!!</div>
                            </div>
                        `;
                    } else {
                        tile.classList.add('revealed-safe', 'tile-disappear');
                        tile.innerHTML = `
                            <div class="reveal-overlay">
                                <div class="hz-mini" lang="zh-CN">${word.hz}</div>
                                <div class="py">${word.py}</div>
                                <div class="mn">${word.mn.toLowerCase()}</div>
                                <div class="reveal-result">AN TOÀN</div>
                            </div>
                        `;
                    }
                }
            });

            // Khôi phục banner thông báo và nút chuyển giai đoạn
            if (state.phaseIndicatorText) {
                phaseIndicator.textContent = state.phaseIndicatorText;
            }

            if (state.startPhaseBtnHidden) {
                startPhaseBtn.classList.add('hidden');
            } else {
                startPhaseBtn.classList.remove('hidden');
            }
            if (state.startPhaseBtnText) {
                startPhaseBtn.textContent = state.startPhaseBtnText;
            }
            if (stage === 'POISONING') {
                startPhaseBtn.onclick = nextPoisoningTeam;
                document.querySelectorAll('.team-card').forEach((c, i) => {
                    c.classList.toggle('active', i === poisoningTeamIndex);
                });
            } else {
                startPhaseBtn.onclick = startPlaying;
                document.querySelectorAll('.team-card').forEach((c, i) => {
                    c.classList.toggle('active', i === currentTurn);
                });
            }

            // Khôi phục kết quả hoặc đồng hồ đếm ngược
            if (state.resultModalActive && state.winnerText) {
                endGame(state.winnerText);
            } else {
                const resModal = document.getElementById('result-modal');
                if (resModal) resModal.classList.remove('active');

                if (stage === 'PLAYING' && !isGameOver) {
                    const remaining = typeof state.timeLeft === 'number' && state.timeLeft > 0 ? state.timeLeft : 15;
                    startTimer(remaining, nextTurn);
                }
            }
        } else {
            showScreen('teams');
        }

        // Tiếp tục phát nhạc nếu không mute và không có popup con đang hoạt động
        const isHostWaiting = window.SyncManager && window.SyncManager.hasActiveChild && window.SyncManager.hasActiveChild();
        if (window.gameAudio && !window.gameAudio.isMuted && !isHostWaiting) {
            if (bgMusic && bgMusic.paused) {
                window.safePlayAudio ? window.safePlayAudio(bgMusic) : bgMusic.play().catch(() => {});
            }
        }
    }

    init();
});
