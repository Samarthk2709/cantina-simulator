// Memory growth over a long chapter 3 session: agents hunt at 10× and the day turns over, for MEM_SECS (default 240 s,
// about 40 minutes of play). Every 30 s, after a forced GC: JS heap, DOM nodes, event listeners. Fails if the heap
// after GC grows more than 50% from the first sample to the last (lines settle after the first day).
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/memory.cjs
const { chromium } = require('playwright');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SECS = +(process.env.MEM_SECS || 240);

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
  await p.evaluate(() => Stage3Agents.speed(10));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const inDoc = await p.evaluate(() => document.getElementsByTagName('*').length), log = await p.evaluate(() => Stage3Agents.list().reduce((n, a) => n + (a.log?.length || 0), 0));
    return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, inDoc, agentLog: log, listeners: m.JSEventListeners };
  };
  const rows = [], t0 = Date.now();
  let next = 0;
  while (Date.now() - t0 < SECS * 1000) {
    if (Date.now() - t0 >= next) { rows.push({ s: Math.round((Date.now() - t0) / 1000), ...await sample() }); next += 30000; }
    await p.evaluate(() => { const A = Stage3Agents; A.list().forEach(a => { if (a.q) A.answer(a.id, 0); if (!A.live(a) && a.status !== 'queued') A.send(a.id, 'hunt wherever there\'s work'); }); });
    if (await p.evaluate(() => Stage3Agents.list().every(a => !Stage3Agents.live(a) && a.status !== 'queued'))) {
      await p.evaluate(() => { const b = document.querySelector('#nib-bubble:not([hidden]) .nib-next'); if (b) b.click(); });
      await p.evaluate(() => Stage2.sleepMs(1500)); await p.click('#sleep', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(3000);
      for (let i = 0; i < 40 && await p.evaluate(() => Stage2.ui().morning || Stage2.ui().night); i++) { await p.evaluate(() => document.querySelector('#nib-bubble:not([hidden]) .nib-next')?.click()); /* no element handles: Playwright pins each one (and all its listener holds) for the whole run */ await p.waitForTimeout(300); }
    }
    // The team view now and then, so its panes are built and torn down too.
    if (rows.length % 2) { await p.evaluate(() => Stage3UI.open()); await p.waitForTimeout(500); await p.evaluate(() => Stage3UI.close()); }
    await p.waitForTimeout(2000);
  }
  rows.push({ s: Math.round((Date.now() - t0) / 1000), ...await sample() });
  console.table(rows);
  await browser.close();
  const a = rows[1] || rows[0], z = rows.at(-1), grew = (z.heapMB - a.heapMB) / a.heapMB;
  if (errors.length) { console.error('page errors:', errors); process.exit(1); }
  if (grew > 0.5) { console.error(`heap grew ${Math.round(grew * 100)}% (${a.heapMB} → ${z.heapMB} MB)`); process.exit(1); }
  console.log(`memory ok: heap ${a.heapMB} → ${z.heapMB} MB after GC, nodes ${a.nodes} → ${z.nodes} (in page ${a.inDoc} → ${z.inDoc}), listeners ${a.listeners} → ${z.listeners}`);
})().catch(e => { console.error(e); process.exit(1); });
