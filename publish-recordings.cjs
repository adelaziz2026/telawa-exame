// Copies the surah recordings from Taskeeeel/ to the website's recordings/ folder on GitHub (served by GitHub Pages
// and Render). Only index.json and surah-NNN audio files are sent; the login file never leaves this computer.
// Uses this computer's GitHub sign-in (gh). Run: node publish-recordings.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {FILE} = require('./recordings.cjs');

const source = process.env.RECORDINGS_DIR || path.join(__dirname, 'Taskeeeel');
const repo = 'https://github.com/adelaziz2026/telawa-exame.git';
const run = (cmd, args, cwd) => execFileSync(cmd, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

const files = fs.existsSync(source) ? fs.readdirSync(source).filter(n => FILE.test(n)) : [];
for (const n of files) if (fs.statSync(path.join(source, n)).size > 95 * 1024 * 1024) throw Error(`${n} is larger than GitHub allows`);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tarteel-recordings-'));
try {
  run('git', ['clone', '--quiet', '--depth', '1', repo, work]);
  const target = path.join(work, 'recordings');
  fs.rmSync(target, {recursive: true, force: true}); fs.mkdirSync(target);
  for (const n of files) fs.copyFileSync(path.join(source, n), path.join(target, n));
  run('git', ['add', '-A', 'recordings'], work);
  if (!run('git', ['status', '--porcelain', 'recordings'], work)) { console.log('لا توجد تغييرات جديدة للنشر.'); process.exit(0); }
  const user = JSON.parse(run('gh', ['api', 'user']));
  const email = `${user.id}+${user.login}@users.noreply.github.com`;
  run('git', ['-c', `user.name=${user.login}`, '-c', `user.email=${email}`, 'commit', '--quiet', '-m', 'Update surah recordings'], work);
  run('git', ['push', '--quiet', 'origin', 'HEAD:main'], work);
  console.log(`تم نشر ${files.filter(n => n !== 'index.json').length} تسجيل. يظهر على الموقع خلال دقيقة أو دقيقتين.`);
} finally { fs.rmSync(work, {recursive: true, force: true}); }
