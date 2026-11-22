// Copies exactly what the online server needs into github-upload/, ready to upload to a GitHub repository
// (and from there to Render). Never includes Mobile/ (signing key), node_modules/ or build output.
// Run: node export-repo.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname, out = path.join(root, 'github-upload');
const files = ['index.html', 'style.css', 'compare.js', 'learning.js', 'asr.js', 'app.js', 'assistant.js', 'knowledge.js', 'mushaf.js', 'llm.js', 'board.js', 'appboard.js',
  'meet.html', 'meet.css', 'meet.js', 'recordings.html', 'recordings.js', 'sw.js', 'manifest.webmanifest',
  'server.cjs', 'assistant.cjs', 'meeting.cjs', 'recordings.cjs', 'publish-recordings.cjs', 'start-recorder.cmd', 'tests.cjs', 'build-site.cjs', 'export-repo.cjs', 'Training/app-sources.cjs',
  'package.json', 'package-lock.json', 'oauth-client.json', 'render.yaml', '.gitignore', 'README.md', 'start.cmd'];
const folders = ['data', 'icons'];

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out);
for (const file of files) { fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.copyFileSync(path.join(root, file), path.join(out, file)); }
for (const folder of folders) fs.cpSync(path.join(root, folder), path.join(out, folder), {recursive: true});
// The one public page kept with the Play files: Google Play links to it. Nothing else from Mobile/ is copied.
fs.copyFileSync(path.join(root, 'Mobile', 'google-play', 'privacy-policy.html'), path.join(out, 'privacy-policy.html'));
// Safety net: nothing secret may slip in.
const all = [];
const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
walk(out);
const bad = all.filter(p => /keystore|\.jks$|release-keys|Taskeeeel|\.login\.json|node_modules|quran-llm|adapter-|params_shard|\.safetensors$/i.test(p));
if (bad.length) { console.error('Refusing: secret or unwanted files found:', bad); process.exit(1); }
const size = all.reduce((n, p) => n + fs.statSync(p).size, 0);
console.log(`github-upload/ ready: ${all.length} files, ${(size / 1e6).toFixed(1)} MB`);
