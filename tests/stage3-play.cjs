// Plays chapter 3 to the end like a sensible player: turns rules on after the first penalties, briefs agents
// in plain words, sleeps so Nib fills the tray, buys the Tracer, and chains criticals. Agents run at 10× speed.
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/stage3-play.cjs
// Model endpoints are blocked, so it is deterministic up to the agents' dice. Fails if Elite takes too long.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('first-office-guest', '1')); // play without an account, so the sign-in gate (auth.js) doesn't open
  await ctx.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Sam', facts: [], completedAt: '2026-10-25T00:00:00Z' })); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-look-v1')) localStorage.setItem('first-office-look-v1', '{"look":{}}'); }); // a look is picked, so the editor (customize.js) doesn't open
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(800);
  await p.evaluate(() => { const st = Stage3Scope.seed({ playerName: 'Sam' }); st.stage = 3; Object.assign(st.seen, { team: true }); localStorage.removeItem('first-office-crew-v1'); localStorage.setItem('first-office-game-v1', JSON.stringify(st)); });
  await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { Stage3Agents.speed(10); Stage2.sleepMs(1500); });

  const t0 = Date.now(), log = [];
  let round = 0;
  for (; round < 60; round++) {
    const st = await p.evaluate(() => { const s = Stage2.state(), A = Stage3Agents; return { rep: s.rep, bugs: s.bugs, cash: s.cash, day: s.day, tray: s.tray.length, tools: s.tools, won3: s.won3, pens: A.crew().pens.length,
      agents: A.list().map(a => ({ id: a.id, live: A.live(a) || a.status === 'queued', q: !!a.q, phrase: A.phrase(a) })) }; });
    if (st.rep >= 60) break;
    // A sensible player turns on the rules once the team has made a mistake or two.
    if (st.pens >= 2) await p.evaluate(() => ['scope', 'lessons', 'honest', 'proof', 'claim', 'spend'].forEach(k => Stage3Agents.setRule('all', k, true)));
    for (const a of st.agents) if (a.q) await p.evaluate(id => Stage3Agents.answer(id, 0), a.id);
    const free = st.agents.filter(a => !a.live).map(a => a.id);
    const brief = [];
    if (!st.tools.includes('trace') && st.cash >= 600) brief.push('buy the Tracer, budget $600');
    if (st.tools.includes('trace')) brief.push('connect a critical chain');
    if (st.tray) brief.push('validate the tray');
    brief.push('hunt wherever there\'s work', 'hunt wherever there\'s work', 'hunt wherever there\'s work');
    for (const id of free) { const b = brief.shift(); await p.evaluate(([id, b]) => Stage3Agents.send(id, b), [id, b]); }
    // When nobody can start anything, sleep: a new day, and Nib fills the tray overnight.
    await p.waitForTimeout(2500);
    const idle = await p.evaluate(() => Stage3Agents.list().every(a => !Stage3Agents.live(a) && a.status !== 'queued'));
    if (idle) {
      const refusals = await p.evaluate(() => Stage3Agents.list().map(a => a.log.at(-1)).filter(m => m.kind === 'refuse').map(m => m.text));
      log.push(`round ${round}: idle (${refusals[0] || 'no refusals'}), sleeping`);
      await p.evaluate(() => { const b = document.querySelector('#nib-bubble:not([hidden]) .nib-next'); if (b) b.click(); });
      await p.click('#sleep', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(3500);
      // Click through the morning like a player would, until the scene is over.
      for (let i = 0; i < 40 && await p.evaluate(() => Stage2.ui().morning || Stage2.ui().night); i++) { const b = await p.$('#nib-bubble:not([hidden]) .nib-next'); if (b) await b.click({ timeout: 1000 }).catch(() => {}); await p.waitForTimeout(300); }
    }
    log.push(`round ${round}: rep ${st.rep} · bugs ${st.bugs} · $${st.cash} · day ${st.day} · tray ${st.tray} · pens ${st.pens} · ${st.agents.map(a => a.id + ': ' + a.phrase).join(' | ')}`);
  }
  const end = await p.evaluate(() => { const s = Stage2.state(); return { rep: s.rep, bugs: s.bugs, day: s.day, byAgents: s.stats.agent, won3: s.won3, pens: Stage3Agents.crew().pens.map(x => x.title) }; });
  console.log(log.join('\n'));
  console.log('END', JSON.stringify(end), 'in', Math.round((Date.now() - t0) / 1000) + 's');
  await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(__dirname, '..', 'evidence', 'stage3-elite.png') });
  assert.ok(end.rep >= 60, 'reached Elite');
  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('stage 3 playthrough passed');
})().catch(e => { console.error(e); process.exit(1); });
