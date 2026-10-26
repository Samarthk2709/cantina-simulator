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
    world.setInsets({ top: Math.max(64, hud.bottom + 8), bottom: innerHeight - dock.top + 12, hud: { left: hud.left, bottom: hud.bottom + 8 } });
    document.documentElement.style.setProperty('--dock-top', Math.round(innerHeight - dock.top) + 'px');
    world.setTouch(matchMedia('(pointer: coarse)').matches || innerWidth < 650);
  }

  const nib = window.NibActor.create({ W, world, canvas: $('nib-layer'), bubble: $('nib-bubble'), hidden, side: () => 'right', dock: () => $('panel-dialog').open ? $('panel-dialog').getBoundingClientRect() : null });
  // Lines that wait for the player (Next or a choice) queue up; timed lines are interrupted by anything newer.
  let queue = Promise.resolve(), waiting = 0;
  function nibSay(text, o) {
    o = o || {};
    if (!o.next && !o.choices && waiting) { flashLine(text, o.ms || 3600); return Promise.resolve(true); }
    if (!o.next && !o.choices && innerWidth < 700 && $('panel-dialog').open) { flashLine(text, o.ms || 3600); return Promise.resolve(true); }
    // A line that waits for you (Next or a choice) must be seen: bring you back from the Team view.
    const run = () => { if ((o.next || o.choices) && window.Stage3UI?.isOpen()) window.Stage3UI.close(); return nib.say(text, o); }, p = queue.then(run, run);
    if (o.next || o.choices) { waiting++; p.finally(() => { waiting--; }); queue = p.catch(() => {}); }
    return p;
  }
  const nibWalk = (spot, then) => new Promise(r => nib.goTo(spot[0], spot[1], () => { if (then) then(); r(); }));
  function nibToPlayer() { const p = world.getState(); return nibWalk([Math.min(304, p.x + 22), p.y]); }

  let flash = null;
  function flashLine(text, ms) { flash = { text, until: Date.now() + ms }; render(); setTimeout(render, ms + 50); }

  // ---------- objective: always one clear next step ----------
  function objective() {
    if (stage3()) return objective3();
    if (s.won) return 'Job done, ' + s.player + '. Chapter 3 is ready when you are: click the goal.';
    if (!s.target) return 'Walk to your desk and press E. Our first job is on the computer.';
    if (s.pendingTeach) return 'Tell me why that was a bug.';
    const drafts = Object.keys(s.found).filter(fid => s.found[fid].status === 'draft');
    const draft = drafts.find(fid => F[fid].target === s.target) || drafts[0];
    if (draft && s.found[draft].source === 'manual') return F[draft].target === s.target ? 'Finish the report at your desk.' : 'A report on ' + T[F[draft].target].name + ' is unfinished. It\'s on the Ops desk.';
    if (Object.keys(T).some(tid => E.chainState(s, tid).ready)) return 'Both halves of a chain are in. Trace it at HQ.';
    if (s.tray.length >= D.COST.tray) return 'The Ops desk is full, so I can\'t work tonight. Clear some finds.';
    if (s.tray.length) return 'I left ' + s.tray.length + ' find' + (s.tray.length > 1 ? 's' : '') + ' on the Ops desk.';
    if (draft) return 'One of my finds needs its report checked.';
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

  // ---------- HUD + dock ----------
  let dockSeen = null;
  function render() {
    const mf = E.maxFocus(s);
    $('focus').hidden = !s.seen.job;
    $('focus-fill').style.width = (s.focus / mf * 100) + '%';
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
    if (stage3() && !s.won3 && s.rep >= 60 && teamBugs >= TEAM_GOAL) { s.won3 = true; setTimeout(ending3, 1200); }
    $('objective').textContent = flash && Date.now() < flash.until ? flash.text : objective();
    $('stats-open').hidden = !s.seen.stats;
    $('cash').textContent = money(s.cash); $('rep').textContent = s.rep;
    const known = (dockSeen = dockSeen || new Set(ORDER.filter(shown)));
    let freshN = 0; // new dock buttons arrive 3 frames apart (style.css --stagger)
    const btns = ORDER.filter(shown).map(id => {
      const fresh = !known.has(id); known.add(id);
      const badge = id === 'contract' && s.tray.length ? `<span class="badge">${s.tray.length}</span>` : id === 'hq' && Object.keys(T).some(t => E.chainState(s, t).ready) ? '<span class="badge">!</span>' : '';
      return `<button data-station="${id}" data-icon="${ST[id].icon}" class="${fresh ? 'fresh' : ''}"${fresh ? ` style="--i:${freshN++}"` : ''} aria-pressed="${ui.win === id}" title="${ST[id].name} (${ST[id].key.toUpperCase()})">${ST[id].name}${badge}</button>`;
    }).join('');
    const dock = $('dock');
    if (dock.dataset.html !== btns) { dock.querySelectorAll('[data-station]').forEach(b => b.remove()); $('stats-open').insertAdjacentHTML('beforebegin', btns); dock.dataset.html = btns; }
    $('panel-wallet').textContent = s.seen.stats ? money(s.cash) + ' · ' + s.rep + ' rep' : '';
    syncWorld();
    save();
  }
  function toast(text, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = text;
    $('toasts').appendChild(el); setTimeout(() => el.remove(), 3600);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }
  function floatAt(text, station) { world.float(text, station); }

  // ---------- windows ----------
  function openStation(id) {
    if (!ST[id] || !shown(id) || ui.night) return;
    if (id === 'hunt' && !s.target) ui.view = 'board';
    ui.win = id; ui.result = null; ui.traceMsg = null;
    const d = $('panel-dialog');
    if (!d.open) d.show();
    drawWindow(true);
    // Keyboard focus goes to Nib's waiting line if there is one, else the window: never the × button,
    // or Enter would close the window instead of answering Nib.
    const b = $('nib-bubble'), wait = !b.hidden && b.classList.contains('asks') && (b.querySelector('.nib-next') || b);
    (wait || $('panel-body')).focus({ preventScroll: true });
  }
  function closeWindow() { ui.win = null; ui.miss = null; if ($('panel-dialog').open) $('panel-dialog').close(); render(); $('world').focus({ preventScroll: true }); }
  function drawWindow(top) {
    if (!ui.win) return;
    const body = $('panel-body'), y = body.scrollTop;
    const html = { hunt: deskView, training: nibView, contract: opsView, forge: toolsView, rig: rigView, stats: ledgerView, hq: hqView }[ui.win]();
    body.innerHTML = html;
    $('panel-title').textContent = crumbs();
    $('panel-dialog').classList.toggle('roomy', ui.win === 'hunt' && (ui.view === 'hunt' || ui.view === 'report' || ui.view === 'map'));
    body.scrollTop = top ? 0 : y;
    render();
  }

  // The window's one title line: where you are, e.g. "Desk › ChatterBox › Groups › Hunt".
  function crumbs() {
    const c = [ST[ui.win].name];
    if (ui.win === 'hunt') {
      if (ui.view === 'board' || !s.target) c.push('Bounty board');
      else {
        const f = ui.fid && F[ui.fid], t = f ? T[f.target] : T[s.target];
        c.push(t.name);
        if (ui.view === 'report' && f) c.push('Report');
        else if (ui.view === 'hunt' && f) c.push(t.rooms.find(r => r[0] === f.room)[1], 'Hunt');
        else if (ui.room) { const r = t.rooms.find(x => x[0] === ui.room); if (r) c.push(r[1]); }
      }
    } else c.push({ training: 'Pattern book', contract: 'Nib\'s finds', forge: 'Shop', rig: 'GPU rig', stats: s.rep + ' rep · ' + E.tier(s).name, hq: 'Criticals' }[ui.win]);
    return c.join('  ›  ');
  }

  // Desk: board → map → hunt → report.
  function deskView() {
    if (ui.view === 'hunt' && ui.fid && (E.slotState(s, ui.fid) === 'open' || ui.hit != null)) return huntView();
    if (ui.view === 'report' && ui.fid && s.found[ui.fid]) return reportView();
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
        : st === 'draft' ? `<button data-act="report" data-id="${fid}">Finish report</button>`
        : `<span class="tag good">${found.crit ? 'CRITICAL · ' : ''}${found.grade} · ${money(found.pay)}</span>`;
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
  function reportView() {
    const fid = ui.fid, f = F[fid], r = s.found[fid], cls = C[f.cls], t = T[f.target];
    const text = (sec, i) => sec === 'proof' ? D.PROOF[i] : D.fill(cls.report[sec][i], f.nouns);
    const secs = D.SECTIONS.map(x => {
      const pick = r.report[x.id], locked = x.id === 'proof' && r.source === 'nib' && !r.proven;
      const opts = shuffledOptions(fid, x.id).map(i => `<button class="opt ${pick === i ? 'on' : ''}" data-act="pick" data-sec="${x.id}" data-id="${i}" ${locked && i === 0 ? 'disabled title="Never proven"' : ''}>${esc(text(x.id, i))}</button>`).join('');
      const weak = r.drafted && pick !== undefined && pick !== 0 && r.status !== 'accepted';
      const react = pick !== undefined ? `<p class="triage t${pick}"><b>Triager:</b> ${esc(D.TRIAGE[x.id][pick])}</p>` : '';
      return `<section class="sec ${weak ? 'weak' : ''}"><h4>${x.name}${weak ? ' <span class="tag">Nib wasn\'t sure</span>' : ''}</h4><div class="opts">${opts}</div>${react}</section>`;
    }).join('');
    const done = r.status === 'accepted';
    const paper = D.SECTIONS.map(x => r.report[x.id] !== undefined ? `<p><b>${x.name}:</b> ${esc(text(x.id, r.report[x.id]))}</p>` : `<p class="blank"><b>${x.name}:</b> …</p>`).join('');
    const res = ui.result && ui.result.fid === fid ? ui.result : null;
    const stamp = done ? `<div class="stamp ${r.crit ? 'crit' : ''}"><b>${r.crit ? 'CRITICAL' : 'ACCEPTED'}</b><span>${r.grade} · ${money(r.pay)}</span></div>` : '';
    const verdict = !done && r.verdict ? `<div class="feedback miss"><b>Sent back.</b> ${esc(r.verdict.replace(/^Rejected: /, '').replace(/^./, c => c.toUpperCase()))} Change a section and resubmit.</div>` : '';
    const by = r.source === 'agent' ? 'Found by ' + esc(r.by) : r.source === 'nib' ? (r.proven ? 'Nib\'s draft · proven' : 'Nib\'s draft · unproven') : r.drafted ? 'Nib drafted it · check weak sections' : '';
    return `<div class="win-head"><h2>${esc(cls.name)}</h2>${by ? `<span class="fine">${by}</span>` : ''}${done ? '<button data-act="to-map" class="quiet small">← Map</button>' : ''}</div>
      ${done ? `<div class="paper">${stamp}${paper}</div>` : secs}
      ${verdict}
      ${done ? (res && res.won ? '' : `<button data-act="to-map" class="accent wide">Back to the map</button>`) : `<button data-act="submit" class="accent wide" ${D.SECTIONS.every(x => r.report[x.id] !== undefined) ? '' : 'disabled'}>Submit to ${esc(t.name)}</button>`}`;
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
    const drafts = Object.keys(s.found).filter(fid => s.found[fid].status === 'draft' && (s.found[fid].source === 'nib' || F[fid].target !== s.target) && s.pendingTeach !== fid).map(fid => `<li class="cand"><div><b>${esc(C[F[fid].cls].name)}</b><small>${esc(T[F[fid].target].name)} · ${s.found[fid].source === 'manual' ? 'your unfinished report' : s.found[fid].proven ? 'proven' : 'sent back'}</small></div><button data-act="report" data-id="${fid}" class="accent">Review report</button></li>`).join('');
    const res = ui.result && ui.result.ops ? `<div class="feedback ${ui.result.good ? 'hit' : 'miss'}">${ui.result.html}</div>` : '';
    return `${res}${cands ? `<p class="fine">Prove: safe, +25% pay. As-is: free, −3 rep if it's wrong.</p><ul class="cands">${cands}</ul>` : '<p class="empty">Nothing yet. Nib works while you sleep.</p>'}
      ${drafts ? `<h3>Reports</h3><ul class="cands">${drafts}</ul>` : ''}`;
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
      if (c.done) act = '<span class="tag good">CRITICAL · chained</span>';
      else if (c.ready) act = `<p class="fine">Why is this critical?</p><div class="opts">${shuffledOptions(t.id, 'chain').map(i => `<button class="opt" data-act="trace" data-tid="${t.id}" data-id="${i}">${esc(t.chain.options[i])}</button>`).join('')}</div>${tr ? `<div class="feedback miss">${esc(tr.text)}</div>` : ''}`;
      else act = `<p class="fine">${!E.has(s, 'trace') ? 'Needs the Tracer' : 'Needs both bugs'}</p>`;
      return `<li class="chain ${c.done ? 'done' : c.ready ? 'ready' : ''}"><b>${esc(t.name)}: ${esc(t.chain.name)}</b><div class="halves">${half(c.haveA, c.a, ra)}<span class="link">↔</span>${half(c.haveB, c.b, rb)}</div>${act}</li>`;
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
      report: () => { ui.win = 'hunt'; $('panel-title').textContent = ST.hunt.title; ui.view = 'report'; ui.fid = id; drawWindow(true); },
      pick: () => { const r = E.setSection(s, ui.fid, b.dataset.sec, +id); if (!r.ok && r.why) toast(r.why, 'bad'); drawWindow(); },
      submit: () => submitReport(ui.fid),
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
    if (r.mastered) { nibSay('I know this one cold. I drafted the report.', { mood: 'happy', ms: 2600 }); await wait(900); ui.view = 'report'; ui.hit = null; drawWindow(true); return; }
    await teachMoment(ui.fid, r.first);
  }
  async function teachMoment(fid, first) {
    ui.busy = true;
    if (first) { save(); render(); }
    await Promise.race([nibToPlayer(), wait(2500)]);
    const cls = C[F[fid].cls], f = F[fid];
    const choices = shuffledOptions(fid, 'teach').map(i => ['sharp', 'shallow', 'wrong'][i]).map(v => ({ value: v, label: D.fill(cls.teach[v], f.nouns) }));
    let ask = first ? 'You saw that. I didn\'t. Why is it a bug? Teach me and I\'ll look for it myself.' : 'Why is that one a bug?';
    for (;;) {
      const v = await nibSay(ask, { choices, mood: 'talk' });
      const r = E.teach(s, v);
      if (!r.learned) { ask = 'Hm. I don\'t think that\'s it. Look again?'; nib.setMood('sad'); continue; }
      ui.busy = false;
      if (r.drafted) nibSay((r.clean ? 'Sharper: ' : 'Hm: ') + pct(r.before) + ' → ' + pct(r.after) + '. I know enough to draft the report now. Fix anything weak.', { mood: r.clean ? 'happy' : 'think', ms: 4200 });
      else if (r.clean) nibSay(r.firstOfClass ? 'That makes sense. I\'ll hunt ' + cls.name.toLowerCase() + 's at night now. ' + pct(r.after) + ' sure of myself.' : 'Sharper. ' + pct(r.before) + ' → ' + pct(r.after) + ' on ' + cls.name.toLowerCase() + 's.', { mood: 'happy', ms: 3800 });
      else nibSay('OK, I\'ll remember that. ' + (r.after < r.before ? 'Though I feel less sure: ' + pct(r.before) + ' → ' + pct(r.after) + '.' : 'Feels thin, but it\'s a start: ' + pct(r.after) + '.'), { mood: 'think', ms: 4200 });
      if (first) { world.pulseAt('training'); toast('New: Nib has a desk and a pattern book.', 'good'); }
      break;
    }
    nibWalk(nibHome());
    ui.view = 'report'; ui.hit = null; if (ui.win !== 'hunt') openStation('hunt'); drawWindow(true);
  }
  function submitReport(fid) {
    const r = E.submit(s, fid);
    if (!r.ok) return toast(r.why, 'bad');
    ui.result = Object.assign({ fid }, r);
    if (!r.accepted) { if (r.over && r.repDelta) { toast('−2 reputation for overclaiming.', 'bad'); } drawWindow(); return; }
    paid(r, 'hunt');
    drawWindow();
  }
  function paid(r, station) {
    floatAt('+' + money(r.pay), station);
    if (r.crit) { toast('CRITICAL! That one was much worse than it looked.', 'crit'); nibSay('Wait. That one\'s critical. ' + s.player + ', that\'s the one we needed.', { mood: 'happy', ms: 4200 }); }
    else toast(r.grade + ' report · +' + money(r.pay) + ' · +' + r.rep + ' rep', 'good');
    if (r.tierUp) toast('Reputation: ' + r.tierUp.name + '. ' + r.tierUp.perk, 'good');
    if (r.firsts && r.firsts.forge) { world.pulseAt('forge'); world.pulseAt('stats'); nibSay('Our first bounty. There\'s a tool shelf now: tools open new kinds of bugs. The ledger tracks our reputation.', { ms: 5600, mood: 'happy' }); }
    if (r.firsts && r.firsts.hq) { world.pulseAt('hq'); nibSay('About one bug in twenty turns out critical. Or we make one: two bugs in connected rooms. HQ has the board.', { ms: 5600 }); }
    if (r.won) setTimeout(ending, 1600);
  }
  function prove(id) {
    const c = s.tray.find(x => x.id === id), r = E.prove(s, id); if (!r.ok) return toast(r.why, 'bad');
    if (r.real) { ui.result = { ops: true, good: true, html: `<b>Real.</b> ${esc(C[F[c.fid].cls].name)} confirmed. Nib drafted the report. <button data-act="report" data-id="${r.fid}" class="accent small">Review report</button>` }; nibSay('Told you. Mostly.', { mood: 'happy', ms: 2000 }); }
    else { ui.result = { ops: true, good: false, html: '<b>False alarm.</b> The proof didn\'t hold up. No harm done.' }; nibSay('Sorry. I saw a pattern that wasn\'t there.', { mood: 'sad', ms: 2600 }); }
    drawWindow();
  }
  function raw(id) {
    const c = s.tray.find(x => x.id === id), r = E.submitRaw(s, id); if (!r.ok) return toast(r.why, 'bad');
    const name = esc(C[F[c.fid].cls].name);
    if (!r.real) { ui.result = { ops: true, good: false, html: `<b>Rejected: not a bug.</b> ${name} was a false alarm. −3 reputation.` }; nib.setMood('sad'); nibSay('That one\'s on me. Maybe prove the shaky ones.', { mood: 'sad', ms: 3000 }); }
    else if (r.accepted) { ui.result = { ops: true, good: true, html: `<b>Accepted.</b> ${name} paid ${money(r.pay)} on Nib's draft (${r.grade}).` }; paid(r, 'contract'); }
    else ui.result = { ops: true, good: false, html: `<b>Sent back.</b> It's real, but Nib's draft was too vague. <button data-act="report" data-id="${r.fid}" class="small">Fix the report</button>` };
    drawWindow();
  }
  function buyTool(id) {
    const r = E.buyTool(s, id); if (!r.ok) return toast(r.why, 'bad');
    const t = D.TOOLS.find(x => x.id === id); floatAt(t.name, 'forge'); toast(t.name + ' bought. ' + t.opens, 'good');
    if (r.first) { world.pulseAt('hq'); nibSay('HQ has a board for criticals now. Look for two bugs that feed each other.', { ms: 4200 }); }
    drawWindow();
  }
  function traceChain(tid, option) {
    const r = E.trace(s, tid, option); if (!r.ok) return toast(r.why, 'bad');
    if (!r.chained) { ui.traceMsg = { tid, text: 'That doesn\'t explain how one bug feeds the other. Try again.' }; drawWindow(); return; }
    ui.traceMsg = null; floatAt('CRITICAL', 'hq'); toast('CRITICAL chain: ' + T[tid].chain.name + ' · +' + money(r.pay), 'crit');
    nibSay('One bug opens the door, the other walks through it. That\'s a critical.', { mood: 'happy', ms: 4000 });
    drawWindow(); if (r.won) setTimeout(ending, 1600);
  }

  // ---------- coffee, sleep, night ----------
  $('coffee').addEventListener('click', () => { const r = E.coffee(s); if (!r.ok) return toast(r.why, 'bad'); toast('+' + D.COST.coffee + ' focus. ' + s.cups + ' left today.'); if (ui.win) drawWindow(); else render(); });
  $('sleep').addEventListener('click', sleep);
  async function sleep() {
    if (ui.night || ui.busy || ui.morning) return;
    if (s.pendingTeach) return toast('Nib wants to hear why first.', 'bad');
    closeWindow(); nib.hush(); ui.night = true; ui.nightP = 0; render();
    const night = $('night'); night.hidden = false; $('night-text').textContent = 'Night ' + s.day + '. ' + (s.target ? 'Nib takes the night shift.' : 'Nib has nothing to work on.');
    await wait(30); night.classList.add('on');
    nib.setLit(true); await nibWalk(shown('rig') ? SPOT.rig : nibHome()); nib.setMood('think');
    const r = E.sleep(s).night;
    for (let i = 1; i <= 10; i++) { ui.nightP = i / 10; syncWorld(); await wait(170); }
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
  function leave(url) { save(); frozen = true; if (url) location.href = url; else location.reload(); }
  function wipe(keepNib) {
    window.Stage3Scope?.reset();
    try { [KEY, POS, 'first-office-crew-v1'].concat(keepNib ? [] : [INTRO]).forEach(k => localStorage.removeItem(k)); } catch {}
  }
  function restart() {
    if (stage3()) { if (!confirm('Restart chapter 3? Agents, rules and progress since the first job are cleared.')) return; wipe(true); startStage3(window.Stage3Scope.seed({ playerName: s.player, nibName: s.nib, facts: s.memories })); return; }
    if (!confirm('Restart the first job? Your names stay.')) return;
    const keep = { playerName: s.player, nibName: s.nib, facts: s.memories };
    s = E.create(keep, crypto.getRandomValues(new Uint32Array(1))[0]);
    try { localStorage.removeItem(POS); } catch {}
    leave();
  }

  // ---------- input ----------
  document.addEventListener('click', e => {
    const close = e.target.closest('[data-close]'); if (close) { const d = close.closest('dialog'); if (d.id === 'panel-dialog') closeWindow(); else { d.close(); render(); } return; }
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
    if (!bubble.hidden && e.key === 'Enter' && !e.target.closest('button')) { const b = bubble.querySelector('.nib-next'); if (b) { e.preventDefault(); b.click(); return; } }
    if (!bubble.hidden && /^[1-3]$/.test(e.key)) { const b = bubble.querySelectorAll('.nib-choice')[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } return; }
    if (e.key === 'Escape' && ui.win && !$('modal').open) { e.preventDefault(); closeWindow(); return; }
    if (e.repeat || $('modal').open || $('settings-dialog').open || ui.night) return;
    const id = ORDER.find(k => ST[k].key === e.key.toLowerCase());
    if (id && shown(id) && !(ui.win && e.target.closest('#panel-dialog') && /^[a-z]$/.test(e.key) && false)) { e.preventDefault(); ui.win === id ? closeWindow() : openStation(id); }
    else if (e.key.toLowerCase() === 'g') $('goal-open').click();
  });
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(document.querySelector('.dock-shell'));
  window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { try { s = E.restore(JSON.parse(e.newValue)); render(); if (ui.win) drawWindow(); } catch {} } });
  setInterval(() => { if (frozen) return; try { localStorage.setItem(POS, JSON.stringify(world.getState())); } catch {} }, 1000);

  // Nib's tiny face on the dock chip.
  // Nib's face on the dock chip: the avatar cropped to its head.
  (function chipFace() { window.Avatars.draw($('nib-face').getContext('2d'), 'nib', 8, 17, 1, {}); })();

  // ---------- boot ----------
  syncWorld();
  try { const p = JSON.parse(localStorage.getItem(POS)); if (p) world.restore(p, 0, worldView()); } catch {}
  layout(); render();
  const home = s.seen.intro ? nibHome() : SPOT.side;
  nib.place(home[0], home[1]);
  if (!s.seen.intro) {
    (async () => {
      await wait(700);
      await nibSay('So this is the office, ' + s.player + '. One desk, one lamp, and us.', { next: true });
      await nibSay('Our first job is on that computer: twenty bugs and one critical. Walk over with WASD and press E.', { next: true, nextLabel: 'Let\'s go' });
      s.seen.intro = true; render();
    })();
  } else if (s.pendingTeach) {
    // Reloaded mid-lesson: pick the question back up at the desk.
    const fid = s.pendingTeach;
    ui.fid = fid; ui.view = 'report';
    setTimeout(() => teachMoment(fid, false), 600);
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
  if (stage3()) (window.Stage3Boot || []).forEach(fn => fn());
})();
