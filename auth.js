/* Accounts and the cloud save. Loaded first on both pages; the game waits for Auth.ready.
   - The gate: sign in or create an account (username + password), or Google when the server has a GOOGLE_CLIENT_ID.
     A new Google account picks a username first. Auth.ready resolves once you're in (with a username) or playing as a guest.
   - Signed in: your save follows your account. On load the newer of this browser's save and the cloud's wins; after
     that every change is pushed (checked every 5 s, and on leaving the page).
   - Another account signed in on this browser: its local save is cleared first, so saves never mix between accounts.
   - "Play without an account": local only, nothing posted to the leaderboard.
   - Server unreachable: no gate, the game runs locally. */
(function () {
  'use strict';
  // The game itself lives on the server (/api/game, sync.js); these are the page's own extras, kept with the account.
  const KEYS = ['first-office-crew-v1', 'first-office-nib-v1', 'first-office-avatar-v1', 'first-office-look-v1'];
  const GAME = 'first-office-game-v1', GAME_VERSION = 'first-office-game-version', PENDING = 'first-office-pending-act', ALL = KEYS.concat(GAME, GAME_VERSION);
  const pk = () => PENDING + ':' + (user && user.id); // each account's unsent moves (sync.js), kept across sign-ins on this browser
  const ACCOUNT = 'first-office-account', SYNCED = 'first-office-synced-at', SYNCED_KEYS = 'first-office-synced-keys', GUEST = 'first-office-guest';
  const NAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
  const json = async (url, o) => { const r = await fetch(url, { credentials: 'same-origin', ...o, headers: { 'Content-Type': 'application/json', ...(o && o.headers) } }); const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || 'Something went wrong. Try again.'), { status: r.status }); return b; };
  const post = (url, body) => json(url, { method: 'POST', body: JSON.stringify(body) });
  const snapshot = () => { const keys = {}; for (const k of KEYS) { const v = ls.get(k); if (v != null) keys[k] = v; } return keys; };
  const localAt = () => +ls.get(SYNCED) || 0;
  const syncedKeys = () => { try { return JSON.parse(ls.get(SYNCED_KEYS)) || {}; } catch { return {}; } };

  let user = null, cfg = null, lastPushed = '', base = localAt(), done; // base: the cloud save this browser last saw (kept in memory too, in case storage is full)
  const ready = new Promise(r => { done = r; });

  function markSynced(at, keys) { base = at; ls.set(SYNCED, String(at)); ls.set(SYNCED_KEYS, JSON.stringify(keys)); }
  // Two devices on one account: keys changed here since the last sync stay, the rest come from the cloud.
  // Returns true when a key this page holds in memory changed under it (the page must reload).
  function merge(cloud) {
    const was = syncedKeys(), fresh = !localAt() || ls.get(SYNCED_KEYS) == null; let stale = false; // no snapshot (an older version, or storage full): the cloud wins
    for (const k of KEYS) {
      const mine = ls.get(k) ?? undefined, theirs = cloud.keys[k] ?? undefined;
      if (mine === theirs || (fresh ? theirs === undefined : mine !== was[k])) continue; // the same, or changed here: keep
      if (theirs === undefined) ls.del(k); else ls.set(k, theirs);
      if (k !== 'first-office-avatar-v1') stale = true;
    }
    markSynced(cloud.at, cloud.keys);
    return stale;
  }
  const mine = () => user && ls.get(ACCOUNT) === user.id; // re-checked after every wait: another tab may have signed another account in meanwhile
  async function push(beacon, retried) {
    if (!mine()) return; // another account signed in on this browser (another tab): this page's copy isn't theirs
    const keys = snapshot(), key = JSON.stringify(keys); if (key === lastPushed || key === ls.get(SYNCED_KEYS) || !Object.keys(keys).length) return; // nothing new, or nothing yet
    const body = JSON.stringify({ base, account: user.id, keys });
    if (beacon) { if (navigator.sendBeacon && body.length < 16000) navigator.sendBeacon('/api/save', new Blob([body], { type: 'application/json' })); return; } // a big one waits: the next load merges and sends it (and the game's beacon must fit Chrome's 64 KB)
    try {
      const r = await json('/api/save', { method: 'POST', body });
      if (!mine()) return;
      if (r.conflict) { // another device saved since: merge, then send what this device changed
        const stale = merge(r.save);
        if (stale) window.Stage2?.freeze?.(); // this page's copy is old: nothing more from it, but what it changed goes up first
        if (!retried) await push(false, true);
        if (stale) { user = null; location.reload(); }
        return;
      }
      lastPushed = key; markSynced(r.at, keys);
    } catch (e) { if (e.status === 401 && user) { user = null; window.Stage2?.freeze?.(); window.Sync?.park?.(); window.Sync?.stop(); location.reload(); } } // signed out, or another account's now: nothing of this page's goes up
  }
  async function pull() {
    const r = await json('/api/save').catch(() => null);
    if (!r || !mine()) return; // the cloud can't be read: don't overwrite it blind
    if (r.save && r.save.at !== localAt()) merge(r.save); // before the game boots: nothing in memory yet
    await push();
  }
  // Signed in. No username yet: ask for one. Otherwise: take over this browser's save and start.
  async function enter(u) {
    if (!u.name) return gate('name');
    if (ls.get(ACCOUNT) && ls.get(ACCOUNT) !== u.id) { for (const k of ALL.concat(SYNCED, SYNCED_KEYS)) ls.del(k); base = 0; } // someone else's save (their unsent moves stay under their own key)
    else if (!ls.get(ACCOUNT)) { // a guest signing in: the guest game doesn't carry over; Stage 1 and the look picked there do (not guest-earned unlocks)
      let look = null; try { look = JSON.parse(ls.get('first-office-look-v1'))?.look || null; } catch {}
      for (const k of ALL.concat(SYNCED, SYNCED_KEYS)) if (k !== 'first-office-nib-v1') ls.del(k);
      if (look) ls.set('first-office-look-v1', JSON.stringify({ look, earned: [] }));
    }
    ls.set(ACCOUNT, u.id); ls.del(GUEST); user = { id: u.id, name: u.name, email: u.email || '', picture: u.picture || '' };
    await pull();
    await loadGame();
    if (!mine()) return; // another tab changed the account meanwhile: stay behind its note (storage handler)
    setInterval(() => window.Stage2?.frozen?.() || push(), 5000); // a tab another tab took over sends nothing
    addEventListener('pagehide', () => push(true));
    // Stage 1 already done on another device: go to the office.
    if (location.pathname.endsWith('/meet.html') && ls.get('first-office-game-v1')) { location.replace('/'); return; }
    close(); done();
  }
  // The server's copy of the game is the real one: it always replaces this browser's. No game yet, but Stage 1 is done
  // (the office is next): the server starts one.
  // The moves the last page saved as it left (sync.js): the first 300 under the batch's own id (the beacon may have
  // landed them: the server then applies only what it hasn't), the rest in fresh batches. Kept until posted: a failed
  // post leaves what's left for the next load; a refusal (the server moved on) drops it.
  async function postPending(p) {
    // Another tab may set moves aside meanwhile: the key is only rewritten or cleared while it still holds what this tab read.
    const K = pk(); let b = p.body, mine = ls.get(K);
    const put = v => { if (ls.get(K) !== mine) return; if (v == null) ls.del(K); else ls.set(K, mine = v); };
    let last = null; // the server's last answer: its version is this browser's from now on
    while (b.actions.length) {
      let r, fatal = false;
      for (let t = 0; t < 3 && !r && !fatal; t++) { // a blip: try again before the game loads without these moves
        if (t) await new Promise(ok => setTimeout(ok, 800 * t));
        try { r = await post('/api/act', { version: b.version, id: b.id, day: b.day, account: p.account, actions: b.actions.slice(0, 300) }); }
        catch (e) { fatal = e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status); } // 401: signed out meanwhile, kept for the next sign-in
      }
      if (fatal) break;
      if (!r) return false; // still unreachable: kept (PENDING); sync.js sends it once the network is back
      if (r.conflict) break;
      last = r;
      b = { version: r.version, id: Math.random().toString(36).slice(2, 12), day: b.day, actions: b.actions.slice(300) };
      put(JSON.stringify({ ...p, body: b }));
    }
    put(null); return last || true;
  }
  // Another tab signed a different account in on this browser, or signed out: this page's account is gone. Nothing of
  // its goes up any more (moves set aside under its own key); it waits behind a note with a Reload button rather than
  // reloading by itself, so it doesn't take the game from the tab being used.
  addEventListener('storage', e => {
    if (e.key !== ACCOUNT || e.newValue === (user && user.id) || !(user || e.newValue)) return;
    user = null; window.Stage2?.freeze?.(); window.Sync?.park?.(); window.Sync?.stop();
    document.querySelectorAll('dialog[open]').forEach(d => d.close()); close(); // a modal or the sign-in card would cover the note
    if (document.getElementById('other-tab')) return;
    if (!document.getElementById('acct-note-css')) { const st = document.createElement('style'); st.id = 'acct-note-css'; st.textContent = '#other-tab{position:fixed;inset:0;z-index:10002;display:grid;place-items:center;background:rgba(6,12,16,.82)}#other-tab>div{display:grid;gap:14px;justify-items:center;padding:24px 28px;border-radius:12px;background:#10202a;color:#e8f0f4;font:16px/1.4 system-ui,sans-serif}#other-tab button{font:inherit;padding:8px 16px;border-radius:8px;cursor:pointer;background:#7ff0d8;color:#0b1a1f;border:0}'; document.head.appendChild(st); } // meet.html has no style.css
    const d = document.createElement('div'); d.id = 'other-tab';
    d.innerHTML = `<div><b>${e.newValue ? 'Another account signed in on this browser.' : 'You signed out in another tab.'}</b><button class="accent">Reload</button></div>`;
    d.addEventListener('click', ev => { if (ev.target.closest('button')) location.reload(); }); document.body.appendChild(d); noteOnly(d);
  });
  // A note that covers the page: everything behind it is inert, focus stays on its button, Enter or Space presses it.
  function noteOnly(d) {
    for (const el of document.body.children) if (el !== d) el.inert = true;
    const b = d.querySelector('button'); requestAnimationFrame(() => b?.focus()); d.addEventListener('mousedown', e => { if (e.target !== b) e.preventDefault(); }); // a click on the backdrop keeps focus on the button
    addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); b?.focus(); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b?.click(); } }, true);
  }
  window.Auth_noteOnly = noteOnly;
  async function loadGame() {
    let posted = null;
    // Moves the last page sent by beacon as it left (sync.js): post them before reading the game. Already applied: the server refuses the copy.
    try {
      const old = JSON.parse(ls.get(PENDING)); if (old && old.account === user.id && !ls.get(pk())) ls.set(pk(), JSON.stringify(old)); if (old && old.account === user.id) ls.del(PENDING); // the single key of earlier versions
      const p = JSON.parse(ls.get(pk()));
      if (p && p.account === user.id) {
        posted = await postPending(p); if (!posted) { // not posted yet: keep this browser's save (it has those moves) if they can still land on the server's
          const body = JSON.parse(ls.get(pk()))?.body, g = await json('/api/game').catch(() => null);
          if (!g || g.version === body?.version || (g.lastId === body?.id && g.version > body?.version)) return; // untouched, or only our batch landed (once or more: a re-send adds its tail)
          if (JSON.parse(ls.get(pk()))?.body?.id === body?.id) ls.del(pk()); // the server moved on without them (another device): its copy wins
        }
      }
    } catch { ls.del(pk()); }
    let g = await json('/api/game').catch(() => null);
    if (!mine()) return;
    if (!g && posted?.version && ls.get(GAME)) { ls.set(GAME_VERSION, String(posted.version)); return; } // the game couldn't be read, but our moves just landed: this browser's save has them, at that version
    if (g && !g.state && !location.pathname.endsWith('/meet.html')) {
      let intro = {}; try { intro = JSON.parse(ls.get('first-office-nib-v1') || '{}'); } catch {}
      // Failed or its answer lost: read the game back (it may have been made), else ask once more, so a throwaway local game isn't started.
      const make = () => post('/api/game/new', { mode: 'fresh', account: user.id, profile: { playerName: intro.playerName, nibName: intro.nibName, facts: intro.facts } }).catch(() => json('/api/game').catch(() => g));
      if (intro.completedAt) { g = await make(); if (!g?.state && mine()) g = await make(); } // account: the server refuses it for another account signed in meanwhile
    }
    if (!mine()) return;
    if (g && g.state) { ls.set(GAME, JSON.stringify(g.state)); ls.set(GAME_VERSION, String(g.version)); }
    else if (g) { ls.del(GAME); ls.del(GAME_VERSION); }
  }
  // Playing without an account on a browser an account used (its session ended): start clean, so its game and Nib's memory
  // aren't shown, and guest changes don't reach its cloud save later. Its unsent moves stay under its own key.
  function guest() { if (ls.get(ACCOUNT)) for (const k of ALL.concat(SYNCED, SYNCED_KEYS, ACCOUNT)) ls.del(k); ls.set(GUEST, '1'); close(); done(); }

  // ---------- the gate ----------
  let box = null, mode = 'login', unshut = null;
  // While this window is open, the page behind it can't be tabbed to or clicked (inert); returns the undo.
  // The ending's #modal stays live: shown meanwhile, it opens above this window and must work.
  const shut = box => { const off = [...document.body.children].filter(el => el !== box && !el.inert && el.id !== 'modal'); off.forEach(el => { el.inert = true; }); return () => off.forEach(el => { el.inert = false; }); };
  // Google's button is an iframe: with the page dark, Chrome paints it an opaque white box unless the frame's colour
  // scheme matches its light document. Light here makes it transparent, so the pill sits on the card.
  const CSS = `#auth-gate #auth-google iframe{color-scheme:light}
#auth-gate{--ink:#e8efe8;--muted:#9fb3ba;--line:#2e4b58;--line-2:#2e4b58;--nib:#7ff0d8;--nib-ink:#0b1a1f;--mono:ui-monospace,Menlo,monospace}
#auth-gate{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(24,48,58,.96),rgba(8,16,20,.98));font-family:system-ui,sans-serif}
#auth-gate .auth-card{display:grid;gap:14px;width:min(360px,88vw);padding:28px 26px;border:1px solid var(--line-2,#2e4b58);border-radius:16px;background:rgba(14,30,38,.92);color:#e8efe8;box-shadow:0 24px 60px rgba(0,0,0,.45)}
#auth-gate .auth-title{font:700 14px var(--mono,monospace);letter-spacing:.32em;text-align:center}
#auth-gate p{margin:0;font-size:13px;line-height:1.45;color:var(--muted,#9fb3ba);text-align:center}
#auth-gate .auth-tabs{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line-2,#2e4b58);border-radius:9px;overflow:hidden}
#auth-gate .auth-tabs button{all:unset;cursor:pointer;padding:8px 0;text-align:center;font-size:13px;color:var(--muted,#9fb3ba)}
#auth-gate .auth-tabs button[aria-selected=true]{background:#1d3a46;color:var(--ink,#e8efe8);font-weight:600}
#auth-gate form{display:grid;gap:10px}
#auth-gate label{display:grid;gap:4px;font-size:12px;color:var(--muted,#9fb3ba)}
#auth-gate input{padding:9px 10px;border:1px solid var(--line-2,#2e4b58);border-radius:8px;background:#0b181e;color:var(--ink,#e8efe8);font:14px system-ui,sans-serif}
#auth-gate input:focus-visible,#auth-gate button:focus-visible{outline:2px solid var(--nib,#7ff0d8);outline-offset:2px}
#auth-gate .auth-go{padding:10px;border:0;border-radius:8px;background:var(--nib,#7ff0d8);color:var(--nib-ink,#0d2f33);font:600 14px system-ui,sans-serif;cursor:pointer}
#auth-gate .auth-go:disabled{opacity:.6;cursor:wait}
#auth-gate .auth-hint{font-size:11px;color:var(--muted,#9fb3ba)}
#auth-gate .auth-msg{color:#ff9d8a;font-size:13px;text-align:center}
#auth-gate .auth-msg:empty{display:none}
#auth-gate #auth-google{display:flex;justify-content:center;min-height:44px}
#auth-gate .auth-or{font-size:11px;text-align:center;color:var(--muted,#9fb3ba);letter-spacing:.2em}
#auth-gate .auth-link{all:unset;cursor:pointer;justify-self:center;font-size:12px;color:var(--muted,#9fb3ba);text-decoration:underline}
#auth-gate .auth-legal{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--muted,#9fb3ba)}
#auth-gate .auth-legal a{color:inherit;text-underline-offset:3px}
#auth-gate .auth-legal a:focus-visible{outline:2px solid var(--nib);outline-offset:3px}`;
  const legalLinks = '<nav class="auth-legal" aria-label="Game information"><a href="/about.html" target="_blank" rel="noopener">About</a><a href="/privacy.html" target="_blank" rel="noopener">Privacy</a><a href="/terms.html" target="_blank" rel="noopener">Terms</a></nav>';
  const html = m => m === 'name'
    ? `<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-h"><b class="auth-title">FIRST OFFICE</b><p id="auth-h">Choose your username. It's your name on the leaderboard.</p>
<form id="auth-form" novalidate><label>Username<input id="auth-user" name="username" autocomplete="username" maxlength="16" required></label><span class="auth-hint">3–16 letters, numbers or _</span>
<p class="auth-msg" role="alert"></p><button class="auth-go" type="submit">Continue</button></form>
<button class="auth-link" type="button" data-act="other">Use another account</button>${legalLinks}</div>`
    : `<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-h"><b class="auth-title">FIRST OFFICE</b><p id="auth-h">Sign in to save your company to your account and join the leaderboard.${ls.get(GAME) && !ls.get(ACCOUNT) ? ' Your account plays its own game: this browser\'s guest game doesn\'t carry over.' : ''}</p>
<div class="auth-tabs" role="tablist"><button type="button" role="tab" data-act="login" aria-selected="${m === 'login'}">Sign in</button><button type="button" role="tab" data-act="signup" aria-selected="${m === 'signup'}">Create account</button></div>
<form id="auth-form" novalidate><label>Username<input id="auth-user" name="username" autocomplete="username" maxlength="16" required></label>${m === 'signup' ? '<span class="auth-hint">3–16 letters, numbers or _</span>' : ''}
<label>Password<input id="auth-pass" name="password" type="password" autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" maxlength="200" required></label>${m === 'signup' ? '<span class="auth-hint">At least 8 characters</span>' : ''}
<p class="auth-msg" role="alert"></p><button class="auth-go" type="submit">${m === 'signup' ? 'Create account' : 'Sign in'}</button></form>
${cfg.clientId ? '<span class="auth-or">OR</span><div id="auth-google"></div>' : ''}
<button class="auth-link auth-guest" type="button" data-act="guest">Play without an account</button>${m === 'signup' ? '<p class="auth-hint">By creating an account, you agree to the Terms of service.</p>' : ''}${legalLinks}</div>`;

  function gate(m) {
    mode = m;
    if (!box) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      box = document.createElement('div'); box.id = 'auth-gate'; document.body.appendChild(box); unshut = shut(box);
      box.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'guest') guest();
        else if (act === 'login' || act === 'signup') { if (act !== mode) { const name = box.querySelector('#auth-user').value; gate(act); box.querySelector('#auth-user').value = name; } }
        else if (act === 'other') post('/api/auth/logout', {}).then(() => gate('login'), () => say('Couldn\'t sign out. Try again.'));
      });
      box.addEventListener('submit', e => { e.preventDefault(); submit(); });
    }
    box.innerHTML = html(m);
    box.querySelector('#auth-user').focus();
    if (m !== 'name' && cfg.clientId) loadGoogle().then(() => {
      const el = box && box.querySelector('#auth-google'); if (!el) return;
      window.google.accounts.id.initialize({ client_id: cfg.clientId, callback: onCredential, ux_mode: 'popup' });
      window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    }).catch(() => say('Google sign-in could not load. Use a username and password, or play without an account.'));
  }
  function close() { if (box) box.remove(); box = null; unshut?.(); unshut = null; }
  const say = m => { const el = box && box.querySelector('.auth-msg'); if (el) el.textContent = m; };

  async function submit() {
    const name = box.querySelector('#auth-user').value.trim(), pass = box.querySelector('#auth-pass')?.value || '';
    if (mode !== 'login' && !NAME_RE.test(name)) return say('Usernames are 3–16 letters, numbers or _.');
    if (mode === 'login' && (!name || !pass)) return say('Enter your username and password.');
    if (mode === 'signup' && pass.length < 8) return say('Passwords need at least 8 characters.');
    const btn = box.querySelector('.auth-go'); btn.disabled = true; say('');
    try {
      const out = await post('/api/auth/' + (mode === 'name' ? 'username' : mode), mode === 'name' ? { username: name } : { username: name, password: pass });
      await enter(out.user);
    } catch (e) { say(e.message); if (box) { btn.disabled = false; box.querySelector(mode === 'login' && e.status === 401 ? '#auth-pass' : '#auth-user')?.focus(); } }
  }
  function loadGoogle() {
    if (window.google && window.google.accounts) return Promise.resolve();
    return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }
  async function onCredential(r) {
    say('Signing in…');
    try { const out = await post('/api/auth/google', { credential: r.credential }); await enter(out.user); }
    catch (e) { say(e.status === 401 ? 'That sign-in didn\'t check out. Try again.' : 'Sign-in failed. Try again.'); }
  }

  async function start() {
    try { cfg = await json('/api/auth/config'); } catch { cfg = null; return done(); } // no server: local play
    try { const me = await json('/api/auth/me'); if (me.user) return enter(me.user); } catch {}
    if (ls.get(GUEST)) return done();
    gate('login');
  }
  async function signOut() {
    await push();
    if (window.Sync?.on && !await window.Sync.flush() && !confirm('Your last moves haven\'t reached the server yet. Sign out anyway and lose them?')) return; // the last moves go up while still signed in
    window.Stage2?.freeze?.(); window.Sync?.stop(); // committed: nothing writes the old save back or sets moves aside while it's cleared
    try { await post('/api/auth/logout', {}); } catch { window.Sync?.park?.(true); alert('Couldn\'t sign out: the server didn\'t answer. Try again.'); location.reload(); return; } // the session cookie is the server's to clear: still signed in
    forget();
  }
  // This browser forgets the account (after sign-out, or once the account is deleted): the next person starts clean.
  function forget() {
    window.Sync?.stop(); // nothing is set aside again as the page leaves
    for (const k of ALL.concat(SYNCED, SYNCED_KEYS, ACCOUNT, pk())) ls.del(k); user = null; base = 0; // this account's unsent moves go; another account's stay under their key
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch {}
    location.href = '/meet.html';
  }
  function signIn() { ls.del(GUEST); location.reload(); }

  // Auth.user: { id, name (the username), email, picture } once signed in; null as a guest.
  window.Auth = { ready, get user() { return user; }, get configured() { return !!cfg; }, get google() { return !!(cfg && cfg.clientId); }, get clientId() { return cfg && cfg.clientId || ''; }, signOut, signIn, push, forget, loadGoogle };
  document.body ? start() : addEventListener('DOMContentLoaded', start);
})();
