// Median of several tests/perf.cjs runs, and the change against a baseline.
//   node outputs/first-office/tests/perf-compare.cjs <out.json> <run1.json> [run2.json …] [--base baseline.json]
// Writes the per-metric median of the runs to out.json; with --base, prints each metric as value (−x% vs base).
const fs = require('node:fs');
const args = process.argv.slice(2), bi = args.indexOf('--base');
const base = bi >= 0 ? JSON.parse(fs.readFileSync(args.splice(bi, 2)[1])) : null;
const [out, ...runs] = args, data = runs.map(f => JSON.parse(fs.readFileSync(f)));
const med = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1); };
const res = {};
for (const c of Object.keys(data[0])) { res[c] = {}; for (const k of Object.keys(data[0][c])) res[c][k] = med(data.map(d => d[c][k])); }
fs.writeFileSync(out, JSON.stringify(res, null, 2));
const KEYS = ['taskMsPerSec', 'scriptMsPerSec', 'styleRecalcsPerSec', 'layoutsPerSec', 'paintFramesPerSec', 'rafPerSec', 'longestTaskMs'];
const show = {};
for (const c of Object.keys(res)) {
  show[c] = {};
  for (const k of KEYS) {
    const v = res[c][k], b = base && base[c][k];
    show[c][k] = base ? `${v} (${b ? (v <= b ? '−' : '+') + Math.abs(Math.round((v - b) / b * 100)) + '%' : b === 0 && v === 0 ? '=' : 'was 0'})` : v;
  }
}
console.table(show);
