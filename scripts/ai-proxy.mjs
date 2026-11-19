// Локальный сервер для тренажёра + прокси к ИИ-провайдерам. Без зависимостей, Node 18+.
//
//   node scripts/ai-proxy.mjs            → http://localhost:8787 (сайт и прокси)
//   PORT=9000 node scripts/ai-proxy.mjs  → другой порт
//
// Зачем: некоторые провайдеры не принимают запросы прямо из браузера (CORS).
// Учитель (teacher.js) с галочкой «через локальный прокси» шлёт запрос сюда:
//   POST /ai/chat/completions   + заголовок X-Target-Base: https://api.x.ai/v1
// а прокси пересылает его на https://api.x.ai/v1/chat/completions и возвращает ответ.
// Ключ берётся из заголовка Authorization (его задают в настройках учителя)
// или, если его нет, из переменной окружения AI_API_KEY.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Target-Base, HTTP-Referer, X-Title'
};

async function proxy(req, res) {
    const target = String(req.headers['x-target-base'] || '').replace(/\/$/, '');
    if (!/^https:\/\/[^/]+/.test(target)) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Нужен заголовок X-Target-Base с https-адресом API' }));
    }
    const url = target + req.url.replace(/^\/ai/, '');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
    const auth = req.headers.authorization || (process.env.AI_API_KEY ? `Bearer ${process.env.AI_API_KEY}` : '');
    if (auth) headers.Authorization = auth;
    for (const h of ['http-referer', 'x-title']) if (req.headers[h]) headers[h] = req.headers[h];
    try {
        const r = await fetch(url, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
        const body = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, { ...CORS, 'Content-Type': r.headers.get('content-type') || 'application/json' });
        res.end(body);
        console.log(`${req.method} ${url} → ${r.status}`);
    } catch (e) {
        res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Прокси не достучался до ${url}: ${e.message}` }));
        console.log(`${req.method} ${url} → ошибка: ${e.message}`);
    }
}

async function serveStatic(req, res) {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
        if (!(await stat(file)).isFile()) throw new Error('not a file');
        res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Не найдено');
    }
}

createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.url.startsWith('/ai/')) return proxy(req, res);
    return serveStatic(req, res);
}).listen(PORT, () => {
    console.log(`Тренажёр: http://localhost:${PORT}`);
    console.log(`Прокси к ИИ: http://localhost:${PORT}/ai/… (заголовок X-Target-Base)`);
});
