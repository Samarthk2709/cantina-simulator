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
  const GAME = 'first-office-game-v1', GAME_VERSION = 'first-office-game-version', ALL = KEYS.concat(GAME, GAME_VERSION);
  const ACCOUNT = 'first-office-account', SYNCED = 'first-office-synced-at', GUEST = 'first-office-guest';
  const NAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
  const json = async (url, o) => { const r = await fetch(url, { credentials: 'same-origin', ...o, headers: { 'Content-Type': 'application/json', ...(o && o.headers) } }); const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || 'Something went wrong. Try again.'), { status: r.status }); return b; };
  const post = (url, body) => json(url, { method: 'POST', body: JSON.stringify(body) });
  const snapshot = () => { const keys = {}; for (const k of KEYS) { const v = ls.get(k); if (v != null) keys[k] = v; } return keys; };
  const localAt = () => +ls.get(SYNCED) || 0;

  let user = null, cfg = null, lastPushed = '', done;
  const ready = new Promise(r => { done = r; });

  async function push(beacon) {
    if (!user) return;
    const keys = snapshot(), key = JSON.stringify(keys); if (key === lastPushed || !Object.keys(keys).length) return; // nothing new, or nothing yet
    const body = JSON.stringify({ at: Date.now(), keys });
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/save', new Blob([body], { type: 'application/json' })); lastPushed = key; return; }
    try { const r = await json('/api/save', { method: 'POST', body }); lastPushed = key; ls.set(SYNCED, String(r.at)); } catch {}
  }
  // The newer save wins: the cloud's replaces this browser's, or this browser's goes up.
  async function pull() {
    const r = await json('/api/save').catch(() => ({ save: null }));
    const cloud = r.save;
    if (cloud && cloud.at > localAt()) {
      for (const k of KEYS) { if (cloud.keys[k] != null) ls.set(k, cloud.keys[k]); else ls.del(k); }
      ls.set(SYNCED, String(cloud.at)); lastPushed = JSON.stringify(snapshot());
    } else await push();
  }
  // Signed in. No username yet: ask for one. Otherwise: take over this browser's save and start.
  async function enter(u) {
    if (!u.name) return gate('name');
    if (ls.get(ACCOUNT) && ls.get(ACCOUNT) !== u.id) { for (const k of ALL.concat(SYNCED)) ls.del(k); } // someone else's save
    ls.set(ACCOUNT, u.id); ls.del(GUEST); user = { id: u.id, name: u.name, email: u.email || '', picture: u.picture || '' };
    await pull();
    await loadGame();
    setInterval(() => push(), 5000);
    addEventListener('pagehide', () => push(true));
    // Stage 1 already done on another device: go to the office.
    if (location.pathname.endsWith('/meet.html') && ls.get('first-office-game-v1')) { location.replace('/'); return; }
    close(); done();
  }
  // The server's copy of the game is the real one: it always replaces this browser's. No game yet, but Stage 1 is done
  // (the office is next): the server starts one.
  async function loadGame() {
    let g = await json('/api/game').catch(() => null);
    if (g && !g.state && !location.pathname.endsWith('/meet.html')) {
      let intro = {}; try { intro = JSON.parse(ls.get('first-office-nib-v1') || '{}'); } catch {}
      if (intro.completedAt) g = await post('/api/game/new', { mode: 'fresh', profile: { playerName: intro.playerName, nibName: intro.nibName, facts: intro.facts } }).catch(() => g);
    }
    if (g && g.state) { ls.set(GAME, JSON.stringify(g.state)); ls.set(GAME_VERSION, String(g.version)); }
    else if (g) { ls.del(GAME); ls.del(GAME_VERSION); }
  }
  function guest() { ls.set(GUEST, '1'); close(); done(); }

  // ---------- the gate ----------
  let box = null, mode = 'login';
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
    : `<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-h"><b class="auth-title">FIRST OFFICE</b><p id="auth-h">Sign in to save your company to your account and join the leaderboard.</p>
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
      box = document.createElement('div'); box.id = 'auth-gate'; document.body.appendChild(box);
      box.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'guest') guest();
        else if (act === 'login' || act === 'signup') { if (act !== mode) { const name = box.querySelector('#auth-user').value; gate(act); box.querySelector('#auth-user').value = name; } }
        else if (act === 'other') post('/api/auth/logout', {}).catch(() => {}).then(() => gate('login'));
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
  function close() { if (box) box.remove(); box = null; }
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
    await push(); await post('/api/auth/logout', {}).catch(() => {});
    await window.Sync?.flush(); for (const k of ALL.concat(SYNCED, ACCOUNT)) ls.del(k); // the next person on this browser starts clean
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch {}
    location.href = '/meet.html';
  }
  function signIn() { ls.del(GUEST); location.reload(); }

  // Auth.user: { id, name (the username), email, picture } once signed in; null as a guest.
  window.Auth = { ready, get user() { return user; }, get configured() { return !!cfg; }, get google() { return !!(cfg && cfg.clientId); }, signOut, signIn, push };
  document.body ? start() : addEventListener('DOMContentLoaded', start);
})();
