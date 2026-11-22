// Accounts end to end: username + password sign-up and sign-in, a taken username, the cloud save across two browsers,
// sign-out, and Google (without Google: a local key stands in for Google's, served as a JWKS, and a stub of Google's
// sign-in script hands the page a token signed with it) → choose a username → play. Runs its own server on a spare port
// with a temp data folder, so your real accounts, saves and leaderboard are never touched.
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/login.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 55190, URL = `http://localhost:${PORT}`, CLIENT = 'test-client.apps.googleusercontent.com';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(sub, name, email) {
  const now = Math.floor(Date.now() / 1000), head = b64({ alg: 'RS256', kid: 'test', typ: 'JWT' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: true, given_name: name, iat: now, exp: now + 3600 });
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
}
// Stub of https://accounts.google.com/gsi/client: renderButton draws a button that "signs in" with window.__token.
const GSI = `window.google={accounts:{id:{initialize(o){this.o=o},disableAutoSelect(){},renderButton(el){const b=document.createElement('button');b.id='fake-google';b.textContent='Sign in with Google';b.onclick=()=>this.o.callback({credential:window.__token});el.appendChild(b)}}}};`;

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-login-'));
  const jwks = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ keys: [jwk] })); }).listen(0);
  await new Promise(r => jwks.once('listening', r));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.cjs')], { env: { ...process.env, FIRST_OFFICE_PORT: PORT, FIRST_OFFICE_DATA: data, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/certs`, DEEPINFRA_API_KEY: '', SESSION_SECRET: '', KV_REST_API_URL: '', UPSTASH_REDIS_REST_URL: '' }, stdio: 'pipe' });
  await new Promise((ok, bad) => { srv.stdout.on('data', d => /First Office on/.test(d) && ok()); srv.on('exit', c => bad(new Error('server exited ' + c))); });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  async function device(tok) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI }));
    await ctx.route(/\/api\/(agents|nib)\//, r => r.fulfill({ status: 503, body: '{}' }));
    if (tok) await ctx.addInitScript(t => { window.__token = t; }, tok);
    // The look editor (customize.js) is someone else's test: skip it with a stored look.
    await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{},"earned":[]}'); });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    return { ctx, p };
  }
  const gone = p => p.waitForFunction(() => !document.getElementById('auth-gate'), null, { timeout: 8000 });
  const msg = async (p, re) => { await p.waitForFunction(r => new RegExp(r).test(document.querySelector('#auth-gate .auth-msg')?.textContent || ''), re.source, { timeout: 8000 }); };
  async function form(p, tab, user, pass) {
    await p.waitForSelector('#auth-gate #auth-user');
    await p.click(`#auth-gate [data-act="${tab}"]`);
    await p.fill('#auth-user', user); await p.fill('#auth-pass', pass);
    await p.press('#auth-pass', 'Enter'); // keyboard: Enter submits
  }
  const api = (p, url, o) => p.evaluate(async ([url, o]) => { const r = await fetch(url, o); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, o || {}]);
  try {
    // 1. A new player on a laptop: the gate comes first. A short password is caught inline; then the account is made.
    const a = await device(null);
    await a.p.goto(URL + '/meet.html');
    await a.p.waitForSelector('#auth-gate #fake-google', { timeout: 8000 }); // Google is offered when the server has a client id
    await form(a.p, 'signup', 'Sam_01', 'short');
    await msg(a.p, /8 characters/);
    await a.p.fill('#auth-pass', 'correct-horse'); await a.p.press('#auth-pass', 'Enter');
    await gone(a.p);
    const me = (await api(a.p, '/api/auth/me')).body.user;
    assert.equal(me.name, 'Sam_01', 'signed in as the new username');
    assert.equal(await a.p.evaluate(() => Auth.user && Auth.user.name), 'Sam_01', 'Auth.user has the username');
    await a.p.evaluate(() => localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Sam', facts: [], completedAt: new Date().toISOString() })));
    await a.p.goto(URL + '/'); await a.p.waitForFunction(() => window.Stage2, null, { timeout: 8000 });
    await a.p.evaluate(() => { const s = Stage2.state(); window.Stage2Engine.takeJob(s, 'vault'); Stage2.refresh(); });
    // The 5 s sync: progress reaches the cloud.
    const cloudTarget = async p => (await api(p, '/api/game')).body?.state?.target;
    for (let i = 0; i < 20 && (await cloudTarget(a.p)) !== 'vault'; i++) await a.p.waitForTimeout(1000);
    assert.equal(await cloudTarget(a.p), 'vault', 'progress reached the server');
    // The leaderboard row is the account's, under its username.
    await a.p.keyboard.press('l'); await a.p.waitForSelector('.board table', { timeout: 5000 });
    const board = await api(a.p, '/api/leaderboard');
    assert.ok(board.body.rows.some(r => r.name === 'Sam_01' && r.key === board.body.me), 'the username is on the board, highlighted');
    assert.ok(!!await a.p.$('.board tr.me'), 'your row is highlighted');

    // 2. A second browser: the same username (any case) is taken; a wrong password is refused; the right one brings the save back.
    const b = await device(null);
    await b.p.goto(URL + '/');
    await form(b.p, 'signup', 'sam_01', 'another-pass');
    await msg(b.p, /taken/);
    await form(b.p, 'login', 'Sam_01', 'wrong-password');
    await msg(b.p, /Wrong username or password/);
    await b.p.fill('#auth-pass', 'correct-horse'); await b.p.press('#auth-pass', 'Enter');
    await gone(b.p); await b.p.waitForFunction(() => window.Stage2, null, { timeout: 8000 });
    assert.equal(await b.p.evaluate(() => Stage2.state().target), 'vault', 'the server\'s game came back on the second browser');
    await b.p.reload(); await b.p.waitForFunction(() => window.Stage2, null, { timeout: 8000 });
    assert.equal(!!await b.p.$('#auth-gate'), false, 'the session survives a reload');
    // Sign out: back to the start, this browser's save cleared, the API locked again.
    await b.p.click('#settings'); await b.p.click('#sign-out'); await b.p.waitForURL(/meet\.html/, { timeout: 8000 });
    assert.equal(await b.p.evaluate(() => localStorage.getItem('first-office-game-v1')), null, 'sign-out clears this browser');
    assert.equal((await api(b.p, '/api/save')).status, 401, 'signed out: no save access');

    // 3. A Google player on that browser: must choose a username (rules checked inline) before playing.
    await b.ctx.addInitScript(t => { window.__token = t; }, token('sub-kim', 'Kim', 'kim@example.com'));
    await b.p.reload(); await b.p.waitForSelector('#auth-gate #fake-google'); await b.p.click('#fake-google');
    await b.p.waitForSelector('#auth-gate [data-act="other"]'); assert.equal(!!await b.p.$('#auth-pass'), false, 'the username step has no password');
    assert.equal((await api(b.p, '/api/auth/me')).body.user.needsName, true);
    await b.p.fill('#auth-user', 'admin'); await b.p.press('#auth-user', 'Enter'); await msg(b.p, /reserved/);
    await b.p.fill('#auth-user', 'SAM_01'); await b.p.press('#auth-user', 'Enter'); await msg(b.p, /taken/);
    await b.p.fill('#auth-user', 'Kim_G'); await b.p.press('#auth-user', 'Enter');
    await gone(b.p);
    assert.ok(!!await b.p.$('#wake'), 'Stage 1 starts');
    assert.equal((await api(b.p, '/api/auth/me')).body.user.name, 'Kim_G');
    assert.notEqual(await cloudTarget(b.p), 'vault', 'Kim has her own game');
    assert.equal(await cloudTarget(a.p), 'vault', 'Sam\'s game is untouched');
    await b.p.reload(); await b.p.waitForSelector('#wake'); assert.equal(!!await b.p.$('#auth-gate'), false, 'Kim stays signed in');

    // 4. Play without an account: the game runs locally; the board refuses anonymous scores; forgeries get nothing.
    const c = await device(null);
    await c.p.route('**/api/auth/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"accounts":true,"clientId":""}' }));
    await c.p.goto(URL + '/meet.html'); await c.p.waitForSelector('#auth-gate .auth-guest');
    assert.equal(!!await c.p.$('#auth-google'), false, 'no Google button without a client id');
    await c.p.click('.auth-guest');
    assert.equal(!!await c.p.$('#auth-gate'), false, 'guest play starts');
    await c.p.reload(); await c.p.waitForSelector('#wake'); assert.equal(!!await c.p.$('#auth-gate'), false, 'guest choice is remembered');
    const anon = await api(c.p, '/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'abcdefgh1234', name: 'Hacker', rep: 999 }) });
    assert.equal(anon.status, 410, 'posted scores are refused: the board reads the server\'s copy');
    await c.ctx.addCookies([{ name: 'fo_session', value: me.id + '.9999999999.forged', url: URL }]);
    assert.equal((await api(c.p, '/api/save')).status, 401, 'a forged cookie is refused');
    const fake = token('sub-x', 'X', 'x@example.com').split('.'); fake[2] = Buffer.from('nope').toString('base64url');
    assert.equal((await api(c.p, '/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: fake.join('.') }) })).status, 401, 'a forged token is refused');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('login passed: password sign-up/sign-in, taken + reserved usernames, bad password, cloud save across browsers, sign-out, Google → choose username → play, guest play, no Google button without a client id, forgeries refused, username on the leaderboard');
  } finally { await browser.close(); srv.kill(); jwks.close(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
