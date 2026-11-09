/* The official game: when you're signed in, the server keeps the real save. This page plays every action at once (so
   nothing waits on the network), and every few seconds sends the actions it played to the server, which replays them
   on its own copy with the same engine (server.cjs /api/act). The server answers with a fingerprint of its result; if
   it doesn't match this page's, or the server's copy moved on (another device), the page reloads the server's copy.
   So editing the save in this browser changes nothing that counts: the leaderboard reads the server's copy.
   Guests play locally, as before. Loaded after engine.js and before game.js (index.html only). */
(function () {
  'use strict';
  const E = window.Stage2Engine, GAME = 'first-office-game-v1', VERSION = 'first-office-game-version', PENDING = 'first-office-pending-act', EVERY = 4000;
  const pkey = () => PENDING + ':' + account; // one per account: another account signing in here can't overwrite them
  let on = false, account = null, version = 0, queue = [], inflight = null, sending = null, stopped = false; // sending: the batch on its way {version, id, actions}
  const MAX = 300; // the server takes at most this many actions per request (server.cjs playActions)
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
  // A batch the server may or may not have applied (sending: on its way; retry: its answer was lost) keeps its id and
  // base version on every re-send, with newer actions added on the end: the server applies only the part it hasn't
  // (server.cjs playActions). Nothing is lost and nothing is applied twice, however many re-sends it takes.
  const newId = () => Math.random().toString(36).slice(2, 12);
  const batch = (prev, more) => prev ? { version: prev.version, id: prev.id, day: prev.day, account: prev.account || account, actions: prev.actions.concat(more) } : { version, id: newId(), day: window.Stage2?.state()?.realDay || undefined, account, actions: more }; // account: whose moves these are (server.cjs refuses them for another) // day: as the page loaded it (server.cjs calendar)
  // Everything not yet confirmed, kept in localStorage for the next load to post first (auth.js postPending): beacons can be
  // refused (64 KB per page) or land after the next page loaded, and a tab handing over to another sends nothing more.
  // Not once stopped (another tab has the game, or this account left): its key may hold newer moves by then. force: sign-out
  // failed after stopping (auth.js signOut), so this page's moves are still the newest.
  function park(force) {
    const prev = sending || retry;
    if (!on || (stopped && !force) || (!queue.length && !prev)) return null;
    const body = batch(prev, queue.splice(0)); retry = body;
    ls.set(pkey(), JSON.stringify({ account, body })); return body;
  }
  // Resolves to true once everything queued so far has gone up: callers that leave the page wait on it, even when a
  // send was already on its way.
  function flush(beacon) {
    if (beacon) {
      if (stopped) return;
      const body = park(); if (!body) return;
      post('/api/act', { ...body, actions: body.actions.slice(0, MAX) }, true); return; // what fits in one request, under the same id
    }
    return (inflight || (inflight = send().finally(() => { inflight = null; }))).then(() => !queue.length && !retry);
  }
  let retry = null;
  async function send() {
    while (on && !stopped && (queue.length || retry)) {
      if (!window.Stage2) return; // the game is still loading (game.js): nothing to fingerprint yet, so keep everything for the next send
      const prev = retry; retry = null;
      const body = batch(prev, queue.splice(0, MAX - (prev ? prev.actions.length : 0))), mine = queue.length ? null : E.digest(window.Stage2.state()); // the fingerprint is the end state's
      try {
        sending = body;
        const r = await post('/api/act', body);
        if (r.conflict || (mine && r.digest !== mine)) return resync(r);
        version = r.version; if (stopped) return; ls.set(VERSION, String(version)); // stopped: another tab has the game; its version stands
        if (!queue.length && !retry) try { if (JSON.parse(ls.get(pkey()))?.body?.id === body.id) localStorage.removeItem(pkey()); } catch {} // our batch is all up: our copy kept for a crash can go (another tab's stays)
      } catch (e) {
        if (e.status === 401) { if (stopped) return; retry = body; park(); return resync(null); } // signed out elsewhere or expired: set the moves aside (posted after signing back in), then the sign-in card
        if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) return resync(null); // refused for good: the server's copy wins
        // Offline, the server is down, or the answer was lost: re-sent next time (see batch). A copy goes to localStorage now,
        // since a tab killed while hidden (or a crash) never gets its pagehide. retry may already be a longer copy (pagehide's park).
        retry = retry && retry.id === body.id ? retry : body; if (!stopped) ls.set(pkey(), JSON.stringify({ account, body: batch(retry, queue) })); return;
      } finally { sending = null; }
    }
  }
  // The server's copy wins: take it and reload, with nothing written back from this page on the way out.
  function resync(r) {
    if (window.Stage2?.frozen?.()) { stopped = true; return; } // another tab has the game (game.js elsewhere): don't reload over it
    stopped = true;
    if (r && r.state) { ls.set(GAME, JSON.stringify(r.state)); ls.set(VERSION, String(r.version)); }
    window.Stage2?.freeze?.();
    location.reload();
  }
  // A new game, or the ready-made chapter 3 save, is made by the server; the page then reloads into it.
  async function newGame(mode, profile) {
    let r; try { r = await post('/api/game/new', { mode, profile, account }); } catch (e) { if (e.status === 401) { park(); stopped = true; } throw e; } // 401: this browser's account changed (newRun then reloads)
    if (r.state) { ls.set(GAME, JSON.stringify(r.state)); ls.set(VERSION, String(r.version)); } else { try { localStorage.removeItem(GAME); localStorage.removeItem(VERSION); } catch {} }
    stopped = true; return r;
  }
  if (window.Auth) window.Auth.ready.then(() => {
    if (!window.Auth.user) return; // guest: local only
    on = true; account = window.Auth.user.id; version = +ls.get(VERSION) || 0; // account: kept, since sign-out clears Auth.user before the page leaves
    // Moves the last page left behind that the load couldn't post (auth.js loadGame kept this browser's save): they go up
    // first, under their own batch id, so a copy that did land isn't applied twice.
    try { const p = JSON.parse(ls.get(pkey())); if (version && p && p.account === window.Auth.user.id && p.body?.actions?.length) { retry = { version: p.body.version, id: p.body.id, day: p.body.day, actions: p.body.actions.slice(0, MAX) }; queue.unshift(...p.body.actions.slice(MAX)); } } catch {}
    addEventListener('pageshow', e => { if (e.persisted && !stopped) { stopped = true; location.reload(); } }); // back from the page cache: this copy is stale, and its moves already went up as it left
    setInterval(() => flush(), EVERY);
    addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }); // switching away (often to a new tab): send now
  });
  window.Sync = { get on() { return on; }, get stopped() { return stopped; }, get version() { return version; }, get idle() { return !queue.length && !sending && !retry; }, park, flush, newGame, stop: () => { stopped = true; } };
})();
