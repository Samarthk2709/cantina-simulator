/* The official game: when you're signed in, the server keeps the real save. This page plays every action at once (so
   nothing waits on the network), and every few seconds sends the actions it played to the server, which replays them
   on its own copy with the same engine (server.cjs /api/act). The server answers with a fingerprint of its result; if
   it doesn't match this page's, or the server's copy moved on (another device), the page reloads the server's copy.
   So editing the save in this browser changes nothing that counts: the leaderboard reads the server's copy.
   Guests play locally, as before. Loaded after engine.js and before game.js (index.html only). */
(function () {
  'use strict';
  const E = window.Stage2Engine, GAME = 'first-office-game-v1', VERSION = 'first-office-game-version', EVERY = 4000;
  let on = false, version = 0, queue = [], inflight = false, stopped = false;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const post = async (url, body, beacon) => {
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw Object.assign(new Error('sync ' + r.status), { status: r.status });
    return r.json();
  };
  // Every engine action on the live save is queued (engine.js calls record for each, with the agent context if any).
  const prev = E.record;
  E.record = (s, a, r) => {
    if (on && !stopped && window.Stage2 && s === window.Stage2.state()) queue.push(JSON.parse(JSON.stringify(a)));
    if (prev) prev(s, a, r);
  };
  async function flush(beacon) {
    if (!on || stopped || inflight || !queue.length) return;
    const actions = queue.splice(0), mine = E.digest(window.Stage2.state());
    if (beacon) { post('/api/act', { version, actions }, true); return; }
    inflight = true;
    try {
      const r = await post('/api/act', { version, actions });
      if (r.conflict || r.digest !== mine) return resync(r);
      version = r.version; ls.set(VERSION, String(version));
    } catch (e) { if (e.status === 401) { stopped = true; return; } queue.unshift(...actions); } // offline: try again
    finally { inflight = false; }
  }
  // The server's copy wins: take it and reload, with nothing written back from this page on the way out.
  function resync(r) {
    stopped = true;
    if (r && r.state) { ls.set(GAME, JSON.stringify(r.state)); ls.set(VERSION, String(r.version)); }
    window.Stage2?.freeze?.();
    location.reload();
  }
  // A new game, or the ready-made chapter 3 save, is made by the server; the page then reloads into it.
  async function newGame(mode, profile) {
    const r = await post('/api/game/new', { mode, profile });
    if (r.state) { ls.set(GAME, JSON.stringify(r.state)); ls.set(VERSION, String(r.version)); } else { try { localStorage.removeItem(GAME); localStorage.removeItem(VERSION); } catch {} }
    stopped = true; return r;
  }
  if (window.Auth) window.Auth.ready.then(() => {
    if (!window.Auth.user) return; // guest: local only
    on = true; version = +ls.get(VERSION) || 0;
    setInterval(() => flush(), EVERY);
    addEventListener('pagehide', () => flush(true));
  });
  window.Sync = { get on() { return on; }, flush, newGame };
})();
