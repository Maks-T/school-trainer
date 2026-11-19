// Проверка данных тренажёра: node scripts/check-data.mjs
// Проверяет: JSON читается, у каждой темы из subjects.json есть файл параграфа,
// у каждого файла параграфа есть тема в реестре, картинки существуют,
// тест корректен (4 варианта, correct в диапазоне), обязательные поля на месте,
// фигурные скобки {…} в текстах сбалансированы.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { err(path, `JSON не читается — ${e.message}`); return null; }
}

function checkBraces(file, where, text) {
    if (typeof text !== 'string') return;
    let depth = 0;
    for (const ch of text) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth < 0 || depth > 1) { err(file, `${where}: несбалансированные {…}`); return; }
    }
    if (depth !== 0) err(file, `${where}: несбалансированные {…}`);
}

const registry = readJson(join(root, 'data/subjects.json'));
if (!registry) process.exit(1);

for (const subj of registry.subjects) {
    const dir = join(root, 'data', subj.id);
    const topics = (subj.sections || []).flatMap(s => s.topics || []);
    if (subj.status === 'ready' && !topics.length) err(subj.id, 'status "ready", но нет тем');

    for (const t of subj.tools || []) {
        if (t.data && !existsSync(join(dir, t.data))) err(subj.id, `инструмент ${t.id}: нет файла ${t.data}`);
    }

    const seen = new Set();
    for (const t of topics) {
        if (seen.has(String(t.p))) err(subj.id, `тема p=${t.p} зарегистрирована дважды`);
        seen.add(String(t.p));
        for (const k of ['p', 'num', 'title', 'desc']) if (t[k] === undefined || t[k] === '') err(subj.id, `тема p=${t.p}: нет поля ${k}`);
        const file = join(dir, `p${t.p}.json`);
        const rel = `data/${subj.id}/p${t.p}.json`;
        if (!existsSync(file)) { err(rel, 'файл не найден (тема есть в subjects.json)'); continue; }
        const d = readJson(file);
        if (!d) continue;

        if (String(d.id) !== String(t.p)) err(rel, `id "${d.id}" не совпадает с p=${t.p}`);
        if (!d.title) err(rel, 'нет title');
        if (!Array.isArray(d.sections) || !d.sections.length) err(rel, 'нет sections');

        const images = [];
        (d.sections || []).forEach((s, i) => {
            if (!s.title || !s.text) err(rel, `sections[${i}]: нужны title и text`);
            checkBraces(rel, `sections[${i}].text`, s.text);
            if (s.chain && !Array.isArray(s.chain)) err(rel, `sections[${i}].chain должен быть массивом`);
            (s.images || []).forEach(im => images.push(im.src));
        });
        (d.flashcards || []).forEach((c, i) => {
            if (!c.q || !c.a) err(rel, `flashcards[${i}]: нужны q и a`);
            if (c.image) images.push(c.image.src);
        });
        (d.timeline || []).forEach((e, i) => {
            if (!e.date || !e.title) err(rel, `timeline[${i}]: нужны date и title`);
        });
        (d.quiz || []).forEach((q, i) => {
            if (!q.q || !Array.isArray(q.opts)) { err(rel, `quiz[${i}]: нужны q и opts`); return; }
            if (!(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.opts.length)) err(rel, `quiz[${i}]: correct вне диапазона`);
            if (q.opts.length !== 4) warn(rel, `quiz[${i}]: вариантов ${q.opts.length}, обычно 4`);
            if (new Set(q.opts).size !== q.opts.length) err(rel, `quiz[${i}]: повторяются варианты`);
        });
        if (d.quiz && d.quiz.length) {
            const pos = new Set(d.quiz.map(q => q.correct));
            if (pos.size === 1 && d.quiz.length > 3) warn(rel, 'во всех вопросах правильный ответ на одной позиции');
        }
        for (const src of images) {
            if (!src) { err(rel, 'картинка без src'); continue; }
            if (!existsSync(join(dir, src))) err(rel, `нет картинки ${src}`);
        }
        if (d.toolContext) {
            const ids = new Set((subj.tools || []).flatMap(t => [t.id, t.type]));
            for (const k of Object.keys(d.toolContext)) if (!ids.has(k)) warn(rel, `toolContext.${k}: у предмета нет такого инструмента`);
        }
    }

    // датасеты учителя: data/<id>/p<N>.teacher.json
    if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
            const m = /^p(\d+)\.teacher\.json$/.exec(f);
            if (!m) continue;
            const rel = `data/${subj.id}/${f}`;
            if (!seen.has(m[1])) warn(rel, 'датасет учителя есть, а урока в subjects.json нет');
            if (!(subj.tools || []).some(t => t.type === 'teacher')) warn(rel, 'у предмета нет помощника type "teacher" — кнопки «Учитель» не будет');
            const d = readJson(join(dir, f));
            if (!d) continue;
            if (String(d.id) !== m[1]) err(rel, `id "${d.id}" не совпадает с именем файла`);
            if (!Array.isArray(d.sections) || !d.sections.length) { err(rel, 'нет sections'); continue; }
            const ids = new Set();
            d.sections.forEach((s, i) => {
                if (!s.id || !s.title || !s.text) err(rel, `sections[${i}]: нужны id, title и text`);
                if (s.id === 'all') err(rel, `sections[${i}]: id "all" зарезервирован`);
                if (!Array.isArray(s.points) || s.points.length < 2) err(rel, `sections[${i}]: в чек-листе меньше 2 пунктов`);
                (s.points || []).forEach((p, j) => {
                    if (!p.id || !p.text || !p.q) err(rel, `sections[${i}].points[${j}]: нужны id, text и q`);
                    if (ids.has(p.id)) err(rel, `пункт ${p.id} повторяется`);
                    ids.add(p.id);
                    if (p.w !== undefined && ![1, 2, 3].includes(p.w)) err(rel, `пункт ${p.id}: w должен быть 1, 2 или 3`);
                });
            });
        }
    }

    if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
            const m = /^p(\d+)\.json$/.exec(f);
            if (m && !seen.has(m[1])) warn(`data/${subj.id}/${f}`, 'файл есть, но темы нет в subjects.json');
        }
    }
}

warnings.forEach(w => console.log('⚠️  ' + w));
errors.forEach(e => console.log('❌ ' + e));
console.log(errors.length ? `\nОшибок: ${errors.length}` : `\n✅ Ошибок нет (предупреждений: ${warnings.length})`);
process.exit(errors.length ? 1 : 0);
