// Simple static server with no dependencies.
// Run: node server.js   (default port 3000, or set PORT)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(ROOT, rel));

  // Block path traversal and direct access to server files.
  const base = path.basename(file);
  if (!file.startsWith(ROOT) || base === "server.js" || base === "README.md") {
    // Always show the update page instead of an error.
    return sendIndex(res);
  }

  fs.readFile(file, (err, data) => {
    if (err) return sendIndex(res);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
});

function sendIndex(res) {
  fs.readFile(path.join(ROOT, "index.html"), (err, data) => {
    // 503 tells search engines the site is temporarily down.
    res.writeHead(err ? 500 : 503, {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "3600",
    });
    res.end(err ? "Server error" : data);
  });
}

server.listen(PORT, () => {
  console.log("Update page running at http://localhost:" + PORT);
});
