// The server replays whatever a page sends (/api/act → engine act). Junk must never throw, corrupt a number or reach a
// prototype: 20,000 random actions with hostile arguments, agents and programs.
//   node outputs/first-office/tests/act-fuzz.cjs
const assert = require('node:assert/strict');
const E = require('../engine.js');
let s = E.seed3({ playerName: 'x' }); s.cash = 5000;
const fns = E.ACTIONS.concat(['eval', 'constructor', '__proto__', 'toString']);
const pool = [null, undefined, -1, 1e308, NaN, Infinity, 'chat', 'vault', 'chat:login:0', 'sharp', 'trace', 'rook', {}, [], '__proto__', 'constructor', 'x'.repeat(5000), { seen: { intro: true } }, { player: '<b>x</b>', seenAt: 1e20 }, 3, 0, true];
const pick = a => a[Math.floor(Math.random() * a.length)];
for (let i = 0; i < 20000; i++) E.act(s, { fn: pick(fns), args: [pick(pool), pick(pool), pick(pool)], actor: Math.random() < 0.3 ? pick(['pip', 'nib', 'rook', 'evil', '__proto__', 'constructor']) : null, target: Math.random() < 0.3 ? pick(pool) : null, keep: Math.random() < 0.1 });
for (const k of ['cash', 'rep', 'bugs', 'crits', 'focus', 'cups', 'day', 'gpu']) assert.ok(Number.isFinite(s[k]) && s[k] >= 0, k + ' stays a sane number');
assert.ok(Object.keys(s.lit).every(k => Object.hasOwn(E.targetById, k)), 'only real programs');
assert.equal(({}).polluted, undefined);
E.restore(JSON.parse(JSON.stringify(s)));
console.log('act-fuzz passed: 20,000 hostile actions, no throw, no corruption');
