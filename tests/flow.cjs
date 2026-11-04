// Whole-product check through the real UI: Stage 1 → the office → chapter 3 and its agents.
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/flow.cjs
// The model endpoints are blocked here, so agents use the game's own parser and scripted lines (deterministic).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const OUT = path.join(__dirname, '..', 'evidence');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('first-office-guest', '1')); // play without an account, so the sign-in gate (auth.js) doesn't open
  await ctx.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{}}'); }); // a look is picked, so the editor (customize.js) doesn't open
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept());
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png') });

  // ---- Stage 1: the dark room ----
  await p.goto(URL); await p.waitForURL(/meet\.html/);
  await p.click('#wake'); await p.waitForTimeout(3600);
  for (let i = 0; i < 30 && await p.$eval('#msg', e => e.disabled); i++) { await p.click('#box'); await p.waitForTimeout(250); }
  await p.fill('#msg', 'Sam'); await p.press('#msg', 'Enter');
  for (let i = 0; i < 30 && !(await p.$('#chips button:not([disabled])')); i++) { await p.click('#box'); await p.waitForTimeout(250); }
  await shot('flow-01-meet-nib');
  await p.fill('#msg', "Let's do it"); await p.press('#msg', 'Enter');
  for (let i = 0; i < 20 && /meet/.test(p.url()); i++) { await p.click('#box').catch(() => {}); await p.waitForTimeout(300); }
  await p.waitForURL(u => !/meet/.test(u.href), { timeout: 10000 }); await p.waitForTimeout(1200);

  // ---- Stage 2: the office knows the name from Stage 1 ----
  let s = await p.evaluate(() => Stage2.state());
  assert.equal(s.player, 'Sam'); assert.equal(s.stage, 2);
  assert.match(await p.textContent('#chapter-sub'), /02/);
  await shot('flow-02-office');

  // ---- Chapter 3 from the menu ----
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.click('#settings'); await p.click('#settings-body summary >> text=Chapters'); await p.click('#ch3');
  await p.waitForFunction(() => window.Stage2?.state().stage === 3 && window.Stage3Agents, null, { timeout: 10000 });
  await p.waitForTimeout(1200);
  s = await p.evaluate(() => Stage2.state());
  assert.equal(s.player, 'Sam', 'names survive the jump'); assert.equal(s.bugs, 20); assert.match(await p.textContent('#chapter-sub'), /03/);
  await shot('flow-03a-team-intro');
  for (let i = 0; i < 4 && !(await p.$('#s3-view:not([hidden])')); i++) { const b = await p.$('#nib-bubble:not([hidden]) .nib-next'); if (b) await b.click(); await p.waitForTimeout(500); }
  await p.waitForSelector('#s3-view:not([hidden])');
  assert.deepEqual(await p.evaluate(() => Stage3Agents.list().map(a => a.id)), ['nib', 'pip', 'moss']);

  const send = (id, text) => p.evaluate(([id, text]) => Stage3Agents.send(id, text), [id, text]);
  const agent = id => p.evaluate(id => JSON.parse(JSON.stringify(Stage3Agents.get(id), (k, v) => k === 'onResult' || k === 'run' ? undefined : v)), id);

  // The brief that broke on Oct 22: no program and "mo" bugs. Now it picks the program with the most work and has no 0-stop.
  await send('nib', 'hunt for mo bugs'); await p.waitForTimeout(300);
  let nib = await agent('nib');
  assert.equal(nib.task.job, 'hunt'); assert.ok(nib.task.program && nib.task.program !== 'chat', 'picked a program with work left: ' + nib.task.program);
  assert.equal(nib.task.until, null, 'no stop condition rather than a stop at 0');
  // A question is chat, not a new task.
  const before = nib.task.raw;
  await send('nib', 'why were there no accepted bugs?'); await p.waitForTimeout(300);
  nib = await agent('nib'); assert.equal(nib.task.raw, before, 'a question does not replace the task');
  // ChatterBox is picked clean in the chapter 3 save: the agent says so instead of starting.
  await send('pip', 'hunt ChatterBox until 2 more bugs'); await p.waitForTimeout(300);
  let pip = await agent('pip');
  assert.equal(pip.task, null, 'nothing started'); assert.equal(pip.log.at(-1).kind, 'refuse'); assert.match(pip.log.at(-1).text, /ChatterBox/);
  // A stop that's already true is dropped, not obeyed.
  await send('moss', 'hunt VaultKit until rep 20'); await p.waitForTimeout(300);
  const moss = await agent('moss'); assert.equal(moss.task.program, 'vault'); assert.equal(moss.task.until, null);
  await send('pip', 'hunt Invoicely until 2 more bugs'); await p.waitForTimeout(300);
  pip = await agent('pip'); assert.equal(pip.task.program, 'inv'); assert.deepEqual(pip.task.until, { kind: 'more', val: 2 });
  await shot('flow-03-agents');

  // Run the team at 3× and wait for real accepted bugs from agents.
  await p.evaluate(() => Stage3Agents.speed(3));
  await p.waitForFunction(() => Stage2.state().stats.agent >= 2, null, { timeout: 150000 });
  s = await p.evaluate(() => Stage2.state());
  assert.ok(s.bugs >= 22, 'agents landed bugs on the shared save');
  await p.click('[data-office]'); await p.waitForTimeout(600);
  assert.ok(await p.$$eval('.s3-agent', b => b.length) >= 2, 'agents are drawn on the office');
  await shot('flow-04-office-team');
  // Grok Bot-style roster: every agent shows what it's doing in a few words.
  await p.click('#s3-toggle'); await p.click('[data-go="agent:pip"]'); await p.waitForTimeout(500);
  const subs = await p.$$eval('#s3-side .s3-row .sub', els => els.slice(0, 3).map(e => e.textContent));
  assert.ok(subs.every(t => t.length > 2), 'each agent has a phrase: ' + subs.join(' | '));
  await shot('flow-05-team');

  // Reload keeps chapter 3, the agents and their logs.
  await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => Stage2.state().stage), 3);
  assert.ok((await agent('pip')).log.length > 5);

  // Menu chapters: each one must actually land where it says, keeping the names (regression: a frozen save once dropped them).
  const menu = async id => { await p.evaluate(() => window.Stage3UI?.close()); await p.click('#settings'); await p.click('#settings-body summary >> text=Chapters'); await p.click(id); await p.waitForTimeout(1500); };
  await menu('#ch2');
  s = await p.evaluate(() => Stage2.state());
  assert.equal(s.stage, 2); assert.equal(s.bugs, 0); assert.equal(s.player, 'Sam', 'chapter 2 keeps the name');
  await menu('#ch3'); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 });
  s = await p.evaluate(() => Stage2.state());
  assert.equal(s.stage, 3); assert.equal(s.bugs, 20); assert.equal(s.player, 'Sam');
  assert.equal(await p.evaluate(() => Stage3Agents.list()[1].log.filter(m => m.kind === 'user').length), 0, 'chapter 3 restart clears the crew');

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('flow passed: Stage 1 → office → chapter 3 agents; screenshots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
