// سرور ساده برای اجرای استودیو بنر گیمینگ. بدون نیاز به نصب پکیج. نیاز: Node.js 18 یا بالاتر.
//
//   node server.js
//   PORT=8080 node server.js
//
// ساخت لوگو با هوش مصنوعی:
//   ANTHROPIC_API_KEY=sk-ant-... node server.js
// بدون کلید، همه‌ی بخش‌های دیگر کار می‌کنند و فقط دکمه‌ی هوش مصنوعی پیام «فعال نیست» نشان می‌دهد.
// کلید فقط روی سرور می‌ماند و هیچ‌وقت به مرورگر فرستاده نمی‌شود.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const AI_PER_MINUTE = Number(process.env.AI_PER_MINUTE || 12);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on('end', () => {
      if (over) return reject({ status: 413, error: 'درخواست خیلی بزرگ است.' });
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject({ status: 400, error: 'درخواست نامعتبر است.' }); }
    });
    req.on('error', () => reject({ status: 400, error: 'درخواست نامعتبر است.' }));
  });
}

// محدودیت تعداد درخواست هوش مصنوعی برای هر آی‌پی
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= AI_PER_MINUTE) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

async function handleAI(req, res) {
  if (!req.headers['x-gbs'] || !(req.headers['content-type'] || '').includes('application/json')) {
    return sendJson(res, 400, { error: 'درخواست نامعتبر است.' });
  }
  if (!API_KEY) return sendJson(res, 501, { error: 'هوش مصنوعی روی این سرور فعال نیست. کلید ANTHROPIC_API_KEY را تنظیم کن.' });
  const ip = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  if (limited(ip)) return sendJson(res, 429, { error: 'تعداد درخواست‌ها زیاد است. یک دقیقه بعد دوباره امتحان کن.' });
  let body;
  try { body = await readJson(req, 64 * 1024); } catch (e) { return sendJson(res, e.status || 400, { error: e.error }); }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (prompt.length < 10 || prompt.length > 20000) return sendJson(res, 400, { error: 'متن ایده معتبر نیست.' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('AI error', r.status, j && j.error && j.error.message);
      return sendJson(res, 502, { error: 'پاسخ هوش مصنوعی دریافت نشد. دوباره امتحان کن.' });
    }
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) return sendJson(res, 502, { error: 'هوش مصنوعی جوابی نداد. دوباره امتحان کن.' });
    sendJson(res, 200, { text });
  } catch (e) {
    console.error('AI request failed', e && e.message);
    sendJson(res, 502, { error: 'ارتباط با هوش مصنوعی برقرار نشد.' });
  } finally {
    clearTimeout(timer);
  }
}

// پیشنهاد امکانات: هر پیشنهاد یک خط JSON در data/ideas.jsonl ذخیره می‌شود.
// برای دیدن پیشنهادها فایل را باز کن یا IDEAS_ADMIN_KEY=رمز بگذار و /api/ideas?key=رمز را باز کن.
const IDEAS_DIR = path.join(__dirname, 'data');
const IDEAS_FILE = path.join(IDEAS_DIR, 'ideas.jsonl');
const IDEAS_ADMIN_KEY = process.env.IDEAS_ADMIN_KEY || '';
const IDEA_CATS = ['feature', 'improve', 'design', 'bug'];
const ideaHits = new Map();
function ideaLimited(ip) {
  const now = Date.now();
  const list = (ideaHits.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 5) { ideaHits.set(ip, list); return true; }
  list.push(now); ideaHits.set(ip, list);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of ideaHits) if (!v.some((t) => now - t < 60000)) ideaHits.delete(k); }, 60000).unref();

async function handleIdeas(req, res, query) {
  if (req.method === 'GET') {
    if (!IDEAS_ADMIN_KEY || query.get('key') !== IDEAS_ADMIN_KEY) return sendJson(res, 403, { error: 'اجازه نداری.' });
    let lines = [];
    try { lines = fs.readFileSync(IDEAS_FILE, 'utf8').split('\n').filter(Boolean); } catch (e) {}
    return sendJson(res, 200, { ideas: lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) });
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (!req.headers['x-gbs'] || !(req.headers['content-type'] || '').includes('application/json')) {
    return sendJson(res, 400, { error: 'درخواست نامعتبر است.' });
  }
  const ip = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  if (ideaLimited(ip)) return sendJson(res, 429, { error: 'تعداد ارسال زیاد است. یک دقیقه بعد دوباره امتحان کن.' });
  let body;
  try { body = await readJson(req, 4 * 1024); } catch (e) { return sendJson(res, e.status || 400, { error: e.error }); }
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (text.length < 8 || text.length > 500) return sendJson(res, 400, { error: 'متن پیشنهاد باید بین ۸ تا ۵۰۰ حرف باشد.' });
  const cat = IDEA_CATS.includes(body.cat) ? body.cat : 'feature';
  try {
    fs.mkdirSync(IDEAS_DIR, { recursive: true });
    let size = 0; try { size = fs.statSync(IDEAS_FILE).size; } catch (e) {}
    if (size > 5 * 1024 * 1024) return sendJson(res, 507, { error: 'جای ذخیره‌ی پیشنهادها پر است.' });
    fs.appendFileSync(IDEAS_FILE, JSON.stringify({ text, cat, v: String(body.v || '').slice(0, 10), at: new Date().toISOString() }) + '\n');
  } catch (e) {
    console.error('ideas write failed', e && e.message);
    return sendJson(res, 500, { error: 'ذخیره نشد.' });
  }
  sendJson(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('Bad request');
  }

  if (pathname === '/api/ai' && req.method === 'POST') return handleAI(req, res);
  if (pathname === '/api/ideas') return handleIdeas(req, res, new URL(req.url, 'http://localhost').searchParams);
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'پیدا نشد.' });

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('صفحه پیدا نشد');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, () => {
  console.log('استودیو بنر گیمینگ آماده است:  http://localhost:' + PORT);
  console.log(API_KEY ? 'هوش مصنوعی: فعال (' + AI_MODEL + ')' : 'هوش مصنوعی: غیرفعال (ANTHROPIC_API_KEY تنظیم نشده)');
});
