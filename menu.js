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
                    window.location.href = `game.html?${urlParam}`;
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
