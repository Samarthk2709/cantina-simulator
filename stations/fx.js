/* Station effects: animated art for the office stations, in variants to choose between.
   Each stations/<id>.js calls StationFX.add(id, { a: variant, b: variant, c: variant }). A variant is
   { name, draw(c, k), busy?(k) }. draw paints the station on the world canvas (office pixels) and may call
   k.base() for the original art; busy says it needs every frame right now (default: for 2.5 s after any event).
   original/world.js asks StationFX.draw for each station it paints; false falls back to the original art.

   k (per draw): f (sprite frame, 8/s), t (seconds), anim (false under reduced motion: draw a still frame),
     x, y, w, h (footprint in office px), T (tile px), L (facility level), V, S (world view model and state),
     near (the player is at this station), open (its window is open), night,
     agents (Stage 3 agents walking to or working here: { id, name, status, tool, color }),
     events (this station's events, newest last), since(kind) (seconds since the last such event, Infinity if none),
     r(c, color, x, y, w, h) (pixel rect), base().
   Events (StationFX.emit(id, kind, data)): open (player opened its window), near / leave (player walked up / away),
     pay ({ amount, crit, who }), float ({ text }), agent-arrive / agent-start / agent-done ({ who }), night / morning.
   Choosing: ?fx opens a picker (A/B/C/off per station); ?fx=hunt:b,rig:c sets choices. Kept in localStorage. */
(function () {
  'use strict';
  const KEY = 'first-office-fx', reg = {}, log = [], LIFE = 6, BUSY = 2.5;
  let pick = {};
  try { pick = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const q = new URLSearchParams(location.search).get('fx');
  if (q) q.split(',').forEach(p => { const [id, v] = p.split(':'); if (id && v) pick[id] = v; });
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch {} };
  if (q) store();
  const now = () => performance.now() / 1000;
  const r = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  function variant(id) {
    const vs = reg[id]; if (!vs) return null;
    const key = pick[id] || 'a';
    return key === 'off' ? null : vs[key] || null;
  }
  function emit(id, kind, data) {
    log.push({ id, kind, at: now(), data: data || {} });
    while (log.length && now() - log[0].at > LIFE) log.shift();
    if (log.length > 200) log.shift();
    window.Loop?.wake();
  }
  const evs = id => log.filter(e => e.id === id || e.id === '*');
  const since = (id, kind) => { for (let i = log.length - 1; i >= 0; i--) if ((log[i].id === id || log[i].id === '*') && log[i].kind === kind) return now() - log[i].at; return Infinity; };

  // Stage 3 agents: who is walking to or working at each station. Status changes become events.
  const seen = {};
  function crew(id) {
    const A = window.Stage3Agents; if (!A || !window.Stage2?.stage3?.()) return [];
    return A.list().filter(a => a.station === id && (a.status === 'walking' || a.status === 'working'))
      .map(a => ({ id: a.id, name: a.name, status: a.status, tool: a.next?.toolName || null, color: A.roster?.[a.id]?.color || null }));
  }
  function watchCrew() {
    const A = window.Stage3Agents; if (!A || !window.Stage2?.stage3?.()) return;
    A.list().forEach(a => {
      const was = seen[a.id] || {}, here = a.station, st = a.status;
      if (st === 'working' && (was.st !== 'working' || was.at !== here) && here) emit(here, 'agent-start', { who: a.id });
      if (was.st === 'working' && st !== 'working' && was.at) emit(was.at, 'agent-done', { who: a.id });
      if (st === 'walking' && was.st !== 'walking' && here) emit(here, 'agent-arrive', { who: a.id });
      seen[a.id] = { st, at: here };
    });
  }
  let near = null, night = false;

  function draw(c, s, w) {
    const v = variant(s.id); if (!v) return false;
    if (w.near && near !== s.id) { if (near) emit(near, 'leave'); near = s.id; emit(s.id, 'near'); }
    else if (!w.near && near === s.id) { near = null; emit(s.id, 'leave'); }
    const ui = window.Stage2?.ui?.() || {}, T = w.T || 16;
    const k = Object.assign({}, w, {
      x: s.tx * T, y: s.ty * T, w: s.tw * T, h: s.th * T, open: ui.win === s.id, night: !!ui.night,
      agents: crew(s.id), events: evs(s.id), since: kind => since(s.id, kind), r
    });
    try { v.draw(c, k); } catch (e) { console.error('StationFX ' + s.id, e); return false; }
    return true;
  }
  function busy() {
    watchCrew();
    const n = !!window.Stage2?.ui?.()?.night;
    if (n !== night) { night = n; emit('*', n ? 'night' : 'morning'); }
    if (log.length && now() - log[log.length - 1].at < BUSY) return true;
    return Object.keys(reg).some(id => { const v = variant(id); return v && v.busy && v.busy({ t: now(), since: kind => since(id, kind), agents: crew(id) }); });
  }

  // ---------- picker (?fx) ----------
  function picker() {
    const el = document.createElement('div'); el.id = 'fx-picker';
    el.style.cssText = 'position:fixed;left:8px;top:64px;z-index:99;background:#0f1630ee;color:#f1e6c8;font:12px/1.4 var(--mono,monospace);padding:8px;border:1px solid #39445c;max-width:300px';
    const paint = () => {
      el.innerHTML = '<b>Station variants</b>' + Object.keys(reg).map(id => {
        const vs = reg[id], cur = pick[id] || 'a';
        return '<div style="margin-top:4px">' + id + ' ' + Object.keys(vs).concat('off').map(k =>
          '<button data-id="' + id + '" data-v="' + k + '" title="' + (vs[k]?.name || 'original art') + '" style="margin-left:2px;' + (k === cur ? 'background:#c4572b;color:#fff' : '') + '">' + k.toUpperCase() + '</button>').join('') +
          '<div style="opacity:.7">' + (vs[cur]?.name || 'original art') + '</div></div>';
      }).join('');
    };
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.id, b.dataset.v); paint(); });
    document.body.appendChild(el); paint();
  }
  function set(id, v) { pick[id] = v; store(); window.Loop?.wake(); }
  if (q !== null) addEventListener('DOMContentLoaded', () => setTimeout(picker, 0));

  window.StationFX = { add: (id, vs) => { reg[id] = Object.assign(reg[id] || {}, vs); }, draw, busy, emit, set, variant, list: () => reg, choice: id => pick[id] || 'a' };
})();
