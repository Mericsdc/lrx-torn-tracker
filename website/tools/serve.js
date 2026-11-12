'use strict';
// Local preview with the same CSP and routes as lrxe8.com's public site module.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', 'site');
const CSP = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const port = Number(process.argv[2]) || 4810;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let file = null;
  if (u.pathname === '/torn-tracker' || u.pathname === '/') file = path.join(ROOT, 'LRXe8-torn-tracker.html');
  else if (u.pathname.startsWith('/assets/')) file = path.join(ROOT, 'assets', path.basename(decodeURIComponent(u.pathname)));
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port + '/torn-tracker'));
