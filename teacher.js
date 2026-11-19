// ============================================================
// 🧑‍🏫 Учитель — проверка пересказа параграфа с помощью ИИ
// Помощник типа "teacher" (subjects.json → tools). Датасет урока: data/<предмет>/p<N>.teacher.json
// Подключение — любой OpenAI-совместимый API (OpenRouter, OrcaRouter, Groq, xAI, DeepSeek…), ключ хранится в браузере.
// Без подключения работает самопроверка: ребёнок пересказывает, потом отмечает пункты чек-листа сам.
// Если провайдер не принимает запросы из браузера (CORS) — запустите scripts/ai-proxy.mjs и включите «через прокси».
// ============================================================

const TCH_PRESETS = [
    { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    // OrcaRouter: модели вида <провайдер>/<модель> (openai/, anthropic/, google/, deepseek/, qwen/…), orcarouter/auto — автовыбор
    { name: 'OrcaRouter', baseUrl: 'https://api.orcarouter.ai/v1', model: 'orcarouter/auto' },
    { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
    { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
    { name: 'Свой (OpenAI-совместимый)', baseUrl: '' }
];
const TCH_STATUS = {
    ok: { icon: '✅', label: 'рассказал', v: 1 },
    partial: { icon: '🟡', label: 'неполно', v: 0.5 },
    missed: { icon: '⬜', label: 'не сказал', v: 0 },
    wrong: { icon: '❌', label: 'ошибка', v: 0 }
};
const TCH_Q_BONUS = 0.6; // сколько «стоит» пункт, который вспомнил только после вопроса учителя

const tch = {
    settings: null,   // { connections: [], activeId, grading, speak, proxyUrl }
    ds: null,         // датасет открытого параграфа
    dsKey: '',        // subject:p — чтобы не потерять разговор при переключении помощников
    s: null,          // текущая сессия проверки
    view: 'start',    // start | session | settings
    rec: null,        // распознавание речи
    models: {}        // загруженные списки моделей по подключениям
};

// ---------- Настройки ----------

function tchLoadSettings() {
    if (tch.settings) return tch.settings;
    let s = null;
    try { s = JSON.parse(localStorage.getItem('teacherSettings') || 'null'); } catch (e) { /* хранилище недоступно */ }
    tch.settings = Object.assign({ connections: [], activeId: null, grading: true, speak: false, proxyUrl: 'http://localhost:8787' }, s || {});
    return tch.settings;
}
function tchSaveSettings() {
    try { localStorage.setItem('teacherSettings', JSON.stringify(tch.settings)); } catch (e) { /* хранилище недоступно */ }
}
function tchActiveConn() {
    const s = tchLoadSettings();
    return s.connections.find(c => c.id === s.activeId && c.baseUrl && c.model) || null;
}

// ---------- Вызов модели ----------

function tchEndpoint(conn, path) {
    if (conn.viaProxy) {
        const base = location.port === '8787' ? '' : (tch.settings.proxyUrl || 'http://localhost:8787').replace(/\/$/, '');
        return { url: `${base}/ai${path}`, headers: { 'X-Target-Base': conn.baseUrl.replace(/\/$/, '') } };
    }
    return { url: conn.baseUrl.replace(/\/$/, '') + path, headers: {} };
}

async function tchChat(messages, { json = true } = {}) {
    const conn = tchActiveConn();
    if (!conn) throw new Error('Нет подключения к модели');
    const ep = tchEndpoint(conn, '/chat/completions');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, ep.headers);
    if (conn.apiKey) headers.Authorization = 'Bearer ' + conn.apiKey;
    if (/openrouter\.ai/.test(conn.baseUrl)) { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'school-trainer'; }
    const body = { model: conn.model, messages, temperature: 0.2, max_tokens: 1500 };
    const send = async withFormat => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120000);
        try {
            const res = await fetch(ep.url, {
                method: 'POST', headers, signal: ctrl.signal,
                body: JSON.stringify(withFormat ? Object.assign({ response_format: { type: 'json_object' } }, body) : body)
            });
            const text = await res.text();
            if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`); e.status = res.status; throw e; }
            const data = JSON.parse(text);
            const msg = data.choices && data.choices[0] && data.choices[0].message;
            return (msg && (msg.content || msg.reasoning_content)) || '';
        } finally { clearTimeout(timer); }
    };
    try {
        return await send(json);
    } catch (e) {
        // некоторые модели не понимают response_format — пробуем без него
        if (json && e.status && e.status >= 400 && e.status < 500 && ![401, 402, 403, 429].includes(e.status)) return send(false);
        if (e.name === 'AbortError') throw new Error('Модель слишком долго отвечает');
        if (e instanceof TypeError) throw new Error('Нет связи с провайдером. Если это CORS — включите «через локальный прокси» в настройках.');
        throw e;
    }
}

function tchSys(tpl) { return tpl.replace('{SUBJECT}', (subject && subject.title) || 'школьный предмет'); }

function tchParseJson(text) {
    let t = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Модель ответила не в формате JSON');
    return JSON.parse(t.slice(a, b + 1));
}

const TCH_SYS_RETELL = `Ты — доброжелательный школьный учитель 7 класса, предмет: {SUBJECT}. Ты проверяешь устный пересказ ученика.
Правила:
- Оценивай ТОЛЬКО по тексту учебника, который дан ниже. Не добавляй фактов от себя.
- Ученик рассказывает своими словами: синонимы, другой порядок и упрощения допустимы, если смысл верный.
- Текст мог быть получен голосовым вводом: не обращай внимания на опечатки, пунктуацию и неточно распознанные слова, если понятно, что имелось в виду.
- Химические формулы и обозначения могут быть записаны без нижних индексов или словами (H2O = H₂O, «аш два о»): это не ошибка.
- Для КАЖДОГО пункта чек-листа выбери статус:
  ok — смысл пункта передан верно;
  partial — пункт упомянут неполно или неточно (например, без даты или без главной детали);
  missed — пункт не упомянут;
  wrong — сказано то, что противоречит учебнику (неверная дата, имя, причина).
- comment: для partial и wrong кратко объясни, что не так (по-русски, на «ты»); для ok и missed можно оставить пустым.
- feedback: 2–3 коротких предложения ученику на «ты»: сначала что получилось хорошо, потом что стоит повторить. Без баллов и оценок.
Ответь строго одним JSON-объектом без пояснений:
{"points":[{"id":"1.1","status":"ok","comment":""}],"feedback":"..."}`;

const TCH_SYS_ANSWER = `Ты — доброжелательный школьный учитель 7 класса, предмет: {SUBJECT}. Ученик отвечает на твой дополнительный вопрос.
Сравни ответ с эталоном из учебника. Смысл важнее точных слов, опечатки голосового ввода и формулы без индексов (H2O = H₂O) не учитывай.
status: ok — ответ верный по смыслу; partial — частично верный или неполный; wrong — неверный или «не знаю».
comment: 1–2 коротких предложения ученику на «ты». Если ответ неполный или неверный — мягко поправь и назови верный ответ по учебнику.
Ответь строго одним JSON-объектом: {"status":"ok","comment":"..."}`;

// ---------- Датасет ----------

function tchTopic() { return typeof topicList !== 'undefined' ? topicList[topicIndex] : null; }

async function tchLoadDataset() {
    const t = tchTopic();
    const key = `${subject.id}:${t ? t.p : ''}`;
    if (tch.dsKey === key) return tch.ds;
    tch.dsKey = key; tch.ds = null; tch.s = null; tch.view = 'start';
    const res = await fetch(`data/${subject.id}/p${t.p}.teacher.json`, { cache: 'no-store' });
    if (res.ok) tch.ds = await res.json();
    return tch.ds;
}

// Кнопка «Учитель» неактивна, если для параграфа нет датасета
async function tchProbe(i) {
    const btn = document.getElementById(`tool-btn-${i}`);
    const t = tchTopic();
    if (!btn || !t) return;
    try {
        const res = await fetch(`data/${subject.id}/p${t.p}.teacher.json`, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) return;
    } catch (e) { /* нет файла */ }
    btn.classList.add('tool-btn-off');
    btn.title = 'Для этого параграфа учитель пока не подготовлен';
}

function tchSection(id) {
    if (id === 'all') {
        return {
            id: 'all', title: 'Весь параграф',
            text: tch.ds.sections.map(s => `${s.title}\n${s.text}`).join('\n\n'),
            points: tch.ds.sections.flatMap(s => s.points)
        };
    }
    return tch.ds.sections.find(s => s.id === id);
}

function tchResultKey(secId) { return `teacher:${subject.id}:${tchTopic().p}:${secId}`; }
function tchGetResult(secId) { try { return JSON.parse(localStorage.getItem(tchResultKey(secId)) || 'null'); } catch (e) { return null; } }
function tchSetResult(secId, r) { try { localStorage.setItem(tchResultKey(secId), JSON.stringify(r)); } catch (e) { /* хранилище недоступно */ } }

// ---------- Отрисовка ----------

async function renderTeacher(body) {
    tchLoadSettings();
    await tchLoadDataset();
    if (!tch.ds) {
        body.innerHTML = '<p class="tool-note">Для этого параграфа учитель пока не подготовлен: нет файла датасета.</p>';
        return;
    }
    tchRender();
}

function tchBody() { return document.getElementById('tool-body'); }

function tchRender() {
    const body = tchBody();
    // ответ модели мог прийти, когда открыт другой помощник или окно закрыто: состояние сохранено, отрисуем при открытии
    if (!body || window._activeToolType !== 'teacher') return;
    if (tch.view === 'settings') return tchRenderSettings(body);
    if (tch.view === 'session' && tch.s) return tchRenderSession(body);
    tchRenderStart(body);
}

function tchConnBar() {
    const st = tchLoadSettings();
    const conns = st.connections.filter(c => c.baseUrl && c.model);
    const opts = conns.map(c => `<option value="${c.id}"${c.id === st.activeId ? ' selected' : ''}>${toolEsc(c.name)} · ${toolEsc(c.model)}</option>`).join('');
    return `<div class="tch-bar">
        <select class="tch-select" onchange="tchSetActive(this.value)">
            <option value="">Без ИИ — самопроверка</option>${opts}
        </select>
        <button class="dock-btn" title="Настройки учителя" onclick="tchOpenSettings()">⚙️</button>
    </div>`;
}

function tchSetActive(id) { tch.settings.activeId = id || null; tchSaveSettings(); tchRender(); }

function tchRenderStart(body) {
    const t = tchTopic();
    const ds = tch.ds;
    const item = (id, title, n) => {
        const r = tchGetResult(id);
        const badge = r ? `<span class="tch-badge">${r.grade != null ? r.grade : '✓'}</span>` : '';
        return `<button class="tch-sec" onclick="tchStart('${id}')"><span>${toolEsc(title)}</span><span class="tch-sec-meta">${n} ${tchPlural(n, 'пункт', 'пункта', 'пунктов')} ${badge}</span></button>`;
    };
    body.innerHTML = `${tchConnBar()}
        <p class="tch-lead">Выбери пункт параграфа и перескажи его своими словами — текстом или голосом 🎤. Подглядывать нельзя 😉</p>
        <div class="tch-secs">
            ${ds.sections.map(s => item(s.id, s.title, s.points.length)).join('')}
            ${item('all', `Весь ${t ? t.num : 'параграф'} целиком`, ds.sections.reduce((n, s) => n + s.points.length, 0))}
        </div>
        ${tchActiveConn() ? '' : '<p class="tool-note">Модель не подключена: после пересказа покажу чек-лист, отметишь пункты сам (или вместе с родителем). Подключить ИИ — ⚙️.</p>'}`;
}

// ---------- Сессия проверки ----------

function tchStart(secId) {
    const sec = tchSection(secId);
    tch.s = { secId, sec, phase: 'retell', msgs: [], status: {}, comments: {}, qStatus: {}, queue: [], qi: 0, grade0: null };
    tch.view = 'session';
    tchSay('teacher', `Расскажи своими словами: «${sec.title}». ${tch.ds.hint || 'Постарайся вспомнить как можно больше: главные мысли, понятия, факты, примеры и выводы.'}`);
    tchRender();
}

function tchSay(who, text, extra) {
    tch.s.msgs.push(Object.assign({ who, text }, extra || {}));
    if (who === 'teacher' && tch.settings.speak && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(text.replace(/[«»"]/g, ''));
        u.lang = 'ru-RU';
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    }
}

function tchRenderSession(body) {
    const s = tch.s;
    const msgs = s.msgs.map(m => {
        if (m.who === 'card') return tchChecklistHtml(m.final);
        if (m.who === 'self') return tchSelfCheckHtml();
        return `<div class="tch-msg tch-${m.who}">${m.who === 'teacher' ? '<span class="tch-ava">🧑‍🏫</span>' : ''}<div class="tch-bubble">${toolEsc(m.text).replace(/\n/g, '<br>')}</div></div>`;
    }).join('');
    const canType = s.phase === 'retell' || s.phase === 'question';
    const hasMic = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    let actions = '';
    if (s.phase === 'reviewed') {
        const n = s.queue.length;
        actions = `<div class="tch-actions">
            ${n ? `<button class="mode-btn active" onclick="tchStartQuestions()">Ответить на вопросы учителя (${n})</button>` : ''}
            <button class="mode-btn" onclick="tchFinish()">Закончить</button></div>`;
    } else if (s.phase === 'done') {
        actions = `<div class="tch-actions">
            <button class="mode-btn active" onclick="tchStart('${s.secId}')">🔁 Ещё раз</button>
            <button class="mode-btn" onclick="tchBack()">Другой пункт</button></div>`;
    }
    body.innerHTML = `${tchConnBar()}
        <div class="tch-head"><button class="mode-btn" onclick="tchBack()">← Пункты</button><b>${toolEsc(s.sec.title)}</b></div>
        <div class="tch-chat" id="tch-chat">${msgs}${s.busy ? '<div class="tch-msg tch-teacher"><span class="tch-ava">🧑‍🏫</span><div class="tch-bubble tch-typing">Учитель думает…</div></div>' : ''}</div>
        ${actions}
        ${canType ? `<div class="tch-input">
            <textarea id="tch-text" rows="4" placeholder="${s.phase === 'retell' ? 'Твой пересказ…' : 'Твой ответ…'}" ${s.busy ? 'disabled' : ''}>${toolEsc(s.draft || '')}</textarea>
            <div class="tch-input-row">
                ${hasMic ? `<button class="mode-btn${tch.rec ? ' active' : ''}" id="tch-mic" onclick="tchMic()" ${s.busy ? 'disabled' : ''}>${tch.rec ? '⏹ Стоп' : '🎤 Голосом'}</button>` : ''}
                <span class="tch-interim" id="tch-interim"></span>
                ${s.phase === 'question' ? `<button class="mode-btn" onclick="tchDontKnow()" ${s.busy ? 'disabled' : ''}>Не знаю</button>` : ''}
                <button class="mode-btn active" onclick="tchSend()" ${s.busy ? 'disabled' : ''}>Отправить</button>
            </div></div>` : ''}`;
    const chat = document.getElementById('tch-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    const ta = document.getElementById('tch-text');
    if (ta) ta.addEventListener('input', () => { tch.s.draft = ta.value; });
}

function tchBack() { tchMicStop(); tch.view = 'start'; tch.s = null; tchRender(); }

async function tchSend() {
    const s = tch.s;
    const ta = document.getElementById('tch-text');
    const text = (ta ? ta.value : '').trim();
    tchMicStop();
    if (s.phase === 'retell' && text.length < 20) {
        tchSay('teacher', 'Маловато 🙂 Попробуй рассказать подробнее, хотя бы несколько предложений.');
        return tchRender();
    }
    if (!text) return;
    s.draft = '';
    tchSay('student', text);
    if (s.phase === 'retell') await tchCheckRetell(text);
    else if (s.phase === 'question') await tchCheckAnswer(text);
}

async function tchCheckRetell(text) {
    const s = tch.s;
    s.retell = text;
    if (!tchActiveConn()) {
        s.phase = 'self';
        tchSay('teacher', 'Молодец, что рассказал! Теперь сверь себя с чек-листом: отметь, что ты назвал.');
        s.msgs.push({ who: 'self' });
        return tchRender();
    }
    s.busy = true; tchRender();
    try {
        const list = s.sec.points.map(p => `${p.id}: ${p.text}`).join('\n');
        const raw = await tchChat([
            { role: 'system', content: tchSys(TCH_SYS_RETELL) },
            { role: 'user', content: `ТЕКСТ УЧЕБНИКА:\n${s.sec.text}\n\nЧЕК-ЛИСТ:\n${list}\n\nПЕРЕСКАЗ УЧЕНИКА:\n${text}` }
        ]);
        const res = tchParseJson(raw);
        const byId = {};
        (res.points || []).forEach(p => { byId[String(p.id)] = p; });
        s.sec.points.forEach(p => {
            const r = byId[p.id];
            s.status[p.id] = r && TCH_STATUS[r.status] ? r.status : 'missed';
            if (r && r.comment) s.comments[p.id] = r.comment;
        });
        s.busy = false;
        tchAfterReview(res.feedback || '');
    } catch (err) {
        s.busy = false;
        tchSay('teacher', `Не получилось связаться с моделью (${err.message}). Давай сверимся по чек-листу сами.`);
        s.phase = 'self';
        s.msgs.push({ who: 'self' });
        tchRender();
    }
}

function tchSelfCheckHtml() {
    const s = tch.s;
    const done = s.phase !== 'self';
    const rows = s.sec.points.map(p => {
        const st = s.status[p.id] || '';
        const btn = (val, icon) => `<button class="tch-self-btn${st === val ? ' on' : ''}" ${done ? 'disabled' : ''} onclick="tchSelf('${p.id}','${val}')">${icon}</button>`;
        return `<div class="tch-point"><div class="tch-point-text">${toolEsc(p.text)}</div>
            <div class="tch-self">${btn('ok', '✅')}${btn('partial', '🟡')}${btn('missed', '⬜')}</div></div>`;
    }).join('');
    return `<div class="tch-card"><div class="tch-card-title">📋 Чек-лист: что нужно было рассказать</div>
        <div class="tch-legend">✅ рассказал · 🟡 неполно · ⬜ не сказал</div>${rows}
        ${done ? '' : '<div class="tch-actions"><button class="mode-btn active" onclick="tchSelfDone()">Готово</button></div>'}</div>`;
}

function tchSelf(id, val) { tch.s.status[id] = val; tchRender(); }

function tchSelfDone() {
    const s = tch.s;
    s.sec.points.forEach(p => { if (!s.status[p.id]) s.status[p.id] = 'missed'; });
    // карточку самопроверки заменяем итоговым чек-листом
    s.msgs = s.msgs.filter(m => m.who !== 'self');
    tchAfterReview('');
}

function tchScore(useQuestions) {
    const s = tch.s;
    let sum = 0, max = 0;
    s.sec.points.forEach(p => {
        const w = p.w || 1;
        let v = TCH_STATUS[s.status[p.id]].v;
        if (useQuestions && s.qStatus[p.id]) v = Math.max(v, TCH_STATUS[s.qStatus[p.id]].v * TCH_Q_BONUS);
        sum += w * v; max += w;
    });
    return max ? sum / max : 0;
}
function tchGrade(score) { return Math.min(10, Math.max(1, Math.round(score * 10))); }

function tchAfterReview(feedback) {
    const s = tch.s;
    s.grade0 = tchGrade(tchScore(false));
    const ok = s.sec.points.filter(p => s.status[p.id] === 'ok').length;
    let msg = feedback || (ok === s.sec.points.length ? 'Отлично, ты рассказал всё!' : `Ты рассказал ${ok} из ${s.sec.points.length} пунктов.`);
    if (tch.settings.grading) msg += `\n\nОценка за пересказ: ${s.grade0} из 10.`;
    tchSay('teacher', msg);
    s.msgs.push({ who: 'card', final: false });
    // вопросы: сначала ошибки, потом пропуски и неполные; внутри — более важные пункты
    const order = { wrong: 0, missed: 1, partial: 2 };
    s.queue = s.sec.points.filter(p => s.status[p.id] !== 'ok')
        .sort((a, b) => order[s.status[a.id]] - order[s.status[b.id]] || (b.w || 1) - (a.w || 1));
    s.phase = 'reviewed';
    if (s.queue.length) tchSay('teacher', `Давай разберём то, что ты пропустил. У меня ${s.queue.length} ${tchPlural(s.queue.length, 'вопрос', 'вопроса', 'вопросов')}.`);
    tchRender();
}

function tchPlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

function tchChecklistHtml(final) {
    const s = tch.s;
    const rows = s.sec.points.map(p => {
        const st = TCH_STATUS[s.status[p.id]] || TCH_STATUS.missed;
        const q = final && s.qStatus[p.id] ? ` <span class="tch-after">→ после вопроса: ${TCH_STATUS[s.qStatus[p.id]].icon}</span>` : '';
        const c = s.comments[p.id] ? `<div class="tch-comment">${toolEsc(s.comments[p.id])}</div>` : '';
        return `<div class="tch-point tch-st-${s.status[p.id]}"><span class="tch-icon" title="${st.label}">${st.icon}</span>
            <div><div class="tch-point-text">${toolEsc(p.text)}${q}</div>${c}</div></div>`;
    }).join('');
    const grade = tch.settings.grading
        ? `<div class="tch-grade">${final ? `Пересказ: <b>${s.grade0}</b> · С ответами на вопросы: <b>${tchGrade(tchScore(true))}</b> из 10` : `Оценка: <b>${s.grade0}</b> из 10`}</div>` : '';
    return `<div class="tch-card"><div class="tch-card-title">📋 ${final ? 'Итог' : 'Чек-лист'}: ${toolEsc(s.sec.title)}</div>
        <div class="tch-legend">✅ рассказал · 🟡 неполно · ⬜ не сказал · ❌ ошибка</div>${rows}${grade}</div>`;
}

function tchStartQuestions() {
    const s = tch.s;
    s.phase = 'question'; s.qi = 0;
    tchAsk();
}

function tchAsk() {
    const s = tch.s;
    const p = s.queue[s.qi];
    const prefix = s.status[p.id] === 'wrong' && s.comments[p.id] ? `${s.comments[p.id]}\n` : '';
    tchSay('teacher', `Вопрос ${s.qi + 1} из ${s.queue.length}. ${prefix}${p.q}`);
    tchRender();
}

async function tchCheckAnswer(text) {
    const s = tch.s;
    const p = s.queue[s.qi];
    if (!tchActiveConn()) {
        // без ИИ: показываем эталон и просим отметить себя
        s.pending = p;
        tchSay('teacher', `Правильный ответ по учебнику: ${p.text}.\nСравни со своим ответом и отметь честно 👇`, {});
        s.phase = 'selfq';
        tchRenderSelfQ();
        return;
    }
    s.busy = true; tchRender();
    try {
        const raw = await tchChat([
            { role: 'system', content: tchSys(TCH_SYS_ANSWER) },
            { role: 'user', content: `ТЕКСТ УЧЕБНИКА:\n${s.sec.text}\n\nВОПРОС: ${p.q}\nЭТАЛОН (пункт чек-листа): ${p.text}\nОТВЕТ УЧЕНИКА: ${text}` }
        ]);
        const r = tchParseJson(raw);
        s.qStatus[p.id] = ['ok', 'partial', 'wrong'].includes(r.status) ? r.status : 'wrong';
        s.busy = false;
        tchSay('teacher', `${TCH_STATUS[s.qStatus[p.id]].icon} ${r.comment || ''}`.trim());
    } catch (err) {
        s.busy = false;
        s.qStatus[p.id] = 'partial';
        tchSay('teacher', `Не получилось проверить ответ (${err.message}). Правильный ответ: ${p.text}.`);
    }
    tchNextQuestion();
}

function tchRenderSelfQ() {
    tchRender();
    const chat = document.getElementById('tch-chat');
    if (!chat) return;
    chat.insertAdjacentHTML('beforeend', `<div class="tch-actions">
        <button class="mode-btn" onclick="tchSelfQ('ok')">✅ Ответил верно</button>
        <button class="mode-btn" onclick="tchSelfQ('partial')">🟡 Частично</button>
        <button class="mode-btn" onclick="tchSelfQ('wrong')">❌ Не знал</button></div>`);
    chat.scrollTop = chat.scrollHeight;
}

function tchSelfQ(val) {
    const s = tch.s;
    s.qStatus[s.pending.id] = val;
    s.phase = 'question';
    tchNextQuestion();
}

function tchDontKnow() {
    const s = tch.s;
    const p = s.queue[s.qi];
    tchMicStop();
    tchSay('student', 'Не знаю');
    s.qStatus[p.id] = 'wrong';
    tchSay('teacher', `Ничего страшного. По учебнику: ${p.text}. Запомни!`);
    tchNextQuestion();
}

function tchNextQuestion() {
    const s = tch.s;
    s.qi++;
    if (s.qi < s.queue.length) return tchAsk();
    tchFinish();
}

function tchFinish() {
    const s = tch.s;
    tchMicStop();
    s.phase = 'done';
    const final = tchGrade(tchScore(true));
    const repeat = s.sec.points.filter(p => s.status[p.id] !== 'ok' && s.qStatus[p.id] !== 'ok');
    let msg = repeat.length ? `Хорошая работа! Повтори ещё раз: ${repeat.length} ${tchPlural(repeat.length, 'пункт', 'пункта', 'пунктов')} из чек-листа.` : 'Отлично! Ты знаешь весь пункт 👏';
    if (tch.settings.grading) msg += `\nИтоговая оценка: ${final} из 10.`;
    tchSay('teacher', msg);
    s.msgs.push({ who: 'card', final: true });
    const prev = tchGetResult(s.secId);
    const grade = tch.settings.grading ? final : null;
    if (!prev || grade == null || prev.grade == null || grade >= prev.grade) tchSetResult(s.secId, { grade, date: new Date().toISOString().slice(0, 10) });
    tchRender();
}

// ---------- Голосовой ввод (Web Speech API, бесплатно, работает в Chrome/Edge) ----------

function tchMic() {
    if (tch.rec) return tchMicStop();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
        const ta = document.getElementById('tch-text');
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) {
                if (ta) { ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + r[0].transcript.trim(); tch.s.draft = ta.value; }
            } else interim += r[0].transcript;
        }
        const el = document.getElementById('tch-interim');
        if (el) el.textContent = interim;
    };
    rec.onerror = e => { if (e.error === 'not-allowed') alertMic(); tchMicStop(); };
    rec.onend = () => { if (tch.rec === rec) { tch.rec = null; tchUpdateMic(); } };
    tch.rec = rec;
    rec.start();
    tchUpdateMic();
}
function alertMic() {
    const el = document.getElementById('tch-interim');
    if (el) el.textContent = 'Нет доступа к микрофону — разреши его в браузере';
}
function tchMicStop() {
    if (tch.rec) { const r = tch.rec; tch.rec = null; try { r.stop(); } catch (e) { /* уже остановлен */ } }
    tchUpdateMic();
}
function tchUpdateMic() {
    const b = document.getElementById('tch-mic');
    if (b) { b.textContent = tch.rec ? '⏹ Стоп' : '🎤 Голосом'; b.classList.toggle('active', !!tch.rec); }
}

// ---------- Экран настроек ----------

function tchOpenSettings() { tchMicStop(); tch.prevView = tch.view; tch.view = 'settings'; tchRender(); }
function tchCloseSettings() { tch.view = tch.prevView === 'session' && tch.s ? 'session' : 'start'; tchRender(); }

function tchRenderSettings(body) {
    const st = tchLoadSettings();
    const rows = st.connections.map(c => `
        <div class="tch-conn${c.id === st.activeId ? ' on' : ''}" data-id="${c.id}">
            <div class="tch-conn-row">
                <input class="tch-in" value="${toolEsc(c.name)}" placeholder="Название" onchange="tchConnSet('${c.id}','name',this.value)">
                <label class="tch-radio"><input type="radio" name="tch-active" ${c.id === st.activeId ? 'checked' : ''} onchange="tchSetActiveQuiet('${c.id}')"> активное</label>
                <button class="dock-btn" title="Удалить" onclick="tchConnDel('${c.id}')">🗑</button>
            </div>
            <input class="tch-in" value="${toolEsc(c.baseUrl)}" placeholder="Адрес API, например https://openrouter.ai/api/v1" onchange="tchConnSet('${c.id}','baseUrl',this.value)">
            <input class="tch-in" type="password" value="${toolEsc(c.apiKey || '')}" placeholder="API-ключ" onchange="tchConnSet('${c.id}','apiKey',this.value)" autocomplete="off">
            <div class="tch-conn-row">
                <input class="tch-in" list="tch-models-${c.id}" value="${toolEsc(c.model || '')}" placeholder="Модель, например deepseek/deepseek-chat:free" onchange="tchConnSet('${c.id}','model',this.value)">
                <datalist id="tch-models-${c.id}"></datalist>
                <button class="mode-btn" onclick="tchLoadModels('${c.id}')">📥 Модели</button>
            </div>
            <div class="tch-conn-row" id="tch-filter-${c.id}" style="display:none">
                <select class="tch-select" id="tch-prov-${c.id}" onchange="tchFilterModels('${c.id}')"></select>
                <label class="tch-radio"><input type="checkbox" id="tch-free-${c.id}" onchange="tchFilterModels('${c.id}')"> только бесплатные</label>
            </div>
            <div class="tch-conn-row">
                <label class="tch-radio"><input type="checkbox" ${c.viaProxy ? 'checked' : ''} onchange="tchConnSet('${c.id}','viaProxy',this.checked)"> через локальный прокси</label>
                <button class="mode-btn" onclick="tchTest('${c.id}')">🔌 Проверить</button>
            </div>
            <div class="tool-note tch-conn-msg" id="tch-msg-${c.id}"></div>
        </div>`).join('');
    body.innerHTML = `
        <div class="tch-head"><button class="mode-btn" onclick="tchCloseSettings()">← Назад</button><b>Настройки учителя</b></div>
        <div class="tch-settings">
            <div class="tch-card-title">Подключения к моделям</div>
            ${rows || '<p class="tool-note">Подключений пока нет.</p>'}
            <div class="tch-conn-row">
                <select class="tch-select" id="tch-preset">${TCH_PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select>
                <button class="mode-btn active" onclick="tchConnAdd()">+ Добавить</button>
            </div>
            <div class="tch-card-title" style="margin-top:14px">Проверка</div>
            <label class="tch-radio"><input type="checkbox" ${st.grading ? 'checked' : ''} onchange="tchOpt('grading',this.checked)"> ставить оценку (10-балльная шкала)</label>
            <label class="tch-radio"><input type="checkbox" ${st.speak ? 'checked' : ''} onchange="tchOpt('speak',this.checked)"> учитель читает ответы вслух</label>
            <div class="tch-card-title" style="margin-top:14px">Локальный прокси</div>
            <input class="tch-in" value="${toolEsc(st.proxyUrl)}" onchange="tchOpt('proxyUrl',this.value)">
            <p class="tool-note">Нужен, только если провайдер не пускает запросы из браузера (ошибка «Нет связи с провайдером»). Запуск: <code>node scripts/ai-proxy.mjs</code>, затем открыть сайт по адресу http://localhost:8787 или включить «через локальный прокси» у подключения.</p>
            <p class="tool-note">Ключи хранятся только в этом браузере. Бесплатные модели на OpenRouter — с окончанием <code>:free</code> (кнопка «📥 Модели» отмечает их ⭐).</p>
        </div>`;
}

function tchOpt(k, v) { tch.settings[k] = v; tchSaveSettings(); }
function tchSetActiveQuiet(id) { tch.settings.activeId = id; tchSaveSettings(); tchRender(); }
function tchConnSet(id, k, v) {
    const c = tch.settings.connections.find(x => x.id === id);
    if (!c) return;
    c[k] = typeof v === 'string' ? v.trim() : v;
    tchSaveSettings();
}
function tchConnAdd() {
    const p = TCH_PRESETS[+document.getElementById('tch-preset').value];
    const c = { id: 'c' + Date.now().toString(36), name: p.name, baseUrl: p.baseUrl, apiKey: '', model: p.model || '', viaProxy: false };
    tch.settings.connections.push(c);
    if (!tch.settings.activeId) tch.settings.activeId = c.id;
    tchSaveSettings();
    tchRender();
}
function tchConnDel(id) {
    const st = tch.settings;
    st.connections = st.connections.filter(c => c.id !== id);
    if (st.activeId === id) st.activeId = st.connections[0] ? st.connections[0].id : null;
    tchSaveSettings();
    tchRender();
}

async function tchLoadModels(id) {
    const c = tch.settings.connections.find(x => x.id === id);
    const msg = document.getElementById(`tch-msg-${id}`);
    msg.textContent = 'Загружаю список моделей…';
    try {
        const ep = tchEndpoint(c, '/models');
        const headers = Object.assign({}, ep.headers);
        if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
        const res = await fetch(ep.url, { headers });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = ((await res.json()).data || []).map(m => ({
            id: m.id,
            free: /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)
        })).sort((a, b) => (b.free - a.free) || a.id.localeCompare(b.id));
        tch.models[id] = list;
        // провайдеры — префикс до «/» в id модели (openai/…, deepseek/…); у прямых провайдеров префикса нет
        const prov = {};
        list.forEach(m => { const k = m.id.includes('/') ? m.id.split('/')[0] : '—'; prov[k] = (prov[k] || 0) + 1; });
        const keys = Object.keys(prov).sort();
        document.getElementById(`tch-prov-${id}`).innerHTML = `<option value="">Все провайдеры (${list.length})</option>` +
            keys.map(k => `<option value="${toolEsc(k)}">${toolEsc(k === '—' ? 'без префикса' : k)} (${prov[k]})</option>`).join('');
        document.getElementById(`tch-filter-${id}`).style.display = keys.length > 1 ? '' : 'none';
        tchFilterModels(id);
        msg.textContent = `Моделей: ${list.length}, бесплатных: ${list.filter(m => m.free).length}. Выбери провайдера и начни вводить название в поле «Модель».`;
    } catch (e) {
        msg.textContent = 'Не удалось загрузить список: ' + (e instanceof TypeError ? 'нет связи (возможно, нужен прокси)' : e.message);
    }
}

function tchFilterModels(id) {
    const list = tch.models[id] || [];
    const prov = document.getElementById(`tch-prov-${id}`).value;
    const free = document.getElementById(`tch-free-${id}`).checked;
    const shown = list.filter(m => (!prov || (prov === '—' ? !m.id.includes('/') : m.id.startsWith(prov + '/'))) && (!free || m.free));
    document.getElementById(`tch-models-${id}`).innerHTML = shown.map(m => `<option value="${toolEsc(m.id)}">${m.free ? '⭐ бесплатная' : ''}</option>`).join('');
}

async function tchTest(id) {
    const st = tch.settings;
    const prev = st.activeId;
    const msg = document.getElementById(`tch-msg-${id}`);
    const c = st.connections.find(x => x.id === id);
    if (!c.baseUrl || !c.model) { msg.textContent = 'Заполни адрес и модель'; return; }
    st.activeId = id;
    msg.textContent = 'Проверяю…';
    try {
        const t0 = Date.now();
        const raw = await tchChat([{ role: 'user', content: 'Ответь JSON-объектом {"ok":true}' }]);
        tchParseJson(raw);
        msg.textContent = `✅ Работает, ответ за ${((Date.now() - t0) / 1000).toFixed(1)} с`;
    } catch (e) {
        msg.textContent = '❌ ' + e.message;
    } finally {
        st.activeId = prev;
    }
}
