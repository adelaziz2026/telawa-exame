const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {handleAssistant} = require('./assistant.cjs');
const {handleMeeting} = require('./meeting.cjs');
const root = __dirname;
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const compressible = new Set(['.html','.js','.css','.json','.webmanifest','.svg']);
// Folders that live next to the app but must never be served (tooling, mobile builds, dependencies).
const hidden = new Set(['node_modules','Mobile','data-src','site','github-upload','github-update']);
// The on-device model needs transformers.js from jsdelivr (WASM, blob workers) and downloads weights from
// huggingface.co, which redirects to other hosts; recitation audio and Quran APIs are also remote.
const csp = ["default-src 'self'","script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval' blob:","worker-src 'self' blob:","connect-src 'self' https:","media-src 'self' https: blob:","img-src 'self' data: blob:","style-src 'self' https://fonts.googleapis.com","font-src https://fonts.gstatic.com","manifest-src 'self'","object-src 'none'","base-uri 'self'","form-action 'none'","frame-ancestors 'none'"].join('; ');
const security = {'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'microphone=(self), camera=(self), display-capture=(self), geolocation=()','X-Frame-Options':'DENY'};
const started = Date.now();
// Files are read and compressed once, then reused until their modification time changes.
const cache = new Map();
function load(file, stat) {
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const entry = {mtimeMs:stat.mtimeMs, size:stat.size, raw:fs.readFileSync(file), etag:`"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`};
  cache.set(file, entry);
  return entry;
}
function encoded(entry, ext, accept) {
  if (!compressible.has(ext) || entry.raw.length < 1024) return [entry.raw, null];
  if (/\bbr\b/.test(accept)) return [entry.br ??= zlib.brotliCompressSync(entry.raw, {params:{[zlib.constants.BROTLI_PARAM_QUALITY]:6}}), 'br'];
  if (/\bgzip\b/.test(accept)) return [entry.gz ??= zlib.gzipSync(entry.raw, {level:9}), 'gzip'];
  return [entry.raw, null];
}
function cacheControl(rel) {
  // The Quran text never changes; icons rarely do. Code and pages are revalidated on every load (cheap with ETags).
  if (rel.startsWith('data/')) return 'public, max-age=604800';
  if (rel.startsWith('icons/')) return 'public, max-age=86400';
  return 'no-cache';
}
function send(req, res, status, headers, body) {
  res.writeHead(status, {...security, ...headers});
  res.end(req.method === 'HEAD' ? undefined : body);
  // Errors are always logged; set LOG=1 to log every request.
  if (status >= 400 || process.env.LOG) console.log(`${new Date().toISOString().slice(11, 19)} ${status} ${req.method} ${req.url}`);
}
function handle(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(req, res, 400, {'Content-Type':'text/plain; charset=utf-8'}, 'Bad request'); }
  // The AI assistant is the only route that accepts POST.
  if (pathname === '/api/assistant') return handleAssistant(req, res, send);
  // Meeting rooms: joining, the live event stream and relayed messages.
  if (pathname.startsWith('/api/meet/')) return handleMeeting(req, res, send, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, {'Allow':'GET, HEAD','Content-Type':'text/plain; charset=utf-8'}, 'Method not allowed');
  if (pathname === '/api/health') return send(req, res, 200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, JSON.stringify({status:'ok', uptime:Math.round((Date.now() - started) / 1000)}));
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, '.' + pathname), rel = path.relative(root, file).split(path.sep).join('/'), ext = path.extname(file);
  const parts = rel.split('/');
  if (!file.startsWith(root + path.sep) || !types[ext] || parts.some(p => p.startsWith('.')) || hidden.has(parts[0]) || /^package(-lock)?\.json$/.test(rel)) return send(req, res, 404, {'Content-Type':'text/plain; charset=utf-8'}, 'Not found');
  let stat;
  try { stat = fs.statSync(file); if (!stat.isFile()) throw Error(); } catch { return send(req, res, 404, {'Content-Type':'text/plain; charset=utf-8'}, 'Not found'); }
  const entry = load(file, stat);
  const headers = {'Content-Type':types[ext], 'Cache-Control':cacheControl(rel), 'ETag':entry.etag, 'Last-Modified':new Date(entry.mtimeMs).toUTCString(), 'Vary':'Accept-Encoding'};
  // If-None-Match may list several tags, possibly weak (W/"…").
  if ((req.headers['if-none-match'] || '').split(',').some(tag => tag.trim().replace(/^W\//, '') === entry.etag)) return send(req, res, 304, headers);
  const [body, encoding] = encoded(entry, ext, req.headers['accept-encoding'] || '');
  if (encoding) headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = body.length;
  send(req, res, 200, headers, body);
}
function createServer() { return http.createServer(handle); }
// Compress the large Quran files ahead of time so the first visitor does not wait for it.
function warm() {
  for (const name of ['data/quran.json', 'data/simple.json']) {
    try { const file = path.join(root, name), entry = load(file, fs.statSync(file)); encoded(entry, '.json', 'br'); encoded(entry, '.json', 'gzip'); } catch {}
  }
}
module.exports = {createServer, warm};
if (require.main === module) {
  const server = createServer();
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') console.error(`المنفذ ${port} مستخدم بالفعل — ربما الخادم يعمل؛ افتح http://localhost:${port}\nأو شغّله على منفذ آخر:  PORT=8790 node server.cjs\n(Port ${port} is already in use.)`);
    else console.error(err.message);
    process.exit(1);
  });
  server.listen(port, host, () => { console.log(`Tarteel: http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`); setImmediate(warm); });
  // Ctrl+C or a service stop: finish open requests, then exit.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { console.log('إيقاف الخادم…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); });
}
