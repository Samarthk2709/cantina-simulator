// Stage 2 headless playthrough through the real UI. Needs the game server and Playwright:
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/browser.cjs
// Screenshots go to evidence/. Uses fresh browser contexts, never your own save. Stage 1 is marked done
// up front (Stage 1 has its own test, tests/flow.cjs), so the office opens directly.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const OUT = path.join(__dirname, '..', 'evidence');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  async function page(w, h, mobile) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!mobile, isMobile: !!mobile });
    await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'friend', facts: [], completedAt: '2026-10-25T00:00:00Z' })); });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL); await p.waitForTimeout(900);
    return { p, ctx };
  }
  const st = p => p.evaluate(() => JSON.parse(JSON.stringify(Stage2.state())));
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') });
  const badLine = (p, fid) => p.evaluate(fid => { const f = Stage2Engine.FINDINGS[fid]; return Stage2Data.CLASSES[f.cls].variants[f.variant].findIndex(l => l.bad); }, fid);
  const okLine = (p, fid) => p.evaluate(fid => { const f = Stage2Engine.FINDINGS[fid]; return Stage2Data.CLASSES[f.cls].variants[f.variant].findIndex(l => !l.bad && l.t.includes('const')); }, fid);
  async function teachSharp(p, fid) {
    await p.waitForSelector('.nib-choice', { timeout: 8000 }); await p.waitForTimeout(250);
    const sharp = await p.evaluate(fid => { const f = Stage2Engine.FINDINGS[fid]; return Stage2Data.fill(Stage2Data.CLASSES[f.cls].teach.sharp, f.nouns); }, fid);
    const labels = await p.$$eval('.nib-choice', bs => bs.map(b => b.textContent));
    await p.keyboard.press(String(labels.findIndex(t => t.includes(sharp.slice(0, 30))) + 1));
  }
  async function goodReport(p) {
    await p.waitForSelector('[data-act=pick]');
    for (const sec of ['title', 'impact', 'steps', 'proof', 'fix']) await p.click(`[data-act=pick][data-sec=${sec}][data-id="0"]`);
  }

  // ---- 1. A new player's first day, through real controls ----
  {
    const { p, ctx } = await page(1440, 900);
    await shot(p, '01-intro');
    let s = await st(p);
    assert.equal(s.seen.training, undefined, 'only the desk exists at first');
    assert.equal(await p.$$eval('[data-station]', b => b.length), 1);
    await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await p.evaluate(() => Stage2.world.goTo('hunt')); await p.waitForTimeout(1500);
    await p.keyboard.press('e'); await p.waitForSelector('[data-act=take]');
    await shot(p, '02-bounty-board');
    assert.equal(await p.$('[data-act=take][data-id=bank]'), null, 'private program is locked');
    await p.click('[data-act=take][data-id=chat]'); await p.waitForSelector('.target-map');
    await shot(p, '03-target-map');
    await p.click('[data-act=hunt]'); await p.waitForSelector('.code-line');
    const fid = await p.evaluate(() => Stage2.ui().fid);
    await shot(p, '04-hunt');
    await p.click(`[data-act=line][data-id="${await okLine(p, fid)}"]`); await p.waitForSelector('.feedback.miss');
    s = await st(p); assert.equal(s.focus, 100 - 8, 'a wrong line costs focus');
    await p.click(`[data-act=line][data-id="${await badLine(p, fid)}"]`);
    await p.waitForSelector('.nib-choice'); await p.waitForTimeout(300);
    await shot(p, '05-teach-nib');
    await p.keyboard.press('Enter'); await p.keyboard.press(' '); await p.waitForTimeout(200);
    assert.equal((await st(p)).pendingTeach, fid, 'Enter/Space must not pick an answer');
    await p.reload(); await p.waitForSelector('.nib-choice', { timeout: 6000 });
    assert.equal((await st(p)).pendingTeach, fid, 'reloading mid-lesson brings the question back');
    await teachSharp(p, fid);
    await goodReport(p); await shot(p, '06-report');
    await p.click('[data-act=submit]'); await p.waitForSelector('.stamp'); await p.waitForTimeout(400);
    await shot(p, '07-report-paid');
    s = await st(p);
    assert.equal(s.bugs, 1); assert.ok(s.cash > 0); assert.equal(Math.round(s.lessons[Stage2Engine_cls(fid)].clean), 1);
    assert.ok(s.seen.training && s.seen.forge && s.seen.stats, 'Nib\'s desk, tools and ledger appear');
    await p.keyboard.press('Escape'); await p.waitForTimeout(5000);
    await shot(p, '08-office-grows');

    // ---- 2. Night shift and Nib's finds ----
    await p.click('#sleep'); await p.waitForTimeout(1500); await shot(p, '09-night');
    await p.waitForSelector('.nib-next', { timeout: 15000 }); await p.waitForTimeout(300);
    await shot(p, '10-morning');
    s = await st(p); assert.equal(s.day, 2); assert.equal(s.focus, 100); assert.ok(s.seen.rig);
    for (let i = 0; i < 3 && await p.$('.nib-next'); i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(350); }
    if (s.tray.length) {
      await p.evaluate(() => Stage2.open('contract')); await p.waitForSelector('[data-act=prove]');
      await shot(p, '11-ops');
      await p.click('[data-act=prove]'); await p.waitForSelector('.feedback'); await shot(p, '12-proved');
      assert.equal((await st(p)).focus, 85, 'proof costs 15 focus');
    }
    for (const [id, name] of [['training', '13-pattern-book'], ['rig', '14-rig'], ['forge', '15-tools'], ['stats', '16-ledger']]) {
      await p.evaluate(id => Stage2.open(id), id); await p.waitForTimeout(250); await shot(p, name);
    }
    await p.reload(); await p.waitForTimeout(900);
    assert.equal((await st(p)).bugs, 1, 'progress survives a reload');
    await ctx.close();
  }

  // ---- 3. Late game: chain a critical, finish the job ----
  {
    const { p, ctx } = await page(1440, 900);
    await p.evaluate(() => {
      const E = Stage2Engine, D = Stage2Data, s = E.create({ playerName: 'Sam' }, 3); s.seen.intro = true;
      const bad = fid => { const f = E.FINDINGS[fid]; return D.CLASSES[f.cls].variants[f.variant].findIndex(l => l.bad); };
      const bank = fid => { const [t, r] = fid.split(':'); if (s.target !== t) E.takeJob(s, t); if (!E.isLit(s, t, r)) s.lit[t].push(r); s.focus = 100; s.rng = 1; E.guess(s, fid, bad(fid)); if (s.pendingTeach) E.teach(s, 'sharp'); D.SECTIONS.forEach(x => E.setSection(s, fid, x.id, 0)); E.submit(s, fid); };
      Object.keys(E.FINDINGS).filter(id => id.startsWith('chat:')).forEach(bank);
      ['inv:acct:0', 'inv:inv:0', 'inv:inv:1', 'inv:pay:1', 'inv:admin:0', 'inv:admin:1', 'inv:acct:1', 'inv:up:0', 'inv:pdf:0'].forEach(bank);
      Object.values(s.found).forEach(f => { f.crit = false; }); s.crits = 0; s.chains = {};
      E.takeJob(s, 'vault'); E.sleep(s); s.tray = []; s.cash = 3000; E.buyTool(s, 'dbg'); E.buyTool(s, 'trace');
      localStorage.setItem('first-office-game-v1', JSON.stringify(s));
    });
    await p.reload(); await p.waitForTimeout(1000);
    assert.equal((await st(p)).bugs, 19);
    await p.evaluate(() => Stage2.open('hq')); await p.waitForSelector('[data-act=trace]');
    await shot(p, '17-hq-chain');
    await p.click('[data-act=trace][data-tid=chat]:not([data-id="0"])'); await p.waitForTimeout(200);
    assert.equal((await st(p)).crits, 0, 'a wrong explanation does not chain');
    await p.click('[data-act=trace][data-tid=chat][data-id="0"]'); await p.waitForTimeout(500);
    assert.equal((await st(p)).crits, 1); await shot(p, '18-chained');
    await p.evaluate(() => Stage2.open('hunt')); await p.waitForTimeout(300);
    if (await p.$('[data-act=to-map]')) await p.click('[data-act=to-map]');
    const fid = await p.evaluate(() => { const s = Stage2.state(), E = Stage2Engine; return s.lit.vault.flatMap(r => E.roomFindings('vault', r)).find(f => E.slotState(s, f) === 'open'); });
    await p.click(`[data-act=room][data-id=${fid.split(':')[1]}]`); await p.waitForTimeout(150);
    await p.click(`[data-act=hunt][data-id="${fid}"]`); await p.waitForSelector('.code-line');
    await p.click(`[data-act=line][data-id="${await badLine(p, fid)}"]`);
    if (await p.waitForSelector('.nib-choice', { timeout: 6000 }).catch(() => null)) await teachSharp(p, fid);
    await goodReport(p); await p.click('[data-act=submit]');
    await p.waitForSelector('#modal[open] .ending', { timeout: 6000 }); await p.waitForTimeout(400);
    await shot(p, '19-ending');
    const s = await st(p); assert.ok(s.won && s.bugs >= 20 && s.crits >= 1);
    // The ending leads into chapter 3 with this same save: same money, same bugs, two agents.
    await p.click('#to-stage3'); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 });
    const s3 = await st(p); assert.equal(s3.stage, 3); assert.equal(s3.bugs, s.bugs); assert.equal(s3.cash, s.cash);
    assert.deepEqual(await p.evaluate(() => Stage3Agents.list().map(a => a.id)), ['nib', 'pip', 'moss']);
    await ctx.close();
  }

  // ---- 4. Phone layout ----
  {
    const { p, ctx } = await page(390, 844, true);
    await p.keyboard.press('Enter'); await p.waitForTimeout(250); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    await shot(p, '20-phone-office');
    await p.evaluate(() => Stage2.open('hunt')); await p.click('[data-act=take][data-id=chat]'); await p.waitForSelector('.target-map');
    await shot(p, '21-phone-map');
    const over = await p.evaluate(() => [...document.querySelectorAll('#panel-dialog *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
    assert.equal(over, 0, 'nothing in the window overflows a phone screen');
    await ctx.close();
  }

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('browser playthrough passed; screenshots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });

function Stage2Engine_cls(fid) { return require('../engine.js').FINDINGS[fid].cls; }
