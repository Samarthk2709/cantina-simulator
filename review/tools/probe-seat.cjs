const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const O = window.Office3D; await O.interact('hunt'); await new Promise(r => setTimeout(r, 2500)); const V = O.robot.position.constructor; const h = O.robot.getObjectByName('hips').getWorldPosition(new V()); const near = O.colliders().map(c => ({ n: c.name, ct: c.contact || '', d: +c.box.distanceToPoint(h).toFixed(2), top: +c.box.max.y.toFixed(2), bot: +c.box.min.y.toFixed(2) })).filter(c => c.d < 0.4).sort((a, b) => a.d - b.d).slice(0, 15); return { hips: h.toArray(), near };
  })));
  await b.close();
})();
