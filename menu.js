document.addEventListener('DOMContentLoaded', () => {
    const screens = {
        splash: document.getElementById('splash'),
        lessons: document.getElementById('lesson-selection')
    };

    const lessonGrid = document.querySelector('.lesson-grid');

    function showScreen(screenId) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[screenId]) screens[screenId].classList.add('active');
    }

    function init() {
        // Build lesson selection grid
        if (typeof hsk3Data !== 'undefined') {
            hsk3Data.forEach((item, index) => {
                const card = document.createElement('div');
                card.className = 'lesson-card';
                card.innerHTML = `
                    <div class="num">Chủ đề ${index + 1}</div>
                    <div class="title">${item.theme}</div>
                `;
                card.onclick = () => {
                    // Navigate to game.html with 1-indexed theme number
                    window.location.href = `game.html?theme=${index + 1}`;
                };
                lessonGrid.appendChild(card);
            });
        }

        // Event Listeners
        document.getElementById('start-btn').onclick = () => showScreen('lessons');
        
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => {
                if (screens.lessons.classList.contains('active')) showScreen('splash');
            };
        });
    }

    init();
});
