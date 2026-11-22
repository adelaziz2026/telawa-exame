// Surah recordings: one person records on this computer, the files are kept in Taskeeeel/, and «نشر» copies them to the
// website (GitHub Pages) so every visitor can listen. Recording, login and publishing work only on this computer
// (requests from 127.0.0.1), or from the phone app on the home Wi-Fi when the server is started with start-recorder.cmd;
// the online server (Render) only serves the published files.
// Set or change the login:  node recordings.cjs --set-login <user> <password>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');

const root = __dirname;
const folder = () => process.env.RECORDINGS_DIR || path.join(root, 'Taskeeeel');
const loginFile = () => path.join(folder(), '.login.json');
// Recordings made in the page, and audio files uploaded from a phone or computer in any common format.
const TYPES = {webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav',
  flac: 'audio/flac', amr: 'audio/amr', '3gp': 'audio/3gpp', json: 'application/json; charset=utf-8'};
const EXTS = Object.keys(TYPES).filter(e => e !== 'json');
const AUDIO = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/amr': 'amr', 'audio/3gpp': '3gp', 'video/3gpp': '3gp', 'video/mp4': 'mp4'};
const FILE = new RegExp(`^(?:index\\.json|surah-(\\d{3})\\.(${EXTS.join('|')}))$`);
const MAX_BYTES = 95 * 1024 * 1024; // GitHub refuses files of 100 MB or more
const sessions = new Map(), failures = [];
const json = (req, res, send, status, body, headers = {}) => send(req, res, status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}, JSON.stringify(body));
const LOOPBACK = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/, HOME_NETWORK = /^(?:::ffff:)?(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const local = req => { const a = req.socket.remoteAddress || ''; return !process.env.RENDER && (LOOPBACK.test(a) || (process.env.RECORD_LAN === '1' && HOME_NETWORK.test(a))); };
const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(([k]) => k === 'rec')?.[1];
// The phone keeps a device key for 30 days (only its fingerprint is stored here), so it can send recordings made away from home.
const devicesFile = () => path.join(folder(), '.devices.json'), fingerprint = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const readDevices = () => { try { return JSON.parse(fs.readFileSync(devicesFile(), 'utf8')).filter(d => d.expires > Date.now()); } catch { return []; } };
const bearer = req => /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '')?.[1];
const signedIn = req => { const s = sessions.get(cookie(req) || ''); if (s && s > Date.now()) return true; const t = bearer(req); return !!t && readDevices().some(d => d.hash === fingerprint(t)); };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex')};
}
function checkLogin(user, password) {
  let saved; try { saved = JSON.parse(fs.readFileSync(loginFile(), 'utf8')); } catch { return null; }
  const given = crypto.scryptSync(String(password), saved.salt, 32), stored = Buffer.from(saved.hash, 'hex');
  const sameUser = crypto.timingSafeEqual(crypto.createHash('sha256').update(String(user)).digest(), crypto.createHash('sha256').update(saved.user).digest());
  return sameUser && stored.length === given.length && crypto.timingSafeEqual(stored, given);
}
function readIndex(dir = folder()) {
  try { const i = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); return i && typeof i.surahs === 'object' ? i : {surahs: {}}; } catch { return {surahs: {}}; }
}
function writeIndex(index) {
  fs.writeFileSync(path.join(folder(), 'index.json'), JSON.stringify({updated: new Date().toISOString(), surahs: index.surahs}, null, 1));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(Error('too large'), {status: 413})); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
// Audio files support byte ranges, so the player can jump to any point.
function serveFile(req, res, send, name) {
  const dir = fs.existsSync(folder()) && !process.env.RENDER ? folder() : path.join(root, 'recordings');
  const file = path.join(dir, name), ext = name.split('.').pop();
  let stat; try { stat = fs.statSync(file); if (!stat.isFile()) throw Error(); } catch { return send(req, res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found'); }
  const headers = {'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'};
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && ext !== 'json') {
    let start = range[1] ? +range[1] : stat.size - +range[2], end = range[1] && range[2] ? +range[2] : stat.size - 1;
    if (!range[1]) end = stat.size - 1;
    if (start < 0 || start > end || end >= stat.size) return send(req, res, 416, {'Content-Range': `bytes */${stat.size}`}, '');
    res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1});
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, {start, end}).pipe(res);
  }
  res.writeHead(200, {...headers, 'Content-Length': stat.size});
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
}

async function handleRecordings(req, res, send, pathname) {
  if (pathname.startsWith('/recordings/')) {
    const name = pathname.slice('/recordings/'.length);
    if (!FILE.test(name) || (req.method !== 'GET' && req.method !== 'HEAD')) return send(req, res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found');
    return serveFile(req, res, send, name);
  }
  const route = pathname.slice('/api/recordings'.length);
  if (route === '/status' && req.method === 'GET') return json(req, res, send, 200, {local: local(req), signedIn: local(req) && signedIn(req), ready: fs.existsSync(loginFile())});
  if (!local(req)) return json(req, res, send, 403, {error: 'local_only', message: 'التسجيل متاح من الكمبيوتر الذي يحفظ التسجيلات فقط.'});
  // A custom header cannot be sent by another site without permission, so no page elsewhere can act for the signed-in person.
  if (req.method !== 'GET' && req.headers['x-recorder'] !== '1') return json(req, res, send, 403, {error: 'bad_request'});
  if (route === '/login' && req.method === 'POST') {
    const now = Date.now(); while (failures.length && now - failures[0] > 60000) failures.shift();
    if (failures.length >= 5) return json(req, res, send, 429, {error: 'wait', message: 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.'});
    let body; try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(req, res, send, 400, {error: 'bad_request'}); }
    const ok = checkLogin(body.user || '', body.password || '');
    if (ok === null) return json(req, res, send, 503, {error: 'no_login', message: 'لم يُضبط حساب التسجيل بعد.'});
    if (!ok) { failures.push(now); return json(req, res, send, 401, {error: 'wrong', message: 'اسم المستخدم أو كلمة المرور غير صحيحة.'}); }
    const token = crypto.randomBytes(24).toString('hex');
    if (body.device) {
      fs.writeFileSync(devicesFile(), JSON.stringify([...readDevices(), {hash: fingerprint(token), expires: now + 30 * 86400000}]));
      return json(req, res, send, 200, {ok: true, token});
    }
    sessions.set(token, now + 12 * 3600000);
    return json(req, res, send, 200, {ok: true}, {'Set-Cookie': `rec=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
  }
  if (route === '/logout' && req.method === 'POST') { sessions.delete(cookie(req) || ''); const t = bearer(req); if (t) fs.writeFileSync(devicesFile(), JSON.stringify(readDevices().filter(d => d.hash !== fingerprint(t)))); return json(req, res, send, 200, {ok: true}, {'Set-Cookie': 'rec=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
  if (!signedIn(req)) return json(req, res, send, 401, {error: 'signed_out', message: 'سجّل الدخول أولًا.'});
  const one = /^\/(\d{1,3})$/.exec(route), surah = one ? +one[1] : 0;
  if (one && (surah < 1 || surah > 114)) return json(req, res, send, 400, {error: 'bad_surah'});
  if (one && (req.method === 'PUT' || req.method === 'DELETE')) {
    fs.mkdirSync(folder(), {recursive: true});
    const index = readIndex(), id = String(surah).padStart(3, '0');
    // The file's own extension (sent by the page) wins over a vague type such as application/octet-stream.
    const named = String(req.headers['x-file-ext'] || '').toLowerCase().replace(/^\./, ''), ext = req.method === 'PUT' ? (EXTS.includes(named) ? named : AUDIO[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()]) : null;
    if (req.method === 'PUT' && !ext) return json(req, res, send, 415, {error: 'bad_type', message: 'هذا ليس ملفًا صوتيًا مدعومًا.'});
    for (const e of EXTS) fs.rmSync(path.join(folder(), `surah-${id}.${e}`), {force: true});
    if (req.method === 'DELETE') { delete index.surahs[surah]; writeIndex(index); return json(req, res, send, 200, {ok: true}); }
    let audio; try { audio = await readBody(req, MAX_BYTES); } catch (e) { return json(req, res, send, e.status || 400, {error: 'too_large', message: 'التسجيل كبير جدًا.'}); }
    if (!audio.length) return json(req, res, send, 400, {error: 'empty'});
    const file = `surah-${id}.${ext}`; fs.writeFileSync(path.join(folder(), file), audio);
    index.surahs[surah] = {file, bytes: audio.length, updated: new Date().toISOString()}; writeIndex(index);
    return json(req, res, send, 200, {ok: true, ...index.surahs[surah]});
  }
  if (route === '/publish' && req.method === 'POST') {
    return execFile(process.execPath, [path.join(root, 'publish-recordings.cjs')], {timeout: 300000, maxBuffer: 1 << 20}, (error, stdout) => {
      const last = String(stdout).trim().split('\n').pop() || '';
      if (error) return json(req, res, send, 500, {error: 'publish_failed', message: 'تعذّر النشر. تأكد من الإنترنت ومن تسجيل الدخول إلى GitHub على هذا الكمبيوتر.'});
      return json(req, res, send, 200, {ok: true, message: last});
    });
  }
  return json(req, res, send, 404, {error: 'not_found'});
}

module.exports = {handleRecordings, hashPassword, readIndex, FILE, HOME_NETWORK};
if (require.main === module) {
  const [flag, user, password] = process.argv.slice(2);
  if (flag !== '--set-login' || !user || !password) { console.log('Usage: node recordings.cjs --set-login <user> <password>'); process.exit(1); }
  fs.mkdirSync(folder(), {recursive: true});
  fs.writeFileSync(loginFile(), JSON.stringify({user, ...hashPassword(password)}));
  console.log('Login saved in', loginFile());
}
