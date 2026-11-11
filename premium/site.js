const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../website');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
const download = 'https://github.com/Mericsdc/lrx-torn-tracker/releases/latest/download/LRX-Torn-Tracker-Windows-x64.zip';
function serveSite(req, res, pathname) {
  if (!['GET','HEAD'].includes(req.method)) return false;
  if(pathname==='/download/windows') {res.writeHead(302,{Location:download,'Cache-Control':'public, max-age=300'});res.end();return true;}
  if(pathname!=='/' && !pathname.startsWith('/site/')) return false;
  const relative=pathname==='/'?'index.html':pathname.slice('/site/'.length);
  if(!relative || !/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some(part=>!part || part.startsWith('.'))) {res.writeHead(404);res.end();return true;}
  const file=path.resolve(root,relative), type=types[path.extname(file)];
  if(!type || !file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return true;}
  const stat=fs.statSync(file);
  res.writeHead(200,{'Content-Type':type,'Content-Length':stat.size,'Cache-Control':relative==='index.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
  if(req.method==='HEAD')res.end();else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  return true;
}
module.exports={serveSite};
