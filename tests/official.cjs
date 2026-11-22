// The official game: signed in, the server keeps the real save and replays the page's actions on it (sync.js →
// /api/act). Checks that play reaches the server, that the page and the server agree after ordinary play (chapter 2
// by hand, chapter 3 with agents at speed), that editing the save in the browser changes nothing that counts, and that
// the leaderboard only shows the server's numbers. Own server on a spare port, temp data folder.
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/official.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 55196, URL = `http://localhost:${PORT}`;

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-official-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.cjs')], { env: { ...process.env, FIRST_OFFICE_PORT: PORT, FIRST_OFFICE_DATA: data, GOOGLE_CLIENT_ID: '', DEEPINFRA_API_KEY: '', SESSION_SECRET: '', KV_REST_API_URL: '', UPSTASH_REDIS_REST_URL: '' }, stdio: 'pipe' });
  await new Promise((ok, bad) => { srv.stdout.on('data', d => /First Office on/.test(d) && ok()); srv.on('exit', c => bad(new Error('server exited ' + c))); });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  async function device() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/\/api\/(agents|nib|lag)\b/, r => r.fulfill({ status: 503, body: '{}' }));
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{},"earned":[]}');
      window.__loads = (+sessionStorage.getItem('loads') || 0) + 1; sessionStorage.setItem('loads', window.__loads); // counts reloads (a resync reloads)
    });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    return { ctx, p };
  }
  const api = (p, url, o) => p.evaluate(async ([url, o]) => { const r = await fetch(url, o); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, o || {}]);
  const server = async p => (await api(p, '/api/game')).body;
  const local = p => p.evaluate(() => ({ digest: Stage2Engine.digest(Stage2.state()), cash: Stage2.state().cash, bugs: Stage2.state().bugs, loads: window.__loads }));
  const settle = p => p.waitForTimeout(4600); // one sync round (sync.js EVERY = 4 s)
  const agree = async (p, why) => { await settle(p); await p.evaluate(() => window.Sync.flush()); await p.waitForTimeout(600); const l = await local(p), g = await server(p); assert.equal(l.digest, Stage2Engine_digest(g.state), why + ': page and server agree'); return { l, g }; };
  let Stage2Engine_digest;
  try {
    // 1. Sign up, then Stage 1 is done: the office opens on a game the server made.
    const a = await device();
    await a.p.goto(URL + '/meet.html');
    await a.p.waitForSelector('#auth-gate #auth-user', { timeout: 8000 });
    await a.p.click('#auth-gate [data-act="signup"]'); await a.p.fill('#auth-user', 'Pat_99'); await a.p.fill('#auth-pass', 'longpassword1'); await a.p.press('#auth-pass', 'Enter');
    await a.p.waitForFunction(() => !document.getElementById('auth-gate'), null, { timeout: 8000 });
    await a.p.evaluate(() => localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Pat', facts: [], completedAt: new Date().toISOString() })));
    await a.p.goto(URL + '/'); await a.p.waitForFunction(() => window.Stage2 && window.Sync && window.Sync.on, null, { timeout: 10000 });
    const E = require('../engine.js'); Stage2Engine_digest = E.digest;
    let g = await server(a.p);
    assert.ok(g.state, 'the server started the game'); assert.equal(g.state.player, 'Pat');

    // 2. Play chapter 2 by hand through the engine on the live save: job, rooms, bugs, lessons, a night.
    await a.p.evaluate(() => {
      const E = Stage2Engine, D = Stage2Data, s = Stage2.state();
      const bad = fid => { const f = E.FINDINGS[fid]; return D.CLASSES[f.cls].variants[f.variant].findIndex(l => l.bad); };
      E.takeJob(s, 'chat'); E.mapRoom(s, 'msgs');
      for (const fid of ['chat:login:0', 'chat:msgs:0', 'chat:login:1']) { E.guess(s, fid, (bad(fid) + 1) % 5); E.guess(s, fid, bad(fid)); if (s.pendingTeach) E.teach(s, 'sharp'); }
      E.coffee(s); E.sleep(s); Stage2.refresh();
    });
    let r = await agree(a.p, 'after chapter 2 play');
    assert.ok(r.g.state.bugs >= 2, 'the bugs reached the server');
    const board = (await api(a.p, '/api/leaderboard')).body;
    assert.ok(board.rows.some(x => x.name === 'Pat_99' && x.bugs === r.g.state.bugs && x.key === board.me), 'the leaderboard row is the server\'s numbers, under the username');

    // 3. Cheating in the browser changes nothing that counts.
    const realCash = r.g.state.cash;
    await a.p.evaluate(() => { const s = JSON.parse(localStorage.getItem('first-office-game-v1')); s.cash = 999999; s.bugs = 500; localStorage.setItem('first-office-game-v1', JSON.stringify(s)); });
    await a.p.reload(); await a.p.waitForFunction(() => window.Stage2 && window.Sync?.on, null, { timeout: 10000 });
    assert.equal((await local(a.p)).cash, realCash, 'an edited save is replaced by the server\'s on load');
    const before = (await local(a.p)).loads;
    await a.p.evaluate(() => { const s = Stage2.state(); s.cash = 888888; s.bugs = 400; Stage2Engine.mapRoom(s, 'groups'); }); // edit memory, then play on
    await a.p.waitForFunction(b => window.__loads > b, before, { timeout: 15000 }).catch(() => {});
    await a.p.waitForFunction(() => window.Stage2 && window.Sync?.on, null, { timeout: 10000 });
    const after = await local(a.p);
    assert.ok(after.loads > before, 'a page whose save was edited in memory is caught and reloaded from the server');
    assert.equal(after.cash, realCash, 'the edited cash is gone'); assert.ok(after.bugs < 400, 'the edited bugs are gone');
    assert.ok(!(await api(a.p, '/api/leaderboard')).body.rows.some(x => x.bugs >= 400 || x.earned >= 888888), 'the board never saw the edit');
    // Posting a score directly is refused: scores only come from the server's copy.
    assert.equal((await api(a.p, '/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'abcdefgh1234', name: 'x', rep: 999 }) })).status, 410);
    // An action the rules refuse is refused on the server too (buying with money you don't have).
    const bad = await api(a.p, '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: (await server(a.p)).version, actions: [{ fn: 'buyTool', args: ['trace'] }, { fn: 'eval', args: [] }] }) });
    assert.equal(bad.status, 200); assert.equal((await server(a.p)).state.tools.includes('trace'), realCash >= 600, 'the server applies only what the rules allow');

    // 4. Chapter 3 from the chapter menu: the server makes the ready-made save; agents then play at speed and stay in step.
    await a.p.evaluate(() => { window.confirm = () => true; }); await a.p.click('#settings'); await a.p.click('summary:has-text("Chapters")'); await a.p.click('#ch3');
    await a.p.waitForFunction(() => window.Stage3Agents && Stage2.state().stage === 3, null, { timeout: 15000 });
    assert.equal((await server(a.p)).state.stage, 3, 'chapter 3 lives on the server');
    const l0 = (await local(a.p)).loads;
    await a.p.evaluate(() => { Stage3Agents.speed(10); Stage3Agents.send('pip', 'hunt vaultkit'); Stage3Agents.send('moss', 'hunt parcelly'); Stage3Agents.send('nib', 'validate the tray'); });
    await a.p.waitForTimeout(20000);
    await a.p.evaluate(() => { for (const x of Stage3Agents.list()) if (x.q) Stage3Agents.answer(x.id, 0); }); // coffee runs, purchases
    await a.p.waitForTimeout(8000);
    r = await agree(a.p, 'after agents played');
    assert.equal(r.l.loads, l0, 'no resync was needed while the agents played');
    assert.ok(r.g.state.stats.agent > 0 || r.g.state.bugs > 20, 'the agents\' work reached the server');

    // 5. A second device signs in to the same company.
    const b = await device();
    await b.p.goto(URL + '/');
    await b.p.waitForSelector('#auth-gate #auth-user', { timeout: 8000 });
    await b.p.fill('#auth-user', 'Pat_99'); await b.p.fill('#auth-pass', 'longpassword1'); await b.p.press('#auth-pass', 'Enter');
    await b.p.waitForFunction(() => window.Stage2 && window.Sync?.on, null, { timeout: 15000 });
    assert.equal((await local(b.p)).digest, E.digest((await server(b.p)).state), 'the second device plays the server\'s copy');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('official passed: server-made game, chapter 2 and chapter 3 (agents at speed) stay in step, edits caught and replaced, board from the server only, refused actions refused, second device');
  } finally { await browser.close(); srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
