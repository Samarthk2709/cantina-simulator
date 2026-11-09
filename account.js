/* Account window: your username, password, Google link, other devices, your data and deleting the account.
   Opened from the game menu (Account.open()). Talks to /api/account* (server.cjs → auth.cjs). Adds its own CSS. */
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function call(path, body) {
    const r = await fetch('/api/account' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
    return j;
  }
  const CSS = `#acct{position:fixed;inset:0;z-index:10001;display:grid;place-items:center;background:rgba(6,12,16,.72);color:#e8efe8;font:14px/1.45 system-ui,sans-serif}
#acct .card{width:min(460px,92vw);max-height:88vh;overflow:auto;padding:22px 24px;border:1px solid #2e4b58;border-radius:16px;background:#10202a;box-shadow:0 24px 60px rgba(0,0,0,.5)}
#acct h2{margin:0 0 2px;font:700 13px ui-monospace,Menlo,monospace;letter-spacing:.28em}
#acct .sub{margin:0 0 14px;color:#9fb3ba;font-size:12px}
#acct section{padding:12px 0;border-top:1px solid #20343d}
#acct section h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9fb3ba}
#acct p{margin:0 0 8px;font-size:13px;color:#c9d6d3}
#acct .row{display:flex;gap:8px;align-items:center}
#acct input{flex:1;min-width:0;padding:8px 10px;border:1px solid #2e4b58;border-radius:8px;background:#0b171d;color:#e8efe8;font:inherit}
#acct input:focus{outline:none;border-color:#7ff0d8}
#acct .stack{display:grid;gap:6px}
#acct button{padding:8px 14px;border:1px solid #2e4b58;border-radius:8px;background:#18303a;color:#e8efe8;font:inherit;cursor:pointer;white-space:nowrap}
#acct button:hover{border-color:#7ff0d8}
#acct button.go{background:#7ff0d8;border-color:#7ff0d8;color:#0b1a1f;font-weight:600}
#acct button.bad{border-color:#7a3b35;color:#f2b8b0}
#acct button.bad:hover{background:#3a1c19}
#acct .msg{min-height:1em;margin:6px 0 0;font-size:12px}
#acct .msg.ok{color:#7ff0d8}#acct .msg.err{color:#f2b8b0}
#acct .foot{display:flex;justify-content:space-between;gap:8px;padding-top:14px;border-top:1px solid #20343d}
#acct .gbtn iframe{color-scheme:light}
#acct details summary{cursor:pointer;color:#f2b8b0;font-size:13px}`;
  let box = null, info = null, unshut = null;
  // While this window is open, the page behind it can't be tabbed to or clicked (inert); returns the undo.
  // The ending's #modal stays live: shown meanwhile, it opens above this window and must work.
  const shut = box => { const off = [...document.body.children].filter(el => el !== box && !el.inert && el.id !== 'modal'); off.forEach(el => { el.inert = true; }); return () => off.forEach(el => { el.inert = false; }); };
  function msg(id, text, ok) { const el = box && box.querySelector(`[data-msg="${id}"]`); if (el) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); } }
  const val = name => (box.querySelector(`[name="${name}"]`) || {}).value || '';
  function draw() {
    const a = info, since = new Date(a.created).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    box.querySelector('.card').innerHTML = `
      <h2>ACCOUNT</h2><p class="sub">${esc(a.username)} · joined ${esc(since)}</p>
      <section><h3>Username</h3><p>Shown on the leaderboard.</p>
        <div class="row"><input name="username" value="${esc(a.username)}" maxlength="16" autocomplete="username" aria-label="Username"><button data-do="username">Save</button></div><p class="msg" data-msg="username"></p></section>
      <section><h3>Password</h3><p>${a.password ? 'Change the password you sign in with. Your other devices get signed out.' : 'Add a password to also sign in with your username.'}</p>
        <div class="stack">${a.password ? '<input name="current" type="password" placeholder="Current password" autocomplete="current-password">' : ''}<div class="row"><input name="password" type="password" placeholder="New password (8+ characters)" autocomplete="new-password"><button data-do="password">${a.password ? 'Change' : 'Add'}</button></div></div><p class="msg" data-msg="password"></p></section>
      ${a.googleAvailable || a.google ? `<section><h3>Google</h3>${a.google
        ? `<p>Linked to <b>${esc(a.google.email || 'your Google account')}</b>. You can sign in with it.</p>${a.password ? '<div class="row"><input name="unlinkpass" type="password" placeholder="Password" autocomplete="current-password"><button data-do="unlink">Unlink</button></div>' : '<p>Add a password before unlinking, so you can still sign in.</p>'}`
        : '<p>Link a Google account to sign in with it. It also gets you back in if you forget your password.</p><div class="gbtn"></div>'}<p class="msg" data-msg="google"></p></section>` : ''}
      <section><h3>Devices</h3><p>Sign out everywhere except here.</p><button data-do="signout-all">Sign out other devices</button><p class="msg" data-msg="signout-all"></p></section>
      <section><h3>Your data</h3><p>Your account details, cloud save and game, as a file.</p><button data-do="export">Download my data</button><p class="msg" data-msg="export"></p></section>
      <section><details><summary>Delete account</summary><p style="margin-top:8px">This deletes your account, your game and your leaderboard row for good.</p>
        <div class="stack"><input name="confirm" placeholder="Type your username to confirm" autocomplete="off">${a.password ? '<input name="delpass" type="password" placeholder="Password" autocomplete="current-password">' : ''}<button class="bad" data-do="delete">Delete my account</button></div><p class="msg" data-msg="delete"></p></details></section>
      <div class="foot"><button data-do="signout">Sign out</button><button class="go" data-do="close">Done</button></div>`;
    const g = box.querySelector('.gbtn');
    if (g && window.Auth?.clientId) window.Auth.loadGoogle().then(() => {
      window.google.accounts.id.initialize({ client_id: window.Auth.clientId, ux_mode: 'popup', callback: r => run('google', () => call('/google', { credential: r.credential }), 'Google account linked.') });
      window.google.accounts.id.renderButton(g, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with' });
    }).catch(() => msg('google', 'Google sign-in could not load.'));
  }
  // A rename also updates Auth.user, so the menu's "Signed in as" shows the new name.
  async function run(id, fn, ok) {
    try { const r = await fn(); if (r && r.account) { info = r.account; if (box) draw(); } if (r?.user?.name && window.Auth?.user) window.Auth.user.name = r.user.name; msg(id, ok, true); return r; }
    catch (e) { msg(id, e.message); }
  }
  const ACT = {
    username: () => run('username', () => call('/username', { username: val('username').trim() }), 'Saved.'),
    password: () => run('password', () => call('/password', { current: val('current'), password: val('password') }), info.password ? 'Password changed. Other devices are signed out.' : 'Password added.'),
    unlink: () => run('google', () => call('/google-unlink', { password: val('unlinkpass') }), 'Google account unlinked.'),
    'signout-all': () => run('signout-all', () => call('/signout-all', {}), 'Other devices are signed out.'),
    async export() {
      try {
        const r = await fetch('/api/account/export', { credentials: 'same-origin' }); if (!r.ok) throw new Error('Download failed. Try again.');
        const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'first-office-account.json'; a.click(); URL.revokeObjectURL(a.href);
        msg('export', 'Downloaded.', true);
      } catch (e) { msg('export', e.message); }
    },
    async delete() {
      if (!confirm('Delete your account for good? This can\'t be undone.')) return;
      const r = await run('delete', () => call('/delete', { confirm: val('confirm').trim(), password: val('delpass') }), 'Deleted.');
      if (r && r.ok) { window.Stage2?.freeze?.(); window.Auth.forget(); }
    },
    signout() { close(); window.Auth.signOut(); }, // signOut freezes the game once it's committed (it may ask first)
    close,
  };
  // Keys outside the window (focus on its backdrop or the page) don't reach the office while it's open.
  const outside = e => { if (box && !box.contains(e.target)) { e.stopImmediatePropagation(); if (e.key === 'Escape') close(); } };
  function close() { if (box) box.remove(); box = null; removeEventListener('keydown', outside, true); unshut?.(); unshut = null; }
  async function open() {
    if (!window.Auth?.user) return;
    if (!document.getElementById('acct-css')) { const st = document.createElement('style'); st.id = 'acct-css'; st.textContent = CSS; document.head.appendChild(st); }
    close();
    box = document.createElement('div'); box.id = 'acct'; box.innerHTML = '<div class="card" role="dialog" aria-label="Account"><p class="sub">Loading…</p></div>';
    box.addEventListener('click', e => { if (e.target === box) return close(); const b = e.target.closest('[data-do]'); if (b) ACT[b.dataset.do](); });
    box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); }); // the office doesn't walk while you type
    document.body.appendChild(box); addEventListener('keydown', outside, true); unshut = shut(box);
    try { info = (await call('')).account; if (!box) return; draw(); box.querySelector('[name="username"]').focus(); }
    catch (e) { if (!box) return; box.querySelector('.card').innerHTML = `<p class="msg err">${esc(e.message)}</p><div class="foot"><span></span><button class="go" data-do="close">Close</button></div>`; }
  }
  window.Account = { open, close };
})();
