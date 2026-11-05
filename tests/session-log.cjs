// Session log (log.js → /api/log → scripts/sessions.cjs): plays Stage 1 into the office and checks the log has the
// clicks, keys, what the player said, Nib's lines, AI calls, engine actions, windows and errors, no password, and that no
// request a player can make reads a log back.
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/session-log.cjs
// Reads the server's data/ (set FIRST_OFFICE_DATA for both if the server uses another folder).
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), path = require('node:path'), { execFileSync } = require('node:child_process');
const BASE = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const store = require('../store.cjs').create({ dir: process.env.FIRST_OFFICE_DATA || path.join(__dirname, '..', 'data') });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('first-office-guest', '1'); if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{}}'); });
  // The model says it's up but every answer fails, so Nib asks it (logged) and falls back to scripted lines.
  await ctx.route(/\/api\/(nib|agents)\//, r => /health/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"model":"test/test"}' }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());

  await p.goto(BASE); await p.waitForURL(/meet\.html/);
  const session = await p.evaluate(() => SessionLog.session);
  for (let i = 0; i < 20 && await p.$eval('#dark', e => getComputedStyle(e).display !== 'none'); i++) { await p.click('#wake').catch(() => {}); await p.waitForTimeout(500); } // over a slow network the page may not be ready yet
  await p.waitForTimeout(3600);
  for (let i = 0; i < 30 && await p.$eval('#msg', e => e.disabled); i++) { await p.click('#box'); await p.waitForTimeout(250); }
  await p.fill('#msg', 'Sam'); await p.press('#msg', 'Enter');
  for (let i = 0; i < 30 && !(await p.$('#chips button:not([disabled])')); i++) { await p.click('#box'); await p.waitForTimeout(250); }
  await p.fill('#msg', "Let's do it"); await p.press('#msg', 'Enter');
  for (let i = 0; i < 40 && !/index|\/$/.test(new URL(p.url()).pathname); i++) { if (await p.$('#chips button:not([disabled])')) await p.click('#chips button:not([disabled])').catch(() => {}); else await p.click('#box').catch(() => {}); await p.waitForTimeout(300); }
  await p.waitForFunction(() => window.Stage2 && window.SessionLog, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => SessionLog.session), session, 'the session id survives the move into the office');
  await p.evaluate(() => { Stage2.open('hunt'); Stage2.close(); Stage2Engine.meta(Stage2.state(), { player: 'Sam' }); setTimeout(() => { throw new Error('planted test error'); }); });
  await p.keyboard.press('v');
  await p.waitForTimeout(300);
  await p.evaluate(() => SessionLog.send());
  await p.waitForTimeout(800);
  await browser.close();

  const ev = await store.read('session:' + session), has = (type, f = () => true) => ev.some(e => e.type === type && f(e));
  assert.ok(has('page', e => /meet/.test(e.url)) && has('page', e => !/meet/.test(e.url)), 'both page loads');
  assert.ok(has('click', e => e.el.startsWith('button#wake')), 'the light switch click');
  assert.ok(has('key', e => e.key === 'Enter'), 'Enter in the message box');
  assert.ok(has('player', e => e.text === 'Sam') && has('player', e => e.text === "Let's do it"), 'what the player said');
  assert.ok(has('nib'), "Nib's lines");
  assert.ok(has('ai', e => e.path === '/api/nib/chat' && e.status === 503 && e.req && e.req.message), 'AI request and status');
  assert.ok(has('window', e => e.open === 'hunt') && has('window', e => e.close === 'hunt'), 'window open and close');
  assert.ok(has('action', e => e.fn === 'meta'), 'engine actions');
  assert.ok(has('error', e => /planted test error/.test(e.msg)), 'JS errors');
  assert.ok(has('batch', e => e.ctx && e.ctx.day != null), 'game state with each batch');
  assert.ok(!JSON.stringify(ev).includes('hunter2'), 'no password');
  // Write-only: nothing a player can request reads a log back.
  for (const u of ['data/sessions.log', `data/session_${session}.log`, 'DATA/sessions.log', '%64ata/sessions.log', 'scripts/sessions.cjs', 'store.cjs'])
    assert.equal((await fetch(BASE + u)).status, 404, u + ' is not served');
  assert.equal((await fetch(BASE + 'api/log')).status, 405, 'GET /api/log reads nothing');
  assert.deepEqual(await (await fetch(BASE + 'api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, seq: 99, events: [] }) })).json(), { ok: true }, 'POST answers with no data');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sessions.cjs'), session], { env: process.env }).toString();
  assert.match(out, /→ nib: "Sam"/);
  console.log(`session-log: ${ev.length} events in ${session}, all checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
