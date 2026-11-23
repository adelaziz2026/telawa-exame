// Surah recordings: one person records on this computer, the files are kept in Taskeeeel/, and «نشر» copies them to the
// website (GitHub Pages) so every visitor can listen. Recording, login and publishing work only on this computer
// (requests from 127.0.0.1), or from the phone (app or browser) on the home Wi-Fi when the server is started with start-recorder.cmd.
// Online (Render): when RECORDER_LOGIN and GITHUB_TOKEN are set there, the signed-in person records from the website anywhere,
// and each recording is committed straight to the repository's recordings/ folder; «نشر» on the computer then pulls it into Taskeeeel.
// Set or change the login on this computer:  node recordings.cjs --set-login <user> <password>
// Make the online login (paste the printed value into Render as RECORDER_LOGIN):  node recordings.cjs --online-login <user> <password>
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
// Online uploads are held in memory and sent to GitHub, so they are kept smaller (an hour at 64 kbps is about 30 MB).
const ONLINE_MAX = 50 * 1024 * 1024;
const REPO = process.env.RECORDINGS_REPO || 'adelaziz2026/telawa-exame', BRANCH = process.env.RECORDINGS_BRANCH || 'main';
const online = () => !!(process.env.RENDER && process.env.RECORDER_LOGIN && process.env.GITHUB_TOKEN);
const sessions = new Map(), failures = [], lockouts = new Map();
// Home Wi-Fi mode: a new 6-digit code is shown on this computer's screen at every start, and a phone must enter it with the
// password. Someone else on the network cannot sign in by knowing or guessing the password alone.
const PAIR_CODE = process.env.RECORD_LAN === '1' ? String(crypto.randomInt(100000, 1000000)) : '';
const needsPairCode = address => !LOOPBACK.test(address || '');
const sameText = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const json = (req, res, send, status, body, headers = {}) => send(req, res, status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}, JSON.stringify(body));
const LOOPBACK = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/, HOME_NETWORK = /^(?:::ffff:)?(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const local = req => { const a = req.socket.remoteAddress || ''; return !process.env.RENDER && (LOOPBACK.test(a) || (process.env.RECORD_LAN === '1' && HOME_NETWORK.test(a))); };
// Behind Render's proxy the visitor's address is the first one in X-Forwarded-For.
const addressOf = req => (online() && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(([k]) => k === 'rec')?.[1];
// The phone keeps a device key for 30 days (only its fingerprint is stored here), so it can send recordings made away from home.
const devicesFile = () => path.join(folder(), '.devices.json'), fingerprint = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const readDevices = () => { try { return JSON.parse(fs.readFileSync(devicesFile(), 'utf8')).filter(d => d.expires > Date.now()); } catch { return []; } };
const bearer = req => /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '')?.[1];
// Online sessions are signed rather than remembered, so they survive the server restarting or waking from sleep.
const onlineKey = () => crypto.createHash('sha256').update('rec\n' + process.env.RECORDER_LOGIN + '\n' + process.env.GITHUB_TOKEN).digest();
const signSession = expires => `${expires}.${crypto.createHmac('sha256', onlineKey()).update(String(expires)).digest('hex')}`;
const validSession = t => { const [expires] = String(t || '').split('.'); return Number(expires) > Date.now() && sameText(t, signSession(expires)); };
const signedIn = req => { if (online()) return validSession(cookie(req)); const s = sessions.get(cookie(req) || ''); if (s && s > Date.now()) return true; const t = bearer(req); return !!t && readDevices().some(d => d.hash === fingerprint(t)); };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex')};
}
const readLogin = () => { try { const l = JSON.parse(online() ? process.env.RECORDER_LOGIN : fs.readFileSync(loginFile(), 'utf8')); return l?.user && l.salt && l.hash ? l : null; } catch { return null; } };
function checkLogin(user, password) {
  const saved = readLogin(); if (!saved) return null;
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

// ---------- Online: the repository's recordings/ folder on GitHub ----------
async function gh(method, url, body, raw) {
  const r = await fetch((process.env.GITHUB_API || 'https://api.github.com') + url, {method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
    headers: {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'telawa-exame-recorder', ...(body ? {'Content-Type': 'application/json'} : {})}});
  if (!r.ok) throw Object.assign(Error(`GitHub ${r.status}`), {status: r.status});
  return raw ? r.text() : r.json();
}
let onlineCache = null, author = null;
async function onlineState(fresh) {
  if (!fresh && onlineCache && Date.now() - onlineCache.at < 15000) return onlineCache;
  const head = (await gh('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
  let files = []; try { files = (await gh('GET', `/repos/${REPO}/contents/recordings?ref=${head}`)).map(f => f.name); } catch (e) { if (e.status !== 404) throw e; }
  let index = {surahs: {}};
  if (files.includes('index.json')) try { const i = JSON.parse(await gh('GET', `/repos/${REPO}/contents/recordings/index.json?ref=${head}`, null, true)); if (i && typeof i.surahs === 'object') index = i; } catch {}
  return onlineCache = {at: Date.now(), head, files, index};
}
// One commit holds the audio file and the updated index.json. If someone else pushed meanwhile, it starts again from the new state.
async function onlineSave(surah, audio, ext, seconds) {
  if (!author) { const u = await gh('GET', '/user'); author = {name: u.login, email: `${u.id}+${u.login}@users.noreply.github.com`}; }
  const id = String(surah).padStart(3, '0');
  for (let attempt = 0; ; attempt++) {
    const {head, files, index} = await onlineState(true), tree = (await gh('GET', `/repos/${REPO}/git/commits/${head}`)).tree.sha;
    const entries = files.filter(n => n.startsWith(`surah-${id}.`)).map(n => ({path: `recordings/${n}`, mode: '100644', type: 'blob', sha: null}));
    let entry = null;
    if (audio) {
      const file = `surah-${id}.${ext}`, blob = (await gh('POST', `/repos/${REPO}/git/blobs`, {content: audio.toString('base64'), encoding: 'base64'})).sha;
      entries.splice(0, entries.length, ...entries.filter(e => e.path !== `recordings/${file}`), {path: `recordings/${file}`, mode: '100644', type: 'blob', sha: blob});
      entry = {file, bytes: audio.length, ...(seconds > 0 && seconds < 36000 ? {seconds} : {}), updated: new Date().toISOString()};
      index.surahs[surah] = entry;
    } else delete index.surahs[surah];
    entries.push({path: 'recordings/index.json', mode: '100644', type: 'blob', content: JSON.stringify({updated: new Date().toISOString(), surahs: index.surahs}, null, 1)});
    const newTree = (await gh('POST', `/repos/${REPO}/git/trees`, {base_tree: tree, tree: entries})).sha;
    // [skip render]: the new file is served from GitHub, so Render does not need to rebuild for it.
    const message = `${audio ? 'Add' : 'Remove'} recording of surah ${surah} from the website [skip render]`;
    const commit = (await gh('POST', `/repos/${REPO}/git/commits`, {message, tree: newTree, parents: [head], author, committer: author})).sha;
    try { await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, {sha: commit}); onlineCache = null; return entry || {}; }
    catch (e) { if (e.status !== 422 || attempt >= 2) throw e; }
  }
}
async function serveOnline(req, res, send, name) {
  let state; try { state = await onlineState(); } catch { return serveFile(req, res, send, name); }
  if (name === 'index.json') return json(req, res, send, 200, state.index);
  if (!state.files.includes(name)) return send(req, res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found');
  // The audio comes straight from GitHub at the current commit, so a new recording plays at once.
  return send(req, res, 302, {Location: `https://raw.githubusercontent.com/${REPO}/${state.head}/recordings/${name}`, 'Cache-Control': 'no-store'}, '');
}

async function handleRecordings(req, res, send, pathname) {
  if (pathname.startsWith('/recordings/')) {
    const name = pathname.slice('/recordings/'.length);
    if (!FILE.test(name) || (req.method !== 'GET' && req.method !== 'HEAD')) return send(req, res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found');
    return online() ? serveOnline(req, res, send, name) : serveFile(req, res, send, name);
  }
  const route = pathname.slice('/api/recordings'.length), allowed = local(req) || online();
  if (route === '/status' && req.method === 'GET') return json(req, res, send, 200, {local: local(req), online: online(), signedIn: allowed && signedIn(req), ready: !!readLogin(),
    code: local(req) && needsPairCode(req.socket.remoteAddress), max: online() ? ONLINE_MAX : MAX_BYTES});
  if (!allowed) return json(req, res, send, 403, {error: 'local_only', message: 'التسجيل متاح من الكمبيوتر الذي يحفظ التسجيلات فقط.'});
  // A custom header cannot be sent by another site without permission, so no page elsewhere can act for the signed-in person.
  if (req.method !== 'GET' && req.headers['x-recorder'] !== '1') return json(req, res, send, 403, {error: 'bad_request'});
  if (route === '/login' && req.method === 'POST') {
    // Five wrong tries a minute in all, and ten wrong tries from one device lock that device out for 15 minutes.
    const now = Date.now(), address = addressOf(req), mine = (lockouts.get(address) || []).filter(t => now - t < 900000);
    while (failures.length && now - failures[0] > 60000) failures.shift();
    if (failures.length >= 5 || mine.length >= 10) return json(req, res, send, 429, {error: 'wait', message: mine.length >= 10 ? 'محاولات خاطئة كثيرة من هذا الجهاز. حاول بعد 15 دقيقة.' : 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.'});
    const fail = body => { failures.push(now); lockouts.set(address, [...mine, now]); return json(req, res, send, 401, body); };
    let body; try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(req, res, send, 400, {error: 'bad_request'}); }
    if (!online() && needsPairCode(address) && (!PAIR_CODE || !sameText(body.code || '', PAIR_CODE))) return fail({error: 'pair_code', message: 'رمز الاقتران غير صحيح. اكتب الرمز الظاهر على شاشة الكمبيوتر.'});
    const ok = checkLogin(body.user || '', body.password || '');
    if (ok === null) return json(req, res, send, 503, {error: 'no_login', message: 'لم يُضبط حساب التسجيل بعد.'});
    if (!ok) return fail({error: 'wrong', message: 'اسم المستخدم أو كلمة المرور غير صحيحة.'});
    lockouts.delete(address);
    if (online()) return json(req, res, send, 200, {ok: true}, {'Set-Cookie': `rec=${signSession(now + 12 * 3600000)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`});
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
  if (one && online() && (req.method === 'PUT' || req.method === 'DELETE')) {
    const named = String(req.headers['x-file-ext'] || '').toLowerCase().replace(/^\./, ''), ext = EXTS.includes(named) ? named : AUDIO[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
    let audio = null;
    if (req.method === 'PUT') {
      if (!ext) return json(req, res, send, 415, {error: 'bad_type', message: 'هذا ليس ملفًا صوتيًا مدعومًا.'});
      try { audio = await readBody(req, ONLINE_MAX); } catch (e) { return json(req, res, send, e.status || 400, {error: 'too_large', message: 'الملف أكبر من 50 ميجابايت. اختر ملفًا أصغر (mp3 أو m4a).'}); }
      if (!audio.length) return json(req, res, send, 400, {error: 'empty'});
    }
    try { return json(req, res, send, 200, {ok: true, ...await onlineSave(surah, audio, ext, Math.round(Number(req.headers['x-duration']) || 0))}); }
    catch (e) { console.error('recording upload failed:', e.message); return json(req, res, send, 502, {error: 'github', message: 'تعذّر الحفظ على الموقع الآن. حاول مرة أخرى بعد قليل.'}); }
  }
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
    const seconds = Math.round(Number(req.headers['x-duration']) || 0);
    index.surahs[surah] = {file, bytes: audio.length, ...(seconds > 0 && seconds < 36000 ? {seconds} : {}), updated: new Date().toISOString()}; writeIndex(index);
    return json(req, res, send, 200, {ok: true, ...index.surahs[surah]});
  }
  if (route === '/publish' && req.method === 'POST') {
    if (online()) return json(req, res, send, 200, {ok: true, message: 'التسجيلات المحفوظة من الموقع منشورة مباشرة.'});
    return execFile(process.execPath, [path.join(root, 'publish-recordings.cjs')], {timeout: 300000, maxBuffer: 1 << 20}, (error, stdout) => {
      const last = String(stdout).trim().split('\n').pop() || '';
      if (error) return json(req, res, send, 500, {error: 'publish_failed', message: 'تعذّر النشر. تأكد من الإنترنت ومن تسجيل الدخول إلى GitHub على هذا الكمبيوتر.'});
      return json(req, res, send, 200, {ok: true, message: last});
    });
  }
  return json(req, res, send, 404, {error: 'not_found'});
}

module.exports = {handleRecordings, hashPassword, readIndex, FILE, HOME_NETWORK, PAIR_CODE, needsPairCode};
if (require.main === module) {
  const [flag, user, password] = process.argv.slice(2);
  if (flag === '--online-login' && user && password) {
    // The online page can be reached by anyone, so a short password could be guessed: warn, but leave the choice to the owner.
    if (password.length < 10) console.log('⚠ تنبيه: كلمة المرور قصيرة ويسهل تخمينها، وأي شخص يعرفها يستطيع إضافة تسجيلات أو حذفها من الموقع.\n⚠ Warning: a short password is easy to guess.\n');
    console.log('ضع هذه القيمة في Render باسم RECORDER_LOGIN / Paste this into Render as RECORDER_LOGIN:\n');
    console.log(JSON.stringify({user, ...hashPassword(password)}));
    process.exit(0);
  }
  if (flag !== '--set-login' || !user || !password) { console.log('Usage: node recordings.cjs --set-login <user> <password>\n       node recordings.cjs --online-login <user> <password>'); process.exit(1); }
  fs.mkdirSync(folder(), {recursive: true});
  fs.writeFileSync(loginFile(), JSON.stringify({user, ...hashPassword(password)}));
  console.log('Login saved in', loginFile());
}
