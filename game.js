document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let currentLesson = 0;
    let teamCount = 1;
    let scores = [0, 0, 0, 0];
    let currentTurn = 0;
    let poisonIndices = [];
    let revealedIndices = new Set();
    let isGameOver = false;
    let stage = 'POISONING'; // 'POISONING', 'PLAYING'
    let mode = 'AI'; // 'AI', 'TEACHER'
    let timerInterval = null;
    let timeLeft = 0;

    // --- DOM Elements ---
    const screens = {
        teams: document.getElementById('team-selection'),
        game: document.getElementById('game-screen')
    };

    const wordGrid = document.getElementById('word-grid');
    const teamsSidebar = document.getElementById('teams-sidebar');
    const phaseIndicator = document.getElementById('phase-indicator');
    const startPhaseBtn = document.getElementById('start-phase-btn');

    // --- Sounds ---
    const sounds = {
        correct: new Audio('https://assets.mixkit.co/active_storage/sfx/2016/2016-preview.mp3'),
        wrong: new Audio('https://assets.mixkit.co/active_storage/sfx/256/256-preview.mp3'),
        magic: new Audio('https://assets.mixkit.co/active_storage/sfx/2026/2026-preview.mp3')
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
        // Read lesson from URL
        const params = new URLSearchParams(window.location.search);
        const lessonNum = parseInt(params.get('lesson'));

        if (isNaN(lessonNum) || lessonNum < 1 || lessonNum > hsk3Data.length) {
            // Redirect back if lesson is invalid
            window.location.href = 'index.html';
            return;
        }

        currentLesson = lessonNum - 1; // Convert back to 0-indexed for data access
        showScreen('teams');

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

        document.getElementById('setup-auto-btn').onclick = () => startPhase('AI');
        document.getElementById('setup-manual-btn').onclick = () => startPhase('TEACHER');
        document.getElementById('start-phase-btn').onclick = startPlaying;
        document.getElementById('reset-game-btn').onclick = initGame;
        document.getElementById('exit-btn').onclick = () => window.location.href = 'index.html';
        document.getElementById('main-menu-btn').onclick = () => window.location.href = 'index.html';
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
        stage = 'POISONING';
        scores = new Array(teamCount).fill(0);
        currentTurn = 0;
        poisonIndices = [];
        revealedIndices.clear();
        
        const lesson = hsk3Data[currentLesson];
        document.getElementById('current-lesson-title').textContent = `Bài ${lesson.lesson}`;
        document.getElementById('current-lesson-name').textContent = lesson.title;

        renderTeams();
        renderGrid();
        
        phaseIndicator.textContent = "Nhắm mắt lại: Chọn kiểu giấu thuốc...";
        startPhaseBtn.classList.add('hidden');
        document.getElementById('result-modal').classList.remove('active');
    }

    function renderTeams() {
        teamsSidebar.innerHTML = '';
        for (let i = 0; i < teamCount; i++) {
            const card = document.createElement('div');
            card.className = `team-card t${i} ${i === currentTurn ? 'active' : ''}`;
            card.innerHTML = `
                <div class="name">Đội ${i + 1}</div>
                <div class="score" id="score-team-${i}">${scores[i]}</div>
            `;
            teamsSidebar.appendChild(card);
        }
    }

    function renderGrid() {
        wordGrid.innerHTML = '';
        const words = hsk3Data[currentLesson].words;
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
        mode = selectedMode;
        stage = 'POISONING';
        poisonIndices = [];
        revealedIndices.clear();
        renderGrid();
        
        if (mode === 'AI') {
            const words = hsk3Data[currentLesson].words;
            const poisonCount = Math.max(1, Math.floor(words.length / 5));
            while (poisonIndices.length < poisonCount) {
                const rand = Math.floor(Math.random() * words.length);
                if (!poisonIndices.includes(rand)) poisonIndices.push(rand);
            }
            phaseIndicator.textContent = "Đã giấu xong! Hãy để các đội mở mắt.";
            startPhaseBtn.classList.remove('hidden');
            playSound('magic');
        } else {
            phaseIndicator.textContent = "Giáo viên: Chọn các ô làm bình độc.";
            startPhaseBtn.classList.remove('hidden');
            startPhaseBtn.textContent = "Xong! Bắt đầu chơi";
            startTimer(30, () => {
                if (poisonIndices.length === 0) {
                    const words = hsk3Data[currentLesson].words;
                    const poisonCount = Math.max(1, Math.floor(words.length / 5));
                    while (poisonIndices.length < poisonCount) {
                        const rand = Math.floor(Math.random() * words.length);
                        if (!poisonIndices.includes(rand)) poisonIndices.push(rand);
                    }
                }
                startPlaying();
            });
        }
    }

    function startPlaying() {
        stopTimer();
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
        if (isGameOver) return;
        const tile = document.querySelector(`.tile[data-index="${index}"]`);
        
        if (stage === 'POISONING') {
            if (mode === 'TEACHER') {
                const pIdx = poisonIndices.indexOf(index);
                if (pIdx > -1) {
                    poisonIndices.splice(pIdx, 1);
                    tile.classList.remove('poisoned-hidden');
                } else {
                    poisonIndices.push(index);
                    tile.classList.add('poisoned-hidden');
                }
            }
            return;
        }

        if (revealedIndices.has(index)) return;
        stopTimer();
        revealedIndices.add(index);
        const word = hsk3Data[currentLesson].words[index];
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
            scores[currentTurn] = Math.max(0, scores[currentTurn] - 5);
            updateScores();
            endGame(`Đội ${currentTurn + 1} đã trúng độc!`);
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
            scores[currentTurn] += 10;
            updateScores();
            const words = hsk3Data[currentLesson].words;
            if (revealedIndices.size === words.length - poisonIndices.length) {
                endGame("Tất cả bình an! Nhiệm vụ hoàn thành.");
            } else {
                nextTurn();
            }
        }
    }

    function nextTurn() {
        stopTimer();
        currentTurn = (currentTurn + 1) % teamCount;
        document.querySelectorAll('.team-card').forEach((c, i) => {
            c.classList.toggle('active', i === currentTurn);
        });
        phaseIndicator.textContent = `Lượt của Đội ${currentTurn + 1}`;
        if (!isGameOver) startTimer(15, nextTurn);
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
        reviewList.innerHTML = '';
        hsk3Data[currentLesson].words.forEach(w => {
            const item = document.createElement('div');
            item.className = 'review-item';
            item.innerHTML = `
                <div class="hz">${w.hz}</div>
                <div class="py">${w.py}</div>
                <div class="mn">${w.mn}</div>
            `;
            reviewList.appendChild(item);
        });
        setTimeout(() => {
            document.getElementById('result-modal').classList.add('active');
        }, 1500);
    }

    init();
});
