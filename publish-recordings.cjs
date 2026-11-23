// Copies the surah recordings from Taskeeeel/ to the website's recordings/ folder on GitHub (served by GitHub Pages
// and Render). Only index.json and surah-NNN audio files are sent; the login file never leaves this computer.
// Recordings saved from the website since the last publish are first copied into Taskeeeel, so they are kept; a recording
// deleted here after the last publish is not brought back.
// Uses this computer's GitHub sign-in (gh). Run: node publish-recordings.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {FILE, readIndex} = require('./recordings.cjs');

const source = process.env.RECORDINGS_DIR || path.join(__dirname, 'Taskeeeel');
const repo = 'https://github.com/adelaziz2026/telawa-exame.git';
const run = (cmd, args, cwd) => execFileSync(cmd, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

const syncedFile = path.join(source, '.synced');
if (require.main === module) publish();
function publish() {
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tarteel-recordings-'));
try {
  run('git', ['clone', '--quiet', '--depth', '1', repo, work]);
  const target = path.join(work, 'recordings');
  fs.mkdirSync(source, {recursive: true});
  const pulled = pullFromSite(target, source, syncedFile);
  const files = fs.readdirSync(source).filter(n => FILE.test(n));
  for (const n of files) if (fs.statSync(path.join(source, n)).size > 95 * 1024 * 1024) throw Error(`${n} is larger than GitHub allows`);
  if (pulled) console.log(`نُسخ ${pulled} تسجيل من الموقع إلى Taskeeeel.`);
  fs.rmSync(target, {recursive: true, force: true}); fs.mkdirSync(target);
  for (const n of files) fs.copyFileSync(path.join(source, n), path.join(target, n));
  run('git', ['add', '-A', 'recordings'], work);
  if (!run('git', ['status', '--porcelain', 'recordings'], work)) { fs.writeFileSync(syncedFile, String(Date.now())); console.log(pulled ? `تم. نُسخ ${pulled} تسجيل من الموقع، والموقع محدَّث.` : 'لا توجد تغييرات جديدة للنشر.'); return; }
  const user = JSON.parse(run('gh', ['api', 'user']));
  const email = `${user.id}+${user.login}@users.noreply.github.com`;
  run('git', ['-c', `user.name=${user.login}`, '-c', `user.email=${email}`, 'commit', '--quiet', '-m', 'Update surah recordings'], work);
  run('git', ['push', '--quiet', 'origin', 'HEAD:main'], work);
  fs.writeFileSync(syncedFile, String(Date.now()));
  console.log(`تم نشر ${files.filter(n => n !== 'index.json').length} تسجيل. يظهر على الموقع خلال دقيقة أو دقيقتين.`);
} finally { fs.rmSync(work, {recursive: true, force: true}); }
}

// A site recording is copied when it is newer than this computer's copy of that surah, or, for a surah this computer does not
// have, when it was saved after the last publish (an older one was deleted here on purpose).
function pullFromSite(target, source, syncedFile) {
  const site = readIndex(target), mine = readIndex(source), synced = Number(fs.existsSync(syncedFile) && fs.readFileSync(syncedFile, 'utf8')) || 0;
  let count = 0;
  for (const [n, entry] of Object.entries(site.surahs)) {
    const when = Date.parse(entry?.updated) || 0, own = mine.surahs[n];
    if (!entry?.file || !FILE.test(entry.file) || entry.file === 'index.json' || !fs.existsSync(path.join(target, entry.file))) continue;
    if (own ? when <= (Date.parse(own.updated) || 0) : when <= synced) continue;
    const id = entry.file.slice(0, 'surah-000'.length);
    for (const old of fs.readdirSync(source)) if (old.startsWith(id + '.')) fs.rmSync(path.join(source, old));
    fs.copyFileSync(path.join(target, entry.file), path.join(source, entry.file));
    mine.surahs[n] = entry; count++;
  }
  if (count) fs.writeFileSync(path.join(source, 'index.json'), JSON.stringify({updated: new Date().toISOString(), surahs: mine.surahs}, null, 1));
  return count;
}
module.exports = {pullFromSite};
