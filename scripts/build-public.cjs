// Vercel build: copy only what the browser needs into public/ (the static output). Server code (*.cjs), tests,
// docs, data and .env never leave this folder; the API runs from api/index.js.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), out = path.join(root, 'public');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const ok = f => /\.(html|js|css|svg|png|woff2|ttf|json|txt)$/i.test(f);
for (const f of fs.readdirSync(root)) if (fs.statSync(path.join(root, f)).isFile() && ok(f) && !/^(vercel|package(-lock)?)\.json$/.test(f)) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of ['assets', 'original', 'stage3', 'stations']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true, filter: s => fs.statSync(s).isDirectory() || ok(s) });
console.log('public/ ready:', fs.readdirSync(out).length, 'entries');
