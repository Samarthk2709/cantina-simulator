/* Session log: everything a player does in one tab, for understanding play and debugging. Always on.
   - Every click (what was clicked and where), game shortcut keys, changed settings, windows opened and closed.
   - Every engine action on the live save (hunts, purchases, sleeps, ...) and whether the engine refused it.
   - Everything said: the player's messages to Nib and the agents, their replies, and each AI request and answer.
   - Every /api call (status and time), JS errors, rejected promises, console errors and warnings, page loads and hides.
   Events are batched and sent every 10 s (and on hide) to POST /api/log; the server files them under this tab's
   session id. Read them with: node scripts/sessions.cjs. Password fields are never read.
   Other code adds its own events with SessionLog.event(type, data). Loaded first, without defer. */
(function () {
  'use strict';
  const EVERY = 10000, BATCH = 100;
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24);
  const keep = (st, k) => { try { let v = st.getItem(k); if (!v) st.setItem(k, v = rid()); return v; } catch { return rid(); } };
  const session = keep(sessionStorage, 'first-office-session'), browser = keep(localStorage, 'first-office-browser');
  const clip = (v, n = 300) => { v = typeof v === 'string' ? v : v == null ? '' : String(v); v = v.replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };
  // Objects (engine args, AI bodies) stay as JSON unless they're big, then they become a clipped string.
  const small = (v, n = 2000) => { try { const j = JSON.stringify(v); return j && j.length > n ? j.slice(0, n) + '…' : v; } catch { return String(v); } };
  let q = [], seq = 0;

  function event(type, data) {
    q.push({ t: Date.now(), type, ...(data || {}) });
    if (q.length >= BATCH) send();
  }
  // A snapshot of the game with each batch, so every event can be read against the state it happened in.
  function ctx() {
    try {
      const g = window.Stage2?.state?.(); if (!g) return null;
      return { chapter: g.stage === 3 ? 3 : 2, day: g.day, cash: Math.round(g.cash), rep: g.rep, bugs: g.bugs, crits: g.crits, win: window.Stage2.ui?.().win || null, team: document.body?.classList.contains('s3-agents-open') || false };
    } catch { return null; }
  }
  // budget: on leaving, the log's beacons stay small so the game's own (sync.js) fits Chrome's 64 KB for all of a page's beacons.
  function send(budget = Infinity) {
    while (q.length && budget > 0) {
      const body = JSON.stringify({ session, browser, seq: seq++, page: location.pathname, ctx: ctx(), events: q.splice(0, BATCH) }); budget -= body.length;
      if (budget < 0) break; // leaving: too big for what's left, dropped
      try { navigator.sendBeacon ? navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' })) : fetch('/api/log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }); } catch {}
    }
  }

  // ---------- what was clicked ----------
  function describe(el) {
    if (!el || !el.closest) return {};
    const t = el.closest('button,a,[role=button],[data-station],[data-agent],input,select,textarea,label,summary,[tabindex],canvas') || el;
    const text = t.tagName === 'INPUT' && !/^(button|submit|checkbox|radio)$/.test(t.type) ? t.placeholder || t.name : t.getAttribute('aria-label') || t.title || t.innerText || t.value || t.alt;
    const cls = typeof t.className === 'string' ? t.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(c => '.' + c).join('') : '';
    const data = {}; for (const k in t.dataset || {}) if (Object.keys(data).length < 4) data[k] = clip(t.dataset[k], 40);
    return { el: t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + cls, text: clip(text, 80), ...(Object.keys(data).length ? { data } : {}) };
  }
  addEventListener('click', e => event('click', { ...describe(e.target), x: Math.round(e.clientX), y: Math.round(e.clientY) }), true);
  addEventListener('keydown', e => {
    if (e.repeat) return;
    const field = e.target.closest?.('input,textarea,select,[contenteditable]');
    if (field && !['Enter', 'Escape', 'Tab'].includes(e.key)) return; // typing itself isn't logged; what was sent is
    event('key', { key: e.key, mods: (e.metaKey ? '⌘' : '') + (e.ctrlKey ? '^' : '') + (e.altKey ? '⌥' : '') + (e.shiftKey ? '⇧' : '') || undefined, ...(field ? { in: describe(field).el } : {}) });
  }, true);
  addEventListener('change', e => {
    const t = e.target; if (!t || !/^(checkbox|radio|range|select-one|color)$/.test(t.type)) return; // text is logged where it's sent, never as typed
    event('change', { ...describe(t), value: t.type === 'checkbox' || t.type === 'radio' ? t.checked : t.value });
  }, true);

  // ---------- page life and errors ----------
  event('page', { url: location.pathname + location.search, ref: clip(document.referrer, 120), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: clip(navigator.userAgent, 160), lang: navigator.language });
  addEventListener('visibilitychange', () => { event(document.hidden ? 'hidden' : 'visible'); if (document.hidden) send(); });
  addEventListener('pagehide', () => { event('leave'); send(12000); });
  addEventListener('error', e => {
    if (e.target && e.target !== window) return event('error', { what: 'resource', src: clip(e.target.src || e.target.href, 160) });
    event('error', { what: 'js', msg: clip(e.message, 300), at: clip(String(e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno, 80), stack: clip(e.error?.stack, 800) });
  }, true);
  addEventListener('unhandledrejection', e => event('error', { what: 'promise', msg: clip(e.reason?.message || e.reason, 300), stack: clip(e.reason?.stack, 800) }));
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = function (...a) { event('console', { level, msg: clip(a.map(x => x instanceof Error ? x.stack || x.message : typeof x === 'object' ? JSON.stringify(small(x, 300)) : String(x)).join(' '), 600) }); return orig.apply(this, a); };
  }

  // ---------- server calls; AI calls keep what was sent and what came back ----------
  const AI = /^\/api\/(nib\/chat|agents\/(brief|say))$/;
  const json = b => { try { return typeof b === 'string' ? JSON.parse(b) : undefined; } catch { return clip(b, 500); } };
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    let path; try { path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch {}
    if (!path || !path.startsWith('/api/')) return _fetch.apply(this, arguments);
    const t0 = performance.now(), method = (init && init.method) || 'GET';
    try {
      const r = await _fetch.apply(this, arguments), e = { path, method, status: r.status, ms: Math.round(performance.now() - t0) };
      if (AI.test(path)) r.clone().json().then(res => event('ai', { ...e, req: small(json(init && init.body), 3000), res: small(res, 2000) }), () => event('ai', { ...e, req: small(json(init && init.body), 3000) }));
      else if (path === '/api/act') r.clone().json().then(b => event('api', { ...e, conflict: !!b.conflict, version: b.version }), () => event('api', e));
      else event('api', e);
      return r;
    } catch (err) { event('api', { path, method, error: clip(err.message, 200), ms: Math.round(performance.now() - t0) }); throw err; }
  };

  // ---------- engine actions on the live save (after the deferred scripts, so sync.js's hook is already in place) ----------
  document.addEventListener('DOMContentLoaded', () => {
    const E = window.Stage2Engine; if (!E) return;
    const prev = E.record;
    E.record = (s, a, r) => {
      if (!window.Stage2 || s === window.Stage2.state()) event('action', { fn: a.fn, args: small(a.args, 600), ...(a.actor ? { actor: a.actor } : {}), ...(r && r.ok === false ? { refused: clip(r.why, 160) } : {}) });
      if (prev) prev(s, a, r);
    };
  });

  setInterval(send, EVERY);
  window.SessionLog = { event, send, session, browser };
})();
