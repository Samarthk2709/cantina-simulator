/* Character customization: the founder's look (avatars.js setLook), saved in localStorage 'first-office-look-v1'.
   Some items unlock with progress read from the game save ('first-office-game-v1'); once earned they stay earned.
   Customize.ensure(): the first time, the editor opens full-screen and resolves on Start; after that it resolves at once.
   Customize.open(): the editor again (the game menu). While the office runs, a toast says when a new item unlocks. */
(function () {
  'use strict';
  const KEY = 'first-office-look-v1', SAVE = 'first-office-game-v1';
  const A = window.Avatars;
  // Unlocks: what the game save must show.
  const NEED = {
    cap: ['Find a critical', s => s.crits >= 1],
    phones: ['Find 10 bugs', s => s.bugs >= 10],
    shades: ['Finish the first job', s => !!s.won],
    gold: ['Reach Elite (60 rep)', s => s.rep >= 60],
    neon: ['Finish chapter 3', s => !!s.won3],
  };
  // Rows: key, label, items [value, name, unlock id].
  const ROWS = [
    ['skin', 'Skin', [['#f6d2b5', 'Light'], ['#e9b88f', 'Warm'], ['#c98a5e', 'Tan'], ['#8d5a3b', 'Brown'], ['#5a3825', 'Deep']]],
    ['hair', 'Hair', [['fringe', 'Fringe'], ['short', 'Short'], ['long', 'Long'], ['spiky', 'Spiky'], ['bun', 'Bun'], ['bald', 'Bald']]],
    ['hairColor', 'Hair colour', [['#3b2416', 'Brown'], ['#14121c', 'Black'], ['#c98a3a', 'Blond'], ['#8a3a1e', 'Auburn'], ['#9aa0a8', 'Grey'], ['#7ff0d8', 'Neon', 'neon']]],
    ['shirt', 'Shirt', [['#f1e6c8', 'Cream'], ['#2e6f8e', 'Blue'], ['#3f8f5a', 'Green'], ['#c84230', 'Red'], ['#2a2a36', 'Charcoal'], ['#a68ad8', 'Lilac']]],
    ['pants', 'Pants', [['#2a3550', 'Navy'], ['#4a6a9a', 'Denim'], ['#6b5a3a', 'Khaki'], ['#3a3a44', 'Grey'], ['#1b1b24', 'Black']]],
    ['acc', 'Extra', [['none', 'None'], ['scarf', 'Scarf'], ['glasses', 'Glasses'], ['hoodie', 'Hoodie'], ['cap', 'Cap', 'cap'], ['phones', 'Headphones', 'phones'], ['shades', 'Sunglasses', 'shades'], ['gold', 'Gold hoodie', 'gold']]],
  ];
  const NAMES = {}; ROWS.forEach(([, , items]) => items.forEach(([, name, id]) => { if (id) NAMES[id] = name; }));
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const write = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  let data = read(KEY); // {look, earned: [ids]} or null (never customized)

  // Earned = everything earned before plus everything the save meets now, and the ids that are new.
  // keep: write them down (the toast does; loading doesn't, so the toast still sees them as new).
  function refresh(keep) {
    const s = read(SAVE) || {}, had = new Set((data && data.earned) || []), fresh = [];
    for (const id in NEED) if (!had.has(id) && NEED[id][1](s)) { had.add(id); fresh.push(id); }
    if (keep && data && fresh.length) { data.earned = [...had]; write(data); }
    return { earned: had, fresh };
  }
  const allowed = (key, v, earned) => { const it = ROWS.find(r => r[0] === key)[2].find(i => i[0] === v); return !!it && (!it[2] || earned.has(it[2])); };
  // A stored look keeps only values that exist and are unlocked.
  function clean(look, earned) { const out = {}; for (const [k] of ROWS) out[k] = look && allowed(k, look[k], earned) ? look[k] : A.LOOK0[k]; return out; }
  if (data) A.setLook(clean(data.look, refresh().earned));

  // ---------- the editor ----------
  const CSS = `#look-editor{position:fixed;inset:0;z-index:10001;display:grid;place-items:center;overflow:auto;padding:16px;background:radial-gradient(circle at 50% 40%,rgba(24,48,58,.97),rgba(8,16,20,.99));font-family:system-ui,sans-serif;color:#e8efe8}
#look-editor .lk-card{display:grid;grid-template-columns:auto 1fr;gap:22px;width:min(760px,100%);padding:24px;border:1px solid #2e4b58;border-radius:16px;background:rgba(14,30,38,.94);box-shadow:0 24px 60px rgba(0,0,0,.45)}
#look-editor .lk-title{grid-column:1/-1;font:700 14px monospace;letter-spacing:.32em;text-align:center}
#look-editor .lk-stage{display:grid;justify-items:center;align-content:start;gap:12px}
#look-editor .lk-big{padding:12px;border:1px solid #1f3641;border-radius:10px;background:#0b181e}
#look-editor .lk-big svg{display:block;width:160px;height:210px}
#look-editor .lk-poses{display:flex;gap:8px}
#look-editor .lk-poses svg{width:48px;height:63px;padding:4px;border:1px solid #1f3641;border-radius:6px;background:#0b181e}
#look-editor .lk-rows{display:grid;gap:12px;align-content:start}
#look-editor .lk-row{display:grid;gap:6px}
#look-editor .lk-row>b{font:600 11px monospace;letter-spacing:.14em;text-transform:uppercase;color:#a7bcc4}
#look-editor .lk-opts{display:flex;flex-wrap:wrap;gap:6px}
#look-editor .lk-opt{position:relative;display:grid;justify-items:center;gap:2px;padding:4px;border:1px solid #2e4b58;border-radius:7px;background:#0b181e;color:#d3e2e8;font:11px system-ui,sans-serif;cursor:pointer}
#look-editor .lk-opt i{display:block;width:26px;height:26px;border-radius:4px}
#look-editor .lk-opt svg{width:32px;height:42px}
#look-editor .lk-opt[aria-pressed=true]{border-color:#e8b54a;box-shadow:0 0 0 2px rgba(232,181,74,.35)}
#look-editor .lk-opt:disabled{cursor:not-allowed;color:#a7bcc4}
#look-editor .lk-opt:disabled>i,#look-editor .lk-opt:disabled>svg{opacity:.3;filter:grayscale(1)}
#look-editor .lk-opt .lk-lock{position:absolute;top:3px;right:3px;width:10px;height:12px}
#look-editor .lk-opt small{max-width:76px;font-size:10px;line-height:1.2;text-align:center;color:#e8b54a}
#look-editor .lk-opt:focus-visible,#look-editor .lk-actions button:focus-visible{outline:2px solid #7ff0d8;outline-offset:2px}
#look-editor .lk-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px}
#look-editor .lk-actions button{padding:9px 16px;border:1px solid #2e4b58;border-radius:8px;background:#0b181e;color:#e8efe8;font:600 13px system-ui,sans-serif;cursor:pointer}
#look-editor .lk-actions .lk-go{border-color:#7ff0d8;background:#7ff0d8;color:#0d2f33}
@media (max-width:620px){#look-editor .lk-card{grid-template-columns:1fr}#look-editor .lk-big svg{width:120px;height:158px}}`;
  const LOCK = '<svg class="lk-lock" viewBox="0 0 5 6" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="0" width="3" height="1" fill="#e8b54a"/><rect x="1" y="1" width="1" height="2" fill="#e8b54a"/><rect x="3" y="1" width="1" height="2" fill="#e8b54a"/><rect x="0" y="3" width="5" height="3" fill="#e8b54a"/></svg>';
  let box = null;

  function open(first) {
    if (box) return Promise.resolve();
    const earned = refresh().earned;
    let draft = clean(data && data.look, earned), step = 0;
    if (!document.getElementById('look-editor-css')) { const st = document.createElement('style'); st.id = 'look-editor-css'; st.textContent = CSS; document.head.appendChild(st); }
    box = document.createElement('div'); box.id = 'look-editor'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Customize your character');
    box.innerHTML = `<div class="lk-card"><b class="lk-title">YOUR CHARACTER</b>
<div class="lk-stage"><div class="lk-big"></div><div class="lk-poses"></div></div><div class="lk-rows"></div>
<div class="lk-actions"><button type="button" data-act="random">Randomize</button>${first ? '' : '<button type="button" data-act="cancel">Cancel</button>'}<button type="button" class="lk-go" data-act="save">${first ? 'Start' : 'Save'}</button></div></div>`;
    document.body.appendChild(box);
    const big = box.querySelector('.lk-big'), poses = box.querySelector('.lk-poses'), rows = box.querySelector('.lk-rows');
    const pose = o => A.svg('you', Object.assign({ outfit: draft }, o));
    function paint() {
      big.innerHTML = pose({ step: [0, 1, 0, 2][step % 4] });
      poses.innerHTML = pose({ mood: 'happy' }) + pose({ back: true, step: 1 }) + pose({ step: 2 }).replace('<svg ', '<svg style="transform:scaleX(-1)" ');
      rows.innerHTML = ROWS.map(([key, label, items]) => `<div class="lk-row" role="group" aria-label="${label}"><b>${label}</b><div class="lk-opts">${items.map(([v, name, id]) => {
        const locked = id && !earned.has(id), pic = key === 'hair' || key === 'acc' ? A.svg('you', { outfit: Object.assign({}, draft, { [key]: v }) }) : `<i style="background:${v}"></i>`;
        return `<button type="button" class="lk-opt" data-key="${key}" data-v="${v}" aria-pressed="${draft[key] === v}" title="${locked ? name + ': ' + NEED[id][0] : name}" aria-label="${name}${locked ? ', locked: ' + NEED[id][0] : ''}"${locked ? ' disabled' : ''}>${pic}${locked ? LOCK + `<small>${NEED[id][0]}</small>` : `<span>${name}</span>`}</button>`;
      }).join('')}</div></div>`).join('');
    }
    paint();
    const walk = setInterval(() => { step++; big.innerHTML = pose({ step: [0, 1, 0, 2][step % 4] }); }, 220);
    return new Promise(done => {
      const close = save => {
        clearInterval(walk); removeEventListener('keydown', keys, true); box.remove(); box = null;
        if (save) { data = { look: draft, earned: [...earned] }; write(data); A.setLook(draft); window.Loop?.wake(); }
        done();
      };
      // Keys stay in the editor: the office doesn't walk while you pick. Esc cancels (not on the first visit).
      const keys = e => { e.stopImmediatePropagation(); if (e.key === 'Escape' && !first) close(false); };
      addEventListener('keydown', keys, true);
      box.addEventListener('click', e => {
        const opt = e.target.closest('.lk-opt'), act = e.target.closest('[data-act]')?.dataset.act;
        if (opt && !opt.disabled) { draft[opt.dataset.key] = opt.dataset.v; paint(); box.querySelector(`.lk-opt[data-key="${opt.dataset.key}"][data-v="${opt.dataset.v}"]`).focus(); }
        else if (act === 'random') { for (const [k, , items] of ROWS) { const ok = items.filter(i => !i[2] || earned.has(i[2])); draft[k] = ok[Math.floor(Math.random() * ok.length)][0]; } paint(); }
        else if (act === 'save') close(true);
        else if (act === 'cancel') close(false);
      });
      box.querySelector('.lk-go').focus();
    });
  }
  // Re-read first: the cloud save (auth.js) may have brought this account's look in after this file loaded.
  const ensure = () => { data = read(KEY); if (data) A.setLook(clean(data.look, refresh().earned)); return data ? Promise.resolve() : open(true); };

  // New unlocks during play: a toast in the office (#toasts), checked every few seconds against the save.
  setInterval(() => {
    if (!data || box) return;
    const { fresh } = refresh(true), el = document.getElementById('toasts');
    if (!el) return;
    for (const id of fresh) { const t = document.createElement('div'); t.className = 'toast good'; t.textContent = 'New look unlocked: ' + NAMES[id]; el.appendChild(t); setTimeout(() => t.remove(), 3600); }
  }, 3000);

  window.Customize = { ensure, open: () => open(false), NEED, ROWS };
})();
