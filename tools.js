// Инструменты-помощники предмета (кнопки в шапке тренажёра).
// Описываются в data/subjects.json → subject.tools:
//   { "id": "periodic", "icon": "🧪", "title": "Таблица Менделеева", "type": "periodic", "data": "tools/periodic.json" }
// Помощники получают контекст открытого параграфа — см. getToolContext() и поле toolContext в JSON параграфа.
// Типы: "periodic" — таблица Менделеева (как в учебнике, с валентностью), "mr-calc" — калькулятор Mr, "valence-calc" — калькулятор валентности,
//       "tables" — набор таблиц (data: {tables:[{title, columns, rows}]}), "image" — картинка (src), "html" — готовый HTML (html).

const toolCache = {};

function initTools() {
    const bar = document.getElementById('tools-bar');
    if (!bar) return;
    const tools = (subject && subject.tools) || [];
    if (!tools.length) { bar.style.display = 'none'; return; }
    bar.innerHTML = '<span class="tools-label">🧰 Помощники:</span>' + tools.map((t, i) =>
        `<button class="tool-btn" id="tool-btn-${i}" onclick="openTool(${i})">${t.icon || '🔧'} ${t.title}</button>`).join('');
    bar.style.display = 'flex';
    initToolDock();
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
    applyDockMode();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.id === `tool-btn-${i}`));
    try {
        const tdata = await loadToolData(tool);
        const ctx = tdata && tdata.elements ? getToolContext(tool, tdata.elements) : null;
        if (tool.type === 'periodic') renderPeriodic(body, tdata.elements, ctx);
        else if (tool.type === 'mr-calc') renderMrCalc(body, tdata.elements, ctx);
        else if (tool.type === 'valence-calc') renderValenceCalc(body, tdata.elements, ctx);
        else if (tool.type === 'tables') renderTables(body, tdata.tables);
        else if (tool.type === 'image') body.innerHTML = `<img class="tool-img" src="data/${subject.id}/${toolEsc(tool.src)}" alt="${toolEsc(tool.title)}">`;
        else if (tool.type === 'html') body.innerHTML = tool.html || '';
        else body.innerHTML = '<p class="tool-note">Неизвестный тип инструмента</p>';
    } catch (err) {
        body.innerHTML = `<p class="tool-note">Не удалось загрузить: ${toolEsc(err.message)}</p>`;
    }
}

// ---------- Контекст открытого параграфа ----------
// Помощник получает формулы из открытого параграфа (переменная data из app.js):
//   1) вручную — data.toolContext[<id или type инструмента>] = { formulas: [...], pairs: [["Fe",3,"O",2]], auto: true }
//   2) автоматически — все химические формулы из текста, карточек, хронографа и теста (если auto !== false).
const SUB_DIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const ROMAN_GROUP = /\((?:VIII|VII|VI|IV|V|III|II|I)\)/g;

function toDigits(str) { return String(str).replace(/[₀-₉]/g, ch => SUB_DIGITS[ch]).replace(/\s+/g, ''); }
function toSubs(str) { return String(str).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]); }

function paragraphLabel() {
    const t = (typeof topicList !== 'undefined' && topicList[topicIndex]) || null;
    return t ? t.num : 'параграфа';
}

function paragraphText(d) {
    if (d === undefined) d = typeof data !== 'undefined' ? data : null;
    if (!d) return '';
    const parts = [d.title, d.subtitle];
    (d.sections || []).forEach(s => {
        parts.push(s.title, s.text, ...(s.chain || []));
        (s.images || []).forEach(i => parts.push(i.caption));
    });
    (d.flashcards || []).forEach(c => parts.push(c.q, c.a));
    (d.timeline || []).forEach(t => parts.push(t.date, t.title, t.text));
    // из теста — только вопрос и правильный ответ: неверные варианты часто содержат ошибочные формулы
    (d.quiz || []).forEach(q => parts.push(q.q, (q.opts || [])[q.correct]));
    return parts.filter(Boolean).join('\n').replace(/[{}]/g, '');
}

// Разбор формулы без скобок-валентностей: { counts, distinct, maxIndex } или null
function formulaInfo(norm, symbols) {
    if (!/^[A-Z(][A-Za-z0-9()]*$/.test(norm)) return null;
    let pos = 0, maxIndex = 1;
    const counts = {};
    function num() { const m = /^\d+/.exec(norm.slice(pos)); if (m) { pos += m[0].length; return +m[0]; } return 1; }
    function group(closing) {
        const c = {};
        while (pos < norm.length) {
            const ch = norm[pos];
            if (ch === '(') {
                pos++;
                const inner = group(true); if (!inner) return null;
                const k = num(); maxIndex = Math.max(maxIndex, k);
                for (const el in inner) c[el] = (c[el] || 0) + inner[el] * k;
            } else if (ch === ')') {
                if (!closing) return null;
                pos++; return c;
            } else {
                const m = /^[A-Z][a-z]?/.exec(norm.slice(pos));
                if (!m || !symbols.has(m[0])) return null;
                pos += m[0].length;
                const k = num(); maxIndex = Math.max(maxIndex, k);
                c[m[0]] = (c[m[0]] || 0) + k;
            }
        }
        return closing ? null : c;
    }
    const res = group(false);
    if (!res) return null;
    Object.assign(counts, res);
    return { counts, distinct: Object.keys(counts).length, maxIndex };
}

function closingParen(str, open) {
    let depth = 0;
    for (let i = open; i < str.length; i++) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

function extractFormulas(text, symbols) {
    const found = [], seen = new Set();
    const re = /(?<![A-Za-z0-9])[A-Z(][A-Za-z0-9₀-₉()]*/g;
    let m;
    while ((m = re.exec(text))) {
        let tok = toDigits(m[0]);
        if (ROMAN_GROUP.test(tok)) { ROMAN_GROUP.lastIndex = 0; continue; } // P(V)O(II), Fe(III) — запись валентности
        tok = tok.replace(/^(?:Ar|Mr)\(/, '(');
        while (tok.endsWith(')') && (tok.match(/\(/g) || []).length < (tok.match(/\)/g) || []).length) tok = tok.slice(0, -1);
        if (tok.startsWith('(') && closingParen(tok, 0) === tok.length - 1) tok = tok.slice(1, -1);
        if (!tok || /^[IVX]+$/.test(tok) || seen.has(tok)) continue;
        const info = formulaInfo(tok, symbols);
        if (!info) continue;
        if (info.distinct < 2 && info.maxIndex < 2) continue; // одиночный символ — не формула
        seen.add(tok);
        found.push(tok);
    }
    return found;
}

function getToolContext(tool, els) {
    const symbols = new Set(els.map(e => e.s));
    const all = (typeof data !== 'undefined' && data && data.toolContext) || {};
    const own = all[tool.id] || all[tool.type] || {};
    const manual = (own.formulas || []).map(toDigits).filter(f => formulaInfo(f, symbols));
    const auto = own.auto === false ? [] : extractFormulas(paragraphText(), symbols);
    const formulas = [...new Set([...manual, ...auto])];
    return { label: paragraphLabel(), formulas, pairs: own.pairs || [], elements: extractElements(paragraphText(), formulas, symbols) };
}

// Элементы параграфа: из формул + отдельно стоящие символы (Mg, S, Fe…). I и V пропускаем — это римские цифры.
function extractElements(text, formulas, symbols) {
    const set = new Set();
    formulas.forEach(f => (f.match(/[A-Z][a-z]?/g) || []).forEach(el => symbols.has(el) && set.add(el)));
    const re = /(?<![A-Za-z0-9₀-₉])([A-Z][a-z]?)(?![A-Za-z0-9₀-₉(])/g;
    let m;
    while ((m = re.exec(text))) if (symbols.has(m[1]) && m[1] !== 'I' && m[1] !== 'V') set.add(m[1]);
    return set;
}

function ctxChips(list, onclickFn) {
    return list.map(f => `<button class="mode-btn ctx-chip" onclick="${onclickFn}('${f}')">${toSubs(f)}</button>`).join('');
}

// ---------- Режимы окна помощника ----------
// modal — окно по центру с затемнением; right / bottom — закреплён сбоку / снизу, урок можно проходить;
// float — плавающее окно (перетаскивание за шапку, размер — за правый нижний угол).
const DOCK_MODES = [
    ['modal', '⛶', 'В окне по центру'],
    ['right', '◧', 'Закрепить справа'],
    ['bottom', '⬓', 'Закрепить снизу'],
    ['float', '🪟', 'Плавающее окно']
];
const dockState = { mode: 'modal', right: 560, bottom: 340, fx: null, fy: 90, fw: 560, fh: 520 };

function dockLoad() {
    try { Object.assign(dockState, JSON.parse(localStorage.getItem('toolDock') || '{}')); } catch (e) { /* хранилище недоступно */ }
}
function dockSave() {
    try { localStorage.setItem('toolDock', JSON.stringify(dockState)); } catch (e) { /* хранилище недоступно */ }
}

function initToolDock() {
    dockLoad();
    const header = document.querySelector('#tool-modal .tool-header');
    if (!header || header.querySelector('.dock-btns')) return;
    const close = header.querySelector('.tool-close');
    const box = document.createElement('div');
    box.className = 'dock-btns';
    box.innerHTML = DOCK_MODES.map(([m, icon, title]) =>
        `<button class="dock-btn" data-mode="${m}" title="${title}" aria-label="${title}" onclick="setDockMode('${m}')">${icon}</button>`).join('');
    header.insertBefore(box, close);
    const dialog = document.querySelector('#tool-modal .tool-dialog');
    const handle = document.createElement('div');
    handle.className = 'dock-handle';
    dialog.appendChild(handle);
    handle.addEventListener('pointerdown', dockResizeStart);
    header.addEventListener('pointerdown', dockDragStart);
    window.addEventListener('resize', () => { if (document.getElementById('tool-modal').classList.contains('open')) applyDockMode(); });
    // Плавающее окно: размер, изменённый мышью, запоминаем
    if (window.ResizeObserver) new ResizeObserver(() => {
        if (effectiveMode() === 'float' && document.getElementById('tool-modal').classList.contains('open')) {
            dockState.fw = dialog.offsetWidth; dockState.fh = dialog.offsetHeight; dockSave();
        }
    }).observe(dialog);
}

function effectiveMode() {
    // на узком экране «справа» превращается в «снизу»
    return dockState.mode === 'right' && window.innerWidth < 760 ? 'bottom' : dockState.mode;
}

function setDockMode(mode) {
    dockState.mode = mode;
    dockSave();
    applyDockMode();
}

function applyDockMode() {
    const modal = document.getElementById('tool-modal');
    const dialog = modal.querySelector('.tool-dialog');
    const open = modal.classList.contains('open');
    const mode = effectiveMode();
    DOCK_MODES.forEach(([m]) => modal.classList.toggle('mode-' + m, m === mode));
    modal.querySelectorAll('.dock-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === dockState.mode));
    document.body.classList.toggle('dock-right', open && mode === 'right');
    document.body.classList.toggle('dock-bottom', open && mode === 'bottom');
    document.documentElement.style.setProperty('--dock-right', dockState.right + 'px');
    document.documentElement.style.setProperty('--dock-bottom', dockState.bottom + 'px');
    dialog.style.cssText = '';
    if (mode === 'float') {
        const w = Math.min(dockState.fw, window.innerWidth - 20), h = Math.min(dockState.fh, window.innerHeight - 20);
        const x = dockState.fx == null ? window.innerWidth - w - 20 : Math.min(Math.max(0, dockState.fx), window.innerWidth - 80);
        const y = Math.min(Math.max(0, dockState.fy), window.innerHeight - 50);
        dialog.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    }
    document.dispatchEvent(new Event('tooldock'));
}

function dockDragStart(e) {
    if (effectiveMode() !== 'float' || e.target.closest('button')) return;
    const dialog = document.querySelector('#tool-modal .tool-dialog');
    const sx = e.clientX - dialog.offsetLeft, sy = e.clientY - dialog.offsetTop;
    const move = ev => {
        dockState.fx = Math.min(Math.max(0, ev.clientX - sx), window.innerWidth - 80);
        dockState.fy = Math.min(Math.max(0, ev.clientY - sy), window.innerHeight - 50);
        dialog.style.left = dockState.fx + 'px'; dialog.style.top = dockState.fy + 'px';
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); dockSave(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    e.preventDefault();
}

function dockResizeStart(e) {
    const mode = effectiveMode();
    if (mode !== 'right' && mode !== 'bottom') return;
    const move = ev => {
        if (mode === 'right') dockState.right = Math.min(Math.max(300, window.innerWidth - ev.clientX), window.innerWidth - 320);
        else dockState.bottom = Math.min(Math.max(180, window.innerHeight - ev.clientY), window.innerHeight - 160);
        document.documentElement.style.setProperty('--dock-right', dockState.right + 'px');
        document.documentElement.style.setProperty('--dock-bottom', dockState.bottom + 'px');
        document.dispatchEvent(new Event('tooldock'));
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); dockSave(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    e.preventDefault();
}

function closeTool() {
    document.getElementById('tool-modal').classList.remove('open');
    document.body.classList.remove('dock-right', 'dock-bottom');
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
}
// Esc закрывает только окно по центру: закреплённый помощник не должен пропадать во время урока
document.addEventListener('keydown', e => { if (e.key === 'Escape' && effectiveMode() === 'modal') closeTool(); });

// ---------- Таблицы ----------
function renderTables(body, tables) {
    body.innerHTML = tables.map(t => `
        <h3 class="tool-h">${toolEsc(t.title)}</h3>
        <div class="tool-scroll"><table class="tool-table">
            <thead><tr>${t.columns.map(c => `<th>${toolEsc(c)}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${toolEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`).join('');
}

// ---------- Таблица Менделеева (как в учебнике) ----------
// Длиннопериодная форма: 18 групп, подписи групп IA…VIIIA / IIIB…IIB, цвета блоков,
// красная ломаная линия, лантаниды и актиниды отдельными рядами. В ячейке — номер, символ,
// название и относительная атомная масса (поле m в periodic.json, как в таблице учебника).
const PT_ROMAN_A = { 1: 'IA', 2: 'IIA', 13: 'IIIA', 14: 'IVA', 15: 'VA', 16: 'VIA', 17: 'VIIA', 18: 'VIIIA' };
const PT_ROMAN_B = { 3: 'IIIB', 4: 'IVB', 5: 'VB', 6: 'VIB', 7: 'VIIB', 8: 'VIIIB', 9: 'VIIIB', 10: 'VIIIB', 11: 'IB', 12: 'IIB' };
// Элементы выше/правее красной линии таблицы учебника
const PT_RED = new Set(['H', 'He', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Si', 'P', 'S', 'Cl', 'Ar', 'As', 'Se', 'Br', 'Kr', 'Te', 'I', 'Xe', 'At', 'Rn', 'Og']);
// строка сетки для каждого периода (между ними — строки с подписями групп)
const PT_ROW = { 1: 4, 2: 6, 3: 7, 4: 9, 5: 10, 6: 11, 7: 12 };

function ptPlace(n) {
    let period, group, f = false;
    if (n === 1) { period = 1; group = 1; }
    else if (n === 2) { period = 1; group = 18; }
    else if (n <= 10) { period = 2; group = n <= 4 ? n - 2 : n + 8; }
    else if (n <= 18) { period = 3; group = n <= 12 ? n - 10 : n; }
    else if (n <= 36) { period = 4; group = n - 18; }
    else if (n <= 54) { period = 5; group = n - 36; }
    else if (n <= 57) { period = 6; group = n - 54; }
    else if (n <= 71) { period = 6; group = n - 54; f = true; }
    else if (n <= 86) { period = 6; group = n - 68; }
    else if (n <= 89) { period = 7; group = n - 86; }
    else if (n <= 103) { period = 7; group = n - 86; f = true; }
    else { period = 7; group = n - 100; }
    let row, col;
    if (f) { row = period === 6 ? 14 : 16; col = (period === 6 ? n - 58 : n - 90) + 5; }
    else { row = PT_ROW[period]; col = group + 1; }
    const block = f ? 'f' : (group <= 2 || n === 2) ? 's' : group >= 13 ? 'p' : 'd';
    return { period, group: f ? 3 : group, f, row, col, block };
}

function ptGroupLabel(pl) {
    if (pl.f) return `${pl.period === 6 ? 'лантаниды' : 'актиниды'} (группа 3, ${PT_ROMAN_B[3]})`;
    return `группа ${pl.group} (${PT_ROMAN_A[pl.group] || PT_ROMAN_B[pl.group]})`;
}

function ptRedEdges(e, byPos) {
    if (!PT_RED.has(e.s)) return '';
    const pl = ptPlace(e.n);
    if (e.s === 'H') return 'pt-red-t pt-red-r pt-red-b pt-red-l';
    const nb = (dr, dg) => byPos[`${pl.period + dr}:${pl.group + dg}`];
    const cls = [];
    const isMetal = x => x && !PT_RED.has(x.s);
    if (isMetal(nb(0, -1)) || (!nb(0, -1) && pl.group === 13)) cls.push('pt-red-l');
    if (isMetal(nb(1, 0)) || (pl.period === 7)) cls.push('pt-red-b');
    if (isMetal(nb(-1, 0))) cls.push('pt-red-t');
    return cls.join(' ');
}

function renderPeriodic(body, els, ctx) {
    window._ptEls = els;
    window._mrEls = window._mrEls || {};
    els.forEach(e => { window._mrEls[e.s] = parseFloat(String(e.ar).replace(/[\[\]]/g, '')); });
    window._valEls = window._valEls || els;
    window._ptCtx = ctx;
    const byPos = {};
    els.forEach(e => { const pl = ptPlace(e.n); if (!pl.f) byPos[`${pl.period}:${pl.group}`] = e; });

    let cells = '<div class="pt-corner" style="grid-row:1/3;grid-column:1">периоды</div>';
    cells += '<div class="pt-groups-title" style="grid-row:1;grid-column:2/20">группы элементов</div>';
    for (let g = 1; g <= 18; g++) cells += `<div class="pt-gnum" style="grid-row:2;grid-column:${g + 1}">${g}</div>`;
    // подписи групп: IA и VIIIA над 1-м периодом, IIA и IIIA…VIIA над 2-м, побочные — над 4-м
    const lab = (row, col, text, span) => `<div class="pt-roman" style="grid-row:${row};grid-column:${col}${span ? ' / span ' + span : ''}">${text}</div>`;
    cells += lab(PT_ROW[1] - 1, 2, 'IA') + lab(PT_ROW[1] - 1, 19, 'VIIIA') + lab(PT_ROW[2] - 1, 3, 'IIA');
    for (let g = 13; g <= 17; g++) cells += lab(PT_ROW[2] - 1, g + 1, PT_ROMAN_A[g]);
    for (let g = 3; g <= 7; g++) cells += lab(PT_ROW[4] - 1, g + 1, PT_ROMAN_B[g]);
    cells += lab(PT_ROW[4] - 1, 9, 'VIIIB', 3) + lab(PT_ROW[4] - 1, 12, 'IB') + lab(PT_ROW[4] - 1, 13, 'IIB');
    for (let p = 1; p <= 7; p++) cells += `<div class="pt-period" style="grid-row:${PT_ROW[p]};grid-column:1">${p}</div>`;
    cells += `<div class="pt-fam" style="grid-row:13;grid-column:5/19">Лантаниды</div><div class="pt-fam" style="grid-row:15;grid-column:5/19">Актиниды</div>`;
    els.forEach(e => {
        const pl = ptPlace(e.n);
        const mark = (e.n === 57 || e.n === 89) ? '<i class="pt-dot"></i>' : '';
        cells += `<button class="pt-cell pt-${pl.block} ${ptRedEdges(e, byPos)}" style="grid-row:${pl.row};grid-column:${pl.col}" data-s="${e.s}" onclick="showElement(${e.n})">
            <span class="pt-num">${e.n}</span><span class="pt-sym">${e.s}</span><span class="pt-name">${toolEsc(e.name)}</span><span class="pt-mass">${toolEsc(e.m || e.ar)}</span>${mark}</button>`;
    });
    cells += `<div class="pt-info" id="pt-info" style="grid-row:4/8;grid-column:4/14"></div>`;

    const ctxEls = ctx ? [...ctx.elements] : [];
    body.innerHTML = `
        <div class="pt-toolbar">
            ${ctxEls.length ? `<button class="mode-btn" id="pt-hl-btn" onclick="ptToggleHighlight()">📖 Элементы ${toolEsc(ctx.label)} (${ctxEls.length})</button>` : ''}
            <span class="tool-note" style="margin:0">Нажмите на элемент — появятся сведения и валентность.</span>
        </div>
        <div class="pt-fit" id="pt-fit"><div class="pt-table" id="pt-table">${cells}</div></div>
        <div class="pt-info-out" id="pt-info-out"></div>`;
    showElement(null);
    ptFit();
    if (!window._ptFitBound) {
        window._ptFitBound = true;
        window.addEventListener('resize', ptFit);
        document.addEventListener('tooldock', ptFit);
        if (window.ResizeObserver) new ResizeObserver(ptFit).observe(document.getElementById('tool-body'));
    }
    ptBuildValenceIndex();
}

// Масштаб таблицы под ширину окна помощника; на совсем узкой панели — прокрутка
function ptFit() {
    const fit = document.getElementById('pt-fit'), table = document.getElementById('pt-table');
    if (!fit || !table) return;
    table.style.zoom = 1;
    let k = (fit.clientWidth - 2) / table.scrollWidth;
    // в окне по центру и в плавающем окне — вписываем ещё и по высоте; у закреплённых панелей высота прокручивается
    const mode = effectiveMode();
    if (mode === 'modal' || mode === 'float') {
        const body = document.getElementById('tool-body');
        const availH = body.getBoundingClientRect().bottom - fit.getBoundingClientRect().top - 20;
        if (availH > 150) k = Math.min(k, availH / table.scrollHeight);
    }
    const zoom = Math.max(0.45, Math.min(1, k));
    table.style.zoom = zoom;
    // таблица сильно уменьшена — сведения об элементе показываем под ней в обычном размере
    document.getElementById('tool-body').classList.toggle('pt-compact', zoom < 0.72);
}

function ptToggleHighlight() {
    const t = document.getElementById('pt-table'), btn = document.getElementById('pt-hl-btn');
    const on = !t.classList.contains('pt-hl');
    t.classList.toggle('pt-hl', on);
    btn.classList.toggle('active', on);
    const set = window._ptCtx ? window._ptCtx.elements : new Set();
    t.querySelectorAll('.pt-cell').forEach(c => c.classList.toggle('pt-ctx', set.has(c.dataset.s)));
}

// Индекс «элемент → формулы из учебника с определённой валентностью» по всем параграфам предмета
async function ptBuildValenceIndex() {
    if (window._ptValIndex || typeof topicList === 'undefined') return;
    const symbols = new Set((window._ptEls || []).map(e => e.s));
    const index = {};
    const results = await Promise.all(topicList.map(t =>
        fetch(`data/${subject.id}/p${t.p}.json`).then(r => r.ok ? r.json() : null).then(d => [t, d]).catch(() => [t, null])));
    results.forEach(([t, d]) => {
        if (!d) return;
        const own = (d.toolContext && (d.toolContext.valence || d.toolContext['valence-calc'])) || {};
        const formulas = [...new Set([...(own.formulas || []).map(toDigits), ...extractFormulas(paragraphText(d), symbols)])];
        formulas.forEach(f => {
            const r = valSolveTextbook(f);
            if (!r) return;
            [[r.a, r.va], [r.b, r.vb]].forEach(([el, v]) => {
                const list = index[el] = index[el] || [];
                let item = list.find(x => x.f === f);
                if (!item) list.push(item = { f, v, paras: [] });
                if (!item.paras.includes(t.num)) item.paras.push(t.num);
            });
        });
    });
    window._ptValIndex = index;
    if (window._ptSelected) showElement(window._ptSelected);
}

function showElement(n) {
    const inGrid = document.getElementById('pt-info'), below = document.getElementById('pt-info-out');
    if (!inGrid) return;
    const box = { set innerHTML(html) { inGrid.innerHTML = html; if (below) below.innerHTML = html; } };
    window._ptSelected = n;
    document.querySelectorAll('.pt-cell.sel').forEach(c => c.classList.remove('sel'));
    if (!n) {
        const ca = window._ptEls.find(x => x.n === 20);
        box.innerHTML = `<div class="pt-legend-box">
            <div class="pt-legend-labels"><span>Атомный номер →</span><span>Символ элемента →</span><span>Название элемента →</span><span>Относительная атомная масса →</span></div>
            <div class="pt-bigcell pt-s"><span class="pt-num">${ca.n}</span><span class="pt-sym">${ca.s}</span><span class="pt-name">${ca.name}</span><span class="pt-mass">${ca.m}</span></div></div>`;
        return;
    }
    const e = window._ptEls.find(x => x.n === n);
    const pl = ptPlace(n);
    document.querySelector(`.pt-cell[data-s="${e.s}"]`)?.classList.add('sel');
    let val;
    if (e.s in VAL_CONST) val = `Постоянная валентность: <b>${valRoman(VAL_CONST[e.s])}</b>`;
    else if (e.s in VAL_VAR) val = `Переменная валентность: <b>${VAL_VAR[e.s].map(valRoman).join(', ')}</b>`;
    else val = '<span class="pt-muted">В таблице постоянной и переменной валентности (§ 9) элемента нет.</span>';
    const idx = window._ptValIndex;
    let ex = '';
    if (!idx) ex = '<div class="pt-muted">Ищу формулы в параграфах…</div>';
    else if (idx[e.s] && idx[e.s].length) ex = `<div class="pt-ex-title">В формулах учебника:</div><div class="pt-ex">${idx[e.s].map(x =>
        `<span class="pt-chip" title="${x.paras.join(', ')}">${toSubs(x.f)} — ${valRoman(x.v)} <small>${x.paras.join(', ')}</small></span>`).join('')}</div>`;
    const ctx = window._ptCtx;
    let here = '';
    if (ctx && ctx.elements.has(e.s)) {
        const fs = ctx.formulas.filter(f => (f.match(/[A-Z][a-z]?/g) || []).includes(e.s));
        here = `<div class="pt-here">📖 Есть в ${toolEsc(ctx.label)}${fs.length ? ': ' + fs.map(toSubs).join(', ') : ''}</div>`;
    }
    box.innerHTML = `<div class="pt-detail">
        <div class="pt-bigcell pt-${pl.block}"><span class="pt-num">${e.n}</span><span class="pt-sym">${e.s}</span><span class="pt-name">${toolEsc(e.name)}</span><span class="pt-mass">${toolEsc(e.m || e.ar)}</span></div>
        <div class="pt-detail-text">
            <div class="pt-title">${toolEsc(e.name)} <span class="pt-muted">· № ${e.n}</span></div>
            <div>Период ${pl.period}, ${ptGroupLabel(pl)}</div>
            <div>Ar = ${toolEsc(e.m || e.ar)}${e.ar !== e.m && !/\[/.test(e.ar) ? ` <span class="pt-muted">(в расчётах ${e.ar})</span>` : ''}</div>
            <div class="pt-val">${val}</div>
            ${ex}${here}
        </div></div>`;
}

// ---------- Калькулятор Mr ----------
function renderMrCalc(body, els, ctx) {
    window._mrEls = {};
    els.forEach(e => { window._mrEls[e.s] = parseFloat(String(e.ar).replace(/[\[\]]/g, '')); });
    const own = ctx ? ctx.formulas : [];
    body.innerHTML = `
        <p class="tool-note" style="margin-top:0">Введите химическую формулу (регистр важен: Co — кобальт, CO — углекислый/угарный газ). Скобки и индексы поддерживаются.</p>
        <div class="mr-row">
            <input id="mr-input" class="mr-input" type="text" value="${own[0] || 'Al2(SO4)3'}" autocomplete="off" spellcheck="false" oninput="calcMr()">
            ${own.length ? `<div class="ctx-box"><span class="ctx-label">📖 Из ${toolEsc(ctx.label)}:</span>${ctxChips(own, 'mrPick')}</div>` : ''}
            <div class="mr-quick">${own.length ? '<span class="ctx-label">Примеры:</span>' : ''}${['H2O', 'H2SO4', 'CaCO3', 'Al2(SO4)3', 'C6H12O6', 'Ca3(PO4)2'].map(f =>
                `<button class="mode-btn" onclick="document.getElementById('mr-input').value='${f}';calcMr()">${f}</button>`).join('')}</div>
        </div>
        <div id="mr-out" class="mr-out"></div>`;
    calcMr();
}

function mrPick(f) { document.getElementById('mr-input').value = f; calcMr(); }

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

// ---------- Калькулятор валентности (по § 9 «Валентность») ----------
// Постоянная и переменная валентность — как в учебнике химии 7 класса.
const VAL_CONST = { H: 1, Ag: 1, Na: 1, K: 1, O: 2, Mg: 2, Ca: 2, Zn: 2, Al: 3 };
const VAL_VAR = { S: [2, 4, 6], N: [1, 2, 3, 4, 5], P: [3, 5], Fe: [2, 3], Cu: [1, 2], Cl: [1, 3, 5, 7] };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const SUBS = '₀₁₂₃₄₅₆₇₈₉';

function valRoman(n) { return ROMAN[n] || String(n); }
function valSub(n) { return n === 1 ? '' : String(n).replace(/\d/g, d => SUBS[d]); }
function valGcd(a, b) { return b ? valGcd(b, a % b) : a; }
function valLcm(a, b) { return a / valGcd(a, b) * b; }
function valName(s) { const e = (window._valEls || []).find(x => x.s === s); return e ? e.name : s; }
function valHint(s) {
    if (s in VAL_CONST) return `постоянная валентность ${valRoman(VAL_CONST[s])}`;
    if (s in VAL_VAR) return `переменная валентность: ${VAL_VAR[s].map(valRoman).join(', ')}`;
    return '';
}

function renderValenceCalc(body, els, ctx) {
    window._mrEls = window._mrEls || {};
    els.forEach(e => { window._mrEls[e.s] = parseFloat(String(e.ar).replace(/[\[\]]/g, '')); });
    window._valEls = els;
    // Контекст: бинарные формулы параграфа, где валентность можно определить, и пары элементов
    const ctxF = [], ctxP = [], pKeys = new Set();
    const addPair = (a, av, b, bv) => {
        const k = `${a}${av}${b}${bv}`;
        if (!pKeys.has(k)) { pKeys.add(k); ctxP.push([a, +av, b, +bv]); }
    };
    if (ctx) {
        ctx.pairs.forEach(p => addPair(...p));
        ctx.formulas.forEach(f => {
            // только значения, которые согласуются с учебником (SO₄ как группа дала бы S(VIII) — отбрасываем)
            const r = valSolveTextbook(f);
            if (r) { ctxF.push(f); addPair(r.a, r.va, r.b, r.vb); }
        });
    }
    const p0 = ctxP[0] || ['Fe', 3, 'O', 2];
    const opts = sel => ROMAN.slice(1).map((r, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${r}</option>`).join('');
    body.innerHTML = `
        <div class="val-tabs">
            <button class="mode-btn active" id="val-tab-1" onclick="valTab(1)">🔍 Валентность по формуле</button>
            <button class="mode-btn" id="val-tab-2" onclick="valTab(2)">✍️ Формула по валентности</button>
        </div>
        <div id="val-pane-1">
            <p class="tool-note" style="margin-top:0">Введите формулу бинарного соединения (из двух элементов). Один из элементов должен иметь постоянную валентность: H, Ag, Na, K (I); O, Mg, Ca, Zn (II); Al (III).</p>
            <div class="mr-row">
                <input id="val-input" class="mr-input" type="text" value="${ctxF[0] || 'Fe2O3'}" autocomplete="off" spellcheck="false" oninput="calcValence()">
                ${ctxF.length ? `<div class="ctx-box"><span class="ctx-label">📖 Из ${toolEsc(ctx.label)}:</span>${ctxChips(ctxF, 'valPick')}</div>` : ''}
                <div class="mr-quick">${ctxF.length ? '<span class="ctx-label">Примеры:</span>' : ''}${['SO3', 'SO2', 'NH3', 'CH4', 'Fe2O3', 'P2O5', 'Cl2O7', 'CaCl2', 'Na2S'].map(f =>
                    `<button class="mode-btn" onclick="document.getElementById('val-input').value='${f}';calcValence()">${f}</button>`).join('')}</div>
            </div>
            <div id="val-out" class="mr-out"></div>
        </div>
        <div id="val-pane-2" style="display:none">
            <p class="tool-note" style="margin-top:0">Введите символы двух элементов и их валентности. Для элементов с постоянной валентностью она подставится сама.</p>
            <div class="val-pair">
                <input id="val-a" class="mr-input val-el" type="text" value="${p0[0]}" autocomplete="off" spellcheck="false" oninput="valAuto('a');buildFormula()">
                <select id="val-av" class="val-sel" onchange="buildFormula()">${opts(p0[1])}</select>
                <span class="val-plus">+</span>
                <input id="val-b" class="mr-input val-el" type="text" value="${p0[2]}" autocomplete="off" spellcheck="false" oninput="valAuto('b');buildFormula()">
                <select id="val-bv" class="val-sel" onchange="buildFormula()">${opts(p0[3])}</select>
            </div>
            ${ctxP.length ? `<div class="ctx-box" style="margin-top:8px"><span class="ctx-label">📖 Из ${toolEsc(ctx.label)}:</span>${ctxP.map(([a, av, b, bv]) =>
                `<button class="mode-btn ctx-chip" onclick="valSet('${a}',${av},'${b}',${bv})">${a}(${valRoman(av)}) + ${b}(${valRoman(bv)})</button>`).join('')}</div>` : ''}
            <div class="mr-quick" style="margin:8px 0 12px">${ctxP.length ? '<span class="ctx-label">Примеры:</span>' : ''}${[['N', 3, 'O', 2], ['P', 5, 'O', 2], ['C', 4, 'O', 2], ['Al', 3, 'O', 2], ['Fe', 3, 'S', 2], ['Mg', 2, 'P', 3], ['Cu', 1, 'O', 2]].map(([a, av, b, bv]) =>
                `<button class="mode-btn" onclick="valSet('${a}',${av},'${b}',${bv})">${a}(${valRoman(av)}) + ${b}(${valRoman(bv)})</button>`).join('')}</div>
            <div id="val-out2" class="mr-out"></div>
        </div>
        <p class="tool-note">Правило: в формуле бинарного соединения общее число единиц валентности одного элемента равно общему числу единиц валентности другого. Общее число единиц = валентность × индекс.</p>`;
    calcValence();
    buildFormula();
}

function valPick(f) { document.getElementById('val-input').value = f; calcValence(); }

function valTab(n) {
    [1, 2].forEach(i => {
        document.getElementById('val-pane-' + i).style.display = i === n ? '' : 'none';
        document.getElementById('val-tab-' + i).classList.toggle('active', i === n);
    });
}

function valSet(a, av, b, bv) {
    document.getElementById('val-a').value = a; document.getElementById('val-av').value = av;
    document.getElementById('val-b').value = b; document.getElementById('val-bv').value = bv;
    buildFormula();
}

function valAuto(side) {
    const s = document.getElementById('val-' + side).value.trim();
    if (s in VAL_CONST) document.getElementById(`val-${side}v`).value = VAL_CONST[s];
    else if (s in VAL_VAR && !VAL_VAR[s].includes(+document.getElementById(`val-${side}v`).value))
        document.getElementById(`val-${side}v`).value = VAL_VAR[s][0];
}

// Чистый расчёт: валентность по формуле бинарного соединения. Бросает Error, если определить нельзя.
function valSolve(raw) {
    raw = String(raw).trim();
    if (/[()]/.test(raw)) throw new Error('Скобки не поддерживаются: введите бинарное соединение, например Fe2O3');
    const s = toDigits(raw);
    const order = [], idx = {};
    const re = /([A-Z][a-z]?)(\d*)/g;
    let m, consumed = '';
    while ((m = re.exec(s)) && m[0]) {
        const el = m[1];
        if (!(el in window._mrEls)) throw new Error(`Нет элемента «${el}»`);
        if (!(el in idx)) order.push(el);
        idx[el] = (idx[el] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
        consumed += m[0];
    }
    if (!s) throw new Error('Введите формулу');
    if (consumed !== s) throw new Error('Непонятная запись формулы');
    if (order.length !== 2) throw new Error('Нужно бинарное соединение — ровно два элемента');
    const [a, b] = order;
    const knownEl = b in VAL_CONST ? b : a in VAL_CONST ? a : null;
    if (!knownEl) throw new Error(`Ни у ${a}, ни у ${b} нет постоянной валентности — по этой формуле валентность не определить`);
    const unk = knownEl === a ? b : a;
    const kv = VAL_CONST[knownEl], total = kv * idx[knownEl];
    const x = total / idx[unk];
    const valid = Number.isInteger(x) && x >= 1 && x <= 8 && !(unk in VAL_CONST && VAL_CONST[unk] !== x);
    const r = { a, b, idx, knownEl, unk, kv, total, x, valid };
    r.va = unk === a ? x : kv;
    r.vb = unk === b ? x : kv;
    if (!valid) { const e = new Error('Валентность определить нельзя'); e.result = r; throw e; }
    return r;
}

// Валентность по формуле, только если значение согласуется с учебником (иначе null)
function valSolveTextbook(f) {
    try {
        const r = valSolve(f);
        if (r.x > 7 || (r.unk in VAL_VAR && !VAL_VAR[r.unk].includes(r.x))) return null;
        return r;
    } catch (e) { return null; }
}

function calcValence() {
    const out = document.getElementById('val-out');
    const raw = document.getElementById('val-input').value.trim();
    let r;
    try {
        r = valSolve(raw);
    } catch (err) {
        if (!err.result) { out.innerHTML = `<div class="mr-error">${toolEsc(err.message)}</div>`; return; }
        r = err.result;
    }
    const { a, b, idx, knownEl, unk, kv, total, x } = r;
    const fml = `${a}${valSub(idx[a])}${b}${valSub(idx[b])}`;
    const steps = `<div class="val-step">1) ${knownEl} — ${valName(knownEl)}, постоянная валентность <b>${valRoman(kv)}</b></div>
        <div class="val-step">2) Общее число единиц валентности ${knownEl}: ${valRoman(kv)} · ${idx[knownEl]} = <b>${total}</b></div>
        <div class="val-step">3) Столько же единиц у ${unk}: x · ${idx[unk]} = ${total}, x = ${total} : ${idx[unk]} = <b>${Number.isInteger(x) ? x : x.toFixed(2)}</b></div>`;
    if (!Number.isInteger(x) || x < 1 || x > 8) {
        out.innerHTML = steps + `<div class="mr-error">Валентность получилась не целым числом — проверьте формулу.</div>`;
        return;
    }
    let note = '';
    if (unk in VAL_CONST && VAL_CONST[unk] !== x) note = `<div class="mr-error">У ${unk} постоянная валентность ${valRoman(VAL_CONST[unk])} — такая формула неверна.</div>`;
    else if (unk in VAL_VAR && !VAL_VAR[unk].includes(x)) note = `<div class="tool-note">В учебнике для ${unk} указаны значения ${VAL_VAR[unk].map(valRoman).join(', ')}.</div>`;
    else if (valHint(unk)) note = `<div class="tool-note">${unk}: ${valHint(unk)}.</div>`;
    out.innerHTML = `<div class="val-formula"><span class="val-cell"><i>${valRoman(r.va)}</i>${a}${valSub(idx[a])}</span><span class="val-cell"><i>${valRoman(r.vb)}</i>${b}${valSub(idx[b])}</span></div>
        <div class="mr-result">Валентность ${unk} (${valName(unk)}) в ${fml} = <strong>${valRoman(x)}</strong></div>${steps}${note}`;
}

function buildFormula() {
    const out = document.getElementById('val-out2');
    const a = document.getElementById('val-a').value.trim(), b = document.getElementById('val-b').value.trim();
    const av = +document.getElementById('val-av').value, bv = +document.getElementById('val-bv').value;
    try {
        [a, b].forEach(el => {
            if (!el) throw new Error('Введите символы обоих элементов');
            if (!/^[A-Z][a-z]?$/.test(el) || !(el in window._mrEls)) throw new Error(`Нет элемента «${el}» (регистр важен: Fe, Cl, O)`);
        });
        if (a === b) throw new Error('Нужны два разных элемента');
        const warn = [];
        [[a, av], [b, bv]].forEach(([el, v]) => {
            if (el in VAL_CONST && VAL_CONST[el] !== v) warn.push(`У ${el} постоянная валентность ${valRoman(VAL_CONST[el])}.`);
            if (el in VAL_VAR && !VAL_VAR[el].includes(v)) warn.push(`В учебнике для ${el} указаны значения ${VAL_VAR[el].map(valRoman).join(', ')}.`);
        });
        const lcm = valLcm(av, bv), ia = lcm / av, ib = lcm / bv;
        const g = valGcd(bv, av);
        const fml = `${a}${valSub(ia)}${b}${valSub(ib)}`;
        const cross = `${a}${valSub(bv)}${b}${valSub(av)}`;
        out.innerHTML = `<div class="val-formula"><span class="val-cell"><i>${valRoman(av)}</i>${a}${valSub(ia)}</span><span class="val-cell"><i>${valRoman(bv)}</i>${b}${valSub(ib)}</span></div>
            <div class="mr-result">Формула: <strong>${fml}</strong></div>
            <div class="val-step">1) Записываем символы и валентности: ${a}(${valRoman(av)}) ${b}(${valRoman(bv)})</div>
            <div class="val-step">2) НОК валентностей ${av} и ${bv} = <b>${lcm}</b></div>
            <div class="val-step">3) Индексы: ${lcm} : ${valRoman(av)} = <b>${ia}</b> (у ${a}), ${lcm} : ${valRoman(bv)} = <b>${ib}</b> (у ${b})</div>
            <div class="val-step">4) Записываем индексы (индекс «1» не пишут): <b>${fml}</b></div>
            <div class="val-step">Крест-накрест: ${cross}${g > 1 ? ` → сокращаем на ${g} → <b>${fml}</b>` : ''}</div>
            <div class="val-step">Проверка: ${valRoman(av)} · ${ia} = ${av * ia}, ${valRoman(bv)} · ${ib} = ${bv * ib} ✓</div>
            ${warn.map(w => `<div class="tool-note">⚠️ ${toolEsc(w)}</div>`).join('')}`;
    } catch (err) {
        out.innerHTML = `<div class="mr-error">${toolEsc(err.message)}</div>`;
    }
}
