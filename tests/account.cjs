// Account management end to end, through the Account window (menu → Account): rename (the board follows, the old name
// is freed), change or add a password (other devices signed out), link and unlink Google, sign out other devices,
// download your data, and delete the account (account, game, board row, username and Google link all gone).
// Google is a local stand-in (a JWKS from a local key plus a stub of Google's sign-in script), as in tests/login.cjs.
// Own server on a spare port with a temp data folder.
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/account.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 55197, URL = `http://localhost:${PORT}`, CLIENT = 'test-client.apps.googleusercontent.com';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(sub, email) {
  const now = Math.floor(Date.now() / 1000), head = b64({ alg: 'RS256', kid: 'test', typ: 'JWT' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: true, iat: now, exp: now + 3600 });
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
}
const GSI = `window.google={accounts:{id:{initialize(o){this.o=o},disableAutoSelect(){},renderButton(el){const b=document.createElement('button');b.className='fake-google';b.textContent='Google';b.onclick=()=>this.o.callback({credential:window.__token});el.appendChild(b)}}}};`;

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-account-'));
  const jwks = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ keys: [jwk] })); }).listen(0);
  await new Promise(r => jwks.once('listening', r));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.cjs')], { env: { ...process.env, FIRST_OFFICE_PORT: PORT, FIRST_OFFICE_DATA: data, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/certs`, DEEPINFRA_API_KEY: '', SESSION_SECRET: '', KV_REST_API_URL: '', UPSTASH_REDIS_REST_URL: '' }, stdio: 'pipe' });
  await new Promise((ok, bad) => { srv.stdout.on('data', d => /First Office on/.test(d) && ok()); srv.on('exit', c => bad(new Error('server exited ' + c))); });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  async function device(tok) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI }));
    await ctx.route(/\/api\/(agents|nib|lag)\b/, r => r.fulfill({ status: 503, body: '{}' }));
    await ctx.addInitScript(t => { window.__token = t; if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{},"earned":[]}'); }, tok || '');
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    return { ctx, p };
  }
  const api = (p, url, o) => p.evaluate(async ([url, o]) => { const r = await fetch(url, o); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, o || {}]);
  const me = async p => (await api(p, '/api/auth/me')).body.user;
  async function signIn(p, user, pass, tab = 'login') {
    await p.waitForSelector('#auth-gate #auth-user', { timeout: 8000 });
    await p.click(`#auth-gate [data-act="${tab}"]`); await p.fill('#auth-user', user); await p.fill('#auth-pass', pass); await p.press('#auth-pass', 'Enter');
    await p.waitForFunction(() => !document.getElementById('auth-gate'), null, { timeout: 8000 });
  }
  async function office(p) {
    await p.evaluate(() => localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Ann', facts: [], completedAt: new Date().toISOString() })));
    await p.goto(URL + '/'); await p.waitForFunction(() => window.Stage2 && window.Sync?.on && window.Account, null, { timeout: 10000 });
  }
  async function account(p) { await p.click('#settings'); await p.click('#account'); await p.waitForSelector('#acct [name="username"]'); }
  const say = (p, id) => p.textContent(`#acct [data-msg="${id}"]`);
  const doIt = async (p, what, id) => { await p.evaluate(i => { const m = document.querySelector(`#acct [data-msg="${i}"]`); if (m) m.textContent = ''; }, id); await p.click(`#acct [data-do="${what}"]`); await p.waitForFunction(i => document.querySelector(`#acct [data-msg="${i}"]`)?.textContent, id, { timeout: 8000 }); return say(p, id); };
  try {
    // A password account with a game, plus a second device signed in to it.
    const a = await device(token('g-ann', 'ann@example.com'));
    await a.p.goto(URL + '/meet.html'); await signIn(a.p, 'Ann_1', 'firstpass1', 'signup'); await office(a.p);
    const phone = await device(); await phone.p.goto(URL + '/meet.html'); await signIn(phone.p, 'Ann_1', 'firstpass1');
    assert.equal((await me(phone.p)).name, 'Ann_1');

    // Rename: the board follows, and the old name is free again.
    await account(a.p);
    await a.p.fill('#acct [name="username"]', 'nib'); assert.match(await doIt(a.p, 'username', 'username'), /reserved/);
    await a.p.fill('#acct [name="username"]', 'Ann_2'); assert.equal(await doIt(a.p, 'username', 'username'), 'Saved.');
    assert.equal((await me(a.p)).name, 'Ann_2');
    assert.ok((await api(a.p, '/api/leaderboard')).body.rows.some(r => r.name === 'Ann_2'), 'the board shows the new name');
    const other = await device(); await other.p.goto(URL + '/meet.html'); await signIn(other.p, 'Ann_1', 'someonepass', 'signup');
    assert.equal((await me(other.p)).name, 'Ann_1', 'the old name was freed');

    // Password: the current one is checked; a change signs the other device out but keeps this one.
    await a.p.fill('#acct [name="current"]', 'wrongpass1'); await a.p.fill('#acct [name="password"]', 'secondpass2');
    assert.match(await doIt(a.p, 'password', 'password'), /Wrong password/);
    await a.p.fill('#acct [name="current"]', 'firstpass1'); await a.p.fill('#acct [name="password"]', 'secondpass2');
    assert.match(await doIt(a.p, 'password', 'password'), /changed/);
    assert.equal((await me(a.p)).name, 'Ann_2', 'this device stays signed in');
    assert.equal(await me(phone.p), null, 'the other device is signed out');

    // Link Google, then sign in with it elsewhere: same account.
    await a.p.click('#acct .fake-google'); await a.p.waitForFunction(() => /linked/.test(document.querySelector('#acct [data-msg="google"]')?.textContent || ''), null, { timeout: 8000 });
    assert.match(await a.p.textContent('#acct'), /ann@example\.com/);
    const g = await device(token('g-ann', 'ann@example.com')); await g.p.goto(URL + '/meet.html'); await g.p.waitForSelector('#auth-gate .fake-google'); await g.p.click('#auth-gate .fake-google');
    await g.p.waitForFunction(() => !document.getElementById('auth-gate'), null, { timeout: 8000 });
    assert.equal((await me(g.p)).name, 'Ann_2', 'Google signs in to the linked account');
    // That Google account can't be linked to a second account.
    const taken = await api(other.p, '/api/account/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: token('g-ann', 'ann@example.com') }) });
    assert.equal(taken.status, 409);

    // Sign out other devices: the Google session ends, this one doesn't.
    assert.match(await doIt(a.p, 'signout-all', 'signout-all'), /signed out/);
    assert.equal(await me(g.p), null); assert.equal((await me(a.p)).name, 'Ann_2');

    // Unlink Google needs the password.
    await a.p.fill('#acct [name="unlinkpass"]', 'nope12345'); assert.match(await doIt(a.p, 'unlink', 'google'), /Wrong password/);
    await a.p.fill('#acct [name="unlinkpass"]', 'secondpass2'); assert.match(await doIt(a.p, 'unlink', 'google'), /unlinked/);
    assert.ok(await a.p.$('#acct .fake-google'), 'the link button is back');

    // Download my data: account details and the game, never the password hash.
    const ex = await api(a.p, '/api/account/export');
    assert.equal(ex.body.account.username, 'Ann_2'); assert.ok(ex.body.game && ex.body.game.player === 'Ann', 'the game is in the export');
    assert.ok(!JSON.stringify(ex.body).includes('"hash"'), 'no password hash in the export');

    // Delete: the username must be typed, and the password given.
    await a.p.click('#acct details summary');
    await a.p.fill('#acct [name="confirm"]', 'Ann_3'); await a.p.fill('#acct [name="delpass"]', 'secondpass2');
    assert.match(await doIt(a.p, 'delete', 'delete'), /Type your username/);
    await a.p.fill('#acct [name="confirm"]', 'Ann_2');
    await Promise.all([a.p.waitForURL(/meet\.html/, { timeout: 10000 }), a.p.click('#acct [data-do="delete"]')]);
    assert.equal(await me(a.p), null, 'signed out');
    assert.equal(await a.p.evaluate(() => localStorage.getItem('first-office-game-v1')), null, 'this browser forgot the game');
    assert.ok(!(await api(other.p, '/api/leaderboard')).body.rows.some(r => r.name === 'Ann_2'), 'the board row is gone');
    const again = await api(other.p, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Ann_2', password: 'secondpass2' }) });
    assert.equal(again.status, 401, 'the account is gone');
    const fresh = await device(token('g-ann', 'ann@example.com')); await fresh.p.goto(URL + '/meet.html'); await fresh.p.click('#auth-gate .fake-google').catch(async () => { await fresh.p.waitForSelector('#auth-gate .fake-google'); await fresh.p.click('#auth-gate .fake-google'); });
    await fresh.p.waitForSelector('#auth-gate [name="username"], #auth-gate #auth-name, #auth-gate input', { timeout: 8000 });
    assert.equal((await me(fresh.p)).name, '', 'the Google account starts over: no old account to sign in to');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('account passed: rename (board follows, old name freed), password change (other devices out), Google link/sign-in/unlink, sign out other devices, data export, delete (account, game, board row, name and Google link gone)');
  } finally { await browser.close(); srv.kill(); jwks.close(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
