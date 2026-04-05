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
        splash: document.getElementById('splash'),
        lessons: document.getElementById('lesson-selection'),
        teams: document.getElementById('team-selection'),
        game: document.getElementById('game-screen')
    };

    const lessonGrid = document.querySelector('.lesson-grid');
    const wordGrid = document.getElementById('word-grid');
    const teamsSidebar = document.getElementById('teams-sidebar');
    const phaseIndicator = document.getElementById('phase-indicator');
    const startPhaseBtn = document.getElementById('start-phase-btn');

    // --- Sounds (Logic only, actual files would name these) ---
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

    // --- Navigation ---
    function showScreen(screenId) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenId].classList.add('active');
    }

    // --- Initialization ---
    function init() {
        // Build lesson selection
        hsk3Data.forEach((lesson, index) => {
            const card = document.createElement('div');
            card.className = 'lesson-card';
            card.innerHTML = `
                <div class="num">Bài ${lesson.lesson}</div>
                <div class="title">${lesson.title}</div>
            `;
            card.onclick = () => {
                currentLesson = index;
                showScreen('teams');
            };
            lessonGrid.appendChild(card);
        });

        // Event Listeners
        document.getElementById('start-btn').onclick = () => showScreen('lessons');
        
        document.getElementById('how-to-play-btn').onclick = () => {
            document.getElementById('how-to-play-modal').classList.add('active');
        };

        document.getElementById('close-how-to-btn').onclick = () => {
            document.getElementById('how-to-play-modal').classList.remove('active');
        };
        
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => {
                if (screens.game.classList.contains('active')) showScreen('lessons');
                else if (screens.teams.classList.contains('active')) showScreen('lessons');
                else if (screens.lessons.classList.contains('active')) showScreen('splash');
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
        document.getElementById('exit-btn').onclick = () => showScreen('lessons');
        document.getElementById('main-menu-btn').onclick = () => {
            document.getElementById('result-modal').classList.remove('active');
            showScreen('lessons');
        };
        document.getElementById('play-again-btn').onclick = () => {
            document.getElementById('result-modal').classList.remove('active');
            initGame();
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

    // --- Timer System ---
    function startTimer(seconds, onEnd) {
        console.log("Timer Starting:", seconds, "seconds");
        stopTimer();
        const container = document.getElementById('timer-container');
        const progressBar = document.getElementById('timer-progress');
        const valDisplay = document.getElementById('timer-val');
        
        container.classList.remove('hidden', 'warning');
        timeLeft = seconds;
        valDisplay.textContent = timeLeft;
        progressBar.style.width = '100%';
        progressBar.style.transition = 'none';
        void progressBar.offsetWidth; // Trigger reflow
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
        console.log("Timer Stopped / Hidden");
        clearInterval(timerInterval);
        const container = document.getElementById('timer-container');
        if (container) container.classList.add('hidden');
    }

    function startPhase(selectedMode) {
        console.log("Starting Phase:", selectedMode);
        mode = selectedMode;
        stage = 'POISONING';
        poisonIndices = [];
        revealedIndices.clear();
        renderGrid(); // Clear previous visuals
        
        if (mode === 'AI') {
            const words = hsk3Data[currentLesson].words;
            const poisonCount = Math.max(1, Math.floor(words.length / 5)); // ~3-4 poisons
            while (poisonIndices.length < poisonCount) {
                const rand = Math.floor(Math.random() * words.length);
                if (!poisonIndices.includes(rand)) poisonIndices.push(rand);
            }
            phaseIndicator.textContent = "Đã giấu xong! Hãy để các đội mở mắt.";
            startPhaseBtn.classList.remove('hidden');
            playSound('magic');
        } else {
            phaseIndicator.textContent = "Giáo viên: Hãy chọn các ô làm bình độc (Click vào ô).";
            startPhaseBtn.classList.remove('hidden');
            startPhaseBtn.textContent = "Xong! Bắt đầu chơi";
            
            // Start 30s timer for teacher
            startTimer(30, () => {
                // If teacher doesn't pick any, pick random ones
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
        // Hide teacher markers if any
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

        // --- Playing Stage ---
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
            // Current team loses point or gets eliminated
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
            
            // Check if all safe tiles are revealed
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
        
        if (!isGameOver) {
            startTimer(15, nextTurn);
        }
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
        
        // Build review list
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
