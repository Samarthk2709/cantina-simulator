// Hiring in chapter 3: the new agent must exist before any redraw sees the save's roster.
// Regression: hire() charged and listed Rook, then agentAct's redraw read list() (Rook undefined) and threw,
// so makeAgent never ran — Team lost its chat and the office frame stopped (WASD looked dead).
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/hire.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('first-office-guest', '1'));
  await ctx.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Sam', facts: [], completedAt: '2026-10-25T00:00:00Z' })); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{}}'); });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL); await p.waitForTimeout(800);
  await p.evaluate(() => { const st = Stage3Scope.seed({ playerName: 'Sam' }); st.stage = 3; st.cash = 869; Object.assign(st.seen, { team: true }); localStorage.removeItem('first-office-crew-v1'); localStorage.setItem('first-office-game-v1', JSON.stringify(st)); });
  await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 }); await p.waitForTimeout(800);

  const state = () => p.evaluate(() => ({ cash: Stage2.state().cash, hired: [...Stage2.state().hired], list: Stage3Agents.list().map(a => a && a.id), rook: !!Stage3Agents.get('rook'), wren: !!Stage3Agents.get('wren') }));

  // Hire from the Team window, as a player does: the redraw runs while Team is open.
  await p.evaluate(() => Stage3UI.open('nib')); await p.waitForTimeout(300);
  await p.click('#s3-side [data-hire="rook"]'); await p.waitForTimeout(300);
  let st = await state();
  assert.equal(st.cash, 269, 'charged once');
  assert.ok(st.hired.includes('rook') && st.rook, 'Rook in the save and alive');
  assert.ok(st.list.every(Boolean), 'no undefined agents: ' + st.list);

  // Duplicate and unaffordable hires: no charge, no agent.
  assert.equal(await p.evaluate(() => Stage3Agents.hire('rook')), false, 'duplicate refused');
  assert.equal(await p.evaluate(() => Stage3Agents.hire('wren')), false, 'Wren unaffordable');
  st = await state();
  assert.equal(st.cash, 269); assert.equal(st.hired.filter(id => id === 'rook').length, 1); assert.ok(!st.wren && !st.hired.includes('wren'));

  // Team still draws a conversation after switching to the new hire.
  await p.waitForTimeout(500);
  await p.click('#s3-side [data-go="agent:nib"]'); await p.waitForTimeout(200);
  await p.click('#s3-side [data-go="agent:rook"]'); await p.waitForTimeout(300);
  const chat = await p.evaluate(() => ({ head: document.querySelector('#s3-main [data-ph]')?.innerText || '', msgs: document.querySelector('#s3-main [data-msgs]')?.innerText || '' }));
  assert.match(chat.head, /Rook/, 'Team header shows Rook');
  assert.match(chat.msgs, /Rook/, 'Team conversation shows Rook\'s intro');

  // Back to the office and walk: the founder moves.
  await p.click('#s3-side [data-office]'); await p.waitForTimeout(300);
  const before = await p.evaluate(() => JSON.stringify(Stage2.world.getState()));
  await p.keyboard.down('d'); await p.waitForTimeout(600); await p.keyboard.up('d'); await p.waitForTimeout(200);
  const after = await p.evaluate(() => JSON.stringify(Stage2.world.getState()));
  assert.notEqual(after, before, 'WASD moves the founder');

  // Reload keeps the purchase and the agent.
  await p.waitForTimeout(3500); // the 3 s crew save
  await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 }); await p.waitForTimeout(800);
  st = await state();
  assert.equal(st.cash, 269); assert.ok(st.rook && st.hired.includes('rook') && st.list.every(Boolean));

  // Wren too, once affordable.
  await p.evaluate(() => { Stage2.state().cash = 1000; });
  assert.equal(await p.evaluate(() => Stage3Agents.hire('wren')), true, 'hire Wren');
  st = await state();
  assert.equal(st.cash, 100); assert.ok(st.wren && st.list.every(Boolean));

  await p.waitForTimeout(500);
  assert.deepEqual(errors.filter(e => !/503|Failed to load resource/.test(e)), [], 'no page errors');
  await browser.close();
  console.log('hire: ok');
})().catch(e => { console.error(e); process.exit(1); });
