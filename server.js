// سرور ساده برای اجرای استودیو بنر گیمینگ. بدون نیاز به نصب پکیج.
// اجرا:  node server.js        (پورت دلخواه:  PORT=8080 node server.js)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
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

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('Bad request');
  }
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
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('استودیو بنر گیمینگ آماده است:  http://localhost:' + PORT);
});
