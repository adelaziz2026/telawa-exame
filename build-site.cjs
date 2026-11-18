// Builds site/: the web app as static files for free hosting (GitHub Pages, Netlify…).
// No server there, so the page hides the meeting room and Claude chat by itself; everything else works,
// including offline use and "install app". Run: node build-site.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname, out = path.join(root, 'site');
const files = ['index.html', 'style.css', 'compare.js', 'learning.js', 'asr.js', 'app.js', 'assistant.js', 'knowledge.js', 'mushaf.js', 'llm.js', 'board.js', 'appboard.js',
  'meet.html', 'meet.css', 'meet.js', 'sw.js', 'manifest.webmanifest'];
const folders = ['data', 'icons'];

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out);
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const folder of folders) fs.cpSync(path.join(root, folder), path.join(out, folder), {recursive: true});
// GitHub Pages: serve files as they are (no Jekyll processing).
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// Public description of the app for «Sign in with Hugging Face». It holds no secret. Netlify hosts the copy Hugging Face reads.
const pages = ['https://telawa-exame.netlify.app/', 'https://adelaziz2026.github.io/telawa-exame/', 'https://telawa-exame.onrender.com/', 'http://localhost/', 'http://127.0.0.1/'];
fs.mkdirSync(path.join(out, '.well-known'));
fs.writeFileSync(path.join(out, '.well-known', 'oauth-cimd'), JSON.stringify({client_id: 'https://telawa-exame.netlify.app/.well-known/oauth-cimd', client_name: 'Ikhtibar Al-Tilawa', client_uri: pages[0], redirect_uris: pages, token_endpoint_auth_method: 'none'}, null, 2));
fs.writeFileSync(path.join(out, '_headers'), '/.well-known/oauth-cimd\n  Content-Type: application/json\n  Access-Control-Allow-Origin: *\n');
// The service worker caches every file it lists; a missing one would break offline install.
const lists = [...fs.readFileSync(path.join(root, 'sw.js'), 'utf8').matchAll(/const (?:SHELL|DATA) = \[([^\]]*)\]/g)].map(m => m[1]).join(',');
const listed = [...lists.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
const missing = listed.filter(f => !fs.existsSync(path.join(out, f)));
if (missing.length) { console.error('Missing files listed in sw.js:', missing.join(', ')); process.exit(1); }
console.log(`site/ ready: ${files.length} files + ${folders.join(', ')}`);
