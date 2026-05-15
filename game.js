document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let currentLesson = 0;
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
            sounds[type].play().catch(e => console.log("Audio play blocked"));
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
            } else if (paramKey) {
                // Try simple chudeN parsing if the complex one failed
                const match = paramKey.match(/chude(\d+)(_phan(\d+))?/);
                if (match) {
                    const chudeNum = match[1];
                    const phanNum = match[3];
                    targetIndex = parseInt(chudeNum) - 1; // Basic fallback mapping
                    currentLessonDisplay = `Chủ đề ${chudeNum}${phanNum ? ' - P' + phanNum : ''}`;
                } else {
                    targetIndex = parseInt(paramKey.replace('chude', '')) - 1;
                    currentLessonDisplay = `Chủ đề ${targetIndex + 1}`;
                }
            }
        }

        if (targetIndex === -1 || targetIndex >= hsk3Data.length) {
            // Redirect back if theme is invalid
            window.location.href = 'index.html';
            return;
        }

        currentLesson = targetIndex; 
        showScreen('teams');

        // Show Instructions automatically on game start
        const instructionModal = document.getElementById('how-to-play-modal');
        if (instructionModal) {
            instructionModal.classList.add('active');
            document.getElementById('close-how-to-btn').onclick = () => {
                instructionModal.classList.remove('active');
            };
        }

        // Event Listeners
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => {
                if (screens.game.classList.contains('active')) showScreen('teams');
                else window.location.href = 'index.html';
            };
        });

        document.querySelectorAll('.team-btn').forEach(btn => {
            btn.onclick = () => {
                teamCount = parseInt(btn.dataset.teams);
                initGame();
                showScreen('game');
            };
        });

        document.getElementById('start-phase-btn').onclick = startPlaying;
        document.getElementById('reset-game-btn').onclick = initGame;
        document.getElementById('exit-btn').onclick = () => window.location.href = 'index.html';
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
        this.gameWords = shuffled.slice(0, 25); // Store the selected words for this session

        renderTeams();
        renderGrid();
        
        phaseIndicator.textContent = "Nhắm mắt lại: Phù thủy đang giấu thuốc độc...";
        startPhaseBtn.classList.add('hidden');
        document.getElementById('result-modal').classList.remove('active');

        // Automatically start the poisoning phase
        startPhase('TEACHER');
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
        const words = this.gameWords;
        words.forEach((word, index) => {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.index = index;
            tile.innerHTML = `<div class="hz">${word.hz}</div>`;
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
    }

    function updatePoisoningPhaseUI() {
        clearInterval(cooldownInterval);
        wordGrid.style.pointerEvents = "auto";
        wordGrid.style.opacity = "1";
        phaseIndicator.textContent = `ĐỘI ${poisoningTeamIndex + 1}: Mở mắt chọn thuốc độc. Các đội khác nhắm mắt!`;
        // Highlight current team in sidebar
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
    }

    function handleTileClick(index) {
        if (isGameOver || isProcessing) return;
        const tile = document.querySelector(`.tile[data-index="${index}"]`);
        
        if (stage === 'POISONING') {
            if (mode === 'TEACHER') {
                const now = Date.now();
                if (now - lastPoisonTime < 2000) {
                    // Cooldown 2 giây giữa các lần chọn bình độc
                    return;
                }

                const pIdx = poisonIndices.indexOf(index);
                if (pIdx === -1) {
                    poisonIndices.push(index);
                }
                
                // Luôn hiển thị hiệu ứng và phát âm thanh để xác nhận (cho phép nhiều đội chọn cùng 1 bình)
                tile.classList.remove('flash-poison');
                // Trigger reflow để reset animation nếu click liên tục
                void tile.offsetWidth; 
                tile.classList.add('flash-poison');
                playSound('magic');
                lastPoisonTime = now;
                
                // Xóa class flash sau khi animation kết thúc để có thể trigger lại
                setTimeout(() => {
                    tile.classList.remove('flash-poison');
                }, 800);

                // Bắt đầu đếm ngược 2s
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
        
        // Start processing the click
        isProcessing = true;
        stopTimer();
        revealedIndices.add(index);
        const word = this.gameWords[index];
        const isPoison = poisonIndices.includes(index);

        if (isPoison) {
            tile.classList.add('revealed-poison');
            tile.innerHTML += `
                <div class="reveal-overlay">
                    <div class="py">${word.py}</div>
                    <div class="mn">${word.mn}</div>
                    <div class="reveal-result">BÌNH ĐỘC!!!</div>
                </div>
            `;
            playSound('wrong');
            
            // Add disappearance effect after a short delay
            setTimeout(() => {
                tile.classList.add('tile-disappear');
            }, 1200);
            
            // Wait for sound effect before showing notifications
            setTimeout(() => {
                // Elimination Logic
                eliminatedTeams.add(currentTurn);
                renderTeams(); // Update UI to show elimination

                const activeTeamsCount = teamCount - eliminatedTeams.size;

                if (activeTeamsCount === 1) {
                    // Only one team left
                    let winnerIdx = -1;
                    for (let i = 0; i < teamCount; i++) {
                        if (!eliminatedTeams.has(i)) {
                            winnerIdx = i;
                            break;
                        }
                    }

                    // Format list of eliminated teams
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
                    // Everyone hit poison
                    endGame(`Tất cả các đội đều đã trúng độc! Không có người chiến thắng.`);
                } else {
                    // Game continues for remaining teams
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
                    <div class="py">${word.py}</div>
                    <div class="mn">${word.mn}</div>
                    <div class="reveal-result">AN TOÀN</div>
                </div>
            `;
            playSound('correct');
            
            // Add disappearance effect after a short delay to let them see the word
            setTimeout(() => {
                tile.classList.add('tile-disappear');
            }, 1200);

            scores[currentTurn] += 10;
            updateScores();
            
            // Feedback to user
            phaseIndicator.textContent = `CHÍNH XÁC! Đội ${currentTurn + 1} an toàn và nhận +10 điểm!`;
            phaseIndicator.style.background = "#27ae60"; // Success green

            const totalTiles = this.gameWords.length;
            const safeTilesCount = totalTiles - poisonIndices.length;
            
            let revealedSafeCount = 0;
            revealedIndices.forEach(idx => {
                if (!poisonIndices.includes(idx)) {
                    revealedSafeCount++;
                }
            });
            
            if (revealedSafeCount === safeTilesCount) {
                // Hết ô an toàn -> Tìm đội điểm cao nhất
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
        
        // Find next non-eliminated team
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
                <td class="hz">${w.hz}</td>
                <td class="py">${w.py}</td>
                <td class="mn">${w.mn}</td>
            `;
            tableBody.appendChild(tr);
        });

        setTimeout(() => {
            if (window.gameAudio && !window.gameAudio.isMuted) {
                window.gameAudio.music.pause();
            }
            playSound('win');
            document.getElementById('result-modal').classList.add('active');
        }, 1500);
    }

    function startTieBreaker(winners) {
        stopTimer();
        isGameOver = false;
        
        alert(`Hòa nhau! Các Đội ${winners.join(', ')} sẽ bước vào vòng loại trực tiếp!`);
        
        // Mark non-winners as eliminated
        eliminatedTeams.clear();
        for (let i = 0; i < teamCount; i++) {
            if (!winners.includes(i + 1)) {
                eliminatedTeams.add(i);
            }
        }
        
        // Reset scores
        scores.fill(0);
        
        stage = 'POISONING';
        
        // Determine first active team to take turn
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
        this.gameWords = shuffled.slice(0, 25);
        
        renderTeams();
        renderGrid();
        
        phaseIndicator.textContent = "VÒNG LOẠI: Phù thủy đang giấu thuốc độc...";
        startPhaseBtn.classList.add('hidden');
        document.getElementById('result-modal').classList.remove('active');

        startPhase('TEACHER');
    }

    init();
});
