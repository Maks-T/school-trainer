// Общий скрипт для главной (index.html) и страницы предмета (subject.html).
// Загружает единый реестр data/subjects.json и рендерит каталог.

let catalog = null; // { grade, title, subtitle, subjects: [...] }

// ---------- Общие утилиты ----------

async function loadCatalog() {
    if (catalog) return catalog;
    const res = await fetch('data/subjects.json');
    if (!res.ok) throw new Error('Реестр предметов не найден');
    catalog = await res.json();
    return catalog;
}

function getSubject(id) {
    return catalog.subjects.find(s => s.id === id) || null;
}

function applySubjectTheme(subject) {
    const root = document.documentElement;
    if (subject) {
        root.style.setProperty('--primary', subject.color);
        root.style.setProperty('--primary-hover', shade(subject.color, -12));
        root.style.setProperty('--subject-soft', subject.colorSoft);
    } else {
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-hover');
        root.style.removeProperty('--subject-soft');
    }
}

// Осветлить/затемнить hex-цвет (percent > 0 — светлее, < 0 — темнее)
function shade(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.min(255, Math.max(0, (num >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
    const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function countTopics(subject) {
    return (subject.sections || []).reduce((n, sec) => n + sec.topics.length, 0);
}

// ---------- Главная страница ----------

function renderHome(data) {
    const grid = document.getElementById('subject-grid');
    const ready = data.subjects.filter(s => s.status === 'ready').length;
    const planned = data.subjects.length - ready;

    let html = '';
    data.subjects.forEach(subject => {
        const topics = countTopics(subject);
        const isReady = subject.status === 'ready';
        const badge = isReady
            ? `<span class="badge badge-ready">${topics} ${pluralTopics(topics)}</span>`
            : `<span class="badge badge-planned">готовится</span>`;
        const meta = isReady
            ? `${subject.description}`
            : `${subject.description}`;
        html += `
            <a href="subject.html?s=${subject.id}" class="subject-card" style="--card-accent:${subject.color}; --card-soft:${subject.colorSoft};">
                <div class="subject-card-icon" style="background:${subject.colorSoft};">${subject.icon}</div>
                <div class="subject-card-body">
                    <div class="subject-card-title">${subject.title}</div>
                    <div class="subject-card-desc">${meta}</div>
                </div>
                ${badge}
                <div class="topic-arrow">➡</div>
            </a>`;
    });
    grid.innerHTML = html;

    const summary = document.getElementById('subject-summary');
    if (summary) {
        summary.textContent = `Готово тренажёров: ${ready} · В разработке: ${planned}`;
    }
}

function pluralTopics(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'параграф';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'параграфа';
    return 'параграфов';
}

// ---------- Страница предмета ----------

function renderSubjectPage(subject) {
    applySubjectTheme(subject);

    document.title = `${subject.icon} ${subject.title} — Школьный тренажёр`;
    document.getElementById('breadcrumbs').innerHTML = `
        <a href="index.html">🏠 Главная</a>
        <span class="crumb-sep">›</span>
        <span class="crumb-current">${subject.icon} ${subject.title}</span>`;

    document.getElementById('subject-icon').textContent = subject.icon;
    document.getElementById('subject-icon').style.background = subject.colorSoft;
    document.getElementById('subject-title').textContent = subject.title;
    document.getElementById('subject-desc').textContent = subject.description;

    const topics = countTopics(subject);
    const badge = document.getElementById('subject-badge');
    if (subject.status === 'ready') {
        badge.textContent = `${topics} ${pluralTopics(topics)}`;
        badge.className = 'badge badge-ready';
    } else {
        badge.textContent = 'Контент готовится';
        badge.className = 'badge badge-planned';
    }

    const content = document.getElementById('subject-content');

    // Предмет без готовых тренажёров — карточка-заглушка
    if (subject.status !== 'ready' || topics === 0) {
        const sources = (subject.sources || []).length
            ? `<div class="stub-sources">Источники уроков: ${subject.sources.map(s => `<code>${s}/</code>`).join(', ')}</div>`
            : '';
        content.innerHTML = `
            <div class="stub-card">
                <div class="stub-icon">🛠️</div>
                <div class="stub-title">Тренажёр по предмету «${subject.title}» в разработке</div>
                <div class="stub-desc">Уроки готовятся из PDF-базы. Скоро здесь появятся суфлёр, карточки, хронограф и экспресс-тесты.</div>
                ${sources}
                <div class="stub-actions">
                    <a class="btn btn-outline" href="index.html">⬅ Ко всем предметам</a>
                    ${readySubjectLinks(subject)}
                </div>
            </div>`;
        return;
    }

    // Готовый предмет — список разделов и параграфов
    let html = '';
    subject.sections.forEach(sec => {
        const count = sec.topics.length;
        html += `
            <div class="card" style="margin-top: 16px;">
                <div class="section-head">
                    <h2 class="section-head-title">${sec.title}</h2>
                    <span class="badge badge-ready">${count} ${pluralTopics(count)}</span>
                </div>
                <div class="topic-list">
                    ${sec.topics.map(t => `
                        <a href="trainer.html?s=${subject.id}&p=${t.p}" class="topic-card">
                            <div class="topic-num" style="background:${subject.colorSoft}; color:${subject.color};">${t.num}</div>
                            <div class="topic-info">
                                <div class="topic-title">${t.title}</div>
                                <div class="topic-desc">${t.desc}</div>
                            </div>
                            <div class="topic-arrow">➡</div>
                        </a>`).join('')}
                </div>
            </div>`;
    });
    content.innerHTML = html;
}

// Ссылки на другие готовые предметы (для заглушек)
function readySubjectLinks(except) {
    return catalog.subjects
        .filter(s => s.status === 'ready' && s.id !== except.id)
        .map(s => `<a class="btn" href="subject.html?s=${s.id}">${s.icon} ${s.title}</a>`)
        .join('');
}

// ---------- Точка входа ----------

(async function init() {
    try {
        const data = await loadCatalog();
        const page = document.body.dataset.page;

        if (page === 'home') {
            renderHome(data);
        } else if (page === 'subject') {
            const id = new URLSearchParams(window.location.search).get('s');
            const subject = id ? getSubject(id) : null;
            if (!subject) {
                document.getElementById('load-error').style.display = 'block';
                document.getElementById('subject-header').style.display = 'none';
                document.getElementById('breadcrumbs').innerHTML =
                    '<a href="index.html">🏠 Главная</a><span class="crumb-sep">›</span><span class="crumb-current">Не найдено</span>';
                document.title = 'Предмет не найден — Школьный тренажёр';
                return;
            }
            renderSubjectPage(subject);
        }
    } catch (err) {
        console.error(err);
        const errBox = document.getElementById('load-error');
        if (errBox) errBox.style.display = 'block';
        const grid = document.getElementById('subject-grid');
        if (grid) grid.style.display = 'none';
        const header = document.getElementById('subject-header');
        if (header) header.style.display = 'none';
        const content = document.getElementById('subject-content');
        if (content) content.style.display = 'none';
    }
})();
