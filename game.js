/* First Office · the office (Stages 2 and 3), its windows, and Nib. Rules live in engine.js; Stage 3's agents live in stage3/. */
(() => {
  'use strict';
  const D = window.Stage2Data, E = window.Stage2Engine, W = window.CantinaWorld;
  const KEY = 'first-office-game-v1', INTRO = 'first-office-nib-v1', POS = 'first-office-avatar-v1';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const pct = p => Math.round(p * 100) + '%';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));
  const T = E.targetById, F = E.FINDINGS, C = D.CLASSES;

  // ---------- save ----------
  let saveOk = true;
  function intro() { try { return JSON.parse(localStorage.getItem(INTRO)) || {}; } catch { return {}; } }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return E.restore(JSON.parse(raw)); }
    catch { try { localStorage.setItem(KEY + '-recovery', localStorage.getItem(KEY)); } catch { saveOk = false; } }
    return E.create(intro(), crypto.getRandomValues(new Uint32Array(1))[0]);
  }
  // Stage 1 (meet.html) comes first: no office until you've met Nib and taken the job.
  if (!localStorage.getItem(KEY) && !intro().completedAt) { location.replace('/meet.html'); return; }
  let s = load();
  const stage3 = () => s.stage === 3;
  // frozen: set by leave(), right after the last save before a navigation. Nothing may write an old save back.
  let frozen = false;
  function save() { if (frozen) return; try { localStorage.setItem(KEY, JSON.stringify(s)); saveOk = true; } catch { saveOk = false; } }

  // ---------- stations ----------
  // The published office's stations, given Stage 2 jobs. `seen` names the engine flag that reveals each one.
  const ST = {
    hunt: { name: 'Desk', title: 'YOUR DESK', icon: 'bug', key: 'h', seen: null },
    training: { name: 'Nib', title: 'NIB · PATTERN BOOK', icon: 'book', key: 't', seen: 'training' },
    contract: { name: 'Ops', title: 'OPS · NIB\'S OVERNIGHT FINDS', icon: 'briefcase', key: 'o', seen: 'ops' },
    forge: { name: 'Tools', title: 'TOOL SHELF', icon: 'build', key: 'b', seen: 'forge' },
    rig: { name: 'Rig', title: 'GPU RIG', icon: 'bolt', key: 'r', seen: 'rig' },
    stats: { name: 'Ledger', title: 'LEDGER · REPUTATION', icon: 'chart', key: 'i', seen: 'stats' },
    hq: { name: 'HQ', title: 'HQ · CRITICALS', icon: 'shield', key: 'c', seen: 'hq' }
  };
  const ORDER = ['hunt', 'training', 'contract', 'forge', 'rig', 'stats', 'hq'];
  // The dock groups stations so it stays short: Desk on its own, the rest in pop-up groups (hover, focus or tap).
  // A group with one station unlocked shows that station as a plain button; it becomes a group once a second arrives.
  const GROUPS = {
    jobs: { name: 'Jobs', icon: 'briefcase', ids: ['contract', 'hq'] },
    gear: { name: 'Gear', icon: 'build', ids: ['forge', 'rig'] },
    books: { name: 'Books', icon: 'book', ids: ['training', 'stats'] }
  };
  const SLOTS = ['hunt', 'jobs', 'gear', 'books'];
  const shown = id => !ST[id].seen || !!s.seen[ST[id].seen];
  const hidden = () => { const h = { terminals: true }; ORDER.forEach(id => { if (!shown(id)) h[id] = true; }); return h; };
  const SPOT = { // where Nib stands, in office world px
    side: [184, 104], home: [232, 184], rig: [232, 216], ops: [40, 72], hq: [184, 56]
  };
  const nibHome = () => shown('training') ? SPOT.home : SPOT.side;

  // ---------- world ----------
  let ui = { win: null, view: s.target ? 'map' : 'board', room: null, fid: null, miss: null, hit: null, result: null, traceMsg: null, busy: false, night: false };
  const world = W.create($('world'), id => openStation(id), ctx => {
    const st = ctx.id && ST[ctx.id];
    $('interact').disabled = !ctx.id;
    $('interact-label').textContent = st ? 'Use ' + st.name : ctx.id ? ctx.label : 'Walk up to a desk';
  });
  function worldView() {
    const flags = {};
    if (s.tray.length) flags.contract = 'amber';
    if (Object.keys(T).some(tid => E.chainState(s, tid).ready)) flags.hq = 'amber';
    const timers = ui.night ? [{ station: shown('rig') ? 'rig' : 'hunt', caption: 'Nib working', remaining: 'night', progress: ui.nightP || 0 }] : [];
    return { hq: 1, facilities: { hq: 1, rig: Math.max(1, s.gpu), forge: Math.max(1, s.tools.length - 1), vault: 1, ops: 1 }, vault: Math.min(1, s.cash / 4000), dormant: Object.keys(hidden()), flags, timers };
  }
  const blocked = () => ui.night || $('modal').open || $('settings-dialog').open || (!!ui.win && $('panel-dialog').open);
  function syncWorld() { world.update({ started: true, paused: false, won: s.won, speed: 1, movementSpeed: 1, compute: s.gpu }, null, false, blocked(), worldView()); }
  function layout() {
    const dock = document.querySelector('.dock-shell').getBoundingClientRect(), hud = document.querySelector('.hud').getBoundingClientRect();
    world.setInsets(punchIns({ top: Math.max(64, hud.bottom + 8), bottom: innerHeight - dock.top + 12, left: vitalsGutter(), hud: { left: hud.left, bottom: hud.bottom + 8 } })); // #13: scaled while the office punches in
    document.documentElement.style.setProperty('--dock-top', Math.round(innerHeight - dock.top) + 'px');
    world.setTouch(matchMedia('(pointer: coarse)').matches || innerWidth < 650);
    requestAnimationFrame(() => { placeLamps(); fitVitals(); }); // #12: the room moved; its lamps (and the vitals box) follow once world.js has refit it
  }

  // Nib docks to an open window, and stays docked while it shrinks away. Out of sight (a window over the office, or Team),
  // his happy hop plays on his dock portrait instead (faceHop).
  const nib = window.NibActor.create({ W, world, canvas: $('nib-layer'), bubble: $('nib-bubble'), hidden, side: () => 'right', dock: () => (ui.win || winFx?.shut) && $('panel-dialog').open ? winRect() : null,
    covered: () => !!ui.win || document.body.classList.contains('s3-agents-open'), faceHop });
  // Lines that wait for the player (Next or a choice) queue up; timed lines (tips) are interrupted by anything newer,
  // but a newer tip waits its turn: until the tip has been up TIP ms and fully shown (typed or skipped) for READ ms.
  // While a line waits, the one typing hurries (#11). A line you must answer doesn't wait behind tips: the tip on screen
  // is shown whole and kept up ASK ms, then the question takes over; tips queued before it go to the dock line.
  const TIP = 2000, READ = 1000, HURRY = 1000, ASK = 1000, after = ms => new Promise(r => setTimeout(r, ms));
  let queue = Promise.resolve(), waiting = 0, tips = Promise.resolve(), tip = null, pend = 0, asked = 0;
  // A line on screen ({at, h: its talk.js handle}) notes when it's all shown; turn() resolves when the next may replace it.
  const onAir = l => { l.h.done.then(() => { l.shown = Date.now(); }); return l; };
  const turn = l => l ? l.h.done.then(() => after(Math.min(l.until || Infinity, Math.max(l.at + TIP, l.shown + READ)) - Date.now())) : Promise.resolve();
  function nibSay(text, o) {
    o = o || {};
    const timed = !o.next && !o.choices;
    if (timed && waiting) { flashLine(text, o.ms || 3600); return Promise.resolve(true); }
    if (timed && innerWidth < 700 && $('panel-dialog').open) { flashLine(text, o.ms || 3600); return Promise.resolve(true); }
    const q = asked; pend++; if (tip) timed ? tip.h.hurry(HURRY) : tip.h.finish();
    // A line that waits for you (Next or a choice) must be seen: bring you back from the Team view.
    const show = () => {
      pend--;
      if (frozen) return [Promise.resolve(false)]; // leaving for another chapter: the office stays as it was behind the iris
      if (timed && ui.night) return [Promise.resolve(false)]; // a tip still waiting its turn when you went to sleep is dropped
      if (timed && (waiting || q !== asked)) { flashLine(text, o.ms || 3600); return [Promise.resolve(true)]; } // a question went first
      if (!timed) { asked++; if (window.Stage3UI?.isOpen()) window.Stage3UI.close(); }
      const r = nib.say(text, o);
      tip = timed ? onAir({ at: Date.now(), h: $('nib-bubble').querySelector('.nib-text').talk }) : null;
      if (tip && pend) tip.h.hurry(HURRY);
      return [r];
    };
    const run = () => { const t = tips.then(() => turn(tip)).then(show); tips = t.then(() => {}); return t.then(([r]) => r); };
    const ask = () => { const l = tip; return (l ? l.h.done.then(() => after(l.at + ASK - Date.now())) : Promise.resolve()).then(show).then(([r]) => r); };
    if (timed) return queue.then(run, run);
    waiting++; const p = queue.then(ask, ask); p.finally(() => { waiting--; }); queue = p.catch(() => {});
    return p;
  }
  const nibWalk = (spot, then) => new Promise(r => nib.goTo(spot[0], spot[1], () => { if (then) then(); r(); }));
  function nibToPlayer() { const p = world.getState(); return nibWalk([Math.min(304, p.x + 22), p.y]); }

  // Nib's line in the dock shows a timed line for a while (phones with a window open). Same pacing, in order.
  let flash = null, flashes = Promise.resolve(), flashN = 0;
  function flashLine(text, ms) {
    flashN++; if (flash) flash.h.hurry(HURRY);
    flashes = flashes.then(() => turn(flash)).then(() => {
      flashN--; if (ui.night) return; // a line still queued at nightfall is stale by morning
      const f = flash = { text, at: Date.now(), until: Infinity }; render(); f.h = $('objective').talk; onAir(f); if (flashN) f.h.hurry(HURRY);
      f.h.done.then(() => { f.until = Date.now() + ms; setTimeout(render, ms + 50); }); // #11: its time counts from when it's typed
    });
  }

  // Drafts nobody is working on: an agent gave up on them, or they come from an old save. One click files them.
  function leftoverDrafts() {
    const busy = new Set((window.Stage3Agents ? window.Stage3Agents.list() : []).filter(a => window.Stage3Agents.live(a)).flatMap(a => a.task?.drafts || []));
    return Object.keys(s.found).filter(fid => s.found[fid].status === 'draft' && s.pendingTeach !== fid && !busy.has(fid));
  }

  // ---------- objective: always one clear next step ----------
  function objective() {
    if (stage3()) return objective3();
    if (s.won) return 'Job done, ' + s.player + '. Chapter 3 is ready when you are: click the goal.';
    if (!s.target) return 'Walk to your desk and press E. Our first job is on the computer.';
    if (s.pendingTeach) return 'Tell me why that was a bug.';
    const drafts = leftoverDrafts(), draft = drafts[0];
    if (Object.keys(T).some(tid => E.chainState(s, tid).ready)) return 'Both halves of a chain are in. Trace it at HQ.';
    if (s.tray.length >= D.COST.tray) return 'The Ops desk is full, so I can\'t work tonight. Clear some finds.';
    if (s.tray.length) return 'I left ' + s.tray.length + ' find' + (s.tray.length > 1 ? 's' : '') + ' on the Ops desk.';
    if (draft) return 'A find is waiting to be filed on the Ops desk.';
    if (s.focus < E.maxFocus(s) * 0.1) return s.cups ? 'You\'re fading. Coffee, or sleep and I\'ll take the night shift.' : 'Out of focus. Sleep. I\'ll keep working.';
    const tid = s.target, t = T[tid];
    const open = s.lit[tid].flatMap(rid => E.roomFindings(tid, rid)).filter(fid => E.slotState(s, fid) === 'open');
    if (open.length) return 'Hunt in ' + t.rooms.find(r => r[0] === F[open[0]].room)[1] + '.' + (s.bugs ? ' ' + s.bugs + '/20 so far.' : '');
    if (t.rooms.some(r => E.canMap(s, tid, r[0]))) return 'Map another room of ' + t.name + '.';
    if (s.lit[tid].flatMap(rid => E.roomFindings(tid, rid)).some(fid => E.slotState(s, fid) === 'locked')) return 'What\'s left here needs tools. Buy one, or pick another job.';
    return t.name + ' is picked clean. Time for another job.';
  }

  // Chapter 3's goal: Elite reputation, with at least this many bugs landed by agents (not just carried over).
  const TEAM_GOAL = 5;
  function objective3() {
    if (s.won3) return 'Elite. The team works. Next chapter: a rival company.';
    if (s.rep >= 60 && (s.stats.agent || 0) < TEAM_GOAL) return 'We\'re Elite already. Now prove the team works: ' + (TEAM_GOAL - (s.stats.agent || 0)) + ' more bugs from agents.';
    if (s.pendingTeach) return 'Tell me why that was a bug.';
    const A = window.Stage3Agents, busy = A ? A.busy() : 0, need = A ? A.list().filter(a => a.q).length : 0;
    if (need) return need === 1 ? 'An agent is waiting on you. Open Team.' : need + ' agents are waiting on you. Open Team.';
    if (s.tray.length && !busy) return 'I left ' + s.tray.length + ' find' + (s.tray.length > 1 ? 's' : '') + ' on Ops. Prove them, or brief someone to.';
    if (!busy && A && A.list().some(a => a.status === 'resting')) return 'The team is out of focus. Sleep, and they start fresh tomorrow.';
    if (!busy) return (60 - s.rep) + ' rep to Elite. Open Team and give someone a job.';
    return busy + ' working · ' + s.rep + '/60 rep. Hunt too, or sleep and I\'ll fill the tray.';
  }

  // Windows and the dock redraw by patching: a redraw (agents, Nib, a payment) keeps every node that's still there and only patches what changed. Replacing them
  // all put a fresh, un-hovered button under a resting cursor: it faded back to its hover colour each time, a blink, and
  // in some browsers stayed un-hovered until the mouse moved. Nodes match by tag and key (id, data-act, data-id).
  const morphTpl = document.createElement('template');
  const morphKey = n => n.nodeType === 1 ? [n.tagName, n.id, n.dataset.act, n.dataset.id, n.dataset.stamp, n.dataset.station, n.dataset.group, n.dataset.menu].join('|') : n.nodeType;
  const KEEP = ['pressing', 'nudge']; // buttons.js's classes: a press in progress and a waiting nudge stay on the button
  function morph(cur, html) { morphTpl.innerHTML = html; patch(cur, morphTpl.content); }
  function patchNode(o, n) {
    if (n.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    const kept = KEEP.filter(c => o.classList.contains(c));
    for (const at of [...o.attributes]) if (!n.hasAttribute(at.name)) o.removeAttribute(at.name);
    for (const at of [...n.attributes]) if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
    kept.forEach(c => o.classList.add(c));
    patch(o, n);
  }
  function patch(cur, next) {
    const a = [...cur.childNodes], b = [...next.childNodes];
    b.forEach((n, i) => { const o = a[i]; if (o && morphKey(o) === morphKey(n)) patchNode(o, n); else if (o) cur.replaceChild(n, o); else cur.appendChild(n); });
    for (let i = b.length; i < a.length; i++) a[i].remove();
  }
  // ---------- HUD + dock ----------
  // dockNew: a new button's [order, animation-clock time it arrived]. It stays `fresh` until its entrance has played, so a
  // second render in the same task (or any rebuild mid-entrance) keeps it, and the entrance carries on from its start.
  let dockSeen = null; const dockNew = new Map();
  let dockOpen = null, dockHush = null; // the group whose menu a click or tap opened (hover and focus need no state); the one a pick just hid
  // Each dock slot: a lone station, or a group once two or more of its stations are unlocked. key names it for entrances.
  function slots() {
    return SLOTS.map(k => {
      const ids = GROUPS[k] ? GROUPS[k].ids.filter(shown) : shown(k) ? [k] : [];
      return ids.length > 1 ? { key: k, ids, g: k } : ids.length ? { key: ids[0], ids } : null;
    }).filter(Boolean);
  }
  // The menu is centred over its button, kept inside the dock.
  function placeMenu(btn) {
    const m = btn && btn.nextElementSibling; if (!m || !m.classList.contains('dock-menu')) return;
    const d = $('dock'), half = m.offsetWidth / 2, c = btn.offsetLeft + btn.offsetWidth / 2;
    const x = Math.round(Math.max(half + 4, Math.min(d.clientWidth - half - 4, c)));
    m.style.left = x + 'px'; m.style.setProperty('--notch', Math.round(c - x) + 'px'); // the notch still points at the button
    if (btn.offsetTop > 20) m.style.bottom = `${d.clientHeight - btn.offsetTop + 8}px`; else m.style.bottom = '';
  }
  function setMenu(g) {
    dockOpen = g || null;
    document.querySelectorAll('#dock [data-group]').forEach(b => { const on = b.dataset.group === dockOpen; b.setAttribute('aria-expanded', on); b.nextElementSibling.classList.toggle('open', on); if (on) placeMenu(b); });
    // keep the render cache honest, so the next render doesn't think nothing changed
    $('dock').dataset.html = '';
  }
  // Hover and focus show a menu by CSS; place it as it shows. A pick hides it until the pointer leaves.
  $('dock').addEventListener('pointerover', e => { const b = e.target.closest('[data-group]'); if (b) placeMenu(b); });
  $('dock').addEventListener('focusin', e => { const b = e.target.closest('[data-group]'); if (b) placeMenu(b); });
  // The hush lasts until the pointer is off both the group's button and where its menu was (a hidden menu takes no hover).
  document.addEventListener('pointermove', e => {
    if (!dockHush || e.target.closest?.(`#dock [data-group="${dockHush}"]`)) return;
    const m = document.querySelector(`#dock [data-menu="${dockHush}"]`), r = m && m.getBoundingClientRect();
    if (r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 16) return;
    dockHush = null; document.querySelectorAll('.dock-menu.hush').forEach(m => m.classList.remove('hush')); $('dock').dataset.html = '';
  }, { passive: true });
  document.addEventListener('pointerdown', e => { if (dockOpen && !e.target.closest('#dock [data-group],.dock-menu')) setMenu(null); }, true);
  function render() {
    if (frozen) return; // leaving: the save may already be the next chapter's; the office stays as it was behind the iris
    const mf = E.maxFocus(s);
    $('focus').hidden = !s.seen.job;
    focusMeter(s.focus, mf);
    $('focus-fill').classList.toggle('low', s.focus < mf * 0.25);
    $('focus-num').textContent = s.focus + '/' + mf;
    $('coffee').hidden = !s.seen.rest; $('sleep').hidden = !s.seen.rest;
    $('cups').textContent = s.cups; $('coffee').disabled = !s.cups || s.focus >= mf;
    $('date').textContent = 'DAY ' + s.day;
    const teamBugs = s.stats.agent || 0;
    $('goal-name').textContent = stage3() ? 'Elite, with the team' : s.won ? 'Chapter 3: Hire help' : '20 bugs + 1 critical';
    $('goal-pay').textContent = stage3() ? Math.min(s.rep, 60) + '/60 rep · ' + Math.min(teamBugs, TEAM_GOAL) + '/' + TEAM_GOAL + ' team bugs' : s.won ? 'Job done · start →' : s.bugs + '/20 bugs · ' + Math.min(s.crits, 1) + '/1 crit';
    document.querySelector('#nib-line b').textContent = s.nib;
    $('chapter-sub').textContent = stage3() ? '03 · Hire help' : '02 · First job together';
    document.body.classList.toggle('stage3', stage3());
    if (stage3() && !s.won3 && s.rep >= 60 && teamBugs >= TEAM_GOAL) { s.won3 = true; const p = lastPay && performance.now() - lastPay.t < 1500 ? lastPay : { station: 'founder' }; setTimeout(() => goal(ending3, p.station, p.who), 1200); } // the pay that reached Elite
    window.Talk.set($('objective'), flash && Date.now() < flash.until ? flash.text : objective()); // #11: new wording types out, new numbers don't
    $('stats-open').hidden = !s.seen.stats;
    vitals();
    $('view-toggle').hidden = !s.seen.intro;
    wallet();
    placeLamps(); // #12: lamp pools follow the stations you've unlocked
    const known = (dockSeen = dockSeen || new Set(slots().map(x => x.key))), now = document.timeline.currentTime || 0;
    let freshN = 0; // new dock buttons arrive 3 frames apart (style.css --stagger)
    const badgeOf = id => id === 'contract' && s.tray.length ? s.tray.length : id === 'hq' && Object.keys(T).some(t => E.chainState(s, t).ready) ? '!' : '';
    const chip = b => b === '' ? '' : `<span class="badge">${b}</span>`;
    const station = (id, cls, extra) => `<button data-station="${id}" data-icon="${ST[id].icon}" class="${cls}"${extra} aria-pressed="${ui.win === id}" title="${ST[id].name} (${ST[id].key.toUpperCase()})">${ST[id].name}${chip(badgeOf(id))}</button>`;
    $('dock').style.setProperty('--span', 12 / Math.max(1, slots().length)); // narrow screens: the slots share one row
    const btns = slots().map(({ key, ids, g }) => {
      if (!known.has(key)) { known.add(key); dockNew.set(key, [freshN++, now]); }
      const nw = dockNew.get(key), fresh = !!nw && now - nw[1] < 470 + nw[0] * STAGGER; // dock-in is .42s
      if (nw && !fresh) dockNew.delete(key);
      const cls = fresh ? 'fresh' : '', at = fresh ? ` style="--i:${nw[0]}"` : '';
      if (!g) return station(ids[0], cls, at);
      // A group: its button, then its menu (a sibling, so the button stays a direct child of the dock's flex/grid).
      // The group's badge adds up its stations' counts ("!" when only HQ's chain is ready).
      const bs = ids.map(badgeOf).filter(b => b !== ''), n = bs.reduce((a, b) => a + (+b || 0), 0), on = ids.includes(ui.win);
      const items = ids.map(id => station(id, 'dock-item', '').replace('</button>', `<kbd>${ST[id].key.toUpperCase()}</kbd></button>`)).join('');
      return `<button data-group="${key}" data-icon="${GROUPS[g].icon}" class="${cls}"${at} aria-haspopup="true" aria-expanded="${dockOpen === g}" aria-pressed="${on}" title="${ids.map(id => ST[id].name).join(' · ')}">${on ? ST[ui.win].name : GROUPS[g].name}${chip(bs.length ? n || '!' : '')}</button>`
        + `<div class="dock-menu${dockOpen === g ? ' open' : ''}${dockHush === g ? ' hush' : ''}" data-menu="${g}" role="group" aria-label="${GROUPS[g].name}">${items}</div>`;
    }).join('');
    const dock = $('dock');
    if (dock.dataset.html !== btns) {
      // Same slots as before (a badge or pressed state changed): patch them in place, so the button under the cursor keeps
      // its hover (see morph). New or removed slots rebuild the row.
      const olds = [...dock.querySelectorAll(':scope>[data-station],:scope>[data-group],:scope>.dock-menu')];
      morphTpl.innerHTML = btns; const news = [...morphTpl.content.children];
      if (olds.length === news.length && olds.every((o, i) => morphKey(o) === morphKey(news[i]))) olds.forEach((o, i) => patchNode(o, news[i]));
      else { olds.forEach(b => b.remove()); $('stats-open').insertAdjacentHTML('beforebegin', btns); }
      dock.dataset.html = btns;
      dock.querySelectorAll('.fresh').forEach(b => b.getAnimations().forEach(a => { a.startTime = dockNew.get(b.dataset.station || b.dataset.group)[1]; }));
      if (dockOpen) placeMenu(dock.querySelector(`[data-group="${dockOpen}"]`));
    }
    syncWorld();
    save();
  }
  function toast(text, kind) {
    const box = $('toasts'), el = document.createElement('div'), b = $('nib-bubble'); el.className = 'toast ' + (kind || ''); el.textContent = text;
    // Phones: an open window fills the space above the dock, so the stack starts at the top instead, over the HUD, clear of
    // the window's buttons (unless Nib's strip is docked up there). It only moves when it's empty, so toasts never jump.
    if (!box.children.length) box.classList.toggle('top', matchMedia('(max-width:700px)').matches && $('panel-dialog').open && (b.hidden || !b.classList.contains('docked')));
    toastShift(() => { box.appendChild(el); while (box.children.length > 3) box.firstChild.remove(); });
    requestAnimationFrame(() => { el.shown = true; }); // toasts that arrive together just rise; only ones already up slide
    setTimeout(() => toastShift(() => el.remove()), 3600);
  }
  // Phones: if Nib's strip docks at the top while toasts sit there, the stack slides down to the dock so his question stays readable.
  new MutationObserver(() => { const box = $('toasts'), b = $('nib-bubble'); if (box.classList.contains('top') && !b.hidden && b.classList.contains('docked')) toastShift(() => box.classList.remove('top')); })
    .observe($('nib-bubble'), { attributes: true, attributeFilter: ['class', 'hidden'] });
  // The stack makes room by sliding (FLIP), never jumping, when a toast comes or goes. `translate`, so a toast's own rise
  // (a transform) is untouched.
  function toastShift(change) {
    const was = reduced ? [] : [...$('toasts').children].filter(t => t.shown).map(t => [t, t.getBoundingClientRect().top]);
    change();
    was.forEach(([t, y]) => { const dy = Math.round(y - t.getBoundingClientRect().top); if (t.isConnected && dy) t.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: 220, easing: SETTLE }); });
  }
  function floatAt(text, station) { world.float(text, station); window.StationFX?.emit(station, 'float', { text }); }

  // ---------- wallet motion: rolling counters (#3) and pay chips flying to the wallet (#4) ----------
  // Cash and rep roll to new values instead of jumping: the number dips, bumps and flashes green on a gain, red on a
  // loss. Pay still in flight in a chip is held back, so the wallet changes when the chip lands, not before.
  const ROLL = 650, held = { cash: 0, rep: 0 }, rolls = {}, chips = [];
  let rolling = false, shownKey = '';
  // What the wallet shows: the true values less pay still in flight. The HUD, the window's bar and Team's footer all use it.
  const shownWallet = () => ({ cash: s.cash - held.cash, rep: s.rep - held.rep });
  function wallet() {
    // A spend or penalty made while pay is in flight can eat into it: land those chips now, so it never shows below zero.
    for (const c of [...chips]) if (s.cash < held.cash || s.rep < held.rep) land(c, true);
    const w = shownWallet();
    $('cash').dataset.value = s.cash; $('rep').dataset.value = s.rep; // the true values, readable before a roll ends
    rollTo('cash', w.cash, money, 0); rollTo('rep', w.rep, String, 50); // rep starts 3 frames after cash
    $('panel-wallet').textContent = s.seen.stats ? money(w.cash) + ' · ' + w.rep + ' rep' : '';
    const k = w.cash + ':' + w.rep; if (k !== shownKey) { shownKey = k; dispatchEvent(new Event('first-office:wallet')); } // Team's footer follows
  }
  // #9 Ghost drain: a spend drops the fill at once with a flash, and a pale ghost of the old amount holds 450 ms, then
  // drains 450 ms. Spending mid-drain extends the ghost from where it is; gains just fill (the CSS transition), no ghost.
  let focusWas = null;
  function focusMeter(v, mf) {
    const f = $('focus-fill'), m = f.parentNode, p = v / mf * 100, was = focusWas; focusWas = v;
    let g = m.querySelector('.ghost'); if (!g) { g = document.createElement('b'); g.className = 'ghost'; f.before(g); }
    if (was === null || v >= was || reduced || document.hidden || $('focus').hidden || !m.clientWidth) {
      if (was !== null && v > was) { g.getAnimations().forEach(a => a.cancel()); g.style.width = '0'; } // a refill swallows any ghost left
      f.style.width = p + '%'; return;
    }
    const w = m.clientWidth, from = Math.max(g.getBoundingClientRect().width, f.getBoundingClientRect().width) / w * 100;
    f.style.transition = 'none'; f.style.width = p + '%'; void f.offsetWidth; f.style.transition = ''; // drops at once
    f.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], 200);
    $('focus').querySelector('.k').animate([{ transform: 'none' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], 160);
    g.getAnimations().forEach(a => a.cancel()); g.style.width = p + '%'; // rests under the fill; no filled animation left to go stale
    g.animate([{ width: from + '%' }, { width: from + '%', offset: .5, easing: 'cubic-bezier(.5,0,.3,1)' }, { width: p + '%' }], 900);
  }
  function rollTo(id, v, fmt, lag) {
    const el = $(id); let r = rolls[id];
    if (!r || reduced || document.hidden) { rolls[id] = { el, fmt, lag, to: v, shown: v }; el.textContent = fmt(v); el.parentNode.classList.remove('gain', 'loss'); return; }
    if (v === r.to) return; // render() runs often: only a new target starts (or retargets) a roll
    r.to = v; r.t0 = null; // starts next frame, so a change undone in the same tick (pay held for its chip) never shows
    if (!rolling) { rolling = true; requestAnimationFrame(rollFrame); }
  }
  function rollFrame(now) {
    rolling = false;
    for (const r of Object.values(rolls)) {
      const res = r.el.parentNode;
      if (r.t0 === null) { // new target: ease out from whatever is shown now, so a retarget mid-roll never jumps
        if (r.to === r.shown) { r.t0 = undefined; r.on = false; res.classList.remove('gain', 'loss'); continue; }
        r.from = r.shown; r.t0 = now + (r.on ? 0 : r.lag);
        res.classList.toggle('gain', r.to > r.from); res.classList.toggle('loss', r.to < r.from);
        if (!r.on) { r.on = true; res.classList.remove('bump'); void res.offsetWidth; res.classList.add('bump'); }
      }
      if (r.t0 == null) continue;
      const k = Math.max(0, Math.min(1, (now - r.t0) / ROLL));
      r.shown = k < 1 ? r.from + (r.to - r.from) * (1 - Math.pow(1 - k, 3)) : r.to;
      r.el.textContent = r.fmt(Math.round(r.shown));
      if (k < 1) rolling = true; else { r.t0 = undefined; r.on = false; res.classList.remove('gain', 'loss'); }
    }
    if (rolling) requestAnimationFrame(rollFrame);
  }
  // A payment sends a "+$131" chip along an arc into the cash display, from the tag that stamps it (once that has
  // landed), else the agent or station. Several payouts leave 3 frames apart, lined up, never piled on each other;
  // at most 4 fly at once and the rest wait their turn, their pay still held, so money always lands with a chip.
  let nextPop = 0, lastPop = 0, burst = 0, lastLand = 0, inAir = 0;
  function payChip(r, station, who, key) {
    if (r.pay) window.StationFX?.emit(station, 'pay', { amount: r.pay, crit: !!r.crit, who: who || 'you' });
    punchFor(r, station, who, key); // #13: a critical or the goal also punches the office in
    if (reduced || document.hidden || !r.pay || $('modal').open || document.body.classList.contains('s3-agents-open')) return false;
    const c = { pay: r.pay, rep: r.rep || 0, crit: !!r.crit, station, who, key }, clear = new Promise(go => c.go = go);
    chips.push(c); held.cash += c.pay; held.rep += c.rep; wallet(); // agents' pay was already rendered: take it back until the chip lands
    setTimeout(() => land(c), 4000); // never hold pay longer than this, even if frames stop (hidden tab)
    flyChip(c).finally(c.go);
    return clear; // resolves once the chip is well clear of where it left (an agent's label waits on it, #16)
  }
  // An element's layout box, without its transform (a tag mid-slam or mid-settle).
  const restRect = el => { const p = el.offsetParent, b = p ? p.getBoundingClientRect() : new DOMRect(); return new DOMRect(b.left + (p ? p.clientLeft - p.scrollLeft : 0) + el.offsetLeft, b.top + (p ? p.clientTop - p.scrollTop : 0) + el.offsetTop, el.offsetWidth, el.offsetHeight); };
  function chipFrom(c) {
    const body = !c.who && $('panel-dialog').open && $('panel-body');
    let tag = body && (body.querySelector(`[data-stamp="${c.key}"]`) || body.querySelector('.feedback.hit [data-stamp]')); // a burst on Ops: the newest result
    const t = tag && restRect(tag), vis = body && $('panel-dialog').getBoundingClientRect(), bar = body && $('panel-dialog').querySelector('.bar').getBoundingClientRect();
    if (t && (t.top < bar.bottom || t.bottom > vis.bottom)) tag = null; // scrolled out of the window: as if it weren't there
    const ag = c.who && document.querySelector(`#s3-layer:not([hidden]) [data-chat="${c.who}"]`);
    const b = tag ? t : ag?.getBoundingClientRect() || world.anchor(c.station);
    const p = !b || !b.width || b.left + b.width / 2 < 0 || b.left + b.width / 2 > innerWidth || b.top < 0 || b.top > innerHeight ? { x: innerWidth / 2, y: innerHeight / 2 }
      : { x: b.left + b.width / 2, y: b.top - 8 }; // just above the tag or head, never over it
    // Hidden under the open window (an agent, a desk, the centre): start from the window's nearest edge, not its middle.
    const w = !tag && $('panel-dialog').open && winRect(), m = 14;
    if (w && p.x > w.left && p.x < w.right && p.y > w.top && p.y < w.bottom) {
      const out = [[w.left - m, p.y], [w.right + m, p.y], [p.x, w.top - m], [p.x, w.bottom + m]].filter(([x, y]) => x > 8 && x < innerWidth - 8 && y > 8 && y < innerHeight - 8);
      if (out.length) [p.x, p.y] = out.reduce((a, q) => Math.hypot(q[0] - p.x, q[1] - p.y) < Math.hypot(a[0] - p.x, a[1] - p.y) ? q : a);
    }
    return p;
  }
  async function flyChip(c) {
    const frame = () => new Promise(r => requestAnimationFrame(r)), sleep = ms => new Promise(r => setTimeout(r, ms));
    await frame(); // the window has redrawn: the payment's tag is showing
    // Its tag stamps first: the chip pops 6 frames after the hit-stop releases. A tag that never shows doesn't hold it long.
    const st = c.key && stamps.get(c.key);
    for (const t = performance.now(); st && st.out == null && performance.now() - t < 1500 && chips.includes(c);) await frame();
    if (st && st.out != null) await sleep(st.out + 100 - document.timeline.currentTime);
    while (inAir >= 4 && chips.includes(c)) await frame(); // a slot frees when a chip lands
    const at = Math.max(performance.now(), nextPop); nextPop = at + 50; await sleep(at - performance.now()); // offset: 3 frames apart
    const w = $('cash').getBoundingClientRect();
    if (!chips.includes(c) || !w.width || document.hidden || document.body.classList.contains('s3-agents-open')) return land(c);
    const t0 = performance.now(); burst = t0 - lastPop < 400 ? Math.min(burst + 1, 3) : 0; lastPop = t0;
    const p0 = chipFrom(c), p2 = { x: w.left + w.width / 2, y: w.top + w.height / 2 };
    const lift = Math.min(160, Math.max(60, Math.hypot(p2.x - p0.x, p2.y - p0.y) * 0.35));
    const p1 = { x: p0.x + (p2.x - p0.x) * 0.2, y: Math.max(12, Math.min(p0.y, p2.y) - lift) };
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, ux = (p1.x - p0.x) / d, uy = (p1.y - p0.y) / d, back = { x: -ux * 3, y: -uy * 3 };
    p0.x -= ux * burst * 24; p0.y -= uy * burst * 24; // a burst lines up behind the first chip, so they leave in a row, never through each other
    const el = document.createElement('div'); el.className = 'pay-chip' + (c.crit ? ' crit' : ''); el.textContent = '+' + money(c.pay);
    document.body.appendChild(el); inAir++;
    const hw = el.offsetWidth / 2, hh = el.offsetHeight / 2, io = (t, n) => t < 0.5 ? Math.pow(2 * t, n) / 2 : 1 - Math.pow(2 - 2 * t, n) / 2;
    let last = p0, lt = t0;
    for (;;) {
      const now = await frame(), t = now - t0;
      if (!chips.includes(c) || t >= 900 || document.body.classList.contains('s3-agents-open')) break; // landed early (a spend), arrived, or Team covers it
      let x = p0.x, y = p0.y, sc = 1, op = 1, blur = 0;
      if (t < 180) { const k = t / 180; sc = k < 0.5 ? 0.6 + 1.1 * k : 1.3 - 0.3 * k; op = Math.min(1, k * 2); } // pop
      else if (t < 280) { const e = io((t - 180) / 100, 3); x += back.x * e; y += back.y * e; } // anticipation: pull back 6 frames
      else { // the arc: a quadratic curve, shrinking into the wallet
        const e = io((t - 280) / 620, 2), u = 1 - e, ax = p0.x + back.x, ay = p0.y + back.y;
        x = u * u * ax + 2 * u * e * p1.x + e * e * p2.x; y = u * u * ay + 2 * u * e * p1.y + e * e * p2.y; sc = 1 - 0.35 * e;
        if (Math.abs(x - p0.x) > 100 || e > 0.8) c.go(); // past where an agent's label rises (#16)
        const v = Math.hypot(x - last.x, y - last.y) / Math.max(1, (now - lt) / 16.7); // px per frame
        blur = Math.round(Math.min(2.5, Math.max(0, (v - 4) / 6)) * 10) / 10; // motion blur only while fast
      }
      last = { x, y }; lt = now;
      el.style.cssText = `opacity:${op};filter:${blur ? `blur(${blur}px)` : 'none'};transform:translate(${Math.round(x - hw)}px,${Math.round(y - hh)}px) scale(${sc.toFixed(3)})`;
    }
    inAir--; land(c); el.remove();
  }
  function land(c, quiet) {
    const i = chips.indexOf(c); if (i < 0) return;
    chips.splice(i, 1); held.cash -= c.pay; held.rep -= c.rep; if (!quiet) wallet(); // quiet: wallet() is landing it
    const w = $('stats-open'), now = performance.now();
    if (!reduced && !w.hidden && now - lastLand > 160) { w.classList.remove('land'); void w.offsetWidth; w.classList.add('land'); lastLand = now; } // a small squash, not one per chip
  }

  // ---------- windows ----------
  function openStation(id) {
    if (!ST[id] || !shown(id) || ui.night) return;
    if (id === 'hunt' && !s.target) ui.view = 'board';
    ui.win = id; ui.result = null; ui.traceMsg = null;
    window.StationFX?.emit(id, 'open');
    const d = $('panel-dialog'), fresh = !d.open || !!winFx?.shut;
    if (!d.open) d.show();
    drawWindow(true);
    if (fresh) winOpen(id);
    // Keyboard focus goes to Nib's waiting line if there is one, else the window: never the × button,
    // or Enter would close the window instead of answering Nib.
    const b = $('nib-bubble'), wait = !b.hidden && b.classList.contains('asks') && (!nib.typing && b.querySelector('.nib-next') || b); // #11: Next is hidden while typing
    (wait || $('panel-body')).focus({ preventScroll: true });
  }
  function closeWindow() { const id = ui.win; ui.win = null; ui.miss = null; if ($('panel-dialog').open) winShut(id); render(); $('world').focus({ preventScroll: true }); }
  function drawWindow(top) {
    if (!ui.win) return;
    const body = $('panel-body'), y = body.scrollTop;
    const html = { hunt: deskView, training: nibView, contract: opsView, forge: toolsView, rig: rigView, stats: ledgerView, hq: hqView }[ui.win]();
    if (top) body.innerHTML = html; else morph(body, html); // a new view starts fresh; a redraw of the same view patches it in place
    stampFx(body);
    $('panel-title').textContent = crumbs();
    $('panel-dialog').classList.toggle('roomy', ui.win === 'hunt' && (ui.view === 'hunt' || ui.view === 'map'));
    body.scrollTop = top ? 0 : y;
    winRows(); // a redraw during the open keeps the rows' stagger (#5)
    render();
  }

  // Hit-stop & shake (motion #2). A payment is stamped where it shows: its tag on the bug's map row, on the Ops desk's result,
  // or a chain's CRITICAL tag at HQ. A fresh one slams (its CSS animation), freezes on the impact frame, then its row shakes
  // and ink specks fly. CRITICAL gets it all; a normal payment a lighter one (shorter hold and shake, no flash).
  // drawWindow redraws often, so each stamp keeps its start time: a redraw mid-effect carries on, a later one shows it at rest.
  const stamps = new Map(); // "found:<fid>" | "chain:<tid>" → { due: when paid, t0: when it first showed, out: when the hold lets go, end }
  const stampDue = key => stamps.set(key, { due: document.timeline.currentTime });
  function stampFx(body) {
    const now = document.timeline.currentTime;
    body.querySelectorAll('[data-stamp]').forEach(el => {
      const st = stamps.get(el.dataset.stamp); if (!st || now > st.end) return;
      if (st.t0 == null && now - st.due > 2000) { st.out = st.end = now; return; } // paid a while ago and only seen now: no slam
      const box = el.closest('li, .feedback') || el.parentNode;
      if (st.t0 == null) { st.t0 = now; box.scrollIntoView({ block: 'nearest' }); } // e.g. the Ops result, when you filed from further down
      hitstop(box, el, st, el.classList.contains('crit'));
    });
  }
  const scaleOf = k => +(/scale\(([\d.]+)\)/.exec(k.transform || '') || [0, 1])[1];
  function hitstop(box, stamp, st, big) {
    const now = document.timeline.currentTime, t0 = st.t0, hold = big ? 67 : 33;
    box.classList.add('hitstop'); box.classList.toggle('lite', !big);
    const a = stamp.getAnimations().find(x => x.animationName), d = a && a.effect.getComputedTiming().duration;
    // The impact is the slam's most squashed key (where the tag hits), the peak its largest: read from the keyframes,
    // so a change to the slam moves the hold with it.
    const f = a ? a.effect.getKeyframes().map(({ computedOffset, ...k }) => k) : [], i = f.reduce((m, k, j) => scaleOf(k) < scaleOf(f[m]) ? j : m, 0);
    const rel = a ? f[i].offset * d + hold : 0, peak = Math.max(1, ...f.map(scaleOf));
    st.out = t0 + rel; st.end = t0 + (d || 0) + hold + 400;
    if (reduced || !a || now > st.end) { box.classList.remove('hitstop', 'lite'); a?.cancel(); st.end = st.out = Math.min(st.end, now); return; }
    box.style.setProperty('--imp', rel - hold + 'ms'); box.style.setProperty('--rel', rel + 'ms');
    // At its peak the tag stays inside the window: it grows from the point that keeps it in (inward from an edge) and,
    // if even that can't fit, peaks smaller. Measured at rest: offsets ignore the slam's transform.
    const dlg = $('panel-dialog'), D = dlg.getBoundingClientRect(), B = box.getBoundingClientRect(), w = stamp.offsetWidth, h = stamp.offsetHeight;
    const x0 = B.left + box.clientLeft + stamp.offsetLeft, y0 = B.top + box.clientTop + stamp.offsetTop;
    const L = Math.max(0, D.left + dlg.clientLeft) + 4, R = Math.min(innerWidth, D.left + dlg.clientLeft + dlg.clientWidth) - 4;
    const T = Math.max(0, dlg.querySelector('.bar').getBoundingClientRect().bottom) + 4, Bm = Math.min(innerHeight, D.top + dlg.clientTop + dlg.clientHeight) - 4;
    const S = Math.max(1, Math.min(peak, (R - L) / w, (Bm - T) / h)), k = S - 1;
    const org = (at, size, lo, hi) => k ? Math.max(0, Math.min(size, (at - lo) / k, Math.max((at + size * S - hi) / k, size / 2))) : size / 2;
    stamp.style.transformOrigin = `${org(x0, w, L, R)}px ${org(y0, h, T, Bm)}px`;
    const fit = v => peak > 1 ? 1 + (v - 1) * k / (peak - 1) : v;
    // Specks start on the tag's edge. Fixed angles, so a redraw mid-burst draws the same ones.
    const cx = stamp.offsetLeft + w / 2, cy = stamp.offsetTop + h / 2, n = big ? 8 : 5, r = big ? 30 : 18;
    box.insertAdjacentHTML('beforeend', `<span class="specks" aria-hidden="true" style="color:${getComputedStyle(stamp).color}">${Array.from({ length: n }, (_, j) => {
      const an = (j + .3) / n * 2 * Math.PI, c = Math.cos(an), s = Math.sin(an), dd = r * (j % 2 ? .6 : 1);
      return `<i style="--x0:${Math.round(cx + c * w / 2)}px;--y0:${Math.round(cy + s * h / 2)}px;--dx:${Math.round(c * dd)}px;--dy:${Math.round(s * dd)}px"></i>`;
    }).join('')}</span>`);
    box.lastChild.addEventListener('animationend', e => e.currentTarget.remove(), { once: true }); // spent specks would still stretch the scroll area
    // Shake, flash and specks all count from the landing, so they line up with the slam and resume after a redraw.
    box.getAnimations({ subtree: true }).forEach(x => { if (/^(hit-|speck)/.test(x.animationName)) x.startTime = t0; });
    // The hit-stop itself: the tag's own slam, re-timed with its impact keyframe held (and its scale fitted). A native
    // animation, not a JS loop, so it stays smooth through the main-thread stalls that follow a payment.
    const kf = f.map((x, j) => ({ ...x, ...(x.transform ? { transform: x.transform.replace(/scale\(([\d.]+)\)/, (_, v) => `scale(${fit(+v).toFixed(3)})`) } : {}), offset: (x.offset * d + (j > i ? hold : 0)) / (d + hold) }));
    kf.splice(i + 1, 0, { ...kf[i], offset: rel / (d + hold) }); // same pose again after the hold
    a.cancel(); stamp.animate(kf, d + hold).startTime = t0;
    // Settle: a small overshoot on release, on `scale` so it rides on top of the slam's transform and ends at rest.
    stamp.animate([{ scale: 1 }, { scale: big ? 1.04 : 1.02, offset: .4 }, { scale: 1 }], { duration: 200, delay: rel, easing: 'ease-out' }).startTime = t0;
  }
  // ---------- #13 camera punch-in on big moments ----------
  // The rarest moments only: a CRITICAL paid (yours, an agent's, a chain at HQ) or the chapter's goal reached. The office
  // pushes in 7% toward where it happened, holds, and eases back: 1.5 s, a .985 dip first (anticipation). It starts on the
  // tag's impact, so it and the hit-stop (#2) land as one beat. Only #world-wrap scales: Nib, agents and their bubbles are
  // placed from world.roomRect(), which reads the canvas's on-screen rect, so they follow it frame by frame; windows, HUD,
  // dock, toasts and chips don't move. One at a time: a moment during a punch doesn't start another.
  const PUNCH = [[0, 1], [.2, .985], [.45, 1.07], [.75, 1.07], [1, 1]], PUNCH_MS = 1500, PUNCH_EASE = [.3, .7, .3, 1];
  const bez = (u, a, b) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  function punchScale(t) { // the animation's scale at t ms: same keys and easing as the WAAPI one
    if (!(t > 0 && t < PUNCH_MS)) return 1;
    let lo = 0, hi = 1, u = .5; for (let i = 0; i < 24; i++) { u = (lo + hi) / 2; if (bez(u, PUNCH_EASE[0], PUNCH_EASE[2]) < t / PUNCH_MS) lo = u; else hi = u; }
    const p = bez(u, PUNCH_EASE[1], PUNCH_EASE[3]), j = Math.max(1, PUNCH.findIndex(k => k[0] >= p)), [a, b] = [PUNCH[j - 1], PUNCH[j]];
    return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]);
  }
  // world.js turns its insets (CSS px) into canvas px by the canvas's on-screen width, so a zoomed canvas would refit the
  // room inside it. The insets scale with the zoom instead: punchK is the scale world.js sees on its next draw.
  let punchFx = null, punchK = 1, punchBase = null, lastPay = null;
  function punchIns(v) { punchBase = v; const k = punchK; return k === 1 ? v : { top: v.top * k, bottom: v.bottom * k, left: (v.left || 0) * k, hud: v.hud && { left: v.hud.left * k, bottom: v.hud.bottom * k } }; }
  function punchFor(r, station, who, key) {
    lastPay = { station, who, t: performance.now() };
    if (!r.won && (r.crit || station === 'hq')) punch(station, who, key, true); // HQ only pays chains: always critical. The goal punches in goal().
  }
  // The goal's punch would start behind the window's scrim and be cut by its card, so it plays in the clear office: the
  // window shuts, the office pushes in, and the card comes once the push is holding (~300-500 ms in).
  async function goal(card, station, who) {
    closeWindow();
    for (const t = Date.now(); $('panel-dialog').open && Date.now() - t < 600;) await wait(30); // punch the office, not a closing window
    if (await punch(station, who, null, true)) await wait(420);
    const line = !reduced && $('nib-bubble').querySelector('.nib-text')?.talk; // let Nib finish the line he's typing before the card covers it
    if (line && line.done) await Promise.race([line.done, wait(1500)]);
    card();
  }
  // Resolves true once the punch has started.
  async function punch(station, who, key, big) {
    if (reduced || punchFx || document.hidden || ui.night || $('modal').open || document.body.classList.contains('s3-agents-open')) return false;
    const fx = punchFx = {}, frame = () => new Promise(r => requestAnimationFrame(r));
    // Its tag shows on the window's next draw; the impact is its release less the hold. No tag (window shut): now.
    await frame();
    const st = key && stamps.get(key);
    for (const t = performance.now(); st && st.out == null && performance.now() - t < 1500 && punchFx === fx;) await frame();
    if (punchFx !== fx || $('modal').open || document.body.classList.contains('s3-agents-open')) { if (punchFx === fx) punchFx = null; return false; }
    const now = document.timeline.currentTime, t0 = st && st.out != null ? Math.max(now - 50, st.out - (big ? 67 : 33)) : now;
    // Toward where it happened: the paying agent, else the station (or you); the room's middle if neither is in view.
    const wrap = $('world-wrap'), W = wrap.getBoundingClientRect(), ag = who && document.querySelector(`#s3-layer:not([hidden]) [data-chat="${who}"]`);
    const b = ag?.getBoundingClientRect() || world.anchor(station) || world.roomRect();
    const ox = Math.max(0, Math.min(W.width, b.left + b.width / 2 - W.left)), oy = Math.max(0, Math.min(W.height, b.top + b.height / 2 - W.top));
    wrap.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
    const a = wrap.animate(PUNCH.map(([offset, k]) => ({ offset, transform: `scale(${k})` })), { duration: PUNCH_MS, easing: `cubic-bezier(${PUNCH_EASE})` });
    a.startTime = t0;
    // Each frame, after world.js has drawn, the insets are set for the next frame's scale (rAF runs in registration order).
    let prev = 0;
    const tick = at => { if (punchFx !== fx) return; const next = at + (prev ? Math.min(50, at - prev) : 16.7); prev = at; punchK = punchScale(next - t0); if (punchBase) world.setInsets(punchIns(punchBase)); if (next < t0 + PUNCH_MS) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    fx.end = () => { if (punchFx !== fx) return; punchFx = null; punchK = 1; a.cancel(); wrap.style.transformOrigin = ''; if (punchBase) world.setInsets(punchBase); requestAnimationFrame(placeLamps); };
    a.onfinish = fx.end; return true;
  }
  window.addEventListener('resize', () => punchFx?.end?.()); // a resize mid-punch: world.js would measure the zoomed canvas
  // ---------- #5 windows open from where you clicked ----------
  // Only the open and close transitions move: redraws and breadcrumbs inside an open window never replay them.
  // The dialog opens and takes focus at once, so keys work from the first frame; only what you see catches up.
  // It moves with the separate `translate`/`scale` properties because its centring `transform` is !important.
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const STAGGER = parseFloat(tok('--stagger')) || 50, WIND = tok('--wind') || 'ease-in', SETTLE = tok('--settle') || 'ease-out';
  let winFx = null, winSrc = null, winTap = null, winRide = false; // the running open/close; what it grew from; a press made mid-grow; strip riding
  // What a window grows from and shrinks into: the button you clicked, else the station's dock button; none if hidden.
  function winButton(id, clicked) {
    const ev = clicked && window.event, hit = ev && ev.type === 'click' && ev.target.closest && ev.target.closest('button');
    let el = hit && hit.isConnected && !hit.closest('#panel-dialog,#nib-bubble') ? hit : document.querySelector(`#dock [data-station="${id}"]`);
    const menu = el && el.closest('.dock-menu');
    if (menu && !menu.checkVisibility({ visibilityProperty: true, opacityProperty: true })) el = menu.previousElementSibling; // shut menu: its group's button
    const r = el && el.getBoundingClientRect();
    return r && r.width > 8 && r.height > 8 ? el : null;
  }
  const winFrom = (R, B) => ({ translate: `${B.left + B.width / 2 - R.left - R.width / 2}px ${B.top + B.height / 2 - R.top - R.height / 2}px`, scale: `${B.width / R.width} ${B.height / R.height}` });
  // Scale about the window's resting centre, wherever its centring transform (desktop or phone) puts it.
  function winOrigin(d, R) { const m = new DOMMatrixReadOnly(getComputedStyle(d).transform); return `${50 + m.e / R.width * 100}% ${50 + m.f / R.height * 100}%`; }
  // The window's resting rect, whatever the grow is doing: Nib's strip docks here, and presses mid-grow aim here.
  function winRect() {
    const d = $('panel-dialog'), r = d.getBoundingClientRect(); if (!winFx) return r;
    const cs = getComputedStyle(d), s = cs.scale === 'none' ? [1] : cs.scale.split(' ').map(Number), t = cs.translate === 'none' ? [0] : cs.translate.split(' ').map(parseFloat);
    const w = r.width / s[0], h = r.height / (s[1] ?? s[0]), cx = r.left + r.width / 2 - t[0], cy = r.top + r.height / 2 - (t[1] || 0);
    return new DOMRect(cx - w / 2, cy - h / 2, w, h);
  }
  // Only undoes what the ride set, so other motion on Nib's bubble is left alone.
  const winLoose = () => { if (winRide) Object.assign($('nib-bubble').style, { transformOrigin: '', translate: '', scale: '', opacity: '', filter: '' }); winRide = false; };
  function winStop() { // jump to the end: the window at rest, Nib's strip back on it
    const fx = winFx; if (!fx) return; winFx = null;
    fx.anims.forEach(a => a.cancel()); winLoose();
    const d = $('panel-dialog'); d.style.transformOrigin = ''; d.inert = false;
  }
  function winOpen(id) {
    // Reopened while it shrinks: grow again from where the window and the scrim are now, not from nothing.
    const d = $('panel-dialog'), pf = document.querySelector('.playfield'), back = !!winFx?.shut, cs = getComputedStyle(d);
    const from = back && { translate: cs.translate, scale: cs.scale, opacity: cs.opacity, filter: cs.filter }, dim = back ? +getComputedStyle(pf, '::after').opacity || 0 : 0;
    winStop();
    if (reduced) return;
    const src = winButton(id, true), R = d.getBoundingClientRect(), fx = winFx = { anims: [] }, pre = src && !back ? 60 : 0;
    winSrc = { id, el: src };
    d.style.transformOrigin = winOrigin(d, R);
    // Anticipation: the button presses in, and the window leaves it as it springs back; blurred only while it flies.
    const grow = from ? [from, { translate: '0 0', scale: '1.03', opacity: 1, filter: 'blur(0)', offset: .7 }, { translate: '0 0', scale: '1', opacity: 1, filter: 'blur(0)' }]
      : src ? [{ ...winFrom(R, src.getBoundingClientRect()), opacity: 0, filter: 'blur(1.5px)' }, { opacity: 1, offset: .3 }, { translate: '0 0', scale: '1.03', filter: 'blur(0)', offset: .7 }, { translate: '0 0', scale: '1', filter: 'blur(0)' }]
      : [{ scale: '.9', opacity: 0, easing: WIND }, { scale: '.87', opacity: .8, offset: .3, easing: SETTLE }, { scale: '1.02', offset: .7 }, { scale: '1', opacity: 1 }];
    if (src) fx.anims.push(window.Tactile?.release(src) || src.animate([{ translate: '0 0', scale: '1' }, { translate: '0 3px', scale: '.94', filter: 'brightness(.75)', offset: .55 }, { translate: '0 0', scale: '1' }], { duration: 110, easing: 'ease-out' })); // #14: one you just pressed springs back instead
    const a = d.animate(grow, { duration: src || from ? 260 : 300, delay: pre, easing: src || from ? 'cubic-bezier(.3,.7,.3,1)' : 'linear', fill: 'backwards' });
    fx.anims.push(a, pf.animate({ opacity: [dim, 1] }, { duration: 240 * (1 - dim), delay: pre, easing: 'ease-out', fill: 'backwards', pseudoElement: '::after' }));
    a.onfinish = () => { if (winFx === fx) winStop(); };
    winRowsAt = [document.timeline.currentTime, pre]; winRows();
    winRideOn(fx);
  }
  // Rows follow 3 frames apart, capped so the last is in by ~350 ms. Each redraw during the open (drawWindow) gives its
  // new rows the same stagger, pinned to the open's start, so rows from an agent's redraw carry on instead of jumping in.
  // Each row fades up to its own opacity (dimmed rows stay dimmed).
  let winRowsAt = null;
  function winRows() {
    if (!winRowsAt) return;
    const [t0, pre] = winRowsAt, d = $('panel-dialog');
    if (document.timeline.currentTime - t0 > pre + 3 * STAGGER + 160) { winRowsAt = null; return; }
    const rows = [d.querySelector('.bar'), ...[...$('panel-body').children].flatMap(el => el.matches('ul,ol,.programs') ? [...el.children] : [el])];
    rows.forEach((el, i) => {
      el.getAnimations().forEach(a => { if (a.id === 'win-row') a.cancel(); }); // the bar survives redraws: one stagger at a time
      el.animate([{ opacity: 0, translate: '0 6px' }, { translate: '0 0' }], { id: 'win-row', duration: 140, delay: pre + Math.min(i, 3) * STAGGER, easing: SETTLE, fill: 'backwards' }).startTime = t0;
    });
  }
  // Nib's strip docks to the resting rect and rides the grow and the shrink with the window: same scale and offset, same centre.
  function winRideOn(fx) {
    const d = $('panel-dialog'), ride = () => {
      if (winFx !== fx) return;
      const b = $('nib-bubble');
      if (b.hidden || !b.classList.contains('docked')) winLoose();
      else { const cs = getComputedStyle(d), r = winRect(); Object.assign(b.style, { transformOrigin: `${r.left + r.width / 2 - b.offsetLeft}px ${r.top + r.height / 2 - b.offsetTop}px`, translate: cs.translate, scale: cs.scale, opacity: cs.opacity, filter: cs.filter }); winRide = true; }
      requestAnimationFrame(ride);
    };
    requestAnimationFrame(ride);
  }
  // Close: the window is shut to input at once (clicks fall through, focus leaves) and shrinks back into its button.
  // Nib's strip stays docked and rides the shrink, so his bubble only comes back beside him once the window is gone.
  function winShut(id) {
    const d = $('panel-dialog');
    if (winFx?.shut) return;
    winStop(); winRowsAt = null;
    if (reduced) { d.close(); return; }
    const src = winSrc?.id === id && winSrc.el?.isConnected ? winSrc.el : winButton(id), R = d.getBoundingClientRect(), fx = winFx = { anims: [], shut: true };
    d.inert = true; d.style.transformOrigin = winOrigin(d, R);
    // Anticipation: a small swell in place (~5 frames), then it shrinks into its button, blurred only on the way.
    const a = d.animate([{ translate: '0 0', scale: '1', opacity: 1, filter: 'blur(0)', easing: 'ease-out' }, { translate: '0 0', scale: '1.02', opacity: 1, filter: 'blur(0)', offset: .35, easing: WIND },
      { ...(src ? winFrom(R, src.getBoundingClientRect()) : { translate: '0 0', scale: '.9' }), opacity: 0, filter: 'blur(1.5px)' }], { duration: 240, fill: 'forwards' });
    fx.anims.push(a, document.querySelector('.playfield').animate({ opacity: [1, 0] }, { duration: 240, fill: 'forwards', pseudoElement: '::after' }));
    a.onfinish = () => { if (winFx === fx) { winStop(); d.close(); } };
    winRideOn(fx);
  }
  // A press made during the grow is meant for where the window is landing: snap it there and click what's under it.
  addEventListener('pointerdown', e => {
    winTap = null;
    if (!winFx || winFx.shut || e.button) return;
    const b = $('nib-bubble'), x = e.clientX, y = e.clientY, inside = r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const aim = inside(winRect()) || (!b.hidden && b.classList.contains('docked') && inside({ left: b.offsetLeft, top: b.offsetTop, right: b.offsetLeft + b.offsetWidth, bottom: b.offsetTop + b.offsetHeight }));
    winStop();
    if (aim) { e.stopPropagation(); e.preventDefault(); winTap = { x, y, t: e.timeStamp }; }
  }, true);
  addEventListener('click', e => {
    const tap = winTap; if (!tap) return; winTap = null;
    if (e.timeStamp - tap.t > 1000) return;
    e.stopPropagation(); e.preventDefault();
    const el = document.elementFromPoint(tap.x, tap.y); if (el && el.closest('#panel-dialog,#nib-bubble')) el.click();
  }, true);

  // The window's one title line: where you are, e.g. "Desk › ChatterBox › Groups › Hunt".
  function crumbs() {
    const c = [ST[ui.win].name];
    if (ui.win === 'hunt') {
      if (ui.view === 'board' || !s.target) c.push('Bounty board');
      else {
        const f = ui.fid && F[ui.fid], t = f ? T[f.target] : T[s.target];
        c.push(t.name);
        if (ui.view === 'hunt' && f) c.push(t.rooms.find(r => r[0] === f.room)[1], 'Hunt');
        else if (ui.room) { const r = t.rooms.find(x => x[0] === ui.room); if (r) c.push(r[1]); }
      }
    } else c.push({ training: 'Pattern book', contract: 'Nib\'s finds', forge: 'Shop', rig: 'GPU rig', stats: s.rep + ' rep · ' + E.tier(s).name, hq: 'Criticals' }[ui.win]);
    return c.join('  ›  ');
  }

  // Desk: board → map → hunt → report.
  function deskView() {
    if (ui.view === 'hunt' && ui.fid && (E.slotState(s, ui.fid) === 'open' || ui.hit != null)) return huntView();
    if (ui.view === 'board' || !s.target) return boardView();
    return mapView();
  }
  function stars(n) { return '<span class="stars">' + '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i></span>'; }
  function boardView() {
    const cards = (stage3() ? D.ALL_TARGETS : D.TARGETS).map(t => {
      const lock = E.canTake(s, t.id), cur = s.target === t.id;
      const all = t.rooms.flatMap(r => r[5]), tools = all.filter(k => C[k].tool && !E.unlocked(s, k)).length;
      const done = Object.keys(s.found).filter(fid => F[fid].target === t.id && s.found[fid].status === 'accepted').length;
      return `<article class="program ${cur ? 'current' : ''} ${lock.ok ? '' : 'locked'}">
        <header><h3>${esc(t.name)}</h3>${stars(t.stars)}</header>
        <p class="kind">${esc(t.kind)}${t.private ? ' · invite only' : ''}</p>
        <dl class="mini"><div><dt>Bounty</dt><dd>${money(t.base * E.crowd(s, t.id))}</dd></div><div><dt>Crowded</dt><dd><span class="crowd"><i style="width:${pct(s.picked[t.id])}"></i></span> ${pct(s.picked[t.id])}</dd></div><div><dt>Bugs</dt><dd>${done}/${all.length}${tools ? ` · ${tools} need tools` : ''}</dd></div></dl>
        ${cur ? `<button data-act="to-map" class="accent wide">Continue</button>` : lock.ok ? `<button data-act="take" data-id="${t.id}" class="wide">Take job</button>` : `<p class="lock">🔒 ${esc(lock.why)}</p>`}
      </article>`;
    }).join('');
    return `<div class="programs">${cards}</div>`;
  }
  // A paid bug's tag. A fresh payment stamps it wherever it shows (stampFx).
  const paidTag = fid => { const r = s.found[fid]; return `<span class="tag good${r.crit ? ' crit' : ''}" data-stamp="found:${fid}">${r.crit ? 'CRITICAL · ' : ''}${r.grade} · ${money(r.pay)}</span>`; };
  function mapView() {
    const t = T[s.target], tid = t.id;
    if (!ui.room || !E.isLit(s, tid, ui.room)) ui.room = s.lit[tid][s.lit[tid].length - 1];
    const lines = t.links.map(([a, b]) => {
      const A = t.rooms.find(r => r[0] === a), B = t.rooms.find(r => r[0] === b), lit = E.isLit(s, tid, a) && E.isLit(s, tid, b);
      return `<line x1="${A[2]}" y1="${A[3]}" x2="${B[2]}" y2="${B[3]}" class="${lit ? 'lit' : ''}"/>`;
    }).join('');
    const nodes = t.rooms.map(r => {
      const rid = r[0], lit = E.isLit(s, tid, rid), mappable = E.canMap(s, tid, rid), sel = ui.room === rid;
      if (!lit) return `<button class="room dark ${mappable ? 'mappable' : ''} ${oosRoom(tid, rid) ? 's3-oos' : ''}" style="left:${r[2]}%;top:${r[3]}%" ${mappable ? `data-act="map" data-id="${rid}"` : 'disabled'} aria-label="${mappable ? 'Map this room, ' + D.COST.map + ' focus' : 'Out of reach'}"><b>?</b><small>${mappable ? 'Map · ' + D.COST.map : ''}</small></button>`;
      const pips = E.roomFindings(tid, rid).map(fid => `<i class="dot ${E.slotState(s, fid)}"></i>`).join('');
      const oos = oosRoom(tid, rid);
      return `<button class="room ${sel ? 'sel' : ''} ${oos ? 's3-oos' : ''}" style="left:${r[2]}%;top:${r[3]}%" data-act="room" data-id="${rid}"><b>${esc(r[1])}</b><span class="pips">${pips}</span>${oos ? '<span class="s3-oos-tag">OUT OF SCOPE</span>' : ''}</button>`;
    }).join('');
    const room = t.rooms.find(r => r[0] === ui.room);
    const rows = E.roomFindings(tid, ui.room).map(fid => {
      const f = F[fid], st = E.slotState(s, fid), cls = C[f.cls], found = s.found[fid];
      const right = st === 'open' ? `<button data-act="hunt" data-id="${fid}" class="accent">Hunt</button>`
        : st === 'locked' ? `<span class="tag">needs ${esc(D.TOOLS.find(x => x.id === cls.tool).name)}</span>`
        : st === 'tray' ? `<button data-act="go" data-id="contract">On Ops desk</button>`
        : st === 'draft' ? (leftoverDrafts().includes(fid) ? `<button data-act="file" data-id="${fid}">File</button>` : '<span class="tag">being filed</span>')
        : paidTag(fid);
      return `<li class="slot ${st}"><span class="dot ${st}"></span><div><b>${st === 'open' || st === 'locked' ? 'Something off' : esc(cls.name)}</b><small>${st === 'open' ? 'about ' + money(t.base * cls.mult * E.crowd(s, tid)) : st === 'locked' ? esc(cls.name) : st === 'tray' ? 'Nib thinks it\'s ' + esc(cls.name.toLowerCase()) : found && found.source === 'nib' ? 'found by Nib' : found && found.source === 'agent' ? 'found by ' + esc(found.by) : 'found by you'}</small></div>${right}</li>`;
    }).join('');
    const ch = E.chainState(s, tid), chainNote = [ch.a, ch.b].some(fid => F[fid].room === ui.room) ? `<p class="hint-line">↔ Links to a bug next door. See HQ.</p>` : '';
    return `<div class="target-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${nodes}</div>
      <div class="map-foot"><p class="legend"><span><i class="dot open"></i>hunt</span><span><i class="dot locked"></i>tool</span><span><i class="dot tray"></i>Nib</span><span><i class="dot draft"></i>report</span><span><i class="dot accepted"></i>paid</span></p><button data-act="board" class="quiet small">Change job</button></div>
      <ul class="slots">${rows}</ul>${chainNote}`;
  }
  // Stage 3: programs publish rooms that are off limits.
  const oosRoom = (tid, rid) => stage3() && window.Stage3Scope && !window.Stage3Scope.inScope(tid, rid);
  function huntView() {
    const f = F[ui.fid], cls = C[f.cls], lines = cls.variants[f.variant], t = T[f.target];
    const room = t.rooms.find(r => r[0] === f.room);
    const code = lines.map((l, i) => {
      const state = ui.hit === i ? 'hit' : ui.miss && ui.miss.lines.includes(i) ? 'miss' : '';
      return `<button class="code-line ${state}" data-act="line" data-id="${i}" ${ui.hit != null ? 'disabled' : ''}><span class="ln">${String(i + 1).padStart(2, '0')}</span><code>${esc(D.fill(l.t, f.nouns))}</code></button>`;
    }).join('');
    const fb = ui.hit != null ? `<div class="feedback hit"><b>Found it.</b> ${esc(D.fill(lines[ui.hit].bad, f.nouns))}</div>`
      : ui.miss ? `<div class="feedback miss"><b>Line ${ui.miss.last + 1} is fine.</b> ${esc(ui.miss.why)} <span class="cost">−${D.COST.miss} focus</span></div>` : '';
    return `<div class="win-head"><h2>Which line is the bug?</h2><button data-act="to-map" class="quiet small">← Map</button></div>
      <div class="code" role="group" aria-label="Code sketch. Choose the flawed line.">${code}</div>
      ${fb || `<p class="hint-line">${esc(cls.hint)}</p>`}
      <p class="fine">Miss −${D.COST.miss} · find −${D.COST.find} · focus ${s.focus}</p>`;
  }
  function shuffledOptions(fid, sec) { // stable per finding+section so the order doesn't jump while you choose
    let h = 0; for (const ch of fid + sec) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const order = [0, 1, 2]; for (let i = 2; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  }


  function nibView() {
    const rows = Object.keys(C).map(k => {
      const c = C[k], p = E.precision(s, k), l = s.lessons[k], tool = c.tool && !E.unlocked(s, k) ? D.TOOLS.find(x => x.id === c.tool).name : '';
      const status = !p ? 'Not taught yet' : tool ? 'Needs the ' + tool : 'Hunts at night';
      return `<li class="pattern ${p ? '' : 'dim'}"><div class="p-name"><b>${esc(c.name)}</b><small>${status}</small></div><div class="p-bar"><span class="meter"><i style="width:${pct(p)}"></i></span><strong>${p ? pct(p) : '—'}</strong></div><small class="p-lessons">${l.clean} clean · ${l.noisy} noisy</small></li>`;
    }).join('');
    const mem = s.memories.length ? `<p class="fine">Nib remembers: ${s.memories.map(esc).join('; ')}.</p>` : '';
    return `
      <ul class="patterns">${rows}</ul>
      <p class="fine">Precision = how often Nib's night finds are real. Only your lessons change it.</p>${mem}`;
  }
  function opsView() {
    const cands = s.tray.map(c => {
      const f = F[c.fid], t = T[f.target], room = t.rooms.find(r => r[0] === f.room)[1];
      return `<li class="cand"><div><b>${esc(C[f.cls].name)}</b><small>${esc(t.name)} · ${esc(room)}</small><span class="conf"><span class="meter"><i style="width:${c.conf}%"></i></span>${c.conf}% sure</span></div>
        <div class="cand-acts"><button data-act="prove" data-id="${c.id}" class="accent" ${s.focus < D.COST.prove ? 'disabled' : ''}>Prove <small>−${D.COST.prove}</small></button><button data-act="raw" data-id="${c.id}">As-is</button><button data-act="toss" data-id="${c.id}" class="quiet">Toss</button></div></li>`;
    }).join('');
    const drafts = leftoverDrafts().map(fid => `<li class="cand"><div><b>${esc(C[F[fid].cls].name)}</b><small>${esc(T[F[fid].target].name)}</small></div><button data-act="file" data-id="${fid}" class="accent">File</button></li>`).join('');
    const res = ui.result && ui.result.ops ? `<div class="feedback ${ui.result.good ? 'hit' : 'miss'}">${ui.result.html}</div>` : '';
    return `${res}${cands ? `<p class="fine">Prove: safe, +25% pay. As-is: free, −3 rep if it's wrong.</p><ul class="cands">${cands}</ul>` : '<p class="empty">Nothing yet. Nib works while you sleep.</p>'}
      ${drafts ? `<h3>To file</h3><ul class="cands">${drafts}</ul>` : ''}`;
  }
  function toolsView() {
    const tools = D.TOOLS.filter(t => t.cost).map(t => {
      const own = E.has(s, t.id), need = t.need && !E.has(s, t.need);
      return `<li class="shop ${own ? 'owned' : ''}"><div><b>${esc(t.name)}</b><small>${esc(t.opens)}</small></div>${own ? '<span class="tag good">Owned</span>' : need ? `<span class="tag">needs ${esc(D.TOOLS.find(x => x.id === t.need).name)}</span>` : `<button data-act="tool" data-id="${t.id}" ${s.cash < t.cost ? 'disabled' : ''}>${money(t.cost)}</button>`}</li>`;
    }).join('');
    const desk = D.DESK.map(d => { const own = s.desk.includes(d.id); return `<li class="shop ${own ? 'owned' : ''}"><div><b>${esc(d.name)}</b><small>${esc(d.does)}</small></div><button data-act="desk" data-id="${d.id}" ${!own && s.cash < d.cost ? 'disabled' : ''}>${own ? 'Return · +' + money(d.cost) : money(d.cost)}</button></li>`; }).join('');
    return `<h3>Tools</h3><ul class="shoplist">${tools}</ul><h3>Desk</h3><ul class="shoplist">${desk}</ul>`;
  }
  function rigView() {
    const known = Object.keys(C).filter(k => E.knows(s, k) && E.unlocked(s, k));
    const avg = known.length ? known.reduce((a, k) => a + E.precision(s, k), 0) / known.length : 0;
    const tiers = D.RIGS.map((r, i) => `<li class="shop ${i === s.gpu ? 'owned' : ''}"><div><b>${esc(r.name)}</b><small>${r.tries} ${r.tries === 1 ? 'try' : 'tries'} a night</small></div>${i === s.gpu ? '<span class="tag good">Running</span>' : `<button data-act="rig" data-id="${i}" ${r.cost - D.RIGS[s.gpu].cost > s.cash ? 'disabled' : ''}>${i < s.gpu ? 'Return · +' + money(D.RIGS[s.gpu].cost - r.cost) : money(r.cost - D.RIGS[s.gpu].cost)}</button>`}</li>`).join('');
    const tries = D.RIGS[s.gpu].tries;
    return `<div class="estimate"><div><span>Tries a night</span><b>${tries}</b></div><div><span>Precision</span><b>${known.length ? pct(avg) : '—'}</b></div><div><span>Real finds</span><b>≈ ${(tries * avg).toFixed(1)}</b></div></div>
      ${!known.length ? '<p class="hint-line">Teach Nib first: tries are wasted until then.</p>' : avg < 0.5 ? '<p class="hint-line">Weak patterns: more tries, more false alarms.</p>' : ''}
      <ul class="shoplist">${tiers}</ul>`;
  }
  // ---------- camera ----------
  // By default the view is zoomed in and follows you, holding you at the centre. The button at the bottom right (or Z)
  // zooms out to the whole office; the choice is remembered on this address.
  const VIEW = 'first-office-view-v1';
  let follow = true; try { follow = localStorage.getItem(VIEW) !== 'fit'; } catch {}
  function setFollow(on, quiet) {
    follow = on; world.setCamera({ follow: on });
    if (!quiet) try { localStorage.setItem(VIEW, on ? 'follow' : 'fit'); } catch {}
    const b = $('view-toggle'); b.setAttribute('aria-pressed', on); b.classList.toggle('out', !on);
    b.querySelector('span').textContent = on ? 'Whole office' : 'Follow me';
    b.setAttribute('aria-label', on ? 'Zoom out to the whole office' : 'Zoom in and follow you');
  }
  $('view-toggle').addEventListener('click', () => { setFollow(!follow); $('world').focus({ preventScroll: true }); });
  setFollow(follow, true);
  // The lamp pools sit on the room's on-screen rect; while the camera moves they follow every frame. The camera only
  // moves while world.js animates (and keeps the loop awake), so this never asks for frames itself, and it skips
  // placeLamps when the room hasn't moved since the last frame.
  let camKey = '';
  window.Loop.add(function camTick() {
    const c = world.camera(); if (!c.follow && !c.moving) { camKey = ''; return false; }
    const r = world.roomRect(), k = `${world.getState().room},${r.left},${r.top},${r.width},${r.height},${punchK}`;
    if (k !== camKey) { camKey = k; placeLamps(); }
    return false;
  });

  // ---------- vitals box ----------
  // A slim list under the chapter title: bugs today, crits, cash and focus. A click (or V) opens today's and lifetime
  // totals and per-day charts. "Today" is the current game day, measured against the snapshot engine.sleep() saves.
  // The room keeps a margin clear for the box (layout → vitalsGutter); on screens too narrow for that it overlaps.
  const VIT = { w: 168, left: 18, gap: 14, openW: 340 };
  const vitalsGutter = () => s.seen.job && innerWidth >= 900 ? VIT.left + VIT.w + VIT.gap : 0;
  function dayRows() {
    const rows = (s.days || []).slice();
    rows.push({ day: s.day, bugs: s.bugs, crits: s.crits, cash: s.cash, rep: s.rep, earned: s.stats.earned });
    // A save from before snapshots existed has no baseline for its early days; the charts start where the data starts.
    return rows.map((r, i) => { const p = i ? rows[i - 1] : r.day === 1 ? { bugs: 0, crits: 0, earned: 0 } : null; return { ...r, newBugs: p ? r.bugs - p.bugs : null, newCrits: p ? r.crits - p.crits : null, made: p ? r.earned - p.earned : null }; });
  }
  // Numbers count to their new value (450 ms, ease-out) and glow briefly when they go up.
  function countTo(el, v, fmt) {
    if (v == null) { el.textContent = '—'; el._v = null; return; }
    const from = el._v; el._v = v;
    if (from == null || from === v || reduced || document.hidden) { el.textContent = fmt(v); return; }
    if (v > from) { el.classList.remove('up'); void el.offsetWidth; el.classList.add('up'); }
    const t0 = performance.now(), step = now => {
      if (el._v !== v) return; // retargeted
      const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (v - from) * e)); if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function bars(rows, key, label) {
    const pts = rows.filter(r => r[key] != null).slice(-14), max = Math.max(1, ...pts.map(r => r[key])), W = 300, H = 74, n = Math.max(pts.length, 7), bw = W / n;
    const b = pts.map((r, i) => { const h = Math.max(r[key] ? 3 : 1.5, r[key] / max * (H - 18)); return `<g style="--i:${i}"><rect x="${i * bw + 3}" y="${H - 13 - h}" width="${bw - 6}" height="${h}" rx="2" class="${r.day === s.day ? 'now' : ''}"><title>Day ${r.day}: ${r[key]}</title></rect><text x="${i * bw + bw / 2}" y="${H - 1}">${r.day}</text></g>`; }).join('');
    return `<figure class="vchart"><figcaption>${label}<span>best ${max}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${b}</svg></figure>`;
  }
  function line(rows, key, label, fmt) {
    const pts = rows.slice(-14), vals = pts.map(r => r[key]), max = Math.max(1, ...vals), W = 300, H = 74;
    const x = i => pts.length > 1 ? 6 + i * (W - 12) / (pts.length - 1) : W / 2, y = v => H - 15 - v / max * (H - 24);
    const xy = pts.map((r, i) => [x(i).toFixed(1), y(r[key]).toFixed(1)]), d = xy.map((p, i) => (i ? 'L' : 'M') + p.join(' ')).join(' ');
    const area = xy.length > 1 ? `<path class="area" d="${d} L${xy[xy.length - 1][0]} ${H - 13} L${xy[0][0]} ${H - 13} Z"/>` : '';
    const dots = pts.map((r, i) => `<circle cx="${xy[i][0]}" cy="${xy[i][1]}" r="${r.day === s.day ? 3.2 : 2}" class="${r.day === s.day ? 'now' : ''}" style="--i:${i}"><title>Day ${r.day}: ${fmt(r[key])}</title></circle><text x="${xy[i][0]}" y="${H - 1}">${r.day}</text>`).join('');
    return `<figure class="vchart"><figcaption>${label}<span>${fmt(vals[vals.length - 1])}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${area}<path class="ln" pathLength="1" d="${d}"/>${dots}</svg></figure>`;
  }
  function vitals() {
    const el = $('vitals'), wasHidden = el.hidden; el.hidden = !s.seen.job; if (el.hidden) return;
    if (wasHidden) layout(); // the room makes way for the box the first time it shows
    if (!el.firstChild) {
      el.innerHTML = `<header><span>Vitals</span><span class="vday"></span><i class="chev" aria-hidden="true"></i></header>
        <dl class="vq"><div><dt>Bugs today</dt><dd data-k="today" class="big"></dd></div><div><dt>Crits</dt><dd data-k="crits"></dd></div>
          <div><dt>Cash</dt><dd data-k="cash" class="cash"></dd></div><div class="vfocus"><dt>Focus</dt><dd><b data-k="focus"></b><small data-k="fmax"></small></dd><span class="vbar"><i></i></span></div></dl>
        <div class="vx"><div class="vx-in"></div></div>`;
    }
    const rows = dayRows(), t = rows[rows.length - 1], open = el.classList.contains('open'), mf = E.maxFocus(s), q = k => el.querySelector(`[data-k="${k}"]`);
    el.setAttribute('aria-expanded', open);
    el.querySelector('.vday').textContent = 'Day ' + s.day;
    countTo(q('today'), t.newBugs, String); countTo(q('crits'), s.crits, String); countTo(q('cash'), s.cash, money); countTo(q('focus'), s.focus, String);
    q('fmax').textContent = '/' + mf; q('crits').classList.toggle('crit', s.crits > 0);
    el.querySelector('.vfocus').classList.toggle('low', s.focus < mf * 0.25); el.querySelector('.vbar i').style.width = Math.round(s.focus / mf * 100) + '%';
    fitVitals();
    // The detail pane is rebuilt only when its numbers change, so its entrance animations don't replay on every render().
    const st = s.stats, tier = E.tier(s), key = open && JSON.stringify([rows, st, s.cups, s.nib]);
    const inner = el.querySelector('.vx-in'); if (!open || inner.dataset.key === key) return; inner.dataset.key = key;
    const row = (k, v, cls) => `<div><dt>${k}</dt><dd class="${cls || ''}">${v}</dd></div>`;
    inner.innerHTML = `<section style="--i:0"><h4>Today</h4><dl>${row('Earned', t.made == null ? '—' : money(t.made), 'cash')}${row('Crits', t.newCrits ?? '—')}${row('Coffee left', s.cups)}${row('Reputation', s.rep + ' <small>' + esc(tier.name) + '</small>')}</dl></section>
      <section style="--i:1"><h4>Lifetime</h4><dl>${row('Bugs', s.bugs)}${row('Crits', s.crits, s.crits ? 'crit' : '')}${row('Earned', money(st.earned), 'cash')}${row('Days', s.day)}
        ${row('By you', st.manual)}${row('By ' + esc(s.nib), st.nib)}${row('By team', st.agent || 0)}${row('False alarms', st.falseSubmits, st.falseSubmits ? 'bad' : '')}</dl>
        ${st.proven + st.raw ? `<p class="vnote">${st.proven} proven before sending · ${st.raw} sent raw</p>` : ''}</section>
      <section style="--i:2">${bars(rows, 'newBugs', 'Bugs per day')}</section><section style="--i:3">${line(rows, 'cash', 'Cash, end of day', money)}</section><section style="--i:4">${line(rows, 'rep', 'Reputation', String)}</section>`;
  }
  // Closed, the box sits in the margin the room keeps for it. Open, it widens into the margin if that's wide enough,
  // otherwise it floats over the room's edge until closed.
  function fitVitals() {
    const el = $('vitals'); if (el.hidden) return;
    const avail = world.roomRect().left - document.querySelector('.playfield').getBoundingClientRect().left - VIT.left - VIT.gap;
    const open = el.classList.contains('open'), w = open ? Math.max(VIT.openW, Math.min(400, Math.floor(avail))) : VIT.w;
    el.classList.toggle('over', w > avail); el.style.setProperty('--vw', w + 'px');
  }
  function toggleVitals(force) {
    const el = $('vitals'); if (el.hidden) return;
    el.classList.toggle('open', force ?? !el.classList.contains('open')); vitals();
  }
  $('vitals').addEventListener('click', e => { if (!$('vitals').classList.contains('open') || e.target.closest('header')) toggleVitals(); });
  $('vitals').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVitals(); } else if (e.key === 'Escape') { toggleVitals(false); $('world').focus({ preventScroll: true }); } });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#vitals') && $('vitals').classList.contains('open')) toggleVitals(false); });

  function ledgerView() {
    const tier = E.tier(s), next = E.nextTier(s);
    const ladder = D.REP_TIERS.map(t => `<li class="${t === tier ? 'on' : s.rep >= t.min ? 'past' : ''}"><b>${t.name}</b><span>${t.min}+</span><small>${esc(t.perk)}</small></li>`).join('');
    const log = s.log.slice(0, 12).map(l => `<li class="${l.kind}"><span>Day ${l.day}</span>${esc(l.text)}</li>`).join('');
    return `${next ? `<p class="fine">${next.min - s.rep} more to ${next.name}</p>` : ''}
      <ol class="ladder">${ladder}</ol><h3>Recent</h3><ul class="log">${log || '<li>Nothing yet.</li>'}</ul>`;
  }
  function hqView() {
    const taken = D.ALL_TARGETS.filter(t => s.lit[t.id]);
    const chains = taken.map(t => {
      const c = E.chainState(s, t.id), ra = t.rooms.find(r => r[0] === F[c.a].room)[1], rb = t.rooms.find(r => r[0] === F[c.b].room)[1];
      const half = (ok, fid, room) => `<span class="half ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${esc(C[F[fid].cls].name)} in ${esc(room)}</span>`;
      const tr = ui.traceMsg && ui.traceMsg.tid === t.id ? ui.traceMsg : null;
      let act = '';
      if (c.done) act = `<span class="tag good crit" data-stamp="chain:${t.id}">CRITICAL · chained</span>`;
      else if (c.ready) act = `<p class="fine">Why is this critical?</p><div class="opts">${shuffledOptions(t.id, 'chain').map(i => `<button class="opt" data-act="trace" data-tid="${t.id}" data-id="${i}">${esc(t.chain.options[i])}</button>`).join('')}</div>${tr ? `<div class="feedback miss">${esc(tr.text)}</div>` : ''}`;
      else act = `<p class="fine">${!E.has(s, 'trace') ? 'Needs the Tracer' : 'Needs both bugs'}</p>`;
      return `<li class="chain ${c.done ? 'done' : c.ready ? 'ready' : ''}" data-tid="${t.id}"><b>${esc(t.name)}: ${esc(t.chain.name)}</b><div class="halves">${half(c.haveA, c.a, ra)}<span class="link">↔</span>${half(c.haveB, c.b, rb)}</div>${act}</li>`;
    }).join('');
    const rolls = Object.values(s.found).filter(f => f.status === 'accepted').length;
    return `<p class="hq-goal">${s.bugs}/20 bugs · ${Math.min(1, s.crits)}/1 critical</p>
      <div class="goalbar"><i style="width:${Math.min(100, s.bugs / 20 * 100)}%"></i></div>
      <p class="fine">Each bug: 5% crit chance (${rolls} rolled). Or chain two linked bugs with the Tracer.</p>
      <ul class="chains">${chains || '<li class="fine">Take a job to see its chain.</li>'}</ul>`;
  }

  // ---------- actions ----------
  const panel = $('panel-body');
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled || ui.busy) return;
    const id = b.dataset.id, act = b.dataset.act;
    ({
      take: () => takeJob(id), board: () => { ui.view = 'board'; drawWindow(true); }, 'to-map': () => { ui.view = 'map'; ui.fid = null; ui.hit = null; ui.miss = null; drawWindow(true); },
      map: () => { const r = E.mapRoom(s, id); if (!r.ok) return toast(r.why, 'bad'); ui.room = id; noteFocus(); drawWindow(); },
      room: () => { ui.room = id; drawWindow(); },
      hunt: () => { ui.view = 'hunt'; ui.fid = id; ui.hit = null; ui.miss = null; drawWindow(true); },
      line: () => guessLine(+id),
      file: () => fileReport(id),
      go: () => openStation(id),
      prove: () => prove(+id), raw: () => raw(+id), toss: () => { E.toss(s, +id); ui.result = null; drawWindow(); },
      tool: () => buyTool(id),
      desk: () => { const r = E.toggleDesk(s, id); if (!r.ok) return toast(r.why, 'bad'); toast(r.sold ? 'Returned. Money back.' : 'Installed. Sleep to use it.'); drawWindow(); },
      rig: () => { const r = E.setRig(s, +id); if (!r.ok) return toast(r.why || 'No change.', 'bad'); toast(r.refund ? 'Returned for ' + money(r.refund) + '.' : 'Rig upgraded: ' + D.RIGS[s.gpu].tries + ' tries a night.'); floatAt(D.RIGS[s.gpu].tries + ' tries', 'rig'); drawWindow(); },
      trace: () => traceChain(b.dataset.tid, +id)
    }[act] || (() => {}))();
  });

  function takeJob(tid) {
    const first = !s.target, r = E.takeJob(s, tid); if (!r.ok) return toast(r.why, 'bad');
    ui.view = 'map'; ui.room = null; drawWindow(true);
    if (first) nibSay('Good pick. Lit rooms show their bugs. Click a room, then hunt. Focus is your energy for the day.', { ms: 5200 });
    else nibSay(T[tid].name + '. New rooms to explore.', { ms: 2400 });
  }
  function noteFocus() { if (!s.seen.rest && s.focus <= 70) { s.seen.rest = true; nibSay('Focus runs out. Coffee buys a little more; sleep resets it, and I work while you\'re out.', { ms: 5200 }); } }

  async function guessLine(i) {
    if (ui.hit != null || (ui.miss && ui.miss.lines.includes(i))) return; // a line already marked fine costs nothing twice
    const r = E.guess(s, ui.fid, i);
    if (!r.ok) { toast(r.why, 'bad'); return; }
    if (!r.hit) { const m = ui.miss || { lines: [] }; m.lines.push(i); m.last = i; m.why = r.why; ui.miss = m; noteFocus(); drawWindow(); if (m.lines.length === 2) nibSay(C[F[ui.fid].cls].hint, { ms: 4200 }); return; }
    ui.hit = i; ui.miss = null; noteFocus(); s.seen.rest = s.seen.rest || s.stats.manual >= 1; drawWindow();
    if (r.mastered) { nibSay('I know this one cold. Filed it.', { mood: 'happy', ms: 2600 }); paid(r.paid, 'hunt', ui.fid); await wait(900); ui.view = 'map'; ui.hit = null; ui.fid = null; drawWindow(true); return; }
    await teachMoment(ui.fid, r.first);
  }
  async function teachMoment(fid, first, resumed) { // resumed: the found line's index, when picking up after a reload
    ui.busy = true;
    if (first) { save(); render(); }
    await Promise.race([nibToPlayer(), wait(2500)]);
    const cls = C[F[fid].cls], f = F[fid];
    const choices = shuffledOptions(fid, 'teach').map(i => ['sharp', 'shallow', 'wrong'][i]).map(v => ({ value: v, label: D.fill(cls.teach[v], f.nouns) }));
    let ask = resumed != null ? 'Before the break you found this one: line ' + (resumed + 1) + ' in ' + T[f.target].rooms.find(r => r[0] === f.room)[1] + '. Why is it a bug?'
      : first ? 'You saw that. I didn\'t. Why is it a bug? Teach me and I\'ll look for it myself.' : 'Why is that one a bug?';
    for (;;) {
      const v = await nibSay(ask, { choices, mood: 'talk' });
      const r = E.teach(s, v);
      if (!r.learned) { ask = 'Hm. I don\'t think that\'s it. Look again?'; nib.setMood('sad'); continue; }
      ui.busy = false;
      if (r.clean) nibSay(r.firstOfClass ? 'That makes sense. I\'ll hunt ' + cls.name.toLowerCase() + 's at night now. ' + pct(r.after) + ' sure of myself.' : 'Sharper. ' + pct(r.before) + ' → ' + pct(r.after) + ' on ' + cls.name.toLowerCase() + 's.', { mood: 'happy', ms: 3800 });
      else nibSay('OK, I\'ll remember that. ' + (r.after < r.before ? 'Though I feel less sure: ' + pct(r.before) + ' → ' + pct(r.after) + '.' : 'Feels thin, but it\'s a start: ' + pct(r.after) + '.'), { mood: 'think', ms: 4200 });
      if (first) { world.pulseAt('training'); toast('New: Nib has a desk and a pattern book.', 'good'); }
      paid(r.paid, 'hunt', fid); // your explanation is the report: it's filed and paid now
      break;
    }
    nibWalk(nibHome());
    ui.view = 'map'; ui.room = f.room; ui.hit = null; ui.fid = null; if (ui.win !== 'hunt') openStation('hunt'); drawWindow(true); // its row shows the payment
  }
  function fileReport(fid) {
    const r = E.fileDraft(s, fid);
    if (!r.ok) return toast(r.why, 'bad');
    if (ui.win === 'contract') ui.result = { ops: true, good: true, html: `<b>Filed.</b> ${esc(C[F[fid].cls].name)} ${paidTag(fid)}` };
    paid(r, ui.win === 'contract' ? 'contract' : 'hunt', fid);
    drawWindow();
  }
  function paid(r, station, fid) {
    const key = 'found:' + fid; stampDue(key); // its tag is stamped where it shows (#2), and its chip leaves from there (#4)
    if (!payChip(r, station, null, key)) floatAt('+' + money(r.pay), station);
    if (r.crit) { toast('CRITICAL! That one was much worse than it looked.', 'crit'); nibSay('Wait. That one\'s critical. ' + s.player + ', that\'s the one we needed.', { mood: 'happy', ms: 4200 }); }
    else toast(r.grade + ' · +' + money(r.pay) + ' · +' + r.rep + ' rep', 'good');
    if (r.tierUp) toast('Reputation: ' + r.tierUp.name + '. ' + r.tierUp.perk, 'good');
    if (r.firsts && r.firsts.forge) { world.pulseAt('forge'); world.pulseAt('stats'); nibSay('Our first bounty. There\'s a tool shelf now: tools open new kinds of bugs. The ledger tracks our reputation.', { ms: 5600, mood: 'happy' }); }
    if (r.firsts && r.firsts.hq) { world.pulseAt('hq'); nibSay('About one bug in twenty turns out critical. Or we make one: two bugs in connected rooms. HQ has the board.', { ms: 5600 }); }
    if (r.won) setTimeout(() => goal(ending, station), 1600);
    nib.hop(); // squash & stretch: Nib hops for joy when a report is paid
  }
  function prove(id) {
    const c = s.tray.find(x => x.id === id), r = E.prove(s, id); if (!r.ok) return toast(r.why, 'bad');
    if (r.real) { ui.result = { ops: true, good: true, html: `<b>Real.</b> ${esc(C[F[c.fid].cls].name)} ${paidTag(r.fid)}` }; nibSay('Told you. Mostly.', { mood: 'happy', ms: 2000 }); paid(r.paid, 'contract', r.fid); }
    else { ui.result = { ops: true, good: false, html: '<b>False alarm.</b> The proof didn\'t hold up. No harm done.' }; nibSay('Sorry. I saw a pattern that wasn\'t there.', { mood: 'sad', ms: 2600 }); }
    drawWindow();
  }
  function raw(id) {
    const c = s.tray.find(x => x.id === id), r = E.submitRaw(s, id); if (!r.ok) return toast(r.why, 'bad');
    const name = esc(C[F[c.fid].cls].name);
    if (!r.real) { ui.result = { ops: true, good: false, html: `<b>Rejected: not a bug.</b> ${name} was a false alarm. −3 reputation.` }; nib.setMood('sad'); nibSay('That one\'s on me. Maybe prove the shaky ones.', { mood: 'sad', ms: 3000 }); }
    else { ui.result = { ops: true, good: true, html: `<b>Accepted.</b> ${name} ${paidTag(r.fid)}` }; paid(r, 'contract', r.fid); }
    drawWindow();
  }
  function buyTool(id) {
    const r = E.buyTool(s, id); if (!r.ok) return toast(r.why, 'bad');
    const t = D.TOOLS.find(x => x.id === id); floatAt(t.name, 'forge'); toast(t.name + ' bought. ' + t.opens, 'good');
    if (r.first) { world.pulseAt('hq'); nibSay('HQ has a board for criticals now. Look for two bugs that feed each other.', { ms: 4200 }); }
    drawWindow();
  }
  function traceChain(tid, option) {
    const rep = s.rep, r = E.trace(s, tid, option); if (!r.ok) return toast(r.why, 'bad');
    if (!r.chained) { ui.traceMsg = { tid, text: 'That doesn\'t explain how one bug feeds the other. Try again.' }; drawWindow(); return; }
    stampDue('chain:' + tid); // the chain's tag lands with the full hit-stop (motion #2)
    ui.traceMsg = null; floatAt('CRITICAL', 'hq'); toast('CRITICAL chain: ' + T[tid].chain.name + ' · +' + money(r.pay), 'crit');
    payChip({ ...r, crit: true, rep: s.rep - rep }, 'hq', null, 'chain:' + tid); // its pay flies from the tag once that lands (#4)
    nibSay('One bug opens the door, the other walks through it. That\'s a critical.', { mood: 'happy', ms: 4000 });
    nib.hop(); // squash & stretch: and for a critical chain
    drawWindow(); if (r.won) setTimeout(() => goal(ending, 'hq'), 1600);
  }

  // ---------- coffee, sleep, night ----------
  $('coffee').addEventListener('click', () => { const r = E.coffee(s); if (!r.ok) return toast(r.why, 'bad'); toast('+' + D.COST.coffee + ' focus. ' + s.cups + ' left today.'); if (ui.win) drawWindow(); else render(); });
  $('sleep').addEventListener('click', sleep);
  // #12 Lights out, lamp by lamp. Warm pools over the stations that exist, on a layer over the world canvas (world.js
  // stays as published; positioned from roomRect() like nib.js's layer). Sleep flickers them off one by one, 120 ms apart
  // in steps, farthest from Nib's night spot first, while the night settles; morning lifts the night and flickers them
  // back on, nearest first. Pure decoration: sleep() never waits on it, so the night's own timing is unchanged.
  function placeLamps() {
    const wrap = $('world-wrap'); let L = $('lamps');
    if (!L) { L = wrap.appendChild(document.createElement('div')); L.id = 'lamps'; L.setAttribute('aria-hidden', 'true'); }
    L.hidden = world.getState().room !== 'office'; if (L.hidden) return L;
    // In the wrap's own px: mid-punch (#13) its on-screen rect is zoomed by k, and L sits inside that zoom.
    const wr = wrap.getBoundingClientRect(), k = wr.width / wrap.offsetWidth || 1, rr = world.roomRect(), room = W.rooms.find(r => r.id === 'office');
    // Moved by transform (the follow camera moves it every frame while you walk): no layout; size is written only when it changes.
    const x = (rr.left - wr.left) / k, y = (rr.top - wr.top) / k, size = rr.width / k + 'px ' + rr.height / k + 'px', at = `translate(${x}px, ${y}px)`;
    if (L.dataset.size !== size) { L.dataset.size = size; Object.assign(L.style, { left: '0', top: '0', width: rr.width / k + 'px', height: rr.height / k + 'px' }); }
    if (L.style.transform !== at) L.style.transform = at;
    const ids = ORDER.filter(shown).join();
    if (L.dataset.ids !== ids) {
      L.dataset.ids = ids;
      L.innerHTML = ORDER.filter(shown).map(id => { const st = W.stations.find(x => x.id === id); return `<b data-id="${id}" style="left:${st.x / room.width * 100}%;top:${st.y / room.height * 100}%"><i class="glow"></i><i class="shade"></i></b>`; }).join('');
    }
    return L;
  }
  function switchLamps(on) {
    const L = placeLamps(); L.classList.toggle('off', !on);
    if (reduced) return;
    const at = shown('rig') ? SPOT.rig : nibHome(), far = b => { const st = W.stations.find(x => x.id === b.dataset.id); return Math.hypot(st.x - at[0], st.y - at[1]); };
    const lamps = [...L.children].sort((a, b) => far(b) - far(a)); if (on) lamps.reverse();
    const lit = on ? [0, .8, .3, 1] : [1, .2, .7, 0], at3 = on ? [0, .3, .5, 1] : [0, .3, .45, 1]; // a flicker, not a fade
    lamps.forEach((b, i) => {
      const o = { duration: on ? 300 : 260, delay: (on ? 300 : 0) + i * 120, easing: 'steps(4, end)', fill: 'backwards' };
      b.children[0].animate(lit.map((v, j) => ({ opacity: v, offset: at3[j] })), o);
      // The dark pool is the night's: it falls lamp by lamp, but lifts with the night (.night.rise), never on a lit floor.
      b.children[1].animate(on ? [{ opacity: 1 }, { opacity: 0 }] : lit.map((v, j) => ({ opacity: 1 - v, offset: at3[j] })), on ? { duration: 500, easing: 'ease-in', fill: 'backwards' } : o);
    });
  }
  // The night falls after the first lamps go (style.css .fall) and lifts in the 500 ms sleep() gives it (.rise).
  function lightsOut(night) { if (!reduced) { night.classList.remove('rise'); night.classList.add('fall'); } switchLamps(false); }
  function lightsOn(night) { if (!reduced) { night.classList.remove('fall'); night.classList.add('rise'); } switchLamps(true); }
  async function sleep() {
    if (ui.night || ui.busy || ui.morning) return;
    if (s.pendingTeach) return toast('Nib wants to hear why first.', 'bad');
    closeWindow(); nib.hush(); tip = null; ui.night = true; ui.nightP = 0; render();
    const night = $('night'); night.hidden = false; $('night-text').textContent = 'Night ' + s.day + '. ' + (s.target ? 'Nib takes the night shift.' : 'Nib has nothing to work on.');
    await wait(30); night.classList.add('on');
    lightsOut(night); // #12: decoration only, nothing waits on it
    nib.setLit(true); await nibWalk(shown('rig') ? SPOT.rig : nibHome()); nib.setMood('think');
    const r = E.sleep(s).night;
    for (let i = 1; i <= 10; i++) { ui.nightP = i / 10; syncWorld(); await wait(170); }
    lightsOn(night); // #12
    night.classList.remove('on'); await wait(500); night.hidden = true; ui.night = false; ui.morning = true; nib.setLit(false); nib.setMood('idle');
    render();
    const mapped = r.mapped.map(id => T[s.target].rooms.find(x => x[0] === id)[1]);
    const bits = [];
    if (mapped.length) bits.push('I mapped ' + (mapped.length > 1 ? mapped.slice(0, -1).join(', ') + ' and ' + mapped[mapped.length - 1] : mapped[0]) + '.');
    if (r.made) bits.push(r.made === 1 ? 'One find is on the Ops desk.' : r.made + ' finds are on the Ops desk.');
    else if (r.idle === 'untaught') bits.push('I couldn\'t hunt: I don\'t know any patterns yet. Teach me.');
    else if (r.idle === 'full') bits.push('The Ops desk is full, so I stopped. Clear some finds.');
    else if (r.idle === 'nothing') bits.push('Nothing I know how to look for in the rooms we\'ve mapped.');
    else if (r.idle === 'nojob') bits.push('No job yet, so I just watched the lamp.');
    if (r.made) await nibWalk(SPOT.ops);
    if (r.firsts.ops) world.pulseAt('contract');
    await nibSay('Morning, day ' + s.day + '. ' + bits.join(' '), { next: true, nextLabel: 'OK', mood: r.made ? 'happy' : 'idle' });
    if (r.firsts.rig) { world.pulseAt('rig'); await nibSay('That laptop gives me one try a night. A GPU would give me more tries. Not more brains: those come from you.', { next: true, nextLabel: 'Got it' }); }
    if (r.firsts.ops) await nibSay('I\'m not always right. Prove a find to be safe, or trust me and submit it as-is.', { next: true, nextLabel: 'Got it' });
    ui.morning = false; render();
    if (!ui.busy) nibWalk(nibHome());
  }

  // ---------- ending ----------
  function ending() {
    closeWindow();
    const byHand = s.stats.manual, byNib = s.stats.nib, chain = Object.keys(s.chains).length > 0;
    const style = byNib > byHand ? 'You taught me well enough that I did most of the finding. That was the idea.' : byHand >= 15 ? 'You did most of it by hand. I watched every line. Next time, let me carry more.' : 'Half you, half me. A real partnership.';
    const crit = chain ? 'And the critical: we built it from two small bugs.' : 'And the critical just fell out of the sky. Lucky us.';
    $('modal-body').innerHTML = `<div class="ending"><canvas id="end-nib" width="16" height="21"></canvas>
      <h1 id="modal-title">First job done.</h1>
      <p class="lede">20 bugs and a critical in ${s.wonDay} day${s.wonDay > 1 ? 's' : ''}. ${money(s.stats.earned)} earned · ${E.tier(s).name} reputation.</p>
      <blockquote>“${esc(style)} ${esc(crit)}”<cite>— ${esc(s.nib)}</cite></blockquote>
      <p class="fine">Next chapter: hiring help. Teaching one partner was hard; a team is harder.</p>
      <div class="actions"><button data-close class="quiet">Stay a while</button><button id="to-stage3" class="accent" data-icon="arrow">Chapter 3: Hire help</button></div></div>`;
    drawPortrait($('end-nib'));
    $('modal').showModal(); render();
    $('to-stage3').addEventListener('click', () => { $('modal').close(); startStage3(); });
  }
  // Stage 3 starts from wherever Stage 2 ended: same office, same money, same Nib. Two agents join.
  function startStage3(seeded) {
    if (seeded) s = seeded;
    s.stage = 3; ['job', 'training', 'ops', 'forge', 'rig', 'stats', 'hq', 'rest', 'intro'].forEach(k => { s.seen[k] = true; });
    leave();
  }
  function ending3() {
    closeWindow();
    const A = window.Stage3Agents, team = A ? A.list().filter(a => a.id !== 'nib') : [];
    const byTeam = s.stats.agent || 0, pens = A ? A.crew().pens.length : 0;
    $('modal-body').innerHTML = `<div class="ending"><canvas id="end-nib" width="16" height="21"></canvas>
      <h1 id="modal-title">Elite.</h1>
      <p class="lede">Elite reputation on day ${s.day}. The team landed ${byTeam} bug${byTeam === 1 ? '' : 's'}${pens ? ' and took ' + pens + ' penalt' + (pens === 1 ? 'y' : 'ies') : ' without a single penalty'}.</p>
      <blockquote>“${esc(pens > 3 ? 'They learned the rules the hard way. So did we.' : 'You wrote good rules. They mostly followed them.')} ${esc(team.length ? (team.length > 1 ? team.slice(0, -1).map(a => a.name).join(', ') + ' and ' + team[team.length - 1].name : team[0].name) + ' did fine.' : '')}”<cite>— ${esc(s.nib)}</cite></blockquote>
      <p class="fine">Next chapter: a rival company that is always one step ahead. Coming later.</p>
      <div class="actions"><button data-close class="accent">Keep playing</button></div></div>`;
    drawPortrait($('end-nib'));
    $('modal').showModal(); render();
  }
  function drawPortrait(cv) { cv.width = 16; cv.height = 21; const g = cv.getContext('2d'); g.clearRect(0, 0, 16, 21); window.Avatars.draw(g, 'nib', 8, 21, 1, { mood: 'happy', lit: true }); }

  // ---------- menu ----------
  function openMenu() {
    $('settings-body').innerHTML = `<div class="field"><label for="pname">Your name</label><input id="pname" value="${esc(s.player)}" maxlength="24"></div>
      <div class="field"><label for="nname">Partner's name</label><input id="nname" value="${esc(s.nib)}" maxlength="24"></div>
      <div class="menu-row"><button id="save-names" class="accent">Save names</button></div>
      <details class="ref"><summary>Controls</summary><dl class="keyboard-help"><div><dt>WASD / arrows</dt><dd>Walk</dd></div><div><dt>E / Space</dt><dd>Use a desk</dd></div><div><dt>1 2 3 · Enter</dt><dd>Answer Nib</dd></div><div><dt>H T O B R I C</dt><dd>Desk, Nib, Ops, Tools, Rig, Ledger, HQ</dd></div><div><dt>Esc</dt><dd>Close</dd></div></dl></details>
      <details class="ref"><summary>Chapters</summary>
        <div class="menu-row"><button id="ch1" class="quiet">1 · Meet Nib</button><button id="ch2" class="quiet">2 · First job</button><button id="ch3" class="quiet">3 · Hire help</button></div></details>
      <div class="menu-row"><button id="restart" data-icon="refresh" class="danger">Restart this chapter</button></div>${saveOk ? '' : '<small id="save-status">Saving is unavailable in this browser.</small>'}`;
    $('settings-dialog').showModal(); render();
    $('save-names').onclick = () => { s.player = $('pname').value.trim().slice(0, 24) || 'friend'; s.nib = $('nname').value.trim().slice(0, 24) || 'Nib'; save(); toast('Saved.'); };
    $('restart').onclick = restart;
    $('ch1').onclick = () => { if (!confirm('Replay Stage 1? Nib forgets you, and the office starts over.')) return; wipe(); frozen = true; location.href = '/meet.html'; };
    $('ch2').onclick = () => { if (!confirm('Start the first job over? Names stay.')) return; s = E.create({ playerName: s.player, nibName: s.nib, facts: s.memories }, crypto.getRandomValues(new Uint32Array(1))[0]); wipe(true); leave(); };
    // A finished first job goes into chapter 3 as it is; otherwise the jump uses a ready-made finished job.
    $('ch3').onclick = () => {
      if (stage3()) return toast('You\'re already in chapter 3.');
      if (s.won) return startStage3();
      if (!confirm('Jump to chapter 3 with a ready-made finished first job? This replaces your save.')) return;
      wipe(true); startStage3(window.Stage3Scope.seed({ playerName: s.player, nibName: s.nib, facts: s.memories }));
    };
  }
  // Writes the current save one last time, then freezes saving and navigates.
  // #17: the page goes behind a pixel iris closing onto Nib (iris.js; instant under reduced motion).
  function leave(url) {
    save(); frozen = true; const go = () => { if (url) location.href = url; else location.reload(); };
    ['settings-dialog', 'modal'].forEach(id => { if ($(id).open) $(id).close(); }); // the top layer would sit over the iris
    if (window.Iris) window.Iris.go(go, ...nibScreen()); else go();
  }
  // #17: where Nib is on screen, or the screen's centre when the office isn't in view.
  function nibScreen() {
    if (world.getState().room !== 'office' || document.body.classList.contains('s3-agents-open')) return [innerWidth / 2, innerHeight / 2];
    const rr = world.roomRect(), k = rr.width / W.rooms.find(r => r.id === 'office').width, p = nib.pos();
    return [rr.left + p.x * k, rr.top + (p.y - 10) * k];
  }
  let posSaved = null; // the last position written (savePos); cleared with it so a wiped save is written afresh
  function wipe(keepNib) {
    window.Stage3Scope?.reset(); posSaved = null;
    try { [KEY, POS, 'first-office-crew-v1'].concat(keepNib ? [] : [INTRO]).forEach(k => localStorage.removeItem(k)); } catch {}
  }
  function restart() {
    if (stage3()) { if (!confirm('Restart chapter 3? Agents, rules and progress since the first job are cleared.')) return; wipe(true); startStage3(window.Stage3Scope.seed({ playerName: s.player, nibName: s.nib, facts: s.memories })); return; }
    if (!confirm('Restart the first job? Your names stay.')) return;
    const keep = { playerName: s.player, nibName: s.nib, facts: s.memories };
    s = E.create(keep, crypto.getRandomValues(new Uint32Array(1))[0]);
    try { localStorage.removeItem(POS); } catch {} posSaved = null;
    leave();
  }

  // ---------- input ----------
  // Leaving (the iris is closing): no key or click reaches the office, world.js included (window capture runs first).
  ['keydown', 'click', 'pointerdown'].forEach(t => window.addEventListener(t, e => { if (frozen) { e.stopImmediatePropagation(); e.preventDefault(); } }, true));
  document.addEventListener('click', e => {
    const close = e.target.closest('[data-close]'); if (close) { const d = close.closest('dialog'); if (d.id === 'panel-dialog') closeWindow(); else { d.close(); render(); } return; }
    const gb = e.target.closest('#dock [data-group]'); if (gb) { setMenu(dockOpen === gb.dataset.group ? null : gb.dataset.group); return; }
    const pick = e.target.closest('.dock-menu [data-station]'); if (pick) { const m = pick.closest('.dock-menu'); if (dockOpen) setMenu(null); if (m.matches(':hover')) { dockHush = m.dataset.menu; m.classList.add('hush'); } }
    const st = e.target.closest('[data-station]'); if (st) { ui.win === st.dataset.station ? closeWindow() : openStation(st.dataset.station); return; }
  });
  $('goal-open').addEventListener('click', () => s.won && !stage3() ? ending() : shown('hq') ? openStation('hq') : nibSay('Twenty bugs and one critical. ' + s.bugs + ' down. Criticals are rare: about one in twenty.', { ms: 4000 }));
  $('nib-chip').addEventListener('click', () => shown('training') ? openStation('training') : nibSay(objective(), { ms: 3600 }));
  $('stats-open').addEventListener('click', () => openStation('stats'));
  $('settings').addEventListener('click', openMenu);
  $('interact').addEventListener('click', () => world.interact());
  $('world').addEventListener('pointerdown', () => { if (ui.win) closeWindow(); });
  document.querySelectorAll('[data-move]').forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); world.move(b.dataset.move, true); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, () => world.move(b.dataset.move, false)));
  });
  ['modal', 'settings-dialog'].forEach(id => $(id).addEventListener('close', render));
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,textarea,select')) return;
    const bubble = $('nib-bubble');
    // #11: Enter or 1-3 while Nib's line is still typing finishes it; the answers appear, nothing is picked yet.
    if (nib.typing && (e.key === 'Enter' ? !e.target.closest('button') : /^[1-3]$/.test(e.key)) && nib.skip()) { e.preventDefault(); return; }
    if (!bubble.hidden && e.key === 'Enter' && !e.target.closest('button')) { const b = bubble.querySelector('.nib-next'); if (b) { e.preventDefault(); b.click(); return; } }
    if (!bubble.hidden && /^[1-3]$/.test(e.key)) { const b = bubble.querySelectorAll('.nib-choice')[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } return; }
    if (e.key === 'Escape' && (dockOpen || document.activeElement.closest?.('.dock-menu'))) { const g = dockOpen; setMenu(null); const b = document.querySelector(`#dock [data-group="${g || document.activeElement.closest('.dock-menu').dataset.menu}"]`); b && b.focus(); return; }
    if (e.key === 'Escape' && ui.win && !$('modal').open) { e.preventDefault(); closeWindow(); return; }
    if (e.repeat || $('modal').open || $('settings-dialog').open || ui.night) return;
    const id = ORDER.find(k => ST[k].key === e.key.toLowerCase());
    if (id && shown(id) && !(ui.win && e.target.closest('#panel-dialog') && /^[a-z]$/.test(e.key) && false)) { e.preventDefault(); ui.win === id ? closeWindow() : openStation(id); }
    else if (e.key.toLowerCase() === 'g') $('goal-open').click();
    else if (e.key.toLowerCase() === 'v') toggleVitals();
    else if (e.key.toLowerCase() === 'z' && !$('view-toggle').hidden) $('view-toggle').click();
  });
  window.addEventListener('resize', layout);
  const ro = new ResizeObserver(layout); ro.observe(document.querySelector('.dock-shell')); ro.observe($('world')); // the canvas: after world.js's own observer has resized it
  window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { try { s = E.restore(JSON.parse(e.newValue)); render(); if (ui.win) drawWindow(); } catch {} } });
  // Where you stand: written only when it changed (not every second while idle), and on leaving or hiding the tab.
  const savePos = () => { if (frozen) return; const v = JSON.stringify(world.getState()); if (v === posSaved) return; try { localStorage.setItem(POS, v); posSaved = v; } catch {} };
  let posTimer = setInterval(savePos, 1000); // you can't move in a hidden tab: no timer there
  addEventListener('pagehide', savePos);
  document.addEventListener('visibilitychange', () => { clearInterval(posTimer); if (document.hidden) savePos(); else posTimer = setInterval(savePos, 1000); });

  // Nib's face on the dock chip: the avatar cropped to its head. When he can't be seen in the office, a payout's happy hop
  // (#1) plays here, on the same held whole-pixel frames, the lift halved so his face stays in the frame.
  const face = $('nib-face').getContext('2d');
  function chipFace(o) { face.clearRect(0, 0, 16, 14); window.Avatars.draw(face, 'nib', 8, 17, 1, o || {}); }
  let faceAt = null;
  function faceHop() {
    if (reduced) return;
    const go = faceAt === null; faceAt = performance.now(); // a second payout mid-hop starts it over
    if (go) requestAnimationFrame(function f(t) { const p = window.Avatars.hop(Math.max(0, t - faceAt)); chipFace(p && { mood: 'happy', bob: Math.round(p.y / 2), sx: p.sx, sy: p.sy }); if (p) requestAnimationFrame(f); else faceAt = null; });
  }
  chipFace();

  // ---------- boot ----------
  syncWorld();
  try { const p = JSON.parse(localStorage.getItem(POS)); if (p) world.restore(p, 0, worldView()); } catch {}
  layout(); render();
  const home = s.seen.intro ? nibHome() : SPOT.side;
  nib.place(home[0], home[1]);
  if (window.Iris && window.Iris.arrived()) requestAnimationFrame(() => requestAnimationFrame(() => window.Iris.open(...nibScreen()))); // #17: a chapter change opens on Nib, once the dock's first resize has placed the room
  if (!s.seen.intro) {
    (async () => {
      await wait(700);
      await nibSay('So this is the office, ' + s.player + '. One desk, one lamp, and us.', { next: true });
      await nibSay('Our first job is on that computer: twenty bugs and one critical. Walk over with WASD and press E.', { next: true, nextLabel: 'Let\'s go' });
      s.seen.intro = true; render();
    })();
  } else if (s.pendingTeach) {
    // Reloaded mid-lesson: reopen the code with the found line marked, so the question has its context.
    const fid = s.pendingTeach, f = F[fid];
    ui.fid = fid; ui.view = 'hunt'; ui.miss = null; ui.hit = C[f.cls].variants[f.variant].findIndex(l => l.bad);
    setTimeout(() => { openStation('hunt'); teachMoment(fid, false, ui.hit); }, 600);
  } else if (stage3() && !s.seen.team) {
    (async () => {
      await wait(700);
      await nibSay('We have a team now, ' + s.player + '. Pip and Moss. They walk the office and use the same desks you do.', { next: true });
      await nibSay('Tell them what to do in Team, at the top, in plain words. The goal: Elite, 60 rep, with at least 5 bugs from the team.', { next: true, nextLabel: 'Open Team' });
      s.seen.team = true; render(); window.Stage3UI?.open('nib');
    })();
  } else if (!s.won || stage3()) nibSay('Welcome back, ' + s.player + '. ' + objective(), { ms: 4200 });

  // Agents change the save while you have a window open. Redraw it, but never between your mousedown and mouseup,
  // or the button you're pressing is replaced and the click is lost.
  let pressing = false, redrawPending = false;
  $('panel-dialog').addEventListener('pointerdown', () => { pressing = true; });
  window.addEventListener('pointerup', () => { pressing = false; if (redrawPending) { redrawPending = false; setTimeout(redrawSoon, 0); } }, true);
  function redrawSoon() { if (!ui.win || ui.busy) return; if (pressing) { redrawPending = true; return; } drawWindow(); }

  // Hooks for Stage 3's agents. agentAct runs one engine call on the live save, then saves and redraws.
  window.Stage2 = { state: () => s, live: () => s, ui: () => ui, open: openStation, close: closeWindow, world, nib, SPOT, floatAt, toast, stage3,
    agentAct: fn => { const r = fn(s); save(); render(); redrawSoon(); return r; },
    frozen: () => frozen,
    refresh: () => { render(); if (ui.win && !ui.busy) drawWindow(); },
    hud: () => render(), // HUD and dock only: never redraws an open window under your cursor
    restart3: () => { wipe(true); startStage3(window.Stage3Scope.seed({ playerName: s.player, nibName: s.nib, facts: s.memories })); } };
  window.Stage2.payChip = payChip; // agents' pay flies to the wallet too (#4)
  window.Stage2.wallet = shownWallet; // what the wallet shows, pay in flight held back: Team's footer uses it
  if (stage3()) (window.Stage3Boot || []).forEach(fn => fn());
})();
