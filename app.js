// ============================================================
// Тренажёр пересказа — мультипредметный движок school-trainer
// Параметры URL: trainer.html?s=<предмет>&p=<параграф>
// Реестр предметов: data/subjects.json (функции из catalog.js)
// Данные параграфа:  data/<предмет>/p<параграф>.json
// ============================================================

const urlParams = new URLSearchParams(window.location.search);
const subjectId = urlParams.get('s') || '';
const paragraphId = urlParams.get('p') || '';

let subject = null;   // объект предмета из subjects.json
let topicList = [];   // плоский список тем предмета [{p, num, title, desc}]
let topicIndex = -1;  // индекс текущей темы

let data = null;      // данные текущего параграфа
let currentCard = 0;
let currentQ = 0;
let score = 0;
let activeSection = 'all'; // 'all' или индекс 0, 1, 2...

// ---------- Загрузка и каркас страницы ----------

(async function boot() {
    let catalogData;
    try {
        catalogData = await loadCatalog();
    } catch (err) {
        showError('Реестр предметов не загружен. ' + err.message);
        return;
    }

    subject = catalogData.subjects.find(s => s.id === subjectId);
    if (!subject || subject.status !== 'ready') {
        showError('Тренажёр этого предмета ещё не готов. Выберите другой предмет на главной.');
        return;
    }

    applySubjectTheme(subject);

    // Плоский список тем всех разделов предмета
    topicList = (subject.sections || []).flatMap(sec => sec.topics);
    topicIndex = topicList.findIndex(t => String(t.p) === String(paragraphId));
    if (topicIndex === -1) topicIndex = 0;

    const topic = topicList[topicIndex];
    renderChrome(topic);

    fetch(`data/${subject.id}/p${topic.p}.json`)
        .then(res => {
            if (!res.ok) throw new Error('файл данных не найден');
            return res.json();
        })
        .then(json => {
            data = json;
            initApp();
        })
        .catch(err => showError('Ошибка загрузки данных параграфа. ' + err.message));
})();

function showError(message) {
    document.getElementById('page-title').innerText = "Ошибка загрузки";
    document.getElementById('page-subtitle').innerText =
        message + ' Запустите проект через локальный сервер (например, Live Server в VS Code).';
}

// Крошки, ссылки, переключатель предмета, пейджер параграфов
function renderChrome(topic) {
    document.title = `${subject.icon} ${subject.title} — ${topic.num}. ${topic.title}`;

    document.getElementById('breadcrumbs').innerHTML = `
        <a href="index.html">🏠 Главная</a>
        <span class="crumb-sep">›</span>
        <a href="subject.html?s=${subject.id}">${subject.icon} ${subject.title}</a>
        <span class="crumb-sep">›</span>
        <span class="crumb-current">${topic.num}. ${topic.title}</span>`;

    const backLink = document.getElementById('back-link');
    backLink.href = `subject.html?s=${subject.id}`;
    backLink.innerText = `⬅ Все темы: ${subject.title}`;

    // Выпадающий список всех предметов (быстрый переключатель)
    const sel = document.getElementById('subject-select');
    sel.innerHTML = catalog.subjects.map(s => {
        const suffix = s.status === 'ready' ? '' : ' (готовится)';
        const selected = s.id === subject.id ? 'selected' : '';
        return `<option value="${s.id}" ${selected}>${s.icon} ${s.title}${suffix}</option>`;
    }).join('');

    // Пейджер: предыдущий/следующий параграф
    const prev = topicList[topicIndex - 1];
    const next = topicList[topicIndex + 1];
    const prevEl = document.getElementById('pager-prev');
    const nextEl = document.getElementById('pager-next');
    if (prev) {
        prevEl.style.visibility = 'visible';
        prevEl.href = `trainer.html?s=${subject.id}&p=${prev.p}`;
        prevEl.querySelector('span').textContent = `${prev.num} ${prev.title}`;
    }
    if (next) {
        nextEl.style.visibility = 'visible';
        nextEl.href = `trainer.html?s=${subject.id}&p=${next.p}`;
        nextEl.querySelector('span').textContent = `${next.num} ${next.title}`;
    }
}

function switchSubject(id) {
    const s = catalog.subjects.find(x => x.id === id);
    if (!s) return;
    if (s.id === subjectId) return;
    const topics = (s.sections || []).flatMap(sec => sec.topics);
    if (s.status === 'ready' && topics.length > 0) {
        window.location.href = `trainer.html?s=${id}&p=${topics[0].p}`;
    } else {
        window.location.href = `subject.html?s=${id}`;
    }
}

// ---------- Инициализация вкладок ----------

function initApp() {
    document.title = `${subject.icon} ${data.title}`;
    document.getElementById('page-title').innerText = data.title;
    document.getElementById('page-subtitle').innerText = data.subtitle || '';

    // Вкладки доступны только при наличии данных
    const availability = {
        speaker: !!(data.sections && data.sections.length),
        flashcards: !!(data.flashcards && data.flashcards.length),
        timeline: !!(data.timeline && data.timeline.length),
        quiz: !!(data.quiz && data.quiz.length)
    };
    applyTabAvailability(availability);

    if (availability.speaker) renderSpeaker();
    if (availability.flashcards) updateCardUI();
    if (availability.timeline) renderTimeline();
    if (availability.quiz) renderQuestion();
}

function applyTabAvailability(availability) {
    const tabs = document.querySelectorAll('#trainer-tabs .tab-btn');
    let firstAvailable = null;
    tabs.forEach(btn => {
        const tab = btn.dataset.tab;
        const ok = !!availability[tab];
        btn.classList.toggle('tab-hidden', !ok);
        const content = document.getElementById('tab-' + tab);
        if (content) content.classList.toggle('tab-hidden', !ok);
        if (ok && firstAvailable === null) firstAvailable = tab;
    });

    // Если активная вкладка недоступна — переходим на первую доступную
    const activeBtn = document.querySelector('#trainer-tabs .tab-btn.active');
    if ((!activeBtn || activeBtn.classList.contains('tab-hidden')) && firstAvailable) {
        switchTab(firstAvailable);
    }
}

// 1. СУФЛЁР (с вкладками по разделам)
function renderSpeaker() {
    const fullContainer = document.getElementById('speaker-full-container');
    const keyContainer = document.getElementById('speaker-keywords-container');

    fullContainer.innerHTML = '';
    keyContainer.innerHTML = '';

    // Панель вкладок по разделам
    const navBar = document.createElement('div');
    navBar.className = 'section-tabs';

    let tabsHTML = `<button class="sec-tab-btn ${activeSection === 'all' ? 'active' : ''}" onclick="selectSection('all')">📄 Все разделы</button>`;
    data.sections.forEach((sec, idx) => {
        const shortName = sec.title.length > 28 ? sec.title.slice(0, 25) + '…' : sec.title;
        tabsHTML += `<button class="sec-tab-btn ${activeSection === idx ? 'active' : ''}" onclick="selectSection(${idx})">${shortName}</button>`;
    });
    navBar.innerHTML = tabsHTML;
    fullContainer.appendChild(navBar);

    // Контейнер под текст разделов
    const contentBox = document.createElement('div');
    contentBox.id = 'sec-content-box';

    data.sections.forEach((sec, idx) => {
        const isVisible = (activeSection === 'all' || activeSection === idx);

        const parsedText = sec.text.replace(/\{([^}]+)\}/g, '<span class="secret-word">$1</span>');
        const box = document.createElement('div');
        box.className = 'section-box';
        box.id = `section-box-${idx}`;
        box.style.display = isVisible ? 'block' : 'none';

        // Кнопки перехода между разделами (если учим по одному)
        let navArrows = '';
        if (activeSection !== 'all') {
            const prevBtn = idx > 0 ? `<button class="btn btn-outline" style="padding:4px 12px; font-size:0.8rem;" onclick="selectSection(${idx - 1})">⬅ Назад</button>` : '<div></div>';
            const nextBtn = idx < data.sections.length - 1 ? `<button class="btn" style="padding:4px 12px; font-size:0.8rem;" onclick="selectSection(${idx + 1})">Следующий раздел ➡</button>` : `<button class="btn" style="padding:4px 12px; font-size:0.8rem; background:var(--success);" onclick="selectSection('all')">✔ Повторить всё целиком</button>`;
            navArrows = `<div style="display:flex; justify-content:space-between; margin-top:14px; padding-top:10px; border-top:1px dashed var(--border);">${prevBtn}${nextBtn}</div>`;
        }

        box.innerHTML = `<div class="section-title">${sec.title}</div><p>${parsedText}</p>${navArrows}`;
        contentBox.appendChild(box);

        // Опорная цепочка
        if (sec.chain && sec.chain.length > 0) {
            const chainRow = document.createElement('div');
            chainRow.className = 'chain-row';
            chainRow.id = `chain-row-${idx}`;
            chainRow.style.display = isVisible ? 'block' : 'none';
            const tags = sec.chain.map(t => `<span class="chain-tag">${t}</span>`).join('<span class="chain-arrow">→</span>');
            chainRow.innerHTML = `<div class="chain-title">${sec.title}:</div><div class="chain-items">${tags}</div>`;
            keyContainer.appendChild(chainRow);
        }
    });

    fullContainer.appendChild(contentBox);

    document.querySelectorAll('.secret-word').forEach(el => {
        el.addEventListener('click', () => el.classList.toggle('hidden'));
    });
}

function selectSection(idx) {
    activeSection = idx;
    renderSpeaker();
}

function setSpeakerMode(mode, btn) {
    document.querySelectorAll('#tab-speaker .mode-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const words = document.querySelectorAll('.secret-word');
    const fullCont = document.getElementById('speaker-full-container');
    const keyCont = document.getElementById('speaker-keywords-container');

    if (mode === 'full') {
        fullCont.style.display = 'block';
        keyCont.style.display = 'none';
        words.forEach(w => w.classList.remove('hidden'));
    } else if (mode === 'hints') {
        fullCont.style.display = 'block';
        keyCont.style.display = 'none';
        words.forEach(w => w.classList.add('hidden'));
    } else if (mode === 'keywords') {
        fullCont.style.display = 'none';
        keyCont.style.display = 'block';
    }
}

// 2. ФЛЕШ-КАРТОЧКИ
function updateCardUI() {
    if (!data.flashcards || data.flashcards.length === 0) return;
    const fc = data.flashcards[currentCard];
    document.getElementById('fc-category').innerText = fc.cat || "Термин";
    document.getElementById('fc-front-text').innerText = fc.q;
    document.getElementById('fc-back-text').innerText = fc.a;
    document.getElementById('fc-index').innerText = currentCard + 1;
    document.getElementById('fc-total').innerText = data.flashcards.length;
    document.querySelector('.flashcard').classList.remove('flipped');
}
function flipCard(el) { el.classList.toggle('flipped'); }
function nextCard() { currentCard = (currentCard + 1) % data.flashcards.length; updateCardUI(); }
function prevCard() { currentCard = (currentCard - 1 + data.flashcards.length) % data.flashcards.length; updateCardUI(); }

// 3. ХРОНОГРАФ
function renderTimeline() {
    const container = document.getElementById('timeline-container');
    container.innerHTML = '';

    data.timeline.forEach(item => {
        const row = document.createElement('div');
        row.className = 'timeline-item';
        row.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-date" onclick="revealItem(this)">${item.date}</div>
            <div class="timeline-text" onclick="revealItem(this)"><strong>${item.title}:</strong> ${item.text}</div>
        `;
        container.appendChild(row);
    });
}

function setTimelineMode(mode, btn) {
    document.querySelectorAll('#tab-timeline .mode-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const dates = document.querySelectorAll('.timeline-date');
    const texts = document.querySelectorAll('.timeline-text');

    dates.forEach(d => d.classList.remove('tl-hidden'));
    texts.forEach(t => t.classList.remove('tl-hidden'));

    if (mode === 'hide-dates') dates.forEach(d => d.classList.add('tl-hidden'));
    else if (mode === 'hide-events') texts.forEach(t => t.classList.add('tl-hidden'));
    else if (mode === 'hide-both') {
        dates.forEach(d => d.classList.add('tl-hidden'));
        texts.forEach(t => t.classList.add('tl-hidden'));
    }
}
function revealItem(el) {
    if (el.classList.contains('tl-hidden')) el.classList.remove('tl-hidden');
}

// 4. ТЕСТ
function renderQuestion() {
    if (!data.quiz || data.quiz.length === 0) return;
    const q = data.quiz[currentQ];
    document.getElementById('q-text').innerText = `${currentQ + 1}. ${q.q}`;
    const optsContainer = document.getElementById('q-options');
    optsContainer.innerHTML = '';
    document.getElementById('q-feedback').innerText = '';
    document.getElementById('q-next-btn').style.display = 'none';

    q.opts.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-opt';
        btn.innerText = opt;
        btn.onclick = () => checkAnswer(idx);
        optsContainer.appendChild(btn);
    });
}

function checkAnswer(chosenIdx) {
    const q = data.quiz[currentQ];
    const buttons = document.querySelectorAll('.quiz-opt');
    buttons.forEach(b => b.style.pointerEvents = 'none');

    if (chosenIdx === q.correct) {
        buttons[chosenIdx].classList.add('correct');
        document.getElementById('q-feedback').innerHTML = '<span style="color:var(--success);">Верно! 👏</span>';
        score++;
    } else {
        buttons[chosenIdx].classList.add('wrong');
        buttons[q.correct].classList.add('correct');
        document.getElementById('q-feedback').innerHTML = '<span style="color:var(--danger);">Неверно! Ответ выделен зелёным.</span>';
    }
    document.getElementById('q-next-btn').style.display = 'inline-block';
}

function nextQuestion() {
    currentQ++;
    if (currentQ < data.quiz.length) {
        renderQuestion();
    } else {
        document.getElementById('quiz-box').style.display = 'none';
        document.getElementById('quiz-result').style.display = 'block';
        document.getElementById('quiz-score').innerText = `Ваш результат: ${score} из ${data.quiz.length}`;
    }
}

function restartQuiz() {
    currentQ = 0;
    score = 0;
    document.getElementById('quiz-box').style.display = 'block';
    document.getElementById('quiz-result').style.display = 'none';
    renderQuestion();
}

// НАВИГАЦИЯ ОСНОВНЫХ ВКЛАДОК
function switchTab(tabId) {
    document.querySelectorAll('#trainer-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`#trainer-tabs .tab-btn[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById('tab-' + tabId);
    if (content) content.classList.add('active');
}
