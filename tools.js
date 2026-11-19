// Инструменты-помощники предмета (кнопки в шапке тренажёра).
// Описываются в data/subjects.json → subject.tools:
//   { "id": "periodic", "icon": "🧪", "title": "Таблица Менделеева", "type": "periodic", "data": "tools/periodic.json" }
// Помощники получают контекст открытого параграфа — см. getToolContext() и поле toolContext в JSON параграфа.
// Типы: "periodic" — таблица Менделеева, "mr-calc" — калькулятор Mr, "valence-calc" — калькулятор валентности,
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
        const tdata = await loadToolData(tool);
        const ctx = tdata && tdata.elements ? getToolContext(tool, tdata.elements) : null;
        if (tool.type === 'periodic') renderPeriodic(body, tdata.elements);
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

function paragraphText() {
    if (typeof data === 'undefined' || !data) return '';
    const parts = [data.title, data.subtitle];
    (data.sections || []).forEach(s => {
        parts.push(s.title, s.text, ...(s.chain || []));
        (s.images || []).forEach(i => parts.push(i.caption));
    });
    (data.flashcards || []).forEach(c => parts.push(c.q, c.a));
    (data.timeline || []).forEach(t => parts.push(t.date, t.title, t.text));
    // из теста — только вопрос и правильный ответ: неверные варианты часто содержат ошибочные формулы
    (data.quiz || []).forEach(q => parts.push(q.q, (q.opts || [])[q.correct]));
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
    return { label: paragraphLabel(), formulas, pairs: own.pairs || [] };
}

function ctxChips(list, onclickFn) {
    return list.map(f => `<button class="mode-btn ctx-chip" onclick="${onclickFn}('${f}')">${toSubs(f)}</button>`).join('');
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
            try {
                const r = valSolve(f);
                // только значения, которые встречаются в учебнике (SO₄ как группа даст S(VIII) — отбрасываем)
                if (r.x > 7 || (r.unk in VAL_VAR && !VAL_VAR[r.unk].includes(r.x))) return;
                ctxF.push(f); addPair(r.a, r.va, r.b, r.vb);
            } catch (e) { /* не бинарная или без постоянной валентности */ }
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
