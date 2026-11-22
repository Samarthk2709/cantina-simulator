// Usage: node review/tools/repeat-station.cjs <stationId> <times>
// Runs the clip sampler (strict 1.5 cm, flags ignored) over the station N times; prints the worst hit per run.
const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
const { inPageInstall } = require('../clip.cjs');
(async () => {
  const id = process.argv[2] || 'forge', N = +(process.argv[3] || 6);
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  await p.evaluate(inPageInstall, { tol: 0.015, tolContact: 0.03 });
  const starts = ['gameplay', 'wide', 'wide-west', 'wide-ne', 'portrait', 'walking'];
  for (let i = 0; i < N; i++) {
    await p.evaluate(s => { const O = window.Office3D; O.leave?.(); O.shot(s); }, starts[i % starts.length]); await p.waitForTimeout(1200);
    const r = await p.evaluate(id => window.__clip.station(id, 2500, 2000), id);
    const hits = (r.hits || []).concat(r.geomHits || []).filter(h => !/floor/.test(h.object)).sort((a, b) => b.depthCm - a.depthCm);
    console.log(`run ${i + 1} (from ${starts[i % starts.length]}): ${hits.length} hits; worst ${hits[0] ? `${hits[0].part} in ${hits[0].object} ${hits[0].depthCm} cm ${hits[0].phase}${hits[0].contact ? ' [' + hits[0].contact + ']' : ''}` : '-'}`);
  }
  await b.close();
})();
