// Resource use in four cases: idle office, walking, chapter 3 with the team working, and the team view open.
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/perf.cjs [--json out.json]
// Per case, over SECS seconds: main-thread script and task time (ms/s), style recalcs and layouts per second, frames on
// which any canvas was painted, rAF callbacks per second, and the longest task. Model endpoints are blocked.
const { chromium } = require('playwright');
const fs = require('node:fs');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SECS = +(process.env.PERF_SECS || 8);

// Counts, without changing behaviour: rAF callbacks run, canvas paints per frame (any 2D draw call on a canvas marks
// it), long tasks. The probe loop itself is one cheap rAF.
const PROBE = () => {
  const P = window.__perf = { raf: 0, paintFrames: 0, frames: 0, longest: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { P.raf++; cb(t); });
  let painted = false;
  const C = CanvasRenderingContext2D.prototype;
  for (const m of ['drawImage', 'fillRect', 'clearRect', 'fillText', 'fill', 'stroke', 'putImageData']) {
    const f = C[m]; C[m] = function () { painted = true; return f.apply(this, arguments); };
  }
  (function probe() { P.frames++; if (painted) P.paintFrames++; painted = false; raf(probe); })();
  try { new PerformanceObserver(l => l.getEntries().forEach(e => { P.longest = Math.max(P.longest, e.duration); })).observe({ type: 'longtask', buffered: false }); } catch {}
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = {};
  // A headless page now and then stops producing frames; such a run is retried (up to 3 tries).
  async function measure(name, p, during, tries = 3) {
    await p.bringToFront();
    const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
    const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    await p.evaluate(() => Object.assign(window.__perf, { raf: 0, paintFrames: 0, frames: 0, longest: 0 }));
    const a = await get(), t0 = Date.now();
    await during();
    const b = await get(), secs = (Date.now() - t0) / 1000, pp = await p.evaluate(() => window.__perf);
    const per = k => +((b[k] - a[k]) / secs).toFixed(1);
    results[name] = {
      scriptMsPerSec: +((b.ScriptDuration - a.ScriptDuration) * 1000 / secs).toFixed(1),
      taskMsPerSec: +((b.TaskDuration - a.TaskDuration) * 1000 / secs).toFixed(1),
      styleRecalcsPerSec: per('RecalcStyleCount'), layoutsPerSec: per('LayoutCount'),
      paintFramesPerSec: +(pp.paintFrames / secs).toFixed(1), framesPerSec: +(pp.frames / secs).toFixed(1),
      rafPerSec: +(pp.raf / secs).toFixed(1), longestTaskMs: Math.round(pp.longest), heapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
    };
    await cdp.detach();
    if (results[name].framesPerSec < 20 && tries > 1) { console.error(`${name}: page stalled (${results[name].framesPerSec} fps), retrying`); return measure(name, p, during, tries - 1); }
  }
  async function page(seed3) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await ctx.addInitScript(() => { if (!localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Sam', facts: [], completedAt: '2026-10-25T00:00:00Z' })); });
    await ctx.addInitScript(PROBE);
    const p = await ctx.newPage(); p.on('pageerror', e => console.error('pageerror:', e.message));
    await p.goto(URL); await p.waitForTimeout(800);
    if (seed3) {
      await p.evaluate(() => { const st = Stage3Scope.seed({ playerName: 'Sam' }); st.stage = 3; Object.assign(st.seen, { team: true }); localStorage.removeItem('first-office-crew-v1'); localStorage.setItem('first-office-game-v1', JSON.stringify(st)); });
      await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 }); await p.waitForTimeout(800);
    }
    // Let Nib's opening lines finish so "idle" is idle.
    for (let i = 0; i < 12; i++) { const b = await p.$('#nib-bubble:not([hidden]) .nib-next'); if (!b) break; await b.click({ timeout: 1000 }).catch(() => {}); await p.waitForTimeout(400); }
    await p.waitForTimeout(1500);
    return p;
  }
  const idle = p => p.waitForTimeout(SECS * 1000);

  { const p = await page(false); await measure('idle office', p, () => idle(p));
    await p.click('#world').catch(() => {});
    await measure('walking', p, async () => { for (let i = 0; i < SECS; i++) { const k = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][i % 4]; await p.keyboard.down(k); await p.waitForTimeout(1000); await p.keyboard.up(k); } });
    await p.context().close(); }
  { const p = await page(true);
    await measure('ch3 team idle', p, () => idle(p));
    await p.evaluate(() => Stage3Agents.list().filter(a => a.id !== 'nib').forEach(a => Stage3Agents.send(a.id, 'hunt wherever there\'s work')));
    await p.waitForTimeout(1000);
    await measure('ch3 team working', p, () => idle(p));
    await p.evaluate(() => Stage3UI.open()); await p.waitForTimeout(800);
    await measure('ch3 team view open', p, () => idle(p));
    await p.context().close(); }

  await browser.close();
  console.table(results);
  const i = process.argv.indexOf('--json'); if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
