// Usage: node review/tools/path-clearance.cjs  -> per station: time for interact() to resolve from a common start,
// path length walked, and min horizontal clearance from the robot root to any floor-standing collider while walking.
const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  const res = await p.evaluate(async () => {
    const O = window.Office3D, out = [];
    const cols = O.colliders().filter(c => c.name !== 'floor' && !/wall|ceil/i.test(c.name) && c.box.min.y < 0.3 && c.box.max.y > 0.15);
    for (const id of O.stations()) {
      O.leave?.(); O.shot('gameplay'); await new Promise(r => setTimeout(r, 1500)); document.documentElement.classList.remove('o3d-shot');
      const V = O.robot.position.constructor; let prev = O.robot.getWorldPosition(new V()), len = 0, minC = { d: 9 }; const t0 = performance.now(); let done = false;
      O.interact(id).then(() => { done = true; });
      while (!done && performance.now() - t0 < 20000) {
        await new Promise(r => setTimeout(r, 50)); const q = O.robot.getWorldPosition(new V()); const step = Math.hypot(q.x - prev.x, q.z - prev.z); len += step; prev = q;
        if (step > 0.004) for (const c of cols) { const dx = Math.max(c.box.min.x - q.x, 0, q.x - c.box.max.x), dz = Math.max(c.box.min.z - q.z, 0, q.z - c.box.max.z); const d = Math.hypot(dx, dz); if (d < minC.d) minC = { d, n: c.name }; }
      }
      out.push({ id, sec: +((performance.now() - t0) / 1000).toFixed(1), resolved: done, pathM: +len.toFixed(2), minClearCm: +(minC.d * 100).toFixed(0), nearest: minC.n });
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
  await b.close();
})();
