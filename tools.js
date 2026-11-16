// Инструменты-помощники предмета (кнопки в шапке тренажёра).
// Описываются в data/subjects.json → subject.tools:
//   { "id": "periodic", "icon": "🧪", "title": "Таблица Менделеева", "type": "periodic", "data": "tools/periodic.json" }
// Типы: "periodic" — таблица Менделеева, "mr-calc" — калькулятор Mr,
//       "tables" — набор таблиц (data: {tables:[{title, columns, rows}]}), "image" — картинка (src), "html" — готовый HTML (html).

const toolCache = {};

function initTools() {
    const bar = document.getElementById('tools-bar');
    if (!bar) return;
    const tools = (subject && subject.tools) || [];
    if (!tools.length) { bar.style.display = 'none'; return; }
    bar.innerHTML = '<span class="tools-label">🧰 Помощники:</span>' + tools.map((t, i) =>
        `<button class="tool-btn" onclick="openTool(${i})">${t.icon || '🔧'} ${t.title}</button>`).join('');
    bar.style.display = 'flex';
}

function toolEsc(t) {
    return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function loadToolData(tool) {
    if (!tool.data) return null;
    const url = `data/${subject.id}/${tool.data}`;
    if (!toolCache[url]) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        toolCache[url] = await res.json();
    }
    return toolCache[url];
}

async function openTool(i) {
    const tool = subject.tools[i];
    const modal = document.getElementById('tool-modal');
    document.getElementById('tool-title').textContent = `${tool.icon || ''} ${tool.title}`;
    const body = document.getElementById('tool-body');
    body.innerHTML = '<p class="tool-note">Загрузка…</p>';
    modal.classList.add('open');
    try {
        const data = await loadToolData(tool);
        if (tool.type === 'periodic') renderPeriodic(body, data.elements);
        else if (tool.type === 'mr-calc') renderMrCalc(body, data.elements);
        else if (tool.type === 'tables') renderTables(body, data.tables);
        else if (tool.type === 'image') body.innerHTML = `<img class="tool-img" src="data/${subject.id}/${toolEsc(tool.src)}" alt="${toolEsc(tool.title)}">`;
        else if (tool.type === 'html') body.innerHTML = tool.html || '';
        else body.innerHTML = '<p class="tool-note">Неизвестный тип инструмента</p>';
    } catch (err) {
        body.innerHTML = `<p class="tool-note">Не удалось загрузить: ${toolEsc(err.message)}</p>`;
    }
}

function closeTool() { document.getElementById('tool-modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTool(); });

// ---------- Таблицы ----------
function renderTables(body, tables) {
    body.innerHTML = tables.map(t => `
        <h3 class="tool-h">${toolEsc(t.title)}</h3>
        <div class="tool-scroll"><table class="tool-table">
            <thead><tr>${t.columns.map(c => `<th>${toolEsc(c)}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${toolEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`).join('');
}

// ---------- Таблица Менделеева ----------
const PT_CATS = {
    nonmetal: 'Неметаллы', halogen: 'Галогены', noble: 'Инертные газы', metalloid: 'Полуметаллы',
    alkali: 'Щелочные металлы', alkaline: 'Щёлочноземельные', transition: 'Переходные металлы',
    post: 'Другие металлы', lanthanide: 'Лантаноиды', actinide: 'Актиноиды'
};

function ptPosition(n) {
    // [строка, столбец] в сетке: строка 1 — номера групп, 2–8 — периоды 1–7, 10–11 — лантаноиды/актиноиды
    let r, c;
    if (n === 1) { r = 1; c = 1; }
    else if (n === 2) { r = 1; c = 18; }
    else if (n <= 4) { r = 2; c = n - 2; }
    else if (n <= 10) { r = 2; c = n + 8; }
    else if (n <= 12) { r = 3; c = n - 10; }
    else if (n <= 18) { r = 3; c = n; }
    else if (n <= 36) { r = 4; c = n - 18; }
    else if (n <= 54) { r = 5; c = n - 36; }
    else if (n <= 56) { r = 6; c = n - 54; }
    else if (n <= 71) { r = 9; c = n - 54; }
    else if (n <= 86) { r = 6; c = n - 68; }
    else if (n <= 88) { r = 7; c = n - 86; }
    else if (n <= 103) { r = 10; c = n - 86; }
    else { r = 7; c = n - 100; }
    return [r + 1, c];
}

function renderPeriodic(body, els) {
    let cells = '';
    for (let g = 1; g <= 18; g++) cells += `<div class="pt-head" style="grid-row:1;grid-column:${g}">${g}</div>`;
    cells += `<div class="pt-ph" style="grid-row:7;grid-column:3">57–71</div><div class="pt-ph" style="grid-row:8;grid-column:3">89–103</div>`;
    els.forEach(e => {
        const [r, c] = ptPosition(e.n);
        cells += `<button class="pt-el pt-${e.cat}" style="grid-row:${r};grid-column:${c}" onclick="showElement(${e.n})">
            <span class="pt-n">${e.n}</span><span class="pt-s">${e.s}</span><span class="pt-ar">${e.ar}</span></button>`;
    });
    const legend = Object.entries(PT_CATS).map(([k, v]) => `<span class="pt-leg"><i class="pt-sw pt-${k}"></i>${v}</span>`).join('');
    body.innerHTML = `
        <div class="pt-info" id="pt-info">Нажмите на элемент, чтобы увидеть подробности</div>
        <div class="tool-scroll"><div class="pt-grid">${cells}</div></div>
        <div class="pt-legend">${legend}</div>
        <p class="tool-note">В ячейке: номер элемента, символ, относительная атомная масса (в скобках — массовое число наиболее устойчивого изотопа). Значения округлены, как в школьных таблицах.</p>`;
    window._ptEls = els;
}

function showElement(n) {
    const e = window._ptEls.find(x => x.n === n);
    const [row, col] = ptPosition(n);
    let place;
    if (e.cat === 'lanthanide' || e.cat === 'actinide') place = `${e.cat === 'lanthanide' ? 'лантаноиды' : 'актиноиды'}, период ${e.cat === 'lanthanide' ? 6 : 7}`;
    else place = `период ${row - 1}, группа ${col}`;
    document.getElementById('pt-info').innerHTML =
        `<strong class="pt-big">${e.s}</strong> — <strong>${e.name}</strong> · № ${e.n} · Ar = ${e.ar} · ${place} · ${PT_CATS[e.cat].toLowerCase()}`;
}

// ---------- Калькулятор Mr ----------
function renderMrCalc(body, els) {
    window._mrEls = {};
    els.forEach(e => { window._mrEls[e.s] = parseFloat(String(e.ar).replace(/[\[\]]/g, '')); });
    body.innerHTML = `
        <p class="tool-note" style="margin-top:0">Введите химическую формулу (регистр важен: Co — кобальт, CO — углекислый/угарный газ). Скобки и индексы поддерживаются.</p>
        <div class="mr-row">
            <input id="mr-input" class="mr-input" type="text" value="Al2(SO4)3" autocomplete="off" spellcheck="false" oninput="calcMr()">
            <div class="mr-quick">${['H2O', 'H2SO4', 'CaCO3', 'Al2(SO4)3', 'C6H12O6', 'Ca3(PO4)2'].map(f =>
                `<button class="mode-btn" onclick="document.getElementById('mr-input').value='${f}';calcMr()">${f}</button>`).join('')}</div>
        </div>
        <div id="mr-out" class="mr-out"></div>`;
    calcMr();
}

function parseFormula(str) {
    const SUB = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };
    const s = str.replace(/\s+/g, '').replace(/[₀-₉]/g, ch => SUB[ch]);
    let pos = 0;
    function num() { let m = /^\d+/.exec(s.slice(pos)); if (m) { pos += m[0].length; return parseInt(m[0], 10); } return 1; }
    function group(closing) {
        const counts = {};
        while (pos < s.length) {
            const ch = s[pos];
            if (ch === '(') {
                pos++;
                const inner = group(true);
                const k = num();
                for (const el in inner) counts[el] = (counts[el] || 0) + inner[el] * k;
            } else if (ch === ')') {
                if (!closing) throw new Error('Лишняя закрывающая скобка');
                pos++;
                return counts;
            } else {
                const m = /^[A-Z][a-z]?/.exec(s.slice(pos));
                if (!m) throw new Error(`Непонятный символ «${ch}»`);
                pos += m[0].length;
                const el = m[0];
                if (!(el in window._mrEls)) throw new Error(`Нет элемента «${el}»`);
                const k = num();
                counts[el] = (counts[el] || 0) + k;
            }
        }
        if (closing) throw new Error('Не закрыта скобка');
        return counts;
    }
    const counts = group(false);
    if (!Object.keys(counts).length) throw new Error('Введите формулу');
    return counts;
}

function calcMr() {
    const out = document.getElementById('mr-out');
    const val = document.getElementById('mr-input').value;
    try {
        const counts = parseFormula(val);
        let total = 0;
        const parts = [], rows = [];
        for (const el in counts) {
            const ar = window._mrEls[el], sum = ar * counts[el];
            total += sum;
            parts.push(counts[el] > 1 ? `${counts[el]}·${ar}` : `${ar}`);
            rows.push(`<tr><td>${el}</td><td>${counts[el]}</td><td>${ar}</td><td>${Math.round(sum * 100) / 100}</td></tr>`);
        }
        total = Math.round(total * 100) / 100;
        out.innerHTML = `<div class="mr-result">Mr(${toolEsc(val.trim())}) = ${parts.join(' + ')} = <strong>${total}</strong></div>
            <div class="tool-scroll"><table class="tool-table"><thead><tr><th>Элемент</th><th>Число атомов</th><th>Ar</th><th>Вклад</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    } catch (err) {
        out.innerHTML = `<div class="mr-error">${toolEsc(err.message)}</div>`;
    }
}
