// Read the session logs that log.js sends (POST /api/log).
//   node scripts/sessions.cjs                 the 30 latest sessions (--all for every one, --user NAME for one player's)
//   node scripts/sessions.cjs <session>       that session as a timeline (--json for the raw events)
// Reads data/ locally. For the hosted game, pull the storage keys first and pass them in:
//   vercel env pull .env.vercel --environment production && node --env-file=.env.vercel scripts/sessions.cjs
'use strict';
const path = require('node:path');
const store = require('../store.cjs').create({ dir: process.env.FIRST_OFFICE_DATA || path.join(__dirname, '..', 'data') });
const args = process.argv.slice(2), flag = f => args.includes(f), opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--user');
const time = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
const j = v => typeof v === 'string' ? v : JSON.stringify(v);

// One line per event: when, what, and the part worth reading.
function line(e) {
  const at = e.t ? new Date(e.t).toISOString().slice(11, 23) : '            ';
  const said = {
    page: () => `${e.url} · ${e.w}×${e.h} · ${e.ua}`,
    click: () => `${e.text ? `"${e.text}" ` : ''}${e.el}${e.data ? ' ' + j(e.data) : ''} @${e.x},${e.y}`,
    key: () => `${e.mods || ''}${e.key}${e.in ? ' in ' + e.in : ''}`,
    change: () => `${e.el} = ${j(e.value)}`,
    window: () => e.open ? `open ${e.open}` : `close ${e.close}`,
    action: () => `${e.actor ? e.actor + ': ' : ''}${e.fn}(${j(e.args || []).slice(1, -1)})${e.refused ? ' ✗ ' + e.refused : ''}`,
    player: () => `→ ${e.to}: "${e.text}"`,
    nib: () => `Nib: "${e.text}"${e.choices ? ' [' + e.choices.join(' | ') + ']' : ''}`,
    agent: () => e.kind === 'user' ? `→ ${e.agent}: "${e.text}"` : `${e.agent} (${e.kind}): ${e.text}`,
    task: () => `${e.agent} took "${e.brief}" as ${j(e.task)}${e.fromAI ? ' (model)' : ' (local parser)'}${e.notes && e.notes.length ? ' · ' + e.notes.join(' · ') : ''}`,
    ai: () => `${e.path} ${e.status} ${e.ms}ms · sent ${j(e.req)} · got ${j(e.res)}`,
    api: () => `${e.method} ${e.path} ${e.error ? '✗ ' + e.error : e.status} ${e.ms}ms${e.conflict ? ' CONFLICT' : ''}`,
    error: () => `${e.what} ${e.msg || e.src || ''}${e.at ? ' at ' + e.at : ''}${e.stack ? '\n      ' + e.stack : ''}`,
    console: () => `${e.level}: ${e.msg}`,
    batch: () => `state now: ${e.page}${e.user ? ' · ' + e.user : ''}${e.ctx && e.ctx.day != null ? ` · ch${e.ctx.chapter} day ${e.ctx.day} $${e.ctx.cash} rep ${e.ctx.rep} bugs ${e.ctx.bugs}${e.ctx.win ? ' · ' + e.ctx.win : ''}` : ''}`,
  }[e.type];
  return `${at}  ${String(e.type).padEnd(7)} ${said ? said() : j(e)}`;
}

(async () => {
  if (id) {
    const events = await store.read('session:' + id); // in the order they were sent; each batch line ends its events
    if (!events.length) return console.log('No events for session', id);
    if (flag('--json')) return events.forEach(e => console.log(JSON.stringify(e)));
    let last = null; // a batch line (the game's state at that point) shows only when the state changed
    for (const e of events) { if (e.type === 'batch') { const k = j(e.ctx) + e.user; if (k === last) continue; last = k; } console.log(line(e)); }
    return;
  }
  const rows = await store.read('sessions'), by = new Map();
  for (const r of rows) { const s = by.get(r.session) || { ...r, first: r.at, pages: [] }; s.last = r.at; s.user = r.user || s.user; s.pages.push(r.page); by.set(r.session, s); }
  let list = [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
  if (opt('--user')) list = list.filter(s => (s.user || '').toLowerCase() === opt('--user').toLowerCase());
  if (!flag('--all')) list = list.slice(0, 30);
  if (!list.length) return console.log('No sessions yet.');
  for (const s of list) console.log(`${time(s.first)}  ${s.session}  ${(s.user || 'guest').padEnd(16)} ${s.pages.length} load(s): ${[...new Set(s.pages)].join(' ')}  · browser ${s.browser}`);
})().catch(e => { console.error(e.message); process.exit(1); });
